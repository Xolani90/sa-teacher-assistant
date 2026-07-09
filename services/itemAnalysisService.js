'use strict';

/**
 * Item Analysis Engine
 * Analyzes assessment data at the question level to identify:
 * - Question difficulty (facility value)
 * - Success rate per question
 * - Cognitive level classification
 * - Discrimination index
 * - Item quality indicators
 */

const { getDb } = require('../utils/database');

/**
 * Calculates the facility value (difficulty) of a question.
 * Facility value = average mark obtained by all learners / maximum mark for the question
 * Lower values = harder questions
 *
 * @param {number} totalMarksObtained - Sum of all learner marks for this question
 * @param {number} learnerCount - Number of learners who attempted the question
 * @param {number} maxMark - Maximum possible mark for this question
 * @returns {number} Facility value between 0 and 1
 */
function calculateFacilityValue(totalMarksObtained, learnerCount, maxMark) {
  if (learnerCount === 0 || maxMark === 0) return 0.5; // Default to medium difficulty
  const averageMark = totalMarksObtained / learnerCount;
  return averageMark / maxMark;
}

/**
 * Calculates the discrimination index for a question.
 * Discrimination = (top 27% average - bottom 27% average) / max mark
 * Higher values = better discrimination between high and low performers
 *
 * @param {Array} learnerResults - Array of learner results with marks
 * @param {number} maxMark - Maximum possible mark for this question
 * @returns {number} Discrimination index between -1 and 1
 */
function calculateDiscriminationIndex(learnerResults, maxMark) {
  if (learnerResults.length < 10) return 0; // Need sufficient data

  const sorted = [...learnerResults].sort((a, b) => b.mark - a.mark);
  const n = sorted.length;
  const topGroupSize = Math.ceil(n * 0.27);
  const bottomGroupSize = Math.ceil(n * 0.27);

  const topGroup = sorted.slice(0, topGroupSize);
  const bottomGroup = sorted.slice(-bottomGroupSize);

  const topAverage = topGroup.reduce((sum, r) => sum + r.mark, 0) / topGroup.length;
  const bottomAverage = bottomGroup.reduce((sum, r) => sum + r.mark, 0) / bottomGroup.length;

  return (topAverage - bottomAverage) / maxMark;
}

/**
 * Classifies the cognitive level of a question based on topic and difficulty.
 * CAPS cognitive levels: Knowledge, Application, Analysis, Evaluation
 *
 * @param {string} topic - The topic of the question
 * @param {number} difficulty - Facility value (0-1)
 * @param {string} subject - Subject context
 * @returns {string} Cognitive level
 */
function classifyCognitiveLevel(topic, difficulty, subject = 'general') {
  // Higher cognitive levels tend to have lower facility values (harder questions)
  if (difficulty > 0.7) {
    return 'knowledge'; // Easy questions are typically recall/knowledge
  } else if (difficulty > 0.4) {
    return 'application'; // Medium difficulty often involves application
  } else if (difficulty > 0.2) {
    return 'analysis'; // Harder questions often require analysis
  } else {
    return 'evaluation'; // Very hard questions often involve evaluation/synthesis
  }
}

/**
 * Performs item analysis on an assessment.
 * Analyzes each question for difficulty, discrimination, and cognitive level.
 *
 * @param {number} assessmentId - The assessment ID
 * @returns {Object} Item analysis results
 */
function performItemAnalysis(assessmentId) {
  const db = getDb();

  // Get all learner results for this assessment
  const learnerResults = db.prepare(`
    SELECT * FROM learner_results WHERE assessment_id = ?
  `).all(assessmentId);

  if (learnerResults.length === 0) {
    return { error: 'No learner results found for this assessment' };
  }

  // Parse question data from each learner result
  const questionData = {};
  const maxMarks = {};
  const questionTopics = {}; // capture per-question CAPS topic if supplied

  for (const result of learnerResults) {
    if (result.question_data) {
      try {
        const questions = JSON.parse(result.question_data);
        for (const [qNum, qData] of Object.entries(questions)) {
          if (!questionData[qNum]) {
            questionData[qNum] = [];
            maxMarks[qNum] = qData.maxMark || 1;
          }
          // Capture topic from first learner record that provides one
          if (qData.topic && !questionTopics[qNum]) {
            questionTopics[qNum] = qData.topic;
          }
          questionData[qNum].push({
            learnerName: result.learner_name,
            mark: qData.mark || 0,
          });
        }
      } catch (e) {
        console.error('Failed to parse question data:', e.message);
      }
    }
  }

  // Analyze each question
  const analysisResults = [];
  for (const [qNum, marks] of Object.entries(questionData)) {
    const totalMarksObtained = marks.reduce((sum, m) => sum + m.mark, 0);
    const learnerCount = marks.length;
    const maxMark = maxMarks[qNum];

    const facilityValue = calculateFacilityValue(totalMarksObtained, learnerCount, maxMark);
    const discriminationIndex = calculateDiscriminationIndex(marks, maxMark);
    // successRate = fraction who achieved at least half marks on this question.
    // Using "> 0" (any nonzero score) would count a learner scoring 1/10 as "successful",
    // which means errorAnalysisService's "success_rate < 0.5" filter would never fire
    // even for severely difficult questions. Half-marks is the correct threshold.
    const successRate = marks.filter(m => m.mark >= maxMark * 0.5).length / learnerCount;

    // Determine difficulty category
    let difficultyCategory;
    if (facilityValue > 0.8) difficultyCategory = 'very_easy';
    else if (facilityValue > 0.6) difficultyCategory = 'easy';
    else if (facilityValue > 0.4) difficultyCategory = 'moderate';
    else if (facilityValue > 0.2) difficultyCategory = 'difficult';
    else difficultyCategory = 'very_difficult';

    // Determine item quality
    let itemQuality;
    if (discriminationIndex > 0.3) itemQuality = 'excellent';
    else if (discriminationIndex > 0.2) itemQuality = 'good';
    else if (discriminationIndex > 0.1) itemQuality = 'acceptable';
    else if (discriminationIndex > 0) itemQuality = 'poor';
    else itemQuality = 'needs_revision';

    analysisResults.push({
      questionNumber: parseInt(qNum),
      topic: questionTopics[qNum] || null, // real CAPS topic if supplied, else null
      facilityValue,
      difficultyCategory,
      discriminationIndex,
      itemQuality,
      successRate,
      learnerCount,
      maxMark,
    });
  }

  // Sort by question number
  analysisResults.sort((a, b) => a.questionNumber - b.questionNumber);

  // Calculate class-level statistics
  const averageFacilityValue = analysisResults.reduce((sum, q) => sum + q.facilityValue, 0) / analysisResults.length;
  const averageDiscrimination = analysisResults.reduce((sum, q) => sum + q.discriminationIndex, 0) / analysisResults.length;

  return {
    assessmentId,
    totalQuestions: analysisResults.length,
    averageFacilityValue,
    averageDiscrimination,
    questions: analysisResults,
    summary: generateItemAnalysisSummary(analysisResults),
  };
}

/**
 * Generates a human-readable summary of the item analysis.
 *
 * @param {Array} questions - Array of question analysis results
 * @returns {string} Summary text
 */
function generateItemAnalysisSummary(questions) {
  const easyQuestions = questions.filter(q => q.difficultyCategory === 'very_easy' || q.difficultyCategory === 'easy').length;
  const moderateQuestions = questions.filter(q => q.difficultyCategory === 'moderate').length;
  const difficultQuestions = questions.filter(q => q.difficultyCategory === 'difficult' || q.difficultyCategory === 'very_difficult').length;
  const excellentItems = questions.filter(q => q.itemQuality === 'excellent' || q.itemQuality === 'good').length;
  const poorItems = questions.filter(q => q.itemQuality === 'poor' || q.itemQuality === 'needs_revision').length;

  let summary = `*Item Analysis Summary*\n\n`;
  summary += `Total Questions: ${questions.length}\n\n`;
  summary += `*Difficulty Distribution:*\n`;
  summary += `• Easy: ${easyQuestions} (${Math.round(easyQuestions / questions.length * 100)}%)\n`;
  summary += `• Moderate: ${moderateQuestions} (${Math.round(moderateQuestions / questions.length * 100)}%)\n`;
  summary += `• Difficult: ${difficultQuestions} (${Math.round(difficultQuestions / questions.length * 100)}%)\n\n`;
  summary += `*Item Quality:*\n`;
  summary += `• Good/Excellent: ${excellentItems} (${Math.round(excellentItems / questions.length * 100)}%)\n`;
  summary += `• Poor/Needs Revision: ${poorItems} (${Math.round(poorItems / questions.length * 100)}%)\n\n`;

  if (poorItems > 0) {
    summary += `⚠️ *Note:* ${poorItems} question(s) may need revision due to poor discrimination.\n\n`;
  }

  summary += `*Recommendations:*\n`;
  if (easyQuestions > questions.length * 0.5) {
    summary += `• Consider adding more challenging questions to better differentiate learners.\n`;
  }
  if (difficultQuestions > questions.length * 0.5) {
    summary += `• Consider adding easier questions to build learner confidence.\n`;
  }
  if (poorItems > 0) {
    summary += `• Review questions with poor discrimination for clarity or alignment.\n`;
  }

  return summary;
}

/**
 * Saves item analysis results to the database.
 *
 * @param {number} assessmentId - Assessment ID
 * @param {Array} questions - Question analysis results
 * @param {string} subject - Subject for cognitive level classification
 */
function saveItemAnalysis(assessmentId, questions, subject = 'general') {
  const db = getDb();

  // Wrap DELETE + the INSERT loop in a single transaction so a throw partway
  // through (e.g. a bad question record) cannot leave a partial set of rows
  // committed against this assessmentId. Manual BEGIN/COMMIT/ROLLBACK
  // (matching the pattern in teacherWorkspaceService.saveResource) for
  // compatibility with both better-sqlite3 (production) and the node:sqlite
  // test shim used in some test files.
  try {
    db.prepare('BEGIN').run();

    // Clear existing item analysis for this assessment
    db.prepare(`DELETE FROM item_analysis WHERE assessment_id = ?`).run(assessmentId);

    // Insert new item analysis
    const insert = db.prepare(`
      INSERT INTO item_analysis (
        assessment_id, question_number, topic, difficulty, success_rate, cognitive_level
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const q of questions) {
      // Use the real CAPS topic name if available; fall back to a positional label only as last resort
      const topicLabel = q.topic || `question_${q.questionNumber}`;
      const cognitiveLevel = classifyCognitiveLevel(topicLabel, q.facilityValue, subject);
      insert.run(
        assessmentId,
        q.questionNumber,
        topicLabel,
        q.facilityValue,
        q.successRate,
        cognitiveLevel
      );
    }

    db.prepare('COMMIT').run();
  } catch (err) {
    try { db.prepare('ROLLBACK').run(); } catch (_) { /* best-effort */ }
    throw err;
  }
}

module.exports = {
  performItemAnalysis,
  saveItemAnalysis,
  calculateFacilityValue,
  calculateDiscriminationIndex,
  classifyCognitiveLevel,
  generateItemAnalysisSummary,
};
