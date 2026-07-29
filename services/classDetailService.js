'use strict';

/**
 * Class Detail aggregation service (ADR-008 dashboard track — "Class
 * Detail" per PROJECT_STATUS.md).
 *
 * Powers the teacher-command-center view of a single class: composes
 * five existing, already-shipped reads into one payload so the
 * dashboard's ClassDetail page can render everything (summary, health,
 * recent assessments, curriculum coverage, roster, interventions,
 * observations) from a single request instead of five round trips.
 *
 * Per the layering rule in docs/ARCHITECTURE.md this module performs NO
 * SQL of its own and no mastery/progress/coverage/intervention
 * calculation — it only composes and re-shapes the outputs of:
 *
 *   - services/teacherWorkspaceService.js  getClass()            (PR? scaffolding)
 *   - services/learnerRosterService.js     getRoster()           (PR2.5/PR3)
 *   - services/learnerRepository.js        getClassHistory()     (ADR-003)
 *   - services/curriculumCoverageService.js analyzeCoverage()    (coverage)
 *   - services/classInterventionService.js getClassInterventionPlan() (ADR-009)
 *
 * The only new logic here is presentation-level aggregation (a class
 * average, a pass rate, an at-risk count, "recent" de-duplication) —
 * all pure functions, exported below for unit testing without a
 * database (same convention as services/classInterventionService.js's
 * exported classifyLearner/aggregateSummary/etc).
 */

const { getClass } = require('./teacherWorkspaceService');
const { getRoster } = require('./learnerRosterService');
const { getClassHistory } = require('./learnerRepository');
const { analyzeCoverage } = require('./curriculumCoverageService');
const { getClassInterventionPlan } = require('./classInterventionService');

// Matches services/pdfService.js's existing pass-rate convention
// (`analytics.learners.filter((l) => l.percentage >= 50)`) — kept as a
// named constant here rather than re-inlining the magic number.
const PASS_THRESHOLD = 50;

// How many recent assessments / observations the summary view surfaces.
// The full history is still reachable through the existing per-learner
// and per-class endpoints; this is a "command center" digest, not a log.
const RECENT_LIMIT = 5;

/**
 * Groups a class's learner_results rows (from getClassHistory) by
 * learner and computes each roster member's average percentage across
 * every assessment on record for the class.
 *
 * A roster member with zero assessment rows gets `average: null` and
 * `passing: null` — "no data yet" is a distinct state from "failing",
 * and callers must not conflate the two (this mirrors
 * classInterventionService.js's insufficient-data handling one level
 * up).
 *
 * @param {Array<{id:number,name:string}>} roster
 * @param {Array<{learnerId:number, percentage:number}>} assessmentRows
 * @returns {Array<{learnerId:number, learnerName:string, average:number|null, assessmentCount:number, passing:boolean|null}>}
 */
function computeLearnerAverages(roster, assessmentRows) {
  const byLearner = new Map();
  for (const row of assessmentRows) {
    if (!byLearner.has(row.learnerId)) byLearner.set(row.learnerId, []);
    byLearner.get(row.learnerId).push(row.percentage);
  }

  return roster.map((learner) => {
    const percentages = byLearner.get(learner.id) || [];
    if (percentages.length === 0) {
      return {
        learnerId: learner.id,
        learnerName: learner.name,
        average: null,
        assessmentCount: 0,
        passing: null,
      };
    }
    const average = percentages.reduce((sum, p) => sum + p, 0) / percentages.length;
    return {
      learnerId: learner.id,
      learnerName: learner.name,
      average: Math.round(average * 10) / 10,
      assessmentCount: percentages.length,
      passing: average >= PASS_THRESHOLD,
    };
  });
}

/**
 * Rolls up per-learner averages plus the class's existing intervention
 * plan (services/classInterventionService.js) into the four "Class
 * Health" numbers a teacher sees at the top of the command center.
 *
 * `activeInterventions` counts learners in the intervention plan's high
 * or medium priority buckets — i.e. learners the plan says need active
 * attention now, as distinct from `low` (monitor) or insufficient-data
 * (no evidence yet). This is an interpretation of "Interventions:
 * N Active" made at the presentation layer, not a new rule
 * ClassInterventionService itself computes.
 *
 * @param {Array<ReturnType<typeof computeLearnerAverages>[number]>} learnerAverages
 * @param {import('./classInterventionService').ClassInterventionPlan} interventionPlan
 * @returns {{average:number|null, passRate:number|null, atRisk:number, dataAvailable:number, activeInterventions:number}}
 */
function computeClassHealth(learnerAverages, interventionPlan) {
  const withData = learnerAverages.filter((l) => l.average !== null);
  const average = withData.length > 0
    ? Math.round((withData.reduce((sum, l) => sum + l.average, 0) / withData.length) * 10) / 10
    : null;
  const passing = withData.filter((l) => l.passing).length;
  const passRate = withData.length > 0 ? Math.round((passing / withData.length) * 100) : null;
  const atRisk = withData.filter((l) => !l.passing).length;

  const activeInterventions =
    (interventionPlan?.priorityCounts?.high || 0) + (interventionPlan?.priorityCounts?.medium || 0);

  return {
    average,
    passRate,
    atRisk,
    dataAvailable: withData.length,
    activeInterventions,
  };
}

/**
 * De-duplicates getClassHistory()'s flat, one-row-per-learner-result
 * assessment rows down to one entry per assessment (with a class
 * average computed across whichever roster members have a result for
 * it), newest first, capped at `limit`.
 *
 * @param {Array<{assessmentId:number, title:string, subject:string, term:number, assessmentType:string, createdAt:string, percentage:number}>} assessmentRows
 * @param {number} [limit]
 * @returns {Array<{assessmentId:number, title:string, subject:string, term:number, assessmentType:string, createdAt:string, classAverage:number, learnerCount:number}>}
 */
function summarizeRecentAssessments(assessmentRows, limit = RECENT_LIMIT) {
  const byAssessment = new Map();
  for (const row of assessmentRows) {
    if (!byAssessment.has(row.assessmentId)) {
      byAssessment.set(row.assessmentId, {
        assessmentId: row.assessmentId,
        title: row.title,
        subject: row.subject,
        term: row.term,
        assessmentType: row.assessmentType,
        createdAt: row.createdAt,
        percentages: [],
      });
    }
    byAssessment.get(row.assessmentId).percentages.push(row.percentage);
  }

  const summaries = Array.from(byAssessment.values())
    .map(({ percentages, ...rest }) => ({
      ...rest,
      classAverage: Math.round((percentages.reduce((s, p) => s + p, 0) / percentages.length) * 10) / 10,
      learnerCount: percentages.length,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.assessmentId - a.assessmentId));

  return summaries.slice(0, limit);
}

/**
 * Reduces curriculumCoverageService.analyzeCoverage()'s full
 * (per-term) breakdown to the two figures the command-center card
 * needs: the overall percentage already computed by that service, and
 * a flat, de-duplicated list of outstanding topics across every term
 * analyzed (analyzeCoverage was called with no `term`, so this spans
 * all four terms).
 *
 * @param {ReturnType<typeof analyzeCoverage>} coverageResult
 * @returns {{percentage:number, remainingTopics:string[], dataAvailable:boolean}}
 */
function summarizeCurriculumCoverage(coverageResult) {
  const remainingTopics = Array.from(
    new Set(coverageResult.termResults.flatMap((t) => t.outstandingTopicList))
  );
  return {
    percentage: coverageResult.overallCoverage,
    remainingTopics,
    dataAvailable: coverageResult.dataAvailable,
  };
}

/**
 * Reduces getClassHistory()'s flat observation rows to the recent-first
 * digest the command center shows, capped at `limit`. Unlike
 * assessments, an observation record IS already one row per
 * (assessment, learner) — there is no further de-duplication needed
 * beyond what a teacher would consider "one observation session", so
 * this groups by assessmentId the same way summarizeRecentAssessments
 * does, for the same "one card per session" presentation reason.
 *
 * @param {Array<{assessmentId:number, title:string, subject:string, domain:string|null, createdAt:string}>} observationRows
 * @param {number} [limit]
 * @returns {Array<{assessmentId:number, title:string, subject:string, createdAt:string, learnerCount:number}>}
 */
function summarizeRecentObservations(observationRows, limit = RECENT_LIMIT) {
  const byAssessment = new Map();
  for (const row of observationRows) {
    if (!byAssessment.has(row.assessmentId)) {
      byAssessment.set(row.assessmentId, {
        assessmentId: row.assessmentId,
        title: row.title,
        subject: row.subject,
        createdAt: row.createdAt,
        learnerIds: new Set(),
      });
    }
    byAssessment.get(row.assessmentId).learnerIds.add(row.learnerId);
  }

  const summaries = Array.from(byAssessment.values())
    .map(({ learnerIds, ...rest }) => ({ ...rest, learnerCount: learnerIds.size }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.assessmentId - a.assessmentId));

  return summaries.slice(0, limit);
}

/**
 * Assembles the full Class Detail payload for one class.
 *
 * @param {string} phoneHash - Teacher's phone hash (authorization scope
 *   — getClass() only returns a row when it belongs to this teacher, so
 *   a wrong/foreign classId falls through to the null branch below
 *   exactly like every other route in routes/api.js's ownership model).
 * @param {number} classId
 * @returns {Object|null} null if the class doesn't exist or belongs to
 *   another teacher; otherwise the full aggregated view.
 */
function getClassDetail(phoneHash, classId) {
  const classData = getClass(classId, phoneHash);
  if (!classData) return null;

  const roster = getRoster(phoneHash, classId);
  const { assessments, observations } = getClassHistory(classId);
  const coverageResult = analyzeCoverage(phoneHash, classData.grade, classData.subject);
  const interventionPlan = getClassInterventionPlan(phoneHash, classId);

  const learnerAverages = computeLearnerAverages(roster, assessments);
  const classHealth = computeClassHealth(learnerAverages, interventionPlan);

  return {
    class: {
      id: classData.id,
      name: classData.name,
      grade: classData.grade,
      subject: classData.subject,
      learnerCount: classData.learner_count,
      createdAt: classData.created_at,
      updatedAt: classData.updated_at,
    },
    classHealth,
    recentAssessments: summarizeRecentAssessments(assessments),
    curriculumCoverage: summarizeCurriculumCoverage(coverageResult),
    learners: learnerAverages.slice().sort((a, b) => a.learnerName.localeCompare(b.learnerName)),
    interventions: {
      summary: interventionPlan.summary,
      priorityCounts: interventionPlan.priorityCounts,
      priorityLearners: interventionPlan.priorityLearners,
    },
    observations: {
      recent: summarizeRecentObservations(observations),
      totalSessions: new Set(observations.map((o) => o.assessmentId)).size,
    },
  };
}

module.exports = {
  getClassDetail,
  // Exported for unit testing as pure functions — same pattern as
  // services/classInterventionService.js's exports.
  computeLearnerAverages,
  computeClassHealth,
  summarizeRecentAssessments,
  summarizeCurriculumCoverage,
  summarizeRecentObservations,
  PASS_THRESHOLD,
};
