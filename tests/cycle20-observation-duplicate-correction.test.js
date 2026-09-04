'use strict';
/**
 * Cycle 20 Priority 2 regression test.
 *
 * Finding: saveObservationSubmission() never checks whether the target
 * of correctsAssessmentId has already been corrected by an earlier row.
 * The flow layer (flows/observationFlow.js) only guards this with a
 * CACHED supersededByAssessmentId captured when the detail view was
 * shown -- if two DONE submissions for the same correction reach the
 * repository before either one lands (e.g. a duplicate/rapid resend at
 * the WhatsApp layer, which is not itself deduped by message-id since
 * each resend is a distinct message), both succeed and the original
 * assessment ends up with two "corrector" rows pointing at it.
 *
 * observationRepository.js's own docstring for getObservationAssessment
 * already anticipated this ("if that were ever violated, the most
 * recent corrector wins here") but nothing actually prevents it, and
 * the *older* corrector row is not marked as superseded by anything --
 * it silently remains a normal, undistinguished entry in
 * getObservationHistory(), i.e. the teacher sees two independent
 * "current" observations for what was meant to be one corrected
 * assessment, with no indication either is stale.
 *
 * This test reproduces the gap pre-fix and asserts the invariant
 * post-fix: a second correction of an already-corrected assessment
 * must be rejected, not silently accepted.
 *
 * Run individually: node tests/cycle20-observation-duplicate-correction.test.js
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
  } = require('../services/observationRepository');

  const TEACHER = 'obs_dup_corr_teacher';
  _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(TEACHER);

  const header = { assessment: 'Term 1 check-in', grade: '4', subject: 'Maths' };
  const records = [{ learnerName: 'Thabo', domain: 'Number', developmentalStatus: 'Emerging', notes: null }];

  console.log('\nTest C20-1: a second correction of an already-corrected assessment is rejected');
  const orig = saveObservationSubmission(TEACHER, header, records, null, null);

  const corrA = saveObservationSubmission(TEACHER, header, records, null, orig.assessmentId);
  assert(corrA.assessmentId !== orig.assessmentId, 'first correction succeeds and creates a new row');

  assertThrows(
    () => saveObservationSubmission(TEACHER, header, records, null, orig.assessmentId),
    'already been corrected',
    'second correction of the same original is rejected, not silently accepted'
  );

  const origAfter = getObservationAssessment(orig.assessmentId);
  assert(origAfter.supersededByAssessmentId === corrA.assessmentId,
    'original still points to the one legitimate corrector');

  const history = getObservationHistory(TEACHER, {});
  assert(history.length === 1 && history[0].id === corrA.assessmentId,
    'history shows exactly one current version, not a hidden duplicate');

  console.log('\nTest C20-2: correcting an assessment that was never corrected still works normally');
  const orig2 = saveObservationSubmission(TEACHER, header, records, null, null);
  const corr2 = saveObservationSubmission(TEACHER, header, records, null, orig2.assessmentId);
  assert(corr2.assessmentId !== orig2.assessmentId, 'ordinary single correction is unaffected by the fix');

  console.log('\n───────────────────────────────────────────────────────');
  console.log(`Observation Duplicate-Correction (Cycle 20) Results: ${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
}

run();
