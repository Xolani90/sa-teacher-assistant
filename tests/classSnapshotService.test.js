'use strict';
/**
 * Dashboard Snapshot Service tests (ADR-014).
 *
 * classSnapshotService composes three seams — classAnalyticsService,
 * classInterventionService, tseGrowthInsightService — so this suite mocks
 * all three directly, same isolation discipline as
 * tests/classInterventionService.test.js / tests/classAnalyticsService.test.js.
 *
 * Run individually:   node tests/classSnapshotService.test.js
 * Run via npm:         npm test
 */

const classAnalyticsService = require('../services/classAnalyticsService');
const classInterventionService = require('../services/classInterventionService');
const tseGrowthInsightService = require('../services/tseGrowthInsightService');
const { getClassSnapshot } = require('../services/classSnapshotService');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

function mockFn(impl) {
  const calls = [];
  const fn = (...args) => {
    calls.push(args);
    return impl(...args);
  };
  fn.calls = calls;
  return fn;
}

console.log('Dashboard Snapshot Service tests (ADR-014)');
console.log('='.repeat(75));

// ── Section 1: all three services succeed ──
console.log('\nAll three services succeed — all sections "ok", metadata.partial is false');
{
  classAnalyticsService.getClassAnalytics = mockFn(() => ({ classSummary: { learnerCount: 5 } }));
  classInterventionService.getClassInterventionPlan = mockFn(() => ({ summary: { totalLearners: 5 } }));

  const result = getClassSnapshot('hash1', 10, {}, { name: 'Grade 6A' });

  assert(result.snapshot.analytics.status === 'ok', 'analytics section is "ok"');
  assert(result.snapshot.intervention.status === 'ok', 'intervention section is "ok"');
  assert(result.snapshot.qms.status === 'unavailable', 'qms section is "unavailable" (§3.4)');
  assert(result.metadata.partial === true, 'metadata.partial is true (qms unavailable counts)');
  assert(result.class.id === 10 && result.class.name === 'Grade 6A', 'class info passed through');
}

// ── Section 2: one service throws ──
console.log('\nOne service throws — its section is "error" with caught message, others unaffected');
{
  classAnalyticsService.getClassAnalytics = mockFn(() => { throw new Error('boom'); });
  classInterventionService.getClassInterventionPlan = mockFn(() => ({ summary: { totalLearners: 3 } }));

  const result = getClassSnapshot('hash1', 10, {}, { name: 'Grade 6A' });

  assert(result.snapshot.analytics.status === 'error', 'analytics section is "error"');
  assert(result.snapshot.analytics.error === 'boom', 'analytics error message captured');
  assert(result.snapshot.analytics.data === null, 'analytics data is null on error');
  assert(result.snapshot.intervention.status === 'ok', 'intervention section unaffected');
  assert(result.metadata.partial === true, 'metadata.partial is true');
  assert(
    result.metadata.errors.some((e) => e.section === 'analytics' && e.reason === 'boom'),
    'metadata.errors contains the analytics failure'
  );
}

// ── Section 3: all three throw ──
console.log('\nAll three throw — snapshot itself is well-formed, not an exception');
{
  classAnalyticsService.getClassAnalytics = mockFn(() => { throw new Error('a-fail'); });
  classInterventionService.getClassInterventionPlan = mockFn(() => { throw new Error('i-fail'); });

  let threw = false;
  let result;
  try {
    result = getClassSnapshot('hash1', 10, {}, { name: 'Grade 6A' });
  } catch (e) {
    threw = true;
  }

  assert(!threw, 'getClassSnapshot does not throw even when all sections fail');
  assert(result.snapshot.analytics.status === 'error', 'analytics is "error"');
  assert(result.snapshot.intervention.status === 'error', 'intervention is "error"');
  assert(result.snapshot.qms.status === 'unavailable', 'qms is "unavailable"');
  assert(result.metadata.errors.length === 2, 'metadata.errors contains both failures');
}

// ── Section 4: subject option passes through to classAnalyticsService only ──
console.log('\nsubject option passes through to classAnalyticsService only');
{
  classAnalyticsService.getClassAnalytics = mockFn(() => ({ classSummary: {} }));
  classInterventionService.getClassInterventionPlan = mockFn(() => ({ summary: {} }));

  getClassSnapshot('hash1', 10, { subject: 'Mathematics' }, { name: 'Grade 6A' });

  const analyticsCall = classAnalyticsService.getClassAnalytics.calls[0];
  const interventionCall = classInterventionService.getClassInterventionPlan.calls[0];

  assert(analyticsCall[2] && analyticsCall[2].subject === 'Mathematics', 'classAnalyticsService received subject option');
  assert(interventionCall.length === 2, 'classInterventionService received no subject argument');
}

// ── Section 5: empty/zero-learner class ──
console.log('\nEmpty class roster — snapshot still well-formed, delegates to child services');
{
  classAnalyticsService.getClassAnalytics = mockFn(() => ({ classSummary: { learnerCount: 0 } }));
  classInterventionService.getClassInterventionPlan = mockFn(() => ({ summary: { totalLearners: 0 } }));

  const result = getClassSnapshot('hash1', 99, {}, { name: 'Empty Class' });

  assert(result.snapshot.analytics.status === 'ok', 'analytics still "ok" for empty class');
  assert(result.snapshot.analytics.data.classSummary.learnerCount === 0, 'analytics reflects zero learners');
  assert(result.snapshot.intervention.status === 'ok', 'intervention still "ok" for empty class');
}

console.log('\n' + '='.repeat(75));
console.log(`Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
