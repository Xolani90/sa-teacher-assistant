'use strict';
/**
 * TSE Evidence Engine — hook integration tests (Sprint 1, rebuilt).
 *
 * Covers all six existing write paths that now call tagEvidence():
 *   1. teacherWorkspaceService.saveResource()          → 'resource'
 *   2. diagnosticWorkflowService.storeAssessment()      → 'assessment'
 *   3. interventionReportsService.saveReport()          → 'assessment'
 *   4. interventionPlanService.saveInterventionPlan()   → 'intervention'
 *   5. curriculumCoverageService.markTopicCovered()     → 'curriculum'
 *   6. observationRepository.saveObservationSubmission()→ 'observation'
 *
 * Each write function → asserts exactly one evidence row lands with the
 * correct category/source. Failure-path case: a save that throws before
 * insert produces zero evidence rows.
 *
 * Run individually:   node tests/tseEvidenceHooks.test.js
 * Run via npm:        npm test
 */

// ── Shared real-migrations test DB helper (see docs/TSE_SCHOOL_CALENDAR_TEST_GAP.md) ──
const { createTestDb } = require('./helpers/createTestDb');

let _db = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ FAIL: ${label}`); failed++; }
}

function assertEq(a, b, label) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) { console.log(`  ✅ ${label}`); passed++; }
  else {
    console.error(`  ❌ FAIL: ${label}`);
    console.error(`     expected: ${JSON.stringify(b)}`);
    console.error(`     got:      ${JSON.stringify(a)}`);
    failed++;
  }
}

function evidenceRows(sourceTable, sourceId) {
  return _db
    .prepare(`SELECT * FROM tse_evidence_links WHERE source_table = ? AND source_id = ?`)
    .all(sourceTable, sourceId);
}

async function run() {
  const testDb = createTestDb(__filename);
  _db = testDb.db;

  const PHONE = 'hooks_test_hash_001';
  _db.prepare(`INSERT INTO teachers (phone_hash, name) VALUES (?, 'Test Teacher')`).run(PHONE);

  const { saveResource } = require('../services/teacherWorkspaceService');
  const { storeAssessment } = require('../services/diagnosticWorkflowService');
  const { saveReport } = require('../services/interventionReportsService');
  const { saveInterventionPlan } = require('../services/interventionPlanService');
  const { markTopicCovered } = require('../services/curriculumCoverageService');
  const { saveObservationSubmission } = require('../services/observationRepository');

  console.log('\n── Hook 1: teacherWorkspaceService.saveResource() ───────────────────');
  const resource = saveResource(PHONE, 'worksheet', 'Fractions WS', 'content body', { grade: 5, subject: 'Maths' });
  const resourceEvidence = evidenceRows('saved_resources', resource.id ?? resource.rowid ?? resource.lastInsertRowid);
  assertEq(resourceEvidence.length, 1, 'exactly one evidence row for saveResource');
  if (resourceEvidence.length) assertEq(resourceEvidence[0].category, 'resource', 'saveResource evidence tagged as resource');

  console.log('\n── Hook 2: diagnosticWorkflowService.storeAssessment() ──────────────');
  const assessmentId = storeAssessment(PHONE, { title: 'Term 3 Test', grade: 5, subject: 'Maths', term: 3, type: 'test', totalMarks: 50 });
  const assessmentEvidence = evidenceRows('assessments', assessmentId);
  assertEq(assessmentEvidence.length, 1, 'exactly one evidence row for storeAssessment');
  if (assessmentEvidence.length) assertEq(assessmentEvidence[0].category, 'assessment', 'storeAssessment evidence tagged as assessment');

  console.log('\n── Hook 3: interventionReportsService.saveReport() ──────────────────');
  const reportId = saveReport(PHONE, assessmentId, 'diagnostic', 'Report content here');
  const reportEvidence = evidenceRows('reports', reportId);
  assertEq(reportEvidence.length, 1, 'exactly one evidence row for saveReport');
  if (reportEvidence.length) assertEq(reportEvidence[0].category, 'assessment', 'saveReport evidence tagged as assessment (downstream of an assessment)');

  console.log('\n── Hook 4: interventionPlanService.saveInterventionPlan() ───────────');
  const planId = saveInterventionPlan({
    phoneHash: PHONE,
    assessmentId,
    problemArea: 'Fractions',
    targetGroup: 'Bottom quartile',
    goals: 'Improve fraction accuracy',
    durationDays: 14,
    strategies: 'Small-group drills',
    resources: null,
    monitoringPlan: null,
    successIndicators: null,
    status: 'active',
  });
  const planEvidence = evidenceRows('intervention_plans', planId);
  assertEq(planEvidence.length, 1, 'exactly one evidence row for saveInterventionPlan');
  if (planEvidence.length) assertEq(planEvidence[0].category, 'intervention', 'saveInterventionPlan evidence tagged as intervention');

  console.log('\n── Hook 5: curriculumCoverageService.markTopicCovered() ─────────────');
  markTopicCovered(PHONE, 5, 'Maths', 3, 'Fractions');
  const coverageRow = _db.prepare(`SELECT id FROM curriculum_coverage WHERE phone_hash=? AND topic='Fractions'`).get(PHONE);
  const coverageEvidence = evidenceRows('curriculum_coverage', coverageRow.id);
  assertEq(coverageEvidence.length, 1, 'exactly one evidence row for markTopicCovered');
  if (coverageEvidence.length) assertEq(coverageEvidence[0].category, 'curriculum', 'markTopicCovered evidence tagged as curriculum');

  console.log('\nTest H5-repeat: re-marking the same topic covered does not duplicate evidence (upsert idempotency)');
  markTopicCovered(PHONE, 5, 'Maths', 3, 'Fractions');
  assertEq(evidenceRows('curriculum_coverage', coverageRow.id).length, 1, 'still exactly one evidence row after re-marking same topic');

  console.log('\n── Hook 6: observationRepository.saveObservationSubmission() ────────');
  const obsResult = saveObservationSubmission(
    PHONE,
    { grade: '3', subject: 'Literacy', assessment: 'Term 3 Observation' },
    [{ learnerName: 'Test Learner A', domain: 'Reading', developmentalStatus: 'Achieving' }]
  );
  const obsEvidence = evidenceRows('observation_assessments', obsResult.assessmentId);
  assertEq(obsEvidence.length, 1, 'exactly one evidence row for saveObservationSubmission');
  if (obsEvidence.length) assertEq(obsEvidence[0].category, 'observation', 'saveObservationSubmission evidence tagged as observation');

  console.log('\n── Failure path ──────────────────────────────────────────────────────');

  console.log('\nTest FAIL-01: a failed observation save (invalid input) produces zero evidence rows');
  let threw = false;
  try {
    saveObservationSubmission(PHONE, { grade: '3' }, []); // empty records → throws before any insert
  } catch (e) { threw = true; }
  assert(threw === true, 'saveObservationSubmission throws on empty records array');
  const totalEvidenceBeforeVsAfter = _db.prepare(`SELECT COUNT(*) as c FROM tse_evidence_links WHERE source_table='observation_assessments'`).get();
  assertEq(totalEvidenceBeforeVsAfter.c, 1, 'no new evidence row was created by the failed call (still just the one from Hook 6)');

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`tseEvidenceHooks.test.js: ${passed} passed, ${failed} failed`);

  testDb.cleanup();

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Test run crashed:', err);
  process.exit(1);
});
