'use strict';
/**
 * AssessmentCaptureService — submitUndo() tests (ADR-006 PR5 Phase 1a).
 *
 * Pure state-machine logic, no DB/WhatsApp involved — same convention as
 * tests/assessment-capture-service.test.js. Covers:
 *   1. UNDO after a single mark reverts to the prompt for that same mark.
 *   2. UNDO after a name entry reverts to asking for the name again.
 *   3. Consecutive UNDOs walk back multiple turns, one at a time.
 *   4. UNDO with no history yet returns a "Nothing to undo." error and
 *      leaves state untouched.
 *   5. UNDO on an already-complete session is refused (matches the
 *      "session already deleted" real-world case).
 *   6. UNDO after a bulk paste reverts the *whole paste* as one unit, not
 *      learner-by-learner.
 *   7. History is capped at MAX_HISTORY — walking back further than the
 *      cap runs out of history even though more turns happened.
 *
 * Run individually: node tests/assessment-capture-undo.test.js
 * Run via npm:       npm test
 */

const {
  initCapture,
  isComplete,
  submitReply,
  submitBulkReply,
  submitUndo,
  formatCapturePrompt,
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

function freshState(learnerCount = 2) {
  return initCapture({ blueprint: BLUEPRINT, classId: 7, className: '5B', learnerCount });
}

// ═══════════════════════════════════════════════════════════════════
console.log('\n── Section 1: UNDO after a single mark reverts that one mark ──────');
{
  let state = freshState(2);
  state = submitReply(state, 'Sipho Dlamini').state; // name
  state = submitReply(state, '4').state; // Q1 = 4 (should be 9, typo)

  assert(state.learners[0].marks[1] === 4, 'mark 4 was recorded for Q1 before undo');
  assert(state.questionIndex === 1, 'advanced to Q2 after the mistaken entry');

  const undone = submitUndo(state);
  assert(undone.ok === true, 'undo succeeds');
  assert(undone.state.questionIndex === 0, 'back on Q1');
  assert(undone.state.learners[0].marks[1] === undefined, 'the mistaken Q1 mark is gone');
  assert(undone.state.learners[0].name === 'Sipho Dlamini', 'name entry itself is untouched by this single undo');

  // Re-enter the correct mark (Q1's max is 5) and confirm capture
  // continues normally.
  const corrected = submitReply(undone.state, '5').state;
  assert(corrected.learners[0].marks[1] === 5, 'corrected mark recorded after undo + re-entry');
}

// ═══════════════════════════════════════════════════════════════════
console.log('\n── Section 2: UNDO after a name entry reverts to asking for the name ─');
{
  let state = freshState(2);
  state = submitReply(state, 'Wrong Name').state;
  assert(state.captureStep === 'marks', 'advanced to marks after the name reply');

  const undone = submitUndo(state);
  assert(undone.ok === true, 'undo succeeds');
  assert(undone.state.captureStep === 'name', 'back to asking for learner 1\'s name');
  assert(formatCapturePrompt(undone.state).includes('What is their name?'), 'prompt reflects the reverted step');
  assert(undone.state.learners.length === 0 || !undone.state.learners[0], 'the wrong name was discarded');
}

// ═══════════════════════════════════════════════════════════════════
console.log('\n── Section 3: consecutive UNDOs walk back one turn at a time ──────');
{
  let state = freshState(2);
  state = submitReply(state, 'Learner One').state; // turn 1: name
  state = submitReply(state, '3').state; // turn 2: Q1 = 3
  state = submitReply(state, '7').state; // turn 3: Q2 = 7 -> rolls to learner 2, name step

  assert(state.learnerIndex === 1, 'rolled over to learner 2');
  assert(state.captureStep === 'name', 'learner 2 asked for a name');

  let step = submitUndo(state);
  assert(step.ok === true, 'undo #1 succeeds');
  assert(step.state.learnerIndex === 0 && step.state.questionIndex === 1, 'undo #1 reverts the Q2=7 turn, back on learner 1 Q2');

  step = submitUndo(step.state);
  assert(step.ok === true, 'undo #2 succeeds');
  assert(step.state.questionIndex === 0, 'undo #2 reverts the Q1=3 turn, back on learner 1 Q1');

  step = submitUndo(step.state);
  assert(step.ok === true, 'undo #3 succeeds');
  assert(step.state.captureStep === 'name', 'undo #3 reverts the name turn, back to asking for a name');

  step = submitUndo(step.state);
  assert(step.ok === false, 'undo #4 has nothing left to revert');
  assert(step.error === 'Nothing to undo.', 'correct error message once history is exhausted');
}

// ═══════════════════════════════════════════════════════════════════
console.log('\n── Section 4: UNDO with empty history is refused, state untouched ─');
{
  const state = freshState(2);
  const result = submitUndo(state);
  assert(result.ok === false, 'fresh session has nothing to undo');
  assert(result.error === 'Nothing to undo.', 'correct error message');
  assert(result.state === state, 'same state reference returned on failure (no-op, per submitReply()/submitBulkReply() convention)');
}

// ═══════════════════════════════════════════════════════════════════
console.log('\n── Section 5: UNDO on an already-complete session is refused ──────');
{
  let state = freshState(1); // 1 learner, easiest to drive to completion
  state = submitReply(state, 'Only Learner').state;
  state = submitReply(state, '5').state;
  state = submitReply(state, '10').state;
  assert(isComplete(state), 'session is complete after the last mark');

  const result = submitUndo(state);
  assert(result.ok === false, 'undo refused on a completed session');
  assert(result.error === 'This assessment session is already complete.', 'matches submitReply()/submitBulkReply()\'s completion error');
}

// ═══════════════════════════════════════════════════════════════════
console.log('\n── Section 6: UNDO after a bulk paste reverts the whole paste ─────');
{
  let state = freshState(3);

  const fakeParseMarks = () => ({
    learners: [
      { learnerName: 'Sipho Dlamini', questionData: { 1: { mark: 4, maxMark: 5 }, 2: { mark: 8, maxMark: 10 } } },
      { learnerName: 'Lebo Molefe', questionData: { 1: { mark: 5, maxMark: 5 }, 2: { mark: 9, maxMark: 10 } } },
    ],
    totalMark: 0,
    questionCount: 2,
    questionMaxMarks: {},
    questionTopics: {},
    warnings: [],
    errors: [],
  });

  const bulk = submitBulkReply(state, 'Sipho Dlamini 4 8\nLebo Molefe 5 9', { parseMarks: fakeParseMarks });
  assert(bulk.ok === true, 'bulk paste applied');
  assert(bulk.state.learnerIndex === 2, 'both learners from the paste were applied');

  const undone = submitUndo(bulk.state);
  assert(undone.ok === true, 'undo succeeds after a bulk paste');
  assert(undone.state.learnerIndex === 0, 'undo reverts the ENTIRE paste at once (back to learner 1), not one learner at a time');
  assert(undone.state.learners.length === 0 || !undone.state.learners[0], 'both pasted learners are gone after a single undo');
  assert(undone.state.history.length === 0, 'history is empty again — the whole paste was exactly one entry');
}

// ═══════════════════════════════════════════════════════════════════
console.log('\n── Section 7: history is capped — walking back further runs out ───');
{
  // MAX_HISTORY is an internal constant (20). Drive well past it with a
  // large class so there are more real turns than the cap allows, then
  // confirm undo eventually reports "Nothing to undo." despite additional
  // turns having genuinely happened earlier in the session.
  // Stops one learner short of completion — submitUndo() refuses outright
  // on an already-complete session (Section 5), so a completed session
  // here would make every undo fail for that reason instead of the cap.
  const BIG_BLUEPRINT = { ...BLUEPRINT, questions: [{ questionNumber: 1, topic: 'Fractions', maxMarks: 5 }] };
  let state = initCapture({ blueprint: BIG_BLUEPRINT, classId: 7, className: 'Big', learnerCount: 25 });

  for (let i = 0; i < 24; i += 1) {
    state = submitReply(state, `Learner ${i}`).state;
    state = submitReply(state, '3').state;
  }
  state = submitReply(state, 'Learner 24').state; // final learner's name only — session stays open
  const totalTurns = 24 * 2 + 1; // 49 real turns, well past the cap
  assert(isComplete(state) === false, 'session still open (one learner short of completion)');

  let cursor = state;
  let undoCount = 0;
  for (let i = 0; i < totalTurns + 5; i += 1) { // +5 margin past the real turn count
    const result = submitUndo(cursor);
    if (!result.ok) break;
    cursor = result.state;
    undoCount += 1;
  }
  assert(undoCount <= 20, `history cap held — could not undo more than MAX_HISTORY turns (undid ${undoCount} of ${totalTurns} real turns)`);
  assert(undoCount > 0, 'at least some undos succeeded before the cap was hit');
}

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));
process.exit(failed > 0 ? 1 : 0);
