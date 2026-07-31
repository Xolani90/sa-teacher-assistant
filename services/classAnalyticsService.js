'use strict';

/**
 * Class Analytics Snapshot (ADR-013).
 *
 * Aggregates ProgressService/CoverageService/MasteryService once per
 * learner in a class roster into a single ClassAnalyticsSnapshot.
 * Sibling to classInterventionService.js (ADR-009) — neither calls the
 * other, and this service never reads InterventionPlan/priority.
 *
 * IMPORTANT — ASSUMPTIONS NOT FIXED BY ADR-013 (flag if wrong):
 *
 *   1. averageMastery: MasteryReport.masteryLevel is categorical
 *      ("beginning"/"developing"/"secure"/"advanced"/"insufficient-data"),
 *      not a numeric score. ADR-013 needs a numeric classSummary.averageMastery,
 *      so this module maps levels to MASTERY_LEVEL_SCORE below purely for
 *      averaging. This mapping is NOT specified anywhere in ADR-007/013 —
 *      confirm the scale (currently 25/50/75/100) matches product intent.
 *   2. Progress distribution buckets = ProgressReport.trend verbatim
 *      ("insufficient-data"/"rising"/"falling"/"flat") — the only
 *      categorical field ProgressReport exposes.
 *   3. Coverage distribution buckets: CoverageReport has no existing
 *      "level" field (only a raw coveragePercentage), so this reuses
 *      MasteryService's own LOW_COVERAGE_THRESHOLD/HIGH_COVERAGE_THRESHOLD
 *      (40/70) to bucket into insufficient-data/low/developing/high,
 *      mirroring how InterventionService reuses the same constant rather
 *      than inventing a new one.
 *   4. Multi-subject default (no options.subject): a learner may have
 *      several subjects. classSummary needs ONE number per learner per
 *      metric, so this module averages a learner's own subjects first,
 *      then averages across learners. Coverage per learner is averaged
 *      only over that learner's dataAvailable CoverageReports (there may
 *      be several grade/term groups per subject).
 */

const learnerRosterService = require('./learnerRosterService');
const progressService = require('./progressService');
const coverageService = require('./coverageService');
const masteryService = require('./masteryService');

// See assumption #1 above.
const MASTERY_LEVEL_SCORE = { beginning: 25, developing: 50, secure: 75, advanced: 100 };

// Reused from masteryService's own thresholds (see assumption #3), not
// inlined at each call site, matching the COMMON_TOPIC_THRESHOLD
// convention in classInterventionService.js.
const LOW_COVERAGE_THRESHOLD = 40;
const HIGH_COVERAGE_THRESHOLD = 70;

function average(numbers) {
  if (!numbers || numbers.length === 0) return null;
  return numbers.reduce((a, b) => a + b, 0) / numbers.length;
}

function filterBySubject(reports, subject) {
  if (!subject) return reports;
  return reports.filter((r) => r.subject === subject);
}

/**
 * Buckets a single coverage percentage into a distribution key,
 * reusing masteryService's thresholds (assumption #3). `null`
 * (no dataAvailable coverage at all) maps to "insufficient-data".
 *
 * @param {?number} averagePercentage
 * @returns {"insufficient-data"|"low"|"developing"|"high"}
 */
function coverageBucket(averagePercentage) {
  if (averagePercentage == null) return 'insufficient-data';
  if (averagePercentage < LOW_COVERAGE_THRESHOLD) return 'low';
  if (averagePercentage < HIGH_COVERAGE_THRESHOLD) return 'developing';
  return 'high';
}

/**
 * Builds a ClassAnalyticsSnapshot for a class roster (ADR-013).
 *
 * @param {string} phoneHash
 * @param {number} classId
 * @param {{subject?: string}} [options]
 * @returns {import('./classAnalyticsService').ClassAnalyticsSnapshot}
 */
function getClassAnalytics(phoneHash, classId, options = {}) {
  const subject = options.subject || null;
  const roster = learnerRosterService.getRoster(phoneHash, classId);

  const progressValues = [];
  const coverageValues = [];
  const masteryValues = [];

  const distributions = {
    mastery: { 'insufficient-data': 0, beginning: 0, developing: 0, secure: 0, advanced: 0 },
    coverage: { 'insufficient-data': 0, low: 0, developing: 0, high: 0 },
    progress: { 'insufficient-data': 0, rising: 0, falling: 0, flat: 0 },
  };

  const attentionRequiredIds = [];
  const errors = [];

  // subject -> { sum, count } across evaluated (dataAvailable/non-insufficient)
  // learners, for §3.2's byLearner/byLearnerCount used in strongest/weakest
  // area comparison.
  const bySubjectAccum = new Map();

  const byLearner = [];

  for (const learner of roster) {
    let progressReports;
    let coverageReports;
    let masteryReports;
    try {
      progressReports = filterBySubject(progressService.getLearnerProgress(learner.id), subject);
      coverageReports = filterBySubject(coverageService.getLearnerCoverage(learner.id), subject);
      masteryReports = filterBySubject(masteryService.getLearnerMastery(learner.id), subject);
    } catch (err) {
      errors.push({ learnerId: learner.id, reason: err.message });
      continue;
    }

    // --- Progress: average this learner's per-subject averagePercentage,
    // excluding subjects marked trend === "insufficient-data" (a single
    // data point still carries a numeric averagePercentage, but ADR-013
    // §3.2 treats "insufficient-data" subjects as excluded from averages
    // and counted in distributions instead — same rule mastery/coverage
    // already apply on their own insufficient-data signal. A trend-based
    // exclusion (not just != null) keeps classSummary.averageProgress
    // consistent with distributions.progress rather than contradicting it.
    const learnerProgressVals = progressReports
      .filter((r) => r.trend !== 'insufficient-data')
      .map((r) => r.averagePercentage)
      .filter((v) => v != null);
    const learnerProgressAvg = average(learnerProgressVals);
    if (learnerProgressAvg != null) progressValues.push(learnerProgressAvg);

    // Progress distribution: bucket by each subject's own trend (a
    // learner with multiple subjects can land in multiple buckets here —
    // this is a per-subject-observation distribution, not per-learner).
    for (const r of progressReports) {
      distributions.progress[r.trend] = (distributions.progress[r.trend] || 0) + 1;
    }

    // --- Coverage: average this learner's dataAvailable CoverageReports.
    const learnerCoverageVals = coverageReports
      .filter((r) => r.dataAvailable)
      .map((r) => r.coveragePercentage);
    const learnerCoverageAvg = average(learnerCoverageVals);
    if (learnerCoverageAvg != null) coverageValues.push(learnerCoverageAvg);
    distributions.coverage[coverageBucket(learnerCoverageAvg)] += 1;

    // --- Mastery: average this learner's evaluated (non insufficient-data)
    // subjects, mapped through MASTERY_LEVEL_SCORE (assumption #1).
    const evaluatedMastery = masteryReports.filter((m) => m.masteryLevel !== 'insufficient-data');
    const learnerMasteryVals = evaluatedMastery.map((m) => MASTERY_LEVEL_SCORE[m.masteryLevel]);
    const learnerMasteryAvg = average(learnerMasteryVals);
    if (learnerMasteryAvg != null) masteryValues.push(learnerMasteryAvg);

    for (const m of masteryReports) {
      distributions.mastery[m.masteryLevel] = (distributions.mastery[m.masteryLevel] || 0) + 1;
    }

    // highlights.attentionRequired: ALL subjects in scope are
    // insufficient-data for this learner (ADR-013 §3.2).
    if (masteryReports.length > 0 && evaluatedMastery.length === 0) {
      attentionRequiredIds.push(learner.id);
    }

    // Per-subject accumulation for strongest/weakest area (§3.2), using
    // each subject's own mastery percentage (evaluated subjects only).
    for (const m of evaluatedMastery) {
      if (!bySubjectAccum.has(m.subject)) {
        bySubjectAccum.set(m.subject, { sum: 0, count: 0, progressSum: 0, progressCount: 0, coverageSum: 0, coverageCount: 0 });
      }
      const acc = bySubjectAccum.get(m.subject);
      acc.sum += MASTERY_LEVEL_SCORE[m.masteryLevel];
      acc.count += 1;
    }
    for (const r of progressReports) {
      if (r.trend === 'insufficient-data' || r.averagePercentage == null) continue;
      if (!bySubjectAccum.has(r.subject)) {
        bySubjectAccum.set(r.subject, { sum: 0, count: 0, progressSum: 0, progressCount: 0, coverageSum: 0, coverageCount: 0 });
      }
      const acc = bySubjectAccum.get(r.subject);
      acc.progressSum += r.averagePercentage;
      acc.progressCount += 1;
    }
    for (const r of coverageReports) {
      if (!r.dataAvailable) continue;
      if (!bySubjectAccum.has(r.subject)) {
        bySubjectAccum.set(r.subject, { sum: 0, count: 0, progressSum: 0, progressCount: 0, coverageSum: 0, coverageCount: 0 });
      }
      const acc = bySubjectAccum.get(r.subject);
      acc.coverageSum += r.coveragePercentage;
      acc.coverageCount += 1;
    }

    byLearner.push({
      learnerId: learner.id,
      learnerName: learner.name,
      progress: progressReports,
      coverage: coverageReports,
      mastery: masteryReports,
    });
  }

  const bySubject = [...bySubjectAccum.entries()].map(([subj, acc]) => ({
    subject: subj,
    learnerCount: acc.count,
    averageProgress: acc.progressCount > 0 ? acc.progressSum / acc.progressCount : null,
    averageCoverage: acc.coverageCount > 0 ? acc.coverageSum / acc.coverageCount : null,
    averageMastery: acc.count > 0 ? acc.sum / acc.count : null,
  }));

  // highlights.strongestArea/weakestArea: compare subjects with >=1
  // evaluated learner only (ADR-013 §3.2) — a subject with zero
  // evaluated learners is excluded, not treated as zero.
  const comparable = bySubject.filter((s) => s.averageMastery != null);
  let strongestArea = null;
  let weakestArea = null;
  if (comparable.length > 0) {
    const strongest = comparable.reduce((a, b) => (b.averageMastery > a.averageMastery ? b : a));
    const weakest = comparable.reduce((a, b) => (b.averageMastery < a.averageMastery ? b : a));
    strongestArea = { subject: strongest.subject, averageMasteryPercentage: strongest.averageMastery };
    weakestArea = { subject: weakest.subject, averageMasteryPercentage: weakest.averageMastery };
  }

  return {
    classId,
    subject,
    classSummary: {
      learnerCount: roster.length,
      averageProgress: average(progressValues),
      averageCoverage: average(coverageValues),
      averageMastery: average(masteryValues),
    },
    distributions,
    highlights: {
      strongestArea,
      weakestArea,
      attentionRequired: { count: attentionRequiredIds.length, learnerIds: attentionRequiredIds },
    },
    breakdowns: {
      byLearner,
      bySubject,
    },
    errors,
  };
}

module.exports = {
  getClassAnalytics,
  // Exported for unit testing as pure functions.
  average,
  coverageBucket,
  MASTERY_LEVEL_SCORE,
  LOW_COVERAGE_THRESHOLD,
  HIGH_COVERAGE_THRESHOLD,
};
