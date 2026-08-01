'use strict';
/**
 * GET /api/observations tests — Observation Workspace (browse/list view).
 *
 * Thin-route test only, mirroring tests/api-classes.test.js's style.
 * getObservationHistory itself (observationRepository.js) is already
 * tested elsewhere and is NOT re-tested here — this file only proves
 * the route wires phoneHash/query params through correctly and
 * degrades safely on failure, same division of responsibility as
 * api-classes.test.js vs. the class repository's own tests.
 *
 * Covers:
 *   1. 200 success — observations returned as-is from the repository call.
 *   2. 200 with `observations: []` for a teacher with none.
 *   3. req.teacher.phoneHash is passed through unchanged.
 *   4. Query params (grade, subject, learnerName, includeSuperseded, limit)
 *      are mapped into the filters object correctly, including the
 *      string->boolean and string->number coercions the route performs.
 *   5. Missing/absent query params become undefined, not empty strings
 *      (so getObservationHistory's own defaults apply).
 *   6. 500 passthrough if getObservationHistory throws.
 *
 * Mocks getObservationHistory directly (injected per routes/api.js's DI
 * convention) — no database required.
 *
 * Run individually: node tests/api-observations.test.js
 * Run via npm:       npm test
 */

const assert = require('assert');
const { createGetObservationsHandler } = require('../routes/api').__testExports;

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

const sampleObservations = [
  {
    id: 10,
    grade: 6,
    subject: 'Mathematics',
    assessmentName: 'Fractions group work',
    createdAt: '2026-07-15 09:00:00',
    recordCount: 12,
    learnerCount: 5,
  },
  {
    id: 11,
    grade: 7,
    subject: 'Natural Sciences',
    assessmentName: 'Cell structure practical',
    createdAt: '2026-07-20 11:00:00',
    recordCount: 20,
    learnerCount: 8,
  },
];

console.log('\n── Section 1: success path ──────────────────────────────');
{
  const handler = createGetObservationsHandler({
    getObservationHistory: (phoneHash) => (phoneHash === 'hash_owner' ? sampleObservations : []),
  });

  const req = mockReq('hash_owner');
  const res = mockRes();
  handler(req, res);

  test('responds 200', () => assert.strictEqual(res.statusCode, 200));
  test('returns both observations', () => assert.strictEqual(res.body.observations.length, 2));
  test('passes through repository row shape unchanged', () => {
    assert.deepStrictEqual(res.body.observations[0], sampleObservations[0]);
  });
}

console.log('\n── Section 2: teacher with zero observations ─────────────');
{
  const handler = createGetObservationsHandler({
    getObservationHistory: () => [],
  });

  const req = mockReq('hash_no_observations');
  const res = mockRes();
  handler(req, res);

  test('responds 200 (not an error) for a teacher with no observations', () => {
    assert.strictEqual(res.statusCode, 200);
  });
  test('observations is an empty array, not an error object', () => {
    assert.deepStrictEqual(res.body.observations, []);
  });
}

console.log('\n── Section 3: teacher scoping — phoneHash passed through unchanged ──');
{
  let seenPhoneHash = null;
  const handler = createGetObservationsHandler({
    getObservationHistory: (phoneHash) => { seenPhoneHash = phoneHash; return sampleObservations; },
  });

  const req = mockReq('hash_specific_teacher');
  const res = mockRes();
  handler(req, res);

  test('req.teacher.phoneHash is passed through to getObservationHistory unchanged', () => {
    assert.strictEqual(seenPhoneHash, 'hash_specific_teacher');
  });
}

console.log('\n── Section 4: query params mapped into filters correctly ─');
{
  let seenFilters = null;
  const handler = createGetObservationsHandler({
    getObservationHistory: (phoneHash, filters) => { seenFilters = filters; return sampleObservations; },
  });

  const req = mockReq('hash_owner', {
    grade: '6',
    subject: 'Mathematics',
    learnerName: 'Aisha',
    includeSuperseded: 'true',
    limit: '25',
  });
  const res = mockRes();
  handler(req, res);

  test('grade passed through as-is (string, matching getObservationHistory\'s own param type)', () => {
    assert.strictEqual(seenFilters.grade, '6');
  });
  test('subject passed through unchanged', () => {
    assert.strictEqual(seenFilters.subject, 'Mathematics');
  });
  test('learnerName passed through unchanged', () => {
    assert.strictEqual(seenFilters.learnerName, 'Aisha');
  });
  test('includeSuperseded coerced from string "true" to boolean true', () => {
    assert.strictEqual(seenFilters.includeSuperseded, true);
  });
  test('limit coerced from string "25" to number 25', () => {
    assert.strictEqual(seenFilters.limit, 25);
  });
}

console.log('\n── Section 5: absent query params become undefined, not empty strings ──');
{
  let seenFilters = null;
  const handler = createGetObservationsHandler({
    getObservationHistory: (phoneHash, filters) => { seenFilters = filters; return []; },
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
  test('learnerName is undefined when absent', () => {
    assert.strictEqual(seenFilters.learnerName, undefined);
  });
  test('includeSuperseded defaults to false (not undefined) when absent', () => {
    assert.strictEqual(seenFilters.includeSuperseded, false);
  });
  test('limit is undefined when absent, so getObservationHistory\'s own default applies', () => {
    assert.strictEqual(seenFilters.limit, undefined);
  });
}

console.log('\n── Section 6: dependency failure degrades to 500 ─────────');
{
  const handler = createGetObservationsHandler({
    getObservationHistory: () => { throw new Error('db unavailable'); },
  });
  const res = mockRes();
  handler(mockReq('hash_owner'), res);

  test('getObservationHistory throwing degrades to 500, not a crash', () => {
    assert.strictEqual(res.statusCode, 500);
  });
  test('includes an error message', () => assert.ok(res.body.error));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
