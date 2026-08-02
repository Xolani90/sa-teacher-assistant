'use strict';
/**
 * Observation Repository — Corrections / Delete / Resolve (real DB)
 *
 * Companion to tests/phase-6-observation-repository.test.js (which covers
 * the original save/retrieve path) and
 * tests/observationFlow-corrections-delete-resolve-incremental.test.js
 * (which covers the flow layer's state machine against a FAKE repository).
 *
 * This file is the one both of those deliberately leave out: it loads the
 * REAL services/observationRepository.js and runs it against a REAL
 * in-memory SQLite database (via the node:sqlite shim, same convention as
 * phase-6), so it actually exercises:
 *   - the real SQL (including the corrects_assessment_id / resolved columns
 *     added by migration_observation_corrections_resolution.sql)
 *   - the manual BEGIN/COMMIT/ROLLBACK transaction blocks
 *   - the documented "dangling reference" behavior on delete (see
 *     deleteObservationAssessment's docstring in observationRepository.js)
 *
 * Run individually:   node tests/observationRepository-corrections-delete-resolve.test.js
 * Run via npm:         npm test
 */

// ── Shared real-migrations test DB helper (see docs/TSE_SCHOOL_CALENDAR_TEST_GAP.md) ──
const { createTestDb } = require('./helpers/createTestDb');

// ── Helpers ──────────────────────────────────────────────────────────────
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

function assertEq(a, b, label) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    console.error(`     expected: ${JSON.stringify(b)}`);
    console.error(`     got:      ${JSON.stringify(a)}`);
    failed++;
  }
}

function assertThrows(fn, expectedMsg, label) {
  try {
    fn();
    console.error(`  ❌ FAIL: ${label} — expected throw, got no error`);
    failed++;
  } catch (err) {
    if (expectedMsg && !err.message.includes(expectedMsg)) {
      console.error(`  ❌ FAIL: ${label}`);
      console.error(`     expected message to include: "${expectedMsg}"`);
      console.error(`     got: "${err.message}"`);
      failed++;
    } else {
      console.log(`  ✅ ${label}`);
      passed++;
    }
  }
}

async function run() {
  const testDb = createTestDb(__filename);
  const _db = testDb.db;

  const {
    saveObservationSubmission,
    getObservationAssessment,
    getObservationHistory,
    deleteObservationAssessment,
    resolveObservationRecord,
  } = require('../services/observationRepository');

  const TEACHER_A = 'obs_corr_teacher_a';
  const TEACHER_B = 'obs_corr_teacher_b';
  _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(TEACHER_A);
  _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(TEACHER_B);

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 1: Corrections (supersedes model)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 1: Corrections (supersedes model) ────────────────────────');

  console.log('\nTest OR-01: correctsAssessmentId referencing a non-existent assessment throws');
  assertThrows(
    () => saveObservationSubmission(TEACHER_A, { grade: '1' }, [
      { learnerName: 'Zola', domain: 'Reading', developmentalStatus: 'Achieved', notes: null },
    ], null, 999999),
    'does not reference an existing assessment',
    'unknown correctsAssessmentId throws'
  );

  console.log('\nTest OR-02: correcting another teacher\'s assessment throws');
  const { assessmentId: teacherAOriginal } = saveObservationSubmission(TEACHER_A, { grade: '1', subject: 'Literacy' }, [
    { learnerName: 'Zola', domain: 'Reading', developmentalStatus: 'Developing', notes: 'Needs support with phonics.' },
  ]);
  assertThrows(
    () => saveObservationSubmission(TEACHER_B, { grade: '1', subject: 'Literacy' }, [
      { learnerName: 'Zola', domain: 'Reading', developmentalStatus: 'Achieved', notes: null },
    ], null, teacherAOriginal),
    "cannot correct another teacher's assessment",
    'cross-teacher correction throws'
  );

  console.log('\nTest OR-03: a valid correction saves and links both directions');
  const { assessmentId: teacherACorrection } = saveObservationSubmission(TEACHER_A, { grade: '1', subject: 'Literacy' }, [
    { learnerName: 'Zola', domain: 'Reading', developmentalStatus: 'Achieved', notes: 'Reassessed — now confident.' },
  ], null, teacherAOriginal);

  const originalAfterCorrection = getObservationAssessment(teacherAOriginal);
  const correctionRecord = getObservationAssessment(teacherACorrection);
  assertEq(originalAfterCorrection.supersededByAssessmentId, teacherACorrection, 'original.supersededByAssessmentId points at the correction');
  assertEq(correctionRecord.correctsAssessmentId, teacherAOriginal, 'correction.correctsAssessmentId points back at the original');
  assert(originalAfterCorrection.records.length === 1, 'original assessment row and its records are untouched, not mutated');
  assertEq(originalAfterCorrection.records[0].developmentalStatus, 'Developing', 'original record retains its ORIGINAL status — insert-only, never overwritten');

  console.log('\nTest OR-04: getObservationHistory hides superseded assessments by default');
  const historyDefault = getObservationHistory(TEACHER_A);
  const historyHasOriginal = historyDefault.some(a => a.id === teacherAOriginal);
  const historyHasCorrection = historyDefault.some(a => a.id === teacherACorrection);
  assert(!historyHasOriginal, 'superseded original is excluded from default history');
  assert(historyHasCorrection, 'the correction itself appears in default history');

  console.log('\nTest OR-05: getObservationHistory({ includeSuperseded: true }) includes it');
  const historyIncludingSuperseded = getObservationHistory(TEACHER_A, { includeSuperseded: true });
  assert(historyIncludingSuperseded.some(a => a.id === teacherAOriginal), 'superseded original reappears when includeSuperseded is passed');

  console.log('\nTest OR-06: a failed correction (bad record) rolls back the new row without touching the original');
  const { assessmentId: rollbackOriginal } = saveObservationSubmission(TEACHER_A, { grade: '2', subject: 'Numeracy' }, [
    { learnerName: 'Thandeka', domain: 'Counting', developmentalStatus: 'Developing', notes: null },
  ]);
  assertThrows(
    () => saveObservationSubmission(TEACHER_A, { grade: '2', subject: 'Numeracy' }, [
      { learnerName: 'Thandeka', domain: null, developmentalStatus: null, notes: null }, // NOT NULL violation
    ], null, rollbackOriginal),
    null,
    'correction with an invalid record throws'
  );
  const survivedOriginal = getObservationAssessment(rollbackOriginal);
  assert(survivedOriginal !== null, 'original assessment still exists after a failed correction attempt');
  assert(survivedOriginal.supersededByAssessmentId === null, 'original is NOT marked as superseded — the failed correction never committed');
  const danglingCount = _db.prepare(
    `SELECT COUNT(*) as c FROM observation_assessments WHERE corrects_assessment_id = ?`
  ).get(rollbackOriginal).c;
  assertEq(danglingCount, 0, 'no orphaned correction row was left behind by the rollback');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 2: Delete
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 2: Delete ─────────────────────────────────────────────────');

  console.log('\nTest OR-07: deleting a non-existent assessment returns null');
  assertEq(deleteObservationAssessment(999999, TEACHER_A), null, 'delete of unknown id returns null (no throw)');

  console.log('\nTest OR-08: cross-teacher delete throws, leaves the row intact');
  const { assessmentId: protectedId } = saveObservationSubmission(TEACHER_A, { grade: '3' }, [
    { learnerName: 'Naledi', domain: 'Writing', developmentalStatus: 'Emerging', notes: null },
  ]);
  assertThrows(
    () => deleteObservationAssessment(protectedId, TEACHER_B),
    'does not belong to this teacher',
    'cross-teacher delete throws'
  );
  assert(getObservationAssessment(protectedId) !== null, 'assessment survives a rejected cross-teacher delete attempt');

  console.log('\nTest OR-09: a valid delete removes both the assessment and its records');
  const beforeRecordCount = _db.prepare(
    `SELECT COUNT(*) as c FROM observation_records WHERE assessment_id = ?`
  ).get(protectedId).c;
  assertEq(beforeRecordCount, 1, 'sanity check — one record exists before delete');
  const deleteResult = deleteObservationAssessment(protectedId, TEACHER_A);
  assertEq(deleteResult, { assessmentId: protectedId, deleted: true }, 'deleteObservationAssessment returns the expected shape');
  assertEq(getObservationAssessment(protectedId), null, 'assessment is gone after delete');
  const afterRecordCount = _db.prepare(
    `SELECT COUNT(*) as c FROM observation_records WHERE assessment_id = ?`
  ).get(protectedId).c;
  assertEq(afterRecordCount, 0, 'child records are gone too — no orphaned observation_records rows');

  console.log('\nTest OR-10: deleting a CORRECTED (original) assessment does not throw and does not break the corrector');
  const { assessmentId: danglingOriginal } = saveObservationSubmission(TEACHER_A, { grade: '1', subject: 'Life Skills' }, [
    { learnerName: 'Kagiso', domain: 'Gross Motor', developmentalStatus: 'Developing', notes: null },
  ]);
  const { assessmentId: danglingCorrection } = saveObservationSubmission(TEACHER_A, { grade: '1', subject: 'Life Skills' }, [
    { learnerName: 'Kagiso', domain: 'Gross Motor', developmentalStatus: 'Achieved', notes: null },
  ], null, danglingOriginal);
  // This is the FK-enforcement bug this suite caught: PRAGMA foreign_keys = ON
  // (utils/database.js) means corrects_assessment_id is a real, enforced FK —
  // deleting a row still referenced by it must not throw. It didn't, before
  // this suite existed, because nothing had ever exercised this path against
  // a real (FK-enforcing) SQLite connection.
  assert(
    (() => { try { deleteObservationAssessment(danglingOriginal, TEACHER_A); return true; } catch (e) { console.error('     unexpected throw:', e.message); return false; } })(),
    'deleting a corrected original does not throw a FOREIGN KEY constraint error'
  );
  const survivingCorrection = getObservationAssessment(danglingCorrection);
  assert(survivingCorrection !== null, 'the correction itself still loads fine after its original is deleted');
  assertEq(survivingCorrection.correctsAssessmentId, null, "correctsAssessmentId is cleared (not left dangling) once its target is deleted — required under FK enforcement, and getObservationAssessment() reads it as 'no correction found'");
  assertEq(getObservationAssessment(danglingOriginal), null, 'looking up the deleted original directly returns null, not a crash');

  console.log('\nTest OR-11: dangling reference — deleting the CORRECTOR un-supersedes the original cleanly');
  const { assessmentId: reappearOriginal } = saveObservationSubmission(TEACHER_A, { grade: '2', subject: 'Numeracy' }, [
    { learnerName: 'Rethabile', domain: 'Shapes', developmentalStatus: 'Developing', notes: null },
  ]);
  const { assessmentId: reappearCorrection } = saveObservationSubmission(TEACHER_A, { grade: '2', subject: 'Numeracy' }, [
    { learnerName: 'Rethabile', domain: 'Shapes', developmentalStatus: 'Achieved', notes: null },
  ], null, reappearOriginal);
  assert(getObservationAssessment(reappearOriginal).supersededByAssessmentId === reappearCorrection, 'sanity check — original is marked superseded before the delete');
  deleteObservationAssessment(reappearCorrection, TEACHER_A);
  const reappeared = getObservationAssessment(reappearOriginal);
  assertEq(reappeared.supersededByAssessmentId, null, 'original no longer reports itself as superseded once its corrector is deleted (fresh id lookup, not a stale flag)');
  assert(getObservationHistory(TEACHER_A).some(a => a.id === reappearOriginal), 'original reappears in default history once its corrector is gone');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 3: Resolve follow-ups
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 3: Resolve follow-ups ─────────────────────────────────────');

  console.log('\nTest OR-12: resolving a non-existent record returns null');
  assertEq(resolveObservationRecord(999999, TEACHER_A), null, 'resolve of unknown record id returns null (no throw)');

  const { assessmentId: resolveAssessmentId } = saveObservationSubmission(TEACHER_A, { grade: '0' }, [
    { learnerName: 'Boitumelo', domain: 'Social', developmentalStatus: 'Emerging', notes: 'Struggles with sharing.' },
  ]);
  const recordToResolve = getObservationAssessment(resolveAssessmentId).records[0];

  console.log('\nTest OR-13: cross-teacher resolve throws, leaves the record unresolved');
  assertThrows(
    () => resolveObservationRecord(recordToResolve.id, TEACHER_B),
    'does not belong to this teacher',
    'cross-teacher resolve throws'
  );
  assertEq(getObservationAssessment(resolveAssessmentId).records[0].resolved, false, 'record remains unresolved after a rejected cross-teacher attempt');

  console.log('\nTest OR-14: a valid resolve sets resolved = true and is idempotent on repeat');
  const resolveResult = resolveObservationRecord(recordToResolve.id, TEACHER_A);
  assertEq(resolveResult, { recordId: recordToResolve.id, resolved: true }, 'resolveObservationRecord returns the expected shape');
  assertEq(getObservationAssessment(resolveAssessmentId).records[0].resolved, true, 'record is resolved on retrieval');
  resolveObservationRecord(recordToResolve.id, TEACHER_A); // resolve again
  assertEq(getObservationAssessment(resolveAssessmentId).records[0].resolved, true, 'resolving an already-resolved record is a safe no-op, still resolved');

  console.log('\nTest OR-15: resolved status is per-record — sibling records in the same assessment are unaffected');
  const { assessmentId: multiId } = saveObservationSubmission(TEACHER_A, { grade: '0' }, [
    { learnerName: 'Ayanda', domain: 'Language', developmentalStatus: 'Developing', notes: null },
    { learnerName: 'Buhle', domain: 'Language', developmentalStatus: 'Developing', notes: null },
  ]);
  const [recA, recB] = getObservationAssessment(multiId).records;
  resolveObservationRecord(recA.id, TEACHER_A);
  const afterPartialResolve = getObservationAssessment(multiId).records;
  assert(afterPartialResolve.find(r => r.id === recA.id).resolved === true, 'first record resolved');
  assert(afterPartialResolve.find(r => r.id === recB.id).resolved === false, 'second record untouched — resolve does not leak across siblings');

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`Observation Repository (corrections/delete/resolve) Results: ${passed} passed, ${failed} failed`);

  testDb.cleanup();

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
