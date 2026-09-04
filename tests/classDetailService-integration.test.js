'use strict';
/**
 * classDetailService integration test — getClassDetail() end-to-end
 * against a real (throwaway, file-backed) SQLite DB via runMigrations(),
 * same node:sqlite shim convention as
 * tests/learner-roster-service.test.js / tests/adr003-learners-migration.test.js.
 *
 * The pure aggregation helpers (computeLearnerAverages, computeClassHealth,
 * summarizeRecentAssessments, summarizeCurriculumCoverage,
 * summarizeRecentObservations) are covered in isolation in
 * tests/classDetailService.test.js — this file only checks that
 * getClassDetail() wires the five underlying reads (getClass, getRoster,
 * getClassHistory, analyzeCoverage, getClassInterventionPlan) together
 * correctly against real tables/columns, so it fails if that schema ever
 * drifts from what classDetailService.js assumes.
 *
 * Run individually: node tests/classDetailService-integration.test.js
 * Run via npm:       npm test
 */

const path = require('path');
const fs = require('fs');
const assert = require('assert');

const Module = require('module');
const { DatabaseSync } = require('node:sqlite');

let _db = null;

const _origResolve = Module._resolveFilename.bind(Module);
Module._resolveFilename = function (request, parent, isMain, opts) {
  if (request === 'better-sqlite3') return request;
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

process.env.DB_PATH = path.join(__dirname, '..', 'classdetail-service-integration-test.db');
if (fs.existsSync(process.env.DB_PATH)) fs.unlinkSync(process.env.DB_PATH);
_db = new DatabaseSync(process.env.DB_PATH);

let passed = 0;
let failed = 0;
function assertLabel(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

function run() {
  const { getDb, runMigrations } = require('../utils/database');
  runMigrations();
  const db = getDb();
  const { getClassDetail } = require('../services/classDetailService');
  const { setRoster } = require('../services/learnerRosterService');

  const PHONE_HASH = 'classdetail-test-hash';
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO teachers (phone_hash, created_at, updated_at) VALUES (?, ?, ?)`)
    .run(PHONE_HASH, now, now);

  const classResult = db.prepare(`
    INSERT INTO classes (phone_hash, name, grade, subject, learner_count)
    VALUES (?, 'Grade 7 Mathematics A', 7, 'Mathematics', 0)
  `).run(PHONE_HASH);
  const classId = Number(classResult.lastInsertRowid);

  const { roster } = setRoster(PHONE_HASH, classId, ['Ayanda Nkosi', 'Bongani Zulu', 'Charlize Botha']);
  const [ayanda, bongani, charlize] = roster; // Charlize deliberately gets no assessment/observation rows

  // Two assessments, two learners each — Bongani fails the first.
  const assessment1 = db.prepare(`
    INSERT INTO assessments (phone_hash, title, grade, subject, term, assessment_type, total_marks)
    VALUES (?, 'Fractions Test', 7, 'Mathematics', 3, 'test', 20)
  `).run(PHONE_HASH);
  const assessment2 = db.prepare(`
    INSERT INTO assessments (phone_hash, title, grade, subject, term, assessment_type, total_marks)
    VALUES (?, 'Decimals Quiz', 7, 'Mathematics', 3, 'quiz', 10)
  `).run(PHONE_HASH);

  db.prepare(`
    INSERT INTO learner_results (assessment_id, learner_id, learner_name, mark, total_marks, percentage, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', '-2 days'))
  `).run(assessment1.lastInsertRowid, ayanda.id, 'Ayanda Nkosi', 16, 20, 80);
  db.prepare(`
    INSERT INTO learner_results (assessment_id, learner_id, learner_name, mark, total_marks, percentage, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', '-2 days'))
  `).run(assessment1.lastInsertRowid, bongani.id, 'Bongani Zulu', 6, 20, 30);
  db.prepare(`
    INSERT INTO learner_results (assessment_id, learner_id, learner_name, mark, total_marks, percentage, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(assessment2.lastInsertRowid, ayanda.id, 'Ayanda Nkosi', 9, 10, 90);

  // One curriculum topic marked covered, so coverage is > 0% but < 100%.
  // "Integers" is a Term 2 (not Term 1) Grade 7 Mathematics ATP topic —
  // see Cycle 33 CAPS_TOPICS.mathematics[7] correction in
  // curriculumIntelligenceService.js.
  const { markTopicCovered } = require('../services/curriculumCoverageService');
  markTopicCovered(PHONE_HASH, 7, 'Mathematics', 2, 'Integers');

  // One observation session covering two learners.
  const obsAssessment = db.prepare(`
    INSERT INTO observation_assessments (phone_hash, grade, subject, assessment_name)
    VALUES (?, '7', 'Mathematics', 'Group Work Observation')
  `).run(PHONE_HASH);
  db.prepare(`
    INSERT INTO observation_records (assessment_id, learner_id, learner_name, domain, developmental_status)
    VALUES (?, ?, ?, 'Social', 'achieving')
  `).run(obsAssessment.lastInsertRowid, ayanda.id, 'Ayanda Nkosi');
  db.prepare(`
    INSERT INTO observation_records (assessment_id, learner_id, learner_name, domain, developmental_status)
    VALUES (?, ?, ?, 'Social', 'emerging')
  `).run(obsAssessment.lastInsertRowid, bongani.id, 'Bongani Zulu');

  console.log('\n── Section 1: unknown / foreign class returns null ─────────────────');
  {
    assertLabel(getClassDetail(PHONE_HASH, classId + 999) === null, 'unknown classId returns null');
    assertLabel(getClassDetail('someone-elses-hash', classId) === null, "another teacher's phoneHash returns null (ownership enforced)");
  }

  const detail = getClassDetail(PHONE_HASH, classId);

  console.log('\n── Section 2: class summary ─────────────────────────────────────────');
  {
    assertLabel(detail.class.id === classId, 'class.id matches');
    assertLabel(detail.class.name === 'Grade 7 Mathematics A', 'class.name matches');
    assertLabel(detail.class.grade === 7, 'class.grade matches');
    assertLabel(detail.class.subject === 'Mathematics', 'class.subject matches');
    assertLabel(detail.class.learnerCount === 3, 'class.learnerCount reflects the roster (kept in sync by setRoster)');
  }

  console.log('\n── Section 3: learners + class health ───────────────────────────────');
  {
    assertLabel(detail.learners.length === 3, 'all three roster members present');
    const ayandaEntry = detail.learners.find((l) => l.learnerId === ayanda.id);
    const bonganiEntry = detail.learners.find((l) => l.learnerId === bongani.id);
    const charlizeEntry = detail.learners.find((l) => l.learnerId === charlize.id);
    assertLabel(ayandaEntry.average === 85, "Ayanda's average is (80+90)/2 = 85");
    assertLabel(ayandaEntry.passing === true, 'Ayanda is passing');
    assertLabel(bonganiEntry.average === 30, "Bongani's average is 30 (one result)");
    assertLabel(bonganiEntry.passing === false, 'Bongani is not passing');
    assertLabel(charlizeEntry.average === null, 'Charlize (no results) has a null average, not zero');

    assertLabel(detail.classHealth.dataAvailable === 2, 'classHealth only counts the two learners with data');
    assertLabel(detail.classHealth.average === 57.5, 'classHealth.average is the mean of the two learners with data ((85+30)/2)');
    assertLabel(detail.classHealth.passRate === 50, 'classHealth.passRate is 1-of-2 passing = 50%');
    assertLabel(detail.classHealth.atRisk === 1, 'classHealth.atRisk counts Bongani only');
  }

  console.log('\n── Section 4: recent assessments ────────────────────────────────────');
  {
    assertLabel(detail.recentAssessments.length === 2, 'both assessments appear, one row each (de-duplicated)');
    assertLabel(detail.recentAssessments[0].title === 'Decimals Quiz', 'newest assessment (Decimals Quiz) is first');
    assertLabel(detail.recentAssessments[0].classAverage === 90, 'Decimals Quiz average is 90 (only Ayanda sat it)');
    const fractions = detail.recentAssessments.find((a) => a.title === 'Fractions Test');
    assertLabel(fractions.classAverage === 55, 'Fractions Test average is (80+30)/2 = 55');
    assertLabel(fractions.learnerCount === 2, 'Fractions Test learnerCount is 2');
  }

  console.log('\n── Section 5: curriculum coverage ───────────────────────────────────');
  {
    assertLabel(detail.curriculumCoverage.dataAvailable === true, 'CAPS reference data exists for Grade 7 Mathematics');
    assertLabel(detail.curriculumCoverage.percentage > 0, 'coverage percentage is above zero after marking one topic covered');
    assertLabel(!detail.curriculumCoverage.remainingTopics.includes('Integers'), "'Integers' (marked covered) is not in the outstanding list");
  }

  console.log('\n── Section 6: interventions ─────────────────────────────────────────');
  {
    assertLabel(detail.interventions.summary.totalLearners === 3, 'intervention summary.totalLearners matches the roster size');
    assertLabel(typeof detail.interventions.priorityCounts.high === 'number', 'priorityCounts.high is present');
    assertLabel(Array.isArray(detail.interventions.priorityLearners.high), 'priorityLearners.high is an array');
  }

  console.log('\n── Section 7: observations ──────────────────────────────────────────');
  {
    assertLabel(detail.observations.totalSessions === 1, 'one observation session recorded');
    assertLabel(detail.observations.recent[0].title === 'Group Work Observation', 'session title surfaced');
    assertLabel(detail.observations.recent[0].learnerCount === 2, 'session covered two learners');
  }

  console.log('\n── Section 8: stale classes.learner_count vs live roster ─────────────');
  {
    // Simulates a class created via the legacy WhatsApp "NEW CLASS <name>
    // | <count>" flow: a declared capacity is stored directly on the row,
    // but no roster was ever captured through learnerRosterService, so
    // `learners` has zero real rows for this class and the stored
    // learner_count (34) never got synced.
    const staleClassResult = db.prepare(`
      INSERT INTO classes (phone_hash, name, grade, subject, learner_count)
      VALUES (?, 'Grade 7A Mathematics', 7, 'General', 34)
    `).run(PHONE_HASH);
    const staleClassId = Number(staleClassResult.lastInsertRowid);

    const { getActiveRosterCounts } = require('../services/learnerRosterService');

    const staleDetail = getClassDetail(PHONE_HASH, staleClassId);

    assertLabel(
      staleDetail.class.learnerCount === 0,
      'class.learnerCount reflects the live (empty) roster, not the stale stored 34'
    );
    assertLabel(
      staleDetail.learners.length === 0,
      'learners array is empty — matches the live roster, agreeing with class.learnerCount'
    );

    const counts = getActiveRosterCounts(PHONE_HASH);
    assertLabel(
      (counts.get(staleClassId) || 0) === 0,
      'getActiveRosterCounts also reports 0 for the class with no real roster (used by GET /api/classes)'
    );
    assertLabel(
      (counts.get(classId) || 0) === 3,
      'getActiveRosterCounts reports the correct live count (3) for the earlier class with a real roster'
    );
  }

  console.log('\n' + '='.repeat(75));
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
