'use strict';

/**
 * Error Analysis Engine
 * Identifies and categorizes learner errors to inform reteaching strategies.
 * Error types: conceptual, procedural, misconceptions, language barriers, knowledge gaps.
 */

const { getDb } = require('../utils/database');

/**
 * Error type definitions and patterns
 */
const ERROR_TYPES = {
  CONCEPTUAL: 'conceptual',
  PROCEDURAL: 'procedural',
  MISCONCEPTION: 'misconception',
  LANGUAGE: 'language',
  KNOWLEDGE_GAP: 'knowledge_gap',
};

/**
 * Common error patterns by subject
 */
const ERROR_PATTERNS = {
  mathematics: {
    conceptual: [
      'confusing operations',
      'misunderstanding place value',
      'incorrect formula application',
      'misinterpreting word problems',
    ],
    procedural: [
      'calculation errors',
      'incorrect steps',
      'skipping steps',
      'order of operations mistakes',
    ],
    misconception: [
      'thinking larger denominator means larger fraction',
      'confusing perimeter and area',
      'negative number misconceptions',
      'zero misconceptions',
    ],
  },
  physical_sciences: {
    conceptual: [
      'misunderstanding forces',
      'confusing energy types',
      'misunderstanding chemical reactions',
      'incorrect circuit understanding',
    ],
    procedural: [
      'incorrect formula substitution',
      'unit conversion errors',
      'graph plotting errors',
      'measurement errors',
    ],
    misconception: [
      'heavier objects fall faster',
      'current flows from negative to positive',
      'mass changes during chemical reactions',
    ],
  },
  life_sciences: {
    conceptual: [
      'misunderstanding cell processes',
      'confusing photosynthesis and respiration',
      'misunderstanding genetics',
      'incorrect ecosystem understanding',
    ],
    procedural: [
      'microscope handling errors',
      'incorrect diagram labeling',
      'experimental procedure errors',
    ],
    misconception: [
      'plants get food from soil',
      'evolution is just a theory',
      'humans evolved from monkeys',
    ],
  },
  english: {
    conceptual: [
      'misunderstanding themes',
      'confusing literary devices',
      'incorrect text interpretation',
    ],
    procedural: [
      'grammar errors',
      'spelling errors',
      'sentence structure errors',
      'punctuation errors',
    ],
    language: [
      'vocabulary gaps',
      'idiom misunderstandings',
      'context confusion',
    ],
  },
};

/**
 * Analyzes learner results to identify error patterns.
 *
 * @param {number} assessmentId - Assessment ID
 * @param {string} subject - Subject of the assessment
 * @returns {Object} Error analysis results
 */
function performErrorAnalysis(assessmentId, subject = 'general') {
  const db = getDb();

  // Get all learner results for this assessment
  const learnerResults = db.prepare(`
    SELECT * FROM learner_results WHERE assessment_id = ?
  `).all(assessmentId);

  if (learnerResults.length === 0) {
    return { error: 'No learner results found for this assessment' };
  }

  // Get item analysis for this assessment
  const itemAnalysis = db.prepare(`
    SELECT * FROM item_analysis WHERE assessment_id = ?
  `).all(assessmentId);

  // Identify error patterns
  const errorPatterns = [];
  const topicErrors = {};

  // Analyze low-performing questions
  const difficultQuestions = itemAnalysis.filter(q => q.success_rate < 0.5);
  
  for (const question of difficultQuestions) {
    const topic = question.topic;
    if (!topicErrors[topic]) {
      topicErrors[topic] = {
        topic,
        frequency: 0,
        errorType: classifyErrorType(topic, subject, question.success_rate),
        description: generateErrorDescription(topic, subject, question.success_rate),
      };
    }
    topicErrors[topic].frequency += learnerResults.length - Math.round(question.success_rate * learnerResults.length);
  }

  // Convert to array and sort by frequency
  const sortedErrors = Object.values(topicErrors).sort((a, b) => b.frequency - a.frequency);

  return {
    assessmentId,
    subject,
    totalLearners: learnerResults.length,
    difficultQuestions: difficultQuestions.length,
    errorPatterns: sortedErrors,
    summary: generateErrorAnalysisSummary(sortedErrors, learnerResults.length),
  };
}

/**
 * Classifies the type of error based on topic and performance.
 *
 * @param {string} topic - Question topic
 * @param {string} subject - Subject context
 * @param {number} successRate - Success rate of the question
 * @returns {string} Error type
 */
function classifyErrorType(topic, subject, successRate) {
  const patterns = ERROR_PATTERNS[subject.toLowerCase().replace(' ', '_')] || ERROR_PATTERNS.general;
  
  // Very low success rates often indicate conceptual issues
  if (successRate < 0.3) {
    return ERROR_TYPES.CONCEPTUAL;
  }
  // Moderate success rates often indicate procedural issues
  if (successRate < 0.5) {
    return ERROR_TYPES.PROCEDURAL;
  }
  
  return ERROR_TYPES.KNOWLEDGE_GAP;
}

/**
 * Generates a description of the error.
 *
 * @param {string} topic - Question topic
 * @param {string} subject - Subject context
 * @param {number} successRate - Success rate
 * @returns {string} Error description
 */
function generateErrorDescription(topic, subject, successRate) {
  const subjectPatterns = ERROR_PATTERNS[subject.toLowerCase().replace(' ', '_')];
  
  if (subjectPatterns) {
    const allPatterns = [
      ...subjectPatterns.conceptual || [],
      ...subjectPatterns.procedural || [],
      ...subjectPatterns.misconception || [],
    ];
    if (allPatterns.length > 0) {
      return `Learners struggled with ${topic}. Common issues include: ${allPatterns.slice(0, 3).join(', ')}.`;
    }
  }
  
  return `Learners demonstrated difficulty with ${topic}. Success rate was ${Math.round(successRate * 100)}%.`;
}

/**
 * Generates reteaching recommendations based on error analysis.
 *
 * @param {Array} errorPatterns - Array of error patterns
 * @returns {string} Reteaching recommendations
 */
function generateReteachingRecommendations(errorPatterns) {
  if (errorPatterns.length === 0) {
    return 'No significant error patterns detected. Continue with current teaching approach.';
  }

  let recommendations = '*Reteaching Recommendations*\n\n';

  for (const error of errorPatterns.slice(0, 5)) { // Top 5 errors
    recommendations += `**${error.topic}**\n`;
    recommendations += `• Error Type: ${error.errorType}\n`;
    recommendations += `• Affected Learners: ${error.frequency}\n`;
    recommendations += `• ${error.description}\n`;
    
    // Add specific reteaching strategies based on error type
    recommendations += `• Reteaching Strategy: ${getReteachingStrategy(error.errorType)}\n\n`;
  }

  return recommendations;
}

/**
 * Returns a reteaching strategy based on error type.
 *
 * @param {string} errorType - Type of error
 * @returns {string} Reteaching strategy
 */
function getReteachingStrategy(errorType) {
  const strategies = {
    [ERROR_TYPES.CONCEPTUAL]: 'Use concrete examples, visual aids, and real-world connections. Rebuild understanding from basic concepts.',
    [ERROR_TYPES.PROCEDURAL]: 'Provide step-by-step worked examples. Practice with guided support before independent work.',
    [ERROR_TYPES.MISCONCEPTION]: 'Directly address the misconception. Show why it is incorrect and build the correct understanding.',
    [ERROR_TYPES.LANGUAGE]: 'Simplify language, use visual support, provide vocabulary lists, and check for understanding.',
    [ERROR_TYPES.KNOWLEDGE_GAP]: 'Identify missing foundational knowledge and provide targeted remediation before moving forward.',
  };

  return strategies[errorType] || 'Review the topic with additional practice and support.';
}

/**
 * Generates a summary of the error analysis.
 *
 * @param {Array} errorPatterns - Array of error patterns
 * @param {number} totalLearners - Total number of learners
 * @returns {string} Summary text
 */
function generateErrorAnalysisSummary(errorPatterns, totalLearners) {
  if (errorPatterns.length === 0) {
    return 'No significant error patterns detected. Class performance is generally good.';
  }

  let summary = `*Error Analysis Summary*\n\n`;
  summary += `Total Learners: ${totalLearners}\n`;
  summary += `Problem Areas Identified: ${errorPatterns.length}\n\n`;

  const topErrors = errorPatterns.slice(0, 3);
  summary += `*Top Problem Areas:*\n`;
  for (const error of topErrors) {
    const percentage = Math.round((error.frequency / totalLearners) * 100);
    summary += `• ${error.topic}: ${percentage}% of learners affected\n`;
  }

  summary += `\n*Error Type Distribution:*\n`;
  const errorTypeCounts = {};
  for (const error of errorPatterns) {
    errorTypeCounts[error.errorType] = (errorTypeCounts[error.errorType] || 0) + 1;
  }

  for (const [type, count] of Object.entries(errorTypeCounts)) {
    summary += `• ${type}: ${count} area(s)\n`;
  }

  return summary;
}

/**
 * Saves error analysis results to the database.
 *
 * @param {number} assessmentId - Assessment ID
 * @param {Array} errorPatterns - Error patterns to save
 */
function saveErrorAnalysis(assessmentId, errorPatterns) {
  const db = getDb();

  // Wrap DELETE + the INSERT loop in a single transaction so a throw partway
  // through cannot leave a partial set of rows committed against this
  // assessmentId. Same pattern as saveItemAnalysis / saveResource.
  try {
    db.prepare('BEGIN').run();

    // Clear existing error analysis for this assessment
    db.prepare(`DELETE FROM error_analysis WHERE assessment_id = ?`).run(assessmentId);

    // Insert new error analysis
    const insert = db.prepare(`
      INSERT INTO error_analysis (
        assessment_id, error_type, topic, frequency, description, reteach_action
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const error of errorPatterns) {
      insert.run(
        assessmentId,
        error.errorType,
        error.topic,
        error.frequency,
        error.description,
        getReteachingStrategy(error.errorType)
      );
    }

    db.prepare('COMMIT').run();
  } catch (err) {
    try { db.prepare('ROLLBACK').run(); } catch (_) { /* best-effort */ }
    throw err;
  }
}

module.exports = {
  performErrorAnalysis,
  saveErrorAnalysis,
  generateReteachingRecommendations,
  generateErrorAnalysisSummary,
  ERROR_TYPES,
};
