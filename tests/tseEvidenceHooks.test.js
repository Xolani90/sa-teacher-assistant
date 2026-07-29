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

// ── Shim better-sqlite3 → node:sqlite ────────────────────────────────────────
const Module = require('module');
const { DatabaseSync } = require('node:sqlite');

let _db = null;

const path = require('path');
const dbPath = path.resolve(__dirname, '../utils/database');

const _origResolve = Module._resolveFilename.bind(Module);
Module._resolveFilename = function (request, parent, isMain, opts) {
  if (request === 'better-sqlite3') return request;
  if (request === '../utils/database' || request === './database') return dbPath;
  return _origResolve(request, parent, isMain, opts);
};
require.cache['better-sqlite3'] = {
  id: 'better-sqlite3',
  filename: 'better-sqlite3',
  loaded: true,
  exports: function Database() {
    if (!_db.pragma) _db.pragma = () => {};
    return _db;
  },
};
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { getDb: () => _db },
};

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

// ── Schema: teachers + all six source tables + school_calendar/tse_evidence_links ──
function buildSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS teachers (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash                TEXT    NOT NULL UNIQUE,
      name                      TEXT,
      grade                     TEXT,
      subject                   TEXT,
      language                  TEXT    DEFAULT 'english',
      school                    TEXT,
      is_pro                    INTEGER NOT NULL DEFAULT 0,
      pro_expires               TEXT,
      saved_resources_count     INTEGER NOT NULL DEFAULT 0,
      created_at                TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at                TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS classes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash  TEXT NOT NULL,
      name        TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS saved_resources (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash      TEXT    NOT NULL,
      resource_type   TEXT    NOT NULL,
      title           TEXT    NOT NULL,
      content         TEXT    NOT NULL,
      grade           INTEGER,
      subject         TEXT,
      topic           TEXT,
      metadata        TEXT,
      generation_id   TEXT,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS assessments (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash          TEXT    NOT NULL,
      title               TEXT,
      grade               INTEGER,
      subject             TEXT,
      term                INTEGER,
      assessment_type     TEXT,
      total_marks         INTEGER,
      atp_topics          TEXT,
      class_id            INTEGER,
      blueprint_id        INTEGER,
      blueprint_version   INTEGER,
      created_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reports (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash      TEXT    NOT NULL,
      assessment_id   INTEGER NOT NULL,
      report_type     TEXT    NOT NULL,
      learner_name    TEXT,
      content         TEXT    NOT NULL,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS intervention_plans (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash          TEXT    NOT NULL,
      assessment_id       INTEGER,
      problem_area        TEXT    NOT NULL,
      target_group        TEXT    NOT NULL,
      goals               TEXT    NOT NULL,
      duration_days       INTEGER NOT NULL,
      strategies          TEXT    NOT NULL,
      resources           TEXT,
      monitoring_plan     TEXT,
      success_indicators  TEXT,
      status              TEXT    NOT NULL DEFAULT 'active',
      created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS curriculum_coverage (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash      TEXT    NOT NULL,
      grade           INTEGER NOT NULL,
      subject         TEXT    NOT NULL,
      term            INTEGER NOT NULL,
      topic           TEXT    NOT NULL,
      covered         INTEGER NOT NULL DEFAULT 0,
      date_covered    TEXT,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(phone_hash, grade, subject, term, topic)
    );

    CREATE TABLE IF NOT EXISTS observation_assessments (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash              TEXT    NOT NULL,
      grade                   TEXT,
      subject                 TEXT,
      assessment_name         TEXT,
      class_id                INTEGER,
      corrects_assessment_id  INTEGER,
      created_at              TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS observation_records (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      assessment_id         INTEGER NOT NULL,
      learner_name          TEXT    NOT NULL,
      domain                TEXT    NOT NULL,
      developmental_status  TEXT    NOT NULL,
      notes                 TEXT,
      learner_id            INTEGER,
      created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS learners (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash        TEXT    NOT NULL,
      class_id          INTEGER,
      canonical_name    TEXT    NOT NULL,
      normalized_name   TEXT    NOT NULL,
      removed_at        TEXT,
      created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS school_calendar (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      year       INTEGER NOT NULL,
      term       INTEGER NOT NULL,
      start_date TEXT    NOT NULL,
      end_date   TEXT    NOT NULL,
      UNIQUE(year, term)
    );

    CREATE TABLE IF NOT EXISTS tse_evidence_links (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash    TEXT    NOT NULL,
      category      TEXT    NOT NULL,
      source_table  TEXT    NOT NULL,
      source_id     INTEGER NOT NULL,
      term          INTEGER,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source_table, source_id, category)
    );
  `);
}

async function run() {
  _db = new DatabaseSync(':memory:');
  buildSchema(_db);

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
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Test run crashed:', err);
  process.exit(1);
});
