// prompts/mentalMaths.js
//
// Mental Maths (V1) is deliberately NOT an "AI writes the questions and
// answers" prompt like every other type in prompts/. The questions and
// their canonicalAnswer are computed by services/mentalMathsService.js
// with plain arithmetic, before this prompt is ever built. This prompt's
// only job is to ask the AI to wrap that already-correct content in
// friendly, WhatsApp-ready wording — a numbered list, a short warm-up
// framing line, and an answer key at the end.
//
// By construction, the wording call NEVER receives canonicalAnswer as
// something it needs to compute — it is only ever asked to restate a
// value it is handed. This function takes the already-generated question
// set and returns a prompt whose only degrees of freedom are phrasing,
// never arithmetic.

'use strict';

const { gradeLabel } = require('../utils/capsPhase');

/**
 * @param {Object} params
 * @param {number} params.grade
 * @param {Array<{strand:string, prompt:string, canonicalAnswer:*}>} params.questions
 * @param {string} [params.language]
 * @returns {string}
 */
function mentalMathsPrompt({ grade, questions, language }) {
  const gradeStr = gradeLabel(grade);

  const languageInstruction = language && language !== 'english'
    ? `\n\nGenerate this entire response in ${language.charAt(0).toUpperCase() + language.slice(1)}. Use natural, teacher-appropriate ${language} for South African school documents.`
    : '';

  const numberedQuestions = questions
    .map((q, i) => `${i + 1}. ${q.prompt}`)
    .join('\n');

  const numberedAnswers = questions
    .map((q, i) => `${i + 1}. ${q.canonicalAnswer}`)
    .join('\n');

  return `You are a qualified South African teacher presenting a Mental Maths warm-up session to a class.

TASK: Format the following ALREADY-CORRECT mental maths questions and answers into a clean, WhatsApp-ready Mental Maths session. Do NOT recalculate, alter, simplify, re-order, or "correct" any question or answer — every value below is final and has already been verified. Your only job is wording and layout.

MENTAL MATHS DETAILS:
- Grade: ${gradeStr}
- Number of questions: ${questions.length}

QUESTIONS (use exactly as given, do not change the numbers or operators):
${numberedQuestions}

ANSWERS (use exactly as given, do not recompute):
${numberedAnswers}

OUTPUT — use this EXACT format for WhatsApp:

*Mental Maths — ${gradeStr}*
_A quick fluency warm-up. Read each question aloud, learners answer in their books or out loud._

${numberedQuestions}

---
*Answers*

${numberedAnswers}

Add a short one-line encouraging intro sentence before the question list (e.g. reminding learners this is quick mental practice, no written working needed) and nothing else — do not add extra questions, do not add explanations to the answers, do not change any number.${languageInstruction}`;
}

module.exports = mentalMathsPrompt;
