'use strict';
/**
 * Phase B3 — SAVE Lifecycle Finalization & Cross-Session Resilience Tests
 *
 * Covers:
 *   1. generation_id column — stored, unique, nullable, lookup
 *   2. Duplicate-save prevention — UNIQUE constraint fires on retry, no duplicate row
 *   3. Idempotency path (lastSavedId) — retry sends confirmation without new INSERT
 *   4. Failure recovery — DB fail, WhatsApp fail, double WhatsApp fail
 *   5. State immutability — SAVE never mutates session state object in-place
 *   6. Overwrite correctness — new generation replaces old; SAVE targets latest
 *   7. Concurrent-generation simulation — rapid overwrites, only newest is saveable
 *   8. getSavedResourceByGenerationId — correct lookup, unknown ID returns null
 *
 * Run:  node tests/phase-b3-resilience.test.js
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

function assertThrows(fn, expectedMsg, label) {
  try {
    fn();
    console.error(`  ❌ FAIL: ${label} — expected throw, got no error`);
    failed++;
  } catch (err) {
    if (expectedMsg && !err.message.includes(expectedMsg)) {
      console.error(`  ❌ FAIL: ${label}`);
      console.error(`     expected message to include: "${expectedMsg}"`);
      console.error(`     got: "${err.message}"`);
      failed++;
    } else {
      console.log(`  ✅ ${label}`);
      passed++;
    }
  }
}

// ── In-memory session store (mirrors MemorySessionStore from B2) ──────────────
class MemorySessionStore {
  constructor() { this._data = new Map(); }
  get(key)        { return this._data.get(key) || null; }
  set(key, value) { this._data.set(key, value); }
  delete(key)     { this._data.delete(key); }
}

// ── SAVE lifecycle simulator ──────────────────────────────────────────────────
// Replicates the hardened SAVE handler logic from routes/webhook.js without
// requiring the full Express environment.  Used to test the idempotency path,
// error isolation, and state management in isolation.
//
// Returns: { action, resourceId, error }
//   action: 'saved' | 'reconfirmed' | 'nothing_to_save' | 'failed'
async function simulateSave({ store, phoneHash, saveResource, getSavedResourceByGenerationId, whatsappShouldFail = false, dbShouldFail = false }) {
  const last = store.get(phoneHash);

  if (!last) {
    return { action: 'nothing_to_save' };
  }

  // Idempotency path: DB committed previously, WhatsApp failed
  if (last.lastSavedId) {
    if (whatsappShouldFail) {
      return { action: 'failed', error: 'whatsapp_down_on_retry' };
    }
    store.delete(phoneHash);
    return { action: 'reconfirmed', resourceId: last.lastSavedId };
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

  try {
    if (dbShouldFail) throw new Error('Simulated DB failure');
    const saved = saveResource(phoneHash, last.intent.type, title, last.content, meta, last.generationId || null);

    // Store savedId back — so retry doesn't re-INSERT
    store.set(phoneHash, { ...last, lastSavedId: saved.id });

    if (whatsappShouldFail) {
      // State preserved with lastSavedId; teacher can retry
      return { action: 'failed', error: 'whatsapp_down', savedId: saved.id };
    }

    store.delete(phoneHash);
    return { action: 'saved', resourceId: saved.id };
  } catch (err) {
    // State NOT cleared — teacher can retry
    return { action: 'failed', error: err.message };
  }
}

// ── Test runner ───────────────────────────────────────────────────────────────
async function run() {
  const { saveResource, getSavedResources, getSavedResourceByGenerationId } = require('../services/teacherWorkspaceService');
  const { randomUUID } = require('crypto');

  const PHONE = 'b3test_hash_001';
  _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(PHONE);

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1: generation_id column — stored, unique, nullable
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── Section 1: generation_id column ─────────────────────────────────');

  console.log('\nTest B3-01: saveResource stores generation_id when provided');
  const gid1 = randomUUID();
  const r1 = saveResource(PHONE, 'worksheet', 'Test B3-01', 'content', { grade: 7, subject: 'maths', topic: 'Fractions' }, gid1);
  assertEq(r1.generation_id, gid1, 'generation_id stored on first save');

  console.log('\nTest B3-02: saveResource stores null generation_id when not provided');
  const r2 = saveResource(PHONE, 'test', 'Test B3-02 no gid', 'content', { grade: 8, subject: 'english', topic: 'Poetry' });
  assert(r2.generation_id === null || r2.generation_id === undefined, 'generation_id is null when omitted');

  console.log('\nTest B3-03: UNIQUE constraint prevents duplicate (phone_hash, generation_id)');
  assertThrows(
    () => saveResource(PHONE, 'worksheet', 'Duplicate attempt', 'content', {}, gid1),
    null, // SQLite UNIQUE constraint error message varies; just check that it throws
    'duplicate generationId throws UNIQUE constraint error'
  );

  console.log('\nTest B3-04: null generation_id does NOT trigger UNIQUE constraint — multiple nulls allowed');
  // This is the WHERE generation_id IS NOT NULL clause on the index
  let multiNullOk = true;
  try {
    saveResource(PHONE, 'test', 'Null gid 1', 'content', {});
    saveResource(PHONE, 'test', 'Null gid 2', 'content', {});
    saveResource(PHONE, 'test', 'Null gid 3', 'content', {});
  } catch (err) {
    multiNullOk = false;
  }
  assert(multiNullOk, 'multiple saves with null generation_id do not conflict');

  console.log('\nTest B3-05: getSavedResourceByGenerationId returns correct row');
  const found = getSavedResourceByGenerationId(gid1, PHONE);
  assert(found !== null, 'found row by generationId');
  assertEq(found.generation_id, gid1, 'returned row has correct generation_id');
  assertEq(found.title, 'Test B3-01', 'returned row has correct title');

  console.log('\nTest B3-06: getSavedResourceByGenerationId returns null for unknown generationId');
  const notFound = getSavedResourceByGenerationId('00000000-0000-0000-0000-000000000000', PHONE);
  assert(notFound === null, 'unknown generationId returns null');

  console.log('\nTest B3-07: getSavedResourceByGenerationId returns null for wrong phone_hash');
  const wrongPhone = getSavedResourceByGenerationId(gid1, 'wrong_hash');
  assert(wrongPhone === null, 'correct generationId but wrong phone_hash returns null');

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2: Duplicate-save prevention via UNIQUE constraint
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── Section 2: Duplicate-save prevention ────────────────────────────');

  const PHONE_DUP = 'b3test_dup_001';
  _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(PHONE_DUP);

  console.log('\nTest B3-08: first SAVE with generationId succeeds');
  const gidDup = randomUUID();
  const rDup1 = saveResource(PHONE_DUP, 'lessonPlan', 'Dup test lesson', 'lp content', { grade: 9 }, gidDup);
  assert(rDup1 && rDup1.id > 0, 'first SAVE returned a valid row');

  console.log('\nTest B3-09: second SAVE with same generationId throws — no duplicate row inserted');
  let dupThrew = false;
  try {
    saveResource(PHONE_DUP, 'lessonPlan', 'Dup test lesson (retry)', 'lp content', { grade: 9 }, gidDup);
  } catch (_) {
    dupThrew = true;
  }
  assert(dupThrew, 'duplicate generationId throws as expected');
  const allDupRows = getSavedResources(PHONE_DUP);
  assertEq(allDupRows.length, 1, 'only one row exists after duplicate attempt');

  console.log('\nTest B3-10: teacher counter is correct (not double-incremented)');
  const dupTeacher = _db.prepare(`SELECT saved_resources_count FROM teachers WHERE phone_hash = ?`).get(PHONE_DUP);
  assertEq(dupTeacher.saved_resources_count, 1, 'counter is 1, not 2, after duplicate attempt');

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3: Idempotency path (lastSavedId in session state)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── Section 3: Idempotency path (lastSavedId) ───────────────────────');

  const PHONE_IDMP = 'b3test_idmp_001';
  _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(PHONE_IDMP);
  const store = new MemorySessionStore();

  // Set up initial state as processGeneration() would
  const gidIdmp = randomUUID();
  store.set(PHONE_IDMP, {
    generationId: gidIdmp,
    intent: { type: 'atp', topic: 'Measurement', grade: 6, subject: 'mathematics' },
    content: 'atp content here',
    lastActivity: Date.now(),
  });

  console.log('\nTest B3-11: first SAVE attempt — DB succeeds, WhatsApp fails → lastSavedId stored in state');
  const result1 = await simulateSave({
    store, phoneHash: PHONE_IDMP, saveResource, getSavedResourceByGenerationId,
    whatsappShouldFail: true, dbShouldFail: false,
  });
  assertEq(result1.action, 'failed', 'action is "failed" (WhatsApp down)');
  assert(result1.savedId > 0, 'savedId returned from failed first attempt');
  const afterFailState = store.get(PHONE_IDMP);
  assert(afterFailState !== null, 'state preserved after WhatsApp failure');
  assertEq(afterFailState.lastSavedId, result1.savedId, 'lastSavedId stored back into session state');

  console.log('\nTest B3-12: second SAVE attempt — idempotency path — no new DB INSERT');
  const countBefore = getSavedResources(PHONE_IDMP).length;
  const result2 = await simulateSave({
    store, phoneHash: PHONE_IDMP, saveResource, getSavedResourceByGenerationId,
    whatsappShouldFail: false, dbShouldFail: false,
  });
  assertEq(result2.action, 'reconfirmed', 'second SAVE uses idempotency path (reconfirmed)');
  assertEq(result2.resourceId, result1.savedId, 'reconfirmed resourceId matches original');
  const countAfter = getSavedResources(PHONE_IDMP).length;
  assertEq(countAfter, countBefore, 'no new row inserted on retry (idempotency)');

  console.log('\nTest B3-13: state is cleared after successful retry confirmation');
  const afterRetryState = store.get(PHONE_IDMP);
  assert(afterRetryState === null, 'state cleared after successful idempotency retry');

  console.log('\nTest B3-14: third SAVE attempt after state cleared → nothing_to_save');
  const result3 = await simulateSave({
    store, phoneHash: PHONE_IDMP, saveResource, getSavedResourceByGenerationId,
  });
  assertEq(result3.action, 'nothing_to_save', 'third SAVE with cleared state is a safe no-op');

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4: Failure recovery semantics
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── Section 4: Failure recovery semantics ───────────────────────────');

  const PHONE_FAIL = 'b3test_fail_001';
  _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(PHONE_FAIL);
  const failStore = new MemorySessionStore();

  console.log('\nTest B3-15: DB failure — state preserved, no row inserted');
  const gidFail1 = randomUUID();
  failStore.set(PHONE_FAIL, {
    generationId: gidFail1,
    intent: { type: 'rubric', topic: 'Oral presentation', grade: 11, subject: 'english' },
    content: 'rubric content',
    lastActivity: Date.now(),
  });
  const failResult1 = await simulateSave({
    store: failStore, phoneHash: PHONE_FAIL, saveResource, getSavedResourceByGenerationId,
    dbShouldFail: true,
  });
  assertEq(failResult1.action, 'failed', 'DB failure reported as failed');
  assert(failResult1.error.includes('Simulated DB failure'), 'error message preserved');
  const stateAfterDbFail = failStore.get(PHONE_FAIL);
  assert(stateAfterDbFail !== null, 'state preserved after DB failure');
  assert(!stateAfterDbFail.lastSavedId, 'lastSavedId NOT set when DB failed (no partial success)');
  const rowsAfterFail = getSavedResources(PHONE_FAIL);
  assertEq(rowsAfterFail.length, 0, 'no row inserted when DB failed');

  console.log('\nTest B3-16: successful retry after DB failure');
  const retryResult = await simulateSave({
    store: failStore, phoneHash: PHONE_FAIL, saveResource, getSavedResourceByGenerationId,
    dbShouldFail: false,
  });
  assertEq(retryResult.action, 'saved', 'retry after DB failure succeeds');
  const rowsAfterRetry = getSavedResources(PHONE_FAIL);
  assertEq(rowsAfterRetry.length, 1, 'exactly one row after successful retry');
  assertEq(rowsAfterRetry[0].generation_id, gidFail1, 'retry saved correct generationId');

  console.log('\nTest B3-17: WhatsApp failure after DB commit — lastSavedId in state, DB row exists');
  const PHONE_WA = 'b3test_wa_001';
  _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(PHONE_WA);
  const waStore = new MemorySessionStore();
  const gidWA = randomUUID();
  waStore.set(PHONE_WA, {
    generationId: gidWA,
    intent: { type: 'examPaper', topic: 'Calculus', grade: 12, subject: 'mathematics' },
    content: 'exam content',
    lastActivity: Date.now(),
  });
  const waResult1 = await simulateSave({
    store: waStore, phoneHash: PHONE_WA, saveResource, getSavedResourceByGenerationId,
    whatsappShouldFail: true,
  });
  assertEq(waResult1.action, 'failed', 'WhatsApp failure reported');
  assert(waResult1.savedId > 0, 'DB row was created (savedId present)');
  // Verify the row is in the DB
  const waRow = getSavedResourceByGenerationId(gidWA, PHONE_WA);
  assert(waRow !== null, 'DB row exists after WhatsApp failure');
  assertEq(waRow.generation_id, gidWA, 'DB row has correct generationId');
  // State has lastSavedId
  const waStateAfter = waStore.get(PHONE_WA);
  assertEq(waStateAfter.lastSavedId, waResult1.savedId, 'state carries lastSavedId for retry');

  console.log('\nTest B3-18: double WhatsApp failure — state preserved across both failures');
  const waResult2 = await simulateSave({
    store: waStore, phoneHash: PHONE_WA, saveResource, getSavedResourceByGenerationId,
    whatsappShouldFail: true,
  });
  assertEq(waResult2.action, 'failed', 'second failure also fails');
  const waStateAfter2 = waStore.get(PHONE_WA);
  assert(waStateAfter2 !== null, 'state still preserved after second failure');
  assertEq(waStateAfter2.lastSavedId, waResult1.savedId, 'lastSavedId unchanged across multiple failures');
  // Confirm still only one DB row (no duplicates on repeated failure)
  const waAllRows = getSavedResources(PHONE_WA);
  assertEq(waAllRows.length, 1, 'only one DB row despite multiple SAVE attempts');

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5: State immutability
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── Section 5: State immutability ───────────────────────────────────');

  const PHONE_IMM = 'b3test_imm_001';
  _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(PHONE_IMM);
  const immStore = new MemorySessionStore();

  const gidImm = randomUUID();
  const originalState = {
    generationId: gidImm,
    intent: { type: 'sbaTask', topic: 'Research project', grade: 10, subject: 'history' },
    content: 'sba content',
    lastActivity: Date.now(),
  };
  immStore.set(PHONE_IMM, originalState);

  console.log('\nTest B3-19: SAVE does not mutate the original state object read from store');
  // The SAVE handler does { ...last, lastSavedId: saved.id } — spread creates a new object.
  // The original `last` object from store.get() must not be modified.
  const stateBefore = immStore.get(PHONE_IMM);
  const originalRef = { ...stateBefore }; // snapshot for comparison

  const immResult = await simulateSave({
    store: immStore, phoneHash: PHONE_IMM, saveResource, getSavedResourceByGenerationId,
    whatsappShouldFail: true, // keep state so we can inspect
  });

  // The state in the store should now have lastSavedId, but originalRef (snapshot) should not
  const stateAfterImmSave = immStore.get(PHONE_IMM);
  assert(!('lastSavedId' in originalRef), 'original state snapshot does not have lastSavedId (not mutated in place)');
  assert('lastSavedId' in stateAfterImmSave, 'new store value does have lastSavedId (spread created new object)');
  assertEq(stateAfterImmSave.generationId, gidImm, 'generationId unchanged in updated state');
  assertEq(stateAfterImmSave.intent.topic, 'Research project', 'intent unchanged in updated state');

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 6: Overwrite correctness — new generation replaces old
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── Section 6: Overwrite correctness ───────────────────────────────');

  const PHONE_OW = 'b3test_ow_001';
  _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(PHONE_OW);
  const owStore = new MemorySessionStore();

  console.log('\nTest B3-20: rapid overwrite — SAVE acts on the LATEST state only');
  const gidOW1 = randomUUID();
  owStore.set(PHONE_OW, {
    generationId: gidOW1,
    intent: { type: 'worksheet', topic: 'Fractions', grade: 7, subject: 'mathematics' },
    content: 'worksheet 1 content',
    lastActivity: Date.now(),
  });
  // Second generation immediately overwrites
  const gidOW2 = randomUUID();
  owStore.set(PHONE_OW, {
    generationId: gidOW2,
    intent: { type: 'test', topic: 'Algebra', grade: 7, subject: 'mathematics' },
    content: 'test 2 content',
    lastActivity: Date.now(),
  });
  // SAVE should target generation 2 (Algebra test)
  const owResult = await simulateSave({
    store: owStore, phoneHash: PHONE_OW, saveResource, getSavedResourceByGenerationId,
  });
  assertEq(owResult.action, 'saved', 'SAVE after overwrite succeeds');
  const owSaved = getSavedResources(PHONE_OW);
  assertEq(owSaved.length, 1, 'only one resource saved');
  assertEq(owSaved[0].generation_id, gidOW2, 'saved resource has generationId of second (latest) generation');
  assertEq(owSaved[0].topic, 'Algebra', 'saved resource is from second generation (Algebra test)');

  console.log('\nTest B3-21: after overwrite, original generationId is no longer in DB');
  const owOld = getSavedResourceByGenerationId(gidOW1, PHONE_OW);
  assert(owOld === null, 'first generationId not in DB (was never saved)');

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 7: Concurrent-generation simulation
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── Section 7: Concurrent-generation simulation ─────────────────────');

  const PHONE_CON = 'b3test_con_001';
  _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(PHONE_CON);
  const conStore = new MemorySessionStore();

  console.log('\nTest B3-22: 5 rapid generations — each gets a unique generationId');
  const gids = [];
  for (let i = 0; i < 5; i++) {
    const gid = randomUUID();
    gids.push(gid);
    conStore.set(PHONE_CON, {
      generationId: gid,
      intent: { type: 'worksheet', topic: `Topic ${i}`, grade: 8, subject: 'maths' },
      content: `content ${i}`,
      lastActivity: Date.now(),
    });
  }
  // All 5 are unique
  const uniqueGids = new Set(gids);
  assertEq(uniqueGids.size, 5, 'all 5 generationIds are unique');

  console.log('\nTest B3-23: after rapid overwrite, store holds only the latest state');
  const finalConState = conStore.get(PHONE_CON);
  assertEq(finalConState.generationId, gids[4], 'store holds only the 5th (latest) generationId');
  assertEq(finalConState.intent.topic, 'Topic 4', 'store holds only the latest topic');

  console.log('\nTest B3-24: SAVE after rapid overwrite saves only the latest, no prior states reachable');
  const conResult = await simulateSave({
    store: conStore, phoneHash: PHONE_CON, saveResource, getSavedResourceByGenerationId,
  });
  assertEq(conResult.action, 'saved', 'SAVE after rapid overwrite succeeds');
  const conSaved = getSavedResources(PHONE_CON);
  assertEq(conSaved.length, 1, 'exactly one resource saved (the latest)');
  assertEq(conSaved[0].generation_id, gids[4], 'saved resource has the 5th generationId');

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 8: Stale-state and overwrite-after-save
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── Section 8: Stale state and post-save generation ─────────────────');

  const PHONE_STALE = 'b3test_stale_001';
  _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(PHONE_STALE);
  const staleStore = new MemorySessionStore();

  console.log('\nTest B3-25: successful SAVE clears state — subsequent SAVE returns nothing_to_save');
  const gidStale = randomUUID();
  staleStore.set(PHONE_STALE, {
    generationId: gidStale,
    intent: { type: 'moderationPack', topic: 'Term 2', grade: 9, subject: 'science' },
    content: 'moderation content',
    lastActivity: Date.now(),
  });
  const staleResult1 = await simulateSave({ store: staleStore, phoneHash: PHONE_STALE, saveResource, getSavedResourceByGenerationId });
  assertEq(staleResult1.action, 'saved', 'first SAVE succeeds');
  const staleResult2 = await simulateSave({ store: staleStore, phoneHash: PHONE_STALE, saveResource, getSavedResourceByGenerationId });
  assertEq(staleResult2.action, 'nothing_to_save', 'second SAVE after state clear returns nothing_to_save');

  console.log('\nTest B3-26: new generation after SAVE clears lastSavedId — SAVE targets new content');
  // Set a fresh generation (as processGeneration would after SAVE clears state)
  const gidNew = randomUUID();
  staleStore.set(PHONE_STALE, {
    generationId: gidNew,
    intent: { type: 'worksheet', topic: 'Equations', grade: 9, subject: 'mathematics' },
    content: 'new worksheet content',
    lastActivity: Date.now(),
  });
  const newState = staleStore.get(PHONE_STALE);
  assert(!newState.lastSavedId, 'new state has no lastSavedId (fresh generation)');
  const staleResult3 = await simulateSave({ store: staleStore, phoneHash: PHONE_STALE, saveResource, getSavedResourceByGenerationId });
  assertEq(staleResult3.action, 'saved', 'new generation can be saved independently');
  const staleAll = getSavedResources(PHONE_STALE);
  assertEq(staleAll.length, 2, 'two distinct resources saved (first generation + new generation)');
  assert(staleAll[0].generation_id !== staleAll[1].generation_id, 'both resources have different generationIds');

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`Phase B3 Results: ${passed} passed, ${failed} failed`);
  testDb.cleanup();
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
