'use strict';
/**
 * Phase C2 — RECOVERABLE branch lock-guard regression test
 *
 * Confirmed defect (Phase C audit): the RECOVERABLE branch in the SAVE
 * handler was not guarded by saveLock. A second SAVE call landing while the
 * first call's post-commit WhatsApp send was still in flight would read
 * saveState === 'RECOVERABLE' (already written synchronously before the
 * send), enter the RECOVERABLE branch (which has no lock check), and send a
 * second "Saved!" confirmation for the SAME already-committed resource.
 *
 * No duplicate DB row was ever produced (the unique index + synchronous
 * transaction already prevented that) — the defect was specifically a
 * duplicate confirmation message reaching the teacher.
 *
 * Fix: saveLock is now checked once, before BOTH the RECOVERABLE branch and
 * the GENERATED→INSERT path, and the RECOVERABLE branch now acquires/
 * releases the lock around its own await.
 *
 * This test uses REAL async timing (setTimeout-based fake WhatsApp send) to
 * force genuine event-loop interleaving between two concurrent SAVE calls —
 * unlike the phase-b5-concurrency.test.js simulator, which models
 * whatsappShouldFail as a synchronous boolean and therefore cannot express
 * "call B lands while call A is suspended at its await".
 *
 * Run: node tests/phase-c2-recoverable-lock.test.js
 */

const { DatabaseSync } = require('node:sqlite');

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

function buildDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE saved_resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash TEXT NOT NULL,
      generation_id TEXT
    );
    CREATE UNIQUE INDEX idx_gen
      ON saved_resources(phone_hash, generation_id)
      WHERE generation_id IS NOT NULL;
  `);
  return db;
}

// ── Fixed-shape SAVE simulator ──────────────────────────────────────────────
// Mirrors the POST-FIX control flow in routes/webhook.js exactly:
//   1. saveLock checked ONCE, before both RECOVERABLE and GENERATED branches
//   2. RECOVERABLE branch acquires/releases the lock around its own await
//   3. GENERATED branch acquires/releases the lock around its own await (unchanged from B5)
async function simulateSaveFixed({ store, lockSet, phoneHash, db, fakeSend, sentLog, label }) {
  const last = store.get(phoneHash);
  if (!last) return { action: 'nothing_to_save' };

  // C2 fix: single lock check covering both branches below.
  if (lockSet.has(phoneHash)) {
    return { action: 'concurrent_blocked' };
  }

  if (last.saveState === 'RECOVERABLE') {
    lockSet.add(phoneHash);
    try {
      await fakeSend(`${label}:reconfirm:${last.lastSavedId}`);
      sentLog.push(`${label}:reconfirm:${last.lastSavedId}`);
      store.delete(phoneHash);
      return { action: 'reconfirmed', resourceId: last.lastSavedId };
    } finally {
      lockSet.delete(phoneHash);
    }
  }

  if (last.saveState !== 'GENERATED') return { action: 'illegal_transition' };

  lockSet.add(phoneHash);
  try {
    store.set(phoneHash, Object.assign({}, last, { saveState: 'SAVING' }));
    const stmt = db.prepare(`INSERT INTO saved_resources (phone_hash, generation_id) VALUES (?, ?)`);
    const r = stmt.run(phoneHash, last.generationId);
    const savedId = Number(r.lastInsertRowid);
    store.set(phoneHash, Object.assign({}, last, { saveState: 'RECOVERABLE', lastSavedId: savedId }));

    await fakeSend(`${label}:initial:${savedId}`);
    sentLog.push(`${label}:initial:${savedId}`);

    store.delete(phoneHash);
    return { action: 'saved', resourceId: savedId };
  } finally {
    lockSet.delete(phoneHash);
  }
}

// ── Pre-fix simulator, kept ONLY to prove the test actually detects the
// regression it claims to detect (i.e. this test fails against the old shape).
async function simulateSaveUnfixed({ store, lockSet, phoneHash, db, fakeSend, sentLog, label }) {
  const last = store.get(phoneHash);
  if (!last) return { action: 'nothing_to_save' };

  // Pre-fix shape: RECOVERABLE branch checked BEFORE the lock, and never
  // touches lockSet at all.
  if (last.saveState === 'RECOVERABLE') {
    await fakeSend(`${label}:reconfirm:${last.lastSavedId}`);
    sentLog.push(`${label}:reconfirm:${last.lastSavedId}`);
    store.delete(phoneHash);
    return { action: 'reconfirmed', resourceId: last.lastSavedId };
  }

  if (last.saveState !== 'GENERATED') return { action: 'illegal_transition' };
  if (lockSet.has(phoneHash)) return { action: 'concurrent_blocked' };

  lockSet.add(phoneHash);
  try {
    store.set(phoneHash, Object.assign({}, last, { saveState: 'SAVING' }));
    const stmt = db.prepare(`INSERT INTO saved_resources (phone_hash, generation_id) VALUES (?, ?)`);
    const r = stmt.run(phoneHash, last.generationId);
    const savedId = Number(r.lastInsertRowid);
    store.set(phoneHash, Object.assign({}, last, { saveState: 'RECOVERABLE', lastSavedId: savedId }));

    await fakeSend(`${label}:initial:${savedId}`);
    sentLog.push(`${label}:initial:${savedId}`);

    store.delete(phoneHash);
    return { action: 'saved', resourceId: savedId };
  } finally {
    lockSet.delete(phoneHash);
  }
}

function makeFakeSend(delayMs = 15) {
  return function fakeSend(label) {
    return new Promise(resolve => setTimeout(resolve, delayMs));
  };
}

async function runInterleavedScenario(simulateFn) {
  const db = buildDb();
  const store = new Map();
  const lockSet = new Set();
  const phoneHash = 'phone-c2-test';
  const sentLog = [];
  const fakeSend = makeFakeSend(15);

  store.set(phoneHash, { generationId: 'gen-c2-1', saveState: 'GENERATED' });

  // Call A starts first.
  const callA = simulateFn({ store, lockSet, phoneHash, db, fakeSend, sentLog, label: 'A' });
  // Let Call A run synchronously up to its first await (DB commit already
  // happened by this point — saveState is now RECOVERABLE in the store).
  await new Promise(r => setImmediate(r));
  // Call B now lands while Call A is suspended inside fakeSend(), exactly
  // like a second WhatsApp message arriving moments after the first.
  const callB = simulateFn({ store, lockSet, phoneHash, db, fakeSend, sentLog, label: 'B' });

  const [resA, resB] = await Promise.all([callA, callB]);

  const rowCount = db.prepare(`SELECT COUNT(*) AS n FROM saved_resources WHERE phone_hash = ?`).get(phoneHash).n;
  return { resA, resB, sentLog, rowCount };
}

(async () => {
  console.log('\n── C2: RECOVERABLE branch must be lock-guarded ──────────────────────────');

  // ── Test 1: the FIXED shape must produce exactly ONE confirmation send ──
  const fixedResult = await runInterleavedScenario(simulateSaveFixed);
  assert(fixedResult.rowCount === 1, 'C2-01: exactly one DB row (fixed shape)');
  assert(fixedResult.sentLog.length === 1, 'C2-02: fixed shape sends exactly ONE confirmation, not two');
  assert(
    fixedResult.resA.action === 'concurrent_blocked' || fixedResult.resB.action === 'concurrent_blocked',
    'C2-03: one of the two concurrent calls is rejected as concurrent_blocked'
  );

  // ── Test 2: sanity check — the OLD (unfixed) shape, run the identical
  // scenario, must reproduce the double-send. This proves the test harness
  // itself is capable of detecting the regression, not just rubber-stamping
  // the fix.
  const unfixedResult = await runInterleavedScenario(simulateSaveUnfixed);
  assert(unfixedResult.rowCount === 1, 'C2-04: unfixed shape still has no duplicate DB row (separate guarantee, unaffected)');
  assert(unfixedResult.sentLog.length === 2, 'C2-05: sanity check — unfixed shape DOES double-send (proves this harness detects the real defect)');

  console.log('\n─────────────────────────────────');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total:  ${passed + failed}`);
  console.log('─────────────────────────────────\n');

  process.exit(failed > 0 ? 1 : 0);
})();
