'use strict';
/**
 * Migration 030 + Blueprint Marks Import Tests (ADR-005 Section 8a, step 4)
 *
 * Covers:
 *   1. Migration 030 verification — assessments.blueprint_version is
 *      nullable and round-trips both NULL (non-blueprint assessments)
 *      and a populated value.
 *   2. blueprintMarksImport.validateMarksAgainstBlueprint() — accepted
 *      marks, marks exceeding max_marks, unknown question numbers,
 *      non-numeric marks, missing-question detection.
 *   3. blueprintMarksImport.validateLearnerResultsAgainstBlueprint() —
 *      refuses an unpublished (draft) blueprint; validates a full
 *      class in one pass.
 *   4. End-to-end: processAssessmentData() with a published blueprint —
 *      blueprint_id/blueprint_version snapshot persisted on the
 *      assessment row, a learner whose marks fail blueprint validation
 *      is skipped (not stored, surfaced in skippedLearners), and an
 *      accepted learner's mark/totalMarks are derived from the
 *      blueprint rather than trusted from the caller.
 *
 * Run individually: node tests/migration-030-blueprint-marks-import.test.js
 * Run via npm:       npm test
 */

// ── Shared real-migrations test DB helper (see docs/TSE_SCHOOL_CALENDAR_TEST_GAP.md) ──
const { createTestDb } = require('./helpers/createTestDb');

const path = require('path');

// ── Stub the heavy downstream analysis engines diagnosticWorkflowService.js
//    orchestrates — this test is about the blueprint import wiring, not
//    re-testing itemAnalysisService/errorAnalysisService/etc., which
//    already have their own test files. ─────────────────────────────────
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
    getExpectedTopics: () => [],
  },
};

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

function assertThrows(fn, expectedMsg, label) {
  try {
    fn();
    console.error(`  ❌ FAIL: ${label} — expected throw, got no error`);
    failed++;
  } catch (err) {
    if (expectedMsg && !err.message.includes(expectedMsg)) {
      console.error(`  ❌ FAIL: ${label}`);
      console.error(`     expected message to include: "${expectedMsg}"`);
      console.error(`     got: "${err.message}"`);
      failed++;
    } else {
      console.log(`  ✅ ${label}`);
      passed++;
    }
  }
}

// ── Test runner ─────────────────────────────────────────────────────────
async function run() {
  const testDb = createTestDb(__filename);
  const _db = testDb.db;

  const { createBlueprint, publishBlueprint } = require('../services/blueprintRepository');
  const {
    validateMarksAgainstBlueprint,
    validateLearnerResultsAgainstBlueprint,
  } = require('../services/blueprintMarksImport');
  const { processAssessmentData } = require('../services/diagnosticWorkflowService');

  const PHONE = 'bp_marks_test_hash_001';
  _db.prepare(`INSERT INTO teachers (phone_hash) VALUES (?)`).run(PHONE);

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 1: Migration 030 verification
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 1: Migration 030 (blueprint_version column) ──────────────');

  const plainAssessment = _db.prepare(`
    INSERT INTO assessments (phone_hash, title, grade, subject, term, assessment_type, total_marks)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(PHONE, 'Non-blueprint assessment', 6, 'Life Orientation', 2, 'test', 20);
  const plainRow = _db.prepare(`SELECT blueprint_id, blueprint_version FROM assessments WHERE id = ?`)
    .get(plainAssessment.lastInsertRowid);
  assertEq(plainRow.blueprint_id, null, 'non-blueprint assessment: blueprint_id reads back NULL');
  assertEq(plainRow.blueprint_version, null, 'non-blueprint assessment: blueprint_version reads back NULL');

  const seedBlueprint = _db.prepare(`
    INSERT INTO assessment_blueprints (phone_hash, title, subject, grade, term, total_marks)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(PHONE, 'Seed Blueprint', 'Life Orientation', 6, 2, 20);

  const bpAssessment = _db.prepare(`
    INSERT INTO assessments (phone_hash, title, grade, subject, term, assessment_type, total_marks, blueprint_id, blueprint_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(PHONE, 'Blueprint-backed assessment', 6, 'Life Orientation', 2, 'test', 20, seedBlueprint.lastInsertRowid, 3);
  const bpRow = _db.prepare(`SELECT blueprint_id, blueprint_version FROM assessments WHERE id = ?`)
    .get(bpAssessment.lastInsertRowid);
  assertEq(bpRow.blueprint_id, seedBlueprint.lastInsertRowid, 'blueprint-backed assessment: blueprint_id round-trips');
  assertEq(bpRow.blueprint_version, 3, 'blueprint-backed assessment: blueprint_version round-trips');

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 2: validateMarksAgainstBlueprint()
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 2: validateMarksAgainstBlueprint() ────────────────────────');

  const draft = createBlueprint(
    PHONE,
    { title: 'Fractions Test', subject: 'Life Orientation', grade: 6, term: 2, totalMarks: 20 },
    [
      { questionNumber: 1, topic: 'Anything', maxMarks: 10 },
      { questionNumber: 2, topic: 'Anything else', maxMarks: 10 },
    ]
  );
  const published = publishBlueprint(draft.blueprintId, PHONE);
  const { getBlueprintById } = require('../services/blueprintRepository');
  const blueprint = getBlueprintById(published.blueprintId);

  const validCase = validateMarksAgainstBlueprint(blueprint, { '1': 8, '2': 10 });
  assert(validCase.valid, 'all marks within max_marks: valid');
  assertEq(validCase.total, 18, 'valid case: total sums accepted marks');
  assertEq(validCase.missingQuestions, [], 'valid case: no missing questions');

  const exceedsCase = validateMarksAgainstBlueprint(blueprint, { '1': 15, '2': 10 });
  assert(!exceedsCase.valid, 'marks exceeding max_marks: invalid');
  assert(
    exceedsCase.errors.some((e) => e.questionNumber === 1 && /exceeds max marks/.test(e.message)),
    'exceeds case: error names the offending question and reason'
  );

  const unknownQuestionCase = validateMarksAgainstBlueprint(blueprint, { '1': 8, '99': 5 });
  assert(!unknownQuestionCase.valid, 'unknown question number: invalid');
  assert(
    unknownQuestionCase.errors.some((e) => e.questionNumber === 99 && /not on this blueprint/.test(e.message)),
    'unknown question case: error identifies the unrecognised question'
  );

  const nonNumericCase = validateMarksAgainstBlueprint(blueprint, { '1': 'eight', '2': 10 });
  assert(!nonNumericCase.valid, 'non-numeric marks: invalid');

  const missingCase = validateMarksAgainstBlueprint(blueprint, { '1': 8 });
  assert(missingCase.valid, 'omitted question is not itself a validation error');
  assertEq(missingCase.missingQuestions, [2], 'missing question 2 is reported separately');

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 3: validateLearnerResultsAgainstBlueprint()
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 3: validateLearnerResultsAgainstBlueprint() ───────────────');

  const draftOnly = createBlueprint(
    PHONE,
    { title: 'Unpublished Test', subject: 'Life Orientation', grade: 6, term: 2, totalMarks: 10 },
    [{ questionNumber: 1, topic: 'Anything', maxMarks: 10 }]
  );
  assertThrows(
    () => validateLearnerResultsAgainstBlueprint(draftOnly.blueprintId, []),
    'must be published before marks can be imported',
    'refuses to validate marks against a draft (unpublished) blueprint'
  );

  const classResults = validateLearnerResultsAgainstBlueprint(published.blueprintId, [
    { learnerName: 'Thabo Mokoena', questionData: { '1': 8, '2': 10 } },
    { learnerName: 'Naledi Dube', questionData: { '1': 15, '2': 10 } },
  ]);
  assertEq(classResults.results[0].valid, true, 'class validation: learner within max_marks is valid');
  assertEq(classResults.results[0].total, 18, 'class validation: learner total computed correctly');
  assertEq(classResults.results[1].valid, false, 'class validation: learner exceeding max_marks is invalid');

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 4: End-to-end via processAssessmentData()
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 4: processAssessmentData() with a published blueprint ────');

  const diagnosticResult = await processAssessmentData(PHONE, {
    title: 'Fractions Test',
    grade: 6,
    subject: 'Life Orientation',
    term: 2,
    type: 'test',
    totalMarks: 20,
    blueprintId: published.blueprintId,
    blueprintVersion: blueprint.version,
    learnerResults: [
      { learnerName: 'Thabo Mokoena', questionData: { '1': 8, '2': 10 } },   // valid, total 18
      { learnerName: 'Naledi Dube', questionData: { '1': 15, '2': 10 } },   // invalid, exceeds Q1 max
    ],
  });

  assert(!diagnosticResult.error, 'processAssessmentData completes without error');
  assertEq(
    diagnosticResult.skippedLearners,
    ['Naledi Dube'],
    'learner failing blueprint validation is skipped and reported'
  );

  const storedAssessment = _db.prepare(`SELECT * FROM assessments WHERE id = ?`).get(diagnosticResult.assessmentId);
  assertEq(storedAssessment.blueprint_id, published.blueprintId, 'stored assessment snapshots blueprint_id');
  assertEq(storedAssessment.blueprint_version, blueprint.version, 'stored assessment snapshots blueprint_version');

  const storedResults = _db.prepare(`SELECT * FROM learner_results WHERE assessment_id = ?`).all(diagnosticResult.assessmentId);
  assertEq(storedResults.length, 1, 'only the valid learner was stored');
  assertEq(storedResults[0].learner_name, 'Thabo Mokoena', 'the stored row belongs to the valid learner');
  assertEq(storedResults[0].mark, 18, "valid learner's mark is derived from blueprint (sum of per-question marks), not free-form");
  assertEq(storedResults[0].total_marks, 20, "valid learner's totalMarks is the blueprint/assessment total");

  // ── Summary ─────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`Migration 030 / Blueprint Marks Import Results: ${passed} passed, ${failed} failed`);

  testDb.cleanup();

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
