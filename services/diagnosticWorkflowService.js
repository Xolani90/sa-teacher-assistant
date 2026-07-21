'use strict';

/**
 * Automated Diagnostic Workflow Service
 * Orchestrates the complete diagnostic workflow when assessment data is uploaded.
 * Runs all analysis engines and generates comprehensive intervention recommendations.
 */

const { getDb } = require('../utils/database');
const { resolveLearner } = require('./learnerIdentityService');
const { performItemAnalysis, saveItemAnalysis } = require('./itemAnalysisService');
const { performErrorAnalysis, saveErrorAnalysis } = require('./errorAnalysisService');
const { groupLearners } = require('./learnerGroupingService');
const { generateInterventionPlan } = require('./interventionPlanService');
const { generateInterventionReport, generateTeacherSummary } = require('./interventionReportsService');
const { updateCoverageFromAssessment } = require('./curriculumCoverageService');
const { validateLearnerResultsAgainstBlueprint } = require('./blueprintMarksImport');

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

  // Step 1a: if this assessment was created from a published Blueprint
  // (ADR-005, assessmentData.blueprintId), validate every learner's
  // per-question marks against blueprint_questions.max_marks BEFORE
  // storing anything, rather than accepting free-form question_data.
  // A learner whose marks fail blueprint validation (unknown question
  // number, marks exceeding max_marks, non-numeric) is skipped here —
  // same "skip the bad row, don't corrupt the whole class's stats"
  // policy storeLearnerResults() already applies to malformed
  // total/mark values on the non-blueprint path.
  let learnerResults = assessmentData.learnerResults;
  let blueprintSkipped = [];

  if (assessmentData.blueprintId) {
    const { results: blueprintResults } = validateLearnerResultsAgainstBlueprint(
      assessmentData.blueprintId,
      learnerResults
    );
    const validationByName = new Map(blueprintResults.map((r) => [r.learnerName, r]));

    learnerResults = learnerResults.filter((result) => {
      const check = validationByName.get(result.learnerName);
      if (!check || !check.valid) {
        blueprintSkipped.push(result.learnerName || '(unnamed)');
        return false;
      }
      // mark/totalMarks are derived from the blueprint, not trusted from
      // the caller — total is the sum of validated per-question marks,
      // totalMarks is the blueprint's declared total (blueprint_questions
      // sum, mirrored on assessment_blueprints.total_marks), so a
      // learner's percentage can never disagree with their own
      // per-question breakdown.
      result.mark = check.total;
      result.totalMarks = assessmentData.totalMarks;
      return true;
    });
  }

  // Step 2: Store learner results
  // classId comes from assessmentData.classId, resolved by the calling
  // flow per ADR-004 before processAssessmentData() is invoked; null for
  // teachers with 0 classes (zero-class policy).
  const storeResult = storeLearnerResults(
    phoneHash,
    assessmentId,
    learnerResults,
    assessmentData.classId ?? null
  );

  if (!storeResult.success) {
    return { error: 'Failed to store learner results' };
  }

  storeResult.skipped = [...blueprintSkipped, ...storeResult.skipped];

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
  let teacherSummary = generateTeacherSummary(interventionReport);
  if (storeResult.skipped.length > 0) {
    teacherSummary = `⚠️ Could not read marks for: ${storeResult.skipped.join(', ')} — please check their mark format and resubmit for them.\n\n${teacherSummary}`;
  }

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
    teacherSummary,
    skippedLearners: storeResult.skipped,
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
        phone_hash, title, grade, subject, term, assessment_type, total_marks, atp_topics, class_id, blueprint_id, blueprint_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      phoneHash,
      assessmentData.title,
      assessmentData.grade,
      assessmentData.subject,
      assessmentData.term,
      assessmentData.type,
      assessmentData.totalMarks,
      JSON.stringify(assessmentData.atpTopics || []),
      // ADR-004: null for teachers with 0 classes (zero-class policy) or
      // when the calling flow hasn't resolved class context yet.
      assessmentData.classId ?? null,
      // ADR-005/Migration 030: both null for an assessment created
      // without going through the blueprint flow — every existing
      // caller of storeAssessment() continues to work unchanged.
      assessmentData.blueprintId ?? null,
      assessmentData.blueprintVersion ?? null
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
 * @param {string} phoneHash - Teacher's phone hash (required for learner
 *   identity resolution — see ADR-003; identity is scoped per-teacher)
 * @param {number} assessmentId - Assessment ID
 * @param {Array} learnerResults - Array of learner result objects
 * @returns {boolean} Success status
 */
function storeLearnerResults(phoneHash, assessmentId, learnerResults, classId = null) {
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
        assessment_id, learner_name, mark, total_marks, percentage, question_data, learner_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const skipped = [];
    for (const result of learnerResults) {
      // A malformed row (e.g. a teacher typo like "Thabo 5/0") produces
      // Infinity/NaN here, which then poisons classAverage for the ENTIRE
      // class (sum + Infinity = Infinity) in learnerGroupingService, and
      // sorts that one learner into Group A since Infinity >= 80 is true.
      // Skip the bad row rather than insert garbage that corrupts every
      // other learner's grouping and the class-wide stats.
      //
      // This skip is also the validation gate for identity resolution
      // (ADR-003 Implementation Addendum, Principle 2): a row that fails
      // here never reaches resolveLearner(), so no learner identity is
      // created for malformed/skipped rows.
      if (!result.totalMarks || result.totalMarks <= 0 || !Number.isFinite(result.mark)) {
        skipped.push(result.learnerName || '(unnamed)');
        continue;
      }
      const percentage = (result.mark / result.totalMarks) * 100;

      // resolveLearner() participates in the BEGIN already open above —
      // it opens no transaction of its own (ADR-003 Implementation
      // Addendum, Principle 3). classId is resolved by the calling flow
      // per ADR-004 (0/1/2+ class rule) and passed through here; it is
      // null only for teachers with 0 classes (zero-class policy), in
      // which case the learner lands in the unclassed bucket
      // (idx_learners_identity_unclassed).
      const learner = resolveLearner({
        phoneHash,
        classId,
        learnerName: result.learnerName,
      });

      insert.run(
        assessmentId,
        result.learnerName,
        result.mark,
        result.totalMarks,
        percentage,
        JSON.stringify(result.questionData || {}),
        learner.id
      );
    }

    if (skipped.length > 0) {
      console.warn(`[diagnosticWorkflow] Skipped ${skipped.length} malformed learner row(s) for assessment ${assessmentId}: ${skipped.join(', ')}`);
    }

    db.prepare('COMMIT').run();
    return { success: true, skipped };
  } catch (error) {
    try { db.prepare('ROLLBACK').run(); } catch (_) { /* best-effort */ }
    console.error('Failed to store learner results:', error.message);
    return { success: false, skipped: [] };
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
  if (assessmentData.grade === undefined || assessmentData.grade === null) errors.push('Missing grade');
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
