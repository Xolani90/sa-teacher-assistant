'use strict';
/**
 * GET /api/learners tests (ADR-008 PR20 — second teacher-facing API
 * endpoint beyond intervention-plan/classes, built on PR19's
 * getTeacherLearners(phoneHash)).
 *
 * Covers:
 *   1. 200 success — learners scoped to req.teacher.phoneHash, returned
 *      verbatim (getTeacherLearners already returns camelCase fields).
 *   2. 200 with `learners: []` for a teacher with no learners.
 *   3. 500 passthrough if the underlying repository throws.
 *   4. Response shape — no phoneHash/removedAt leaked, camelCase fields only.
 *
 * Mocks only getTeacherLearners (injected directly, per routes/api.js's
 * DI convention) — no database required.
 *
 * Run individually: node tests/api-learners.test.js
 * Run via npm:       npm test
 */

const assert = require('assert');
const { createGetLearnersHandler } = require('../routes/api').__testExports;

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

function mockReq(phoneHash = 'hash_owner') {
  return { teacher: { id: 1, phoneHash } };
}

const sampleLearners = [
  {
    id: 1,
    classId: 3,
    canonicalName: 'Amahle Dlamini',
    normalizedName: 'amahle dlamini',
    createdAt: '2026-06-01 08:00:00',
    updatedAt: '2026-06-01 08:00:00',
  },
  {
    id: 2,
    classId: 3,
    canonicalName: 'Bongani Khumalo',
    normalizedName: 'bongani khumalo',
    createdAt: '2026-05-15 08:00:00',
    updatedAt: '2026-05-15 08:00:00',
  },
];

console.log('\n── Section 1: success path ──────────────────────────────');
{
  const handler = createGetLearnersHandler({
    getTeacherLearners: (phoneHash) => (phoneHash === 'hash_owner' ? sampleLearners : []),
  });

  const req = mockReq('hash_owner');
  const res = mockRes();
  handler(req, res);

  test('responds 200', () => assert.strictEqual(res.statusCode, 200));
  test('returns both learners', () => assert.strictEqual(res.body.learners.length, 2));
  test('returns learner rows verbatim (id)', () => assert.strictEqual(res.body.learners[0].id, 1));
  test('returns learner rows verbatim (classId)', () => assert.strictEqual(res.body.learners[0].classId, 3));
  test('returns learner rows verbatim (canonicalName)', () =>
    assert.strictEqual(res.body.learners[0].canonicalName, 'Amahle Dlamini'));
  test('returns learner rows verbatim (normalizedName)', () =>
    assert.strictEqual(res.body.learners[0].normalizedName, 'amahle dlamini'));
  test('returns learner rows verbatim (createdAt)', () =>
    assert.strictEqual(res.body.learners[0].createdAt, '2026-06-01 08:00:00'));
  test('returns learner rows verbatim (updatedAt)', () =>
    assert.strictEqual(res.body.learners[0].updatedAt, '2026-06-01 08:00:00'));
  test('second learner maps correctly too', () =>
    assert.strictEqual(res.body.learners[1].canonicalName, 'Bongani Khumalo'));
}

console.log('\n── Section 2: teacher scoping — phoneHash is passed through unchanged ──');
{
  let receivedPhoneHash = null;
  const handler = createGetLearnersHandler({
    getTeacherLearners: (phoneHash) => {
      receivedPhoneHash = phoneHash;
      return sampleLearners;
    },
  });

  const req = mockReq('hash_specific_teacher');
  const res = mockRes();
  handler(req, res);

  test('req.teacher.phoneHash is passed through to getTeacherLearners unchanged', () => {
    assert.strictEqual(receivedPhoneHash, 'hash_specific_teacher');
  });
}

console.log('\n── Section 3: teacher with zero learners ─────────────────');
{
  const handler = createGetLearnersHandler({
    getTeacherLearners: () => [],
  });

  const req = mockReq('hash_no_learners');
  const res = mockRes();
  handler(req, res);

  test('responds 200 (not an error) for a teacher with no learners', () => {
    assert.strictEqual(res.statusCode, 200);
  });
  test('learners is an empty array, not an error object', () => {
    assert.deepStrictEqual(res.body.learners, []);
  });
}

console.log('\n── Section 4: dependency failure degrades to 500 ─────────');
{
  const handler = createGetLearnersHandler({
    getTeacherLearners: () => { throw new Error('db unavailable'); },
  });

  const req = mockReq('hash_owner');
  const res = mockRes();
  handler(req, res);

  test('getTeacherLearners throwing degrades to 500, not a crash', () => {
    assert.strictEqual(res.statusCode, 500);
  });
  test('includes an error message', () => assert.ok(res.body.error));
}

console.log('\n── Section 5: response shape — no phoneHash/removedAt leaked ─');
{
  const handler = createGetLearnersHandler({
    getTeacherLearners: () => sampleLearners,
  });

  const req = mockReq('hash_owner');
  const res = mockRes();
  handler(req, res);

  test('mapped learner objects never include phoneHash or phone_hash', () => {
    res.body.learners.forEach((l) => {
      assert.strictEqual(Object.prototype.hasOwnProperty.call(l, 'phoneHash'), false);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(l, 'phone_hash'), false);
    });
  });
  test('mapped learner objects never include removedAt or removed_at', () => {
    res.body.learners.forEach((l) => {
      assert.strictEqual(Object.prototype.hasOwnProperty.call(l, 'removedAt'), false);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(l, 'removed_at'), false);
    });
  });
  test('mapped learner objects expose exactly the documented fields', () => {
    assert.deepStrictEqual(
      Object.keys(res.body.learners[0]).sort(),
      ['canonicalName', 'classId', 'createdAt', 'id', 'normalizedName', 'updatedAt']
    );
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
