'use strict';

// ADR-006 PR5 Phase 1b — EDIT <learner>. Unit tests for submitEdit() and
// its interaction with submitReply()/submitUndo(), following the same
// no-DB, pure-function testing approach as the rest of
// assessmentCaptureService.js's suite. Plain Node script (no Jest globals) —
// this project's tests/run-all.js runs each file directly with `node`.

const assert = require('assert');

const {
  initCapture,
  submitReply,
  submitEdit,
  submitUndo,
  formatCapturePrompt,
} = require('../services/assessmentCaptureService');

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    failed++;
  }
}

function deepEqual(a, b) {
  try {
    assert.deepStrictEqual(a, b);
    return true;
  } catch (e) {
    return false;
  }
}

function makeBlueprint() {
  return {
    id: 1,
    title: 'Term 2 Test',
    totalMarks: 20,
    version: 1,
    grade: 5,
    subject: 'Mathematics',
    term: 2,
    questions: [
      { questionNumber: 1, topic: 'Fractions', maxMarks: 10 },
      { questionNumber: 2, topic: 'Geometry', maxMarks: 10 },
    ],
  };
}

function baseState(learnerCount = 3) {
  return initCapture({
    blueprint: makeBlueprint(),
    classId: 1,
    className: 'Class 5A',
    learnerCount,
  });
}

// Drives a full name+marks turn for one learner via submitReply().
function captureLearner(state, name, marks) {
  let s = submitReply(state, name).state;
  for (const m of marks) {
    s = submitReply(s, String(m)).state;
  }
  return s;
}

console.log('\n── submitEdit(): jump to an already-captured learner, return to original cursor ──');
{
  let state = baseState();
  state = captureLearner(state, 'Sipho', [5, 6]);
  state = captureLearner(state, 'Naledi', [7, 8]);
  // Now on learner 3 (Thabo), question 1, having not yet entered a name.
  const beforeEdit = submitReply(state, 'Thabo').state; // name only, still question 1

  const editResult = submitEdit(beforeEdit, 'Sipho');
  check('EDIT accepted', editResult.ok === true);
  check('cursor jumps to learner index 0 (Sipho)', editResult.state.learnerIndex === 0);
  check('cursor jumps to question index 0', editResult.state.questionIndex === 0);
  check('capture step is marks', editResult.state.captureStep === 'marks');
  check('editing metadata recorded correctly', deepEqual(editResult.state.editing, {
    learnerIndex: 0,
    returnLearnerIndex: 2,
    returnQuestionIndex: 0,
    returnCaptureStep: 'marks',
  }));

  // Re-answer both of Sipho's questions.
  const afterQ1 = submitReply(editResult.state, '9').state;
  check('still mid-edit after first re-answered question', afterQ1.editing !== null);
  const afterQ2 = submitReply(afterQ1, '10').state;

  // Cursor must land back exactly where it was before EDIT was sent.
  check('editing cleared once both questions re-answered', afterQ2.editing === null);
  check('cursor returns to learner index 2 (Thabo)', afterQ2.learnerIndex === 2);
  check('cursor returns to question index 0', afterQ2.questionIndex === 0);
  check('capture step returns to marks', afterQ2.captureStep === 'marks');
  check('Sipho marks updated correctly', deepEqual(afterQ2.learners[0].marks, { 1: 9, 2: 10 }));

  check('progress not double-counted (4 questions answered)', afterQ2.progress.questionsAnswered === 4);
  check('progress not double-counted (2 learners completed)', afterQ2.progress.learnersCompleted === 2);
}

console.log('\n── submitEdit(): a single UNDO right after EDIT cancels the jump ──');
{
  let state = baseState();
  state = captureLearner(state, 'Sipho', [5, 6]);
  const beforeEdit = submitReply(state, 'Naledi').state; // learner 2, question 1, name set

  const editResult = submitEdit(beforeEdit, 'Sipho');
  check('EDIT accepted', editResult.ok === true);

  const undoResult = submitUndo(editResult.state);
  check('UNDO accepted', undoResult.ok === true);
  check('learnerIndex restored', undoResult.state.learnerIndex === beforeEdit.learnerIndex);
  check('questionIndex restored', undoResult.state.questionIndex === beforeEdit.questionIndex);
  check('captureStep restored', undoResult.state.captureStep === beforeEdit.captureStep);
  check('editing cleared after undo', undoResult.state.editing === null);
}

console.log('\n── submitEdit(): rejects a second EDIT while one is already in progress ──');
{
  let state = baseState();
  state = captureLearner(state, 'Sipho', [5, 6]);
  const beforeEdit = submitReply(state, 'Naledi').state;
  const editResult = submitEdit(beforeEdit, 'Sipho');

  const secondEdit = submitEdit(editResult.state, 'Sipho');
  check('second EDIT rejected', secondEdit.ok === false);
  check('error mentions already editing', /already editing/i.test(secondEdit.error || ''));
  check('state unchanged on failure (same reference)', secondEdit.state === editResult.state);
}

console.log('\n── submitEdit(): rejects EDIT once the whole capture is complete ──');
{
  let state = baseState();
  state = captureLearner(state, 'Sipho', [5, 6]);
  state = captureLearner(state, 'Naledi', [7, 8]);
  state = captureLearner(state, 'Thabo', [9, 10]); // completes the session

  const editResult = submitEdit(state, 'Sipho');
  check('EDIT rejected once complete', editResult.ok === false);
  check('error mentions already complete', /already complete/i.test(editResult.error || ''));
}

console.log('\n── submitEdit(): rejects a query matching no captured learner ──');
{
  let state = baseState();
  state = captureLearner(state, 'Sipho', [5, 6]);

  const editResult = submitEdit(state, 'Zanele');
  check('EDIT rejected for unmatched name', editResult.ok === false);
  check('error mentions no captured learner matches', /no captured learner matches/i.test(editResult.error || ''));
}

console.log('\n── submitEdit(): rejects an ambiguous query matching more than one learner ──');
{
  let state = initCapture({
    blueprint: makeBlueprint(),
    classId: 1,
    className: 'Class 5A',
    learnerCount: 4,
  });
  state = captureLearner(state, 'Sipho Dlamini', [5, 6]);
  state = captureLearner(state, 'Sipho Nkosi', [7, 8]);

  const editResult = submitEdit(state, 'Sipho');
  check('EDIT rejected for ambiguous match', editResult.ok === false);
  check('error mentions more than one learner matches', /more than one learner matches/i.test(editResult.error || ''));
  check('error names Sipho Dlamini', (editResult.error || '').includes('Sipho Dlamini'));
  check('error names Sipho Nkosi', (editResult.error || '').includes('Sipho Nkosi'));
}

console.log('\n── submitEdit(): rejects EDIT with no query text ──');
{
  let state = baseState();
  state = captureLearner(state, 'Sipho', [5, 6]);

  const editResult = submitEdit(state, '');
  check('EDIT rejected for empty query', editResult.ok === false);
  check('error asks which learner', /specify which learner/i.test(editResult.error || ''));
}

console.log('\n── submitEdit(): cannot target a learner who has not been named yet ──');
{
  let state = baseState();
  state = captureLearner(state, 'Sipho', [5, 6]);
  // Learner index 1 (Naledi's slot) has no name yet, learner 2 unreached.

  const editResult = submitEdit(state, 'anything');
  check('EDIT rejected for unnamed learner target', editResult.ok === false);
  check('error mentions no captured learner matches', /no captured learner matches/i.test(editResult.error || ''));
}

console.log('\n── Duplicate ✏️ defect: formatCapturePrompt owns the edit prefix exactly once ──');
{
  // Recon finding: assessmentSessionFlow.js used to wrap formatCapturePrompt's
  // own "✏️ Editing — " prefix in a second, redundant "✏️ " at the call
  // site, producing "✏️ ✏️ Editing — ..." on the wire. formatCapturePrompt()
  // is the single source of truth for that prefix; this pins its contract
  // so the flow layer can safely pass its return value straight through.
  let state = baseState();
  state = captureLearner(state, 'Sipho', [5, 6]);
  const beforeEdit = submitReply(state, 'Naledi').state;
  const editResult = submitEdit(beforeEdit, 'Sipho');

  const prompt = formatCapturePrompt(editResult.state);
  const emojiCount = (prompt.match(/✏️/g) || []).length;
  check('prompt contains exactly one ✏️ while mid-edit', emojiCount === 1);
  check('prompt starts with the single edit prefix', prompt.startsWith('✏️ Editing — '));

  // Non-editing state must carry no edit prefix at all.
  const normalPrompt = formatCapturePrompt(beforeEdit);
  check('non-editing prompt has no ✏️', !normalPrompt.includes('✏️'));
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`Assessment Capture EDIT Results: ${passed} passed, ${failed} failed`);
console.log('─'.repeat(50));

if (failed > 0) {
  process.exit(1);
}
