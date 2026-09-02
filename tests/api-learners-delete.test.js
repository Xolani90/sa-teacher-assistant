'use strict';
/**
 * DELETE /api/learners/:learnerId tests (Phase 6 continuation — learner
 * removal).
 *
 * services/learnerRosterService.js#removeLearner already existed, fully
 * implemented and used by the WhatsApp "REMOVE LEARNER <name>" flow, but
 * had no HTTP route or Dashboard consumer — a teacher who added a learner
 * in error, or a duplicate, could only fix it from WhatsApp, never from
 * LearnerDetail.jsx even though they're already looking at the record.
 * This is the Dashboard mirror, following the same pattern as
 * tests/api-classes-delete.test.js.
 *
 * Thin-route test only. removeLearner's real soft-delete semantics
 * (removed_at set, history preserved, re-add un-removes the same
 * identity) are exercised against the real database in
 * tests/learnerRosterService.test.js; this file only covers the handler's
 * own branching: parsing, ownership, and the removed:false passthrough.
 *
 * Covers:
 *   1. 204 on success.
 *   2. 400 for a non-positive-integer learnerId.
 *   3. 404 when getLearnerById returns null (no such learner) —
 *      removeLearner is never called in that case.
 *   4. 404 when the learner exists but belongs to a different teacher
 *      (phoneHash mismatch) — removeLearner is never called in that case.
 *   5. 404 when removeLearner reports { removed: false } (already
 *      removed, or mutated out from under us).
 *   6. 500 passthrough if getLearnerById throws.
 *   7. 500 passthrough if removeLearner throws.
 *
 * Run individually: node tests/api-learners-delete.test.js
 * Run via npm:       npm test
 */

const assert = require('assert');
const { createDeleteLearnerHandler } = require('../routes/api').__testExports;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}`);
    console.log(`       ${e.message}`);
    failed++;
    process.exitCode = 1;
  }
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    sent: false,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { this.sent = true; return this; },
  };
  return res;
}

function mockReq(phoneHash, params) {
  return { teacher: { id: 1, phoneHash }, params };
}

const EXISTING_LEARNER = {
  id: 42, phoneHash: 'hash_owner', classId: 5, canonicalName: 'Thabo Nkosi',
};

console.log('\n📋 DELETE /api/learners/:learnerId\n');

test('204 on success', () => {
  const handler = createDeleteLearnerHandler({
    getLearnerById: () => EXISTING_LEARNER,
    removeLearner: () => ({ removed: true, learner: { id: 42, name: 'Thabo Nkosi' }, rosterSize: 3 }),
  });
  const res = mockRes();
  handler(mockReq('hash_owner', { learnerId: '42' }), res);
  assert.strictEqual(res.statusCode, 204);
  assert.strictEqual(res.sent, true);
});

test('400 for a non-positive-integer learnerId', () => {
  const handler = createDeleteLearnerHandler({
    getLearnerById: () => EXISTING_LEARNER,
    removeLearner: () => ({ removed: true }),
  });
  for (const bad of ['0', '-1', 'abc', '']) {
    const res = mockRes();
    handler(mockReq('hash_owner', { learnerId: bad }), res);
    assert.strictEqual(res.statusCode, 400, `expected 400 for learnerId=${JSON.stringify(bad)}`);
  }
});

test('404 when getLearnerById returns null — removeLearner never called', () => {
  let called = false;
  const handler = createDeleteLearnerHandler({
    getLearnerById: () => null,
    removeLearner: () => { called = true; return { removed: true }; },
  });
  const res = mockRes();
  handler(mockReq('hash_owner', { learnerId: '999' }), res);
  assert.strictEqual(res.statusCode, 404);
  assert.strictEqual(called, false, 'removeLearner must not run against a missing learner');
});

test('404 when the learner belongs to a different teacher — removeLearner never called', () => {
  let called = false;
  const handler = createDeleteLearnerHandler({
    getLearnerById: () => EXISTING_LEARNER,
    removeLearner: () => { called = true; return { removed: true }; },
  });
  const res = mockRes();
  handler(mockReq('hash_intruder', { learnerId: '42' }), res);
  assert.strictEqual(res.statusCode, 404);
  assert.strictEqual(called, false, 'removeLearner must not run for a non-owning teacher');
});

test('404 when removeLearner reports removed:false', () => {
  const handler = createDeleteLearnerHandler({
    getLearnerById: () => EXISTING_LEARNER,
    removeLearner: () => ({ removed: false, learner: null, rosterSize: 3 }),
  });
  const res = mockRes();
  handler(mockReq('hash_owner', { learnerId: '42' }), res);
  assert.strictEqual(res.statusCode, 404);
});

test('500 passthrough if getLearnerById throws', () => {
  const handler = createDeleteLearnerHandler({
    getLearnerById: () => { throw new Error('db exploded'); },
    removeLearner: () => ({ removed: true }),
  });
  const res = mockRes();
  handler(mockReq('hash_owner', { learnerId: '42' }), res);
  assert.strictEqual(res.statusCode, 500);
});

test('500 passthrough if removeLearner throws', () => {
  const handler = createDeleteLearnerHandler({
    getLearnerById: () => EXISTING_LEARNER,
    removeLearner: () => { throw new Error('db exploded'); },
  });
  const res = mockRes();
  handler(mockReq('hash_owner', { learnerId: '42' }), res);
  assert.strictEqual(res.statusCode, 500);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
