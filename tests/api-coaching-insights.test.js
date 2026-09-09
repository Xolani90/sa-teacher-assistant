'use strict';
/**
 * GET /api/coaching/insights tests.
 *
 * Thin-route test only: proves the handler passes req.teacher.phoneHash
 * through to getCoachingInsights() and returns its result unchanged, with
 * a 500 on service failure. getCoachingInsights() itself — including the
 * insufficient-data guard, evidence gathering, confidence calculation,
 * and trend-aware rule evaluation (PR38/PR39) — is already covered by
 * tests/coachingEngineService.test.js, tests/coachingTrendService.test.js
 * and tests/coachingMessageRenderer.test.js and is NOT re-tested here.
 *
 * Run individually: node tests/api-coaching-insights.test.js
 * Run via npm:       npm test
 */

const assert = require('assert');
const { createGetCoachingInsightsHandler } = require('../routes/api').__testExports;

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

const sampleInsights = {
  status: 'ok',
  summary: null,
  recommendations: [
    {
      topicId: 'TOPIC_A',
      topicLabel: 'Topic A',
      ruleId: 'trend_rising',
      messageId: 'trend_rising',
      templateData: { currentConfidence: 0.7, previousConfidence: 0.4 },
      recommendation: 'Your evidence for Topic A is trending upward.',
      confidence: 0.7,
      confidenceLabel: 'high',
      evidence: { reflections: 3, growthPlans: 1 },
      explanation: 'Based on recent reflections and an active growth plan.',
    },
  ],
  generatedAt: '2026-09-09T00:00:00.000Z',
};

test('returns 200 with the exact object getCoachingInsights() returns, unmodified', () => {
  const handler = createGetCoachingInsightsHandler({
    getCoachingInsights: () => sampleInsights,
  });
  const res = mockRes();
  handler({ teacher: { phoneHash: 'hash-1' } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, sampleInsights);
});

test('calls getCoachingInsights() with req.teacher.phoneHash, scoped like every other route', () => {
  let receivedPhoneHash = null;
  const handler = createGetCoachingInsightsHandler({
    getCoachingInsights: (phoneHash) => {
      receivedPhoneHash = phoneHash;
      return sampleInsights;
    },
  });
  handler({ teacher: { phoneHash: 'hash-42' } }, mockRes());
  assert.strictEqual(receivedPhoneHash, 'hash-42');
});

test('passes through an insufficient_data result as-is (not an error state)', () => {
  const insufficient = {
    status: 'insufficient_data',
    summary: null,
    recommendations: [],
    generatedAt: '2026-09-09T00:00:00.000Z',
  };
  const handler = createGetCoachingInsightsHandler({
    getCoachingInsights: () => insufficient,
  });
  const res = mockRes();
  handler({ teacher: { phoneHash: 'hash-1' } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, insufficient);
});

test('returns 500 with a generic message if getCoachingInsights() throws', () => {
  const handler = createGetCoachingInsightsHandler({
    getCoachingInsights: () => { throw new Error('db exploded'); },
  });
  const res = mockRes();
  handler({ teacher: { phoneHash: 'hash-1' } }, res);
  assert.strictEqual(res.statusCode, 500);
  assert.deepStrictEqual(res.body, { error: 'Internal server error' });
});

console.log(`\n${passed} passed, ${failed} failed`);
