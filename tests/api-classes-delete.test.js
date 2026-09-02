'use strict';
/**
 * DELETE /api/classes/:classId tests (Phase 6 continuation — class
 * deletion).
 *
 * services/teacherWorkspaceService.js#deleteClass already existed, fully
 * implemented and ownership-scoped, but had zero callers anywhere in the
 * app — a teacher who created a class in error had no way to remove it.
 * This is the first caller.
 *
 * Thin-route test only, mirroring tests/api-classes-patch.test.js's
 * style. deleteClass's dependent-record guard and default-class
 * reassignment are exercised against the real database in
 * tests/classes-delete-e2e.test.js.
 *
 * Covers:
 *   1. 204 on success.
 *   2. 400 for a non-positive-integer classId.
 *   3. 404 when the class doesn't exist or isn't owned by this teacher
 *      (getClass returns null) — deleteClass is never called in that case.
 *   4. 409 when deleteClass reports dependent records (learners /
 *      assessments / observations still linked).
 *   5. 404 if deleteClass returns false (race: deleted between the
 *      ownership check and the delete itself).
 *   6. 500 passthrough if getClass throws.
 *   7. 500 passthrough if deleteClass throws a non-guard error.
 *
 * Run individually: node tests/api-classes-delete.test.js
 * Run via npm:       npm test
 */

const assert = require('assert');
const { createDeleteClassHandler } = require('../routes/api').__testExports;

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
    send() { this.sent = true; return this; },
  };
  return res;
}

function mockReq(phoneHash, params) {
  return { teacher: { id: 1, phoneHash }, params };
}

const EXISTING_CLASS = {
  id: 5, phone_hash: 'hash_owner', name: 'Grade 7 Maths A', grade: 7, subject: 'Mathematics',
};

console.log('\n📋 DELETE /api/classes/:classId\n');

test('204 on success', () => {
  const handler = createDeleteClassHandler({
    getClass: () => EXISTING_CLASS,
    deleteClass: () => true,
  });
  const res = mockRes();
  handler(mockReq('hash_owner', { classId: '5' }), res);
  assert.strictEqual(res.statusCode, 204);
  assert.strictEqual(res.sent, true);
});

test('400 for a non-positive-integer classId', () => {
  const handler = createDeleteClassHandler({ getClass: () => EXISTING_CLASS, deleteClass: () => true });
  for (const bad of ['0', '-1', 'abc', '']) {
    const res = mockRes();
    handler(mockReq('hash_owner', { classId: bad }), res);
    assert.strictEqual(res.statusCode, 400, `expected 400 for classId=${JSON.stringify(bad)}`);
  }
});

test('404 when getClass returns null (missing or wrong owner) — deleteClass never called', () => {
  let deleteCalled = false;
  const handler = createDeleteClassHandler({
    getClass: () => null,
    deleteClass: () => { deleteCalled = true; return true; },
  });
  const res = mockRes();
  handler(mockReq('hash_owner', { classId: '999' }), res);
  assert.strictEqual(res.statusCode, 404);
  assert.strictEqual(deleteCalled, false, 'deleteClass must not run against an unowned/missing class');
});

test('409 when deleteClass reports dependent records', () => {
  const handler = createDeleteClassHandler({
    getClass: () => EXISTING_CLASS,
    deleteClass: () => { throw new Error('deleteClass: cannot delete class 5 — it still has 3 learner(s) linked to it.'); },
  });
  const res = mockRes();
  handler(mockReq('hash_owner', { classId: '5' }), res);
  assert.strictEqual(res.statusCode, 409);
  assert.ok(/learner/.test(res.body.error));
});

test('404 if deleteClass returns false', () => {
  const handler = createDeleteClassHandler({
    getClass: () => EXISTING_CLASS,
    deleteClass: () => false,
  });
  const res = mockRes();
  handler(mockReq('hash_owner', { classId: '5' }), res);
  assert.strictEqual(res.statusCode, 404);
});

test('500 passthrough if getClass throws', () => {
  const handler = createDeleteClassHandler({
    getClass: () => { throw new Error('db exploded'); },
    deleteClass: () => true,
  });
  const res = mockRes();
  handler(mockReq('hash_owner', { classId: '5' }), res);
  assert.strictEqual(res.statusCode, 500);
});

test('500 passthrough if deleteClass throws a non-guard error', () => {
  const handler = createDeleteClassHandler({
    getClass: () => EXISTING_CLASS,
    deleteClass: () => { throw new Error('db exploded'); },
  });
  const res = mockRes();
  handler(mockReq('hash_owner', { classId: '5' }), res);
  assert.strictEqual(res.statusCode, 500);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
