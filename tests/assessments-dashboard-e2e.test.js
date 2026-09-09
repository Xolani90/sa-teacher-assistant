'use strict';
/**
 * Assessments dashboard integration — end-to-end test against the REAL
 * database and the REAL services/assessmentDetailService.js functions
 * (no mocks), covering the completion requirement:
 *
 *   Teacher captures assessment results via WhatsApp (assessment session
 *   flow persists assessments + learner_results rows)
 *   -> authenticated teacher opens the dashboard Assessments Workspace
 *   -> the same assessments appear in the list, with correctly
 *      aggregated learnerCount / classAverage / passRate
 *   -> teacher opens one assessment's detail view
 *   -> the same per-learner results appear, in the same rows WhatsApp
 *      (PRINT / detail view) would read
 *   -> another teacher can never see it, in the list or by id
 *
 * This intentionally does NOT mock assessmentDetailService's functions —
 * tests/api-assessments.test.js already covers the route layer (thin
 * wrapper: query param mapping, 200/500) with mocks. This file exists
 * specifically to prove:
 *   1. the ownership scoping actually holds in the real SQL
 *      (`WHERE a.phone_hash = ?` / `WHERE id = ? AND phone_hash = ?`),
 *      which a mocked test can't verify;
 *   2. the aggregate SQL in getAssessmentHistory (COUNT/AVG/SUM CASE)
 *      produces the right numbers against real learner_results rows,
 *      including the zero-results edge case (learnerCount 0 ->
 *      classAverage/passRate null, not NaN or a crash);
 *   3. filters (grade/subject/classId/limit) narrow the real query
 *      correctly, not just that they're passed through.
 *
 * Uses the real migration chain (tests/helpers/createTestDb.js), same
 * convention as tests/growth-plans-dashboard-e2e.test.js.
 *
 * Run individually: node tests/assessments-dashboard-e2e.test.js
 * Run via npm:       npm test
 */

const { createTestDb } = require('./helpers/createTestDb');

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

function run() {
  const testDb = createTestDb(__filename);
  const db = testDb.db;

  const { getAssessmentHistory, getAssessmentDetail } = require('../services/assessmentDetailService');
  const {
    createGetAssessmentsHandler,
    createGetAssessmentDetailHandler,
  } = require('../routes/api').__testExports;

  const TEACHER_A_HASH = 'testhash_assessments_teacherA';
  const TEACHER_B_HASH = 'testhash_assessments_teacherB';

  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject) VALUES (?, 'Teacher A', 7, 'Mathematics')`).run(TEACHER_A_HASH);
  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject) VALUES (?, 'Teacher B', 7, 'Mathematics')`).run(TEACHER_B_HASH);

  const classId = db.prepare(
    `INSERT INTO classes (phone_hash, name, grade, subject, learner_count) VALUES (?, '7A', 7, 'Mathematics', 3)`
  ).run(TEACHER_A_HASH).lastInsertRowid;

  // ── Step 1: "Teacher captures assessment results via WhatsApp" ───────
  // This mirrors what assessmentSessionFlow.js's completion writes:
  // one row in `assessments`, one row per learner in `learner_results`.
  console.log('\n── Step 1: WhatsApp-side persistence (assessment session flow completion) ──');
  const fractionsId = db.prepare(
    `INSERT INTO assessments (phone_hash, title, grade, subject, term, assessment_type, total_marks, class_id)
     VALUES (?, 'Fractions Test', 7, 'Mathematics', 2, 'test', 50, ?)`
  ).run(TEACHER_A_HASH, classId).lastInsertRowid;

  const insertResult = db.prepare(
    `INSERT INTO learner_results (assessment_id, learner_name, mark, total_marks, percentage)
     VALUES (?, ?, ?, 50, ?)`
  );
  insertResult.run(fractionsId, 'Thabo M', 40, 80.0);   // pass
  insertResult.run(fractionsId, 'Naledi K', 20, 40.0);  // fail
  insertResult.run(fractionsId, 'Sipho D', 30, 60.0);   // pass

  // A second assessment, different subject, with zero learner results
  // captured yet (session started but no marks entered) — the aggregate
  // edge case.
  const readingId = db.prepare(
    `INSERT INTO assessments (phone_hash, title, grade, subject, term, assessment_type, total_marks)
     VALUES (?, 'Reading Comprehension', 7, 'English', 2, 'test', 20)`
  ).run(TEACHER_A_HASH).lastInsertRowid;

  assert(fractionsId > 0 && readingId > 0, 'both assessments persisted via direct-insert, same shape assessmentSessionFlow.js writes');

  // ── Step 2: "authenticated teacher opens the dashboard" ──────────────
  console.log('\n── Step 2: dashboard list retrieval (GET /api/assessments) ──');
  const listHandler = createGetAssessmentsHandler({ getAssessmentHistory });
  const listRes = mockRes();
  listHandler(mockReq(TEACHER_A_HASH), listRes);
  assert(listRes.statusCode === 200, 'list route returns 200');
  assert(listRes.body.assessments.length === 2, 'both of Teacher A\'s assessments appear in the dashboard list');

  const fractionsRow = listRes.body.assessments.find((a) => a.id === fractionsId);
  const readingRow = listRes.body.assessments.find((a) => a.id === readingId);

  // ── Step 3: aggregate correctness against the real learner_results ───
  console.log('\n── Step 3: aggregate SQL correctness (COUNT/AVG/pass-rate over real rows) ──');
  assert(fractionsRow.learnerCount === 3, 'learnerCount is COUNT(lr.id) over the 3 real learner_results rows');
  assert(fractionsRow.classAverage === 60, 'classAverage is AVG(percentage) rounded to 1dp: (80+40+60)/3 = 60');
  assert(fractionsRow.passRate === 67, 'passRate is % of learners >= 50%: 2/3 rounded = 67');
  assert(fractionsRow.class && fractionsRow.class.id === classId && fractionsRow.class.name === '7A', 'class info joined in from the real classes row');

  assert(readingRow.learnerCount === 0, 'an assessment with no captured results has learnerCount 0');
  assert(readingRow.classAverage === null, 'classAverage is null (not NaN) when learnerCount is 0');
  assert(readingRow.passRate === null, 'passRate is null (not NaN) when learnerCount is 0');
  assert(readingRow.class === null, 'class is null when the assessment has no class_id');

  // ── Step 4: filters narrow the real query ─────────────────────────────
  console.log('\n── Step 4: filters (subject/grade/classId/limit) against the real SQL ──');
  const subjectRes = mockRes();
  listHandler(mockReq(TEACHER_A_HASH, { subject: 'English' }), subjectRes);
  assert(subjectRes.body.assessments.length === 1 && subjectRes.body.assessments[0].id === readingId, 'subject filter narrows to the matching assessment only');

  const classIdRes = mockRes();
  listHandler(mockReq(TEACHER_A_HASH, { classId: String(classId) }), classIdRes);
  assert(classIdRes.body.assessments.length === 1 && classIdRes.body.assessments[0].id === fractionsId, 'classId filter narrows to assessments in that class only');

  const noMatchRes = mockRes();
  listHandler(mockReq(TEACHER_A_HASH, { grade: '9' }), noMatchRes);
  assert(noMatchRes.body.assessments.length === 0, 'a grade filter with no matches returns an empty array, not an error');

  const limitRes = mockRes();
  listHandler(mockReq(TEACHER_A_HASH, { limit: '1' }), limitRes);
  assert(limitRes.body.assessments.length === 1, 'limit filter caps the result count');

  // ── Step 5: "teacher opens one assessment's detail view" ─────────────
  console.log('\n── Step 5: dashboard detail retrieval (GET /api/assessments/:id/detail) ──');
  const detailHandler = createGetAssessmentDetailHandler({ getAssessmentDetail });
  const detailRes = mockRes();
  detailHandler(mockReq(TEACHER_A_HASH, {}, { assessmentId: String(fractionsId) }), detailRes);
  assert(detailRes.statusCode === 200, 'detail route returns 200');
  assert(detailRes.body.assessment.id === fractionsId, 'detail returns the same assessment id requested');
  assert(detailRes.body.learners.length === 3, 'detail lists all 3 real learner_results rows');
  assert(
    detailRes.body.learners.some((l) => l.learnerName === 'Thabo M' && l.mark === 40),
    'per-learner detail reflects the exact real row WhatsApp\'s capture wrote (same table, no second copy)'
  );

  // ── Step 6: cross-teacher isolation (real SQL, not a mock) ───────────
  console.log('\n── Step 6: cross-teacher isolation ──');
  assert(getAssessmentDetail(TEACHER_B_HASH, fractionsId) === null, 'getAssessmentDetail() itself — the real WHERE id=? AND phone_hash=? query — returns null for a different teacher\'s id');

  const intruderDetailRes = mockRes();
  detailHandler(mockReq(TEACHER_B_HASH, {}, { assessmentId: String(fractionsId) }), intruderDetailRes);
  assert(intruderDetailRes.statusCode === 404, 'Teacher B requesting Teacher A\'s assessment by id gets 404, not the data');

  const intruderListRes = mockRes();
  listHandler(mockReq(TEACHER_B_HASH), intruderListRes);
  assert(intruderListRes.body.assessments.length === 0, 'Teacher B\'s assessment list does not include Teacher A\'s assessments');

  console.log(`\n📊 Total:  ${passed + failed}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    sent: false,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    send() { this.sent = true; return this; },
  };
}

function mockReq(phoneHash, query = {}, params = {}) {
  return { teacher: { id: 1, phoneHash }, query, params };
}

run();
