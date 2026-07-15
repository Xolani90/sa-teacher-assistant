'use strict';

/**
 * Observation-based assessment parser (Foundation Phase).
 *
 * Mirrors the role of utils/marksParser.js for the numeric assessment
 * pipeline, but produces structured observation records instead of
 * mark-based learner results. See:
 *   docs/foundation-phase-observation-pipeline.md
 *
 * Exact grade scope (e.g. Grade R only, vs. Grade R-3) is not fixed by
 * this file — that decision is made at the webhook integration point
 * (Phase 7), not baked into the parser itself.
 *
 * STATUS: Phase 1 skeleton. No parsing logic implemented yet (Phase 2).
 * This file is not required or called by any other module yet.
 */

/**
 * Parses free-text teacher observation input into structured records.
 *
 * Expected input covers (per architecture doc):
 *   - developmental milestones
 *   - teacher observations
 *   - oral activities
 *   - practical activities
 *   - continuous assessment
 *
 * Unlike parseMarks(), this NEVER produces mark / total_marks / percentage
 * fields. Output must represent developmental status only.
 *
 * @param {string|Buffer} input - Raw teacher-submitted observation text.
 * @returns {{
 *   success: boolean,
 *   records: Array<{
 *     learnerName: string,
 *     developmentalStatus: string,   // e.g. 'Not Yet' | 'Developing' | 'Achieved'
 *     domain: string|null,           // e.g. 'gross motor', 'oral language'
 *     notes: string|null
 *   }>,
 *   errors: string[],
 *   warnings: string[]
 * }}
 */
function parseObservation(input) {
  // TODO (Phase 2): implement text-format observation parsing.
  throw new Error('parseObservation() not yet implemented — Phase 2');
}

/**
 * Returns teacher-facing help text describing the expected observation
 * input format (mirrors getFormatHelpText() in marksParser.js).
 *
 * @returns {string}
 */
function getObservationFormatHelpText() {
  // TODO (Phase 2): write Foundation-Phase-appropriate format guidance.
  throw new Error('getObservationFormatHelpText() not yet implemented — Phase 2');
}

module.exports = {
  parseObservation,
  getObservationFormatHelpText,
};
