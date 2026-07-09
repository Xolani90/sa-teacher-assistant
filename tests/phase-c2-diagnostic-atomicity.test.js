'use strict';
// Phase C2 — Atomicity regression test for diagnostic-pipeline write loops.
//
// Confirmed defect (Phase C audit): storeLearnerResults, saveItemAnalysis,
// and saveErrorAnalysis each ran an unwrapped loop of INSERT statements. A
// throw partway through the loop (e.g. a NOT NULL constraint violation from
// one malformed record among many) left a partial set of rows committed
// under a live assessmentId, while the caller was told the whole operation
// had failed -- inviting duplicate rows on re-upload.
//
// Fix: each function now wraps its DELETE/INSERT loop in an explicit
// BEGIN/COMMIT/ROLLBACK transaction (matching the existing pattern already
// used in teacherWorkspaceService.saveResource), so a mid-loop throw rolls
// back to zero new rows instead of leaving a partial set.
//
// Uses better-sqlite3 directly (same lib production uses) against an
// in-memory DB, with the REAL service files loaded via Module._resolveFilename
// patching -- same convention as tests/intervention-reports.test.js.
//
// Run: node tests/phase-c2-diagnostic-atomicity.test.js

const Database = require('better-sqlite3');
const Module = require('module');
const path = require('path');
const assert = require('assert');

const db = new Database(':memory:');

db.exec(`
  CREATE TABLE teachers (phone_hash TEXT PRIMARY KEY);
  CREATE TABLE assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone_hash TEXT NOT NULL,
    title TEXT NOT NULL,
    grade INTEGER NOT NULL,
    subject TEXT NOT NULL,
    term INTEGER NOT NULL,
    assessment_type TEXT NOT NULL,
    total_marks INTEGER NOT NULL,
    atp_topics TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE learner_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assessment_id INTEGER NOT NULL,
    learner_name TEXT NOT NULL,
    mark INTEGER NOT NULL,
    total_marks INTEGER NOT NULL,
    percentage REAL NOT NULL,
    question_data TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE item_analysis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assessment_id INTEGER NOT NULL,
    question_number INTEGER NOT NULL,
    topic TEXT NOT NULL,
    difficulty REAL NOT NULL,
    success_rate REAL NOT NULL,
    cognitive_level TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE error_analysis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assessment_id INTEGER NOT NULL,
    error_type TEXT NOT NULL,
    topic TEXT NOT NULL,
    frequency INTEGER NOT NULL,
    description TEXT,
    reteach_action TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const dbPath = path.resolve(__dirname, '../utils/database');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { getDb: () => db },
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === '../utils/database' || request === './database') return dbPath;
  return origResolve.call(this, request, ...rest);
};

let passed = 0;
let failed = 0;
function check(condition, label) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ FAIL: ${label}`); failed++; }
}

try {
  const diagnosticService = require('../services/diagnosticWorkflowService');

  console.log('\n── C2: saveItemAnalysis atomicity ──────────────────────────────────────');
  {
    const { saveItemAnalysis } = require('../services/itemAnalysisService');

    db.prepare(`INSERT INTO teachers (phone_hash) VALUES ('p1')`).run();
    const assessmentId = db.prepare(`
      INSERT INTO assessments (phone_hash, title, grade, subject, term, assessment_type, total_marks)
      VALUES ('p1', 'Test', 7, 'mathematics', 1, 'test', 50)
    `).run().lastInsertRowid;

    // 3 well-formed questions, then one missing 'topic' (NOT NULL, no
    // fallback in the loop -> real constraint violation), then 2 more
    // well-formed questions that must NOT end up partially inserted.
    const questions = [
      { questionNumber: 1, topic: 'fractions', facilityValue: 0.8, successRate: 80 },
      { questionNumber: 2, topic: 'algebra', facilityValue: 0.6, successRate: 60 },
      { questionNumber: 3, topic: 'geometry', facilityValue: 0.5, successRate: 50 },
      { questionNumber: 4, topic: 'measurement', facilityValue: undefined, successRate: 40 }, // realistic trigger: facilityValue has no fallback in saveItemAnalysis, unlike topic
      { questionNumber: 5, topic: 'trig', facilityValue: 0.3, successRate: 30 },
    ];

    let threw = false;
    try {
      saveItemAnalysis(assessmentId, questions, 'mathematics');
    } catch (e) {
      threw = true;
    }
    check(threw, 'C2-D01: saveItemAnalysis throws on the malformed record (sanity check)');

    const rowCount = db.prepare(`SELECT COUNT(*) AS n FROM item_analysis WHERE assessment_id = ?`).get(assessmentId).n;
    check(rowCount === 0, 'C2-D02: zero item_analysis rows persisted after the throw (no partial write)');

    // Now retry with all-good data -- must succeed cleanly with no leftover
    // rows from the failed attempt interfering.
    const goodQuestions = questions.slice(0, 3);
    saveItemAnalysis(assessmentId, goodQuestions, 'mathematics');
    const rowCountAfterRetry = db.prepare(`SELECT COUNT(*) AS n FROM item_analysis WHERE assessment_id = ?`).get(assessmentId).n;
    check(rowCountAfterRetry === 3, 'C2-D03: retry with valid data inserts exactly 3 rows (clean state after rollback)');
  }

  console.log('\n── C2: saveErrorAnalysis atomicity ─────────────────────────────────────');
  {
    const { saveErrorAnalysis } = require('../services/errorAnalysisService');

    const assessmentId = db.prepare(`
      INSERT INTO assessments (phone_hash, title, grade, subject, term, assessment_type, total_marks)
      VALUES ('p1', 'Test2', 7, 'mathematics', 1, 'test', 50)
    `).run().lastInsertRowid;

    const errorPatterns = [
      { errorType: 'careless', topic: 'fractions', frequency: 3, description: 'minor slips' },
      { errorType: 'conceptual', topic: 'algebra', frequency: 5, description: 'sign errors' },
      { errorType: 'conceptual', topic: undefined, frequency: 7, description: 'BAD' }, // realistic trigger: topic is NOT NULL with no fallback in saveErrorAnalysis
      { errorType: 'careless', topic: 'trig', frequency: 1, description: 'rounding' },
    ];

    let threw = false;
    try {
      saveErrorAnalysis(assessmentId, errorPatterns);
    } catch (e) {
      threw = true;
    }
    check(threw, 'C2-D04: saveErrorAnalysis throws on the malformed record (sanity check)');

    const rowCount = db.prepare(`SELECT COUNT(*) AS n FROM error_analysis WHERE assessment_id = ?`).get(assessmentId).n;
    check(rowCount === 0, 'C2-D05: zero error_analysis rows persisted after the throw (no partial write)');
  }

  console.log('\n── C2: storeLearnerResults atomicity (via processAssessmentData) ───────');
  {
    // storeLearnerResults itself is not exported, so exercise it through
    // the documented public entry point. A throw deep in the per-learner
    // loop (BigInt mark, which neither JSON.stringify nor better-sqlite3
    // bind accepts) must leave zero learner_results rows, not a partial set.
    const assessmentData = {
      title: 'CSV upload test',
      grade: 7,
      subject: 'mathematics',
      term: 1,
      type: 'test',
      totalMarks: 20,
      learnerResults: [
        { learnerName: 'A', mark: 10, totalMarks: 20, questionData: {} },
        { learnerName: 'B', mark: 15, totalMarks: 20, questionData: {} },
        { learnerName: 'BAD', mark: 5n, totalMarks: 20, questionData: {} }, // BigInt mark -> throws on bind
        { learnerName: 'D', mark: 12, totalMarks: 20, questionData: {} },
      ],
    };

    const result = diagnosticService.processAssessmentData('p1', assessmentData);
    check(result && result.error === 'Failed to store learner results', 'C2-D06: processAssessmentData reports the storage failure');

    const rowCount = db.prepare(`SELECT COUNT(*) AS n FROM learner_results`).get().n;
    check(rowCount === 0, 'C2-D07: zero learner_results rows persisted after the throw (no partial write)');
  }

  console.log('\n─────────────────────────────────');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total:  ${passed + failed}`);
  console.log('─────────────────────────────────\n');

  process.exitCode = failed > 0 ? 1 : 0;
} finally {
  Module._resolveFilename = origResolve;
}
