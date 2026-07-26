'use strict';

/**
 * Learner timeline service (ADR-003 Phase 1, PR3).
 *
 * Pure normalization/merge layer over services/learnerRepository.js. Turns
 * the repository's two separately-shaped event lists (assessment events and
 * observation events) into a single, canonical TimelineEvent stream.
 *
 * This module deliberately does NOT:
 *   - calculate mastery, progress, or trends
 *   - infer curriculum coverage
 *   - call AI
 *   - mutate database state
 *   - resolve learner identities
 *   - catch/handle repository errors — they propagate unchanged; recovery
 *     is a flow-layer concern, not this service's.
 *
 * Downstream domain services (ProgressService, MasteryService,
 * CoverageService, InterventionService, RiskScoringService) should consume
 * only TimelineEvent objects and never query learner_results /
 * observation_records directly.
 */

const learnerRepository = require('./learnerRepository');

/**
 * Canonical learner timeline event.
 *
 * @typedef {Object} TimelineEvent
 *
 * @property {string} eventKey
 * Stable unique identifier in the form `${type}:${sourceId}`.
 * e.g. "assessment:145", "observation:62".
 *
 * @property {"assessment"|"observation"} type
 *
 * @property {number} sourceId
 * Physical database row identifier.
 * - assessment  -> learner_results.id
 * - observation -> observation_records.id
 * Observation corrections create a NEW timeline event with a NEW sourceId;
 * timeline events are append-only and are never mutated. Whether a
 * superseded original appears at all is decided by the repository layer
 * (see includeSuperseded), not by this service.
 *
 * @property {number} learnerId
 *
 * @property {string} occurredAt
 * Record creation timestamp (ISO-ish string as stored by SQLite).
 * - assessment  -> learner_results.created_at
 * - observation -> observation_records.created_at
 * This is intentionally the record creation timestamp, not a future
 * "assessment administered" date. If the domain later introduces a
 * distinct administered/observed date, it belongs inside payload — it
 * does not replace occurredAt as the ordering timestamp.
 *
 * @property {string} title
 * Display label only. Consumers must not parse business data out of this
 * field — use the structured fields in payload instead.
 * - assessment  -> assessments.title (already aliased as `title` by
 *   learnerRepository.getAssessmentHistory())
 * - observation -> observation_assessments.assessment_name (already
 *   aliased as `title` by learnerRepository.getObservationHistory())
 *
 * @property {number} grade
 * Numeric grade (0 = Grade R), as already resolved by the repository join.
 *
 * @property {?string} subject
 *
 * @property {Object<string, *>} payload
 * Source-specific data, passed through unmodified from the repository.
 * Treated as immutable by convention — normalizers do not mutate the
 * repository row, and callers should not mutate the returned payload.
 */

/**
 * Normalizes a single repository assessment event
 * (services/learnerRepository.js#getAssessmentHistory shape) into a
 * TimelineEvent. Pure function — no I/O, no side effects.
 *
 * @param {object} row - one element of getAssessmentHistory()'s return array
 * @returns {TimelineEvent}
 */
function normalizeAssessment(row) {
  return {
    eventKey: `assessment:${row.resultId}`,
    type: 'assessment',
    sourceId: row.resultId,
    learnerId: row.learnerId,
    occurredAt: row.createdAt,
    title: row.title,
    grade: row.grade,
    subject: row.subject,
    payload: {
      assessmentId: row.assessmentId,
      learnerName: row.learnerName,
      term: row.term,
      assessmentType: row.assessmentType,
      mark: row.mark,
      totalMarks: row.totalMarks,
      percentage: row.percentage,
    },
  };
}

/**
 * Normalizes a single repository observation event
 * (services/learnerRepository.js#getObservationHistory shape) into a
 * TimelineEvent. Pure function — no I/O, no side effects.
 *
 * @param {object} row - one element of getObservationHistory()'s return array
 * @returns {TimelineEvent}
 */
function normalizeObservation(row) {
  return {
    eventKey: `observation:${row.recordId}`,
    type: 'observation',
    sourceId: row.recordId,
    learnerId: row.learnerId,
    occurredAt: row.createdAt,
    title: row.title,
    grade: row.grade,
    subject: row.subject,
    payload: {
      assessmentId: row.assessmentId,
      learnerName: row.learnerName,
      domain: row.domain,
      developmentalStatus: row.developmentalStatus,
      notes: row.notes,
    },
  };
}

/**
 * Deterministic timeline comparator.
 *
 * Order:
 *   1. occurredAt, descending (most recent first)
 *   2. type, fixed precedence: assessment before observation — this only
 *      matters as a tiebreak when two events share the exact same
 *      occurredAt string, and exists so step 3 is meaningful (sourceId
 *      sequences are independent per table, so comparing them across
 *      types would be meaningless without first partitioning by type).
 *   3. sourceId, descending — only ever compared within the same type,
 *      because step 2 already partitioned by type.
 *
 * @param {TimelineEvent} a
 * @param {TimelineEvent} b
 * @returns {number}
 */
function compareEvents(a, b) {
  if (a.occurredAt !== b.occurredAt) {
    return a.occurredAt < b.occurredAt ? 1 : -1;
  }
  if (a.type !== b.type) {
    return a.type === 'assessment' ? -1 : 1;
  }
  return b.sourceId - a.sourceId;
}

/**
 * Returns one learner's full timeline: assessments and observations merged
 * into a single, chronologically-sorted (most recent first) TimelineEvent
 * array. Composes learnerRepository.getAssessmentHistory() and
 * getObservationHistory() — does not issue its own queries.
 *
 * Any error thrown by the repository (invalid learnerId, DB failure, etc.)
 * propagates unchanged; this function does not catch.
 *
 * @param {number} learnerId
 * @param {{includeSuperseded?: boolean}} [options]
 * @returns {TimelineEvent[]}
 */
function getLearnerTimeline(learnerId, options = {}) {
  const assessmentRows = learnerRepository.getAssessmentHistory(learnerId);
  const observationRows = learnerRepository.getObservationHistory(learnerId, {
    includeSuperseded: options.includeSuperseded,
  });

  const events = [
    ...assessmentRows.map(normalizeAssessment),
    ...observationRows.map(normalizeObservation),
  ];

  events.sort(compareEvents);

  return events;
}

module.exports = {
  getLearnerTimeline,
  // Exported for unit testing as pure functions; not part of the public
  // "consume only TimelineEvent objects" contract for other services.
  normalizeAssessment,
  normalizeObservation,
  compareEvents,
};
