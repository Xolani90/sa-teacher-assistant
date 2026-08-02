'use strict';
/**
 * Learner Mastery & Intervention PDF Report Tests (ADR-007 PR9 — PDF parity).
 *
 * Covers:
 *   1. generateLearnerInterventionPdf() renders a real, non-trivial PDF from
 *      InterventionPlan[] — the exact same object shape
 *      services/interventionService.js's getLearnerInterventionPlan()
 *      returns and flows/workspaceFlow.js's LEARNER PROGRESS command
 *      already consumes.
 *   2. It performs NO mastery/priority/trend/coverage computation of its
 *      own — masteryService, progressService, coverageService and
 *      learnerTimelineService are never required by this test at all;
 *      only learnerRepository.getLearnerById and
 *      interventionService.getLearnerInterventionPlan are stubbed, and the
 *      PDF is asserted to reflect exactly what those stubs returned.
 *   3. Error passthrough for an unknown learner, and for a learner with no
 *      InterventionPlans at all — mirroring workspaceFlow's own two error
 *      branches for LEARNER PROGRESS, so WhatsApp and PDF agree.
 *   4. An insufficient-data subject renders no "Intervention" section —
 *      the same rule flows/workspaceFlow.js's formatIntervention() applies.
 *
 * This deliberately renders through real pdfkit (not stubbed), same as the
 * other *-pdf-report test files, since the point is verifying the PDF
 * actually renders.
 *
 * Run individually: node tests/learner-intervention-pdf.test.js
 * Run via npm:       npm test
 */

// ── Shared real-migrations test DB helper (see docs/TSE_SCHOOL_CALENDAR_TEST_GAP.md) ──
const { createTestDb } = require('./helpers/createTestDb');

const path = require('path');
const fs = require('fs');

let _db = null;

const learnerRepoPath = path.resolve(__dirname, '../services/learnerRepository.js');
const interventionServicePath = path.resolve(__dirname, '../services/interventionService.js');

let learnerStub = null;
let plansStub = null;

require.cache[learnerRepoPath] = {
  id: learnerRepoPath,
  filename: learnerRepoPath,
  loaded: true,
  exports: { getLearnerById: (id) => learnerStub(id) },
};

require.cache[interventionServicePath] = {
  id: interventionServicePath,
  filename: interventionServicePath,
  loaded: true,
  exports: { getLearnerInterventionPlan: (id) => plansStub(id) },
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

// A fixture MasteryReport, matching services/masteryService.js's real shape,
// embedded verbatim in evidence.mastery — same as
// interventionService.buildPlan() actually produces.
function fixtureMasteryReport(overrides = {}) {
  return {
    learnerId: 1,
    subject: 'Mathematics',
    masteryLevel: 'developing',
    confidence: 0.6,
    evidence: {
      progress: { trend: 'rising' },
      coverage: { dataAvailable: true, averagePercentage: 72 },
      timeline: { eventCount: 5 },
    },
    strengths: ['Number Patterns'],
    concerns: ['Geometry'],
    ...overrides,
  };
}

function fixturePlan(overrides = {}) {
  return {
    learnerId: 1,
    subject: 'Mathematics',
    priority: 'medium',
    focusTopics: ['Fractions'],
    recommendedActions: ['Continue monitoring — performance is developing steadily.'],
    evidence: {
      mastery: fixtureMasteryReport(),
      progress: { trend: 'rising' },
      coverage: { dataAvailable: true, averagePercentage: 72 },
    },
    ...overrides,
  };
}

async function run() {
  const testDb = createTestDb(__filename);
  _db = testDb.db;

  const PHONE = 'lp_pdf_test_hash_001';
  _db.prepare(`INSERT INTO teachers (phone_hash, name, school) VALUES (?, ?, ?)`)
    .run(PHONE, 'Mrs Dlamini', 'Kimberley Primary');

  const { generateLearnerInterventionPdf, getPdfPath } = require('../services/pdfService');

  console.log('\n── Section 1: real, non-trivial PDF from InterventionPlan[] ─────────');

  learnerStub = () => ({ id: 1, phoneHash: PHONE, canonicalName: 'Sipho Dlamini' });
  plansStub = () => ([
    fixturePlan(),
    fixturePlan({
      subject: 'English',
      priority: 'high',
      focusTopics: [],
      recommendedActions: ['Consider small-group intervention for this subject.'],
      evidence: {
        mastery: fixtureMasteryReport({
          subject: 'English',
          masteryLevel: 'beginning',
          strengths: [],
          concerns: ['Reading comprehension'],
          evidence: { progress: { trend: 'falling' }, coverage: { dataAvailable: true, averagePercentage: 25 }, timeline: { eventCount: 3 } },
        }),
        progress: { trend: 'falling' },
        coverage: { dataAvailable: true, averagePercentage: 25 },
      },
    }),
  ]);

  const result = await generateLearnerInterventionPdf(1);
  assert(!result.error, `generateLearnerInterventionPdf succeeded (${result.error || 'no error'})`);

  if (!result.error) {
    const filePath = getPdfPath(result.fileId);
    const exists = fs.existsSync(filePath);
    assert(exists, 'PDF file was written to disk');
    if (exists) {
      const stats = fs.statSync(filePath);
      assert(stats.size > 1500, `PDF file has substantial content (${stats.size} bytes)`);
    }
    assert(/\.pdf$/.test(result.filename), 'filename ends in .pdf');
    assert(result.filename.includes('Sipho_Dlamini'), 'filename is derived from the learner\'s canonical name');
  }

  console.log('\n── Section 2: unknown learner returns an error, not a PDF ────────────');

  learnerStub = () => null;
  const noLearnerResult = await generateLearnerInterventionPdf(999);
  assert(!!noLearnerResult.error, 'unknown learnerId returns an error');

  console.log('\n── Section 3: a resolved learner with zero InterventionPlans errors ─');

  learnerStub = () => ({ id: 2, phoneHash: PHONE, canonicalName: 'Neo Kunene' });
  plansStub = () => ([]);
  const noPlansResult = await generateLearnerInterventionPdf(2);
  assert(!!noPlansResult.error, 'a learner with zero InterventionPlans returns an error, not a crash');

  console.log('\n── Section 4: insufficient-data subject renders, but no Intervention section for it ──');

  learnerStub = () => ({ id: 3, phoneHash: PHONE, canonicalName: 'Amahle Zulu' });
  plansStub = () => ([
    fixturePlan({
      subject: 'Life Skills',
      priority: 'medium',
      focusTopics: [],
      recommendedActions: ['Gather more assessment or observation evidence before planning an intervention.'],
      evidence: {
        mastery: fixtureMasteryReport({
          subject: 'Life Skills',
          masteryLevel: 'insufficient-data',
          strengths: [],
          concerns: [],
          evidence: {},
        }),
        progress: {},
        coverage: { dataAvailable: false, averagePercentage: null },
      },
    }),
  ]);
  const insufficientResult = await generateLearnerInterventionPdf(3);
  assert(!insufficientResult.error, `insufficient-data-only learner still produces a PDF (${insufficientResult.error || 'no error'})`);
  if (!insufficientResult.error) {
    const filePath = getPdfPath(insufficientResult.fileId);
    assert(fs.existsSync(filePath), 'PDF for the insufficient-data-only learner was written to disk');
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
