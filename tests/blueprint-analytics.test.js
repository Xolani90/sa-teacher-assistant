'use strict';
/**
 * Blueprint Analytics Tests (ADR-005 Section 8a, step 5 — Deterministic
 * analytics).
 *
 * Covers:
 *   1. Error paths: unknown assessment id, non-blueprint assessment,
 *      blueprint assessment with zero learner results.
 *   2. Topic aggregation: a topic spanning multiple question numbers
 *      sums maxMarks correctly across all of them.
 *   3. Class averages: mark/percentage averaged correctly across
 *      learners, and per-topic class averages.
 *   4. Strongest/weakest topic ranking.
 *   5. A learner missing one blueprint question still gets a topic
 *      percentage computed against the full (fixed) blueprint maxMarks,
 *      not a maxMarks reduced to only what they answered.
 *
 * Run individually: node tests/blueprint-analytics.test.js
 * Run via npm:       npm test
 */

// MUST be required first — installs the better-sqlite3 → node:sqlite shim
// and runs the REAL migration chain, before any service below is required.
// See tests/helpers/createTestDb.js for why order matters here.
const { createTestDb } = require('./helpers/createTestDb');
const path = require('path');

let _db = null;

const stubTargets = {
  [path.resolve(__dirname, '../services/itemAnalysisService.js')]: {
    performItemAnalysis: () => ({ questions: [], error: null }),
    saveItemAnalysis: () => {},
  },
  [path.resolve(__dirname, '../services/errorAnalysisService.js')]: {
    performErrorAnalysis: () => ({ errorPatterns: [], error: null }),
    saveErrorAnalysis: () => {},
  },
  [path.resolve(__dirname, '../services/learnerGroupingService.js')]: {
    groupLearners: () => ({ groups: {} }),
  },
  [path.resolve(__dirname, '../services/interventionPlanService.js')]: {
    generateInterventionPlan: () => ({ plan: [] }),
  },
  [path.resolve(__dirname, '../services/interventionReportsService.js')]: {
    generateInterventionReport: () => ({ report: 'stub' }),
    generateTeacherSummary: () => 'stub summary',
  },
  [path.resolve(__dirname, '../services/curriculumCoverageService.js')]: {
    updateCoverageFromAssessment: () => {},
    // Was missing until now — diagnosticWorkflowService (via coverageService.js)
    // calls curriculumCoverageService.getExpectedTopics() when persisting a
    // learner's intervention plan. Without this, that call silently threw
    // "getExpectedTopics is not a function", was caught, and logged — Section
    // 3's assertions still passed because they never checked persistence
    // itself, only that processAssessmentData completed. Returning [] here
    // matches the same "no expected topics" shape used by the other stubs
    // in this file (blueprint-pdf-report.test.js, migration-030 test).
    getExpectedTopics: () => [],
  },
};

const testDb = createTestDb(__filename);
_db = testDb.db;

for (const [resolvedPath, exportsObj] of Object.entries(stubTargets)) {
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports: exportsObj,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────
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

function assertClose(a, b, label, tolerance = 0.001) {
  const ok = Math.abs(a - b) <= tolerance;
  if (ok) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label} (expected ~${b}, got ${a})`);
    failed++;
  }
}

function assertEq(a, b, label) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    console.error(`     expected: ${JSON.stringify(b)}`);
    console.error(`     got:      ${JSON.stringify(a)}`);
    failed++;
  }
}

// ── Schema (mirrors production; same shape as migration-030's test) ───────
// ── Test runner ─────────────────────────────────────────────────────────
async function run() {
  const { createBlueprint, publishBlueprint } = require('../services/blueprintRepository');
  const { processAssessmentData } = require('../services/diagnosticWorkflowService');
  const { getBlueprintAssessmentAnalytics } = require('../services/blueprintAnalytics');

  const PHONE = 'bp_analytics_test_hash_001';
  _db.prepare(`INSERT INTO teachers (phone_hash) VALUES (?)`).run(PHONE);

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 1: Error paths
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 1: Error paths ────────────────────────────────────────────');

  const unknownResult = getBlueprintAssessmentAnalytics(999999);
  assert(!!unknownResult.error, 'unknown assessment id returns an error, not a throw');

  const plainAssessment = _db.prepare(`
    INSERT INTO assessments (phone_hash, title, grade, subject, term, assessment_type, total_marks)
    VALUES (?, ?, 7, 'Mathematics', 1, 'test', ?)
  `).run(PHONE, 'Free-form assessment', 20);
  const plainResult = getBlueprintAssessmentAnalytics(plainAssessment.lastInsertRowid);
  assert(!!plainResult.error, 'assessment with no blueprint_id returns an error, not a crash');

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 2: Build a blueprint with a topic spanning multiple questions
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 2: Blueprint setup ────────────────────────────────────────');

  // Fractions: Q1 (10) + Q2 (5) = 15 total. Algebra: Q3 (15) alone.
  const draft = createBlueprint(
    PHONE,
    { title: 'Term 2 Fractions & Algebra Test', subject: 'Life Orientation', grade: 6, term: 2, totalMarks: 30 },
    [
      { questionNumber: 1, topic: 'fractions', maxMarks: 10 },
      { questionNumber: 2, topic: 'fractions', maxMarks: 5 },
      { questionNumber: 3, topic: 'algebra', maxMarks: 15 },
    ]
  );
  const published = publishBlueprint(draft.blueprintId, PHONE);

  const zeroLearnersAssessment = processAssessmentData(PHONE, {
    title: 'Empty class test',
    grade: 6,
    subject: 'Life Orientation',
    term: 2,
    type: 'test',
    totalMarks: 30,
    blueprintId: published.blueprintId,
    blueprintVersion: 1,
    learnerResults: [
      { learnerName: 'Only Invalid', questionData: { '1': 999 } }, // exceeds max, gets skipped -> zero valid learners stored
    ],
  });
  const zeroLearnersResult = getBlueprintAssessmentAnalytics(zeroLearnersAssessment.assessmentId);
  assert(!!zeroLearnersResult.error, 'blueprint assessment with zero stored (valid) learners returns an error');

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 3: Real class — topic aggregation, class averages, ranking
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 3: Topic aggregation, class averages, ranking ────────────');

  // Thabo: Q1=8, Q2=5, Q3=6  -> fractions 13/15, algebra 6/15, total 19/30
  // Naledi: Q1=10, Q2=5, Q3=15 -> fractions 15/15, algebra 15/15, total 30/30
  // Sipho: Q1=4  (Q2, Q3 omitted -- valid, just incomplete)
  //   -> fractions 4/15, algebra 0/15, total 4/30
  const diagnosticResult = processAssessmentData(PHONE, {
    title: 'Term 2 Fractions & Algebra Test',
    grade: 6,
    subject: 'Life Orientation',
    term: 2,
    type: 'test',
    totalMarks: 30,
    blueprintId: published.blueprintId,
    blueprintVersion: 1,
    learnerResults: [
      { learnerName: 'Thabo Mokoena', questionData: { '1': 8, '2': 5, '3': 6 } },
      { learnerName: 'Naledi Dube', questionData: { '1': 10, '2': 5, '3': 15 } },
      { learnerName: 'Sipho Nkosi', questionData: { '1': 4 } },
    ],
  });
  assert(!diagnosticResult.error, 'processAssessmentData completes for the 3-learner class');
  assertEq(diagnosticResult.skippedLearners, [], 'all three learners pass blueprint validation, none skipped');

  const analytics = getBlueprintAssessmentAnalytics(diagnosticResult.assessmentId);
  assert(!analytics.error, 'analytics computed without error for the real class');

  assertEq(analytics.blueprintId, published.blueprintId, 'analytics reports the correct blueprintId');
  assertEq(analytics.learnerCount, 3, 'learnerCount is 3');

  const fractionsTopic = analytics.topics.find((t) => t.topic === 'fractions');
  const algebraTopic = analytics.topics.find((t) => t.topic === 'algebra');
  assertEq(fractionsTopic.maxMarks, 15, 'fractions topic maxMarks sums Q1(10)+Q2(5) = 15');
  assertEq(algebraTopic.maxMarks, 15, 'algebra topic maxMarks is Q3 alone = 15');

  // Class average mark for fractions: (13 + 15 + 4) / 3 = 10.667
  assertClose(fractionsTopic.classAverageMark, 32 / 3, 'fractions class average mark is (13+15+4)/3');
  // Class average mark for algebra: (6 + 15 + 0) / 3 = 7
  assertClose(algebraTopic.classAverageMark, 7, 'algebra class average mark is (6+15+0)/3');

  // Overall class average mark: (19 + 30 + 4) / 3 = 17.667
  assertClose(analytics.classAverage.mark, 53 / 3, 'overall class average mark is (19+30+4)/3');

  // Strongest topic should be fractions (32/3 / 15 ≈ 71.1%) vs algebra (7/15 ≈ 46.7%)
  assertEq(analytics.strongestTopics[0].topic, 'fractions', 'fractions ranks as the strongest topic');
  assertEq(analytics.weakestTopics[0].topic, 'algebra', 'algebra ranks as the weakest topic');

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 4: Per-learner breakdown, including the incomplete learner
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 4: Per-learner topic breakdown ────────────────────────────');

  const sipho = analytics.learners.find((l) => l.learnerName === 'Sipho Nkosi');
  const siphoFractions = sipho.topics.find((t) => t.topic === 'fractions');
  const siphoAlgebra = sipho.topics.find((t) => t.topic === 'algebra');
  assertEq(siphoFractions.marksAwarded, 4, "Sipho's fractions marks: only Q1 answered, Q2 counts as 0");
  assertEq(siphoFractions.maxMarks, 15, "Sipho's fractions maxMarks is still the full blueprint total (15), not reduced to what he attempted");
  assertClose(siphoFractions.percentage, (4 / 15) * 100, "Sipho's fractions percentage is 4/15, not 4/10 (Q1 alone)");
  assertEq(siphoAlgebra.marksAwarded, 0, "Sipho's algebra marks: Q3 omitted entirely, counts as 0");

  const naledi = analytics.learners.find((l) => l.learnerName === 'Naledi Dube');
  const naledifractions = naledi.topics.find((t) => t.topic === 'fractions');
  assertEq(naledifractions.marksAwarded, 15, "Naledi's fractions marks: Q1(10)+Q2(5) = 15 (full marks)");
  assertClose(naledifractions.percentage, 100, "Naledi's fractions percentage is 100%");

  // ── Summary ─────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`Blueprint Analytics Results: ${passed} passed, ${failed} failed`);
  testDb.cleanup();
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
