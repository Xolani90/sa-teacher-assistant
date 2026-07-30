'use strict';

/**
 * Learner Detail aggregation service — learner-scoped counterpart to
 * classDetailService.js. Composes existing, already-shipped reads into
 * one payload so the dashboard's LearnerDetail page can render a full
 * learner profile from a single request.
 *
 * Per the layering rule in docs/ARCHITECTURE.md this module performs NO
 * SQL of its own and no mastery/progress/coverage/intervention
 * calculation — it only composes and re-shapes the outputs of:
 *
 *   - services/learnerRepository.js   getLearnerById()
 *   - services/learnerRepository.js   getAssessmentHistory()
 *   - services/learnerRepository.js   getObservationHistory()
 *   - services/teacherWorkspaceService.js getClass()   (class name lookup)
 *   - services/masteryService.js      getLearnerMastery()
 *   - services/interventionService.js getLearnerInterventionPlan()
 *
 * Reuses classDetailService.js's summarizeRecentObservations() for the
 * observations digest rather than re-deriving the same "one card per
 * session" grouping a second time.
 */

const { getLearnerById, getAssessmentHistory, getObservationHistory } = require('./learnerRepository');
const { getClass } = require('./teacherWorkspaceService');
const masteryService = require('./masteryService');
const { getLearnerInterventionPlan } = require('./interventionService');
const { summarizeRecentObservations, PASS_THRESHOLD } = require('./classDetailService');

const RECENT_LIMIT = 5;

/**
 * Rolls up a learner's assessment history into overall average / pass
 * rate. Same PASS_THRESHOLD convention as classDetailService.js.
 *
 * @param {Array<{percentage:number}>} assessmentHistory
 * @returns {{overallAverage:number|null, passRate:number|null}}
 */
function computeOverallPerformance(assessmentHistory) {
  if (assessmentHistory.length === 0) return { overallAverage: null, passRate: null };

  const percentages = assessmentHistory.map((a) => a.percentage);
  const overallAverage =
    Math.round((percentages.reduce((sum, p) => sum + p, 0) / percentages.length) * 10) / 10;
  const passing = percentages.filter((p) => p >= PASS_THRESHOLD).length;
  const passRate = Math.round((passing / percentages.length) * 100);

  return { overallAverage, passRate };
}

/**
 * Derives one overall trend label from per-subject MasteryReports'
 * progress trends. A learner can be "rising" in one subject and
 * "falling" in another — this is a presentation-level simplification
 * for the KPI card, not a new trend calculation (each subject's own
 * trend is still visible via curriculumCoverage/interventions below).
 * Rule: any falling subject wins (flags risk first), else any rising
 * subject wins, else stable/insufficient-data.
 *
 * @param {import('./masteryService').MasteryReport[]} masteryReports
 * @returns {"improving"|"declining"|"stable"|"insufficient-data"}
 */
function computeOverallTrend(masteryReports) {
  const trends = masteryReports.map((r) => r.evidence.progress.trend);
  if (trends.length === 0) return 'insufficient-data';
  if (trends.includes('falling')) return 'declining';
  if (trends.includes('rising')) return 'improving';
  if (trends.every((t) => t === 'insufficient-data')) return 'insufficient-data';
  return 'stable';
}

/**
 * Reshapes MasteryReports into the per-subject coverage list the
 * learner page's CAPS Coverage card needs — no new coverage
 * calculation, just picking the fields already computed by
 * MasteryService.
 *
 * @param {import('./masteryService').MasteryReport[]} masteryReports
 * @returns {{bySubject: Array<{subject:string, dataAvailable:boolean, averagePercentage:number|null}>, dataAvailable:boolean}}
 */
function summarizeCurriculumCoverage(masteryReports) {
  const bySubject = masteryReports.map((r) => ({
    subject: r.subject,
    dataAvailable: r.evidence.coverage.dataAvailable,
    averagePercentage: r.evidence.coverage.averagePercentage,
  }));
  return {
    bySubject,
    dataAvailable: bySubject.some((s) => s.dataAvailable),
  };
}

/**
 * Flattens InterventionPlan[] recommendedActions into one deduplicated
 * list for the top-level "Recommended Actions" card — same evidence
 * interventions.plans already carries, just surfaced without requiring
 * the caller to walk each subject's plan individually.
 *
 * @param {import('./interventionService').InterventionPlan[]} plans
 * @returns {string[]}
 */
function flattenRecommendedActions(plans) {
  const seen = new Set();
  const actions = [];
  for (const plan of plans) {
    for (const action of plan.recommendedActions) {
      if (!seen.has(action)) {
        seen.add(action);
        actions.push(action);
      }
    }
  }
  return actions;
}

/**
 * Assembles the full Learner Detail payload for one learner.
 *
 * @param {string} phoneHash - Teacher's phone hash (authorization scope
 *   — getLearnerById() returns the learner regardless of owner, so
 *   ownership is enforced here by comparing learner.phoneHash, the same
 *   convention routes/api.js's existing intervention-plan route uses).
 * @param {number} learnerId
 * @returns {Object|null} null if the learner doesn't exist or belongs
 *   to another teacher; otherwise the full aggregated view.
 */
function getLearnerDetail(phoneHash, learnerId) {
  const learner = getLearnerById(learnerId);
  if (!learner || learner.phoneHash !== phoneHash) return null;

  const classData = learner.classId ? getClass(learner.classId, phoneHash) : null;

  const assessmentHistory = getAssessmentHistory(learnerId);
  const observationHistory = getObservationHistory(learnerId);
  const masteryReports = masteryService.getLearnerMastery(learnerId);
  const interventionPlans = getLearnerInterventionPlan(learnerId);

  return {
    learner: {
      id: learner.id,
      name: learner.canonicalName,
      classId: learner.classId,
      className: classData ? classData.name : null,
      grade: classData ? classData.grade : null,
    },
    performance: {
      ...computeOverallPerformance(assessmentHistory),
      trend: computeOverallTrend(masteryReports),
    },
    assessmentHistory: assessmentHistory.slice(0, RECENT_LIMIT),
    curriculumCoverage: summarizeCurriculumCoverage(masteryReports),
    interventions: {
      plans: interventionPlans,
    },
    observations: {
      recent: summarizeRecentObservations(observationHistory, RECENT_LIMIT),
      totalSessions: new Set(observationHistory.map((o) => o.assessmentId)).size,
    },
    recommendedActions: flattenRecommendedActions(interventionPlans),
  };
}

module.exports = {
  getLearnerDetail,
  computeOverallPerformance,
  computeOverallTrend,
  summarizeCurriculumCoverage,
  flattenRecommendedActions,
};
