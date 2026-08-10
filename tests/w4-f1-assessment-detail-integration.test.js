'use strict';
/**
 * W4-F1 remediation evidence — GET /api/assessments/:assessmentId/detail
 * (averageFacilityValue, averageDiscrimination, targetGroupSize)
 *
 * Standard: real express app (apiLimiter + requireTeacherAuth + the real
 * assessments handler/service), real in-memory DB built from the actual
 * migration chain, real signed JWTs, real HTTP over an ephemeral port,
 * data seeded through the REAL production pipeline
 * (blueprintRepository.createBlueprint/publishBlueprint +
 * diagnosticWorkflowService.processAssessmentData) — no stubbing of
 * itemAnalysisService/interventionPlanService, since the whole point is
 * to prove the detail response's new fields match those services' real
 * output, not a mock's.
 *
 * This does not merely assert the fields exist — for every scenario it
 * independently recomputes performItemAnalysis()/computeInterventionPlan()
 * against the SAME assessmentId and asserts numeric equality against
 * what /detail returned.
 *
 * Read-only investigation for RC-1 W4-F1 remediation. Application code
 * change under test: services/assessmentDetailService.js only.
 *
 * Run individually: node tests/w4-f1-assessment-detail-integration.test.js
 */

process.env.TEACHER_JWT_SECRET = 'w4-f1-integration-test-secret';

const { createTestDb } = require('./helpers/createTestDb');
const testDb = createTestDb(__filename);
const db = testDb.db;

const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');

const { requireTeacherAuth, apiLimiter } = require('../utils/teacherAuth');
const { getAssessmentDetail } = require('../services/assessmentDetailService');
const { performItemAnalysis } = require('../services/itemAnalysisService');
const { computeInterventionPlan } = require('../services/interventionPlanService');
const { createBlueprint, publishBlueprint } = require('../services/blueprintRepository');
const { processAssessmentData } = require('../services/diagnosticWorkflowService');

let passed = 0;
let failed = 0;

function assert(label, condition, extra) {
  if (condition) {
    console.log(`  \u2705 ${label}`);
    passed++;
  } else {
    console.error(`  \u274c FAIL: ${label}${extra ? ' — ' + extra : ''}`);
    failed++;
  }
}
function assertEqual(label, actual, expected) {
  assert(label, actual === expected, `expected ${expected}, got ${actual}`);
}

function signToken(teacherId) {
  return jwt.sign({ sub: teacherId }, process.env.TEACHER_JWT_SECRET, { expiresIn: '1h' });
}
function httpGet(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ port, path, headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch (_) { /* non-JSON */ }
        resolve({ status: res.statusCode, body: parsed });
      });
    }).on('error', reject);
  });
}

// Handler copied verbatim from routes/api.js (see prior W7 integration
// tests for why the full router isn't required directly — pdfkit/xlsx
// aren't installable in this sandbox). Route-wiring parity checked below.
function createGetAssessmentDetailHandler({ getAssessmentDetail }) {
  return function handleGetAssessmentDetail(req, res) {
    const assessmentId = Number(req.params.assessmentId);
    if (!Number.isInteger(assessmentId) || assessmentId <= 0) {
      return res.status(400).json({ error: 'assessmentId must be a positive integer.' });
    }
    let detail;
    try {
      detail = getAssessmentDetail(req.teacher.phoneHash, assessmentId);
    } catch (err) {
      console.error('[API] getAssessmentDetail failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
    if (!detail) {
      return res.status(404).json({ error: 'Assessment not found.' });
    }
    return res.status(200).json(detail);
  };
}

async function run() {
  console.log('W4-F1 remediation — REAL HTTP/DB integration evidence');
  console.log('='.repeat(75));

  const app = express();
  app.use(express.json());
  const router = express.Router();
  router.get('/assessments/:assessmentId/detail', createGetAssessmentDetailHandler({ getAssessmentDetail }));
  app.use('/api', apiLimiter, requireTeacherAuth, router);
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  const server = app.listen(0);
  const port = server.address().port;

  const apiSrc = require('fs').readFileSync(require('path').join(__dirname, '../routes/api.js'), 'utf8');
  const wiringIntact = /router\.get\(\s*'\/assessments\/:assessmentId\/detail',\s*createGetAssessmentDetailHandler/.test(apiSrc);
  assert("routes/api.js still wires GET .../detail to createGetAssessmentDetailHandler", wiringIntact);

  const PHONE = 'w4f1_test_hash_001';
  db.prepare(`INSERT INTO teachers (phone_hash) VALUES (?)`).run(PHONE);
  const teacherRow = db.prepare(`SELECT id FROM teachers WHERE phone_hash = ?`).get(PHONE);
  const token = signToken(teacherRow.id);

  const draft = createBlueprint(
    PHONE,
    { title: 'W4-F1 Evidence Test', subject: 'Mathematics', grade: 6, term: 2, totalMarks: 20 },
    [
      { questionNumber: 1, topic: 'fractions', maxMarks: 10 },
      { questionNumber: 2, topic: 'algebra', maxMarks: 10 },
    ]
  );
  const published = publishBlueprint(draft.blueprintId, PHONE);

  // ═══════════════════════════════════════════════════════════════
  // SCENARIO A: 12 learners (>=10) — real discrimination signal,
  // mixed performance so Groups C/D (intervention targets) are non-empty.
  // ═══════════════════════════════════════════════════════════════
  console.log('\n\u2500\u2500 Scenario A: 12-learner class (\u226510, real discrimination + target group) \u2500\u2500');
  const learnersA = [
    { learnerName: 'Learner 01', questionData: { '1': 10, '2': 10 } },
    { learnerName: 'Learner 02', questionData: { '1': 9, '2': 9 } },
    { learnerName: 'Learner 03', questionData: { '1': 9, '2': 8 } },
    { learnerName: 'Learner 04', questionData: { '1': 8, '2': 8 } },
    { learnerName: 'Learner 05', questionData: { '1': 7, '2': 6 } },
    { learnerName: 'Learner 06', questionData: { '1': 6, '2': 6 } },
    { learnerName: 'Learner 07', questionData: { '1': 5, '2': 5 } },
    { learnerName: 'Learner 08', questionData: { '1': 4, '2': 4 } },
    { learnerName: 'Learner 09', questionData: { '1': 3, '2': 3 } },
    { learnerName: 'Learner 10', questionData: { '1': 2, '2': 2 } },
    { learnerName: 'Learner 11', questionData: { '1': 1, '2': 1 } },
    { learnerName: 'Learner 12', questionData: { '1': 0, '2': 0 } },
  ];
  const diagA = processAssessmentData(PHONE, {
    title: 'W4-F1 Scenario A', grade: 6, subject: 'Mathematics', term: 2, type: 'test',
    totalMarks: 20, blueprintId: published.blueprintId, blueprintVersion: 1,
    learnerResults: learnersA,
  });
  assert('Scenario A: processAssessmentData completed without error', !diagA.error);
  const assessmentIdA = diagA.assessmentId;

  const expectedItemAnalysisA = performItemAnalysis(assessmentIdA);
  const expectedPlanA = computeInterventionPlan(PHONE, assessmentIdA);
  const expectedTargetGroupSizeA = (expectedPlanA.targetGroups || []).reduce((s, g) => s + g.count, 0);

  const resA = await httpGet(port, `/api/assessments/${assessmentIdA}/detail`, { Authorization: `Bearer ${token}` });
  assertEqual('Scenario A: GET .../detail returns 200', resA.status, 200);
  assert('Scenario A: itemAnalysis.available is true', resA.body.itemAnalysis && resA.body.itemAnalysis.available === true);
  assertEqual(
    'Scenario A: averageFacilityValue matches performItemAnalysis() independently recomputed',
    resA.body.itemAnalysis.averageFacilityValue,
    expectedItemAnalysisA.averageFacilityValue
  );
  assertEqual(
    'Scenario A: averageDiscrimination matches performItemAnalysis() independently recomputed',
    resA.body.itemAnalysis.averageDiscrimination,
    expectedItemAnalysisA.averageDiscrimination
  );
  assertEqual(
    'Scenario A: interventionSummary.targetGroupSize matches Sum(computeInterventionPlan().targetGroups[].count)',
    resA.body.interventionSummary.targetGroupSize,
    expectedTargetGroupSizeA
  );
  assert('Scenario A: targetGroupSize is non-zero (12-learner class has a real spread, Groups C/D expected non-empty)',
    expectedTargetGroupSizeA > 0, `got ${expectedTargetGroupSizeA}`);
  assert('Scenario A: insufficientDataQuestionCount is 0 (12 >= 10 learners, discrimination is reliably calculable)',
    resA.body.itemAnalysis.insufficientDataQuestionCount === 0);

  // ═══════════════════════════════════════════════════════════════
  // SCENARIO B: 4 learners (<10) — preserve existing insufficient_data
  // semantics. W4-F1's own stop condition explicitly calls this out:
  // discriminationIndex=0 here is BY DESIGN (not enough data), not a
  // defect to "fix" into some other value, and must not be presented
  // as a bare, unexplained zero.
  // ═══════════════════════════════════════════════════════════════
  console.log('\n\u2500\u2500 Scenario B: 4-learner class (<10, insufficient_data semantics) \u2500\u2500');
  const learnersB = [
    { learnerName: 'Small A', questionData: { '1': 10, '2': 10 } },
    { learnerName: 'Small B', questionData: { '1': 5, '2': 5 } },
    { learnerName: 'Small C', questionData: { '1': 2, '2': 2 } },
    { learnerName: 'Small D', questionData: { '1': 0, '2': 0 } },
  ];
  const diagB = processAssessmentData(PHONE, {
    title: 'W4-F1 Scenario B', grade: 6, subject: 'Mathematics', term: 2, type: 'test',
    totalMarks: 20, blueprintId: published.blueprintId, blueprintVersion: 1,
    learnerResults: learnersB,
  });
  assert('Scenario B: processAssessmentData completed without error', !diagB.error);
  const assessmentIdB = diagB.assessmentId;

  const expectedItemAnalysisB = performItemAnalysis(assessmentIdB);
  const resB = await httpGet(port, `/api/assessments/${assessmentIdB}/detail`, { Authorization: `Bearer ${token}` });
  assertEqual('Scenario B: GET .../detail returns 200', resB.status, 200);
  assertEqual(
    'Scenario B: averageDiscrimination matches performItemAnalysis() independently recomputed (0, by design for <10)',
    resB.body.itemAnalysis.averageDiscrimination,
    expectedItemAnalysisB.averageDiscrimination
  );
  assert('Scenario B: averageDiscrimination is exactly 0 (not null, not a crash — the documented small-class behavior)',
    resB.body.itemAnalysis.averageDiscrimination === 0, `got ${resB.body.itemAnalysis.averageDiscrimination}`);
  assertEqual(
    'Scenario B: averageFacilityValue still computes normally (unaffected by the <10 threshold)',
    resB.body.itemAnalysis.averageFacilityValue,
    expectedItemAnalysisB.averageFacilityValue
  );
  assert(
    'Scenario B: insufficientDataQuestionCount reflects both questions as insufficient_data (4 < 10 learners) — this distinguishes an EXPLAINED zero from a misleading one',
    resB.body.itemAnalysis.insufficientDataQuestionCount === expectedItemAnalysisB.questions.length,
    `expected ${expectedItemAnalysisB.questions.length}, got ${resB.body.itemAnalysis.insufficientDataQuestionCount}`
  );

  // ═══════════════════════════════════════════════════════════════
  // SCENARIO C: no per-question marks (free-form, total-only) —
  // confirm itemAnalysis.available=false with a reason, not a
  // misleading zero and not a 500.
  // ═══════════════════════════════════════════════════════════════
  console.log('\n\u2500\u2500 Scenario C: free-form assessment, total-only marks (no per-question data) \u2500\u2500');
  const plainAssessment = db.prepare(`
    INSERT INTO assessments (phone_hash, title, grade, subject, term, assessment_type, total_marks)
    VALUES (?, 'Free-form total-only', 6, 'Mathematics', 2, 'test', 20)
  `).run(PHONE);
  const assessmentIdC = Number(plainAssessment.lastInsertRowid);
  db.prepare(`
    INSERT INTO learner_results (assessment_id, learner_name, mark, total_marks, percentage, question_data)
    VALUES (?, 'Total Only Learner', 15, 20, 75, NULL)
  `).run(assessmentIdC);

  const resC = await httpGet(port, `/api/assessments/${assessmentIdC}/detail`, { Authorization: `Bearer ${token}` });
  assertEqual('Scenario C: GET .../detail returns 200 (not 500)', resC.status, 200);
  assert('Scenario C: itemAnalysis.available is false', resC.body.itemAnalysis.available === false);
  assert('Scenario C: itemAnalysis.reason is a non-empty string, not silently null', !!resC.body.itemAnalysis.reason);
  assert('Scenario C: averageFacilityValue/averageDiscrimination are null, not 0 (0 would be indistinguishable from a real low score)',
    resC.body.itemAnalysis.averageFacilityValue === null && resC.body.itemAnalysis.averageDiscrimination === null);
  assert('Scenario C: existing summary.learnerCount still works unaffected (no regression to pre-existing fields)',
    resC.body.summary.learnerCount === 1);

  // ═══════════════════════════════════════════════════════════════
  // SCENARIO D: real learner results, all in Groups A/B — legitimate
  // targetGroupSize: 0, must be a well-formed, successful response,
  // distinguishable from the zero-learner (missing-data) case below.
  // ═══════════════════════════════════════════════════════════════
  console.log('\n\u2500\u2500 Scenario D: real learners, legitimately no intervention target group \u2500\u2500');
  const learnersD = [
    { learnerName: 'High D1', questionData: { '1': 7, '2': 7 } },   // 70%
    { learnerName: 'High D2', questionData: { '1': 9, '2': 8 } },   // 85%
    { learnerName: 'High D3', questionData: { '1': 6, '2': 7 } },   // 65%
  ];
  const diagD = processAssessmentData(PHONE, {
    title: 'W4-F1 Scenario D', grade: 6, subject: 'Mathematics', term: 2, type: 'test',
    totalMarks: 20, blueprintId: published.blueprintId, blueprintVersion: 1,
    learnerResults: learnersD,
  });
  assert('Scenario D: processAssessmentData completed without error', !diagD.error);
  const assessmentIdD = diagD.assessmentId;

  const expectedPlanD = computeInterventionPlan(PHONE, assessmentIdD);
  assert('Scenario D: computeInterventionPlan() did not error for a real, populated assessment', !expectedPlanD.error);
  const expectedTargetGroupSizeD = (expectedPlanD.targetGroups || []).reduce((s, g) => s + g.count, 0);
  assertEqual('Scenario D: independently-invoked computeInterventionPlan() confirms targetGroups sum to 0 (no Group C/D learners)', expectedTargetGroupSizeD, 0);

  const resD = await httpGet(port, `/api/assessments/${assessmentIdD}/detail`, { Authorization: `Bearer ${token}` });
  assertEqual('Scenario D: GET .../detail returns 200 (well-formed, successful response)', resD.status, 200);
  assert('Scenario D: response body has the expected top-level shape (assessment/summary/learners present)',
    !!(resD.body && resD.body.assessment && resD.body.summary && Array.isArray(resD.body.learners)));
  assertEqual('Scenario D: summary.learnerCount is 3 (real captured data)', resD.body.summary.learnerCount, 3);
  assert('Scenario D: interventionSummary is present on the response', !!resD.body.interventionSummary);
  assertEqual('Scenario D: interventionSummary.targetGroupSize is exactly 0 (number, a computed result)', resD.body.interventionSummary.targetGroupSize, 0);
  assert('Scenario D: targetGroupSize is strictly typeof number, not null — proving this is a computed value, not an absent one',
    typeof resD.body.interventionSummary.targetGroupSize === 'number');

  // ═══════════════════════════════════════════════════════════════
  // SCENARIO E: assessment exists, zero learner_results rows —
  // post-fix, computeInterventionPlan() propagates groupLearners()'s
  // "no learner results" error instead of manufacturing an empty
  // plan, so /detail must report targetGroupSize: null here — never
  // the same 0 Scenario D legitimately reports.
  // ═══════════════════════════════════════════════════════════════
  console.log('\n\u2500\u2500 Scenario E: zero learner results \u2014 must be distinguishable from Scenario D\'s legitimate 0 \u2500\u2500');
  const zeroLearnerAssessment = db.prepare(`
    INSERT INTO assessments (phone_hash, title, grade, subject, term, assessment_type, total_marks)
    VALUES (?, 'Zero-learner assessment', 6, 'Mathematics', 2, 'test', 20)
  `).run(PHONE);
  const assessmentIdE = Number(zeroLearnerAssessment.lastInsertRowid);

  const expectedPlanE = computeInterventionPlan(PHONE, assessmentIdE);
  assert('Scenario E: computeInterventionPlan() now returns an error for zero learner_results (the fix)', !!expectedPlanE.error);

  const resE = await httpGet(port, `/api/assessments/${assessmentIdE}/detail`, { Authorization: `Bearer ${token}` });
  assertEqual('Scenario E: GET .../detail returns 200 (well-formed, successful response — not a 404/500)', resE.status, 200);
  assert('Scenario E: response body has the expected top-level shape (assessment/summary/learners present)',
    !!(resE.body && resE.body.assessment && resE.body.summary && Array.isArray(resE.body.learners)));
  assertEqual('Scenario E: summary.learnerCount is 0 (genuinely no learners, reflected honestly)', resE.body.summary.learnerCount, 0);
  assert('Scenario E: interventionSummary is present on the response', !!resE.body.interventionSummary);
  assertEqual('Scenario E: interventionSummary.targetGroupSize is null (missing-data state)', resE.body.interventionSummary.targetGroupSize, null);
  assert(
    'Scenario E: targetGroupSize (null) is NOT the same value as Scenario D\'s legitimate targetGroupSize (0) — the two states are now distinguishable',
    resE.body.interventionSummary.targetGroupSize !== resD.body.interventionSummary.targetGroupSize
  );

  server.close();
  testDb.cleanup();

  console.log('\n' + '='.repeat(75));
  console.log(`Passed: ${passed}  Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('W4-F1 integration test crashed:', err);
  process.exit(1);
});
