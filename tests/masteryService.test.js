'use strict';
/**
 * Mastery Service (ADR-007, §3.3 / PR6)
 *
 * masteryService.js composes three seams: learnerTimelineService,
 * progressService, and coverageService — it issues no SQL, builds no
 * timeline, and recomputes no trend/coverage math of its own. Per ADR-007
 * §3.5, this suite mocks all three seams independently rather than calling
 * through to real ProgressService/CoverageService/TimelineService
 * implementations (that would be an integration test wearing a unit
 * test's name). Follows the same overwrite-and-restore pattern as
 * tests/coverageService.test.js and tests/progressService.test.js.
 *
 * Run individually:   node tests/masteryService.test.js
 * Run via npm:         npm test
 */

const learnerTimelineService = require('../services/learnerTimelineService');
const progressService = require('../services/progressService');
const coverageService = require('../services/coverageService');
const masteryService = require('../services/masteryService');

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

const realGetLearnerTimeline = learnerTimelineService.getLearnerTimeline;
const realGetLearnerProgress = progressService.getLearnerProgress;
const realGetLearnerProgressForSubject = progressService.getLearnerProgressForSubject;
const realGetLearnerCoverage = coverageService.getLearnerCoverage;

function mockTimeline(events) {
  learnerTimelineService.getLearnerTimeline = () => events;
}

function mockProgress(reports) {
  progressService.getLearnerProgress = () => reports;
}

function mockProgressForSubject(fn) {
  progressService.getLearnerProgressForSubject = fn;
}

function mockCoverage(reports) {
  coverageService.getLearnerCoverage = () => reports;
}

function restoreAll() {
  learnerTimelineService.getLearnerTimeline = realGetLearnerTimeline;
  progressService.getLearnerProgress = realGetLearnerProgress;
  progressService.getLearnerProgressForSubject = realGetLearnerProgressForSubject;
  coverageService.getLearnerCoverage = realGetLearnerCoverage;
}

// Builders matching ProgressReport / CoverageReport / TimelineEvent shapes.
function progressReport(overrides = {}) {
  return {
    learnerId: 42,
    subject: 'mathematics',
    eventCount: 4,
    trend: 'rising',
    delta: 10,
    latestPercentage: 78,
    earliestPercentage: 68,
    averagePercentage: 73,
    points: [],
    ...overrides,
  };
}

function coverageReport(overrides = {}) {
  return {
    learnerId: 42,
    subject: 'mathematics',
    grade: 7,
    term: 2,
    dataAvailable: true,
    expectedTopics: ['Fractions', 'Algebra', 'Geometry'],
    completedTopics: ['Fractions', 'Algebra'],
    missingTopics: ['Geometry'],
    coveragePercentage: 67,
    eventCount: 2,
    ...overrides,
  };
}

function timelineEvent(overrides = {}) {
  return {
    eventKey: 'assessment:1',
    type: 'assessment',
    sourceId: 1,
    learnerId: 42,
    occurredAt: '2026-05-01 10:00:00',
    title: 'Term 2 Mathematics Test',
    grade: 7,
    subject: 'mathematics',
    payload: { percentage: 68 },
    ...overrides,
  };
}

// ── determineMasteryLevel ───────────────────────────────────────────────
console.log('\n--- determineMasteryLevel ---');
{
  const level = masteryService.determineMasteryLevel(progressReport({ eventCount: 0, trend: 'insufficient-data' }), false, null);
  assert(level === 'insufficient-data', 'no progress and no coverage -> insufficient-data');
}
{
  const level = masteryService.determineMasteryLevel(progressReport({ eventCount: 3 }), false, null);
  assert(level === 'developing', 'progress present but no coverage data -> developing (unconfirmed breadth)');
}
{
  const level = masteryService.determineMasteryLevel(progressReport(), true, 30);
  assert(level === 'beginning', 'coverage below 40% -> beginning, regardless of trend');
}
{
  const level = masteryService.determineMasteryLevel(progressReport({ trend: 'rising' }), true, 55);
  assert(level === 'developing', 'coverage in 40–70% band -> developing');
}
{
  const level = masteryService.determineMasteryLevel(progressReport({ trend: 'rising' }), true, 85);
  assert(level === 'advanced', 'coverage >= 70% and trend rising -> advanced');
}
{
  const level = masteryService.determineMasteryLevel(progressReport({ trend: 'flat' }), true, 85);
  assert(level === 'secure', 'coverage >= 70% and trend flat -> secure');
}
{
  const level = masteryService.determineMasteryLevel(progressReport({ trend: 'insufficient-data' }), true, 85);
  assert(level === 'secure', 'coverage >= 70% and trend insufficient-data -> secure (not advanced, not demoted)');
}
{
  const level = masteryService.determineMasteryLevel(progressReport({ trend: 'falling' }), true, 85);
  assert(level === 'developing', 'coverage >= 70% but trend falling -> demoted to developing');
}

// ── computeConfidence ────────────────────────────────────────────────────
console.log('\n--- computeConfidence ---');
{
  const confidence = masteryService.computeConfidence(progressReport({ eventCount: 0 }), []);
  assert(confidence === 0, 'no progress events and no coverage data -> confidence 0');
}
{
  const confidence = masteryService.computeConfidence(progressReport({ eventCount: 5 }), [coverageReport({ dataAvailable: true })]);
  assert(confidence === 1, '5+ progress events and coverage data present -> confidence 1 (fully capped)');
}
{
  const confidence = masteryService.computeConfidence(progressReport({ eventCount: 5 }), [coverageReport({ dataAvailable: false })]);
  assert(confidence === 0.5, 'max progress evidence but no coverage data -> confidence 0.5 (progress half only)');
}
{
  const confidence = masteryService.computeConfidence(progressReport({ eventCount: 0 }), [coverageReport({ dataAvailable: true })]);
  assert(confidence === 0.5, 'coverage data present but zero progress events -> confidence 0.5 (coverage half only)');
}

// ── buildStrengthsAndConcerns ─────────────────────────────────────────────
console.log('\n--- buildStrengthsAndConcerns ---');
{
  const { strengths, concerns } = masteryService.buildStrengthsAndConcerns(
    progressReport({ trend: 'rising' }),
    true,
    85,
    [coverageReport({ dataAvailable: true, coveragePercentage: 85, missingTopics: [] })]
  );
  assert(strengths.some((s) => s.includes('improving')), 'rising trend surfaces an improvement strength');
  assert(strengths.some((s) => s.includes('covered')), 'high coverage surfaces a coverage strength');
  assert(concerns.length === 0, 'no concerns when trend rising, coverage high, and no missing topics');
}
{
  const { strengths, concerns } = masteryService.buildStrengthsAndConcerns(
    progressReport({ trend: 'falling', eventCount: 0 }),
    false,
    null,
    []
  );
  assert(strengths.length === 0, 'no strengths when nothing is going well');
  assert(concerns.some((c) => c.includes('declining')), 'falling trend surfaces a decline concern');
  assert(concerns.some((c) => c.includes('No CAPS coverage data')), 'missing coverage data surfaces its own concern');
  assert(concerns.some((c) => c.includes('No percentage-bearing assessment history')), 'zero progress events surfaces its own concern');
}
{
  const { concerns } = masteryService.buildStrengthsAndConcerns(
    progressReport(),
    true,
    50,
    [
      coverageReport({ term: 2, grade: 7, missingTopics: ['Old Topic'], dataAvailable: true }),
      coverageReport({ term: 3, grade: 7, missingTopics: ['Geometry'], dataAvailable: true }),
    ]
  );
  assert(
    concerns.some((c) => c.includes('Geometry') && !c.includes('Old Topic')),
    'missing-topics concern reflects only the most recent (highest term) coverage group'
  );
}

// ── buildReport ──────────────────────────────────────────────────────────
console.log('\n--- buildReport ---');
{
  const report = masteryService.buildReport(42, 'mathematics', progressReport(), [
    coverageReport({ term: 2, coveragePercentage: 60, dataAvailable: true }),
    coverageReport({ term: 3, coveragePercentage: 80, dataAvailable: true }),
  ], 6);
  assert(report.evidence.coverage.averagePercentage === 70, 'averages coveragePercentage across multiple (grade,term) groups for the subject');
  assert(report.evidence.coverage.dataAvailable === true, 'dataAvailable true when at least one coverage group has data');
  assert(report.evidence.timeline.eventCount === 6, 'raw timeline event count passed through into evidence');
  assert(Array.isArray(report.evidence.progress.points), 'evidence.progress carries the full ProgressReport, not a summary');
}
{
  // A coverage group with dataAvailable:false must not drag the average down.
  const report = masteryService.buildReport(42, 'mathematics', progressReport(), [
    coverageReport({ term: 2, coveragePercentage: 90, dataAvailable: true }),
    coverageReport({ term: 3, coveragePercentage: 0, dataAvailable: false }),
  ], 4);
  assert(report.evidence.coverage.averagePercentage === 90, 'dataAvailable:false groups are excluded from the average, not counted as 0');
}
{
  const report = masteryService.buildReport(42, 'accounting', masteryService.emptyProgressReport(42, 'accounting'), [], 0);
  assert(report.masteryLevel === 'insufficient-data', 'a subject with zero evidence of any kind reports insufficient-data');
  assert(report.evidence.coverage.averagePercentage === null, 'no coverage data -> averagePercentage null, not 0');
}

// ── getLearnerMastery (full pipeline via mocked seams) ────────────────────
console.log('\n--- getLearnerMastery (mocked seams) ---');
{
  mockProgress([
    progressReport({ subject: 'mathematics', trend: 'rising', eventCount: 5 }),
    progressReport({ subject: 'english', trend: 'flat', eventCount: 3 }),
  ]);
  mockCoverage([
    coverageReport({ subject: 'mathematics', term: 2, coveragePercentage: 90, dataAvailable: true }),
    // 'life skills' has coverage but no progress data at all.
    coverageReport({ subject: 'life skills', term: 2, coveragePercentage: 20, dataAvailable: true }),
  ]);
  mockTimeline([
    timelineEvent({ subject: 'mathematics' }),
    timelineEvent({ subject: 'mathematics', sourceId: 2 }),
    timelineEvent({ subject: 'english', sourceId: 3, type: 'observation' }),
  ]);

  const reports = masteryService.getLearnerMastery(42);
  assert(reports.length === 3, 'union of progress subjects and coverage subjects -> 3 reports (mathematics, english, life skills)');
  assert(reports[0].subject === 'english', 'reports sorted alphabetically by subject');
  assert(reports[1].subject === 'life skills', 'reports sorted alphabetically by subject');
  assert(reports[2].subject === 'mathematics', 'reports sorted alphabetically by subject');

  const life = reports.find((r) => r.subject === 'life skills');
  assert(life.evidence.progress.eventCount === 0, 'a coverage-only subject gets a synthesized empty ProgressReport, not a crash');
  assert(life.masteryLevel === 'beginning', 'life skills: coverage-only subject at 20% coverage -> beginning');

  const math = reports.find((r) => r.subject === 'mathematics');
  assert(math.evidence.timeline.eventCount === 2, 'timeline event count is filtered per-subject from the raw timeline');
  assert(math.masteryLevel === 'advanced', 'mathematics: rising trend + 90% coverage -> advanced');

  restoreAll();
}
{
  mockProgress([]);
  mockCoverage([]);
  mockTimeline([]);
  const reports = masteryService.getLearnerMastery(42);
  assert(Array.isArray(reports) && reports.length === 0, 'no progress and no coverage data at all -> empty report array, not an error');
  restoreAll();
}

// ── getLearnerMasteryForSubject (mocked seams) ────────────────────────────
console.log('\n--- getLearnerMasteryForSubject (mocked seams) ---');
{
  mockProgressForSubject((learnerId, subject) => progressReport({ subject, trend: 'rising', eventCount: 5 }));
  mockCoverage([coverageReport({ subject: 'mathematics', coveragePercentage: 80, dataAvailable: true })]);
  mockTimeline([timelineEvent({ subject: 'mathematics' })]);

  const report = masteryService.getLearnerMasteryForSubject(42, 'mathematics');
  assert(report.subject === 'mathematics', 'returns a report scoped to the requested subject');
  assert(report.masteryLevel === 'advanced', 'single-subject accessor applies the same rules as the full pipeline');
  restoreAll();
}
{
  mockProgressForSubject((learnerId, subject) => masteryService.emptyProgressReport(learnerId, subject));
  mockCoverage([]);
  mockTimeline([]);

  const report = masteryService.getLearnerMasteryForSubject(42, 'geography');
  assert(report.masteryLevel === 'insufficient-data', 'a subject with no evidence never returns null/undefined, always insufficient-data');
  restoreAll();
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
