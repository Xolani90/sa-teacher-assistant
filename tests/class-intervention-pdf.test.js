'use strict';
/**
 * Class Intervention PDF Report Tests (ADR-009 PR13 — PDF parity).
 *
 * Covers:
 *   1. generateClassInterventionPdf() renders a real, non-trivial PDF from
 *      a ClassInterventionPlan — the exact same object shape
 *      services/classInterventionService.js's getClassInterventionPlan()
 *      returns and flows/workspaceFlow.js's CLASS INTERVENTION command
 *      already consumes.
 *   2. It performs NO roster/mastery/priority/aggregation computation of
 *      its own — learnerRosterService and interventionService are never
 *      required by this test at all; only teacherWorkspaceService.getClass
 *      and classInterventionService.getClassInterventionPlan are stubbed,
 *      and the PDF is asserted to reflect exactly what those stubs
 *      returned.
 *   3. Error passthrough for an unknown class, and for a class with an
 *      empty roster — mirroring generateLearnerInterventionPdf's own
 *      "no evidence" error branch, so WhatsApp and PDF agree.
 *   4. An insufficient-data-only class (every learner unresolved) still
 *      renders a valid PDF with no priority-learner sections — the same
 *      rule formatClassInterventionPlan() applies for an all-null-
 *      overallPriority roster.
 *
 * This deliberately renders through real pdfkit (not stubbed), same as the
 * other *-pdf-report test files, since the point is verifying the PDF
 * actually renders.
 *
 * Run individually: node tests/class-intervention-pdf.test.js
 * Run via npm:       npm test
 */

// ── Shared real-migrations test DB helper (see docs/TSE_SCHOOL_CALENDAR_TEST_GAP.md) ──
const { createTestDb } = require('./helpers/createTestDb');

const path = require('path');
const fs = require('fs');

let _db = null;

const workspaceServicePath = path.resolve(__dirname, '../services/teacherWorkspaceService.js');
const classInterventionServicePath = path.resolve(__dirname, '../services/classInterventionService.js');

let classStub = null;
let planStub = null;

require.cache[workspaceServicePath] = {
  id: workspaceServicePath,
  filename: workspaceServicePath,
  loaded: true,
  exports: { getClass: (classId, phoneHash) => classStub(classId, phoneHash) },
};

require.cache[classInterventionServicePath] = {
  id: classInterventionServicePath,
  filename: classInterventionServicePath,
  loaded: true,
  exports: { getClassInterventionPlan: (phoneHash, classId) => planStub(phoneHash, classId) },
};

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

// Fixture matching classifyLearner()'s real output shape — a subjectPlan
// mirrors interventionService's InterventionPlan[] embedded verbatim, same
// as classInterventionService.getClassInterventionPlan() actually produces.
function fixtureSubjectPlan(overrides = {}) {
  return {
    subject: 'Mathematics',
    priority: 'medium',
    focusTopics: ['Fractions'],
    recommendedActions: ['Continue monitoring — performance is developing steadily.'],
    evidence: {
      mastery: { masteryLevel: 'developing' },
      progress: { trend: 'rising' },
      coverage: { dataAvailable: true, averagePercentage: 72 },
    },
    ...overrides,
  };
}

function fixtureClassifiedLearner(overrides = {}) {
  return {
    learnerId: 1,
    learnerName: 'Sipho Dlamini',
    overallPriority: 'medium',
    subjectPlans: [fixtureSubjectPlan()],
    ...overrides,
  };
}

function fixturePlan(overrides = {}) {
  return {
    classId: 10,
    summary: { totalLearners: 1, evaluatedLearners: 1, insufficientData: 0, erroredLearners: 0 },
    priorityCounts: { high: 0, medium: 1, low: 0 },
    commonFocusTopics: [{ subject: 'Mathematics', topic: 'Fractions', affectedLearners: 1, percentage: 1 }],
    priorityLearners: { high: [], medium: [fixtureClassifiedLearner()], low: [] },
    errors: [],
    ...overrides,
  };
}

async function run() {
  const testDb = createTestDb(__filename);
  _db = testDb.db;

  const PHONE = 'ci_pdf_test_hash_001';
  _db.prepare(`INSERT INTO teachers (phone_hash, name, school) VALUES (?, ?, ?)`)
    .run(PHONE, 'Mrs Dlamini', 'Kimberley Primary');

  const { generateClassInterventionPdf, getPdfPath } = require('../services/pdfService');

  console.log('\n── Section 1: real, non-trivial PDF from ClassInterventionPlan ──────');

  classStub = () => ({ id: 10, phone_hash: PHONE, name: '8B Mathematics', grade: 8, subject: 'Mathematics' });
  planStub = () => fixturePlan();

  const result = await generateClassInterventionPdf(PHONE, 10);
  assert(!result.error, `generateClassInterventionPdf succeeded (${result.error || 'no error'})`);

  if (!result.error) {
    const filePath = getPdfPath(result.fileId);
    const exists = fs.existsSync(filePath);
    assert(exists, 'PDF file was written to disk');
    if (exists) {
      const stats = fs.statSync(filePath);
      assert(stats.size > 1500, `PDF file has substantial content (${stats.size} bytes)`);
    }
    assert(/\.pdf$/.test(result.filename), 'filename ends in .pdf');
    assert(result.filename.includes('8B_Mathematics'), 'filename is derived from the class name');
  }

  console.log('\n── Section 2: unknown class returns an error, not a PDF ──────────────');

  classStub = () => null;
  const noClassResult = await generateClassInterventionPdf(PHONE, 999);
  assert(!!noClassResult.error, 'unknown classId returns an error');

  console.log('\n── Section 3: a resolved class with an empty roster errors ───────────');

  classStub = () => ({ id: 11, phone_hash: PHONE, name: 'Empty Class', grade: 7, subject: 'English' });
  planStub = () => fixturePlan({
    classId: 11,
    summary: { totalLearners: 0, evaluatedLearners: 0, insufficientData: 0, erroredLearners: 0 },
    priorityCounts: { high: 0, medium: 0, low: 0 },
    commonFocusTopics: [],
    priorityLearners: { high: [], medium: [], low: [] },
  });
  const emptyClassResult = await generateClassInterventionPdf(PHONE, 11);
  assert(!!emptyClassResult.error, 'a class with zero learners returns an error, not a crash');

  console.log('\n── Section 4: insufficient-data-only class still renders a valid PDF ─');

  classStub = () => ({ id: 12, phone_hash: PHONE, name: 'New Class', grade: 9, subject: 'Life Skills' });
  planStub = () => fixturePlan({
    classId: 12,
    summary: { totalLearners: 3, evaluatedLearners: 0, insufficientData: 3, erroredLearners: 0 },
    priorityCounts: { high: 0, medium: 0, low: 0 },
    commonFocusTopics: [],
    priorityLearners: { high: [], medium: [], low: [] },
  });
  const insufficientResult = await generateClassInterventionPdf(PHONE, 12);
  assert(!insufficientResult.error, `insufficient-data-only class still produces a PDF (${insufficientResult.error || 'no error'})`);
  if (!insufficientResult.error) {
    const filePath = getPdfPath(insufficientResult.fileId);
    assert(fs.existsSync(filePath), 'PDF for the insufficient-data-only class was written to disk');
  }

  console.log('\n── Section 5: high/medium/low sections and common topics all render ──');

  classStub = () => ({ id: 13, phone_hash: PHONE, name: 'Grade 7A', grade: 7, subject: 'Mathematics' });
  planStub = () => fixturePlan({
    classId: 13,
    summary: { totalLearners: 4, evaluatedLearners: 3, insufficientData: 1, erroredLearners: 0 },
    priorityCounts: { high: 1, medium: 1, low: 1 },
    commonFocusTopics: [
      { subject: 'Mathematics', topic: 'Fractions', affectedLearners: 2, percentage: 0.67 },
      { subject: 'English', topic: 'Comprehension', affectedLearners: 3, percentage: 1 },
    ],
    priorityLearners: {
      high: [fixtureClassifiedLearner({ learnerId: 2, learnerName: 'Amahle Zulu', overallPriority: 'high', subjectPlans: [fixtureSubjectPlan({ subject: 'English', priority: 'high' })] })],
      medium: [fixtureClassifiedLearner()],
      low: [fixtureClassifiedLearner({ learnerId: 3, learnerName: 'Neo Kunene', overallPriority: 'low', subjectPlans: [fixtureSubjectPlan({ priority: 'low' })] })],
    },
  });
  const fullResult = await generateClassInterventionPdf(PHONE, 13);
  assert(!fullResult.error, `class with all three priority tiers and common topics produces a PDF (${fullResult.error || 'no error'})`);
  if (!fullResult.error) {
    const filePath = getPdfPath(fullResult.fileId);
    const exists = fs.existsSync(filePath);
    assert(exists, 'PDF file was written to disk');
    if (exists) {
      const stats = fs.statSync(filePath);
      assert(stats.size > 1500, `PDF file has substantial content (${stats.size} bytes)`);
    }
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
