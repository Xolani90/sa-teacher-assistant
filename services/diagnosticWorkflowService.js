'use strict';

/**
 * Automated Diagnostic Workflow Service
 * Orchestrates the complete diagnostic workflow when assessment data is uploaded.
 * Runs all analysis engines and generates comprehensive intervention recommendations.
 */

const { getDb } = require('../utils/database');
const { performItemAnalysis, saveItemAnalysis } = require('./itemAnalysisService');
const { performErrorAnalysis, saveErrorAnalysis } = require('./errorAnalysisService');
const { groupLearners } = require('./learnerGroupingService');
const { generateInterventionPlan } = require('./interventionPlanService');
const { generateInterventionReport, generateTeacherSummary } = require('./interventionReportsService');
const { updateCoverageFromAssessment } = require('./curriculumCoverageService');

/**
 * Processes uploaded assessment data through the complete diagnostic workflow.
 *
 * @param {string} phoneHash - Teacher's phone hash
 * @param {Object} assessmentData - Uploaded assessment data
 * @returns {Object} Diagnostic results
 */
function processAssessmentData(phoneHash, assessmentData) {
  const db = getDb();

  // Step 1: Validate and store assessment
  const assessmentId = storeAssessment(phoneHash, assessmentData);

  if (!assessmentId) {
    return { error: 'Failed to store assessment data' };
  }

  // Step 2: Store learner results
  const resultsStored = storeLearnerResults(assessmentId, assessmentData.learnerResults);

  if (!resultsStored) {
    return { error: 'Failed to store learner results' };
  }

  // Step 3: Run item analysis
  const itemAnalysis = performItemAnalysis(assessmentId);
  if (!itemAnalysis.error) {
    saveItemAnalysis(assessmentId, itemAnalysis.questions, assessmentData.subject);
  }

  // Step 4: Run error analysis
  const errorAnalysis = performErrorAnalysis(assessmentId, assessmentData.subject);
  if (!errorAnalysis.error) {
    saveErrorAnalysis(assessmentId, errorAnalysis.errorPatterns);
  }

  // Step 5: Run learner grouping
  const learnerGrouping = groupLearners(assessmentId);

  // Step 6: Generate intervention plan
  const interventionPlan = generateInterventionPlan(phoneHash, assessmentId);

  // Step 7: Update curriculum coverage
  updateCoverageFromAssessment(assessmentId);

  // Step 8: Generate comprehensive report
  const interventionReport = generateInterventionReport(assessmentId);

  // Step 9: Compile diagnostic results
  const diagnosticResults = {
    assessmentId,
    assessment: {
      title: assessmentData.title,
      grade: assessmentData.grade,
      subject: assessmentData.subject,
      term: assessmentData.term,
      type: assessmentData.type,
      totalMarks: assessmentData.totalMarks,
    },
    analyses: {
      itemAnalysis,
      errorAnalysis,
      learnerGrouping,
      interventionPlan,
    },
    report: interventionReport,
    teacherSummary: generateTeacherSummary(interventionReport),
    processedAt: new Date().toISOString(),
    status: 'complete',
  };

  return diagnosticResults;
}

/**
 * Stores assessment metadata in the database.
 *
 * @param {string} phoneHash - Teacher's phone hash
 * @param {Object} assessmentData - Assessment data
 * @returns {number} Assessment ID or null
 */
function storeAssessment(phoneHash, assessmentData) {
  const db = getDb();

  try {
    const result = db.prepare(`
      INSERT INTO assessments (
        phone_hash, title, grade, subject, term, assessment_type, total_marks, atp_topics
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      phoneHash,
      assessmentData.title,
      assessmentData.grade,
      assessmentData.subject,
      assessmentData.term,
      assessmentData.type,
      assessmentData.totalMarks,
      JSON.stringify(assessmentData.atpTopics || [])
    );

    return result.lastInsertRowid;
  } catch (error) {
    console.error('Failed to store assessment:', error.message);
    return null;
  }
}

/**
 * Stores learner results in the database.
 *
 * @param {number} assessmentId - Assessment ID
 * @param {Array} learnerResults - Array of learner result objects
 * @returns {boolean} Success status
 */
function storeLearnerResults(assessmentId, learnerResults) {
  const db = getDb();

  // Wrap the INSERT loop in a transaction so a throw partway through (e.g.
  // unparseable per-learner data) cannot leave a partial set of learner
  // rows committed under this assessmentId while the caller is told the
  // whole operation failed (false) -- a teacher who re-uploads believing
  // nothing was saved would otherwise get duplicate rows for the learners
  // that *did* make it in before the throw.
  try {
    db.prepare('BEGIN').run();

    const insert = db.prepare(`
      INSERT INTO learner_results (
        assessment_id, learner_name, mark, total_marks, percentage, question_data
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const result of learnerResults) {
      const percentage = (result.mark / result.totalMarks) * 100;
      insert.run(
        assessmentId,
        result.learnerName,
        result.mark,
        result.totalMarks,
        percentage,
        JSON.stringify(result.questionData || {})
      );
    }

    db.prepare('COMMIT').run();
    return true;
  } catch (error) {
    try { db.prepare('ROLLBACK').run(); } catch (_) { /* best-effort */ }
    console.error('Failed to store learner results:', error.message);
    return false;
  }
}

/**
 * Generates a diagnostic summary for the teacher.
 *
 * @param {Object} diagnosticResults - Full diagnostic results
 * @returns {string} Teacher-friendly summary
 */
function generateDiagnosticSummary(diagnosticResults) {
  let summary = `*Diagnostic Report: ${diagnosticResults.assessment.title}*\n\n`;
  summary += `Grade ${diagnosticResults.assessment.grade} ${diagnosticResults.assessment.subject}\n`;
  summary += `Term ${diagnosticResults.assessment.term} - ${diagnosticResults.assessment.type}\n\n`;

  summary += `*Key Findings*\n\n`;

  // Class performance
  if (diagnosticResults.analyses.learnerGrouping) {
    summary += `**Class Performance**\n`;
    summary += `Average: ${diagnosticResults.analyses.learnerGrouping.classAverage}%\n`;
    summary += `Total Learners: ${diagnosticResults.analyses.learnerGrouping.totalLearners}\n\n`;
  }

  // Problem areas
  if (diagnosticResults.analyses.errorAnalysis && !diagnosticResults.analyses.errorAnalysis.error) {
    summary += `**Problem Areas**\n`;
    const topErrors = diagnosticResults.analyses.errorAnalysis.errorPatterns.slice(0, 3);
    for (const error of topErrors) {
      summary += `• ${error.topic}\n`;
    }
    summary += `\n`;
  }

  // Assessment quality
  if (diagnosticResults.analyses.itemAnalysis && !diagnosticResults.analyses.itemAnalysis.error) {
    summary += `**Assessment Quality**\n`;
    summary += `Questions needing revision: ${diagnosticResults.analyses.itemAnalysis.questions.filter(q => q.itemQuality === 'poor' || q.itemQuality === 'needs_revision').length}\n\n`;
  }

  // Intervention recommendation
  if (diagnosticResults.analyses.interventionPlan && !diagnosticResults.analyses.interventionPlan.error) {
    summary += `**Recommended Intervention**\n`;
    summary += `Focus: ${diagnosticResults.analyses.interventionPlan.problemArea}\n`;
    summary += `Target: ${diagnosticResults.analyses.interventionPlan.targetGroup}\n`;
    summary += `Duration: ${diagnosticResults.analyses.interventionPlan.durationDays} days\n\n`;
  }

  summary += `*Next Steps*\n`;
  summary += `1. Review the full diagnostic report\n`;
  summary += `2. Implement the suggested intervention plan\n`;
  summary += `3. Use the differentiated activities for targeted groups\n`;
  summary += `4. Monitor progress and adjust as needed\n`;

  return summary;
}

/**
 * Gets diagnostic history for a teacher.
 *
 * @param {string} phoneHash - Teacher's phone hash
 * @returns {Array} Array of diagnostic summaries
 */
function getDiagnosticHistory(phoneHash) {
  const db = getDb();

  const assessments = db.prepare(`
    SELECT id, title, grade, subject, term, assessment_type, created_at
    FROM assessments
    WHERE phone_hash = ?
    ORDER BY created_at DESC
    LIMIT 10
  `).all(phoneHash);

  return assessments.map(a => ({
    assessmentId: a.id,
    title: a.title,
    grade: a.grade,
    subject: a.subject,
    term: a.term,
    type: a.assessment_type,
    date: a.created_at,
  }));
}

/**
 * Validates uploaded assessment data structure.
 *
 * @param {Object} assessmentData - Assessment data to validate
 * @returns {Object} Validation result
 */
function validateAssessmentData(assessmentData) {
  const errors = [];

  if (!assessmentData.title) errors.push('Missing assessment title');
  if (!assessmentData.grade) errors.push('Missing grade');
  if (!assessmentData.subject) errors.push('Missing subject');
  if (!assessmentData.term) errors.push('Missing term');
  if (!assessmentData.type) errors.push('Missing assessment type');
  if (!assessmentData.totalMarks) errors.push('Missing total marks');
  if (!assessmentData.learnerResults || !Array.isArray(assessmentData.learnerResults)) {
    errors.push('Missing or invalid learner results');
  }

  if (assessmentData.learnerResults) {
    for (let i = 0; i < assessmentData.learnerResults.length; i++) {
      const result = assessmentData.learnerResults[i];
      if (!result.learnerName) errors.push(`Learner ${i + 1}: Missing name`);
      if (result.mark === undefined) errors.push(`Learner ${i + 1}: Missing mark`);
      if (!result.totalMarks) errors.push(`Learner ${i + 1}: Missing total marks`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

module.exports = {
  processAssessmentData,
  generateDiagnosticSummary,
  getDiagnosticHistory,
  validateAssessmentData,
};
