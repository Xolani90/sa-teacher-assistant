'use strict';
// Cycle 12 — Assessment-completion atomicity regression test.
//
// Confirmed defect: storeAssessment() autocommitted its INSERT into
// `assessments` immediately (its own implicit transaction), while
// storeLearnerResults() ran a SEPARATE BEGIN/COMMIT/ROLLBACK for the
// learner_results loop. A genuine failure in the learner_results half
// (constraint violation, SQLITE_BUSY, a malformed row, a momentary disk
// error) rolled back learner_results only — the assessments row from
// the first write was already permanently committed with zero
// learner_results. That orphan would sit forever in getDiagnosticHistory()
// and the dashboard, while the teacher was told the upload failed and
// left on a session with no route back to retry (isComplete(state) is
// already true, so any further reply just says "already complete").
//
// Fix: services/diagnosticWorkflowService.js's
// storeAssessmentAndLearnerResults() wraps both writes in one
// transaction — a failure in either half now rolls back both.
//
// Run: node tests/cycle12-assessment-completion-atomicity.test.js

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

  console.log('\n── Cycle 12: assessment+learner_results atomicity ──────────────────────');

  db.prepare("INSERT INTO teachers (phone_hash) VALUES ('p1')").run();

  const before = db.prepare('SELECT COUNT(*) c FROM assessments').get().c;

  // Intercept only the learner_results INSERT to simulate a genuine
  // DB-level failure landing there specifically (constraint violation,
  // SQLITE_BUSY, disk error) -- every other write (teachers, assessments)
  // behaves exactly as production would.
  const origPrepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    if (sql.includes('INSERT INTO learner_results')) {
      return { run: () => { throw new Error('simulated disk I/O error mid-insert'); } };
    }
    return origPrepare(sql);
  };

  const result = diagnosticService.processAssessmentData('p1', {
    title: 'Atomicity Test', grade: 5, subject: 'Maths', term: 1, type: 'test', totalMarks: 10,
    classId: null,
    learnerResults: [{ learnerName: 'Thabo', mark: 5, totalMarks: 10, questionData: {} }],
  });

  db.prepare = origPrepare;

  const after = db.prepare('SELECT COUNT(*) c FROM assessments').get().c;
  const learnerResultsCount = db.prepare('SELECT COUNT(*) c FROM learner_results').get().c;

  check(result && result.error === 'Failed to store learner results', 'C12-D01: processAssessmentData reports the storage failure');
  check(after === before, 'C12-D02: zero orphaned assessments rows after the throw (assessment insert rolled back too)');
  check(learnerResultsCount === 0, 'C12-D03: zero learner_results rows after the throw');

  // A subsequent, clean retry must succeed normally.
  const retry = diagnosticService.processAssessmentData('p1', {
    title: 'Atomicity Test Retry', grade: 5, subject: 'Maths', term: 1, type: 'test', totalMarks: 10,
    classId: null,
    learnerResults: [{ learnerName: 'Thabo', mark: 5, totalMarks: 10, questionData: {} }],
  });
  check(retry && !retry.error && retry.assessmentId, 'C12-D04: retry after the rolled-back failure succeeds cleanly');
  const finalAssessmentCount = db.prepare('SELECT COUNT(*) c FROM assessments').get().c;
  check(finalAssessmentCount === before + 1, 'C12-D05: exactly one assessments row exists after the failed attempt + successful retry (no orphan left behind)');

  console.log('\n─────────────────────────────────');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total:  ${passed + failed}`);
  console.log('─────────────────────────────────\n');

  process.exitCode = failed > 0 ? 1 : 0;
} finally {
  testDb.cleanup();
}
