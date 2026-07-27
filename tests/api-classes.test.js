'use strict';
/**
 * GET /api/classes tests (ADR-008 PR18 — first teacher-facing API
 * endpoint beyond the intervention-plan route).
 *
 * Covers:
 *   1. 200 success — classes scoped to req.teacher.phoneHash, mapped to
 *      the route's response shape.
 *   2. 200 with `classes: []` for a teacher with no classes.
 *   3. 500 passthrough if the underlying service throws.
 *   4. Response shape — no phone_hash leaked, camelCase fields only.
 *
 * Mocks only getTeacherClasses (injected directly, per routes/api.js's
 * DI convention) — no database required.
 *
 * Run individually: node tests/api-classes.test.js
 * Run via npm:       npm test
 */

const assert = require('assert');
const { createGetClassesHandler } = require('../routes/api').__testExports;

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

const sampleClasses = [
  {
    id: 1,
    phone_hash: 'hash_owner',
    name: 'Grade 7 Mathematics A',
    grade: 7,
    subject: 'Mathematics',
    learner_count: 32,
    created_at: '2026-06-01 08:00:00',
    updated_at: '2026-06-01 08:00:00',
  },
  {
    id: 2,
    phone_hash: 'hash_owner',
    name: 'Grade 8 Mathematics B',
    grade: 8,
    subject: 'Mathematics',
    learner_count: 28,
    created_at: '2026-05-15 08:00:00',
    updated_at: '2026-05-15 08:00:00',
  },
];

console.log('\n── Section 1: success path ──────────────────────────────');
{
  const handler = createGetClassesHandler({
    getTeacherClasses: (phoneHash) => (phoneHash === 'hash_owner' ? sampleClasses : []),
  });

  const req = mockReq('hash_owner');
  const res = mockRes();
  handler(req, res);

  test('responds 200', () => assert.strictEqual(res.statusCode, 200));
  test('returns both classes', () => assert.strictEqual(res.body.classes.length, 2));
  test('maps id correctly', () => assert.strictEqual(res.body.classes[0].id, 1));
  test('maps name correctly', () => assert.strictEqual(res.body.classes[0].name, 'Grade 7 Mathematics A'));
  test('maps grade correctly', () => assert.strictEqual(res.body.classes[0].grade, 7));
  test('maps subject correctly', () => assert.strictEqual(res.body.classes[0].subject, 'Mathematics'));
  test('maps learner_count -> learnerCount', () => assert.strictEqual(res.body.classes[0].learnerCount, 32));
  test('maps created_at -> createdAt', () => assert.strictEqual(res.body.classes[0].createdAt, '2026-06-01 08:00:00'));
  test('maps updated_at -> updatedAt', () => assert.strictEqual(res.body.classes[0].updatedAt, '2026-06-01 08:00:00'));
  test('second class maps correctly too', () => assert.strictEqual(res.body.classes[1].name, 'Grade 8 Mathematics B'));
}

console.log('\n── Section 2: teacher scoping — phoneHash is passed through unchanged ──');
{
  let receivedPhoneHash = null;
  const handler = createGetClassesHandler({
    getTeacherClasses: (phoneHash) => {
      receivedPhoneHash = phoneHash;
      return sampleClasses;
    },
  });

  const req = mockReq('hash_specific_teacher');
  const res = mockRes();
  handler(req, res);

  test('req.teacher.phoneHash is passed through to getTeacherClasses unchanged', () => {
    assert.strictEqual(receivedPhoneHash, 'hash_specific_teacher');
  });
}

console.log('\n── Section 3: teacher with zero classes ──────────────────');
{
  const handler = createGetClassesHandler({
    getTeacherClasses: () => [],
  });

  const req = mockReq('hash_no_classes');
  const res = mockRes();
  handler(req, res);

  test('responds 200 (not an error) for a teacher with no classes', () => {
    assert.strictEqual(res.statusCode, 200);
  });
  test('classes is an empty array, not an error object', () => {
    assert.deepStrictEqual(res.body.classes, []);
  });
}

console.log('\n── Section 4: dependency failure degrades to 500 ─────────');
{
  const handler = createGetClassesHandler({
    getTeacherClasses: () => { throw new Error('db unavailable'); },
  });

  const req = mockReq('hash_owner');
  const res = mockRes();
  handler(req, res);

  test('getTeacherClasses throwing degrades to 500, not a crash', () => {
    assert.strictEqual(res.statusCode, 500);
  });
  test('includes an error message', () => assert.ok(res.body.error));
}

console.log('\n── Section 5: response shape — no phone_hash leaked ──────');
{
  const handler = createGetClassesHandler({
    getTeacherClasses: () => sampleClasses,
  });

  const req = mockReq('hash_owner');
  const res = mockRes();
  handler(req, res);

  test('mapped class objects never include phone_hash', () => {
    res.body.classes.forEach((c) => {
      assert.strictEqual(Object.prototype.hasOwnProperty.call(c, 'phone_hash'), false);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(c, 'phoneHash'), false);
    });
  });
  test('mapped class objects expose exactly the documented fields', () => {
    assert.deepStrictEqual(
      Object.keys(res.body.classes[0]).sort(),
      ['createdAt', 'grade', 'id', 'learnerCount', 'name', 'subject', 'updatedAt']
    );
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
