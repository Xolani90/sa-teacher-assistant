'use strict';
/**
 * Class Analytics Snapshot tests (ADR-015).
 *
 * classAnalyticsService.js composes three seams: learnerRosterService,
 * progressService, coverageService, masteryService. This suite mocks all
 * three directly by monkey-patching their exported functions, matching
 * the convention in tests/classInterventionService.test.js.
 *
 * Run individually:   node tests/classAnalyticsService.test.js
 * Run via npm:         npm test
 */
const learnerRosterService = require('../services/learnerRosterService');
const progressService = require('../services/progressService');
const coverageService = require('../services/coverageService');
const masteryService = require('../services/masteryService');
const classAnalyticsService = require('../services/classAnalyticsService');

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

function roster(...learners) {
  return learners.map(([id, name]) => ({ id, name }));
}

function progressReport({ subject, averagePercentage = 70, trend = 'flat' }) {
  return { learnerId: 0, subject, eventCount: 3, trend, delta: 0, latestPercentage: averagePercentage, earliestPercentage: averagePercentage, averagePercentage, points: [] };
}

function coverageReport({ subject, dataAvailable = true, coveragePercentage = 70 }) {
  return { learnerId: 0, subject, grade: 6, term: 2, dataAvailable, expectedTopics: [], completedTopics: [], missingTopics: [], coveragePercentage, eventCount: 1 };
}

function masteryReport({ subject, masteryLevel = 'developing' }) {
  return {
    learnerId: 0,
    subject,
    masteryLevel,
    confidence: 0.8,
    evidence: { progress: {}, coverage: { dataAvailable: true, averagePercentage: 70, reports: [] }, timeline: { eventCount: 3 } },
    strengths: [],
    concerns: [],
  };
}

const PHONE_HASH = 'test-phone-hash';
const CLASS_ID = 42;

const originals = {
  getRoster: learnerRosterService.getRoster,
  getLearnerProgress: progressService.getLearnerProgress,
  getLearnerCoverage: coverageService.getLearnerCoverage,
  getLearnerMastery: masteryService.getLearnerMastery,
};

function mockRoster(...learners) {
  learnerRosterService.getRoster = () => roster(...learners);
}
function mockProgress(fn) { progressService.getLearnerProgress = fn; }
function mockCoverage(fn) { coverageService.getLearnerCoverage = fn; }
function mockMastery(fn) { masteryService.getLearnerMastery = fn; }
function restoreMocks() {
  learnerRosterService.getRoster = originals.getRoster;
  progressService.getLearnerProgress = originals.getLearnerProgress;
  coverageService.getLearnerCoverage = originals.getLearnerCoverage;
  masteryService.getLearnerMastery = originals.getLearnerMastery;
}

// ── Tests ────────────────────────────────────────────────────────────────

function testAllFullData() {
  console.log('\nAll learners have full data across all three metrics — averages and distributions computed correctly');
  mockRoster([1, 'Amahle'], [2, 'Bongani']);
  mockProgress(() => [progressReport({ subject: 'Mathematics', averagePercentage: 80, trend: 'rising' })]);
  mockCoverage(() => [coverageReport({ subject: 'Mathematics', coveragePercentage: 60 })]);
  mockMastery(() => [masteryReport({ subject: 'Mathematics', masteryLevel: 'developing' })]);

  const result = classAnalyticsService.getClassAnalytics(PHONE_HASH, CLASS_ID);

  assert(result.classSummary.learnerCount === 2, 'learnerCount is 2');
  assert(result.classSummary.averageProgress === 80, 'averageProgress correct');
  assert(result.classSummary.averageCoverage === 60, 'averageCoverage correct');
  assert(result.classSummary.averageMastery === 50, 'averageMastery correct (developing=50)');
  assert(result.distributions.mastery.developing === 2, 'mastery distribution: 2 developing');
  assert(result.distributions.progress.rising === 2, 'progress distribution: 2 rising');

  restoreMocks();
}

function testInsufficientDataExcluded() {
  console.log('\nSome learners have insufficient-data mastery — excluded from averageMastery and attentionRequired populated correctly');
  mockRoster([1, 'Amahle'], [2, 'Bongani']);
  mockProgress(() => [progressReport({ subject: 'Mathematics', averagePercentage: 80 })]);
  mockCoverage(() => [coverageReport({ subject: 'Mathematics', coveragePercentage: 80 })]);
  mockMastery((learnerId) => {
    if (learnerId === 2) return [masteryReport({ subject: 'Mathematics', masteryLevel: 'insufficient-data' })];
    return [masteryReport({ subject: 'Mathematics', masteryLevel: 'advanced' })];
  });

  const result = classAnalyticsService.getClassAnalytics(PHONE_HASH, CLASS_ID);

  assert(result.classSummary.averageMastery === 100, 'averageMastery excludes insufficient-data learner (only learner 1 counted)');
  assertDeepEqual(result.highlights.attentionRequired, { count: 1, learnerIds: [2] }, 'attentionRequired correctly populated');

  restoreMocks();
}

function testOneLearnerServiceThrows() {
  console.log('\nOne learner throws for one service call; remaining learners and remaining services for that learner still processed; errors[] populated');
  mockRoster([1, 'Amahle'], [2, 'Bongani']);
  mockProgress((learnerId) => {
    if (learnerId === 1) throw new Error('progress lookup failed');
    return [progressReport({ subject: 'Mathematics', averagePercentage: 70 })];
  });
  mockCoverage(() => [coverageReport({ subject: 'Mathematics', coveragePercentage: 70 })]);
  mockMastery(() => [masteryReport({ subject: 'Mathematics', masteryLevel: 'developing' })]);

  const result = classAnalyticsService.getClassAnalytics(PHONE_HASH, CLASS_ID);

  assertDeepEqual(result.errors, [{ learnerId: 1, reason: 'progress lookup failed' }], 'errors[] records the failing learner');
  assert(result.classSummary.averageProgress === 70, 'remaining learner (2) still contributes to averageProgress');
  assert(result.breakdowns.byLearner.length === 1, 'errored learner excluded entirely from byLearner');

  restoreMocks();
}

function testMultipleLearnersThrowAcrossServices() {
  console.log('\nMultiple learners throw across different services');
  mockRoster([1, 'Amahle'], [2, 'Bongani'], [3, 'Cebo']);
  mockProgress((learnerId) => {
    if (learnerId === 1) throw new Error('progress error');
    return [progressReport({ subject: 'Mathematics', averagePercentage: 70 })];
  });
  mockCoverage((learnerId) => {
    if (learnerId === 2) throw new Error('coverage error');
    return [coverageReport({ subject: 'Mathematics', coveragePercentage: 70 })];
  });
  mockMastery(() => [masteryReport({ subject: 'Mathematics', masteryLevel: 'developing' })]);

  const result = classAnalyticsService.getClassAnalytics(PHONE_HASH, CLASS_ID);

  assertDeepEqual(
    result.errors,
    [{ learnerId: 1, reason: 'progress error' }, { learnerId: 2, reason: 'coverage error' }],
    'errors[] records both failing learners'
  );
  assert(result.breakdowns.byLearner.length === 1, 'only learner 3 fully processed');

  restoreMocks();
}

function testSubjectOptionScoping() {
  console.log('\nsubject option scopes classSummary and breakdowns.bySubject to one subject only; byLearner reflects only that subject\'s reports');
  mockRoster([1, 'Amahle']);
  mockProgress(() => [
    progressReport({ subject: 'Mathematics', averagePercentage: 90 }),
    progressReport({ subject: 'English', averagePercentage: 30 }),
  ]);
  mockCoverage(() => [
    coverageReport({ subject: 'Mathematics', coveragePercentage: 90 }),
    coverageReport({ subject: 'English', coveragePercentage: 30 }),
  ]);
  mockMastery(() => [
    masteryReport({ subject: 'Mathematics', masteryLevel: 'advanced' }),
    masteryReport({ subject: 'English', masteryLevel: 'beginning' }),
  ]);

  const result = classAnalyticsService.getClassAnalytics(PHONE_HASH, CLASS_ID, { subject: 'Mathematics' });

  assert(result.subject === 'Mathematics', 'result.subject echoes the filter');
  assert(result.classSummary.averageProgress === 90, 'averageProgress scoped to Mathematics only');
  assert(result.classSummary.averageMastery === 100, 'averageMastery scoped to Mathematics only (advanced=100)');
  assert(result.breakdowns.bySubject.length === 1 && result.breakdowns.bySubject[0].subject === 'Mathematics', 'bySubject contains only Mathematics');
  assert(result.breakdowns.byLearner[0].progress.length === 1, 'byLearner progress reflects only Mathematics');

  restoreMocks();
}

function testStrongestWeakestExcludeZeroEvaluated() {
  console.log('\nhighlights.strongestArea/weakestArea correctly exclude subjects with zero evaluated learners rather than treating them as zero');
  mockRoster([1, 'Amahle']);
  mockProgress(() => []);
  mockCoverage(() => []);
  mockMastery(() => [
    masteryReport({ subject: 'Mathematics', masteryLevel: 'advanced' }),
    masteryReport({ subject: 'English', masteryLevel: 'insufficient-data' }), // zero evaluated learners for English
  ]);

  const result = classAnalyticsService.getClassAnalytics(PHONE_HASH, CLASS_ID);

  assert(result.highlights.strongestArea.subject === 'Mathematics', 'strongestArea is Mathematics');
  assert(result.highlights.weakestArea.subject === 'Mathematics', 'weakestArea is also Mathematics (English excluded, not zeroed)');

  restoreMocks();
}

function testEmptyRoster() {
  console.log('\nEmpty class roster (learnerCount === 0) returns a well-formed ClassAnalyticsSnapshot with all averages null and counts at zero');
  mockRoster();
  let progressCalled = false;
  mockProgress(() => { progressCalled = true; return []; });
  mockCoverage(() => []);
  mockMastery(() => []);

  const result = classAnalyticsService.getClassAnalytics(PHONE_HASH, CLASS_ID);

  assertDeepEqual(
    result.classSummary,
    { learnerCount: 0, averageProgress: null, averageCoverage: null, averageMastery: null },
    'classSummary all null/zero'
  );
  assertDeepEqual(result.highlights.attentionRequired, { count: 0, learnerIds: [] }, 'attentionRequired empty');
  assert(result.highlights.strongestArea === null && result.highlights.weakestArea === null, 'no strongest/weakest area when roster is empty');
  assertDeepEqual(result.breakdowns.byLearner, [], 'byLearner empty');
  assertDeepEqual(result.breakdowns.bySubject, [], 'bySubject empty');
  assertDeepEqual(result.errors, [], 'errors empty');
  assert(!progressCalled, 'no service calls made for an empty roster');

  restoreMocks();
}

function testInsufficientDataTrendExcludedFromAverage() {
  console.log('\nREGRESSION: a single-data-point ProgressReport (trend=insufficient-data, non-null averagePercentage) is excluded from averageProgress, not silently averaged in');
  mockRoster([1, 'Amahle']);
  // Single event -> ProgressService correctly reports trend
  // "insufficient-data" while still returning a non-null averagePercentage
  // for that one point. This must NOT feed classSummary.averageProgress,
  // or it contradicts distributions.progress showing 100% insufficient-data.
  mockProgress(() => [progressReport({ subject: 'Mathematics', averagePercentage: 80, trend: 'insufficient-data' })]);
  mockCoverage(() => []);
  mockMastery(() => []);

  const result = classAnalyticsService.getClassAnalytics(PHONE_HASH, CLASS_ID);

  assert(result.classSummary.averageProgress === null, 'averageProgress is null, not 80, when the only report is insufficient-data trend');
  assert(result.distributions.progress['insufficient-data'] === 1, 'distributions.progress still counts the insufficient-data report');
  assert(result.breakdowns.bySubject.length === 0, 'bySubject has no entry for a subject with zero evaluated reports of any kind');

  restoreMocks();
}

// ── Run ──────────────────────────────────────────────────────────────────
console.log('Class Analytics Snapshot tests (ADR-015)');
console.log('='.repeat(75));

testAllFullData();
testInsufficientDataExcluded();
testOneLearnerServiceThrows();
testMultipleLearnersThrowAcrossServices();
testSubjectOptionScoping();
testStrongestWeakestExcludeZeroEvaluated();
testInsufficientDataTrendExcludedFromAverage();
testEmptyRoster();

console.log('\n' + '='.repeat(75));
console.log(`Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
