'use strict';
/**
 * Coverage Service (ADR-007, §3.2)
 *
 * coverageService.js composes three seams: learnerTimelineService,
 * blueprintRepository, and curriculumCoverageService — it issues no SQL of
 * its own. Following the same mocking pattern as
 * tests/progressService.test.js and tests/learnerTimelineService.test.js,
 * this suite overwrites each of those three modules' exported functions
 * directly (shared require() cache), so no DB/shim is needed.
 *
 * Run individually:   node tests/coverageService.test.js
 * Run via npm:         npm test
 */

const learnerTimelineService = require('../services/learnerTimelineService');
const blueprintRepository = require('../services/blueprintRepository');
const curriculumCoverageService = require('../services/curriculumCoverageService');
const coverageService = require('../services/coverageService');

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
const realGetBlueprintById = blueprintRepository.getBlueprintById;
const realGetExpectedTopics = curriculumCoverageService.getExpectedTopics;

function mockTimeline(events) {
  learnerTimelineService.getLearnerTimeline = () => events;
}

function mockBlueprints(blueprintsById) {
  blueprintRepository.getBlueprintById = (id) => blueprintsById[id] || null;
}

function mockExpectedTopics(fn) {
  curriculumCoverageService.getExpectedTopics = fn;
}

function restoreAll() {
  learnerTimelineService.getLearnerTimeline = realGetLearnerTimeline;
  blueprintRepository.getBlueprintById = realGetBlueprintById;
  curriculumCoverageService.getExpectedTopics = realGetExpectedTopics;
}

// Builders matching the TimelineEvent shape (post ADR-007 blueprintId
// addition) and blueprintRepository.getBlueprintById()'s shape.
function blueprintAssessmentEvent(overrides = {}) {
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
      term: 2,
      percentage: 68,
      blueprintId: 100,
      blueprintVersion: 1,
      ...payloadOverrides,
    },
    ...rest,
  };
}

function observationEvent(overrides = {}) {
  return {
    eventKey: `observation:${overrides.sourceId || 1}`,
    type: 'observation',
    sourceId: 1,
    learnerId: 42,
    occurredAt: '2026-05-02 09:00:00',
    title: 'Term 2 Life Skills',
    grade: 7,
    subject: 'life skills',
    payload: { domain: 'Gross Motor', developmentalStatus: 'Achieved' },
    ...overrides,
  };
}

function blueprint(id, topics) {
  return { id, questions: topics.map((topic, i) => ({ questionNumber: i + 1, topic, maxMarks: 10 })) };
}

// ── filterCoverageEvents ──────────────────────────────────────────────────
console.log('\n--- filterCoverageEvents ---');
{
  const events = [
    blueprintAssessmentEvent({ sourceId: 1 }),
    observationEvent({ sourceId: 2 }),
    blueprintAssessmentEvent({ sourceId: 3, payload: { blueprintId: null } }),
  ];
  const filtered = coverageService.filterCoverageEvents(events);
  assert(filtered.length === 1, 'drops observation events and non-blueprint assessments');
  assert(filtered[0].eventKey === 'assessment:1', 'keeps the one blueprint-backed assessment');
}

// ── groupBySubjectGradeTerm ─────────────────────────────────────────────
console.log('\n--- groupBySubjectGradeTerm ---');
{
  const events = [
    blueprintAssessmentEvent({ sourceId: 1, subject: 'mathematics', grade: 7, payload: { term: 2 } }),
    blueprintAssessmentEvent({ sourceId: 2, subject: 'mathematics', grade: 7, payload: { term: 3 } }),
    blueprintAssessmentEvent({ sourceId: 3, subject: 'mathematics', grade: 8, payload: { term: 2 } }),
  ];
  const groups = coverageService.groupBySubjectGradeTerm(events);
  assert(groups.size === 3, 'distinct (subject,grade,term) combos never merge, even with the same subject');
}

// ── resolveEventTopics ───────────────────────────────────────────────────
console.log('\n--- resolveEventTopics ---');
{
  mockBlueprints({ 100: blueprint(100, ['Fractions', 'Algebra']) });
  const topics = coverageService.resolveEventTopics(blueprintAssessmentEvent({ payload: { blueprintId: 100 } }));
  assert(topics.length === 2 && topics.includes('Fractions') && topics.includes('Algebra'), 'resolves topics from the blueprint');
  restoreAll();
}
{
  mockBlueprints({}); // blueprint 999 does not exist (deleted)
  const topics = coverageService.resolveEventTopics(blueprintAssessmentEvent({ payload: { blueprintId: 999 } }));
  assert(Array.isArray(topics) && topics.length === 0, 'a deleted/missing blueprint resolves to [], not a throw');
  restoreAll();
}

// ── buildReport ──────────────────────────────────────────────────────────
console.log('\n--- buildReport ---');
{
  mockExpectedTopics(() => []);
  const report = coverageService.buildReport(42, 'accounting', 10, 1, []);
  assert(report.dataAvailable === false, 'no CAPS reference data -> dataAvailable false');
  assert(report.coveragePercentage === 0, 'no CAPS reference data -> coveragePercentage 0, not NaN');
  restoreAll();
}
{
  mockExpectedTopics(() => ['Fractions', 'Algebra', 'Geometry']);
  mockBlueprints({ 100: blueprint(100, ['Fractions', 'Algebra']) });
  const events = [blueprintAssessmentEvent({ sourceId: 1, payload: { blueprintId: 100, term: 2 } })];
  const report = coverageService.buildReport(42, 'mathematics', 7, 2, events);
  assert(report.dataAvailable === true, 'CAPS reference data present -> dataAvailable true');
  assert(report.completedTopics.length === 2, 'two of three expected topics completed');
  assert(report.missingTopics.length === 1 && report.missingTopics[0] === 'Geometry', 'the uncovered expected topic is reported as missing');
  assert(report.coveragePercentage === 67, 'coveragePercentage rounds 2/3 to 67');
  restoreAll();
}
{
  // A blueprint topic that isn't in the CAPS registry for this term must
  // not be silently counted as coverage of something else.
  mockExpectedTopics(() => ['Fractions']);
  mockBlueprints({ 100: blueprint(100, ['Some Misspelled Topic']) });
  const events = [blueprintAssessmentEvent({ sourceId: 1, payload: { blueprintId: 100, term: 2 } })];
  const report = coverageService.buildReport(42, 'mathematics', 7, 2, events);
  assert(report.completedTopics.length === 0, 'a blueprint topic not matching the CAPS registry contributes no coverage');
  assert(report.missingTopics.length === 1, 'the real expected topic (Fractions) is still reported as missing');
  restoreAll();
}
{
  mockExpectedTopics(() => ['Fractions', 'Algebra']);
  mockBlueprints({
    100: blueprint(100, ['Fractions']),
    200: blueprint(200, ['Algebra']),
  });
  const events = [
    blueprintAssessmentEvent({ sourceId: 1, payload: { blueprintId: 100, term: 2 } }),
    blueprintAssessmentEvent({ sourceId: 2, payload: { blueprintId: 200, term: 2 } }),
  ];
  const report = coverageService.buildReport(42, 'mathematics', 7, 2, events);
  assert(report.completedTopics.length === 2, 'topics accumulate across multiple blueprint-backed events in the same group');
  assert(report.coveragePercentage === 100, '100% once every expected topic is covered');
  restoreAll();
}

// ── getLearnerCoverage (full pipeline via mocked seams) ──────────────────
console.log('\n--- getLearnerCoverage (mocked seams) ---');
{
  mockTimeline([
    blueprintAssessmentEvent({ sourceId: 1, subject: 'mathematics', grade: 7, payload: { blueprintId: 100, term: 2 } }),
    blueprintAssessmentEvent({ sourceId: 2, subject: 'english', grade: 7, payload: { blueprintId: 200, term: 2 } }),
    blueprintAssessmentEvent({ sourceId: 3, subject: 'mathematics', grade: 7, payload: { blueprintId: null, term: 2 } }), // non-blueprint, excluded
    observationEvent({ sourceId: 4 }),
  ]);
  mockBlueprints({
    100: blueprint(100, ['Fractions']),
    200: blueprint(200, ['Comprehension']),
  });
  mockExpectedTopics((grade, subject) => {
    if (subject === 'mathematics') return ['Fractions', 'Algebra'];
    if (subject === 'english') return ['Comprehension'];
    return [];
  });

  const reports = coverageService.getLearnerCoverage(42);
  assert(reports.length === 2, 'one report per (subject,grade,term) with at least one blueprint-backed event');
  assert(reports[0].subject === 'english', 'reports sorted alphabetically by subject (english first)');
  assert(reports[1].subject === 'mathematics', 'reports sorted alphabetically by subject (mathematics second)');

  const math = reports.find((r) => r.subject === 'mathematics');
  assert(math.eventCount === 1, 'the non-blueprint mathematics event is excluded from eventCount');
  assert(math.coveragePercentage === 50, 'mathematics coverage reflects only the blueprint-backed event (1/2 topics)');

  restoreAll();
}
{
  mockTimeline([]);
  const reports = coverageService.getLearnerCoverage(42);
  assert(Array.isArray(reports) && reports.length === 0, 'no events -> empty report array, not an error');
  restoreAll();
}
{
  // Cross-term isolation: same subject, different terms, must not merge
  // into one coverage figure (different CAPS expectations per term).
  mockTimeline([
    blueprintAssessmentEvent({ sourceId: 1, subject: 'mathematics', grade: 7, payload: { blueprintId: 100, term: 2 } }),
    blueprintAssessmentEvent({ sourceId: 2, subject: 'mathematics', grade: 7, payload: { blueprintId: 200, term: 3 } }),
  ]);
  mockBlueprints({
    100: blueprint(100, ['Fractions']),
    200: blueprint(200, ['Geometry of 2D shapes']),
  });
  mockExpectedTopics((grade, subject, term) => {
    if (term === 2) return ['Fractions', 'Algebra'];
    if (term === 3) return ['Geometry of 2D shapes'];
    return [];
  });
  const reports = coverageService.getLearnerCoverage(42);
  assert(reports.length === 2, 'term 2 and term 3 mathematics produce two separate reports');
  const term2 = reports.find((r) => r.term === 2);
  const term3 = reports.find((r) => r.term === 3);
  assert(term2.coveragePercentage === 50, 'term 2 coverage computed against term 2 expectations only');
  assert(term3.coveragePercentage === 100, 'term 3 coverage computed against term 3 expectations only');
  restoreAll();
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
