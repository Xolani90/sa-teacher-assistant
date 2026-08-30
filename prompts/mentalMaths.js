// prompts/mentalMaths.js
//
// Mental Maths is deliberately NOT an "AI writes the questions and
// answers" prompt like every other type in prompts/. The questions and
// their canonicalAnswer are computed by the grade's own deterministic
// generator (services/mentalMathsGrade5Service.js for Grade 5,
// services/mentalMathsService.js for the Senior Phase authorized
// families), orchestrated by services/mentalMathsSessionService.js,
// before this prompt is ever built. This prompt's only job is to ask the
// AI to wrap that already-correct content in friendly, WhatsApp-ready
// wording.
//
// The AI is NOT asked to reproduce the answer key. The answer key is
// built in code from canonicalAnswer and appended after this call
// (mentalMathsSessionService.finaliseSessionContent), and the AI's output
// is verified question-by-question against the generated set before being
// used at all. So the AI is never in a position to compute, restate,
// alter or drop a mathematical value — if it does, its output is
// discarded in favour of the deterministic rendering.
//
// This function takes the already-generated question set and returns a
// prompt whose only degrees of freedom are phrasing, never arithmetic.

'use strict';

const { gradeLabel } = require('../utils/capsPhase');
const {
  DELIVERY_MODES,
  deliveryInstruction,
  formatQuestions,
} = require('../services/mentalMathsSessionService');

/**
 * @param {Object} params
 * @param {number} params.grade
 * @param {Array<{strand:string, prompt:string, canonicalAnswer:*}>} params.questions
 * @param {string} [params.mentalMathsMode] - 'oral' | 'written'
 * @param {string} [params.mentalMathsTopicLabel]
 * @param {string} [params.language]
 * @returns {string}
 */
function mentalMathsPrompt({ grade, questions, mentalMathsMode, mentalMathsTopicLabel, language }) {
  const gradeStr = gradeLabel(grade);
  const mode = mentalMathsMode === DELIVERY_MODES.WRITTEN ? DELIVERY_MODES.WRITTEN : DELIVERY_MODES.ORAL;
  const isWritten = mode === DELIVERY_MODES.WRITTEN;
  const topicLine = mentalMathsTopicLabel ? `\n- Focus: ${mentalMathsTopicLabel}` : '';

  const languageInstruction = language && language !== 'english'
    ? `\n\nGenerate this entire response in ${language.charAt(0).toUpperCase() + language.slice(1)}. Use natural, teacher-appropriate ${language} for South African school documents.`
    : '';

  const numberedQuestions = formatQuestions(questions);

  const modeFraming = isWritten
    ? `This is a WRITTEN session: the teacher will put these on the board or read them out once, and learners write only their answers, numbered 1 to ${questions.length}.`
    : `This is an ORAL session: the teacher reads each question aloud and learners answer out loud — nothing is written down.`;

  return `You are a qualified South African teacher presenting a Mental Maths warm-up session to a class.

TASK: Format the following ALREADY-CORRECT mental maths questions into a clean, WhatsApp-ready Mental Maths session. Do NOT recalculate, alter, simplify, re-order, renumber or "correct" any question — every value below is final and has already been verified. Your only job is wording and layout.

MENTAL MATHS DETAILS:
- Grade: ${gradeStr}${topicLine}
- Delivery: ${isWritten ? 'Written' : 'Oral'}
- Number of questions: ${questions.length}

${modeFraming}

QUESTIONS (use exactly as given, character for character — do not change the numbers, operators or symbols):
${numberedQuestions}

OUTPUT — use this EXACT format for WhatsApp:

*Mental Maths — ${gradeStr}*
_${deliveryInstruction(mode, questions.length)}_

${numberedQuestions}

CRITICAL RULES:
- Do NOT include the answers, an answer key, a memo, or any section headed "Answers". The answer key is added separately and automatically after your response. If you add one, your entire response is discarded.
- Do NOT add, remove or reword any question.
- Add one short, encouraging one-line intro sentence before the question list${isWritten ? ' (reminding learners to number their answers 1 to ' + questions.length + ')' : ' (reminding learners this is quick mental practice, no written working needed)'} — and nothing else.
- Do not add explanations, worked examples, extra questions, or a closing summary.${languageInstruction}`;
}

module.exports = mentalMathsPrompt;
