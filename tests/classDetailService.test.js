'use strict';
/**
 * classDetailService pure-aggregation tests.
 *
 * Exercises computeLearnerAverages / computeClassHealth /
 * summarizeRecentAssessments / summarizeCurriculumCoverage /
 * summarizeRecentObservations directly against plain fixtures — no
 * database required, same convention as
 * tests/classInterventionService.test.js's coverage of that module's
 * exported pure functions.
 *
 * getClassDetail() itself (the composing function that touches the
 * real DB via getClass/getRoster/getClassHistory/analyzeCoverage/
 * getClassInterventionPlan) is covered separately in
 * tests/classDetailService-integration.test.js against a real
 * (throwaway, file-backed) SQLite DB.
 *
 * Run individually: node tests/classDetailService.test.js
 * Run via npm:       npm test
 */

const assert = require('assert');
const {
  computeLearnerAverages,
  computeClassHealth,
  summarizeRecentAssessments,
  summarizeCurriculumCoverage,
  summarizeRecentObservations,
  PASS_THRESHOLD,
} = require('../services/classDetailService');

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

console.log('\n── computeLearnerAverages ────────────────────────────────');
{
  const roster = [
    { id: 1, name: 'Ayanda' },
    { id: 2, name: 'Bongani' },
    { id: 3, name: 'Charlize' }, // no assessment rows at all
  ];
  const assessmentRows = [
    { learnerId: 1, percentage: 80 },
    { learnerId: 1, percentage: 60 },
    { learnerId: 2, percentage: 40 },
  ];

  test('learner with two results gets their mean, rounded to 1dp', () => {
    const result = computeLearnerAverages(roster, assessmentRows);
    const ayanda = result.find((l) => l.learnerId === 1);
    assert.strictEqual(ayanda.average, 70);
    assert.strictEqual(ayanda.assessmentCount, 2);
    assert.strictEqual(ayanda.passing, true);
  });

  test('learner below PASS_THRESHOLD is marked not passing', () => {
    const result = computeLearnerAverages(roster, assessmentRows);
    const bongani = result.find((l) => l.learnerId === 2);
    assert.strictEqual(bongani.average, 40);
    assert.strictEqual(bongani.passing, false);
  });

  test('learner with zero results gets null average/passing, not zero', () => {
    const result = computeLearnerAverages(roster, assessmentRows);
    const charlize = result.find((l) => l.learnerId === 3);
    assert.strictEqual(charlize.average, null);
    assert.strictEqual(charlize.passing, null);
    assert.strictEqual(charlize.assessmentCount, 0);
  });

  test('PASS_THRESHOLD is exported and is 50 (matches pdfService convention)', () => {
    assert.strictEqual(PASS_THRESHOLD, 50);
  });
}

console.log('\n── computeClassHealth ────────────────────────────────────');
{
  test('average/passRate/atRisk only consider learners with data', () => {
    const learnerAverages = [
      { learnerId: 1, average: 80, passing: true },
      { learnerId: 2, average: 40, passing: false },
      { learnerId: 3, average: null, passing: null }, // no data — excluded
    ];
    const health = computeClassHealth(learnerAverages, { priorityCounts: { high: 0, medium: 0, low: 0 } });
    assert.strictEqual(health.average, 60);
    assert.strictEqual(health.passRate, 50);
    assert.strictEqual(health.atRisk, 1);
    assert.strictEqual(health.dataAvailable, 2);
  });

  test('all-null roster returns null average/passRate, zero atRisk', () => {
    const learnerAverages = [
      { learnerId: 1, average: null, passing: null },
    ];
    const health = computeClassHealth(learnerAverages, { priorityCounts: { high: 0, medium: 0, low: 0 } });
    assert.strictEqual(health.average, null);
    assert.strictEqual(health.passRate, null);
    assert.strictEqual(health.atRisk, 0);
  });

  test('activeInterventions sums high + medium priority counts, excludes low', () => {
    const health = computeClassHealth([], { priorityCounts: { high: 3, medium: 1, low: 5 } });
    assert.strictEqual(health.activeInterventions, 4);
  });

  test('missing/undefined interventionPlan does not throw', () => {
    const health = computeClassHealth([], undefined);
    assert.strictEqual(health.activeInterventions, 0);
  });
}

console.log('\n── summarizeRecentAssessments ────────────────────────────');
{
  const rows = [
    { assessmentId: 1, title: 'Fractions Test', subject: 'Mathematics', term: 3, assessmentType: 'test', createdAt: '2026-07-01 08:00:00', percentage: 80 },
    { assessmentId: 1, title: 'Fractions Test', subject: 'Mathematics', term: 3, assessmentType: 'test', createdAt: '2026-07-01 08:00:00', percentage: 60 },
    { assessmentId: 2, title: 'Decimals Quiz', subject: 'Mathematics', term: 3, assessmentType: 'quiz', createdAt: '2026-07-10 08:00:00', percentage: 90 },
    { assessmentId: 3, title: 'Measurement Task', subject: 'Mathematics', term: 3, assessmentType: 'task', createdAt: '2026-06-01 08:00:00', percentage: 50 },
  ];

  test('de-duplicates one row per assessment and averages its percentages', () => {
    const result = summarizeRecentAssessments(rows);
    const fractions = result.find((a) => a.assessmentId === 1);
    assert.strictEqual(fractions.classAverage, 70);
    assert.strictEqual(fractions.learnerCount, 2);
  });

  test('sorts newest first by createdAt', () => {
    const result = summarizeRecentAssessments(rows);
    assert.deepStrictEqual(result.map((a) => a.assessmentId), [2, 1, 3]);
  });

  test('respects the limit argument', () => {
    const result = summarizeRecentAssessments(rows, 2);
    assert.strictEqual(result.length, 2);
  });
}

console.log('\n── summarizeCurriculumCoverage ───────────────────────────');
{
  test('flattens and de-duplicates outstanding topics across terms', () => {
    const coverageResult = {
      overallCoverage: 82,
      dataAvailable: true,
      termResults: [
        { outstandingTopicList: ['Ratio', 'Geometry'] },
        { outstandingTopicList: ['Geometry'] }, // duplicate across terms
      ],
    };
    const summary = summarizeCurriculumCoverage(coverageResult);
    assert.strictEqual(summary.percentage, 82);
    assert.deepStrictEqual(summary.remainingTopics, ['Ratio', 'Geometry']);
    assert.strictEqual(summary.dataAvailable, true);
  });

  test('dataAvailable false passes through unchanged (no CAPS reference data)', () => {
    const coverageResult = { overallCoverage: 0, dataAvailable: false, termResults: [] };
    const summary = summarizeCurriculumCoverage(coverageResult);
    assert.strictEqual(summary.dataAvailable, false);
    assert.deepStrictEqual(summary.remainingTopics, []);
  });
}

console.log('\n── summarizeRecentObservations ───────────────────────────');
{
  const rows = [
    { assessmentId: 10, learnerId: 1, title: 'Group Work', subject: 'Mathematics', createdAt: '2026-07-05 08:00:00' },
    { assessmentId: 10, learnerId: 2, title: 'Group Work', subject: 'Mathematics', createdAt: '2026-07-05 08:00:00' },
    { assessmentId: 11, learnerId: 1, title: 'Reading Circle', subject: 'Mathematics', createdAt: '2026-07-12 08:00:00' },
  ];

  test('groups by assessment session and counts distinct learners', () => {
    const result = summarizeRecentObservations(rows);
    const groupWork = result.find((o) => o.assessmentId === 10);
    assert.strictEqual(groupWork.learnerCount, 2);
  });

  test('sorts newest session first', () => {
    const result = summarizeRecentObservations(rows);
    assert.deepStrictEqual(result.map((o) => o.assessmentId), [11, 10]);
  });
}

console.log('\n' + '='.repeat(75));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
