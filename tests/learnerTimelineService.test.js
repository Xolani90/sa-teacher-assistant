'use strict';
/**
 * Learner Timeline Service (ADR-003 PR3)
 *
 * learnerTimelineService.js is a pure normalization/merge layer over
 * services/learnerRepository.js — it issues no SQL of its own. So unlike
 * tests/learnerRepository.test.js (which shims better-sqlite3 with a real
 * in-memory DB), this suite mocks learnerRepository directly: both this
 * test file and learnerTimelineService.js `require('../services/
 * learnerRepository')`, which resolves to the SAME cached exports object,
 * so overwriting a function on that object here is visible inside the
 * service under test without any DB, shim, or dependency-injection plumbing.
 *
 * Run individually:   node tests/learnerTimelineService.test.js
 * Run via npm:         npm test
 */

const learnerRepository = require('../services/learnerRepository');
const timelineService = require('../services/learnerTimelineService');

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

// Preserve the real functions so each section can restore them afterward.
const realGetAssessmentHistory = learnerRepository.getAssessmentHistory;
const realGetObservationHistory = learnerRepository.getObservationHistory;

function mockRepository({ assessments = [], observations = [], onObservationCall } = {}) {
  learnerRepository.getAssessmentHistory = () => assessments;
  learnerRepository.getObservationHistory = (learnerId, options) => {
    if (onObservationCall) onObservationCall(learnerId, options);
    return observations;
  };
}

function restoreRepository() {
  learnerRepository.getAssessmentHistory = realGetAssessmentHistory;
  learnerRepository.getObservationHistory = realGetObservationHistory;
}

// Builders matching the exact shapes returned by learnerRepository.js's
// getAssessmentHistory() / getObservationHistory().
function assessmentRow(overrides = {}) {
  return {
    type: 'assessment',
    resultId: 1,
    assessmentId: 10,
    learnerId: 42,
    learnerName: 'Sipho Dlamini',
    createdAt: '2026-05-01 10:00:00',
    title: 'Term 2 Mathematics Test',
    grade: 7,
    subject: 'mathematics',
    term: 2,
    assessmentType: 'test',
    mark: 34,
    totalMarks: 50,
    percentage: 68,
    ...overrides,
  };
}

function observationRow(overrides = {}) {
  return {
    type: 'observation',
    recordId: 1,
    assessmentId: 20,
    learnerId: 42,
    learnerName: 'Sipho Dlamini',
    createdAt: '2026-05-02 09:00:00',
    title: 'Term 2 Life Skills',
    grade: 7,
    subject: 'life skills',
    domain: 'Gross Motor',
    developmentalStatus: 'Achieved',
    notes: null,
    ...overrides,
  };
}

// ── Section 1: empty / single-source histories ─────────────────────────
console.log('\n── Section 1: empty and single-source histories ──────────');

mockRepository({ assessments: [], observations: [] });
{
  const timeline = timelineService.getLearnerTimeline(42);
  assert(Array.isArray(timeline), 'empty histories return an array');
  assert(timeline.length === 0, 'empty histories → empty timeline');
}
restoreRepository();

mockRepository({ assessments: [assessmentRow()], observations: [] });
{
  const timeline = timelineService.getLearnerTimeline(42);
  assert(timeline.length === 1, 'assessment-only history returns one event');
  assert(timeline[0].type === 'assessment', 'assessment-only event has type "assessment"');
}
restoreRepository();

mockRepository({ assessments: [], observations: [observationRow()] });
{
  const timeline = timelineService.getLearnerTimeline(42);
  assert(timeline.length === 1, 'observation-only history returns one event');
  assert(timeline[0].type === 'observation', 'observation-only event has type "observation"');
}
restoreRepository();

// ── Section 2: mixed history merge + ordering ────────────────────────────
console.log('\n── Section 2: mixed history merge and chronological ordering ──');

{
  const assessments = [
    assessmentRow({ resultId: 1, createdAt: '2026-05-03 08:00:00', title: 'Newest assessment' }),
    assessmentRow({ resultId: 2, createdAt: '2026-05-01 08:00:00', title: 'Oldest assessment' }),
  ];
  const observations = [
    observationRow({ recordId: 1, createdAt: '2026-05-02 08:00:00', title: 'Middle observation' }),
  ];
  mockRepository({ assessments, observations });

  const timeline = timelineService.getLearnerTimeline(42);
  assert(timeline.length === 3, 'mixed history merges both sources into one array');
  assert(
    timeline[0].title === 'Newest assessment' &&
      timeline[1].title === 'Middle observation' &&
      timeline[2].title === 'Oldest assessment',
    'merged timeline is sorted newest-first by occurredAt regardless of source type'
  );
  restoreRepository();
}

// ── Section 3: deterministic ordering on identical timestamps ───────────
console.log('\n── Section 3: deterministic ordering when timestamps are equal ──');

{
  const sameTimestamp = '2026-05-01 12:00:00';
  const assessments = [
    assessmentRow({ resultId: 5, createdAt: sameTimestamp, title: 'Assessment A (id 5)' }),
    assessmentRow({ resultId: 9, createdAt: sameTimestamp, title: 'Assessment B (id 9)' }),
  ];
  const observations = [
    observationRow({ recordId: 3, createdAt: sameTimestamp, title: 'Observation (id 3)' }),
  ];
  mockRepository({ assessments, observations });

  const run1 = timelineService.getLearnerTimeline(42).map((e) => e.eventKey);
  const run2 = timelineService.getLearnerTimeline(42).map((e) => e.eventKey);

  assert(
    JSON.stringify(run1) === JSON.stringify(run2),
    'ordering is stable across repeated calls with identical timestamps'
  );
  assert(
    run1[0] === 'assessment:9' && run1[1] === 'assessment:5',
    'within the same type and timestamp, higher sourceId sorts first (descending)'
  );
  assert(
    run1[2] === 'observation:3',
    'assessments sort before observations when timestamps are equal (documented tiebreak)'
  );
  restoreRepository();
}

// ── Section 4: assessment normalization ──────────────────────────────────
console.log('\n── Section 4: assessment normalization ──────────────────────');

{
  const row = assessmentRow({
    resultId: 145,
    assessmentId: 88,
    learnerId: 42,
    createdAt: '2026-06-10 14:30:00',
    title: 'Term 3 Algebra Test',
    grade: 0, // Grade R — must survive as numeric 0, not be dropped as falsy
    subject: 'mathematics',
    term: 3,
    assessmentType: 'test',
    mark: 40,
    totalMarks: 50,
    percentage: 80,
    learnerName: 'Ayanda Nkosi',
  });

  const event = timelineService.normalizeAssessment(row);

  assert(event.eventKey === 'assessment:145', 'eventKey is `assessment:${resultId}`');
  assert(event.type === 'assessment', 'type is "assessment"');
  assert(event.sourceId === 145, 'sourceId is learner_results.id (resultId)');
  assert(event.learnerId === 42, 'learnerId carried through');
  assert(event.occurredAt === '2026-06-10 14:30:00', 'occurredAt maps from createdAt');
  assert(event.title === 'Term 3 Algebra Test', 'title maps from assessments.title');
  assert(event.grade === 0, 'grade preserves Grade R as numeric 0, not falsy-dropped');
  assert(event.subject === 'mathematics', 'subject carried through');
  assert(event.payload.assessmentId === 88, 'payload.assessmentId preserved');
  assert(event.payload.learnerName === 'Ayanda Nkosi', 'payload.learnerName preserved');
  assert(event.payload.term === 3, 'payload.term preserved');
  assert(event.payload.assessmentType === 'test', 'payload.assessmentType preserved');
  assert(event.payload.mark === 40, 'payload.mark preserved');
  assert(event.payload.totalMarks === 50, 'payload.totalMarks preserved');
  assert(event.payload.percentage === 80, 'payload.percentage preserved');
}

// ── Section 5: observation normalization ─────────────────────────────────
console.log('\n── Section 5: observation normalization ─────────────────────');

{
  const row = observationRow({
    recordId: 62,
    assessmentId: 30,
    learnerId: 42,
    createdAt: '2026-06-11 09:15:00',
    title: 'Term 3 Life Skills',
    grade: 0,
    subject: 'life skills',
    domain: 'Fine Motor',
    developmentalStatus: 'Not Yet',
    notes: 'Struggles with scissor grip',
    learnerName: 'Ayanda Nkosi',
  });

  const event = timelineService.normalizeObservation(row);

  assert(event.eventKey === 'observation:62', 'eventKey is `observation:${recordId}`');
  assert(event.type === 'observation', 'type is "observation"');
  assert(event.sourceId === 62, 'sourceId is observation_records.id (recordId)');
  assert(event.learnerId === 42, 'learnerId carried through');
  assert(event.occurredAt === '2026-06-11 09:15:00', 'occurredAt maps from createdAt');
  assert(event.title === 'Term 3 Life Skills', 'title maps from observation_assessments.assessment_name');
  assert(event.grade === 0, 'grade preserves Grade R as numeric 0, not falsy-dropped');
  assert(event.subject === 'life skills', 'subject carried through');
  assert(event.payload.assessmentId === 30, 'payload.assessmentId preserved');
  assert(event.payload.learnerName === 'Ayanda Nkosi', 'payload.learnerName preserved');
  assert(event.payload.domain === 'Fine Motor', 'payload.domain preserved');
  assert(event.payload.developmentalStatus === 'Not Yet', 'payload.developmentalStatus preserved');
  assert(event.payload.notes === 'Struggles with scissor grip', 'payload.notes preserved');
}

// ── Section 6: eventKey uniqueness across types ──────────────────────────
console.log('\n── Section 6: eventKey uniqueness across types ───────────────');

{
  // Same numeric id (145) on both sides — a naive numeric `id` would
  // collide here; eventKey must not.
  const assessments = [assessmentRow({ resultId: 145 })];
  const observations = [observationRow({ recordId: 145 })];
  mockRepository({ assessments, observations });

  const timeline = timelineService.getLearnerTimeline(42);
  const keys = timeline.map((e) => e.eventKey);

  assert(
    keys.includes('assessment:145') && keys.includes('observation:145'),
    'events with the same numeric sourceId across types get distinct eventKeys'
  );
  assert(new Set(keys).size === keys.length, 'all eventKeys in a merged timeline are unique');
  restoreRepository();
}

// ── Section 7: payload / input not mutated ───────────────────────────────
console.log('\n── Section 7: input rows are not mutated ─────────────────────');

{
  const row = assessmentRow({ resultId: 1 });
  const rowSnapshot = JSON.parse(JSON.stringify(row));

  timelineService.normalizeAssessment(row);

  assert(
    JSON.stringify(row) === JSON.stringify(rowSnapshot),
    'normalizeAssessment() does not mutate its input row'
  );
}

{
  const row = observationRow({ recordId: 1 });
  const rowSnapshot = JSON.parse(JSON.stringify(row));

  timelineService.normalizeObservation(row);

  assert(
    JSON.stringify(row) === JSON.stringify(rowSnapshot),
    'normalizeObservation() does not mutate its input row'
  );
}

// ── Section 8: options passthrough ────────────────────────────────────────
console.log('\n── Section 8: includeSuperseded option passthrough ───────────');

{
  let receivedOptions = null;
  mockRepository({
    assessments: [],
    observations: [],
    onObservationCall: (learnerId, options) => {
      receivedOptions = options;
    },
  });

  timelineService.getLearnerTimeline(42, { includeSuperseded: true });

  assert(
    receivedOptions && receivedOptions.includeSuperseded === true,
    'includeSuperseded option is forwarded to getObservationHistory() unchanged'
  );
  restoreRepository();
}

// ── Section 9: repository errors propagate unchanged ─────────────────────
console.log('\n── Section 9: repository errors propagate, not swallowed ────');

{
  learnerRepository.getAssessmentHistory = () => {
    throw new Error('getAssessmentHistory: learnerId must not be null or empty');
  };
  learnerRepository.getObservationHistory = () => [];

  let threw = false;
  let message = null;
  try {
    timelineService.getLearnerTimeline(null);
  } catch (err) {
    threw = true;
    message = err.message;
  }

  assert(threw, 'an assessment-history repository error propagates out of getLearnerTimeline()');
  assert(
    message === 'getAssessmentHistory: learnerId must not be null or empty',
    'the propagated error message is the repository\'s own, not wrapped or rewritten'
  );
  restoreRepository();
}

{
  learnerRepository.getAssessmentHistory = () => [];
  learnerRepository.getObservationHistory = () => {
    throw new Error('getObservationHistory: learnerId must not be null or empty');
  };

  let threw = false;
  try {
    timelineService.getLearnerTimeline(null);
  } catch (err) {
    threw = true;
  }

  assert(threw, 'an observation-history repository error also propagates out of getLearnerTimeline()');
  restoreRepository();
}

// ── Summary ────────────────────────────────────────────────────────────
console.log('\n─────────────────────────────────────────────────────────────');
console.log(`Learner Timeline Service Results: ${passed} passed, ${failed} failed`);
console.log('─────────────────────────────────────────────────────────────');

if (failed > 0) {
  process.exitCode = 1;
}
