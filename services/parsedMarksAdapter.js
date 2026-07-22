'use strict';

/**
 * services/parsedMarksAdapter.js
 *
 * ADR-006 PR4 (Bulk Capture) — Phase 1: pure shape adapter.
 *
 * Converts marksParser.js's parseMarks() output (mark/maxMark/topic per
 * question, keyed by whatever question numbers the pasted text contained)
 * into the exact shape services/assessmentCaptureService.js's session state
 * already uses:
 *
 *   state.learners[i]  = { name, marks: { [questionNumber]: mark } }
 *   state.questions[i] = { questionNumber, topic, maxMarks }   (from the blueprint)
 *
 * Per ADR-006 §3.3, this is the boundary that makes bulk paste an
 * *alternate input mechanism*, not an alternate persistence mechanism: its
 * only job is to produce the same shape PR2's per-turn submitReply() marks
 * already produce, validated against the SAME blueprint question list, so
 * every downstream consumer (submitBulkReply, completion, processAssessmentData)
 * stays untouched and unaware bulk paste exists.
 *
 * Deliberately has NO knowledge of WhatsApp, SessionStore, or the DB, and
 * does not call the parser itself — it is handed parseMarks()'s already-
 * computed output plus the blueprint's question list, and returns pure data.
 *
 * @see docs/adr/ADR-006-assessment-session-engine.md
 */

/**
 * @param {Array<{questionNumber:number, topic?:string, maxMarks:number}>} questions
 *   The blueprint's questions, in the exact shape assessmentCaptureService.js's
 *   initCapture() already produces (state.questions).
 * @returns {Map<string, {questionNumber:number, maxMarks:number}>} keyed by
 *   String(questionNumber) to match parseMarks()'s string-keyed questionData.
 */
function indexQuestionsByNumber(questions) {
  const byNumber = new Map();
  for (const q of questions) {
    byNumber.set(String(q.questionNumber), { questionNumber: q.questionNumber, maxMarks: q.maxMarks });
  }
  return byNumber;
}

/**
 * Converts one parsed learner record (marksParser.js's `learners[i]` shape)
 * into assessmentCaptureService.js's `{ name, marks }` shape, validated
 * against the blueprint's actual question list.
 *
 * A learner is only ever fully accepted or fully skipped — never partially
 * recorded — matching submitReply()'s own all-or-nothing validation per
 * question (a bad mark there is rejected outright, not silently clamped).
 *
 * @param {Object} parsedLearner - one entry of parseMarks().learners
 * @param {Map} questionsByNumber - from indexQuestionsByNumber()
 * @returns {{ ok: boolean, learner?: {name, marks}, error?: string }}
 */
function adaptLearner(parsedLearner, questionsByNumber) {
  const name = String(parsedLearner.learnerName || '').trim();
  if (name.length < 2) {
    return { ok: false, error: `Skipped a line — could not find a valid learner name near "${parsedLearner.learnerName || ''}".` };
  }

  const parsedQuestionData = parsedLearner.questionData || {};
  const marks = {};

  for (const [qNum, entry] of Object.entries(parsedQuestionData)) {
    const blueprintQuestion = questionsByNumber.get(String(qNum));
    if (!blueprintQuestion) {
      // A question number the pasted text has that this blueprint doesn't.
      // Fatal for this learner: silently dropping it would let a mark
      // vanish rather than surfacing the mismatch.
      return {
        ok: false,
        error: `Skipped "${name}" — Q${qNum} isn't part of this blueprint (${questionsByNumber.size} question(s) expected).`,
      };
    }

    const mark = entry.mark;
    if (typeof mark !== 'number' || Number.isNaN(mark) || !Number.isInteger(mark)) {
      return { ok: false, error: `Skipped "${name}" — Q${qNum}'s mark must be a whole number.` };
    }
    if (mark < 0 || mark > blueprintQuestion.maxMarks) {
      return {
        ok: false,
        error: `Skipped "${name}" — Q${qNum} must be between 0 and ${blueprintQuestion.maxMarks} (got ${mark}).`,
      };
    }

    marks[blueprintQuestion.questionNumber] = mark;
  }

  // A learner must have every blueprint question answered to be accepted —
  // matching submitReply()'s own requirement that a learner isn't "done"
  // until every question has a validated mark (assessmentCaptureService.js's
  // isComplete()/currentQuestion() never allow a partial learner through).
  const missing = [];
  for (const q of questionsByNumber.values()) {
    if (!(q.questionNumber in marks)) missing.push(q.questionNumber);
  }
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Skipped "${name}" — missing mark(s) for Q${missing.join(', Q')}.`,
    };
  }

  return { ok: true, learner: { name, marks } };
}

/**
 * Converts marksParser.js's full parseMarks() output into the array of
 * `{ name, marks }` learner records assessmentCaptureService.js's state
 * expects, plus structured metadata about anything skipped.
 *
 * This function never throws on bad input data — parser-level warnings/
 * errors and per-learner validation failures are all returned as
 * structured data for the caller (submitBulkReply) to surface to the
 * teacher, never as flattened strings and never as thrown exceptions.
 *
 * @param {Object} parsedMarks - marksParser.js's parseMarks() return value
 * @param {Array} questions - blueprint questions, state.questions shape
 * @returns {{
 *   accepted: Array<{name, marks}>,
 *   skipped: Array<{ learnerName: string, reason: string }>,
 *   warnings: string[],
 *   errors: string[],
 * }}
 */
function adaptParsedMarks(parsedMarks, questions) {
  const warnings = Array.isArray(parsedMarks.warnings) ? parsedMarks.warnings.slice() : [];
  const errors = Array.isArray(parsedMarks.errors) ? parsedMarks.errors.slice() : [];

  // Parser-level fatal errors (e.g. "no learner data found") mean there is
  // nothing to adapt — surface them as-is, adapt nothing.
  if (errors.length > 0) {
    return { accepted: [], skipped: [], warnings, errors };
  }

  const questionsByNumber = indexQuestionsByNumber(questions || []);
  const accepted = [];
  const skipped = [];

  for (const parsedLearner of parsedMarks.learners || []) {
    const result = adaptLearner(parsedLearner, questionsByNumber);
    if (result.ok) {
      accepted.push(result.learner);
    } else {
      skipped.push({ learnerName: parsedLearner.learnerName || '', reason: result.error });
    }
  }

  return { accepted, skipped, warnings, errors };
}

module.exports = {
  adaptParsedMarks,
  adaptLearner,
  indexQuestionsByNumber,
};
