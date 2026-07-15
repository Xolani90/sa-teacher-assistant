'use strict';

/**
 * Observation-based developmental grouping (Foundation Phase).
 *
 * Mirrors the role of learnerGroupingService.js for the numeric pipeline,
 * but groups learners by developmental status categories instead of
 * percentage thresholds (per architecture doc — no percentage bands).
 *
 * STATUS: Phase 1 skeleton. No grouping logic implemented yet (Phase 4).
 */

/**
 * Groups learners for a given observation assessment into developmental
 * categories (e.g. 'Achieved', 'Developing', 'Not Yet') rather than the
 * percentage-based groups A/B/C used by groupLearners().
 *
 * @param {number} observationAssessmentId
 * @returns {{
 *   achieved: Array<{ learnerName: string }>,
 *   developing: Array<{ learnerName: string }>,
 *   notYet: Array<{ learnerName: string }>
 * }}
 */
function groupObservations(observationAssessmentId) {
  // TODO (Phase 4): implement developmental-status grouping.
  throw new Error('groupObservations() not yet implemented — Phase 4');
}

/**
 * Produces a teacher-facing summary of the developmental grouping
 * (mirrors generateGroupingSummary() in learnerGroupingService.js).
 *
 * @param {object} groups - Output of groupObservations().
 * @param {number} totalLearners
 * @returns {string}
 */
function generateGroupingSummary(groups, totalLearners) {
  // TODO (Phase 4): implement summary generation.
  throw new Error('generateGroupingSummary() not yet implemented — Phase 4');
}

module.exports = {
  groupObservations,
  generateGroupingSummary,
};
