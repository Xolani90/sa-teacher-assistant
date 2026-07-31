'use strict';
/**
 * Class Intervention Service (ADR-009, PR11)
 *
 * classInterventionService.js composes exactly two seams:
 * learnerRosterService.getRoster and interventionService.getLearnerInterventionPlan
 * — it issues no SQL and recomputes no mastery/progress/coverage math of
 * its own. Per the same testing-isolation discipline used by
 * tests/interventionService.test.js (which mocks masteryService
 * directly), this suite mocks both seams directly by monkey-patching
 * their exported functions rather than calling through to a real
 * database or real InterventionService/MasteryService chain.
 *
 * Run individually:   node tests/classInterventionService.test.js
 * Run via npm:         npm test
 */
const learnerRosterService = require('../services/learnerRosterService');
const interventionService = require('../services/interventionService');
const classInterventionService = require('../services/classInterventionService');

// ── Helpers ──────────────────────────────────────────────────────────────
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

function assertDeepEqual(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    console.error(`     expected: ${JSON.stringify(expected)}`);
    console.error(`     actual:   ${JSON.stringify(actual)}`);
  }
  assert(ok, label);
}

/** Minimal InterventionPlan factory for test setup. */
function makePlan({ learnerId, subject, priority, masteryLevel = 'developing', focusTopics = [] }) {
  return {
    learnerId,
    subject,
    priority,
    focusTopics,
    recommendedActions: ['some action'],
    evidence: {
      mastery: { learnerId, subject, masteryLevel, evidence: { progress: {}, coverage: {} } },
      progress: {},
      coverage: { dataAvailable: true, averagePercentage: 70 },
    },
  };
}

function roster(...learners) {
  return learners.map(([id, name]) => ({ id, name }));
}

const PHONE_HASH = 'test-phone-hash';
const CLASS_ID = 42;

// Save originals so each test can monkey-patch and we can restore after.
const originalGetRoster = learnerRosterService.getRoster;
const originalGetLearnerInterventionPlan = interventionService.getLearnerInterventionPlan;

function mockRoster(...learners) {
  learnerRosterService.getRoster = () => roster(...learners);
}

function mockPlans(fn) {
  interventionService.getLearnerInterventionPlan = fn;
}

function restoreMocks() {
  learnerRosterService.getRoster = originalGetRoster;
  interventionService.getLearnerInterventionPlan = originalGetLearnerInterventionPlan;
}

// ── Tests ────────────────────────────────────────────────────────────────

function testAllEvaluatedNoIssues() {
  console.log('\nAll learners evaluated, no insufficient-data or errors');
  mockRoster([1, 'Amahle'], [2, 'Bongani']);
  mockPlans((learnerId) => {
    if (learnerId === 1) return [makePlan({ learnerId, subject: 'Mathematics', priority: 'high' })];
    return [makePlan({ learnerId, subject: 'Mathematics', priority: 'low' })];
  });

  const result = classInterventionService.getClassInterventionPlan(PHONE_HASH, CLASS_ID);

  assertDeepEqual(
    result.summary,
    { totalLearners: 2, evaluatedLearners: 2, insufficientData: 0, erroredLearners: 0 },
    'summary counts correct'
  );
  assertDeepEqual(result.priorityCounts, { high: 1, medium: 0, low: 1 }, 'priorityCounts correct');
  assert(result.priorityLearners.high.length === 1 && result.priorityLearners.high[0].learnerId === 1, 'learner 1 in high bucket');
  assert(result.priorityLearners.low.length === 1 && result.priorityLearners.low[0].learnerId === 2, 'learner 2 in low bucket');
  assertDeepEqual(result.errors, [], 'no errors');

  restoreMocks();
}

function testAllInsufficientData() {
  console.log('\nLearner with every subject plan insufficient-data');
  mockRoster([1, 'Amahle']);
  mockPlans(() => [
    makePlan({ learnerId: 1, subject: 'Mathematics', priority: 'medium', masteryLevel: 'insufficient-data' }),
    makePlan({ learnerId: 1, subject: 'English', priority: 'medium', masteryLevel: 'insufficient-data' }),
  ]);

  const result = classInterventionService.getClassInterventionPlan(PHONE_HASH, CLASS_ID);

  assert(result.summary.insufficientData === 1, 'insufficientData count is 1');
  assert(result.summary.evaluatedLearners === 0, 'evaluatedLearners is 0');
  assertDeepEqual(result.priorityCounts, { high: 0, medium: 0, low: 0 }, 'priorityCounts all zero');
  assert(
    result.priorityLearners.high.length === 0 &&
    result.priorityLearners.medium.length === 0 &&
    result.priorityLearners.low.length === 0,
    'no learner placed in any priority bucket'
  );

  restoreMocks();
}

function testOneLearnerThrows() {
  console.log('\nOne learner throws; remaining learners still processed and aggregated');
  mockRoster([1, 'Amahle'], [2, 'Bongani']);
  mockPlans((learnerId) => {
    if (learnerId === 1) throw new Error('mastery lookup failed');
    return [makePlan({ learnerId, subject: 'Mathematics', priority: 'low' })];
  });

  const result = classInterventionService.getClassInterventionPlan(PHONE_HASH, CLASS_ID);

  assert(result.summary.erroredLearners === 1, 'erroredLearners is 1');
  assertDeepEqual(result.errors, [{ learnerId: 1, reason: 'mastery lookup failed' }], 'errors[] populated correctly');
  assert(result.summary.evaluatedLearners === 1, 'remaining learner still evaluated');
  assert(result.priorityLearners.low.length === 1 && result.priorityLearners.low[0].learnerId === 2, 'learner 2 still in low bucket');

  restoreMocks();
}

function testMultipleLearnersThrow() {
  console.log('\nMultiple learners throw');
  mockRoster([1, 'Amahle'], [2, 'Bongani'], [3, 'Cebo']);
  mockPlans((learnerId) => {
    if (learnerId === 1) throw new Error('error one');
    if (learnerId === 2) throw new Error('error two');
    return [makePlan({ learnerId, subject: 'Mathematics', priority: 'medium' })];
  });

  const result = classInterventionService.getClassInterventionPlan(PHONE_HASH, CLASS_ID);

  assert(result.summary.erroredLearners === 2, 'erroredLearners is 2');
  assertDeepEqual(
    result.errors,
    [{ learnerId: 1, reason: 'error one' }, { learnerId: 2, reason: 'error two' }],
    'errors[] contains both failures in order'
  );
  assert(result.summary.evaluatedLearners === 1, 'remaining learner still evaluated');

  restoreMocks();
}

function testMixedSubjectsWorstWins() {
  console.log('\nMixed subjects: Maths high, English insufficient-data -> overall high, not double-counted');
  mockRoster([1, 'Amahle']);
  mockPlans(() => [
    makePlan({ learnerId: 1, subject: 'Mathematics', priority: 'high', masteryLevel: 'beginning' }),
    makePlan({ learnerId: 1, subject: 'English', priority: 'medium', masteryLevel: 'insufficient-data' }),
  ]);

  const result = classInterventionService.getClassInterventionPlan(PHONE_HASH, CLASS_ID);

  assert(result.summary.evaluatedLearners === 1, 'evaluatedLearners is 1');
  assert(result.summary.insufficientData === 0, 'not double-counted as insufficientData');
  assertDeepEqual(result.priorityCounts, { high: 1, medium: 0, low: 0 }, 'priorityCounts reflects overall high');
  assert(result.priorityLearners.high[0].overallPriority === 'high', 'overallPriority is high');
  assert(result.priorityLearners.high[0].subjectPlans.length === 2, 'both subject plans retained on the learner entry');

  restoreMocks();
}

function testCommonFocusTopicsExcludeInsufficientData() {
  console.log('\ncommonFocusTopics excludes insufficient-data subject plans from numerator and denominator');
  mockRoster([1, 'Amahle'], [2, 'Bongani'], [3, 'Cebo']);
  mockPlans((learnerId) => {
    if (learnerId === 3) {
      return [makePlan({
        learnerId,
        subject: 'Mathematics',
        priority: 'medium',
        masteryLevel: 'insufficient-data',
        focusTopics: ['Fractions'],
      })];
    }
    return [makePlan({
      learnerId,
      subject: 'Mathematics',
      priority: 'high',
      focusTopics: ['Fractions'],
    })];
  });

  const result = classInterventionService.getClassInterventionPlan(PHONE_HASH, CLASS_ID);

  assert(result.summary.evaluatedLearners === 2, 'evaluatedLearners excludes the insufficient-data learner');
  assertDeepEqual(
    result.commonFocusTopics,
    [{ subject: 'Mathematics', topic: 'Fractions', affectedLearners: 2, percentage: 1 }],
    'commonFocusTopics computed only from evaluated learners'
  );

  restoreMocks();
}

function testPriorityBucketOrdering() {
  console.log('\nPriority bucket ordering: High -> Medium -> Low, alphabetical by learnerName within each bucket');
  mockRoster([1, 'Zanele'], [2, 'Amahle'], [3, 'Mpho']);
  mockPlans((learnerId) => [makePlan({ learnerId, subject: 'Mathematics', priority: 'high' })]);

  const result = classInterventionService.getClassInterventionPlan(PHONE_HASH, CLASS_ID);

  assertDeepEqual(
    result.priorityLearners.high.map((l) => l.learnerName),
    ['Amahle', 'Mpho', 'Zanele'],
    'high bucket sorted alphabetically by learnerName'
  );

  restoreMocks();
}

function testEmptyRoster() {
  console.log('\nEmpty class roster returns a well-formed ClassInterventionPlan with all counts at zero');
  mockRoster();
  let called = false;
  mockPlans(() => { called = true; return []; });

  const result = classInterventionService.getClassInterventionPlan(PHONE_HASH, CLASS_ID);

  assertDeepEqual(
    result.summary,
    { totalLearners: 0, evaluatedLearners: 0, insufficientData: 0, erroredLearners: 0 },
    'all summary counts zero'
  );
  assertDeepEqual(result.priorityCounts, { high: 0, medium: 0, low: 0 }, 'priorityCounts all zero');
  assertDeepEqual(result.priorityLearners, { high: [], medium: [], low: [] }, 'all priority buckets empty');
  assertDeepEqual(result.commonFocusTopics, [], 'commonFocusTopics empty');
  assertDeepEqual(result.errors, [], 'errors empty');
  assert(!called, 'getLearnerInterventionPlan never called for an empty roster');

  restoreMocks();
}

// ── Run ──────────────────────────────────────────────────────────────────
console.log('Class Intervention Service tests (ADR-009, PR11)');
console.log('='.repeat(75));

testAllEvaluatedNoIssues();
testAllInsufficientData();
testOneLearnerThrows();
testMultipleLearnersThrow();
testMixedSubjectsWorstWins();
testCommonFocusTopicsExcludeInsufficientData();
testPriorityBucketOrdering();
testEmptyRoster();

console.log('\n' + '='.repeat(75));
console.log(`Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
