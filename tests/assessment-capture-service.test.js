'use strict';
/**
 * AssessmentCaptureService tests (ADR-006 PR2 — Marks Capture).
 *
 * Pure state-machine logic, no DB/WhatsApp involved — see
 * services/assessmentCaptureService.js's module doc for why this can be
 * tested without any of the harness machinery the blueprint/PDF tests need.
 *
 * Run individually: node tests/assessment-capture-service.test.js
 * Run via npm:       npm test
 */

const {
  initCapture,
  isComplete,
  submitReply,
  formatCapturePrompt,
  formatStatus,
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

console.log('\n── Section 1: First learner, first question ──────────────────────');
{
  const state = freshState(2);
  assert(state.captureStep === 'name', 'starts on NAME step');
  assert(state.learnerIndex === 0 && state.questionIndex === 0, 'starts at learner 0 / question 0');
  assert(formatCapturePrompt(state).includes('Learner 1/2'), 'prompt shows Learner 1/2');
  assert(formatCapturePrompt(state).includes('name'), 'prompt asks for a name');
}

console.log('\n── Section 2: Valid mark advances ─────────────────────────────────');
{
  let state = freshState(2);
  let r = submitReply(state, 'Sipho');
  assert(r.ok, 'name accepted');
  state = r.state;
  assert(state.captureStep === 'marks' && state.questionIndex === 0, 'moved to marks, question 0');

  r = submitReply(state, '4');
  assert(r.ok, 'valid mark (4/5) accepted');
  state = r.state;
  assert(state.questionIndex === 1, 'advanced to question 1');
  assert(state.learners[0].marks[1] === 4, 'mark stored under question 1');
}

console.log('\n── Section 3: Invalid mark rejected ───────────────────────────────');
{
  let state = freshState(2);
  state = submitReply(state, 'Sipho').state;
  const r = submitReply(state, 'two');
  assert(!r.ok, 'non-numeric mark rejected');
  assert(r.state === state, 'state unchanged on rejection');
  assert(/whole number/.test(r.error), 'error explains numeric requirement');
}

console.log('\n── Section 4: Max-mark enforcement ─────────────────────────────────');
{
  let state = freshState(2);
  state = submitReply(state, 'Sipho').state;
  const tooHigh = submitReply(state, '6'); // question 1 max is 5
  assert(!tooHigh.ok, 'mark above max_marks rejected');
  assert(/maximum of 5/.test(tooHigh.error), 'error names the max_marks value');

  const negative = submitReply(state, '-1');
  assert(!negative.ok, 'negative mark rejected (fails whole-number pattern)');
}

console.log('\n── Section 5: Learner rollover after final question ───────────────');
{
  let state = freshState(2);
  state = submitReply(state, 'Sipho').state;
  state = submitReply(state, '4').state; // Q1
  state = submitReply(state, '9').state; // Q2 (last question)
  assert(state.learnerIndex === 1, 'rolled over to learner index 1');
  assert(state.questionIndex === 0, 'question index reset to 0');
  assert(state.captureStep === 'name', 'back to NAME step for next learner');
  assert(state.progress.learnersCompleted === 1, 'progress reflects 1 learner completed');
}

console.log('\n── Section 6: Assessment completion after final learner ───────────');
{
  let state = freshState(2);
  state = submitReply(state, 'Sipho').state;
  state = submitReply(state, '4').state;
  state = submitReply(state, '9').state;
  state = submitReply(state, 'Amahle').state;
  state = submitReply(state, '5').state;
  state = submitReply(state, '10').state;
  assert(isComplete(state), 'capture is complete after last learner/question');
  assert(state.progress.learnersCompleted === 2, 'both learners counted as completed');
  assert(formatCapturePrompt(state) === '', 'capture prompt is empty once complete');
}

console.log('\n── Section 7: toLearnerResults() shape ─────────────────────────────');
{
  let state = freshState(1);
  state = submitReply(state, 'Neo').state;
  state = submitReply(state, '3').state;
  state = submitReply(state, '7').state;
  assert(isComplete(state), 'single-learner capture completes');
  const results = toLearnerResults(state);
  assert(results.length === 1, 'one learner result produced');
  assert(results[0].learnerName === 'Neo', 'learner name carried through');
  assert(results[0].questionData[1] === 3 && results[0].questionData[2] === 7, 'per-question marks keyed by question number');
}

console.log('\n── Section 8: STATUS reporting ─────────────────────────────────────');
{
  let state = freshState(2);
  state = submitReply(state, 'Sipho').state;
  state = submitReply(state, '4').state;
  const status = formatStatus(state);
  assert(status.includes('Learner 1 of 2'), 'status reports correct learner position');
  assert(status.includes('Question 2 of 2'), 'status reports correct question position');
  assert(status.includes('1 of 4 marks entered'), 'status reports raw progress count (1 of 2 learners × 2 questions)');
}

console.log('\n── Section 9: Invalid name rejected, no state advance ─────────────');
{
  const state = freshState(2);
  const r = submitReply(state, 'A');
  assert(!r.ok, 'single-character name rejected');
  assert(r.state === state, 'state unchanged on invalid name');
  assert(r.state.captureStep === 'name', 'still on NAME step after rejection');
}

console.log('\n── Section 10: No duplicate writes on repeated valid replies ──────');
{
  let state = freshState(2);
  state = submitReply(state, 'Sipho').state;
  const afterFirst = submitReply(state, '4').state;
  // Simulate the same physical reply being processed a second time against
  // the ALREADY-ADVANCED state (the only way a caller can "replay" — since
  // this module is pure/stateless, a duplicate webhook delivery of the
  // same raw text is applied to whatever state SessionStore currently
  // holds, which has already moved on to question 2).
  const afterSecond = submitReply(afterFirst, '4');
  assert(afterSecond.ok, 'second reply is processed against the NEW question, not rejected outright');
  assert(afterFirst.learners[0].marks[1] === 4, 'question 1 mark was written exactly once');
  assert(afterSecond.state.learners[0].marks[2] === 4, 'second reply landed on question 2, not overwriting question 1');
}

console.log('\n── Section 11: State survives reload (plain JSON round-trip) ──────');
{
  let state = freshState(2);
  state = submitReply(state, 'Sipho').state;
  state = submitReply(state, '4').state;
  // SessionStore persists state via JSON.stringify/JSON.parse (see
  // utils/sessionStore.js) — confirm nothing on this state depends on
  // object identity, functions, or non-JSON-safe values.
  const reloaded = JSON.parse(JSON.stringify(state));
  const r = submitReply(reloaded, '9');
  assert(r.ok, 'capture resumes correctly from a JSON round-tripped state');
  assert(isComplete(r.state) === false, 'sanity: not complete yet (learner 2 remains)');
}

console.log('\n── Section 12: Cancel is out of this module\'s scope (flow-level) ──');
{
  // CANCEL/STATUS/RESUME are intercepted in assessmentSessionFlow.js
  // BEFORE submitReply() is ever called (see handleAssessmentSessionFlow).
  // This asserts the defensive guard inside validateName() still refuses
  // to record a command word as a learner's name, in case that ordering
  // is ever broken.
  const state = freshState(2);
  const r = submitReply(state, 'CANCEL');
  assert(!r.ok, 'a bare CANCEL is never recorded as a learner name');
}

console.log('\n── Section 13: Roster prefill (ADR-006 PR2.5) ──────────────────────');
{
  const roster = [
    { id: 101, name: 'Sipho Dlamini' },
    { id: 102, name: 'Ayanda Nkosi' },
  ];
  let state = initCapture({ blueprint: BLUEPRINT, classId: 7, className: '5B', learnerCount: 2, roster });

  assert(state.captureStep === 'marks', 'NAME step is skipped when roster covers learner 1');
  assert(state.learners[0].name === 'Sipho Dlamini', 'learner 1 name prefilled from roster');
  assert(formatCapturePrompt(state).includes('Sipho Dlamini'), 'capture prompt shows the prefilled name immediately');

  state = submitReply(state, '4').state;
  state = submitReply(state, '9').state;
  assert(state.learnerIndex === 1, 'rolled over to learner 2 after learner 1 finishes');
  assert(state.captureStep === 'marks', 'learner 2 also skips NAME — prefilled from roster');
  assert(state.learners[1].name === 'Ayanda Nkosi', 'learner 2 name prefilled from roster');

  state = submitReply(state, '5').state;
  const finalResult = submitReply(state, '10');
  assert(isComplete(finalResult.state), 'capture completes normally with a full roster');
  assert(finalResult.state.learners[1].marks[2] === 10, 'last mark recorded correctly');
}

console.log('\n── Section 14: Partial roster falls back to asking for a name ─────');
{
  // learnerCount (3) exceeds roster.length (1) — e.g. a class grew but
  // the roster wasn't updated. Learner 1 is prefilled; learners 2 and 3
  // fall back to PR2's original ask-for-a-name behaviour.
  const roster = [{ id: 101, name: 'Sipho Dlamini' }];
  let state = initCapture({ blueprint: BLUEPRINT, classId: 7, className: '5B', learnerCount: 3, roster });

  assert(state.captureStep === 'marks', 'learner 1 still prefilled and skips NAME');
  state = submitReply(state, '4').state;
  state = submitReply(state, '9').state;
  assert(state.captureStep === 'name', 'learner 2 (past the end of the roster) is asked for a name');
  assert(formatCapturePrompt(state).includes('What is their name?'), 'prompt asks for a name for learner 2');

  state = submitReply(state, 'Lebo Molefe').state;
  assert(state.learners[1].name === 'Lebo Molefe', 'learner 2 name recorded from the reply, not the roster');
}

console.log('\n── Section 15: No roster (default) behaves exactly like PR2 ───────');
{
  const state = initCapture({ blueprint: BLUEPRINT, classId: 7, className: '5B', learnerCount: 2 });
  assert(state.captureStep === 'name', 'omitting roster entirely preserves PR2 ask-every-name behaviour');
  assert(state.learners.length === 0, 'learners array is empty, exactly as before PR2.5');
}

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));
process.exit(failed > 0 ? 1 : 0);
