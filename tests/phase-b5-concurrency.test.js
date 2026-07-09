'use strict';
/**
 * Phase B5 — SAVE Concurrency Hardening & State Machine Enforcement
 *
 * Covers:
 *   S1  saveLock blocks concurrent SAVE — second call rejected, first completes normally
 *   S2  saveLock try/finally — lock released even when DB throws
 *   S3  SAVING state tag — state is SAVING between GENERATED and RECOVERABLE (full machine)
 *   S4  Illegal transition guard — non-GENERATED state cannot reach saveResource()
 *   S5  CAS re-read — stale generationId (overwritten by processGeneration) rejected safely
 *   S6  Full consistency matrix — A/B/C/D/E all combinations
 *   S7  State purity — spread creates new reference; original object unchanged
 *   S8  generationId immutability — every state update preserves captured generationId
 *   S9  Integration: interleaved generation + SAVE — correct (latest) resource saved
 *
 * Run:  node tests/phase-b5-concurrency.test.js
 */

// ── Shim better-sqlite3 → node:sqlite ────────────────────────────────────────
const Module = require('module');
const { DatabaseSync } = require('node:sqlite');

let _db = null;

const _origResolve = Module._resolveFilename.bind(Module);
Module._resolveFilename = function (request, parent, isMain, opts) {
  if (request === 'better-sqlite3') return request;
  return _origResolve(request, parent, isMain, opts);
};
require.cache['better-sqlite3'] = {
  id: 'better-sqlite3',
  filename: 'better-sqlite3',
  loaded: true,
  exports: function Database() {
    if (!_db.pragma) _db.pragma = () => {};
    return _db;
  },
};

const path = require('path');
const dbPath = path.resolve(__dirname, '../utils/database');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { getDb: () => _db },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

function assertEq(a, b, label) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    console.error(`     expected: ${JSON.stringify(b)}`);
    console.error(`     got:      ${JSON.stringify(a)}`);
    failed++;
  }
}

// ── In-memory session store ───────────────────────────────────────────────────
class MemorySessionStore {
  constructor() { this._data = new Map(); }
  get(key)        { return this._data.get(key) || null; }
  set(key, value) { this._data.set(key, value); }
  delete(key)     { this._data.delete(key); }
}

// ── Schema ────────────────────────────────────────────────────────────────────
function buildSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash TEXT UNIQUE NOT NULL,
      name TEXT,
      saved_resources_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS saved_resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash TEXT NOT NULL,
      resource_type TEXT,
      title TEXT,
      content TEXT,
      grade INTEGER,
      subject TEXT,
      topic TEXT,
      metadata TEXT,
      generation_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_resources_generation
      ON saved_resources(phone_hash, generation_id)
      WHERE generation_id IS NOT NULL;
  `);
}

// ── B5-aware SAVE lifecycle simulator ────────────────────────────────────────
// Mirrors the B5-hardened SAVE handler:
//   - saveLock (per-phone Set) with try/finally
//   - illegal transition guard (saveState must be 'GENERATED')
//   - CAS re-read before INSERT
//   - SAVING tag before saveResource()
//   - RECOVERABLE tag after DB commit
//   - SAVING rollback on DB error
//   - constraint violation recovery (B4-F6 preserved)
//
// Returns: { action, resourceId, error, stateAfter, stateAtSaving? }
//   action: 'saved' | 'reconfirmed' | 'nothing_to_save' | 'malformed_cleared'
//           | 'illegal_transition' | 'concurrent_blocked' | 'cas_mismatch'
//           | 'constraint_recovered' | 'failed'
async function simulateSaveB5({
  store,
  lockSet,              // shared Set — simulates module-level saveLock
  phoneHash,
  saveResource,
  getSavedResourceByGenerationId,
  whatsappShouldFail   = false,
  dbShouldFail         = false,
  dbConstraintFail     = false,
  // Hook called just after lock is acquired and before CAS — lets tests inject
  // a processGeneration call to simulate state overwrite mid-save.
  onLockAcquired       = null,
}) {
  const last = store.get(phoneHash);

  // IDLE
  if (!last) return { action: 'nothing_to_save', stateAfter: null };

  // RECOVERABLE branch (B4-F4) — tag-based, no INSERT
  if (last.saveState === 'RECOVERABLE') {
    if (whatsappShouldFail) {
      return { action: 'failed', error: 'whatsapp_down_on_retry', stateAfter: store.get(phoneHash) };
    }
    store.delete(phoneHash);
    return { action: 'reconfirmed', resourceId: last.lastSavedId, stateAfter: null };
  }

  // Malformed state guard (B4-F5)
  if (!last.generationId) {
    store.delete(phoneHash);
    return { action: 'malformed_cleared', stateAfter: null };
  }

  // B5-F3: Illegal transition guard — only GENERATED reaches INSERT
  if (last.saveState !== 'GENERATED') {
    store.delete(phoneHash);
    return { action: 'illegal_transition', saveState: last.saveState, stateAfter: null };
  }

  // B5-F1: saveLock check
  if (lockSet.has(phoneHash)) {
    return { action: 'concurrent_blocked', stateAfter: store.get(phoneHash) };
  }

  const typeLabel = last.intent.type;
  const topicPart = last.intent.topic || 'Untitled';
  const title = `${topicPart} — ${typeLabel}`;
  const meta = {
    grade: last.intent.grade || null,
    subject: last.intent.subject || null,
    topic: last.intent.topic || null,
    intent: last.intent.type,
    savedAt: new Date().toISOString(),
  };

  lockSet.add(phoneHash);
  let stateAtSaving = null;
  try {
    // Hook for tests: simulate processGeneration overwriting state after lock acquired
    if (onLockAcquired) await onLockAcquired();

    // B5-F2: CAS re-read
    const current = store.get(phoneHash);
    if (!current || current.generationId !== last.generationId) {
      return {
        action: 'cas_mismatch',
        capturedId: last.generationId,
        currentId: current ? current.generationId : null,
        stateAfter: store.get(phoneHash),
      };
    }

    // B5-F3: Tag SAVING before INSERT
    store.set(phoneHash, Object.assign({}, last, { saveState: 'SAVING' }));
    stateAtSaving = store.get(phoneHash);

    if (dbShouldFail) throw new Error('Simulated DB failure');
    if (dbConstraintFail) {
      const e = new Error('UNIQUE constraint failed: saved_resources.phone_hash, saved_resources.generation_id');
      e.code = 'SQLITE_CONSTRAINT_UNIQUE';
      throw e;
    }

    const saved = saveResource(phoneHash, last.intent.type, title, last.content, meta, last.generationId);

    // DB committed — tag RECOVERABLE
    store.set(phoneHash, Object.assign({}, last, { saveState: 'RECOVERABLE', lastSavedId: saved.id }));

    if (whatsappShouldFail) {
      return { action: 'failed', error: 'whatsapp_down', savedId: saved.id, stateAfter: store.get(phoneHash), stateAtSaving };
    }

    store.delete(phoneHash);
    return { action: 'saved', resourceId: saved.id, stateAfter: null, stateAtSaving };
  } catch (err) {
    // B4-F6: constraint violation recovery
    const isConstraint = err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
      (err.message && err.message.includes('UNIQUE constraint failed'));

    if (isConstraint && last.generationId) {
      const committed = getSavedResourceByGenerationId(last.generationId, phoneHash);
      if (committed) {
        store.set(phoneHash, Object.assign({}, last, { saveState: 'RECOVERABLE', lastSavedId: committed.id }));
        if (whatsappShouldFail) {
          return { action: 'failed', error: 'constraint_recovered_wa_down', stateAfter: store.get(phoneHash), stateAtSaving };
        }
        store.delete(phoneHash);
        return { action: 'constraint_recovered', resourceId: committed.id, stateAfter: null, stateAtSaving };
      }
    }

    // DB error — roll back SAVING → GENERATED so retry can proceed
    const stateNow = store.get(phoneHash);
    if (stateNow && stateNow.saveState === 'SAVING') {
      store.set(phoneHash, Object.assign({}, last, { saveState: 'GENERATED' }));
    }
    return { action: 'failed', error: err.message, stateAfter: store.get(phoneHash), stateAtSaving };
  } finally {
    lockSet.delete(phoneHash);
  }
}

// ── Simulate processGeneration ────────────────────────────────────────────────
function simulateGenerate({ store, phoneHash, intent, content }) {
  const { randomUUID } = require('crypto');
  const existing = store.get(phoneHash);
  const overwroteRecoverable = existing && existing.saveState === 'RECOVERABLE';
  const orphanedId = overwroteRecoverable ? existing.lastSavedId : null;

  store.set(phoneHash, {
    generationId: randomUUID(),
    saveState: 'GENERATED',
    intent: {
      type:    intent.type    || 'worksheet',
      topic:   intent.topic   || null,
      grade:   intent.grade   || null,
      subject: intent.subject || 'general',
    },
    content: content || 'Generated content',
    lastActivity: Date.now(),
  });

  return { overwroteRecoverable, orphanedId, generationId: store.get(phoneHash).generationId };
}

// ── DB helpers ────────────────────────────────────────────────────────────────
function makeInsertFn(db) {
  return function saveResource(phoneHash, type, title, content, meta, generationId) {
    const stmt = db.prepare(
      `INSERT INTO saved_resources (phone_hash, resource_type, title, content, metadata, generation_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const r = stmt.run(phoneHash, type, title, content || '', JSON.stringify(meta), generationId || null);
    return { id: r.lastInsertRowid };
  };
}

function makeLookupFn(db) {
  return function getSavedResourceByGenerationId(generationId, phoneHash) {
    const stmt = db.prepare(
      `SELECT id FROM saved_resources WHERE generation_id = ? AND phone_hash = ? LIMIT 1`
    );
    return stmt.get(generationId, phoneHash) || null;
  };
}

function countRows(db, phoneHash) {
  return db.prepare(`SELECT COUNT(*) AS n FROM saved_resources WHERE phone_hash = ?`).get(phoneHash).n;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — saveLock: concurrent SAVE calls
// ─────────────────────────────────────────────────────────────────────────────
async function runSection1() {
  console.log('\n── S1: saveLock — concurrent SAVE blocking ─────────────────────────────────');
  _db = new DatabaseSync(':memory:');
  buildSchema(_db);
  const store = new MemorySessionStore();
  const lockSet = new Set();
  const save = makeInsertFn(_db);
  const lookup = makeLookupFn(_db);
  const phone = 'hash_s1_a';

  // Seed GENERATED state
  simulateGenerate({ store, phoneHash: phone, intent: { type: 'worksheet', topic: 'Fractions' }, content: 'C' });
  const genId = store.get(phone).generationId;

  // Manually pre-acquire lock to simulate concurrent in-flight SAVE
  lockSet.add(phone);

  const r1 = await simulateSaveB5({ store, lockSet, phoneHash: phone, saveResource: save, getSavedResourceByGenerationId: lookup });
  assert(r1.action === 'concurrent_blocked', 'S1-01: second SAVE blocked while lock held');
  assert(store.get(phone).saveState === 'GENERATED', 'S1-02: state unchanged after blocked call');
  assert(store.get(phone).generationId === genId, 'S1-03: generationId unchanged after blocked call');
  assert(countRows(_db, phone) === 0, 'S1-04: no DB row inserted for blocked call');

  // Release lock — first SAVE can now proceed
  lockSet.delete(phone);
  const r2 = await simulateSaveB5({ store, lockSet, phoneHash: phone, saveResource: save, getSavedResourceByGenerationId: lookup });
  assert(r2.action === 'saved', 'S1-05: SAVE succeeds after lock released');
  assert(countRows(_db, phone) === 1, 'S1-06: exactly one DB row after successful save');
  assert(lockSet.size === 0, 'S1-07: lock released after successful save');

  // Lock is always released — even after successful save it is gone
  assert(!lockSet.has(phone), 'S1-08: phone not in lockSet after save completes');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — saveLock try/finally: lock released on DB error
// ─────────────────────────────────────────────────────────────────────────────
async function runSection2() {
  console.log('\n── S2: saveLock try/finally — lock released on error ────────────────────────');
  _db = new DatabaseSync(':memory:');
  buildSchema(_db);
  const store = new MemorySessionStore();
  const lockSet = new Set();
  const save = makeInsertFn(_db);
  const lookup = makeLookupFn(_db);
  const phone = 'hash_s2_a';

  simulateGenerate({ store, phoneHash: phone, intent: { type: 'test', topic: 'Equations' }, content: 'C' });

  // DB fail — lock must be released
  const r1 = await simulateSaveB5({ store, lockSet, phoneHash: phone, saveResource: save, getSavedResourceByGenerationId: lookup, dbShouldFail: true });
  assert(r1.action === 'failed', 'S2-01: DB failure returns failed');
  assert(!lockSet.has(phone), 'S2-02: lock released after DB failure (finally executed)');
  assert(lockSet.size === 0, 'S2-03: lockSet is empty after DB failure');
  assert(countRows(_db, phone) === 0, 'S2-04: no DB row on DB failure');

  // Retry after DB failure — lock still works
  const r2 = await simulateSaveB5({ store, lockSet, phoneHash: phone, saveResource: save, getSavedResourceByGenerationId: lookup });
  assert(r2.action === 'saved', 'S2-05: retry succeeds after lock was released');
  assert(!lockSet.has(phone), 'S2-06: lock released after successful retry');

  // WA fail — lock must be released
  const phone2 = 'hash_s2_b';
  simulateGenerate({ store, phoneHash: phone2, intent: { type: 'worksheet', topic: 'Area' }, content: 'C' });
  const r3 = await simulateSaveB5({ store, lockSet, phoneHash: phone2, saveResource: save, getSavedResourceByGenerationId: lookup, whatsappShouldFail: true });
  assert(r3.action === 'failed', 'S2-07: WA failure returns failed');
  assert(!lockSet.has(phone2), 'S2-08: lock released after WA failure');
  assert(r3.stateAfter.saveState === 'RECOVERABLE', 'S2-09: state is RECOVERABLE after WA fail');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — SAVING state tag (full machine enforcement)
// ─────────────────────────────────────────────────────────────────────────────
async function runSection3() {
  console.log('\n── S3: SAVING state tag — full GENERATED→SAVING→RECOVERABLE→SAVED ──────────');
  _db = new DatabaseSync(':memory:');
  buildSchema(_db);
  const store = new MemorySessionStore();
  const lockSet = new Set();
  const save = makeInsertFn(_db);
  const lookup = makeLookupFn(_db);
  const phone = 'hash_s3_a';

  simulateGenerate({ store, phoneHash: phone, intent: { type: 'lessonPlan', topic: 'Photosynthesis' }, content: 'C' });
  const genId = store.get(phone).generationId;

  // Happy path: stateAtSaving must show SAVING
  const r1 = await simulateSaveB5({ store, lockSet, phoneHash: phone, saveResource: save, getSavedResourceByGenerationId: lookup });
  assert(r1.stateAtSaving !== null, 'S3-01: stateAtSaving captured during INSERT');
  assert(r1.stateAtSaving.saveState === 'SAVING', 'S3-02: state was SAVING during INSERT window');
  assert(r1.stateAtSaving.generationId === genId, 'S3-03: generationId preserved in SAVING state');
  assert(r1.action === 'saved', 'S3-04: action is saved on success');
  assert(r1.stateAfter === null, 'S3-05: state cleared after SAVED');

  // WA fail path: SAVING must transition to RECOVERABLE (not stay SAVING)
  const phone2 = 'hash_s3_b';
  simulateGenerate({ store, phoneHash: phone2, intent: { type: 'test', topic: 'Genetics' }, content: 'C' });
  const r2 = await simulateSaveB5({ store, lockSet, phoneHash: phone2, saveResource: save, getSavedResourceByGenerationId: lookup, whatsappShouldFail: true });
  assert(r2.stateAtSaving.saveState === 'SAVING', 'S3-06: state was SAVING during INSERT (WA fail path)');
  assert(r2.stateAfter.saveState === 'RECOVERABLE', 'S3-07: state is RECOVERABLE after WA fail (not SAVING)');

  // DB fail path: SAVING must roll back to GENERATED
  const phone3 = 'hash_s3_c';
  simulateGenerate({ store, phoneHash: phone3, intent: { type: 'worksheet', topic: 'Tectonic Plates' }, content: 'C' });
  const r3 = await simulateSaveB5({ store, lockSet, phoneHash: phone3, saveResource: save, getSavedResourceByGenerationId: lookup, dbShouldFail: true });
  assert(r3.stateAtSaving.saveState === 'SAVING', 'S3-08: state was SAVING when DB threw');
  assert(r3.stateAfter.saveState === 'GENERATED', 'S3-09: state rolled back to GENERATED after DB failure');
  assert(r3.stateAfter.generationId === store.get(phone3).generationId, 'S3-10: generationId unchanged after rollback');

  // Retry after DB rollback must succeed
  const r4 = await simulateSaveB5({ store, lockSet, phoneHash: phone3, saveResource: save, getSavedResourceByGenerationId: lookup });
  assert(r4.action === 'saved', 'S3-11: retry after DB-rollback succeeds');
  assert(countRows(_db, phone3) === 1, 'S3-12: exactly one DB row after retry');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — Illegal transition guard
// ─────────────────────────────────────────────────────────────────────────────
async function runSection4() {
  console.log('\n── S4: Illegal transition guard ─────────────────────────────────────────────');
  _db = new DatabaseSync(':memory:');
  buildSchema(_db);
  const store = new MemorySessionStore();
  const lockSet = new Set();
  const save = makeInsertFn(_db);
  const lookup = makeLookupFn(_db);
  const phone = 'hash_s4_a';

  // State with unexpected saveState tag
  const { randomUUID } = require('crypto');
  store.set(phone, {
    generationId: randomUUID(),
    saveState: 'UNKNOWN_FUTURE_TAG',
    intent: { type: 'worksheet', topic: 'Test' },
    content: 'C',
    lastActivity: Date.now(),
  });
  const r1 = await simulateSaveB5({ store, lockSet, phoneHash: phone, saveResource: save, getSavedResourceByGenerationId: lookup });
  assert(r1.action === 'illegal_transition', 'S4-01: unknown saveState tag → illegal_transition');
  assert(r1.saveState === 'UNKNOWN_FUTURE_TAG', 'S4-02: action reports the offending state');
  assert(countRows(_db, phone) === 0, 'S4-03: no DB row for illegal transition');
  assert(store.get(phone) === null, 'S4-04: state cleared after illegal transition');

  // SAVING state left over (e.g. crash resume) → illegal transition
  const phone2 = 'hash_s4_b';
  store.set(phone2, {
    generationId: randomUUID(),
    saveState: 'SAVING',
    intent: { type: 'test', topic: 'Test' },
    content: 'C',
    lastActivity: Date.now(),
  });
  const r2 = await simulateSaveB5({ store, lockSet, phoneHash: phone2, saveResource: save, getSavedResourceByGenerationId: lookup });
  assert(r2.action === 'illegal_transition', 'S4-05: orphaned SAVING state → illegal_transition');
  assert(countRows(_db, phone2) === 0, 'S4-06: no DB row for orphaned SAVING state');

  // GENERATED state bypasses the guard (correct)
  const phone3 = 'hash_s4_c';
  simulateGenerate({ store, phoneHash: phone3, intent: { type: 'atp', topic: 'Term 1' }, content: 'C' });
  const r3 = await simulateSaveB5({ store, lockSet, phoneHash: phone3, saveResource: save, getSavedResourceByGenerationId: lookup });
  assert(r3.action === 'saved', 'S4-07: GENERATED state passes illegal-transition guard');

  // RECOVERABLE state is handled by idempotency branch, not illegal-transition guard
  const phone4 = 'hash_s4_d';
  simulateGenerate({ store, phoneHash: phone4, intent: { type: 'worksheet', topic: 'Forces' }, content: 'C' });
  await simulateSaveB5({ store, lockSet, phoneHash: phone4, saveResource: save, getSavedResourceByGenerationId: lookup, whatsappShouldFail: true });
  assert(store.get(phone4).saveState === 'RECOVERABLE', 'S4-08: setup: state is RECOVERABLE');
  const r4 = await simulateSaveB5({ store, lockSet, phoneHash: phone4, saveResource: save, getSavedResourceByGenerationId: lookup });
  assert(r4.action === 'reconfirmed', 'S4-09: RECOVERABLE goes through idempotency branch not illegal-transition guard');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — CAS re-read: stale generationId rejected safely
// ─────────────────────────────────────────────────────────────────────────────
async function runSection5() {
  console.log('\n── S5: CAS re-read — stale generationId rejected ────────────────────────────');
  _db = new DatabaseSync(':memory:');
  buildSchema(_db);
  const store = new MemorySessionStore();
  const lockSet = new Set();
  const save = makeInsertFn(_db);
  const lookup = makeLookupFn(_db);
  const phone = 'hash_s5_a';

  // Generation A
  simulateGenerate({ store, phoneHash: phone, intent: { type: 'worksheet', topic: 'Fractions' }, content: 'Content A' });
  const genIdA = store.get(phone).generationId;

  // Simulate processGeneration firing AFTER lock is acquired (via onLockAcquired hook)
  let capturedIdA = null;
  let newGenId = null;
  const r1 = await simulateSaveB5({
    store,
    lockSet,
    phoneHash: phone,
    saveResource: save,
    getSavedResourceByGenerationId: lookup,
    onLockAcquired: async () => {
      capturedIdA = genIdA;
      // processGeneration fires mid-save, overwrites state
      simulateGenerate({ store, phoneHash: phone, intent: { type: 'worksheet', topic: 'Decimals' }, content: 'Content B' });
      newGenId = store.get(phone).generationId;
    },
  });

  assert(r1.action === 'cas_mismatch', 'S5-01: CAS mismatch detected after state overwritten');
  assert(r1.capturedId === genIdA, 'S5-02: captured ID is the stale (A) generationId');
  assert(r1.currentId === newGenId, 'S5-03: current ID is the new (B) generationId');
  assert(countRows(_db, phone) === 0, 'S5-04: no DB row inserted on CAS mismatch');
  assert(!lockSet.has(phone), 'S5-05: lock released after CAS mismatch');

  // The new (B) state is still intact — teacher can save it
  assert(store.get(phone).generationId === newGenId, 'S5-06: new GENERATED state (B) preserved after CAS rejection');
  const r2 = await simulateSaveB5({ store, lockSet, phoneHash: phone, saveResource: save, getSavedResourceByGenerationId: lookup });
  assert(r2.action === 'saved', 'S5-07: new generation (B) saves successfully after CAS rejection');
  assert(countRows(_db, phone) === 1, 'S5-08: exactly one DB row — only generation B was inserted');

  // CAS: state deleted after initial get → mismatch
  const phone2 = 'hash_s5_b';
  simulateGenerate({ store, phoneHash: phone2, intent: { type: 'test', topic: 'Algebra' }, content: 'C' });
  const r3 = await simulateSaveB5({
    store,
    lockSet,
    phoneHash: phone2,
    saveResource: save,
    getSavedResourceByGenerationId: lookup,
    onLockAcquired: async () => {
      // Delete state entirely — simulates session expiry
      store.delete(phone2);
    },
  });
  assert(r3.action === 'cas_mismatch', 'S5-09: CAS mismatch when state deleted mid-save');
  assert(r3.currentId === null, 'S5-10: currentId is null when state was deleted');
  assert(!lockSet.has(phone2), 'S5-11: lock released after null-state CAS mismatch');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — Full consistency matrix
// A) DB success + WA success  → SAVED   (state cleared)
// B) DB success + WA fail     → RECOVERABLE
// C) DB fail                  → no mutation (GENERATED preserved, no row)
// D) WA delay + overwrite     → stale SAVE rejected (CAS)
// E) retry after RECOVERABLE  → no duplicate insert
// ─────────────────────────────────────────────────────────────────────────────
async function runSection6() {
  console.log('\n── S6: Full consistency matrix (A-E) ────────────────────────────────────────');
  _db = new DatabaseSync(':memory:');
  buildSchema(_db);
  const store = new MemorySessionStore();
  const lockSet = new Set();
  const save = makeInsertFn(_db);
  const lookup = makeLookupFn(_db);

  // A) DB+WA success → SAVED
  const phA = 'hash_s6_A';
  simulateGenerate({ store, phoneHash: phA, intent: { type: 'worksheet', topic: 'A' }, content: 'C' });
  const rA = await simulateSaveB5({ store, lockSet, phoneHash: phA, saveResource: save, getSavedResourceByGenerationId: lookup });
  assert(rA.action === 'saved', 'S6-A1: DB+WA success → action=saved');
  assert(rA.stateAfter === null, 'S6-A2: state cleared on SAVED');
  assert(countRows(_db, phA) === 1, 'S6-A3: exactly one DB row');

  // B) DB success + WA fail → RECOVERABLE
  const phB = 'hash_s6_B';
  simulateGenerate({ store, phoneHash: phB, intent: { type: 'test', topic: 'B' }, content: 'C' });
  const rB = await simulateSaveB5({ store, lockSet, phoneHash: phB, saveResource: save, getSavedResourceByGenerationId: lookup, whatsappShouldFail: true });
  assert(rB.action === 'failed', 'S6-B1: DB success + WA fail → action=failed');
  assert(rB.stateAfter.saveState === 'RECOVERABLE', 'S6-B2: state is RECOVERABLE');
  assert(typeof rB.stateAfter.lastSavedId === 'number', 'S6-B3: lastSavedId is set');
  assert(countRows(_db, phB) === 1, 'S6-B4: exactly one DB row despite WA fail');

  // C) DB fail → no mutation
  const phC = 'hash_s6_C';
  simulateGenerate({ store, phoneHash: phC, intent: { type: 'lessonPlan', topic: 'C' }, content: 'C' });
  const genC = store.get(phC).generationId;
  const rC = await simulateSaveB5({ store, lockSet, phoneHash: phC, saveResource: save, getSavedResourceByGenerationId: lookup, dbShouldFail: true });
  assert(rC.action === 'failed', 'S6-C1: DB fail → action=failed');
  assert(rC.stateAfter.saveState === 'GENERATED', 'S6-C2: state rolled back to GENERATED after DB fail');
  assert(rC.stateAfter.generationId === genC, 'S6-C3: generationId unchanged after DB fail');
  assert(countRows(_db, phC) === 0, 'S6-C4: no DB row on DB fail');

  // D) WA delay + overwrite → stale SAVE rejected (CAS)
  const phD = 'hash_s6_D';
  simulateGenerate({ store, phoneHash: phD, intent: { type: 'worksheet', topic: 'D-first' }, content: 'C1' });
  const genD1 = store.get(phD).generationId;
  const rD = await simulateSaveB5({
    store, lockSet, phoneHash: phD, saveResource: save, getSavedResourceByGenerationId: lookup,
    onLockAcquired: async () => {
      simulateGenerate({ store, phoneHash: phD, intent: { type: 'worksheet', topic: 'D-second' }, content: 'C2' });
    },
  });
  assert(rD.action === 'cas_mismatch', 'S6-D1: WA delay + overwrite → CAS mismatch');
  assert(countRows(_db, phD) === 0, 'S6-D2: no DB row for stale SAVE');
  // New generation is saveable
  const rD2 = await simulateSaveB5({ store, lockSet, phoneHash: phD, saveResource: save, getSavedResourceByGenerationId: lookup });
  assert(rD2.action === 'saved', 'S6-D3: new generation saves after CAS rejection');
  assert(countRows(_db, phD) === 1, 'S6-D4: exactly one row for D (second generation only)');

  // E) retry after RECOVERABLE → no duplicate insert
  const phE = 'hash_s6_E';
  simulateGenerate({ store, phoneHash: phE, intent: { type: 'test', topic: 'E' }, content: 'C' });
  // First SAVE: DB ok, WA fail → RECOVERABLE
  const rE1 = await simulateSaveB5({ store, lockSet, phoneHash: phE, saveResource: save, getSavedResourceByGenerationId: lookup, whatsappShouldFail: true });
  assert(rE1.stateAfter.saveState === 'RECOVERABLE', 'S6-E1: setup: RECOVERABLE after WA fail');
  // Retry SAVE: hits RECOVERABLE branch, no INSERT
  const rE2 = await simulateSaveB5({ store, lockSet, phoneHash: phE, saveResource: save, getSavedResourceByGenerationId: lookup });
  assert(rE2.action === 'reconfirmed', 'S6-E2: retry after RECOVERABLE → reconfirmed');
  assert(countRows(_db, phE) === 1, 'S6-E3: exactly one DB row after retry (no duplicate insert)');
  assert(rE2.stateAfter === null, 'S6-E4: state cleared after reconfirmation');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — State purity: spread creates new reference
// ─────────────────────────────────────────────────────────────────────────────
async function runSection7() {
  console.log('\n── S7: State purity — immutable spread, no in-place mutation ────────────────');
  _db = new DatabaseSync(':memory:');
  buildSchema(_db);
  const store = new MemorySessionStore();
  const lockSet = new Set();
  const save = makeInsertFn(_db);
  const lookup = makeLookupFn(_db);
  const phone = 'hash_s7_a';

  simulateGenerate({ store, phoneHash: phone, intent: { type: 'worksheet', topic: 'Purity' }, content: 'C' });
  const snapshot = store.get(phone);
  const snapshotRef = snapshot; // hold reference before any updates

  // SAVING tag is applied via Object.assign({}, last, ...) — original must not mutate
  // We test this by capturing state before and checking it after the SAVE cycle
  const originalGenId = snapshot.generationId;
  const originalSaveState = snapshot.saveState;
  const originalContent = snapshot.content;

  const r1 = await simulateSaveB5({ store, lockSet, phoneHash: phone, saveResource: save, getSavedResourceByGenerationId: lookup });
  assert(r1.action === 'saved', 'S7-01: SAVE succeeds (purity test setup)');

  // The reference we captured should not have been mutated
  assert(snapshotRef.saveState === originalSaveState, 'S7-02: captured reference saveState unchanged (GENERATED)');
  assert(snapshotRef.generationId === originalGenId, 'S7-03: captured reference generationId unchanged');
  assert(snapshotRef.content === originalContent, 'S7-04: captured reference content unchanged');

  // RECOVERABLE state update does not mutate the GENERATED snapshot
  const phone2 = 'hash_s7_b';
  simulateGenerate({ store, phoneHash: phone2, intent: { type: 'test', topic: 'ImmutTest' }, content: 'Test content' });
  const beforeSave = store.get(phone2);
  const beforeRef = beforeSave;

  await simulateSaveB5({ store, lockSet, phoneHash: phone2, saveResource: save, getSavedResourceByGenerationId: lookup, whatsappShouldFail: true });

  // The store now holds a RECOVERABLE object — but our reference to the original GENERATED object must be pristine
  assert(beforeRef.saveState === 'GENERATED', 'S7-05: original GENERATED object not mutated after RECOVERABLE tag');
  assert(beforeRef.lastSavedId === undefined, 'S7-06: original object has no lastSavedId (was not mutated)');

  // The store object and the original reference must be different objects
  const inStore = store.get(phone2);
  assert(inStore !== beforeRef, 'S7-07: store holds a new object (not the same reference as original)');
  assert(inStore.saveState === 'RECOVERABLE', 'S7-08: new store object has RECOVERABLE tag');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — generationId immutability through all state transitions
// ─────────────────────────────────────────────────────────────────────────────
async function runSection8() {
  console.log('\n── S8: generationId immutability through all transitions ────────────────────');
  _db = new DatabaseSync(':memory:');
  buildSchema(_db);
  const store = new MemorySessionStore();
  const lockSet = new Set();
  const save = makeInsertFn(_db);
  const lookup = makeLookupFn(_db);
  const phone = 'hash_s8_a';

  simulateGenerate({ store, phoneHash: phone, intent: { type: 'atp', topic: 'Term 3' }, content: 'C' });
  const genId = store.get(phone).generationId;

  // SAVING transition preserves generationId
  let genIdAtSaving = null;
  const r1 = await simulateSaveB5({
    store, lockSet, phoneHash: phone, saveResource: save, getSavedResourceByGenerationId: lookup,
    whatsappShouldFail: true, // stay at RECOVERABLE so we can inspect
    onLockAcquired: async () => {}, // no-op: no state overwrite
  });
  assert(r1.stateAtSaving.generationId === genId, 'S8-01: generationId preserved in SAVING state');
  assert(r1.stateAfter.generationId === genId, 'S8-02: generationId preserved in RECOVERABLE state');
  assert(r1.stateAfter.saveState === 'RECOVERABLE', 'S8-03: state is RECOVERABLE after WA fail');

  // New generation gets a different generationId
  const r2 = simulateGenerate({ store, phoneHash: phone, intent: { type: 'test', topic: 'New' }, content: 'C2' });
  assert(r2.generationId !== genId, 'S8-04: new generation mints a different generationId');

  // Two distinct rows when both generations are saved independently
  const phone2 = 'hash_s8_b';
  simulateGenerate({ store, phoneHash: phone2, intent: { type: 'worksheet', topic: 'Gen1' }, content: 'C' });
  const genId1 = store.get(phone2).generationId;
  await simulateSaveB5({ store, lockSet, phoneHash: phone2, saveResource: save, getSavedResourceByGenerationId: lookup });

  simulateGenerate({ store, phoneHash: phone2, intent: { type: 'worksheet', topic: 'Gen2' }, content: 'C' });
  const genId2 = store.get(phone2).generationId;
  await simulateSaveB5({ store, lockSet, phoneHash: phone2, saveResource: save, getSavedResourceByGenerationId: lookup });

  assert(genId1 !== genId2, 'S8-05: two generations have distinct generationIds');
  assert(countRows(_db, phone2) === 2, 'S8-06: two distinct DB rows for two generations');

  // generationId in DB row matches what was in session state at save time
  const row1 = _db.prepare(`SELECT generation_id FROM saved_resources WHERE phone_hash = ? ORDER BY id`).all(phone2)[0];
  const row2 = _db.prepare(`SELECT generation_id FROM saved_resources WHERE phone_hash = ? ORDER BY id`).all(phone2)[1];
  assert(row1.generation_id === genId1, 'S8-07: first DB row carries first generationId');
  assert(row2.generation_id === genId2, 'S8-08: second DB row carries second generationId');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9 — Integration: interleaved generation + SAVE sequences
// ─────────────────────────────────────────────────────────────────────────────
async function runSection9() {
  console.log('\n── S9: Integration — interleaved generation + SAVE ──────────────────────────');
  _db = new DatabaseSync(':memory:');
  buildSchema(_db);
  const store = new MemorySessionStore();
  const lockSet = new Set();
  const save = makeInsertFn(_db);
  const lookup = makeLookupFn(_db);
  const phone = 'hash_s9_a';

  // Interleave: Gen-A → SAVE-A → Gen-B → SAVE-B; each saves its own content
  simulateGenerate({ store, phoneHash: phone, intent: { type: 'worksheet', topic: 'Interleave-A' }, content: 'Content-A' });
  const genA = store.get(phone).generationId;
  const rA = await simulateSaveB5({ store, lockSet, phoneHash: phone, saveResource: save, getSavedResourceByGenerationId: lookup });
  assert(rA.action === 'saved', 'S9-01: Gen-A saved successfully');
  const rowA = _db.prepare(`SELECT title, generation_id FROM saved_resources WHERE generation_id = ?`).get(genA);
  assert(rowA !== null, 'S9-02: Gen-A row exists in DB');
  assert(rowA.title.includes('Interleave-A'), 'S9-03: Gen-A row has correct topic');

  simulateGenerate({ store, phoneHash: phone, intent: { type: 'test', topic: 'Interleave-B' }, content: 'Content-B' });
  const genB = store.get(phone).generationId;
  assert(genB !== genA, 'S9-04: Gen-B has different generationId than Gen-A');
  const rB = await simulateSaveB5({ store, lockSet, phoneHash: phone, saveResource: save, getSavedResourceByGenerationId: lookup });
  assert(rB.action === 'saved', 'S9-05: Gen-B saved successfully');
  assert(countRows(_db, phone) === 2, 'S9-06: two rows in DB (one per generation)');

  // Rapid Gen-A → Gen-B without saving Gen-A; only Gen-B is saveable
  const phone2 = 'hash_s9_b';
  simulateGenerate({ store, phoneHash: phone2, intent: { type: 'worksheet', topic: 'Rapid-A' }, content: 'C-A' });
  const genA2 = store.get(phone2).generationId;
  simulateGenerate({ store, phoneHash: phone2, intent: { type: 'test', topic: 'Rapid-B' }, content: 'C-B' });
  const genB2 = store.get(phone2).generationId;
  assert(genA2 !== genB2, 'S9-07: rapid overwrite produces new generationId');
  // Store now holds Gen-B; attempting to save inserts Gen-B row
  const rRapid = await simulateSaveB5({ store, lockSet, phoneHash: phone2, saveResource: save, getSavedResourceByGenerationId: lookup });
  assert(rRapid.action === 'saved', 'S9-08: latest generation (Rapid-B) saved successfully');
  assert(countRows(_db, phone2) === 1, 'S9-09: only one row — Gen-A was never inserted');
  const rapRow = _db.prepare(`SELECT title FROM saved_resources WHERE phone_hash = ?`).get(phone2);
  assert(rapRow.title.includes('Rapid-B'), 'S9-10: saved row is Gen-B not Gen-A');

  // Three-WA-fail retries then success on 4th (all via RECOVERABLE branch — no duplicate rows)
  const phone3 = 'hash_s9_c';
  simulateGenerate({ store, phoneHash: phone3, intent: { type: 'lessonPlan', topic: 'Triple-fail' }, content: 'C' });
  for (let i = 1; i <= 3; i++) {
    const r = await simulateSaveB5({ store, lockSet, phoneHash: phone3, saveResource: save, getSavedResourceByGenerationId: lookup, whatsappShouldFail: true });
    if (i === 1) assert(r.action === 'failed', `S9-11: WA fail #${i} from GENERATED path`);
    else assert(r.action === 'failed', `S9-12: WA fail #${i} from RECOVERABLE path`);
  }
  assert(countRows(_db, phone3) === 1, 'S9-13: exactly one DB row after three WA-fail retries');
  const r4 = await simulateSaveB5({ store, lockSet, phoneHash: phone3, saveResource: save, getSavedResourceByGenerationId: lookup });
  assert(r4.action === 'reconfirmed', 'S9-14: 4th attempt (RECOVERABLE) sends confirmation');
  assert(r4.stateAfter === null, 'S9-15: state cleared after reconfirmation');
  assert(countRows(_db, phone3) === 1, 'S9-16: still exactly one DB row after final confirmation');
}

// ─────────────────────────────────────────────────────────────────────────────
// Main runner
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  try {
    await runSection1();
    await runSection2();
    await runSection3();
    await runSection4();
    await runSection5();
    await runSection6();
    await runSection7();
    await runSection8();
    await runSection9();
  } catch (err) {
    console.error('\nUnexpected test runner error:', err);
    process.exitCode = 1;
  }

  console.log(`\n${'─'.repeat(55)}`);
  console.log(`Phase B5 Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
})();
