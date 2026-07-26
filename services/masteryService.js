'use strict';

/**
 * Mastery service (ADR-007, PR6, §3.3).
 *
 * Combines learnerTimelineService + ProgressService + CoverageService
 * output into a per-subject mastery judgement. Composition only — issues
 * no SQL/repository calls, builds no timeline of its own, and recomputes
 * no raw trend or coverage math (it consumes ProgressReport/CoverageReport
 * objects exactly as those services produce them).
 *
 * Per ADR-007 §3.3, this module deliberately does NOT:
 *   - query the database or construct its own TimelineEvent[] stream
 *   - recompute trends from raw events (that's ProgressService)
 *   - recompute CAPS coverage from raw events (that's CoverageService)
 *   - make intervention/risk-scoring judgements (future ADR, sits above
 *     MasteryService per §3.5's dependency chain)
 *   - call AI
 *
 * MasteryService combines TimelineService + ProgressService +
 * CoverageService output into a mastery judgement, computed per learner,
 * per subject (the same granularity ProgressService already uses, since a
 * mastery judgement needs a trend signal and trends are subject-scoped).
 * Where a subject has coverage data spanning multiple (grade, term)
 * groups, this service averages across them for a single headline
 * percentage — deliberately simple, per ADR-007 §4's guidance that
 * assessment-type/aggregation nuance is an explicit future extension, not
 * something to invent ad hoc here.
 */

const learnerTimelineService = require('./learnerTimelineService');
const progressService = require('./progressService');
// Deliberately NOT destructured — kept as module references so tests can
// mock exported functions by property reassignment (same pattern used by
// coverageService.js for its three seams).
const coverageService = require('./coverageService');

/**
 * @typedef {Object} MasteryReport
 * @property {number} learnerId
 * @property {string} subject
 * @property {"insufficient-data"|"beginning"|"developing"|"secure"|"advanced"} masteryLevel
 * @property {number} confidence
 * 0–1. How much evidence backs this judgement — not a probability that the
 * judgement is "correct". Rises with progress event count and with the
 * presence of CAPS coverage data; see computeConfidence().
 * @property {Object} evidence
 * @property {import('./progressService').ProgressReport} evidence.progress
 * @property {Object} evidence.coverage
 * @property {boolean} evidence.coverage.dataAvailable
 * True if at least one (grade, term) coverage group for this subject has
 * CAPS reference data (CoverageReport.dataAvailable).
 * @property {?number} evidence.coverage.averagePercentage
 * Mean of coveragePercentage across dataAvailable coverage groups for this
 * subject. Null when dataAvailable is false.
 * @property {import('./coverageService').CoverageReport[]} evidence.coverage.reports
 * @property {Object} evidence.timeline
 * @property {number} evidence.timeline.eventCount
 * Raw TimelineEvent count for this subject (assessment + observation),
 * included for transparency/debugging — not itself part of the mastery
 * calculation.
 * @property {string[]} strengths
 * @property {string[]} concerns
 */

// Coverage-percentage bands used by determineMasteryLevel(). A coverage
// figure below LOW is "beginning"; at/above HIGH it is eligible for
// "secure"/"advanced" depending on the progress trend.
const LOW_COVERAGE_THRESHOLD = 40;
const HIGH_COVERAGE_THRESHOLD = 70;

/**
 * Builds an empty, "insufficient-data" ProgressReport shape for a subject
 * that has no progress data at all, without calling back into
 * progressService (avoids an extra seam call in getLearnerMastery(), which
 * already has the full progressReports array in hand). Mirrors the shape
 * progressService.buildReport() itself returns for zero events.
 *
 * @param {number} learnerId
 * @param {string} subject
 * @returns {import('./progressService').ProgressReport}
 */
function emptyProgressReport(learnerId, subject) {
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

/**
 * Decides the mastery level from a subject's ProgressReport and its
 * coverage evidence. Deliberately simple per ADR-007 §4 — a fixed set of
 * threshold rules, not a scoring model. Later ADRs can replace this
 * function's body with something more sophisticated without changing
 * MasteryReport's shape or MasteryService's dependency boundary.
 *
 * @param {import('./progressService').ProgressReport} progressReport
 * @param {boolean} coverageDataAvailable
 * @param {?number} averagePercentage
 * @returns {MasteryReport["masteryLevel"]}
 */
function determineMasteryLevel(progressReport, coverageDataAvailable, averagePercentage) {
  const hasProgress = progressReport.eventCount > 0;

  if (!hasProgress && !coverageDataAvailable) return 'insufficient-data';

  if (!coverageDataAvailable) {
    // Progress evidence exists but curriculum breadth is unknown — cannot
    // confirm "secure"/"advanced" without coverage, and "beginning" would
    // overstate how little we actually know. "Developing" is the honest
    // floor for "some evidence, unconfirmed breadth".
    return 'developing';
  }

  if (averagePercentage < LOW_COVERAGE_THRESHOLD) return 'beginning';
  if (averagePercentage < HIGH_COVERAGE_THRESHOLD) return 'developing';

  // averagePercentage >= HIGH_COVERAGE_THRESHOLD from here down.
  if (progressReport.trend === 'falling') return 'developing';
  if (progressReport.trend === 'rising') return 'advanced';
  return 'secure';
}

/**
 * Computes a 0–1 confidence score from how much evidence is available —
 * not from how "good" the mastery level is. Half the weight comes from
 * progress event count (capped at 5 events), half from whether any
 * coverage data exists at all for the subject.
 *
 * @param {import('./progressService').ProgressReport} progressReport
 * @param {import('./coverageService').CoverageReport[]} coverageReportsForSubject
 * @returns {number}
 */
function computeConfidence(progressReport, coverageReportsForSubject) {
  const coverageDataAvailable = coverageReportsForSubject.some((r) => r.dataAvailable);
  const progressWeight = Math.min(progressReport.eventCount / 5, 1) * 0.5;
  const coverageWeight = coverageDataAvailable ? 0.5 : 0;
  return Math.round((progressWeight + coverageWeight) * 100) / 100;
}

/**
 * Derives human-readable strengths/concerns strings from the same
 * evidence determineMasteryLevel() uses — no new data sources, just
 * narration of the ProgressReport/CoverageReport signals already computed.
 *
 * @param {import('./progressService').ProgressReport} progressReport
 * @param {boolean} coverageDataAvailable
 * @param {?number} averagePercentage
 * @param {import('./coverageService').CoverageReport[]} coverageReportsForSubject
 * @returns {{strengths: string[], concerns: string[]}}
 */
function buildStrengthsAndConcerns(progressReport, coverageDataAvailable, averagePercentage, coverageReportsForSubject) {
  const strengths = [];
  const concerns = [];

  if (progressReport.trend === 'rising') {
    strengths.push('Assessment performance has been improving over time.');
  }
  if (progressReport.trend === 'falling') {
    concerns.push('Assessment performance has been declining over time.');
  }
  if (progressReport.eventCount === 0) {
    concerns.push('No percentage-bearing assessment history is available yet for this subject.');
  }

  if (coverageDataAvailable) {
    if (averagePercentage >= HIGH_COVERAGE_THRESHOLD) {
      strengths.push('Most expected CAPS topics for this subject have been covered.');
    } else if (averagePercentage < LOW_COVERAGE_THRESHOLD) {
      concerns.push('Significant CAPS topic gaps remain uncovered.');
    }
  } else {
    concerns.push('No CAPS coverage data is available yet for this subject.');
  }

  // Surface specific missing topics from the most recent (grade, term)
  // coverage group, if any — most actionable for a teacher reading this.
  const latestCoverage = [...coverageReportsForSubject].sort(
    (a, b) => b.term - a.term || b.grade - a.grade
  )[0];
  if (latestCoverage && latestCoverage.dataAvailable && latestCoverage.missingTopics.length > 0) {
    concerns.push(`Missing topics (most recent term): ${latestCoverage.missingTopics.join(', ')}`);
  }

  return { strengths, concerns };
}

/**
 * Builds a single MasteryReport for one subject from already-fetched
 * evidence. Pure function.
 *
 * @param {number} learnerId
 * @param {string} subject
 * @param {import('./progressService').ProgressReport} progressReport
 * @param {import('./coverageService').CoverageReport[]} coverageReportsForSubject
 * @param {number} timelineEventCount
 * @returns {MasteryReport}
 */
function buildReport(learnerId, subject, progressReport, coverageReportsForSubject, timelineEventCount) {
  const dataAvailableReports = coverageReportsForSubject.filter((r) => r.dataAvailable);
  const coverageDataAvailable = dataAvailableReports.length > 0;
  const averagePercentage = coverageDataAvailable
    ? Math.round(
        dataAvailableReports.reduce((sum, r) => sum + r.coveragePercentage, 0) / dataAvailableReports.length
      )
    : null;

  const masteryLevel = determineMasteryLevel(progressReport, coverageDataAvailable, averagePercentage);
  const confidence = computeConfidence(progressReport, coverageReportsForSubject);
  const { strengths, concerns } = buildStrengthsAndConcerns(
    progressReport,
    coverageDataAvailable,
    averagePercentage,
    coverageReportsForSubject
  );

  return {
    learnerId,
    subject,
    masteryLevel,
    confidence,
    evidence: {
      progress: progressReport,
      coverage: {
        dataAvailable: coverageDataAvailable,
        averagePercentage,
        reports: coverageReportsForSubject,
      },
      timeline: {
        eventCount: timelineEventCount,
      },
    },
    strengths,
    concerns,
  };
}

/**
 * Returns one MasteryReport per subject for which the learner has either
 * progress or coverage evidence (union of the two services' subjects).
 *
 * @param {number} learnerId
 * @param {{includeSuperseded?: boolean}} [options]
 * @returns {MasteryReport[]}
 */
function getLearnerMastery(learnerId, options = {}) {
  const timeline = learnerTimelineService.getLearnerTimeline(learnerId, options);
  const progressReports = progressService.getLearnerProgress(learnerId, options);
  const coverageReports = coverageService.getLearnerCoverage(learnerId, options);

  const subjects = new Set([
    ...progressReports.map((r) => r.subject),
    ...coverageReports.map((r) => r.subject),
  ]);

  const reports = [];
  for (const subject of subjects) {
    const progressReport = progressReports.find((r) => r.subject === subject) || emptyProgressReport(learnerId, subject);
    const coverageReportsForSubject = coverageReports.filter((r) => r.subject === subject);
    const timelineEventCount = timeline.filter((e) => (e.subject || 'unspecified') === subject).length;
    reports.push(buildReport(learnerId, subject, progressReport, coverageReportsForSubject, timelineEventCount));
  }

  // Deterministic order: alphabetical by subject (matches ProgressService).
  reports.sort((a, b) => a.subject.localeCompare(b.subject));

  return reports;
}

/**
 * Convenience accessor for a single subject's MasteryReport. Never returns
 * null/undefined — a subject with no evidence at all still returns an
 * "insufficient-data" report, so callers don't need a null check.
 *
 * @param {number} learnerId
 * @param {string} subject
 * @param {{includeSuperseded?: boolean}} [options]
 * @returns {MasteryReport}
 */
function getLearnerMasteryForSubject(learnerId, subject, options = {}) {
  const timeline = learnerTimelineService.getLearnerTimeline(learnerId, options);
  const progressReport = progressService.getLearnerProgressForSubject(learnerId, subject, options);
  const coverageReportsForSubject = coverageService
    .getLearnerCoverage(learnerId, options)
    .filter((r) => r.subject === subject);
  const timelineEventCount = timeline.filter((e) => (e.subject || 'unspecified') === subject).length;

  return buildReport(learnerId, subject, progressReport, coverageReportsForSubject, timelineEventCount);
}

module.exports = {
  getLearnerMastery,
  getLearnerMasteryForSubject,
  // Exported for unit testing as pure functions; not part of the public
  // contract for other services (same pattern as progressService.js and
  // coverageService.js).
  emptyProgressReport,
  determineMasteryLevel,
  computeConfidence,
  buildStrengthsAndConcerns,
  buildReport,
};
