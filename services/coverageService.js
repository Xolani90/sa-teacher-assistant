'use strict';

/**
 * Coverage service (ADR-007, §3.2).
 *
 * Compares a learner's completed, blueprint-backed assessment work against
 * CAPS expectations for their grade/subject/term. Composes
 * services/learnerTimelineService.js, services/blueprintRepository.js, and
 * services/curriculumCoverageService.js — issues no SQL of its own.
 *
 * Per ADR-007 §3.2, this module deliberately does NOT:
 *   - compute performance trends (that's ProgressService)
 *   - make mastery or intervention judgements (MasteryService /
 *     InterventionService)
 *   - call AI
 *
 * Scope note (the CoverageService analogue of ProgressService's
 * percentage-bearing-events-only rule): only assessment TimelineEvents
 * backed by a published blueprint (payload.blueprintId != null) carry
 * topic-level detail — a free-form (non-blueprint) test has marks but no
 * structured topic breakdown, so this service cannot and does not include
 * it in coverage. Observation events are excluded entirely (developmental
 * domains are not CAPS topics). Coverage is computed per learner, per
 * (subject, grade, term) — CAPS topic lists are already scoped that way
 * (services/curriculumIntelligenceService.js's CAPS_TOPICS), so mixing
 * terms or grades within one report would compare against the wrong
 * expected-topic list.
 */

const learnerTimelineService = require('./learnerTimelineService');
const blueprintRepository = require('./blueprintRepository');
// Deliberately NOT destructured — kept as a module reference so tests can
// mock curriculumCoverageService.getExpectedTopics by property
// reassignment (same pattern used for the other two seams here).
const curriculumCoverageService = require('./curriculumCoverageService');

/**
 * @typedef {Object} CoverageReport
 * @property {number} learnerId
 * @property {string} subject
 * @property {number} grade
 * @property {number} term
 * @property {boolean} dataAvailable
 * False when no CAPS reference data exists for this grade/subject/term
 * (curriculumCoverageService.getExpectedTopics() returned []). When false,
 * expectedTopics/completedTopics/missingTopics/coveragePercentage are not
 * meaningful and should not be displayed as 0% coverage.
 * @property {string[]} expectedTopics
 * @property {string[]} completedTopics
 * Topics covered by at least one blueprint-backed assessment, restricted
 * to topics that are actually in expectedTopics (a blueprint question
 * topic that doesn't match the CAPS registry string exactly is not
 * silently counted as coverage of a different, unrelated expected topic).
 * @property {string[]} missingTopics
 * @property {number} coveragePercentage
 * completedTopics.length / expectedTopics.length * 100, rounded to the
 * nearest whole number. 0 when dataAvailable is false or expectedTopics
 * is empty for another reason.
 * @property {number} eventCount
 * Number of blueprint-backed assessment events that contributed to this
 * report (for transparency/debugging, not itself a coverage metric).
 */

/**
 * Filters a raw TimelineEvent[] down to blueprint-backed assessment
 * events only. Pure function.
 *
 * @param {import('./learnerTimelineService').TimelineEvent[]} events
 * @returns {import('./learnerTimelineService').TimelineEvent[]}
 */
function filterCoverageEvents(events) {
  return events.filter(
    (event) => event.type === 'assessment' && event.payload && event.payload.blueprintId != null
  );
}

/**
 * Groups already-filtered assessment events by (subject, grade, term) —
 * the same granularity CAPS_TOPICS is scoped at.
 *
 * @param {import('./learnerTimelineService').TimelineEvent[]} events
 * @returns {Map<string, {subject: string, grade: number, term: number, events: import('./learnerTimelineService').TimelineEvent[]}>}
 */
function groupBySubjectGradeTerm(events) {
  const groups = new Map();
  for (const event of events) {
    const subject = event.subject || 'unspecified';
    const grade = event.grade;
    const term = event.payload.term;
    const key = `${subject}::${grade}::${term}`;
    if (!groups.has(key)) {
      groups.set(key, { subject, grade, term, events: [] });
    }
    groups.get(key).events.push(event);
  }
  return groups;
}

/**
 * Resolves the set of topic strings a single blueprint-backed event
 * covered, via blueprintRepository.getBlueprintById(). Returns an empty
 * array (not a throw) if the blueprint has since been deleted — a
 * timeline event referencing a now-missing blueprint is a real but
 * non-fatal state, not a bug in this service.
 *
 * @param {import('./learnerTimelineService').TimelineEvent} event
 * @returns {string[]}
 */
function resolveEventTopics(event) {
  const blueprint = blueprintRepository.getBlueprintById(event.payload.blueprintId);
  if (!blueprint || !Array.isArray(blueprint.questions)) return [];
  return blueprint.questions.map((q) => q.topic).filter(Boolean);
}

/**
 * Builds a single CoverageReport for one (subject, grade, term) group.
 *
 * @param {number} learnerId
 * @param {string} subject
 * @param {number} grade
 * @param {number} term
 * @param {import('./learnerTimelineService').TimelineEvent[]} events
 * @returns {CoverageReport}
 */
function buildReport(learnerId, subject, grade, term, events) {
  const expectedTopics = curriculumCoverageService.getExpectedTopics(grade, subject, term);
  const dataAvailable = expectedTopics.length > 0;

  const expectedSet = new Set(expectedTopics);
  const completedSet = new Set();
  for (const event of events) {
    for (const topic of resolveEventTopics(event)) {
      if (expectedSet.has(topic)) completedSet.add(topic);
    }
  }

  const completedTopics = expectedTopics.filter((t) => completedSet.has(t));
  const missingTopics = expectedTopics.filter((t) => !completedSet.has(t));
  const coveragePercentage = dataAvailable
    ? Math.round((completedTopics.length / expectedTopics.length) * 100)
    : 0;

  return {
    learnerId,
    subject,
    grade,
    term,
    dataAvailable,
    expectedTopics,
    completedTopics,
    missingTopics,
    coveragePercentage,
    eventCount: events.length,
  };
}

/**
 * Returns one CoverageReport per (subject, grade, term) for which the
 * learner has at least one blueprint-backed assessment event.
 *
 * @param {number} learnerId
 * @param {{includeSuperseded?: boolean}} [options]
 * @returns {CoverageReport[]}
 */
function getLearnerCoverage(learnerId, options = {}) {
  const timeline = learnerTimelineService.getLearnerTimeline(learnerId, options);
  const coverageEvents = filterCoverageEvents(timeline);
  const groups = groupBySubjectGradeTerm(coverageEvents);

  const reports = [];
  for (const { subject, grade, term, events } of groups.values()) {
    reports.push(buildReport(learnerId, subject, grade, term, events));
  }

  // Deterministic order: subject, then term ascending.
  reports.sort((a, b) => a.subject.localeCompare(b.subject) || a.term - b.term);

  return reports;
}

module.exports = {
  getLearnerCoverage,
  // Exported for unit testing as pure functions; not part of the public
  // contract for other services (same pattern as progressService.js).
  filterCoverageEvents,
  groupBySubjectGradeTerm,
  resolveEventTopics,
  buildReport,
};
