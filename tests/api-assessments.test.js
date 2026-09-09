'use strict';
/**
 * GET /api/assessments tests — Assessments Workspace (browse/list view),
 * Dashboard IA v1.
 *
 * Thin-route test only, mirroring tests/api-observations.test.js's style.
 * getAssessmentHistory itself (assessmentDetailService.js) is NOT
 * re-tested here — this file only proves the route wires
 * phoneHash/query params through correctly and degrades safely on
 * failure, same division of responsibility as api-observations.test.js
 * vs. observationRepository's own tests.
 *
 * Covers:
 *   1. 200 success — assessments returned as-is from the service call.
 *   2. 200 with `assessments: []` for a teacher with none.
 *   3. req.teacher.phoneHash is passed through unchanged.
 *   4. Query params (grade, subject, classId, limit) are mapped into the
 *      filters object correctly, including the string->number coercions
 *      the route performs.
 *   5. Missing/absent query params become undefined, not empty strings
 *      (so getAssessmentHistory's own defaults apply).
 *   6. 500 passthrough if getAssessmentHistory throws.
 *
 * Mocks getAssessmentHistory directly (injected per routes/api.js's DI
 * convention) — no database required.
 *
 * Run individually: node tests/api-assessments.test.js
 * Run via npm:       npm test
 */

const assert = require('assert');
const { createGetAssessmentsHandler } = require('../routes/api').__testExports;

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

function mockReq(phoneHash = 'hash_owner', query = {}) {
  return { teacher: { id: 1, phoneHash }, query };
}

const sampleAssessments = [
  {
    id: 10,
    title: 'Fractions Test',
    grade: 7,
    subject: 'Mathematics',
    term: 2,
    assessmentType: 'test',
    totalMarks: 50,
    createdAt: '2026-07-15 09:00:00',
    class: { id: 3, name: '7A' },
    learnerCount: 20,
    classAverage: 64.5,
    passRate: 75,
  },
  {
    id: 11,
    title: 'Reading Comprehension',
    grade: 3,
    subject: 'Literacy',
    term: 2,
    assessmentType: 'test',
    totalMarks: 30,
    createdAt: '2026-07-20 11:00:00',
    class: { id: 4, name: '3B' },
    learnerCount: 18,
    classAverage: 70,
    passRate: 88,
  },
];

console.log('\n── Section 1: success path ──────────────────────────────');
{
  const handler = createGetAssessmentsHandler({
    getAssessmentHistory: (phoneHash) => (phoneHash === 'hash_owner' ? sampleAssessments : []),
  });

  const req = mockReq('hash_owner');
  const res = mockRes();
  handler(req, res);

  test('responds 200', () => assert.strictEqual(res.statusCode, 200));
  test('returns both assessments', () => assert.strictEqual(res.body.assessments.length, 2));
  test('passes through service row shape unchanged', () => {
    assert.deepStrictEqual(res.body.assessments[0], sampleAssessments[0]);
  });
}

console.log('\n── Section 2: teacher with zero assessments ──────────────');
{
  const handler = createGetAssessmentsHandler({
    getAssessmentHistory: () => [],
  });

  const req = mockReq('hash_no_assessments');
  const res = mockRes();
  handler(req, res);

  test('responds 200 (not an error) for a teacher with no assessments', () => {
    assert.strictEqual(res.statusCode, 200);
  });
  test('assessments is an empty array, not an error object', () => {
    assert.deepStrictEqual(res.body.assessments, []);
  });
}

console.log('\n── Section 3: teacher scoping — phoneHash passed through unchanged ──');
{
  let seenPhoneHash = null;
  const handler = createGetAssessmentsHandler({
    getAssessmentHistory: (phoneHash) => { seenPhoneHash = phoneHash; return sampleAssessments; },
  });

  const req = mockReq('hash_specific_teacher');
  const res = mockRes();
  handler(req, res);

  test('req.teacher.phoneHash is passed through to getAssessmentHistory unchanged', () => {
    assert.strictEqual(seenPhoneHash, 'hash_specific_teacher');
  });
}

console.log('\n── Section 4: query params mapped into filters correctly ─');
{
  let seenFilters = null;
  const handler = createGetAssessmentsHandler({
    getAssessmentHistory: (phoneHash, filters) => { seenFilters = filters; return sampleAssessments; },
  });

  const req = mockReq('hash_owner', {
    grade: '7',
    subject: 'Mathematics',
    classId: '3',
    limit: '25',
  });
  const res = mockRes();
  handler(req, res);

  test('grade passed through as-is (string, matching getAssessmentHistory\'s own param type)', () => {
    assert.strictEqual(seenFilters.grade, '7');
  });
  test('subject passed through unchanged', () => {
    assert.strictEqual(seenFilters.subject, 'Mathematics');
  });
  test('classId coerced from string "3" to number 3', () => {
    assert.strictEqual(seenFilters.classId, 3);
  });
  test('limit coerced from string "25" to number 25', () => {
    assert.strictEqual(seenFilters.limit, 25);
  });
}

console.log('\n── Section 5: absent query params become undefined, not empty strings ──');
{
  let seenFilters = null;
  const handler = createGetAssessmentsHandler({
    getAssessmentHistory: (phoneHash, filters) => { seenFilters = filters; return []; },
  });

  const req = mockReq('hash_owner', {}); // no query params at all
  const res = mockRes();
  handler(req, res);

  test('grade is undefined, not empty string, when absent', () => {
    assert.strictEqual(seenFilters.grade, undefined);
  });
  test('subject is undefined when absent', () => {
    assert.strictEqual(seenFilters.subject, undefined);
  });
  test('classId is undefined when absent', () => {
    assert.strictEqual(seenFilters.classId, undefined);
  });
  test('limit is undefined when absent, so getAssessmentHistory\'s own default applies', () => {
    assert.strictEqual(seenFilters.limit, undefined);
  });
}

console.log('\n── Section 6: dependency failure degrades to 500 ─────────');
{
  const handler = createGetAssessmentsHandler({
    getAssessmentHistory: () => { throw new Error('db unavailable'); },
  });
  const res = mockRes();
  handler(mockReq('hash_owner'), res);

  test('getAssessmentHistory throwing degrades to 500, not a crash', () => {
    assert.strictEqual(res.statusCode, 500);
  });
  test('includes an error message', () => assert.ok(res.body.error));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
