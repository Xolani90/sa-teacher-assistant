'use strict';

/**
 * Progress service (ADR-007, PR4).
 *
 * Computes performance trends over a learner's timeline. Composes
 * services/learnerTimelineService.js — issues no SQL/repository calls of
 * its own.
 *
 * Per ADR-007 §3.1, this module deliberately does NOT:
 *   - consider observation events (developmentalStatus is not numeric and
 *     is not a comparable achievement measure)
 *   - aggregate across subjects (a Mathematics trend and an English trend
 *     are never blended into one number)
 *   - blend assessment types within a subject (a quiz trend and an exam
 *     trend are computed as the same kind of "percentage over time" series
 *     but this service does not weight/normalize one against the other —
 *     that would be a future, explicitly-scoped extension)
 *   - infer CAPS/curriculum coverage (CoverageService)
 *   - make mastery or intervention judgements (MasteryService /
 *     InterventionService)
 *   - call AI
 *
 * ProgressService analyzes only percentage-bearing assessment events.
 * Events without a comparable numeric achievement measure (for example,
 * developmental-status observations) are ignored by this service. Progress
 * trends are computed per learner, per subject. Cross-subject aggregation
 * is outside the scope of ProgressService.
 */

const learnerTimelineService = require('./learnerTimelineService');

/**
 * @typedef {Object} ProgressPoint
 * @property {string} eventKey
 * @property {string} occurredAt
 * @property {number} percentage
 * @property {string} title
 * @property {?string} assessmentType
 *
 * @typedef {Object} ProgressReport
 * @property {number} learnerId
 * @property {string} subject
 * @property {number} eventCount
 * @property {"insufficient-data"|"rising"|"falling"|"flat"} trend
 * @property {?number} delta
 * Percentage-point difference between the most recent and earliest point
 * in the series (positive = improvement). Null when eventCount < 2.
 * @property {?number} latestPercentage
 * @property {?number} earliestPercentage
 * @property {?number} averagePercentage
 * @property {ProgressPoint[]} points
 * Chronological order, oldest first (opposite of the timeline's default
 * most-recent-first order — trend calculations read more naturally oldest
 * to newest).
 */

// A delta smaller than this (in percentage points) is reported as "flat"
// rather than "rising"/"falling" — avoids over-interpreting noise between
// two closely-scored assessments.
const FLAT_THRESHOLD = 2;

/**
 * Filters a raw TimelineEvent[] down to percentage-bearing assessment
 * events only. Pure function.
 *
 * @param {import('./learnerTimelineService').TimelineEvent[]} events
 * @returns {import('./learnerTimelineService').TimelineEvent[]}
 */
function filterProgressEvents(events) {
  return events.filter(
    (event) => event.type === 'assessment' && event.payload && event.payload.percentage != null
  );
}

/**
 * Groups already-filtered assessment events by subject.
 *
 * @param {import('./learnerTimelineService').TimelineEvent[]} events
 * @returns {Map<string, import('./learnerTimelineService').TimelineEvent[]>}
 */
function groupBySubject(events) {
  const groups = new Map();
  for (const event of events) {
    const subject = event.subject || 'unspecified';
    if (!groups.has(subject)) groups.set(subject, []);
    groups.get(subject).push(event);
  }
  return groups;
}

/**
 * Computes a single subject's ProgressReport from its (unsorted) events.
 *
 * @param {number} learnerId
 * @param {string} subject
 * @param {import('./learnerTimelineService').TimelineEvent[]} events
 * @returns {ProgressReport}
 */
function buildReport(learnerId, subject, events) {
  // Chronological, oldest first — occurredAt ascending.
  const sorted = [...events].sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0));

  const points = sorted.map((event) => ({
    eventKey: event.eventKey,
    occurredAt: event.occurredAt,
    percentage: event.payload.percentage,
    title: event.title,
    assessmentType: event.payload.assessmentType != null ? event.payload.assessmentType : null,
  }));

  if (points.length === 0) {
    return {
      learnerId,
      subject,
      eventCount: 0,
      trend: 'insufficient-data',
      delta: null,
      latestPercentage: null,
      earliestPercentage: null,
      averagePercentage: null,
      points: [],
    };
  }

  const earliestPercentage = points[0].percentage;
  const latestPercentage = points[points.length - 1].percentage;
  const averagePercentage =
    points.reduce((sum, p) => sum + p.percentage, 0) / points.length;

  if (points.length < 2) {
    return {
      learnerId,
      subject,
      eventCount: points.length,
      trend: 'insufficient-data',
      delta: null,
      latestPercentage,
      earliestPercentage,
      averagePercentage,
      points,
    };
  }

  const delta = latestPercentage - earliestPercentage;
  let trend;
  if (Math.abs(delta) < FLAT_THRESHOLD) {
    trend = 'flat';
  } else if (delta > 0) {
    trend = 'rising';
  } else {
    trend = 'falling';
  }

  return {
    learnerId,
    subject,
    eventCount: points.length,
    trend,
    delta,
    latestPercentage,
    earliestPercentage,
    averagePercentage,
    points,
  };
}

/**
 * Returns one ProgressReport per subject for which the learner has at
 * least one percentage-bearing assessment event.
 *
 * @param {number} learnerId
 * @param {{includeSuperseded?: boolean}} [options]
 * @returns {ProgressReport[]}
 */
function getLearnerProgress(learnerId, options = {}) {
  const timeline = learnerTimelineService.getLearnerTimeline(learnerId, options);
  const progressEvents = filterProgressEvents(timeline);
  const groups = groupBySubject(progressEvents);

  const reports = [];
  for (const [subject, events] of groups) {
    reports.push(buildReport(learnerId, subject, events));
  }

  // Deterministic order: alphabetical by subject.
  reports.sort((a, b) => a.subject.localeCompare(b.subject));

  return reports;
}

/**
 * Convenience accessor for a single subject's ProgressReport. Returns an
 * "insufficient-data" report with an empty points array if the learner has
 * no percentage-bearing events for that subject (never returns null/undefined,
 * so callers don't need a null check before reading .trend).
 *
 * @param {number} learnerId
 * @param {string} subject
 * @param {{includeSuperseded?: boolean}} [options]
 * @returns {ProgressReport}
 */
function getLearnerProgressForSubject(learnerId, subject, options = {}) {
  const timeline = learnerTimelineService.getLearnerTimeline(learnerId, options);
  const progressEvents = filterProgressEvents(timeline).filter(
    (event) => (event.subject || 'unspecified') === subject
  );
  return buildReport(learnerId, subject, progressEvents);
}

module.exports = {
  getLearnerProgress,
  getLearnerProgressForSubject,
  // Exported for unit testing as pure functions; not part of the public
  // contract for other services (mirrors learnerTimelineService.js's
  // pattern of exporting normalizers alongside the main entry point).
  filterProgressEvents,
  groupBySubject,
  buildReport,
};
