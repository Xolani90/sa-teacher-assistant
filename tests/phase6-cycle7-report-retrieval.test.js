'use strict';
/**
 * Phase 6 Cycle 7 — Reporting Centre retrieval gap.
 *
 * Evidence: migration 015 (utils/database.js) created the `reports` table
 * explicitly so generated diagnostic/HOD/parent reports "can be re-fetched
 * without re-running the analysis pipeline" — but no route, service list
 * function, or Dashboard surface ever read the table back. Reports were
 * write-only: generated once via WhatsApp (interventionReportsService.
 * saveReport), delivered, then permanently unreachable.
 *
 * Fix under test: interventionReportsService.listSavedReports() (new,
 * read-only) composed into assessmentDetailService.getAssessmentDetail()'s
 * existing aggregated payload as `savedReports` — the same "compose, don't
 * add a new source of truth" convention the module's own header documents.
 * No new route: GET /api/assessments/:assessmentId/detail already exists
 * and is already ownership-scoped by req.teacher.phoneHash.
 *
 * Standard: real express app + real in-memory DB via the actual migration
 * chain + real signed JWTs + real HTTP, following the same pattern as
 * tests/w4-f1-assessment-detail-integration.test.js.
 *
 * Run individually: node tests/phase6-cycle7-report-retrieval.test.js
 */

process.env.TEACHER_JWT_SECRET = 'phase6-cycle7-test-secret';

const { createTestDb } = require('./helpers/createTestDb');
const testDb = createTestDb(__filename);
const db = testDb.db;

const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');

const { requireTeacherAuth, apiLimiter } = require('../utils/teacherAuth');
const { getAssessmentDetail } = require('../services/assessmentDetailService');
const { saveReport, listSavedReports } = require('../services/interventionReportsService');

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
  assert(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
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

// Handler copied verbatim from routes/api.js's createGetAssessmentDetailHandler
// (same reason as the W4-F1 test: pdfkit/xlsx aren't installable in this
// sandbox, so the full router isn't required directly). Wiring parity is
// checked below against the real file.
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
  console.log('Phase 6 Cycle 7 — saved report retrieval evidence');
  console.log('='.repeat(75));

  const app = express();
  app.use(express.json());
  const router = express.Router();
  router.get('/assessments/:assessmentId/detail', createGetAssessmentDetailHandler({ getAssessmentDetail }));
  app.use('/api', apiLimiter, requireTeacherAuth, router);
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  const server = app.listen(0);
  const port = server.address().port;

  // Route-wiring parity: confirm the real route file still points the same
  // path at the same handler/service, so this test isn't only exercising a
  // copy that has drifted from production.
  const apiSrc = require('fs').readFileSync(require('path').join(__dirname, '../routes/api.js'), 'utf8');
  const wiringIntact = /router\.get\(\s*'\/assessments\/:assessmentId\/detail',\s*createGetAssessmentDetailHandler/.test(apiSrc);
  assert('routes/api.js still wires GET .../detail to createGetAssessmentDetailHandler', wiringIntact);
  const serviceComposesReports = /listSavedReports/.test(
    require('fs').readFileSync(require('path').join(__dirname, '../services/assessmentDetailService.js'), 'utf8')
  );
  assert('assessmentDetailService.js composes listSavedReports', serviceComposesReports);

  // ─── Seed two teachers, one assessment each ───────────────────────────
  const PHONE_A = 'phase6c7_teacher_a';
  const PHONE_B = 'phase6c7_teacher_b';
  db.prepare(`INSERT INTO teachers (phone_hash) VALUES (?)`).run(PHONE_A);
  db.prepare(`INSERT INTO teachers (phone_hash) VALUES (?)`).run(PHONE_B);
  const teacherA = db.prepare(`SELECT id FROM teachers WHERE phone_hash = ?`).get(PHONE_A);
  const teacherB = db.prepare(`SELECT id FROM teachers WHERE phone_hash = ?`).get(PHONE_B);
  const tokenA = signToken(teacherA.id);
  const tokenB = signToken(teacherB.id);

  const assessmentA = db.prepare(`
    INSERT INTO assessments (phone_hash, title, grade, subject, term, assessment_type, total_marks)
    VALUES (?, 'Cycle 7 Test Assessment', 6, 'Mathematics', 2, 'free_form', 20)
  `).run(PHONE_A);
  const assessmentIdA = assessmentA.lastInsertRowid;

  console.log('\n── Scenario A: no reports saved yet ──');
  {
    const { status, body } = await httpGet(port, `/api/assessments/${assessmentIdA}/detail`, {
      Authorization: `Bearer ${tokenA}`,
    });
    assertEqual('status 200', status, 200);
    assert('savedReports is an array', Array.isArray(body && body.savedReports));
    assertEqual('savedReports is empty (never null) with nothing saved', body.savedReports.length, 0);
  }

  console.log('\n── Scenario B: diagnostic + HOD reports saved via the real write path ──');
  const diagId = saveReport(PHONE_A, assessmentIdA, 'diagnostic', 'Diagnostic report content A');
  const hodId = saveReport(PHONE_A, assessmentIdA, 'hod', 'HOD report content A');
  {
    const { status, body } = await httpGet(port, `/api/assessments/${assessmentIdA}/detail`, {
      Authorization: `Bearer ${tokenA}`,
    });
    assertEqual('status 200', status, 200);
    assertEqual('savedReports has both saved reports', body.savedReports.length, 2);
    // Most-recent-first ordering (id DESC)
    assertEqual('most recent report (hod) is first', body.savedReports[0].reportType, 'hod');
    assertEqual('hod report id matches', body.savedReports[0].id, hodId);
    assertEqual('hod content matches what was saved', body.savedReports[0].content, 'HOD report content A');
    assertEqual('second report is diagnostic', body.savedReports[1].reportType, 'diagnostic');
    assertEqual('diagnostic report id matches', body.savedReports[1].id, diagId);
  }

  console.log('\n── Scenario C: ownership scoping — Teacher B cannot see Teacher A\'s reports ──');
  {
    const { status, body } = await httpGet(port, `/api/assessments/${assessmentIdA}/detail`, {
      Authorization: `Bearer ${tokenB}`,
    });
    // Same no-existence-oracle convention as the rest of the API: a
    // non-owned assessment 404s outright, so Teacher B never even sees an
    // empty savedReports array for it.
    assertEqual('non-owning teacher gets 404, not the reports', status, 404);
  }

  console.log('\n── Scenario D: parent report scoped to one learner is included with its learnerName ──');
  saveReport(PHONE_A, assessmentIdA, 'parent', 'Parent report for Thabo', 'Thabo M');
  {
    const { body } = await httpGet(port, `/api/assessments/${assessmentIdA}/detail`, {
      Authorization: `Bearer ${tokenA}`,
    });
    const parentReport = body.savedReports.find((r) => r.reportType === 'parent');
    assert('parent report present', !!parentReport);
    assertEqual('parent report learnerName preserved', parentReport && parentReport.learnerName, 'Thabo M');
  }

  console.log('\n── Direct service-level check: listSavedReports() ──');
  {
    const direct = listSavedReports(PHONE_A, assessmentIdA);
    assertEqual('direct call returns same count as API', direct.length, 3);
    const directOtherTeacher = listSavedReports(PHONE_B, assessmentIdA);
    assertEqual('wrong phoneHash returns empty, not another teacher\'s reports', directOtherTeacher.length, 0);
    const directOtherAssessment = listSavedReports(PHONE_A, assessmentIdA + 9999);
    assertEqual('nonexistent assessmentId returns empty array, not a throw', directOtherAssessment.length, 0);
  }

  server.close();
  testDb.cleanup();

  console.log('\n' + '='.repeat(75));
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Test run crashed:', err);
  process.exit(1);
});