'use strict';
/**
 * PATCH /api/classes/:classId tests (Phase 6 — class editing).
 *
 * services/teacherWorkspaceService.js#updateClass already existed,
 * fully implemented and ownership-scoped, but had zero callers anywhere
 * in the app — a teacher who mistyped a class name/grade/subject at
 * creation had no way to fix it. This is the first caller.
 *
 * Thin-route test only, mirroring tests/api-resources-delete.test.js's
 * style. updateClass itself is exercised against the real database in
 * tests/classes-edit-e2e.test.js.
 *
 * Covers:
 *   1. 200 + updated class on success, phoneHash passed through unchanged.
 *   2. 400 for a non-positive-integer classId.
 *   3. 400 for an empty body (no name/grade/subject given).
 *   4. 400 for an empty-string name.
 *   5. 400 for a non-positive-integer grade.
 *   6. 400 for an empty-string subject.
 *   7. 404 when the class doesn't exist or isn't owned by this teacher
 *      (getClass returns null) — updateClass is never called in that case.
 *   8. 500 passthrough if getClass throws.
 *   9. 500 passthrough if updateClass throws.
 *  10. learner_count is never accepted from the request body (not part
 *      of the allowed PATCH surface, even if the client sends it).
 *
 * Run individually: node tests/api-classes-patch.test.js
 * Run via npm:       npm test
 */

const assert = require('assert');
const { createPatchClassHandler } = require('../routes/api').__testExports;

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
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

function mockReq(phoneHash, params, body) {
  return { teacher: { id: 1, phoneHash }, params, body };
}

const EXISTING_CLASS = {
  id: 5, phone_hash: 'hash_owner', name: 'Grade 7 Maths A', grade: 7, subject: 'Mathematics',
  learner_count: 30, created_at: '2026-01-10 08:00:00', updated_at: '2026-01-10 08:00:00',
};

console.log('\n📋 PATCH /api/classes/:classId\n');

test('200 + updated class on success, phoneHash passed through unchanged', () => {
  let seenId, seenHash, seenUpdates;
  const handler = createPatchClassHandler({
    getClass: () => EXISTING_CLASS,
    updateClass: (id, phoneHash, updates) => {
      seenId = id; seenHash = phoneHash; seenUpdates = updates;
      return { ...EXISTING_CLASS, name: updates.name || EXISTING_CLASS.name };
    },
  });
  const res = mockRes();
  handler(mockReq('hash_owner', { classId: '5' }, { name: 'Grade 7 Maths B' }), res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.class.name, 'Grade 7 Maths B');
  assert.strictEqual(seenId, 5);
  assert.strictEqual(seenHash, 'hash_owner');
  assert.deepStrictEqual(seenUpdates, { name: 'Grade 7 Maths B' });
});

test('400 for a non-positive-integer classId', () => {
  const handler = createPatchClassHandler({ getClass: () => EXISTING_CLASS, updateClass: () => EXISTING_CLASS });
  for (const bad of ['0', '-1', 'abc', '']) {
    const res = mockRes();
    handler(mockReq('hash_owner', { classId: bad }, { name: 'x' }), res);
    assert.strictEqual(res.statusCode, 400, `expected 400 for classId=${JSON.stringify(bad)}`);
  }
});

test('400 for an empty body', () => {
  const handler = createPatchClassHandler({ getClass: () => EXISTING_CLASS, updateClass: () => EXISTING_CLASS });
  const res = mockRes();
  handler(mockReq('hash_owner', { classId: '5' }, {}), res);
  assert.strictEqual(res.statusCode, 400);
  assert.ok(/at least one/i.test(res.body.error));
});

test('400 for an empty-string name', () => {
  const handler = createPatchClassHandler({ getClass: () => EXISTING_CLASS, updateClass: () => EXISTING_CLASS });
  const res = mockRes();
  handler(mockReq('hash_owner', { classId: '5' }, { name: '   ' }), res);
  assert.strictEqual(res.statusCode, 400);
});

test('400 for a non-positive-integer grade', () => {
  const handler = createPatchClassHandler({ getClass: () => EXISTING_CLASS, updateClass: () => EXISTING_CLASS });
  for (const bad of [0, -1, 'abc', 1.5]) {
    const res = mockRes();
    handler(mockReq('hash_owner', { classId: '5' }, { grade: bad }), res);
    assert.strictEqual(res.statusCode, 400, `expected 400 for grade=${JSON.stringify(bad)}`);
  }
});

test('400 for an empty-string subject', () => {
  const handler = createPatchClassHandler({ getClass: () => EXISTING_CLASS, updateClass: () => EXISTING_CLASS });
  const res = mockRes();
  handler(mockReq('hash_owner', { classId: '5' }, { subject: '' }), res);
  assert.strictEqual(res.statusCode, 400);
});

test('404 when getClass returns null (missing or wrong owner) — updateClass never called', () => {
  let updateCalled = false;
  const handler = createPatchClassHandler({
    getClass: () => null,
    updateClass: () => { updateCalled = true; return EXISTING_CLASS; },
  });
  const res = mockRes();
  handler(mockReq('hash_owner', { classId: '999' }, { name: 'x' }), res);
  assert.strictEqual(res.statusCode, 404);
  assert.strictEqual(updateCalled, false, 'updateClass must not run against an unowned/missing class');
});

test('500 passthrough if getClass throws', () => {
  const handler = createPatchClassHandler({
    getClass: () => { throw new Error('db exploded'); },
    updateClass: () => EXISTING_CLASS,
  });
  const res = mockRes();
  handler(mockReq('hash_owner', { classId: '5' }, { name: 'x' }), res);
  assert.strictEqual(res.statusCode, 500);
});

test('500 passthrough if updateClass throws', () => {
  const handler = createPatchClassHandler({
    getClass: () => EXISTING_CLASS,
    updateClass: () => { throw new Error('db exploded'); },
  });
  const res = mockRes();
  handler(mockReq('hash_owner', { classId: '5' }, { name: 'x' }), res);
  assert.strictEqual(res.statusCode, 500);
});

test('learner_count is never forwarded to updateClass, even if sent', () => {
  let seenUpdates;
  const handler = createPatchClassHandler({
    getClass: () => EXISTING_CLASS,
    updateClass: (_id, _hash, updates) => { seenUpdates = updates; return EXISTING_CLASS; },
  });
  const res = mockRes();
  handler(mockReq('hash_owner', { classId: '5' }, { name: 'Renamed', learner_count: 999 }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(seenUpdates, { name: 'Renamed' });
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);