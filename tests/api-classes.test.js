'use strict';
/**
 * GET /api/classes tests (ADR-008 PR18 — first teacher-facing API
 * endpoint beyond the intervention-plan route).
 *
 * Updated for the learner-count trust fix: the Class Detail command
 * center exposed that classes.learner_count is a write-time cache that
 * can drift from the real roster (a class created via WhatsApp's
 * legacy "NEW CLASS <name> | <count>" flow stores a declared capacity,
 * not a headcount, until a roster is actually captured). The handler
 * now takes a second dependency, getActiveRosterCounts, and
 * `learnerCount` in the response must always come from that live
 * count — never from the row's `learner_count` column.
 *
 * Covers:
 *   1. 200 success — classes scoped to req.teacher.phoneHash, mapped to
 *      the route's response shape, with learnerCount from the live
 *      roster count map.
 *   2. 200 with `classes: []` for a teacher with no classes.
 *   3. 500 passthrough if either dependency throws.
 *   4. Response shape — no phone_hash leaked, camelCase fields only.
 *   5. Stored learner_count differs from the live roster count — the
 *      response must use the live number, proving the dashboard can no
 *      longer show a class as having learners it doesn't have (or vice
 *      versa).
 *   6. A class missing entirely from the roster-counts map (no active
 *      learners at all) reports 0, not undefined/null/stale count.
 *
 * Mocks getTeacherClasses and getActiveRosterCounts (both injected
 * directly, per routes/api.js's DI convention) — no database required.
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

// Deliberately DISAGREES with sampleClasses' stored learner_count, to
// prove the response uses this, not the row's cached column.
const liveCounts = new Map([
  [1, 32], // agrees, for the "normal" case
  [2, 5],  // disagrees — class 2's cache is stale
]);

console.log('\n── Section 1: success path ──────────────────────────────');
{
  const handler = createGetClassesHandler({
    getTeacherClasses: (phoneHash) => (phoneHash === 'hash_owner' ? sampleClasses : []),
    getActiveRosterCounts: () => liveCounts,
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
  test('learnerCount comes from the live roster map', () => assert.strictEqual(res.body.classes[0].learnerCount, 32));
  test('maps created_at -> createdAt', () => assert.strictEqual(res.body.classes[0].createdAt, '2026-06-01 08:00:00'));
  test('maps updated_at -> updatedAt', () => assert.strictEqual(res.body.classes[0].updatedAt, '2026-06-01 08:00:00'));
  test('second class maps correctly too', () => assert.strictEqual(res.body.classes[1].name, 'Grade 8 Mathematics B'));
}

console.log('\n── Section 2: teacher scoping — phoneHash is passed through unchanged ──');
{
  let classesPhoneHash = null;
  let countsPhoneHash = null;
  const handler = createGetClassesHandler({
    getTeacherClasses: (phoneHash) => { classesPhoneHash = phoneHash; return sampleClasses; },
    getActiveRosterCounts: (phoneHash) => { countsPhoneHash = phoneHash; return liveCounts; },
  });

  const req = mockReq('hash_specific_teacher');
  const res = mockRes();
  handler(req, res);

  test('req.teacher.phoneHash is passed through to getTeacherClasses unchanged', () => {
    assert.strictEqual(classesPhoneHash, 'hash_specific_teacher');
  });
  test('req.teacher.phoneHash is passed through to getActiveRosterCounts unchanged', () => {
    assert.strictEqual(countsPhoneHash, 'hash_specific_teacher');
  });
}

console.log('\n── Section 3: teacher with zero classes ──────────────────');
{
  const handler = createGetClassesHandler({
    getTeacherClasses: () => [],
    getActiveRosterCounts: () => new Map(),
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
  const handlerClassesThrows = createGetClassesHandler({
    getTeacherClasses: () => { throw new Error('db unavailable'); },
    getActiveRosterCounts: () => liveCounts,
  });
  const res1 = mockRes();
  handlerClassesThrows(mockReq('hash_owner'), res1);
  test('getTeacherClasses throwing degrades to 500, not a crash', () => {
    assert.strictEqual(res1.statusCode, 500);
  });
  test('includes an error message', () => assert.ok(res1.body.error));

  const handlerCountsThrows = createGetClassesHandler({
    getTeacherClasses: () => sampleClasses,
    getActiveRosterCounts: () => { throw new Error('db unavailable'); },
  });
  const res2 = mockRes();
  handlerCountsThrows(mockReq('hash_owner'), res2);
  test('getActiveRosterCounts throwing also degrades to 500, not a crash', () => {
    assert.strictEqual(res2.statusCode, 500);
  });
}

console.log('\n── Section 5: response shape — no phone_hash leaked ──────');
{
  const handler = createGetClassesHandler({
    getTeacherClasses: () => sampleClasses,
    getActiveRosterCounts: () => liveCounts,
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

console.log('\n── Section 6: stored learner_count disagrees with the live roster ──');
{
  const handler = createGetClassesHandler({
    getTeacherClasses: () => sampleClasses,
    getActiveRosterCounts: () => liveCounts,
  });

  const req = mockReq('hash_owner');
  const res = mockRes();
  handler(req, res);

  const classTwo = res.body.classes.find((c) => c.id === 2);

  test('stored learner_count (28) is NOT what is returned', () => {
    assert.notStrictEqual(classTwo.learnerCount, 28);
  });
  test('the live roster count (5) is what is returned instead', () => {
    assert.strictEqual(classTwo.learnerCount, 5);
  });
}

console.log('\n── Section 7: class with zero active learners reports 0, not stale/undefined ──');
{
  const zeroLearnerClass = {
    id: 3,
    phone_hash: 'hash_owner',
    name: 'Legacy Class Created On WhatsApp',
    grade: 7,
    subject: 'Mathematics',
    learner_count: 34, // declared capacity from "NEW CLASS ... | 34", no roster ever captured
    created_at: '2026-01-01 08:00:00',
    updated_at: '2026-01-01 08:00:00',
  };

  const handler = createGetClassesHandler({
    getTeacherClasses: () => [zeroLearnerClass],
    getActiveRosterCounts: () => new Map(), // no active learners rows for this class at all
  });

  const req = mockReq('hash_owner');
  const res = mockRes();
  handler(req, res);

  test('class missing from the roster-counts map reports learnerCount 0', () => {
    assert.strictEqual(res.body.classes[0].learnerCount, 0);
  });
  test('does NOT fall back to the stale stored learner_count (34)', () => {
    assert.notStrictEqual(res.body.classes[0].learnerCount, 34);
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
