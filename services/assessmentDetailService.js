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
  };
}

module.exports = { getAssessmentDetail };
