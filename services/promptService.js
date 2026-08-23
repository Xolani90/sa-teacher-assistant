'use strict';

const { INTENT_TYPES } = require('../utils/intentParser');
const lessonPlanPrompt = require('../prompts/lessonPlan');
const worksheetPrompt  = require('../prompts/worksheet');
const testPrompt       = require('../prompts/test');
const examPaperPrompt  = require('../prompts/examPaper');
const rubricPrompt     = require('../prompts/rubric');
const sbaTaskPrompt    = require('../prompts/sbaTask');
const explanationPrompt = require('../prompts/explanation');
const reportCommentPrompt = require('../prompts/reportComment');
const parentMessagePrompt = require('../prompts/parentMessage');
const quickQuizPrompt = require('../prompts/quickQuiz');
const atpPrompt = require('../prompts/atp');
const assessmentAnalysisPrompt = require('../prompts/assessmentAnalysis');
const interventionPlanPrompt = require('../prompts/interventionPlan');
const moderationPackPrompt = require('../prompts/moderationPack');
const mentalMathsPrompt = require('../prompts/mentalMaths');

// curriculumQuery is handled entirely by curriculumIntelligenceService — no prompt file needed here

/**
 * Builds the correct CAPS-aligned prompt based on intent.
 *
 * If the teacher has a saved profile (grade/subject), we use those as defaults
 * when the message doesn't explicitly specify them.
 *
 * @param {Object} intent - Parsed intent from intentParser
 * @param {Object} [profile] - Teacher's saved profile { grade, subject, name, language }
 * @returns {string}
 */
function buildPrompt(intent, profile = {}) {
  // Merge profile defaults into intent if the intent didn't specify them
  // If both intent.grade and profile.grade are null, pass grade: null through
  const enriched = {
    ...intent,
    grade:   intent.grade != null ? intent.grade : parseGradeNumber(profile.grade),
    subject: intent.subject !== 'general' ? intent.subject : (profile.subject?.toLowerCase() || 'general'),
    language: intent.language || profile.language || 'english',
  };

  switch (enriched.type) {
    case INTENT_TYPES.LESSON_PLAN:
      return lessonPlanPrompt(enriched);
    case INTENT_TYPES.WORKSHEET:
      return worksheetPrompt(enriched);
    case INTENT_TYPES.TEST:
      return testPrompt(enriched);
    case INTENT_TYPES.EXAM_PAPER:
      return examPaperPrompt(enriched);
    case INTENT_TYPES.RUBRIC:
      return rubricPrompt(enriched);
    case INTENT_TYPES.SBA_TASK:
      return sbaTaskPrompt(enriched);
    case INTENT_TYPES.REPORT_COMMENT:
      return reportCommentPrompt(enriched);
    case INTENT_TYPES.PARENT_MESSAGE:
      return parentMessagePrompt(enriched);
    case INTENT_TYPES.QUICK_QUIZ:
      return quickQuizPrompt(enriched);
    case INTENT_TYPES.ATP:
      return atpPrompt(enriched);
    case INTENT_TYPES.ASSESSMENT_ANALYSIS:
      return assessmentAnalysisPrompt(enriched);
    case INTENT_TYPES.INTERVENTION_PLAN:
      return interventionPlanPrompt(enriched);
    case INTENT_TYPES.MODERATION_PACK:
      return moderationPackPrompt(enriched);
    case INTENT_TYPES.MENTAL_MATHS:
      // mentalMathsQuestions is attached by generationPipeline.js BEFORE
      // buildPrompt() is called — the deterministic question/answer set
      // must exist first, since this prompt only wraps it in wording and
      // never computes it. grade here is already resolved (generationPipeline
      // sets intent.grade to the effective grade before this call), so no
      // profile fallback is needed for grade specifically.
      return mentalMathsPrompt({
        grade: enriched.grade,
        questions: enriched.mentalMathsQuestions || [],
        language: enriched.language,
      });
    case INTENT_TYPES.EXPLANATION:
    default:
      return explanationPrompt(enriched);
  }
}

/**
 * Parses "Grade 7" → 7, null if unrecognised.
 * @param {string|null} gradeStr
 * @returns {number|null}
 */
function parseGradeNumber(gradeStr) {
  if (!gradeStr) return null;
  const match = gradeStr.match(/(\d{1,2})/);
  return match ? parseInt(match[1], 10) : null;
}

module.exports = { buildPrompt };