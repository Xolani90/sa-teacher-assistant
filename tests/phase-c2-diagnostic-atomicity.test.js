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
// Uses tests/helpers/createTestDb.js (real runMigrations(), same function
// server.js calls at startup) against a throwaway file-backed DB, instead
// of a hand-rolled mock schema + direct better-sqlite3. See
// docs/TSE_SCHOOL_CALENDAR_TEST_GAP.md for why: the native better-sqlite3
// addon can't load in this sandbox (invalid ELF header), and the previous
// hand-rolled schema was reverse-engineered from other test files' usage
// rather than the real migrations, per this file's own prior comments.
//
// Run: node tests/phase-c2-diagnostic-atomicity.test.js

const { createTestDb } = require('./helpers/createTestDb');

let passed = 0;
let failed = 0;
function check(condition, label) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ FAIL: ${label}`); failed++; }
}

const testDb = createTestDb(__filename);
const db = testDb.db;

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
    // loop must leave zero learner_results rows, not a partial set.
    //
    // NOTE: a BigInt mark does NOT trigger this anymore -- storeLearnerResults
    // has a `Number.isFinite(result.mark)` guard that skips non-finite marks
    // (added to stop malformed marks poisoning classAverage in
    // learnerGroupingService) and BigInt fails that check silently, before
    // ever reaching the INSERT bind step. So a BigInt mark is gracefully
    // skipped, not thrown -- it no longer exercises the rollback path this
    // test is meant to verify. A circular questionData object does: it
    // passes the isFinite guard (mark/totalMarks are normal numbers) and
    // throws inside JSON.stringify(), still mid-transaction.
    const circularQuestionData = {};
    circularQuestionData.self = circularQuestionData;

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
        { learnerName: 'BAD', mark: 5, totalMarks: 20, questionData: circularQuestionData }, // circular ref -> throws in JSON.stringify()
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
  testDb.cleanup();
}
