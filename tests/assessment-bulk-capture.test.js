'use strict';
/**
 * AssessmentCaptureService bulk-capture tests (ADR-006 PR4 Phase 2).
 *
 * Covers submitBulkReply() only — the pure state-machine logic that
 * applies a pasted block of marks to as many remaining learner slots as
 * it covers. utils/marksParser.js's parseMarks() is mocked via dependency
 * injection (submitBulkReply's third `deps` argument) so these tests
 * never touch the real CSV/XLSX/text parsing — that's marksParser.test.js's
 * job. This file only exercises the adapt-and-apply boundary.
 *
 * Deliberately NOT covered here (out of scope for Phase 2, per the PR4
 * plan): flows/assessmentSessionFlow.js dispatch, webhook wiring. Those
 * land in Phase 3.
 *
 * Run individually: node tests/assessment-bulk-capture.test.js
 * Run via npm:       npm test
 */

const {
  initCapture,
  isComplete,
  submitReply,
  submitBulkReply,
  toLearnerResults,
} = require('../services/assessmentCaptureService');

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

const BLUEPRINT = {
  id: 42,
  title: 'Term 3 Fractions Test',
  totalMarks: 15,
  version: 1,
  grade: 5,
  subject: 'Mathematics',
  term: 3,
  questions: [
    { questionNumber: 1, topic: 'Fractions', maxMarks: 5 },
    { questionNumber: 2, topic: 'Decimals', maxMarks: 10 },
  ],
};

function freshState(learnerCount = 3) {
  return initCapture({
    blueprint: BLUEPRINT,
    classId: 7,
    className: '5B',
    learnerCount,
  });
}

// Builds a fake parseMarks() implementation (marksParser.js's return shape)
// so tests never depend on the real text-format grammar.
function fakeParseMarks({ learners = [], warnings = [], errors = [] } = {}) {
  return () => ({ learners, totalMark: 0, questionCount: 2, questionMaxMarks: {}, questionTopics: {}, warnings, errors });
}

function learnerRecord(name, q1, q2) {
  return { learnerName: name, questionData: { 1: { mark: q1, maxMark: 5 }, 2: { mark: q2, maxMark: 10 } } };
}

console.log('\n── Section 1: Exact-count paste completes the session ──────────────');
{
  const state = freshState(2);
  const parseMarks = fakeParseMarks({
    learners: [learnerRecord('Sipho Dlamini', 4, 8), learnerRecord('Lebo Molefe', 5, 9)],
  });

  const r = submitBulkReply(state, 'irrelevant pasted text', { parseMarks });
  assert(r.ok, 'bulk reply accepted');
  assert(isComplete(r.state), 'session is complete after exact-count paste');
  assert(r.result.appliedCount === 2, 'appliedCount is 2');
  assert(r.result.skipped.length === 0, 'nothing skipped');

  const results = toLearnerResults(r.state);
  assert(results[0].learnerName === 'Sipho Dlamini' && results[0].questionData[1] === 4, 'learner 1 marks recorded correctly');
  assert(results[1].learnerName === 'Lebo Molefe' && results[1].questionData[2] === 9, 'learner 2 marks recorded correctly');
}

console.log('\n── Section 2: Partial paste fills some slots, leaves rest for turn-by-turn ──');
{
  const state = freshState(3);
  const parseMarks = fakeParseMarks({ learners: [learnerRecord('Sipho Dlamini', 4, 8)] });

  const r = submitBulkReply(state, 'irrelevant', { parseMarks });
  assert(r.ok, 'bulk reply accepted');
  assert(!isComplete(r.state), 'session not complete — 2 slots remain');
  assert(r.state.learnerIndex === 1, 'learnerIndex advanced by 1');
  assert(r.state.captureStep === 'name', 'falls back to asking for learner 2\'s name');
  assert(r.result.appliedCount === 1, 'appliedCount is 1');

  // Capture can continue turn-by-turn from exactly where the paste left off.
  const r2 = submitReply(r.state, 'Zanele Khumalo');
  assert(r2.ok, 'single-turn submitReply still works after a partial bulk paste');
  assert(r2.state.captureStep === 'marks', 'moved to marks for learner 2');
}

console.log('\n── Section 3: Overflow paste (more learners than remaining slots) ──');
{
  const state = freshState(2);
  const parseMarks = fakeParseMarks({
    learners: [learnerRecord('Sipho Dlamini', 4, 8), learnerRecord('Lebo Molefe', 5, 9), learnerRecord('Zanele Khumalo', 3, 7)],
  });

  const r = submitBulkReply(state, 'irrelevant', { parseMarks });
  assert(r.ok, 'bulk reply still accepted (first 2 applied)');
  assert(isComplete(r.state), 'session complete — the 2 slots were filled');
  assert(r.result.appliedCount === 2, 'appliedCount capped at learnerCount (2)');
  assert(r.result.skipped.length === 1, 'the 3rd learner is reported as skipped, not silently dropped');
  assert(r.result.skipped[0].learnerName === 'Zanele Khumalo', 'skipped entry names the overflow learner');
  assert(/only has 2 learner/.test(r.result.skipped[0].reason), 'skip reason explains the slot mismatch');
}

console.log('\n── Section 4: Per-learner validation failures are surfaced, not dropped silently ──');
{
  const state = freshState(2);
  // Second learner has a mark above the blueprint's max (Q1 max is 5).
  const parseMarks = fakeParseMarks({
    learners: [learnerRecord('Sipho Dlamini', 4, 8), learnerRecord('Lebo Molefe', 99, 9)],
  });

  const r = submitBulkReply(state, 'irrelevant', { parseMarks });
  assert(r.ok, 'bulk reply accepted (1 of 2 valid)');
  assert(!isComplete(r.state), 'session not complete — invalid learner was skipped, not applied');
  assert(r.state.learnerIndex === 1, 'only the valid learner advanced the index');
  assert(r.result.skipped.length === 1, 'one learner reported as skipped');
  assert(r.result.skipped[0].learnerName === 'Lebo Molefe', 'skipped entry names the invalid learner');
}

console.log('\n── Section 5: Parser-level fatal error leaves state untouched ──────');
{
  const state = freshState(2);
  const parseMarks = fakeParseMarks({ learners: [], errors: ['Could not read any learner data from that paste.'] });

  const r = submitBulkReply(state, 'garbage', { parseMarks });
  assert(!r.ok, 'bulk reply rejected on parser-level error');
  assert(r.state === state, 'state reference unchanged on failure');
  assert(r.error === 'Could not read any learner data from that paste.', 'error message surfaced from the parser');
  assert(r.result.errors.length === 1, 'result.errors carries the parser error');
}

console.log('\n── Section 6: Every learner invalid → no learners captured ─────────');
{
  const state = freshState(2);
  const parseMarks = fakeParseMarks({ learners: [learnerRecord('Bad Row', 999, 999)] });

  const r = submitBulkReply(state, 'irrelevant', { parseMarks });
  assert(!r.ok, 'bulk reply rejected — nothing valid to apply');
  assert(r.state === state, 'state reference unchanged on failure');
  assert(r.result.skipped.length === 1, 'the invalid learner is still reported in result.skipped');
}

console.log('\n── Section 7: Warnings pass through untouched (e.g. duplicate names) ──');
{
  const state = freshState(2);
  const parseMarks = fakeParseMarks({
    learners: [learnerRecord('Thabo M', 4, 8), learnerRecord('Thabo K', 5, 9)],
    warnings: ['Duplicate learner name(s) found: thabo.'],
  });

  const r = submitBulkReply(state, 'irrelevant', { parseMarks });
  assert(r.ok, 'bulk reply accepted');
  assert(r.result.warnings.length === 1, 'parser warning passed through to result.warnings');
}

console.log('\n── Section 8: Bulk reply on an already-complete session is rejected ──');
{
  let state = freshState(1);
  state = submitReply(state, 'Sipho').state;
  state = submitReply(state, '4').state;
  state = submitReply(state, '9').state;
  assert(isComplete(state), 'sanity check — session is complete');

  const parseMarks = fakeParseMarks({ learners: [learnerRecord('Anyone', 1, 1)] });
  const r = submitBulkReply(state, 'irrelevant', { parseMarks });
  assert(!r.ok, 'bulk reply rejected on a completed session');
  assert(r.error === 'This assessment session is already complete.', 'completion error message matches submitReply()\'s');
}

console.log('\n── Section 9: Default (uninjected) parseMarks resolves the real module ──');
{
  // No deps passed — submitBulkReply must fall back to the real
  // utils/marksParser.js without throwing, even though this specific
  // pasted text won't produce a usable learner (a parser-shape smoke
  // test, not a marksParser grammar test).
  const state = freshState(1);
  const r = submitBulkReply(state, 'not a real mark sheet at all');
  assert(typeof r.ok === 'boolean', 'default parseMarks wiring resolves without throwing');
}

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));
process.exit(failed > 0 ? 1 : 0);
