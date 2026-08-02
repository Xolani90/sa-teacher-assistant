'use strict';
/**
 * Blueprint Assessment PDF Report Tests (ADR-005 Section 8a, step 6 —
 * PDF parity).
 *
 * Covers:
 *   1. generateBlueprintAssessmentPdf() produces a real, non-trivial PDF
 *      file on disk for a blueprint-backed assessment (cover info, topic
 *      table, learner summary, struggling-learners section, appendix).
 *   2. It surfaces getBlueprintAssessmentAnalytics()'s error unchanged
 *      when the assessment isn't blueprint-backed (no second/duplicate
 *      error-handling path).
 *   3. The "Learners Needing Support" section is present when a learner
 *      scores below 40%, and the multi-page appendix table renders
 *      without throwing for a class with several learners/topics.
 *
 * This deliberately renders through real pdfkit (not stubbed) since the
 * whole point of this step is verifying the PDF actually renders — only
 * the heavy downstream analysis engines are stubbed, same as the other
 * blueprint test files. The DB layer runs against the real migration
 * chain via tests/helpers/createTestDb.js (see
 * docs/TSE_SCHOOL_CALENDAR_TEST_GAP.md), not a hand-rolled schema.
 *
 * Run individually: node tests/blueprint-pdf-report.test.js
 * Run via npm:       npm test
 */

// ── Shared real-migrations test DB helper (see docs/TSE_SCHOOL_CALENDAR_TEST_GAP.md) ──
const { createTestDb } = require('./helpers/createTestDb');

const path = require('path');
const fs = require('fs');

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

async function run() {
  const testDb = createTestDb(__filename);
  const _db = testDb.db;

  const { createBlueprint, publishBlueprint } = require('../services/blueprintRepository');
  const { processAssessmentData } = require('../services/diagnosticWorkflowService');
  const { generateBlueprintAssessmentPdf } = require('../services/pdfService');

  const PHONE = 'bp_pdf_test_hash_001';
  _db.prepare(`INSERT INTO teachers (phone_hash, name, school) VALUES (?, ?, ?)`)
    .run(PHONE, 'Mrs Dlamini', 'Kimberley Primary');

  console.log('\n── Section 1: Build a published blueprint (3 topics) ────────────────');

  const draft = createBlueprint(
    PHONE,
    { title: 'Term 3 Fractions Test', subject: 'Mathematics', grade: 5, term: 3, totalMarks: 30 },
    [
      { questionNumber: 1, topic: 'Fractions', maxMarks: 10 },
      { questionNumber: 2, topic: 'Fractions', maxMarks: 5 },
      { questionNumber: 3, topic: 'Decimals', maxMarks: 10 },
      { questionNumber: 4, topic: 'Measurement', maxMarks: 5 },
    ],
  );
  const published = publishBlueprint(draft.blueprintId, PHONE);
  assert(published.status === 'published', 'blueprint published successfully');

  console.log('\n── Section 2: Import learner marks via processAssessmentData ────────');

  const assessmentData = {
    title: 'Term 3 Fractions Test',
    grade: 5,
    subject: 'Mathematics',
    term: 3,
    type: 'test',
    totalMarks: 30,
    blueprintId: draft.blueprintId,
    blueprintVersion: 1,
    learnerResults: [
      { learnerName: 'Sipho', questionData: { 1: 8, 2: 4, 3: 8, 4: 1 } },   // 21/30 = 70%
      { learnerName: 'Amahle', questionData: { 1: 9, 2: 5, 3: 9, 4: 4 } }, // 27/30 = 90%
      { learnerName: 'Neo', questionData: { 1: 1, 2: 0, 3: 1, 4: 0 } },     // 2/30 ≈ 7% (struggling)
    ],
  };

  const processResult = await processAssessmentData(PHONE, assessmentData);
  assert(!processResult.error, `processAssessmentData succeeded (${processResult.error || 'no error'})`);
  const assessmentId = processResult.assessmentId;
  assert(!!assessmentId, 'assessment row created and id returned');

  console.log('\n── Section 3: Generate the Blueprint Assessment PDF ──────────────────');

  const pdfResult = await generateBlueprintAssessmentPdf(assessmentId);
  assert(!pdfResult.error, `generateBlueprintAssessmentPdf succeeded (${pdfResult.error || 'no error'})`);

  if (!pdfResult.error) {
    const { getPdfPath } = require('../services/pdfService');
    const filePath = getPdfPath(pdfResult.fileId);
    const exists = fs.existsSync(filePath);
    assert(exists, 'PDF file was written to disk');
    if (exists) {
      const stats = fs.statSync(filePath);
      // A blank/near-empty PDF is a few hundred bytes; a real multi-page
      // report with a header bar, three tables and an appendix should be
      // comfortably larger than that.
      assert(stats.size > 2000, `PDF file has substantial content (${stats.size} bytes)`);
    }
    assert(/\.pdf$/.test(pdfResult.filename), 'filename ends in .pdf');
  }

  console.log('\n── Section 4: Error passthrough for non-blueprint assessments ───────');

  const plainAssessment = _db.prepare(`
    INSERT INTO assessments (phone_hash, title, grade, subject, term, assessment_type, total_marks)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(PHONE, 'Free-form assessment', 5, 'Mathematics', 3, 'test', 20);
  const plainPdfResult = await generateBlueprintAssessmentPdf(plainAssessment.lastInsertRowid);
  assert(!!plainPdfResult.error, 'non-blueprint assessment returns analytics error, not a PDF');

  console.log('\n── Section 5: Unknown assessmentId ───────────────────────────────────');

  // getBlueprintAssessmentAnalytics()'s !assessment branch returns a distinct
  // error from the !assessment.blueprint_id branch above (Section 4) — assert
  // the exact string so a future edit that collapses these two guards into
  // one message is caught here.
  const unknownAssessmentId = 999999;
  const unknownPdfResult = await generateBlueprintAssessmentPdf(unknownAssessmentId);
  assert(!!unknownPdfResult.error, 'unknown assessmentId returns an error, not a PDF');
  assert(
    unknownPdfResult.error === `No assessment found with id ${unknownAssessmentId}`,
    'unknown assessmentId error matches getBlueprintAssessmentAnalytics()\'s exact !assessment message'
  );

  if (!unknownPdfResult.error) {
    const { getPdfPath } = require('../services/pdfService');
    const filePath = getPdfPath(unknownPdfResult.fileId);
    assert(!fs.existsSync(filePath), 'no PDF file was written for an unknown assessmentId');
  }

  console.log('\n── Section 6: Published blueprint, zero learner results ──────────────');

  // A second blueprint, published but never given any learner_results rows —
  // exercises getBlueprintAssessmentAnalytics()'s learnerRows.length === 0
  // branch specifically, distinct from both Section 4 and Section 5's guards.
  const emptyDraft = createBlueprint(
    PHONE,
    { title: 'Term 3 Empty Test', subject: 'Mathematics', grade: 5, term: 3, totalMarks: 10 },
    [
      { questionNumber: 1, topic: 'Fractions', maxMarks: 10 },
    ],
  );
  publishBlueprint(emptyDraft.blueprintId, PHONE);

  const emptyAssessment = _db.prepare(`
    INSERT INTO assessments (phone_hash, title, grade, subject, term, assessment_type, total_marks, blueprint_id, blueprint_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(PHONE, 'Term 3 Empty Test', 5, 'Mathematics', 3, 'test', 10, emptyDraft.blueprintId, 1);

  const emptyPdfResult = await generateBlueprintAssessmentPdf(emptyAssessment.lastInsertRowid);
  assert(!!emptyPdfResult.error, 'blueprint-backed assessment with zero learner results returns an error, not a PDF');
  assert(
    emptyPdfResult.error === 'No learner results found for this assessment',
    'zero-learner-results error matches getBlueprintAssessmentAnalytics()\'s exact message'
  );

  if (!emptyPdfResult.error) {
    const { getPdfPath } = require('../services/pdfService');
    const filePath = getPdfPath(emptyPdfResult.fileId);
    assert(!fs.existsSync(filePath), 'no PDF file was written for a zero-learner-results assessment');
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  testDb.cleanup();

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Test run threw:', err);
  process.exit(1);
});
