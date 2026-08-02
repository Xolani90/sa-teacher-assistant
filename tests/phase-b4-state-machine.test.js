'use strict';
/**
 * Phase B4 — SAVE State Machine Finalization
 *
 * Covers:
 *   1. saveState tagging — GENERATED set by processGeneration equivalent; RECOVERABLE set on DB commit
 *   2. Tag-based branching — RECOVERABLE branch triggered by saveState tag, not lastSavedId presence
 *   3. Malformed state guard — last exists but no generationId → IDLE treatment, state cleared
 *   4. RECOVERABLE overwrite warning — new generation while RECOVERABLE logs orphan info
 *   5. State transitions — IDLE→GENERATED, GENERATED→RECOVERABLE, RECOVERABLE→SAVED, all invariants
 *   6. Constraint violation recovery — session-loss scenario: UNIQUE violation → DB lookup → confirmation
 *   7. Stale SAVE rejection — saveState='GENERATED' does NOT trigger RECOVERABLE branch
 *   8. Identity consistency — generationId immutable once set; overwrite creates new ID
 *   9. Mixed failure scenarios — DB fail, WA fail, double fail, ordering variants
 *
 * Run:  node tests/phase-b4-state-machine.test.js
 */

// ── Real-migrations test DB (see tests/helpers/createTestDb.js) ──────────
const { createTestDb } = require('./helpers/createTestDb');
const testDb = createTestDb(__filename);
let _db = testDb.db;

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

// ── B4-aware SAVE lifecycle simulator ────────────────────────────────────────
// Replicates the B4-hardened SAVE handler using saveState tag branching,
// malformed state guard, and constraint-violation recovery.
//
// Returns: { action, resourceId, error, stateAfter }
//   action: 'saved' | 'reconfirmed' | 'nothing_to_save' | 'malformed_cleared' | 'constraint_recovered' | 'failed'
async function simulateSaveB4({
  store,
  phoneHash,
  saveResource,
  getSavedResourceByGenerationId,
  whatsappShouldFail = false,
  dbShouldFail = false,
  dbConstraintFail = false,
}) {
  const last = store.get(phoneHash);

  // IDLE
  if (!last) return { action: 'nothing_to_save', stateAfter: null };

  // RECOVERABLE branch — tag-based (B4-F4)
  if (last.saveState === 'RECOVERABLE') {
    if (whatsappShouldFail) {
      // Keep state — teacher retries later
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

  // GENERATED → proceed with DB write
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

  try {
    if (dbShouldFail) throw new Error('Simulated DB failure');
    if (dbConstraintFail) {
      const e = new Error('UNIQUE constraint failed: saved_resources.phone_hash, saved_resources.generation_id');
      e.code = 'SQLITE_CONSTRAINT_UNIQUE';
      throw e;
    }

    const saved = saveResource(phoneHash, last.intent.type, title, last.content, meta, last.generationId);

    // Tag RECOVERABLE before attempting WA (B4-F3)
    store.set(phoneHash, { ...last, saveState: 'RECOVERABLE', lastSavedId: saved.id });

    if (whatsappShouldFail) {
      return { action: 'failed', error: 'whatsapp_down', savedId: saved.id, stateAfter: store.get(phoneHash) };
    }

    store.delete(phoneHash);
    return { action: 'saved', resourceId: saved.id, stateAfter: null };
  } catch (err) {
    // B4-F6: constraint violation recovery path
    const isConstraint = err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
      (err.message && err.message.includes('UNIQUE constraint failed'));

    if (isConstraint && last.generationId) {
      const committed = getSavedResourceByGenerationId(last.generationId, phoneHash);
      if (committed) {
        store.set(phoneHash, { ...last, saveState: 'RECOVERABLE', lastSavedId: committed.id });
        if (whatsappShouldFail) {
          return { action: 'failed', error: 'constraint_recovered_wa_down', stateAfter: store.get(phoneHash) };
        }
        store.delete(phoneHash);
        return { action: 'constraint_recovered', resourceId: committed.id, stateAfter: null };
      }
    }

    // Generic failure — preserve state, teacher can retry
    return { action: 'failed', error: err.message, stateAfter: store.get(phoneHash) };
  }
}

// ── Simulate processGeneration ────────────────────────────────────────────────
// Mints a new GENERATED state, logging a warning if overwriting RECOVERABLE.
function simulateGenerate({ store, phoneHash, intent, content }) {
  const { randomUUID } = require('crypto');
  const existing = store.get(phoneHash);
  let overwroteRecoverable = false;
  let orphanedId = null;

  if (existing && existing.saveState === 'RECOVERABLE') {
    overwroteRecoverable = true;
    orphanedId = existing.lastSavedId;
    // production: console.warn(...) here
  }

  store.set(phoneHash, {
    generationId: randomUUID(),
    saveState: 'GENERATED',
    intent: {
      type:    intent.type    || 'worksheet',
      topic:   intent.topic   || null,
      grade:   intent.grade   || null,
      subject: intent.subject || null,
      term:    intent.term    || null,
    },
    content: content || 'Generated content',
    lastActivity: Date.now(),
  });

  return { overwroteRecoverable, orphanedId };
}

// ── Test runner ───────────────────────────────────────────────────────────────
async function run() {
  const { saveResource, getSavedResourceByGenerationId } = require('../services/teacherWorkspaceService');
  const { randomUUID } = require('crypto');

  const PHONE = 'b4test_hash_001';
  _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(PHONE);

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1: saveState tagging — GENERATED + RECOVERABLE lifecycle
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── Section 1: saveState tagging ────────────────────────────────────');
  {
    const store = new MemorySessionStore();
    const HASH = 'b4_s1_' + randomUUID().slice(0, 8);
    _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(HASH);

    // Generate → state should be GENERATED
    simulateGenerate({ store, phoneHash: HASH, intent: { type: 'worksheet', topic: 'Fractions', grade: 5, subject: 'Mathematics' }, content: 'content' });
    const genState = store.get(HASH);
    assertEq(genState.saveState, 'GENERATED', 'S1-01: processGeneration sets saveState=GENERATED');
    assert(!!genState.generationId, 'S1-02: generationId minted on GENERATED state');

    // SAVE → DB commits → state should flip to RECOVERABLE (WA fails)
    const r1 = await simulateSaveB4({ store, phoneHash: HASH, saveResource, getSavedResourceByGenerationId, whatsappShouldFail: true });
    const recState = store.get(HASH);
    assertEq(r1.action, 'failed', 'S1-03: SAVE returns failed when WA fails');
    assertEq(recState.saveState, 'RECOVERABLE', 'S1-04: state tagged RECOVERABLE after DB commit + WA fail');
    assert(recState.lastSavedId > 0, 'S1-05: lastSavedId set in RECOVERABLE state');
    assertEq(recState.generationId, genState.generationId, 'S1-06: generationId unchanged through GENERATED→RECOVERABLE');

    // Retry SAVE → RECOVERABLE branch → confirmation → state deleted
    const r2 = await simulateSaveB4({ store, phoneHash: HASH, saveResource, getSavedResourceByGenerationId });
    assertEq(r2.action, 'reconfirmed', 'S1-07: RECOVERABLE retry returns reconfirmed');
    assertEq(r2.resourceId, recState.lastSavedId, 'S1-08: reconfirmed uses correct resourceId');
    assert(store.get(HASH) === null, 'S1-09: state deleted after successful RECOVERABLE confirmation');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2: Tag-based branching — saveState !== 'RECOVERABLE' does not trigger retry path
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── Section 2: Tag-based branching correctness ──────────────────────');
  {
    const store = new MemorySessionStore();
    const HASH = 'b4_s2_' + randomUUID().slice(0, 8);
    _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(HASH);

    // Inject a state with lastSavedId but saveState='GENERATED' (old B3 style — must NOT hit RECOVERABLE branch)
    const gid = randomUUID();
    store.set(HASH, {
      generationId: gid,
      saveState: 'GENERATED',
      lastSavedId: 9999, // would trigger B3 branch; must NOT trigger B4 branch
      intent: { type: 'test', topic: 'Algebra', grade: 9, subject: 'Mathematics' },
      content: 'test content',
      lastActivity: Date.now(),
    });

    // Should proceed through normal INSERT path, not RECOVERABLE path
    const r = await simulateSaveB4({ store, phoneHash: HASH, saveResource, getSavedResourceByGenerationId });
    assertEq(r.action, 'saved', 'S2-01: GENERATED state with lastSavedId goes through INSERT (not RECOVERABLE branch)');
    assert(r.resourceId !== 9999, 'S2-02: new resourceId assigned — not the stale lastSavedId');

    // Verify row count = 1 for this phone+gid (no spurious second insert from B3-style path)
    const rows = _db.prepare(`SELECT COUNT(*) as c FROM saved_resources WHERE phone_hash=? AND generation_id=?`).get(HASH, gid);
    assertEq(rows.c, 1, 'S2-03: exactly one row inserted — B4 branch did not double-insert');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3: Malformed state guard
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── Section 3: Malformed state guard ───────────────────────────────');
  {
    const store = new MemorySessionStore();
    const HASH = 'b4_s3_' + randomUUID().slice(0, 8);
    _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(HASH);
    const countBefore = _db.prepare(`SELECT COUNT(*) as c FROM saved_resources WHERE phone_hash=?`).get(HASH).c;

    // Inject state with no generationId (corrupt state)
    store.set(HASH, {
      saveState: 'GENERATED',
      intent: { type: 'worksheet', topic: 'Fractions', grade: 5, subject: 'Mathematics' },
      content: 'corrupt state content',
      lastActivity: Date.now(),
    });

    const r = await simulateSaveB4({ store, phoneHash: HASH, saveResource, getSavedResourceByGenerationId });
    assertEq(r.action, 'malformed_cleared', 'S3-01: malformed state (no generationId) cleared');
    assert(store.get(HASH) === null, 'S3-02: state cleared after malformed guard fires');
    const countAfter = _db.prepare(`SELECT COUNT(*) as c FROM saved_resources WHERE phone_hash=?`).get(HASH).c;
    assertEq(countAfter, countBefore, 'S3-03: no DB row inserted for malformed state');

    // Null-generationId explicit variant
    const HASH2 = 'b4_s3b_' + randomUUID().slice(0, 8);
    _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(HASH2);
    store.set(HASH2, {
      generationId: null,
      saveState: 'GENERATED',
      intent: { type: 'lessonPlan', topic: 'Photosynthesis', grade: 10, subject: 'Life Sciences' },
      content: 'content',
      lastActivity: Date.now(),
    });
    const r2 = await simulateSaveB4({ store, phoneHash: HASH2, saveResource, getSavedResourceByGenerationId });
    assertEq(r2.action, 'malformed_cleared', 'S3-04: null generationId also triggers malformed guard');
    assert(store.get(HASH2) === null, 'S3-05: state cleared for null generationId case');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4: RECOVERABLE overwrite warning — orphaned row tracking
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── Section 4: RECOVERABLE overwrite warning ────────────────────────');
  {
    const store = new MemorySessionStore();
    const HASH = 'b4_s4_' + randomUUID().slice(0, 8);
    _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(HASH);

    // Generate → SAVE with WA fail → RECOVERABLE
    simulateGenerate({ store, phoneHash: HASH, intent: { type: 'worksheet', topic: 'Fractions', grade: 5, subject: 'Mathematics' } });
    const r1 = await simulateSaveB4({ store, phoneHash: HASH, saveResource, getSavedResourceByGenerationId, whatsappShouldFail: true });
    assertEq(r1.action, 'failed', 'S4-01: first WA fail puts state in RECOVERABLE');
    const recoverableState = store.get(HASH);
    assertEq(recoverableState.saveState, 'RECOVERABLE', 'S4-02: state is RECOVERABLE before overwrite');
    const orphanedResourceId = recoverableState.lastSavedId;

    // Teacher generates NEW content while RECOVERABLE — overwrite
    const { overwroteRecoverable, orphanedId } = simulateGenerate({
      store, phoneHash: HASH,
      intent: { type: 'test', topic: 'Quadratics', grade: 10, subject: 'Mathematics' },
    });
    assert(overwroteRecoverable, 'S4-03: simulateGenerate detects RECOVERABLE overwrite');
    assertEq(orphanedId, orphanedResourceId, 'S4-04: orphanedId matches the committed (but unconfirmed) resource');

    // New state is GENERATED (fresh)
    const newState = store.get(HASH);
    assertEq(newState.saveState, 'GENERATED', 'S4-05: new state after overwrite is GENERATED');
    assert(newState.generationId !== recoverableState.generationId, 'S4-06: new generationId minted on overwrite');
    assert(newState.lastSavedId === undefined, 'S4-07: lastSavedId not present in fresh GENERATED state');

    // Old DB row still exists (orphaned but committed)
    const orphanRow = _db.prepare(`SELECT id FROM saved_resources WHERE id=?`).get(orphanedResourceId);
    assert(!!orphanRow, 'S4-08: orphaned DB row still exists after overwrite');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5: Constraint violation recovery (session-loss scenario)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── Section 5: Constraint violation recovery ────────────────────────');
  {
    const store = new MemorySessionStore();
    const HASH = 'b4_s5_' + randomUUID().slice(0, 8);
    _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(HASH);

    // Simulate: row already committed to DB (e.g. from a previous server instance)
    const gid = randomUUID();
    const committed = saveResource(HASH, 'worksheet', 'Fractions — worksheet', 'content', { savedAt: new Date().toISOString() }, gid);
    const committedId = committed.id;

    // Session was lost — state is GENERATED (no lastSavedId) but same generationId
    store.set(HASH, {
      generationId: gid,
      saveState: 'GENERATED',
      intent: { type: 'worksheet', topic: 'Fractions', grade: 5, subject: 'Mathematics' },
      content: 'content',
      lastActivity: Date.now(),
    });

    // SAVE → INSERT hits UNIQUE constraint → should recover via DB lookup
    const r = await simulateSaveB4({ store, phoneHash: HASH, saveResource, getSavedResourceByGenerationId, dbConstraintFail: true });
    assertEq(r.action, 'constraint_recovered', 'S5-01: constraint violation detected and recovered');
    assertEq(r.resourceId, committedId, 'S5-02: recovered resourceId matches committed row');
    assert(store.get(HASH) === null, 'S5-03: state cleared after constraint recovery + WA success');

    // Verify no duplicate rows
    const rows = _db.prepare(`SELECT COUNT(*) as c FROM saved_resources WHERE phone_hash=? AND generation_id=?`).get(HASH, gid);
    assertEq(rows.c, 1, 'S5-04: exactly one row after constraint recovery — no duplicate');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 6: Constraint recovery with WA failure — RECOVERABLE preserved
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── Section 6: Constraint recovery + WA failure ─────────────────────');
  {
    const store = new MemorySessionStore();
    const HASH = 'b4_s6_' + randomUUID().slice(0, 8);
    _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(HASH);

    const gid = randomUUID();
    const committed = saveResource(HASH, 'test', 'Algebra — test', 'content', { savedAt: new Date().toISOString() }, gid);

    store.set(HASH, {
      generationId: gid,
      saveState: 'GENERATED',
      intent: { type: 'test', topic: 'Algebra', grade: 9, subject: 'Mathematics' },
      content: 'content',
      lastActivity: Date.now(),
    });

    // Constraint fires AND WA fails
    const r = await simulateSaveB4({ store, phoneHash: HASH, saveResource, getSavedResourceByGenerationId, dbConstraintFail: true, whatsappShouldFail: true });
    assertEq(r.action, 'failed', 'S6-01: constraint_recovered+WA_fail returns failed');
    assertEq(r.error, 'constraint_recovered_wa_down', 'S6-02: error signals constraint_recovered_wa_down');

    const stateAfter = store.get(HASH);
    assertEq(stateAfter.saveState, 'RECOVERABLE', 'S6-03: state is RECOVERABLE after constraint_recovery+WA_fail');
    assertEq(stateAfter.lastSavedId, committed.id, 'S6-04: RECOVERABLE state has correct lastSavedId');

    // Next retry uses standard RECOVERABLE branch
    const r2 = await simulateSaveB4({ store, phoneHash: HASH, saveResource, getSavedResourceByGenerationId });
    assertEq(r2.action, 'reconfirmed', 'S6-05: follow-up SAVE uses RECOVERABLE branch → reconfirmed');
    assert(store.get(HASH) === null, 'S6-06: state cleared after RECOVERABLE→SAVED');

    // Still only one row
    const rows = _db.prepare(`SELECT COUNT(*) as c FROM saved_resources WHERE phone_hash=? AND generation_id=?`).get(HASH, gid);
    assertEq(rows.c, 1, 'S6-07: exactly one row after full constraint-recovery cycle');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 7: Identity consistency — generationId immutable once set
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── Section 7: Identity consistency ────────────────────────────────');
  {
    const store = new MemorySessionStore();
    const HASH = 'b4_s7_' + randomUUID().slice(0, 8);
    _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(HASH);

    simulateGenerate({ store, phoneHash: HASH, intent: { type: 'worksheet', topic: 'T1' } });
    const gid1 = store.get(HASH).generationId;

    // WA fail → RECOVERABLE
    await simulateSaveB4({ store, phoneHash: HASH, saveResource, getSavedResourceByGenerationId, whatsappShouldFail: true });
    const recState = store.get(HASH);
    assertEq(recState.generationId, gid1, 'S7-01: generationId unchanged in RECOVERABLE state');

    // Retry confirm → deleted
    await simulateSaveB4({ store, phoneHash: HASH, saveResource, getSavedResourceByGenerationId });
    assert(store.get(HASH) === null, 'S7-02: state deleted after RECOVERED→SAVED');

    // New generation gets a new ID
    simulateGenerate({ store, phoneHash: HASH, intent: { type: 'test', topic: 'T2' } });
    const gid2 = store.get(HASH).generationId;
    assert(gid2 !== gid1, 'S7-03: new generation gets a different generationId');

    // Verify two distinct DB rows
    const rows = _db.prepare(`SELECT generation_id FROM saved_resources WHERE phone_hash=?`).all(HASH);
    const gids = rows.map(r => r.generation_id);
    assert(gids.includes(gid1), 'S7-04: first generationId committed to DB');

    // Save the second generation
    await simulateSaveB4({ store, phoneHash: HASH, saveResource, getSavedResourceByGenerationId });
    const rows2 = _db.prepare(`SELECT generation_id FROM saved_resources WHERE phone_hash=?`).all(HASH);
    const gids2 = rows2.map(r => r.generation_id);
    assert(gids2.includes(gid2), 'S7-05: second generationId committed to DB');
    assertEq(rows2.length, 2, 'S7-06: exactly two rows — one per distinct generationId');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 8: IDLE and stale state safety
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── Section 8: IDLE and stale state safety ──────────────────────────');
  {
    const store = new MemorySessionStore();
    const HASH = 'b4_s8_' + randomUUID().slice(0, 8);
    _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(HASH);
    const countBefore = _db.prepare(`SELECT COUNT(*) as c FROM saved_resources`).get().c;

    // SAVE from IDLE → nothing_to_save
    const r1 = await simulateSaveB4({ store, phoneHash: HASH, saveResource, getSavedResourceByGenerationId });
    assertEq(r1.action, 'nothing_to_save', 'S8-01: SAVE from IDLE returns nothing_to_save');

    // Double SAVE from IDLE
    const r2 = await simulateSaveB4({ store, phoneHash: HASH, saveResource, getSavedResourceByGenerationId });
    assertEq(r2.action, 'nothing_to_save', 'S8-02: second SAVE from IDLE also returns nothing_to_save');
    const countAfter = _db.prepare(`SELECT COUNT(*) as c FROM saved_resources`).get().c;
    assertEq(countAfter, countBefore, 'S8-03: no rows inserted from IDLE SAVE attempts');

    // Generate then immediately overwrite — SAVE targets only the newest gid
    simulateGenerate({ store, phoneHash: HASH, intent: { type: 'worksheet', topic: 'Old' } });
    const oldGid = store.get(HASH).generationId;
    simulateGenerate({ store, phoneHash: HASH, intent: { type: 'test', topic: 'New' } });
    const newGid = store.get(HASH).generationId;
    assert(oldGid !== newGid, 'S8-04: overwrite produces new generationId');

    const r3 = await simulateSaveB4({ store, phoneHash: HASH, saveResource, getSavedResourceByGenerationId });
    assertEq(r3.action, 'saved', 'S8-05: SAVE after overwrite succeeds');
    const savedRow = _db.prepare(`SELECT generation_id FROM saved_resources WHERE id=?`).get(r3.resourceId);
    assertEq(savedRow.generation_id, newGid, 'S8-06: SAVE committed the newest generationId');
    const oldRow = _db.prepare(`SELECT id FROM saved_resources WHERE generation_id=?`).get(oldGid);
    assert(!oldRow, 'S8-07: old generationId not in DB — overwrite is the only committed generation');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 9: Mixed failure ordering — DB fail, WA fail, double WA fail
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── Section 9: Mixed failure ordering ──────────────────────────────');
  {
    const store = new MemorySessionStore();
    const HASH = 'b4_s9_' + randomUUID().slice(0, 8);
    _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(HASH);

    // DB fail → state preserved in GENERATED (no RECOVERABLE, no lastSavedId)
    simulateGenerate({ store, phoneHash: HASH, intent: { type: 'worksheet', topic: 'DB Fail Test' } });
    const genGid = store.get(HASH).generationId;
    const r1 = await simulateSaveB4({ store, phoneHash: HASH, saveResource, getSavedResourceByGenerationId, dbShouldFail: true });
    assertEq(r1.action, 'failed', 'S9-01: DB failure returns failed');
    const stateAfterDbFail = store.get(HASH);
    assertEq(stateAfterDbFail.saveState, 'GENERATED', 'S9-02: state remains GENERATED after DB failure (not RECOVERABLE)');
    assert(!stateAfterDbFail.lastSavedId, 'S9-03: no lastSavedId set after DB failure');
    const noRow = _db.prepare(`SELECT id FROM saved_resources WHERE generation_id=?`).get(genGid);
    assert(!noRow, 'S9-04: no DB row after DB failure');

    // Retry after DB fail (DB now works) — should succeed normally
    const r2 = await simulateSaveB4({ store, phoneHash: HASH, saveResource, getSavedResourceByGenerationId });
    assertEq(r2.action, 'saved', 'S9-05: retry after DB failure succeeds when DB recovers');
    assert(store.get(HASH) === null, 'S9-06: state cleared after successful retry');
    const row = _db.prepare(`SELECT generation_id FROM saved_resources WHERE id=?`).get(r2.resourceId);
    assertEq(row.generation_id, genGid, 'S9-07: committed row carries correct generationId');

    // WA fail × 3 → each time still RECOVERABLE, still one row
    const HASH2 = 'b4_s9b_' + randomUUID().slice(0, 8);
    _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(HASH2);
    simulateGenerate({ store, phoneHash: HASH2, intent: { type: 'lessonPlan', topic: 'Triple WA Fail' } });
    const gid9b = store.get(HASH2).generationId;

    const ra = await simulateSaveB4({ store, phoneHash: HASH2, saveResource, getSavedResourceByGenerationId, whatsappShouldFail: true });
    assertEq(ra.action, 'failed', 'S9-08: first WA fail returns failed');
    assertEq(store.get(HASH2).saveState, 'RECOVERABLE', 'S9-09: RECOVERABLE after first WA fail');

    const rb = await simulateSaveB4({ store, phoneHash: HASH2, saveResource, getSavedResourceByGenerationId, whatsappShouldFail: true });
    assertEq(rb.action, 'failed', 'S9-10: second WA fail returns failed (RECOVERABLE branch)');
    assertEq(store.get(HASH2).saveState, 'RECOVERABLE', 'S9-11: still RECOVERABLE after second WA fail');

    const rc = await simulateSaveB4({ store, phoneHash: HASH2, saveResource, getSavedResourceByGenerationId, whatsappShouldFail: true });
    assertEq(rc.action, 'failed', 'S9-12: third WA fail returns failed (RECOVERABLE branch)');

    // Exactly one row throughout all three retries
    const rowCount = _db.prepare(`SELECT COUNT(*) as c FROM saved_resources WHERE phone_hash=? AND generation_id=?`).get(HASH2, gid9b);
    assertEq(rowCount.c, 1, 'S9-13: exactly one DB row after three WA-fail retries');

    // Finally succeeds on 4th attempt
    const rd = await simulateSaveB4({ store, phoneHash: HASH2, saveResource, getSavedResourceByGenerationId });
    assertEq(rd.action, 'reconfirmed', 'S9-14: fourth attempt (RECOVERABLE branch) sends confirmation');
    assert(store.get(HASH2) === null, 'S9-15: state cleared after final confirmation');
  }

  // ── Final result ─────────────────────────────────────────────────────────
  console.log('\n───────────────────────────────────────────────────────');
  console.log(`Phase B4 Results: ${passed} passed, ${failed} failed`);

  testDb.cleanup();
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
