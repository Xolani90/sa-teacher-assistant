'use strict';

/**
 * Class-level intervention rollup (ADR-009, PR11).
 *
 * Aggregates InterventionService.getLearnerInterventionPlan() once per
 * learner in a class roster into a single ClassInterventionPlan. Pure
 * aggregation — no repository/timeline/progress/coverage/mastery access
 * of its own:
 *
 *   Repository -> Timeline -> Progress/Coverage -> Mastery -> Intervention
 *                                                                 |
 *                                                                 v
 *                                                     ClassInterventionService
 *
 * See ADR-009 for the full contract this implements.
 */

// Required as whole modules (not destructured) so tests can monkey-patch
// learnerRosterService.getRoster / interventionService.getLearnerInterventionPlan
// directly — the same convention interventionService.js itself uses for
// masteryService, and the reason a destructured `const { getRoster } = ...`
// would silently break test mocking (it captures the function reference at
// require-time, before any monkey-patch runs).
const learnerRosterService = require('./learnerRosterService');
const interventionService = require('./interventionService');

// ADR-009 §3.5: a single named constant, not inlined at call sites, so
// the threshold can be revisited without touching aggregation logic.
const COMMON_TOPIC_THRESHOLD = 0.5;

const PRIORITY_ORDER = { high: 3, medium: 2, low: 1 };

/**
 * ADR-009 §3.1: a subject plan is insufficient-data based on
 * evidence.mastery.masteryLevel, never on `priority` (which folds
 * insufficient-data into "medium" for presentation purposes).
 *
 * @param {import('./interventionService').InterventionPlan} plan
 * @returns {boolean}
 */
function isInsufficientData(plan) {
  return plan.evidence.mastery.masteryLevel === 'insufficient-data';
}

/**
 * ADR-009 §3.2: worst-subject-wins over the evaluated (non
 * insufficient-data) subject plans only.
 *
 * @param {import('./interventionService').InterventionPlan[]} evaluatedPlans
 * @returns {"high"|"medium"|"low"}
 */
function computeOverallPriority(evaluatedPlans) {
  return evaluatedPlans.reduce((worst, plan) => {
    if (!worst) return plan.priority;
    return PRIORITY_ORDER[plan.priority] > PRIORITY_ORDER[worst] ? plan.priority : worst;
  }, null);
}

/**
 * Builds a ClassInterventionPlan for a class roster (ADR-009).
 *
 * @param {string} phoneHash
 * @param {number} classId
 * @param {{includeSuperseded?: boolean}} [options] passed through to
 *   getLearnerInterventionPlan for each learner.
 * @returns {import('./classInterventionService').ClassInterventionPlan}
 */
function getClassInterventionPlan(phoneHash, classId, options = {}) {
  const roster = learnerRosterService.getRoster(phoneHash, classId);

  const summary = {
    totalLearners: roster.length,
    evaluatedLearners: 0,
    insufficientData: 0,
    erroredLearners: 0,
  };
  const priorityCounts = { high: 0, medium: 0, low: 0 };
  const priorityLearners = { high: [], medium: [], low: [] };
  const errors = [];

  // subject -> topic -> affectedLearners count, accumulated only from
  // evaluated subject plans (ADR-009 §3.5).
  const topicCounts = new Map();

  for (const learner of roster) {
    let subjectPlans;
    try {
      subjectPlans = interventionService.getLearnerInterventionPlan(learner.id, options);
    } catch (err) {
      summary.erroredLearners += 1;
      errors.push({ learnerId: learner.id, reason: err.message });
      continue;
    }

    const evaluatedPlans = subjectPlans.filter((plan) => !isInsufficientData(plan));

    if (evaluatedPlans.length === 0) {
      summary.insufficientData += 1;
      continue;
    }

    summary.evaluatedLearners += 1;
    const overallPriority = computeOverallPriority(evaluatedPlans);
    priorityCounts[overallPriority] += 1;
    priorityLearners[overallPriority].push({
      learnerId: learner.id,
      learnerName: learner.name,
      overallPriority,
      subjectPlans,
    });

    for (const plan of evaluatedPlans) {
      if (!plan.focusTopics || plan.focusTopics.length === 0) continue;
      if (!topicCounts.has(plan.subject)) topicCounts.set(plan.subject, new Map());
      const subjectTopics = topicCounts.get(plan.subject);
      for (const topic of plan.focusTopics) {
        subjectTopics.set(topic, (subjectTopics.get(topic) || 0) + 1);
      }
    }
  }

  // ADR-009 §3.3: High -> Medium -> Low, alphabetical by learnerName
  // within each bucket.
  for (const bucket of ['high', 'medium', 'low']) {
    priorityLearners[bucket].sort((a, b) => a.learnerName.localeCompare(b.learnerName));
  }

  const commonFocusTopics = [];
  for (const [subject, topics] of topicCounts) {
    for (const [topic, affectedLearners] of topics) {
      const percentage = summary.evaluatedLearners > 0
        ? affectedLearners / summary.evaluatedLearners
        : 0;
      if (percentage >= COMMON_TOPIC_THRESHOLD) {
        commonFocusTopics.push({ subject, topic, affectedLearners, percentage });
      }
    }
  }

  return {
    classId,
    summary,
    priorityCounts,
    commonFocusTopics,
    priorityLearners,
    errors,
  };
}

module.exports = {
  getClassInterventionPlan,
  // Exported for unit testing as pure functions; not part of the public
  // contract for other services (same pattern as interventionService.js).
  isInsufficientData,
  computeOverallPriority,
  COMMON_TOPIC_THRESHOLD,
};
