'use strict';

/**
 * Observation Detail aggregation service — observation-scoped
 * counterpart to classDetailService.js / learnerDetailService.js (PR27).
 *
 * Powers the dashboard's Observation Session Detail page: composes
 * observationRepository.js's existing getObservationAssessment() with
 * its own correction-lineage neighbors (the "corrects" original and/or
 * the "superseded by" corrector) into one payload, so the page can
 * render header + records + correction lineage from a single request.
 *
 * Per the layering rule in docs/ARCHITECTURE.md this module performs NO
 * SQL of its own — it only calls
 * observationRepository.getObservationAssessment() (once for the
 * requested session, and up to twice more for its correction
 * neighbors) and reshapes the results. Ownership is enforced here by
 * comparing phoneHash, the same convention every other *DetailService
 * in this codebase uses.
 *
 * Deliberately does NOT surface "observer" or "overall rating" — those
 * fields do not exist in observation_assessments/observation_records.
 * Their absence is a domain-model decision, not an oversight; see PR27
 * scope discussion. What IS surfaced instead, per record: domain,
 * developmentalStatus, notes, and the resolved (follow-up) flag —
 * exactly what the schema actually captures.
 */

const { getObservationAssessment } = require('./observationRepository');

/**
 * Builds the correction-lineage summary for one session.
 *
 * - If this session corrects an earlier one (correctsAssessmentId set),
 *   fetches that original's createdAt so the UI can show "Corrects
 *   observation from <date>".
 * - If this session has since been superseded (supersededByAssessmentId
 *   set, already present on the base record from
 *   getObservationAssessment()), fetches the corrector's createdAt so
 *   the UI can show "Superseded by correction on <date>" plus a link.
 *
 * Both lookups reuse getObservationAssessment() rather than issuing new
 * SQL — a correction chain is expected to be at most one hop in either
 * direction under current product rules (an already-superseded
 * assessment cannot itself be corrected again), so this never recurses.
 *
 * @param {import('./observationRepository').ObservationAssessment} assessment
 * @returns {{
 *   correctsAssessmentId: number|null,
 *   correctsCreatedAt: string|null,
 *   supersededByAssessmentId: number|null,
 *   supersededByCreatedAt: string|null,
 *   isCurrent: boolean
 * }}
 */
function buildCorrectionLineage(assessment) {
  let correctsCreatedAt = null;
  if (assessment.correctsAssessmentId != null) {
    const original = getObservationAssessment(assessment.correctsAssessmentId);
    correctsCreatedAt = original ? original.createdAt : null;
  }

  let supersededByCreatedAt = null;
  if (assessment.supersededByAssessmentId != null) {
    const corrector = getObservationAssessment(assessment.supersededByAssessmentId);
    supersededByCreatedAt = corrector ? corrector.createdAt : null;
  }

  return {
    correctsAssessmentId: assessment.correctsAssessmentId,
    correctsCreatedAt,
    supersededByAssessmentId: assessment.supersededByAssessmentId,
    supersededByCreatedAt,
    isCurrent: assessment.supersededByAssessmentId == null,
  };
}

/**
 * Assembles the full Observation Detail payload for one session.
 *
 * @param {string} phoneHash - Teacher's phone hash (authorization scope
 *   — getObservationAssessment() returns the row regardless of owner,
 *   so ownership is enforced here, same convention every other
 *   *DetailService in this codebase uses).
 * @param {number} assessmentId
 * @returns {Object|null} null if the session doesn't exist or belongs
 *   to another teacher; otherwise the full aggregated view.
 */
function getObservationDetail(phoneHash, assessmentId) {
  const assessment = getObservationAssessment(assessmentId);
  if (!assessment || assessment.phoneHash !== phoneHash) return null;

  return {
    session: {
      id: assessment.id,
      assessmentName: assessment.assessmentName,
      grade: assessment.grade,
      subject: assessment.subject,
      classId: assessment.classId,
      createdAt: assessment.createdAt,
      recordCount: assessment.records.length,
      learnerCount: new Set(assessment.records.map((r) => r.learnerName)).size,
    },
    correctionLineage: buildCorrectionLineage(assessment),
    records: assessment.records,
  };
}

module.exports = {
  getObservationDetail,
  buildCorrectionLineage,
};
