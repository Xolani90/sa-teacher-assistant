'use strict';
/**
 * GET /api/classes/:classId/detail tests.
 *
 * Covers:
 *   1. 200 success — passes through whatever services/classDetailService.js's
 *      getClassDetail returns, scoped to req.teacher.phoneHash.
 *   2. 404 when getClassDetail returns null (unknown class, or a class
 *      belonging to a different teacher — same response either way).
 *   3. 400 for a non-positive-integer classId (missing, zero, negative,
 *      non-numeric).
 *   4. 500 passthrough if the underlying service throws.
 *
 * Mocks only getClassDetail (injected directly, per routes/api.js's DI
 * convention) — no database required.
 *
 * Run individually: node tests/api-class-detail.test.js
 * Run via npm:       npm test
 */

const assert = require('assert');
const { createGetClassDetailHandler } = require('../routes/api').__testExports;

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

function mockReq(classId, phoneHash = 'hash_owner') {
  return { teacher: { id: 1, phoneHash }, params: { classId } };
}

const sampleDetail = {
  class: { id: 5, name: 'Grade 6 Mathematics', grade: 6, subject: 'Mathematics', learnerCount: 42 },
  classHealth: { average: 67, passRate: 81, atRisk: 7, dataAvailable: 40, activeInterventions: 4 },
  recentAssessments: [],
  curriculumCoverage: { percentage: 82, remainingTopics: ['Ratio', 'Geometry'], dataAvailable: true },
  learners: [],
  interventions: { summary: {}, priorityCounts: {}, priorityLearners: {} },
  observations: { recent: [], totalSessions: 0 },
};

console.log('\n── 200 success ────────────────────────────────────────────');
{
  test('returns the service payload verbatim with status 200', () => {
    const handler = createGetClassDetailHandler({
      getClassDetail: (phoneHash, classId) => {
        assert.strictEqual(phoneHash, 'hash_owner');
        assert.strictEqual(classId, 5);
        return sampleDetail;
      },
    });
    const res = mockRes();
    handler(mockReq('5'), res);
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body, sampleDetail);
  });
}

console.log('\n── 404 not found / not owned ────────────────────────────────');
{
  test('returns 404 when getClassDetail returns null', () => {
    const handler = createGetClassDetailHandler({ getClassDetail: () => null });
    const res = mockRes();
    handler(mockReq('999'), res);
    assert.strictEqual(res.statusCode, 404);
    assert.deepStrictEqual(res.body, { error: 'Class not found.' });
  });
}

console.log('\n── 400 invalid classId ──────────────────────────────────────');
{
  test('rejects a non-numeric classId', () => {
    const handler = createGetClassDetailHandler({ getClassDetail: () => sampleDetail });
    const res = mockRes();
    handler(mockReq('abc'), res);
    assert.strictEqual(res.statusCode, 400);
  });

  test('rejects zero', () => {
    const handler = createGetClassDetailHandler({ getClassDetail: () => sampleDetail });
    const res = mockRes();
    handler(mockReq('0'), res);
    assert.strictEqual(res.statusCode, 400);
  });

  test('rejects a negative classId', () => {
    const handler = createGetClassDetailHandler({ getClassDetail: () => sampleDetail });
    const res = mockRes();
    handler(mockReq('-3'), res);
    assert.strictEqual(res.statusCode, 400);
  });

  test('rejects a non-integer classId', () => {
    const handler = createGetClassDetailHandler({ getClassDetail: () => sampleDetail });
    const res = mockRes();
    handler(mockReq('5.5'), res);
    assert.strictEqual(res.statusCode, 400);
  });
}

console.log('\n── 500 passthrough ───────────────────────────────────────────');
{
  test('returns 500 if getClassDetail throws', () => {
    const handler = createGetClassDetailHandler({
      getClassDetail: () => { throw new Error('boom'); },
    });
    const res = mockRes();
    handler(mockReq('5'), res);
    assert.strictEqual(res.statusCode, 500);
    assert.deepStrictEqual(res.body, { error: 'Internal server error' });
  });
}

console.log('\n' + '='.repeat(75));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
