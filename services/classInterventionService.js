'use strict';

/**
 * Class Intervention Rollup service (ADR-009, PR11).
 *
 * Composes InterventionService.getLearnerInterventionPlan() once per
 * learner in a class roster and aggregates the per-subject
 * InterventionPlan[] results into a single class-level view. Composition
 * only — issues no SQL of its own beyond reading the roster, and performs
 * no new mastery/progress/coverage/intervention calculations. Every
 * aggregation rule here is frozen by ADR-009; this file should not
 * introduce a rule that document doesn't already describe.
 *
 * Dependency chain (per ADR-009 §3, unchanged from ADR-007):
 *   Repository -> Timeline -> Progress/Coverage -> Mastery -> Intervention
 *                                                                 |
 *                                                                 v
 *                                                 ClassInterventionService
 *
 * No shortcuts upward or downward — this module's only service
 * dependency is InterventionService (plus the roster read, which is a
 * repository-level concern already owned by learnerRosterService).
 */

const rosterService = require('./learnerRosterService');
const interventionService = require('./interventionService');

// ADR-009 §3.5 — flat constant, not inlined at each call site, so it can
// be revisited later without touching aggregation logic.
const COMMON_TOPIC_THRESHOLD = 0.5;

const PRIORITY_RANK = { high: 3, medium: 2, low: 1 };

/**
 * ADR-009 §3.1 — a subject plan is insufficient-data if and only if its
 * underlying mastery level says so. `priority` is never used to infer
 * this: InterventionService intentionally maps
 * masteryLevel === "insufficient-data" to priority "medium" so a teacher
 * still gets an actionable next step per subject.
 *
 * @param {import('./interventionService').InterventionPlan} plan
 * @returns {boolean}
 */
function isInsufficientData(plan) {
  return plan.evidence.mastery.masteryLevel === 'insufficient-data';
}

/**
 * ADR-009 §3.2 — worst-subject-wins overall priority, computed only over
 * evaluated (non-insufficient-data) subject plans.
 *
 * @param {import('./interventionService').InterventionPlan[]} subjectPlans
 * @returns {"high"|"medium"|"low"|null} null when every subject plan is
 *   insufficient-data (the learner has nothing to rank).
 */
function computeOverallPriority(subjectPlans) {
  const evaluated = subjectPlans.filter((p) => !isInsufficientData(p));
  if (evaluated.length === 0) return null;
  return evaluated.reduce((worst, p) => (
    PRIORITY_RANK[p.priority] > PRIORITY_RANK[worst] ? p.priority : worst
  ), 'low');
}

/**
 * ADR-009 §3.4 — classifies one learner's full subjectPlans[] into
 * exactly one outcome: evaluated (with an overall priority), or
 * insufficient-data. Pure function — no aggregation state.
 *
 * @param {number} learnerId
 * @param {string} learnerName
 * @param {import('./interventionService').InterventionPlan[]} subjectPlans
 * @returns {{ learnerId: number, learnerName: string, overallPriority: (string|null), subjectPlans: Array }}
 */
function classifyLearner(learnerId, learnerName, subjectPlans) {
  return {
    learnerId,
    learnerName,
    overallPriority: computeOverallPriority(subjectPlans),
    subjectPlans,
  };
}

/**
 * ADR-009 §3.3 — buckets classified learners into priorityLearners,
 * ordered High -> Medium -> Low, alphabetically by learnerName within
 * each bucket. Learners with overallPriority === null (insufficient-data)
 * are not placed in any bucket.
 *
 * @param {Array<ReturnType<typeof classifyLearner>>} classifiedLearners
 * @returns {{ high: Array, medium: Array, low: Array }}
 */
function aggregatePriorityLearners(classifiedLearners) {
  const buckets = { high: [], medium: [], low: [] };
  for (const learner of classifiedLearners) {
    if (learner.overallPriority) {
      buckets[learner.overallPriority].push(learner);
    }
  }
  const byName = (a, b) => a.learnerName.localeCompare(b.learnerName);
  buckets.high.sort(byName);
  buckets.medium.sort(byName);
  buckets.low.sort(byName);
  return buckets;
}

/**
 * ADR-009 §3.4 — summary counts. A learner lands in exactly one of
 * evaluatedLearners (reflected via priorityCounts), insufficientData, or
 * erroredLearners.
 *
 * @param {Array<ReturnType<typeof classifyLearner>>} classifiedLearners
 * @param {number} erroredCount
 * @param {number} totalLearners
 * @returns {{ summary: Object, priorityCounts: Object }}
 */
function aggregateSummary(classifiedLearners, erroredCount, totalLearners) {
  const evaluatedLearners = classifiedLearners.filter((l) => l.overallPriority !== null).length;
  const insufficientData = classifiedLearners.filter((l) => l.overallPriority === null).length;

  const priorityCounts = { high: 0, medium: 0, low: 0 };
  for (const learner of classifiedLearners) {
    if (learner.overallPriority) priorityCounts[learner.overallPriority]++;
  }

  return {
    summary: { totalLearners, evaluatedLearners, insufficientData, erroredLearners: erroredCount },
    priorityCounts,
  };
}

/**
 * ADR-009 §3.5 — common focus topics, aggregated only from evaluated
 * (non-insufficient-data) subject plans across the whole class. A topic
 * is included when its affected-learner ratio for that subject meets
 * COMMON_TOPIC_THRESHOLD. Denominator is evaluatedLearners for that
 * subject (learners with at least one evaluated plan for that subject),
 * matching ADR-009's "percentage of evaluated learners" definition.
 *
 * @param {Array<ReturnType<typeof classifyLearner>>} classifiedLearners
 * @returns {Array<{ subject: string, topic: string, affectedLearners: number, percentage: number }>}
 */
function aggregateCommonTopics(classifiedLearners) {
  // subject -> { evaluatedLearnerIds: Set, topicCounts: Map<topic, Set<learnerId>> }
  const bySubject = new Map();

  for (const learner of classifiedLearners) {
    for (const plan of learner.subjectPlans) {
      if (isInsufficientData(plan)) continue;
      if (!bySubject.has(plan.subject)) {
        bySubject.set(plan.subject, { evaluatedLearnerIds: new Set(), topicCounts: new Map() });
      }
      const entry = bySubject.get(plan.subject);
      entry.evaluatedLearnerIds.add(learner.learnerId);
      for (const topic of plan.focusTopics) {
        if (!entry.topicCounts.has(topic)) entry.topicCounts.set(topic, new Set());
        entry.topicCounts.get(topic).add(learner.learnerId);
      }
    }
  }

  const results = [];
  for (const [subject, { evaluatedLearnerIds, topicCounts }] of bySubject) {
    const evaluatedCount = evaluatedLearnerIds.size;
    if (evaluatedCount === 0) continue;
    for (const [topic, learnerIdSet] of topicCounts) {
      const affectedLearners = learnerIdSet.size;
      const percentage = affectedLearners / evaluatedCount;
      if (percentage >= COMMON_TOPIC_THRESHOLD) {
        results.push({ subject, topic, affectedLearners, percentage });
      }
    }
  }
  return results;
}

/**
 * ADR-009 §3.6 — sequential, per-learner fault-isolated composition of
 * InterventionService.getLearnerInterventionPlan(), aggregated into a
 * ClassInterventionPlan per the rules above.
 *
 * @param {string} phoneHash
 * @param {number} classId
 * @returns {import('./classInterventionService').ClassInterventionPlan}
 */
function getClassInterventionPlan(phoneHash, classId) {
  const roster = rosterService.getRoster(phoneHash, classId);
  const totalLearners = roster.length;

  const classifiedLearners = [];
  const errors = [];

  for (const learner of roster) {
    try {
      const subjectPlans = interventionService.getLearnerInterventionPlan(learner.id);
      classifiedLearners.push(classifyLearner(learner.id, learner.name, subjectPlans));
    } catch (err) {
      errors.push({ learnerId: learner.id, reason: err.message });
    }
  }

  const { summary, priorityCounts } = aggregateSummary(classifiedLearners, errors.length, totalLearners);
  const commonFocusTopics = aggregateCommonTopics(classifiedLearners);
  const priorityLearners = aggregatePriorityLearners(classifiedLearners);

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
  classifyLearner,
  aggregatePriorityLearners,
  aggregateSummary,
  aggregateCommonTopics,
  COMMON_TOPIC_THRESHOLD,
};
