'use strict';

/**
 * Assessment Capture Service (ADR-006 PR2 — Marks Capture).
 *
 * Pure state-machine logic for the ACTIVE step of an assessment session:
 * learner name -> per-question marks -> next learner -> ... -> completion.
 *
 * Deliberately has NO knowledge of WhatsApp, SessionStore, or the DB.
 * flows/assessmentSessionFlow.js owns all of that (prompts, persistence,
 * dispatch); this module is given a plain state object and a raw text
 * reply, and returns a new state object plus what happened. That mirrors
 * the separation blueprintAnalytics.js / blueprintRepository.js already
 * have from their callers, and makes the state machine trivial to test
 * without a database.
 *
 * Scope for this PR (explicitly excluded, per the PR2 plan):
 *   - no analytics, no AI, no report generation
 *   - no bulk/paste entry (added in ADR-006 PR4 — see submitBulkReply()
 *     below), no correction/undo commands (deferred to PR5) — single
 *     learner, single question at a time only
 *   - nothing is written to learner_results during capture. Marks are
 *     held in the session state (SessionStore already autosaves state
 *     after every turn — see sessionStore.js) and only committed via
 *     processAssessmentData() once the LAST learner's LAST question is
 *     answered. A teacher who abandons a session mid-capture leaves the
 *     database exactly as it was before they started — no partial rows.
 *
 * Data model note: unlike the roster implied by the ADR-006 design doc
 * ("Learner 3/38: Sipho Dlamini"), classes in this schema only carry a
 * learner_count (see Migration 012) — there is no pre-existing named
 * roster to walk through. `learners` identity rows (ADR-003) are only
 * created lazily, by name, when results are first stored. So capture
 * asks for each learner's name as it goes (matching how
 * storeLearnerResults()/resolveLearner() already key identity off a
 * free-text name), rather than assuming a roster that doesn't exist.
 *
 * @see docs/adr/ADR-006 (Blueprint Assessment Sessions)
 */

const { adaptParsedMarks } = require('./parsedMarksAdapter');

const CAPTURE_STEP = {
  NAME: 'name',
  MARKS: 'marks',
};

// ADR-006 PR5 Phase 1a — Undo/Back.
// History is a stack of pre-mutation snapshots of the mutable capture
// fields (learners/learnerIndex/questionIndex/captureStep/progress).
// Each successful submitReply() turn (name OR mark) pushes exactly one
// entry; each successful submitBulkReply() paste pushes exactly one entry
// for the WHOLE paste, so a single UNDO reverts the entire paste, not
// learner-by-learner. Capped at MAX_HISTORY so a very long session can't
// grow the persisted SessionStore row unboundedly.
const MAX_HISTORY = 20;

function snapshotOf(state) {
  return {
    learners: state.learners,
    learnerIndex: state.learnerIndex,
    questionIndex: state.questionIndex,
    captureStep: state.captureStep,
    progress: state.progress,
    editing: state.editing || null,
  };
}

function pushHistory(history, snapshot) {
  const next = (history || []).concat([snapshot]);
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
}

/**
 * Builds the initial ACTIVE-step capture state once a Blueprint and Class
 * have been chosen (called from the SELECT_CLASS -> ACTIVE transition).
 *
 * @param {Object} params
 * @param {Object} params.blueprint - result of blueprintRepository.getBlueprintById()
 *   (must include .questions: Array<{ questionNumber, topic, maxMarks }>)
 * @param {number} params.classId
 * @param {string} params.className
 * @param {number} params.learnerCount
 * @param {Array<{id:number,name:string}>} [params.roster] - ADR-006 PR2.5:
 *   a class's saved roster (learnerRosterService.getRoster()), oldest-added
 *   first. When present, capture is prefilled with these names in order —
 *   the NAME step is skipped entirely for however many learners the roster
 *   covers, and capture only falls back to asking for a name once it runs
 *   past the end of the roster (e.g. learnerCount was raised but the
 *   roster wasn't updated yet). Omit or pass [] to get PR2's original
 *   ask-every-name behaviour unchanged.
 * @returns {Object} ACTIVE-step state, ready to hand to submitReply()
 */
function initCapture({ blueprint, classId, className, learnerCount, roster = [] }) {
  if (!blueprint || !Array.isArray(blueprint.questions) || blueprint.questions.length === 0) {
    throw new Error('initCapture: blueprint must include a non-empty questions array');
  }
  if (!learnerCount || learnerCount < 1) {
    throw new Error('initCapture: learnerCount must be at least 1');
  }

  // Questions are captured in blueprint order (already sorted ASC by
  // question_number, per blueprintRepository.getBlueprintById()).
  const questions = blueprint.questions.map((q) => ({
    questionNumber: q.questionNumber,
    topic: q.topic,
    maxMarks: q.maxMarks,
  }));

  // ADR-006 PR2.5: prefill from the class roster, if one exists. Only the
  // name is taken from each roster entry — marks always start empty.
  const learners = roster.slice(0, learnerCount).map((entry) => ({ name: entry.name, marks: {} }));
  const firstLearnerHasName = learners.length > 0;

  return {
    step: 'active',
    blueprintId: blueprint.id,
    blueprintTitle: blueprint.title,
    blueprintTotalMarks: blueprint.totalMarks,
    blueprintVersion: blueprint.version,
    grade: blueprint.grade,
    subject: blueprint.subject,
    term: blueprint.term,
    classId,
    className,
    learnerCount,
    questions,
    learnerIndex: 0,
    questionIndex: 0,
    captureStep: firstLearnerHasName ? CAPTURE_STEP.MARKS : CAPTURE_STEP.NAME,
    learners,
    progress: {
      learnersCompleted: 0,
      questionsAnswered: 0,
      totalQuestions: learnerCount * questions.length,
    },
    history: [],
    editing: null,
    lastActivity: Date.now(),
  };
}

/**
 * True once every learner has answered every question.
 * @param {Object} state
 * @returns {boolean}
 */
function isComplete(state) {
  return state.learnerIndex >= state.learnerCount;
}

/**
 * @param {Object} state
 * @returns {Object|null} the question currently being asked, or null if
 *   we're between learners (i.e. currently prompting for a name) or the
 *   capture is already complete.
 */
function currentQuestion(state) {
  if (isComplete(state)) return null;
  return state.questions[state.questionIndex] || null;
}

// Rejects "two", "3/5", "4 marks", "-1", decimals, and anything with
// leading/trailing junk — bare integers only. Matches the strictness
// assessmentSessionFlow.js's parseListSelection() already applies to
// blueprint/class selection: silently accepting a fuzzy match here would
// mis-record a mark, which is worse than mis-selecting a blueprint.
function parseWholeNumber(text) {
  const trimmed = String(text).trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return parseInt(trimmed, 10);
}

function validateName(text) {
  const trimmed = String(text).trim();
  if (trimmed.length < 2) {
    return { valid: false, error: "Please enter the learner's name (at least 2 characters), or *CANCEL* to stop." };
  }
  if (trimmed.toUpperCase() === 'CANCEL' || trimmed.toUpperCase() === 'STATUS' || trimmed.toUpperCase() === 'RESUME') {
    // These are handled upstream in assessmentSessionFlow.js before
    // submitReply() is ever called; this guard only fires if a caller
    // forgets that ordering, so fail loud rather than record "CANCEL" as
    // a learner's name.
    return { valid: false, error: 'That looks like a command, not a name. Please enter the learner\'s name.' };
  }
  return { valid: true, name: trimmed };
}

function validateMark(text, maxMarks) {
  const n = parseWholeNumber(text);
  if (n === null) {
    return {
      valid: false,
      error: `Please reply with a whole number between 0 and ${maxMarks}.`,
    };
  }
  if (n < 0 || n > maxMarks) {
    return {
      valid: false,
      error: `That question has a maximum of ${maxMarks} marks.\nPlease enter a value between 0 and ${maxMarks}.`,
    };
  }
  return { valid: true, marks: n };
}

/**
 * Advances the state machine by one reply. Never mutates the input state;
 * always returns a fresh object (or the same reference on failure, so
 * callers can persist unconditionally without an extra branch).
 *
 * @param {Object} state - current ACTIVE-step state
 * @param {string} rawText - the teacher's raw WhatsApp reply
 * @returns {{ ok: boolean, state: Object, error?: string }}
 */
function submitReply(state, rawText) {
  if (isComplete(state)) {
    return { ok: false, state, error: 'This assessment session is already complete.' };
  }

  if (state.captureStep === CAPTURE_STEP.NAME) {
    const result = validateName(rawText);
    if (!result.valid) {
      return { ok: false, state, error: result.error };
    }

    const snapshot = snapshotOf(state);
    const learners = state.learners.slice();
    learners[state.learnerIndex] = { name: result.name, marks: {} };

    return {
      ok: true,
      state: {
        ...state,
        learners,
        captureStep: CAPTURE_STEP.MARKS,
        questionIndex: 0,
        history: pushHistory(state.history, snapshot),
        lastActivity: Date.now(),
      },
    };
  }

  // captureStep === MARKS
  const question = currentQuestion(state);
  if (!question) {
    // Defensive — should be unreachable given isComplete() is checked above.
    return { ok: false, state, error: 'No question is currently active.' };
  }

  const result = validateMark(rawText, question.maxMarks);
  if (!result.valid) {
    return { ok: false, state, error: result.error };
  }

  const snapshot = snapshotOf(state);
  const learners = state.learners.slice();
  const currentLearner = learners[state.learnerIndex];
  learners[state.learnerIndex] = {
    ...currentLearner,
    marks: { ...currentLearner.marks, [question.questionNumber]: result.marks },
  };

  let learnerIndex = state.learnerIndex;
  let questionIndex = state.questionIndex + 1;
  let captureStep = CAPTURE_STEP.MARKS;
  let learnersCompleted = state.progress.learnersCompleted;
  let editing = state.editing;

  // ADR-006 PR5 Phase 1b — EDIT. If this reply is completing a re-answer
  // of a learner that EDIT jumped us to (state.editing.learnerIndex ===
  // the learner we're currently on), re-marking already-counted
  // questions must NOT bump progress a second time — only fresh,
  // never-before-answered questions do that.
  const isEditingThisLearner = !!(state.editing && state.editing.learnerIndex === state.learnerIndex);
  const questionsAnswered = state.progress.questionsAnswered + (isEditingThisLearner ? 0 : 1);

  if (questionIndex >= state.questions.length) {
    questionIndex = 0;

    if (isEditingThisLearner) {
      // Finished re-answering the edited learner — jump back to exactly
      // where the teacher was before EDIT was sent, rather than
      // advancing forward past learners not yet reached.
      learnerIndex = state.editing.returnLearnerIndex;
      questionIndex = state.editing.returnQuestionIndex;
      captureStep = state.editing.returnCaptureStep;
      editing = null;
    } else {
      // Finished this learner's questions — advance to the next learner.
      learnerIndex += 1;
      learnersCompleted += 1;
      // ADR-006 PR2.5: if the next learner was already prefilled from the
      // roster (initCapture's `roster` param), skip straight to MARKS
      // instead of asking for a name we already have.
      captureStep = learners[learnerIndex] && learners[learnerIndex].name
        ? CAPTURE_STEP.MARKS
        : CAPTURE_STEP.NAME;
    }
  }

  return {
    ok: true,
    state: {
      ...state,
      learners,
      learnerIndex,
      questionIndex,
      captureStep,
      editing,
      progress: {
        learnersCompleted,
        questionsAnswered,
        totalQuestions: state.progress.totalQuestions,
      },
      history: pushHistory(state.history, snapshot),
      lastActivity: Date.now(),
    },
  };
}

/**
 * Advances the state machine by applying a *pasted block* of marks in one
 * go (ADR-006 PR4 — Bulk Capture), instead of one name/mark reply at a
 * time via submitReply().
 *
 * Per ADR-006 §3.3, bulk paste is an *alternate input mechanism*, not an
 * alternate persistence mechanism: this function normalizes the pasted
 * text into the exact same `{ name, marks }` learner shape submitReply()
 * already produces (via utils/marksParser.js + services/parsedMarksAdapter.js),
 * fills as many of the *remaining* learner slots as the paste covers, and
 * leaves the state machine in a shape indistinguishable from having
 * reached the same point one submitReply() turn at a time. Every
 * downstream consumer (formatCapturePrompt, formatStatus, isComplete,
 * toLearnerResults, processAssessmentData) stays untouched.
 *
 * Slot-filling rule: pasted learners are applied in order to
 * state.learnerIndex, state.learnerIndex + 1, ... — never to slots
 * already completed. If the paste contains more valid learners than
 * there are remaining slots, the extras are reported back as skipped
 * rather than silently dropped or allowed to overflow learnerCount. If
 * it contains fewer, the remaining slots are left exactly as
 * submitReply()'s NAME/MARKS flow would leave them, so capture can
 * continue turn-by-turn (or via another bulk paste) from there.
 *
 * Never throws: parser failures, per-learner validation failures, and
 * slot-overflow are all returned as structured data in `result` for the
 * caller (assessmentSessionFlow.js, once wired) to render — never as a
 * flattened string.
 *
 * @param {Object} state - current ACTIVE-step state
 * @param {string} rawText - the teacher's raw pasted block of marks
 * @param {Object} [deps]
 * @param {Function} [deps.parseMarks] - injected for testing; defaults to
 *   utils/marksParser.js's parseMarks(). Required signature:
 *   (text: string, format: 'text') => marksParser's parseMarks() return shape.
 * @returns {{
 *   ok: boolean,
 *   state: Object,
 *   result: { accepted: Array, skipped: Array, warnings: string[], errors: string[], appliedCount?: number }|null,
 *   error?: string,
 * }}
 */
function submitBulkReply(state, rawText, deps = {}) {
  if (isComplete(state)) {
    return { ok: false, state, result: null, error: 'This assessment session is already complete.' };
  }

  const parseMarksImpl = deps.parseMarks || require('../utils/marksParser').parseMarks;
  const parsed = parseMarksImpl(rawText, 'text');
  const { accepted, skipped, warnings, errors } = adaptParsedMarks(parsed, state.questions);

  if (errors.length > 0) {
    // Parser-level fatal error (e.g. no learner data found at all) —
    // nothing to apply, state is untouched.
    return { ok: false, state, result: { accepted: [], skipped, warnings, errors }, error: errors[0] };
  }

  if (accepted.length === 0) {
    return {
      ok: false,
      state,
      result: { accepted: [], skipped, warnings, errors },
      error: 'No learners could be captured from that paste. Please check the format and try again.',
    };
  }

  const remainingSlots = state.learnerCount - state.learnerIndex;
  const toApply = accepted.slice(0, remainingSlots);
  const overflow = accepted.slice(remainingSlots);

  // One history entry for the WHOLE paste — a single UNDO reverts every
  // learner this paste applied, not one learner at a time.
  const snapshot = snapshotOf(state);
  const learners = state.learners.slice();
  for (let i = 0; i < toApply.length; i += 1) {
    learners[state.learnerIndex + i] = toApply[i];
  }

  const learnerIndex = state.learnerIndex + toApply.length;
  const learnersCompleted = state.progress.learnersCompleted + toApply.length;
  const questionsAnswered = state.progress.questionsAnswered + toApply.length * state.questions.length;

  const nextLearnerHasName = learnerIndex < state.learnerCount && learners[learnerIndex] && learners[learnerIndex].name;
  const captureStep = nextLearnerHasName ? CAPTURE_STEP.MARKS : CAPTURE_STEP.NAME;

  const overflowSkipped = overflow.map((learner) => ({
    learnerName: learner.name,
    reason: `Skipped "${learner.name}" — this class only has ${state.learnerCount} learner(s) and ${Math.max(remainingSlots, 0)} slot(s) remained.`,
  }));

  return {
    ok: true,
    state: {
      ...state,
      learners,
      learnerIndex,
      questionIndex: 0,
      captureStep,
      progress: {
        learnersCompleted,
        questionsAnswered,
        totalQuestions: state.progress.totalQuestions,
      },
      history: pushHistory(state.history, snapshot),
      lastActivity: Date.now(),
    },
    result: {
      accepted: toApply,
      skipped: skipped.concat(overflowSkipped),
      warnings,
      errors,
      appliedCount: toApply.length,
    },
  };
}

/**
 * Jumps the capture cursor to an already-captured learner so the teacher
 * can re-enter their marks from question 1 (ADR-006 PR5 Phase 1b — EDIT).
 *
 * Unlike UNDO (which unwinds the most recent turn), EDIT is a *forward*
 * operation: the teacher keeps going as normal afterwards, and once the
 * re-answered learner's last question is submitted, capture returns to
 * exactly the learner/question/step it was at before EDIT was sent — it
 * never rewinds progress or re-asks for learners that come after the
 * edited one. Only one learner can be edited at a time; a second EDIT
 * sent mid-edit is rejected rather than nesting jumps.
 *
 * The jump itself is pushed as a single history entry (via snapshotOf,
 * which now also captures `editing`), so a single UNDO sent immediately
 * after EDIT cancels the jump and returns the teacher to where they were,
 * without needing any special-casing in submitUndo().
 *
 * @param {Object} state - current ACTIVE-step state
 * @param {string} query - free-text name (or partial name) to match
 *   against already-captured learners
 * @returns {{ ok: boolean, state: Object, error?: string }}
 */
function submitEdit(state, query) {
  if (isComplete(state)) {
    return { ok: false, state, error: 'This assessment session is already complete.' };
  }

  if (state.editing) {
    return {
      ok: false,
      state,
      error: `You're already editing ${state.learners[state.learnerIndex].name}'s marks. Finish entering them before starting another edit.`,
    };
  }

  const trimmedQuery = String(query || '').trim();
  if (trimmedQuery.length === 0) {
    return { ok: false, state, error: 'Please specify which learner to edit, e.g. *EDIT Sipho*.' };
  }

  // Only learners who already have a name captured can be targeted:
  // everything up to (and including, if named) the current learner.
  const needle = trimmedQuery.toLowerCase();
  const candidates = [];
  for (let i = 0; i <= state.learnerIndex && i < state.learners.length; i += 1) {
    const learner = state.learners[i];
    if (learner && learner.name && learner.name.toLowerCase().includes(needle)) {
      candidates.push(i);
    }
  }

  if (candidates.length === 0) {
    return { ok: false, state, error: `No captured learner matches "${trimmedQuery}". Check the spelling and try again.` };
  }

  if (candidates.length > 1) {
    const names = candidates.map((i) => state.learners[i].name).join(', ');
    return {
      ok: false,
      state,
      error: `More than one learner matches "${trimmedQuery}": ${names}. Please be more specific.`,
    };
  }

  const targetIndex = candidates[0];
  const snapshot = snapshotOf(state);

  return {
    ok: true,
    state: {
      ...state,
      learnerIndex: targetIndex,
      questionIndex: 0,
      captureStep: CAPTURE_STEP.MARKS,
      editing: {
        learnerIndex: targetIndex,
        returnLearnerIndex: state.learnerIndex,
        returnQuestionIndex: state.questionIndex,
        returnCaptureStep: state.captureStep,
      },
      history: pushHistory(state.history, snapshot),
      lastActivity: Date.now(),
    },
  };
}

/**
 * Reverts the most recent submitReply()/submitBulkReply()/submitEdit()
 * turn (ADR-006
 * PR5 Phase 1a). A bulk paste was pushed as a single history entry, so
 * one UNDO reverts the whole paste, not learner-by-learner. Never
 * mutates the input state; returns the same reference on failure so
 * callers can persist unconditionally, matching submitReply()'s
 * no-op-on-failure convention.
 *
 * @param {Object} state - current ACTIVE-step state
 * @returns {{ ok: boolean, state: Object, error?: string }}
 */
function submitUndo(state) {
  if (isComplete(state)) {
    return { ok: false, state, error: 'This assessment session is already complete.' };
  }

  const history = state.history || [];
  if (history.length === 0) {
    return { ok: false, state, error: 'Nothing to undo.' };
  }

  const snapshot = history[history.length - 1];
  const newHistory = history.slice(0, -1);

  return {
    ok: true,
    state: {
      ...state,
      ...snapshot,
      history: newHistory,
      lastActivity: Date.now(),
    },
  };
}

/**
 * Formats the prompt for whatever the teacher needs to reply to next
 * (either "what's this learner's name" or "enter marks for question N").
 * Returns '' once capture is complete — callers check isComplete() first
 * and send the completion message instead.
 *
 * @param {Object} state
 * @returns {string}
 */
function formatCapturePrompt(state) {
  if (isComplete(state)) return '';

  const learnerNumber = state.learnerIndex + 1;

  if (state.captureStep === CAPTURE_STEP.NAME) {
    return `Learner ${learnerNumber}/${state.learnerCount}\n\nWhat is their name?`;
  }

  const question = currentQuestion(state);
  const learner = state.learners[state.learnerIndex];
  const isEditingThisLearner = !!(state.editing && state.editing.learnerIndex === state.learnerIndex);
  const editPrefix = isEditingThisLearner ? '✏️ Editing — ' : '';
  return (
    `${editPrefix}Learner ${learnerNumber}/${state.learnerCount}: ${learner.name}\n` +
    `Question ${question.questionNumber}/${state.questions.length} (Max: ${question.maxMarks})\n\n` +
    `Reply with marks.`
  );
}

/**
 * Formats a STATUS reply — progress summary without recalculating from
 * scratch (the PR2 plan's "one improvement" — persist progress rather
 * than derive it on every STATUS call).
 *
 * @param {Object} state
 * @returns {string}
 */
function formatStatus(state) {
  const { learnersCompleted, questionsAnswered, totalQuestions } = state.progress;
  const pct = totalQuestions > 0 ? ((questionsAnswered / totalQuestions) * 100).toFixed(1) : '0.0';

  if (isComplete(state)) {
    return `Assessment Progress\n• Complete — ${learnersCompleted}/${state.learnerCount} learners captured.`;
  }

  return (
    `Assessment Progress\n` +
    `• Learner ${state.learnerIndex + 1} of ${state.learnerCount}\n` +
    `• Question ${state.questionIndex + 1} of ${state.questions.length}\n` +
    `• ${questionsAnswered} of ${totalQuestions} marks entered (${pct}%)`
  );
}

/**
 * Converts captured session state into the learnerResults shape
 * processAssessmentData() / storeLearnerResults() already expect
 * (see diagnosticWorkflowService.js and blueprintMarksImport.js):
 * an array of { learnerName, questionData }, where questionData is
 * question_number -> marks awarded. mark/totalMarks are deliberately
 * NOT set here — validateLearnerResultsAgainstBlueprint() derives them
 * from the blueprint (ADR-005), same as the paste-a-blueprint-CSV path.
 *
 * @param {Object} state - a state for which isComplete(state) is true
 * @returns {Array<{ learnerName: string, questionData: Object }>}
 */
function toLearnerResults(state) {
  return state.learners.map((learner) => ({
    learnerName: learner.name,
    questionData: learner.marks,
  }));
}

module.exports = {
  CAPTURE_STEP,
  initCapture,
  isComplete,
  currentQuestion,
  submitReply,
  submitBulkReply,
  submitEdit,
  submitUndo,
  formatCapturePrompt,
  formatStatus,
  toLearnerResults,
};
