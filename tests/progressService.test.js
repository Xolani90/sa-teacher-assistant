'use strict';
/**
 * Progress Service (ADR-007, PR4)
 *
 * progressService.js is a pure filter/group/trend layer over
 * services/learnerTimelineService.js — it issues no repository/SQL calls
 * of its own. Following the same pattern as tests/learnerTimelineService.test.js,
 * this suite mocks learnerTimelineService directly: both this test file and
 * progressService.js `require('../services/learnerTimelineService')`, which
 * resolves to the SAME cached exports object, so overwriting
 * getLearnerTimeline here is visible inside the service under test without
 * any DB, shim, or dependency-injection plumbing.
 *
 * Run individually:   node tests/progressService.test.js
 * Run via npm:         npm test
 */

const learnerTimelineService = require('../services/learnerTimelineService');
const progressService = require('../services/progressService');

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

function mockTimeline(events) {
  learnerTimelineService.getLearnerTimeline = () => events;
}

function restoreTimeline() {
  learnerTimelineService.getLearnerTimeline = realGetLearnerTimeline;
}

// Builders matching the TimelineEvent shape produced by
// learnerTimelineService.js's normalizeAssessment()/normalizeObservation().
function assessmentEvent(overrides = {}) {
  const { payload: payloadOverrides, ...rest } = overrides;
  return {
    eventKey: `assessment:${rest.sourceId || 1}`,
    type: 'assessment',
    sourceId: 1,
    learnerId: 42,
    occurredAt: '2026-05-01 10:00:00',
    title: 'Term 2 Mathematics Test',
    grade: 7,
    subject: 'mathematics',
    payload: {
      assessmentId: 10,
      learnerName: 'Sipho Dlamini',
      term: 2,
      assessmentType: 'test',
      mark: 34,
      totalMarks: 50,
      percentage: 68,
      ...payloadOverrides,
    },
    ...rest,
  };
}

function observationEvent(overrides = {}) {
  const { payload: payloadOverrides, ...rest } = overrides;
  return {
    eventKey: `observation:${rest.sourceId || 1}`,
    type: 'observation',
    sourceId: 1,
    learnerId: 42,
    occurredAt: '2026-05-02 09:00:00',
    title: 'Term 2 Life Skills',
    grade: 7,
    subject: 'life skills',
    payload: {
      assessmentId: 20,
      learnerName: 'Sipho Dlamini',
      domain: 'Gross Motor',
      developmentalStatus: 'Achieved',
      notes: null,
      ...payloadOverrides,
    },
    ...rest,
  };
}

// ── filterProgressEvents ─────────────────────────────────────────────────
console.log('\n--- filterProgressEvents ---');
{
  const events = [
    assessmentEvent({ sourceId: 1 }),
    observationEvent({ sourceId: 2 }),
    assessmentEvent({ sourceId: 3, payload: { percentage: null } }),
  ];
  const filtered = progressService.filterProgressEvents(events);
  assert(filtered.length === 1, 'drops observation events and null-percentage assessments');
  assert(filtered[0].eventKey === 'assessment:1', 'keeps the one valid percentage-bearing assessment');
}

// ── groupBySubject ───────────────────────────────────────────────────────
console.log('\n--- groupBySubject ---');
{
  const events = [
    assessmentEvent({ sourceId: 1, subject: 'mathematics' }),
    assessmentEvent({ sourceId: 2, subject: 'english' }),
    assessmentEvent({ sourceId: 3, subject: 'mathematics' }),
  ];
  const groups = progressService.groupBySubject(events);
  assert(groups.size === 2, 'groups into exactly 2 subjects');
  assert(groups.get('mathematics').length === 2, 'mathematics group has 2 events');
  assert(groups.get('english').length === 1, 'english group has 1 event');
}
{
  const groups = progressService.groupBySubject([assessmentEvent({ subject: null })]);
  assert(groups.has('unspecified'), 'falls back to "unspecified" when subject is null');
}

// ── buildReport / trend calculation ─────────────────────────────────────
console.log('\n--- buildReport trend calculation ---');
{
  const report = progressService.buildReport(42, 'mathematics', []);
  assert(report.trend === 'insufficient-data', 'empty events -> insufficient-data');
  assert(report.eventCount === 0, 'empty events -> eventCount 0');
  assert(report.delta === null, 'empty events -> delta null');
}
{
  const report = progressService.buildReport(42, 'mathematics', [
    assessmentEvent({ sourceId: 1, payload: { percentage: 50 } }),
  ]);
  assert(report.trend === 'insufficient-data', 'single event -> insufficient-data (no delta possible)');
  assert(report.eventCount === 1, 'single event -> eventCount 1');
}
{
  const report = progressService.buildReport(42, 'mathematics', [
    assessmentEvent({ sourceId: 1, occurredAt: '2026-01-01 10:00:00', payload: { percentage: 50 } }),
    assessmentEvent({ sourceId: 2, occurredAt: '2026-03-01 10:00:00', payload: { percentage: 70 } }),
  ]);
  assert(report.trend === 'rising', 'higher latest percentage -> rising');
  assert(report.delta === 20, 'delta computed as latest - earliest (70 - 50 = 20)');
  assert(report.earliestPercentage === 50, 'earliestPercentage is chronologically first');
  assert(report.latestPercentage === 70, 'latestPercentage is chronologically last');
}
{
  const report = progressService.buildReport(42, 'mathematics', [
    assessmentEvent({ sourceId: 1, occurredAt: '2026-01-01 10:00:00', payload: { percentage: 70 } }),
    assessmentEvent({ sourceId: 2, occurredAt: '2026-03-01 10:00:00', payload: { percentage: 50 } }),
  ]);
  assert(report.trend === 'falling', 'lower latest percentage -> falling');
  assert(report.delta === -20, 'delta is negative when performance drops');
}
{
  const report = progressService.buildReport(42, 'mathematics', [
    assessmentEvent({ sourceId: 1, occurredAt: '2026-01-01 10:00:00', payload: { percentage: 60 } }),
    assessmentEvent({ sourceId: 2, occurredAt: '2026-03-01 10:00:00', payload: { percentage: 61 } }),
  ]);
  assert(report.trend === 'flat', 'delta below FLAT_THRESHOLD -> flat');
}
{
  // Events passed out of chronological order should still sort correctly.
  const report = progressService.buildReport(42, 'mathematics', [
    assessmentEvent({ sourceId: 2, occurredAt: '2026-03-01 10:00:00', payload: { percentage: 90 } }),
    assessmentEvent({ sourceId: 1, occurredAt: '2026-01-01 10:00:00', payload: { percentage: 40 } }),
    assessmentEvent({ sourceId: 3, occurredAt: '2026-02-01 10:00:00', payload: { percentage: 60 } }),
  ]);
  assert(report.points[0].eventKey === 'assessment:1', 'points sorted oldest-first regardless of input order');
  assert(report.points[2].eventKey === 'assessment:2', 'points sorted oldest-first regardless of input order (last)');
  assert(report.averagePercentage === (40 + 60 + 90) / 3, 'averagePercentage computed across all points');
}

// ── getLearnerProgress (full pipeline via mocked timeline) ──────────────
console.log('\n--- getLearnerProgress (mocked timeline) ---');
{
  mockTimeline([
    assessmentEvent({ sourceId: 1, subject: 'mathematics', occurredAt: '2026-01-01 10:00:00', payload: { percentage: 50 } }),
    assessmentEvent({ sourceId: 2, subject: 'mathematics', occurredAt: '2026-02-01 10:00:00', payload: { percentage: 80 } }),
    assessmentEvent({ sourceId: 3, subject: 'english', occurredAt: '2026-01-15 10:00:00', payload: { percentage: 65 } }),
    observationEvent({ sourceId: 4, subject: 'life skills' }),
  ]);

  const reports = progressService.getLearnerProgress(42);
  assert(reports.length === 2, 'observation-only subject (life skills) produces no report');
  assert(reports[0].subject === 'english', 'reports sorted alphabetically by subject (english first)');
  assert(reports[1].subject === 'mathematics', 'reports sorted alphabetically by subject (mathematics second)');

  const mathReport = reports.find((r) => r.subject === 'mathematics');
  assert(mathReport.trend === 'rising', 'mathematics trend computed correctly end-to-end');
  assert(mathReport.eventCount === 2, 'mathematics eventCount excludes the english/observation events');

  const englishReport = reports.find((r) => r.subject === 'english');
  assert(englishReport.trend === 'insufficient-data', 'english has only 1 event -> insufficient-data');

  restoreTimeline();
}
{
  mockTimeline([]);
  const reports = progressService.getLearnerProgress(42);
  assert(Array.isArray(reports) && reports.length === 0, 'no events -> empty report array, not an error');
  restoreTimeline();
}
{
  // Cross-subject isolation: a very different mathematics/english mix must
  // never let one subject's numbers leak into another's report.
  mockTimeline([
    assessmentEvent({ sourceId: 1, subject: 'mathematics', occurredAt: '2026-01-01 10:00:00', payload: { percentage: 20 } }),
    assessmentEvent({ sourceId: 2, subject: 'mathematics', occurredAt: '2026-02-01 10:00:00', payload: { percentage: 30 } }),
    assessmentEvent({ sourceId: 3, subject: 'english', occurredAt: '2026-01-01 10:00:00', payload: { percentage: 95 } }),
    assessmentEvent({ sourceId: 4, subject: 'english', occurredAt: '2026-02-01 10:00:00', payload: { percentage: 97 } }),
  ]);
  const reports = progressService.getLearnerProgress(42);
  const math = reports.find((r) => r.subject === 'mathematics');
  const eng = reports.find((r) => r.subject === 'english');
  assert(math.averagePercentage === 25, 'mathematics average unaffected by english scores');
  assert(eng.averagePercentage === 96, 'english average unaffected by mathematics scores');
  restoreTimeline();
}

// ── getLearnerProgressForSubject ─────────────────────────────────────────
console.log('\n--- getLearnerProgressForSubject ---');
{
  mockTimeline([
    assessmentEvent({ sourceId: 1, subject: 'mathematics', occurredAt: '2026-01-01 10:00:00', payload: { percentage: 40 } }),
    assessmentEvent({ sourceId: 2, subject: 'english', occurredAt: '2026-01-01 10:00:00', payload: { percentage: 99 } }),
  ]);
  const report = progressService.getLearnerProgressForSubject(42, 'mathematics');
  assert(report.subject === 'mathematics', 'returns the requested subject only');
  assert(report.eventCount === 1, 'excludes other-subject events');
  restoreTimeline();
}
{
  mockTimeline([observationEvent({ subject: 'science' })]);
  const report = progressService.getLearnerProgressForSubject(42, 'science');
  assert(report.trend === 'insufficient-data', 'subject with only observation events -> insufficient-data, not null/throw');
  assert(Array.isArray(report.points) && report.points.length === 0, 'never returns null/undefined for an unknown subject');
  restoreTimeline();
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
