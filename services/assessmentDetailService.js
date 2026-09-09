'use strict';
/**
 * Assessment Detail Service (PR28)
 *
 * Composes GET /api/assessments/:assessmentId/detail's response.
 * Layering follows the same convention as classDetailService.js /
 * observationDetailService.js: this module issues no SQL of its own for
 * anything already exposed by an existing service — it composes.
 *
 * Direct SQL is used only for the two lookups no existing service exposes
 * at this granularity: the single assessment row scoped by (phoneHash, id),
 * and its learner_results rows. Both are simple, narrow, ownership-scoped
 * reads — the same pattern generateBlueprintAssessmentPdf() uses in
 * services/pdfService.js for its own assessment/teacher lookups.
 *
 * Blueprint-backed assessments (assessment.blueprint_id is set) get topic-
 * level analytics via getBlueprintAssessmentAnalytics() — the same call
 * generateBlueprintAssessmentPdf() makes. Free-form (legacy) assessments
 * get the learner results list only, with analytics.available=false and a
 * reason, rather than a hard error — the page should still render.
 */

const { getDb } = require('../utils/database');
const { getBlueprintAssessmentAnalytics } = require('./blueprintAnalytics');
const { performItemAnalysis } = require('./itemAnalysisService');
const { computeInterventionPlan } = require('./interventionPlanService');
const { listSavedReports } = require('./interventionReportsService');

/**
 * @param {string} phoneHash
 * @param {number} assessmentId
 * @returns {object|null} null if the assessment doesn't exist or isn't
 *   owned by this teacher (same 404-not-403 convention as classDetailService).
 */
function getAssessmentDetail(phoneHash, assessmentId) {
  const db = getDb();

  const assessment = db
    .prepare(`SELECT * FROM assessments WHERE id = ? AND phone_hash = ?`)
    .get(assessmentId, phoneHash);

  if (!assessment) return null;

  const classRow = assessment.class_id
    ? db.prepare(`SELECT id, name FROM classes WHERE id = ?`).get(assessment.class_id)
    : null;

  const learnerRows = db
    .prepare(
      `SELECT id, learner_id, learner_name, mark, total_marks, percentage, created_at
       FROM learner_results
       WHERE assessment_id = ?
       ORDER BY percentage DESC`
    )
    .all(assessmentId);

  const learners = learnerRows.map((row) => ({
    resultId: row.id,
    learnerId: row.learner_id,
    learnerName: row.learner_name,
    mark: row.mark,
    totalMarks: row.total_marks,
    percentage: row.percentage,
    createdAt: row.created_at,
  }));

  const classAverage =
    learners.length > 0
      ? Math.round((learners.reduce((sum, l) => sum + l.percentage, 0) / learners.length) * 10) / 10
      : null;

  const passCount = learners.filter((l) => l.percentage >= 50).length;
  const passRate = learners.length > 0 ? Math.round((passCount / learners.length) * 100) : null;

  // Topic-level analytics: only available for blueprint-backed assessments.
  // getBlueprintAssessmentAnalytics() itself re-derives everything from
  // learner_results.question_data + blueprint_questions, so this is a
  // second, richer view of the same underlying rows we already summarised
  // above — not a duplicate source of truth.
  let analytics = { available: false, reason: null, topics: null };
  if (assessment.blueprint_id) {
    const result = getBlueprintAssessmentAnalytics(assessmentId);
    if (result.error) {
      analytics = { available: false, reason: result.error, topics: null };
    } else {
      analytics = {
        available: true,
        reason: null,
        blueprintTitle: result.blueprintTitle,
        topics: result.topics,
        perLearnerTopics: result.learners, // { learnerName, mark, totalMarks, percentage, topics[] }
      };
    }
  } else {
    analytics.reason =
      'This assessment was created without a Blueprint, so topic-level analytics are unavailable.';
  }

  // W4-F1 remediation: averageFacilityValue, averageDiscrimination, and
  // targetGroupSize are NOT recomputed here — they are composed from the
  // existing authoritative services (itemAnalysisService, interventionPlanService),
  // the same functions diagnosticWorkflowService.js already calls at
  // assessment intake. Both are deterministic, DB-only (no AI/network),
  // read-only calls scoped to this assessmentId — see docs/testing/
  // WORKFLOW_04_ASSESSMENTS.md's W4-F1 investigation for the trace.
  //
  // itemAnalysis: averageFacilityValue/averageDiscrimination already
  // correctly handle blueprint-backed vs free-form question_data shapes
  // (performItemAnalysis's own isBlueprintBacked branch) and were already
  // confirmed non-zero/correct via the closed NR investigation referenced
  // above. A free-form assessment with only total marks (no per-question
  // breakdown) is a valid, documented input shape that produces no
  // analysisResults — performItemAnalysis returns { error } in that case,
  // which is surfaced here as itemAnalysis.available=false with a reason,
  // not a misleading zero.
  //
  // The <10-learner case is NOT special-cased here: performItemAnalysis
  // already returns discriminationIndex=0 by design for small classes
  // (calculateDiscriminationIndex, "not enough data" — confirmed correct
  // behavior in docs/project/PROJECT_STATUS.md, not a bug to work around).
  // averageDiscrimination will reflect that as-is. What IS surfaced here
  // is insufficientDataQuestionCount, derived from the same per-question
  // itemQuality flag performItemAnalysis already computes, so a consumer
  // can tell "discrimination reads low because of real class size" apart
  // from "discrimination reads low because something's broken" — the
  // exact ambiguity W4-F1's stop condition was written to catch.
  let itemAnalysis = { available: false, reason: null, averageFacilityValue: null, averageDiscrimination: null, insufficientDataQuestionCount: null };
  const itemAnalysisResult = performItemAnalysis(assessmentId);
  if (itemAnalysisResult.error) {
    itemAnalysis.reason = itemAnalysisResult.error;
  } else {
    itemAnalysis = {
      available: true,
      reason: null,
      averageFacilityValue: itemAnalysisResult.averageFacilityValue,
      averageDiscrimination: itemAnalysisResult.averageDiscrimination,
      insufficientDataQuestionCount: itemAnalysisResult.questions.filter(
        (q) => q.itemQuality === 'insufficient_data'
      ).length,
    };
  }

  // targetGroupSize: sum of interventionPlan.targetGroups[].count (Groups
  // C + D — the intervention target population), NOT total learnerCount.
  // This is the project's own established definition, settled by the
  // formally resolved RC1-H-002 defect (docs/releases/RC1-MILESTONE.md)
  // and independently confirmed in docs/testing/INVESTIGATION_LOG.md —
  // not an inference made here. computeInterventionPlan() is the
  // non-persisting read variant (see its own doc comment), so this adds
  // no new database writes.
  let targetGroupSize = null;
  const interventionPlanResult = computeInterventionPlan(phoneHash, assessmentId);
  if (!interventionPlanResult.error && Array.isArray(interventionPlanResult.targetGroups)) {
    targetGroupSize = interventionPlanResult.targetGroups.reduce((sum, g) => sum + g.count, 0);
  }

  // Saved diagnostic/HOD/parent reports (migration 015's `reports` table)
  // were write-only until now: generated via WhatsApp REPORT/HOD/PARENT
  // commands and delivered, but never re-fetchable. listSavedReports() is
  // already ownership-scoped by (phoneHash, assessmentId), matching this
  // whole handler's convention.
  const savedReports = listSavedReports(phoneHash, assessmentId);

  return {
    assessment: {
      id: assessment.id,
      title: assessment.title,
      grade: assessment.grade,
      subject: assessment.subject,
      term: assessment.term,
      assessmentType: assessment.assessment_type,
      totalMarks: assessment.total_marks,
      createdAt: assessment.created_at,
      isBlueprintBacked: !!assessment.blueprint_id,
      blueprintId: assessment.blueprint_id || null,
      blueprintVersion: assessment.blueprint_version || null,
    },
    class: classRow ? { id: classRow.id, name: classRow.name } : null,
    summary: {
      learnerCount: learners.length,
      classAverage,
      passRate,
    },
    learners,
    analytics,
    itemAnalysis,
    interventionSummary: {
      targetGroupSize,
    },
    savedReports,
  };
}

/**
 * GET /api/assessments's data source — a teacher-wide, phone_hash-scoped
 * list of assessments (Dashboard IA v1: Assessments Workspace). Follows
 * observationRepository.getObservationHistory()'s query-building
 * convention: base query + WHERE phone_hash, optional filters appended,
 * deterministic ORDER BY with an id DESC tiebreak.
 *
 * classAverage/passRate are computed here via SQL aggregates over
 * learner_results, the same definitions getAssessmentDetail() above uses
 * (percentage average; pass = percentage >= 50) — not reinvented.
 *
 * @param {string} phoneHash
 * @param {Object} [filters]
 * @param {number|string} [filters.grade]
 * @param {string} [filters.subject]
 * @param {number} [filters.classId]
 * @param {number} [filters.limit]
 * @returns {object[]} — empty array for a teacher with no assessments, not an error
 */
function getAssessmentHistory(phoneHash, filters = {}) {
  const db = getDb();

  if (!phoneHash) {
    throw new Error('getAssessmentHistory: phoneHash must not be null or empty');
  }

  let query = `
    SELECT
      a.id,
      a.title,
      a.grade,
      a.subject,
      a.term,
      a.assessment_type,
      a.total_marks,
      a.created_at,
      a.class_id,
      c.name as class_name,
      COUNT(lr.id) as learner_count,
      AVG(lr.percentage) as class_average,
      SUM(CASE WHEN lr.percentage >= 50 THEN 1 ELSE 0 END) as pass_count
    FROM assessments a
    LEFT JOIN classes c ON c.id = a.class_id
    LEFT JOIN learner_results lr ON lr.assessment_id = a.id
    WHERE a.phone_hash = ?
  `;
  const params = [phoneHash];

  if (filters.grade) {
    query += ` AND a.grade = ?`;
    params.push(filters.grade);
  }

  if (filters.subject) {
    query += ` AND a.subject = ?`;
    params.push(filters.subject);
  }

  if (filters.classId) {
    query += ` AND a.class_id = ?`;
    params.push(filters.classId);
  }

  // id DESC tiebreak alongside created_at DESC: same rationale as
  // getObservationHistory — created_at has second-resolution, so ties are
  // possible and need a deterministic secondary sort.
  query += ` GROUP BY a.id ORDER BY a.created_at DESC, a.id DESC`;

  if (filters.limit) {
    query += ` LIMIT ?`;
    params.push(filters.limit);
  }

  const rows = db.prepare(query).all(...params);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    grade: row.grade,
    subject: row.subject,
    term: row.term,
    assessmentType: row.assessment_type,
    totalMarks: row.total_marks,
    createdAt: row.created_at,
    class: row.class_id ? { id: row.class_id, name: row.class_name } : null,
    learnerCount: row.learner_count,
    classAverage: row.learner_count > 0 ? Math.round(row.class_average * 10) / 10 : null,
    passRate: row.learner_count > 0 ? Math.round((row.pass_count / row.learner_count) * 100) : null,
  }));
}

module.exports = { getAssessmentDetail, getAssessmentHistory };
