'use strict';

/**
 * Intervention service (ADR-007, PR7).
 *
 * Combines MasteryService output (which itself already composes
 * ProgressService + CoverageService + learnerTimelineService) into a
 * per-subject actionable recommendation. Composition only — issues no
 * SQL/repository calls, builds no timeline of its own, recomputes no
 * trend/coverage/mastery math, and does not call AI.
 *
 * Per the roadmap agreed for PR7, this module deliberately does NOT:
 *   - query the database or construct its own TimelineEvent[] stream
 *   - recompute trends from raw events (that's ProgressService)
 *   - recompute CAPS coverage from raw events (that's CoverageService)
 *   - recompute mastery levels/confidence (that's MasteryService)
 *   - call AI — recommendedActions come from a fixed rule table so a
 *     future ADR can swap in AI-assisted narrative generation without
 *     changing InterventionPlan's shape or this service's dependency
 *     boundary (AI would consume InterventionPlan, not replace it)
 *
 * InterventionService answers "what should the teacher do next?", a
 * different question from MasteryService's "how is this learner doing?".
 * It sits directly above MasteryService in the dependency chain:
 *
 *   Timeline -> Progress/Coverage -> Mastery -> Intervention
 *
 * and no higher-level consumer (WhatsApp, PDF, dashboard) should reach
 * past InterventionService into Mastery/Progress/Coverage/Timeline
 * directly once InterventionService exists for a given use case.
 *
 * saveLearnerInterventionPlan() (below) is this module's first write
 * path — everything above it remains pure composition/read-only.
 */

const { getDb } = require('../utils/database');
const masteryService = require('./masteryService');

/**
 * @typedef {Object} InterventionPlan
 * @property {number} learnerId
 * @property {string} subject
 * @property {"low"|"medium"|"high"} priority
 * @property {string[]} focusTopics
 * Missing CAPS topics for the subject's most recent coverage group, if
 * any — sourced from MasteryReport.evidence.coverage.reports, not
 * recomputed.
 * @property {string[]} recommendedActions
 * Deterministic, rule-derived actions. Never empty — a subject with no
 * evidence at all still gets a "gather more evidence" action.
 * @property {Object} evidence
 * @property {import('./masteryService').MasteryReport} evidence.mastery
 * @property {import('./progressService').ProgressReport} evidence.progress
 * @property {Object} evidence.coverage
 * @property {boolean} evidence.coverage.dataAvailable
 * @property {?number} evidence.coverage.averagePercentage
 */

// Coverage-percentage band reused from MasteryService's own thresholds so
// the two services agree on what "low coverage" means without importing
// MasteryService's internals — InterventionService reads
// MasteryReport.evidence.coverage.averagePercentage, which was already
// computed by MasteryService, and only re-applies the same public
// threshold value for its own recommendation rules.
const LOW_COVERAGE_THRESHOLD = 40;

/**
 * Decides priority from the MasteryReport alone. Deliberately simple
 * per the PR7 brief — a fixed set of rules, not a scoring model.
 *
 * @param {import('./masteryService').MasteryReport} mastery
 * @returns {InterventionPlan["priority"]}
 */
function determinePriority(mastery) {
  if (mastery.masteryLevel === 'insufficient-data') return 'medium';
  if (mastery.masteryLevel === 'beginning') return 'high';
  if (mastery.evidence.progress.trend === 'falling') return 'high';
  if (mastery.masteryLevel === 'developing') return 'medium';
  return 'low'; // secure or advanced
}

/**
 * Extracts the missing-topics list for a subject's most recent coverage
 * group, mirroring the "most recent (grade, term) group" selection
 * MasteryService already performs for its own strengths/concerns
 * narration — same selection logic, applied here to a different field.
 *
 * @param {import('./coverageService').CoverageReport[]} coverageReports
 * @returns {string[]}
 */
function extractFocusTopics(coverageReports) {
  if (!coverageReports || coverageReports.length === 0) return [];
  const latest = [...coverageReports].sort(
    (a, b) => b.term - a.term || b.grade - a.grade
  )[0];
  if (!latest || !latest.dataAvailable) return [];
  return latest.missingTopics || [];
}

/**
 * Builds recommendedActions from the same evidence determinePriority()
 * and extractFocusTopics() use — no new data sources. Rule table per the
 * PR7 brief:
 *
 *   coverage < 40%        -> revisit missing CAPS topics
 *   progress falling      -> schedule targeted revision
 *   mastery beginning     -> small-group intervention
 *   mastery secure        -> continue current pace
 *   mastery advanced      -> provide enrichment activities
 *
 * Rules are additive (a subject can match more than one), and the
 * function never returns an empty array — a subject with no evidence at
 * all still gets an explicit "gather more evidence" action rather than
 * silently recommending nothing.
 *
 * @param {import('./masteryService').MasteryReport} mastery
 * @param {string[]} focusTopics
 * @returns {string[]}
 */
function buildRecommendedActions(mastery, focusTopics) {
  const actions = [];
  const coverage = mastery.evidence.coverage;
  const progress = mastery.evidence.progress;

  if (mastery.masteryLevel === 'insufficient-data') {
    actions.push('Gather more assessment or observation evidence before planning an intervention.');
    return actions;
  }

  if (coverage.dataAvailable && coverage.averagePercentage < LOW_COVERAGE_THRESHOLD) {
    actions.push(
      focusTopics.length > 0
        ? `Revisit missing CAPS topics before introducing new content: ${focusTopics.join(', ')}.`
        : 'Revisit missing CAPS topics before introducing new content.'
    );
  }

  if (progress.trend === 'falling') {
    actions.push('Schedule targeted revision — recent assessment performance has been declining.');
  }

  if (mastery.masteryLevel === 'beginning') {
    actions.push('Consider small-group intervention for this subject.');
  }

  if (mastery.masteryLevel === 'secure') {
    actions.push('Continue current pace.');
  }

  if (mastery.masteryLevel === 'advanced') {
    actions.push('Provide enrichment activities to extend this learner.');
  }

  if (actions.length === 0) {
    // developing, with no falling trend and coverage not yet low enough
    // to trigger the topic-revisit rule above.
    actions.push('Continue monitoring — performance is developing steadily.');
  }

  return actions;
}

/**
 * Builds a single InterventionPlan for one subject from an
 * already-fetched MasteryReport. Pure function.
 *
 * @param {import('./masteryService').MasteryReport} mastery
 * @returns {InterventionPlan}
 */
function buildPlan(mastery) {
  const focusTopics = extractFocusTopics(mastery.evidence.coverage.reports);
  const priority = determinePriority(mastery);
  const recommendedActions = buildRecommendedActions(mastery, focusTopics);

  return {
    learnerId: mastery.learnerId,
    subject: mastery.subject,
    priority,
    focusTopics,
    recommendedActions,
    evidence: {
      mastery,
      progress: mastery.evidence.progress,
      coverage: {
        dataAvailable: mastery.evidence.coverage.dataAvailable,
        averagePercentage: mastery.evidence.coverage.averagePercentage,
      },
    },
  };
}

/**
 * Returns one InterventionPlan per subject the learner has a
 * MasteryReport for (i.e. the same subject set MasteryService returns).
 *
 * @param {number} learnerId
 * @param {{includeSuperseded?: boolean}} [options]
 * @returns {InterventionPlan[]}
 */
function getLearnerInterventionPlan(learnerId, options = {}) {
  const masteryReports = masteryService.getLearnerMastery(learnerId, options);
  return masteryReports.map(buildPlan);
}

/**
 * Convenience accessor for a single subject's InterventionPlan. Never
 * returns null/undefined — a subject with no evidence at all still
 * returns a plan with masteryLevel "insufficient-data" and a
 * "gather more evidence" action, so callers don't need a null check.
 *
 * @param {number} learnerId
 * @param {string} subject
 * @param {{includeSuperseded?: boolean}} [options]
 * @returns {InterventionPlan}
 */
function getLearnerInterventionPlanForSubject(learnerId, subject, options = {}) {
  const mastery = masteryService.getLearnerMasteryForSubject(learnerId, subject, options);
  return buildPlan(mastery);
}

/**
 * Persists a single InterventionPlan (as produced by buildPlan /
 * getLearnerInterventionPlanForSubject) to intervention_plans
 * (Migration 036's subject column).
 *
 * Dedup key: (learner_id, subject) scoped to status = 'active'. One
 * active learner-level plan per subject at a time — a second call for
 * the same learner+subject updates the existing row in place (refreshed
 * problem_area/goals/strategies/updated_at) rather than inserting a
 * duplicate. assessment_id is attached as context via COALESCE (kept if
 * already set, filled in if not) — it is not part of identity, since a
 * MasteryReport draws on multiple assessments over time, not one.
 *
 * Deliberately separate from interventionPlanService.js's
 * saveInterventionPlan(), which persists a different, assessment-scoped
 * plan shape (problem_area/target_group/goals as AI/rules-generated
 * prose keyed on assessment_id, no learner_id/subject identity). Both
 * write to the same intervention_plans table but never collide: this
 * writer's rows are identified by (learner_id, subject, status='active'),
 * the other's by assessment_id — and this writer never touches rows it
 * didn't create (it only ever SELECTs/UPDATEs by learner_id+subject).
 *
 * @param {InterventionPlan} plan
 * @param {{assessmentId?: number|null}} [options]
 * @returns {number} the intervention_plans row id (existing or newly inserted)
 */
function saveLearnerInterventionPlan(plan, { assessmentId = null } = {}) {
  const db = getDb();

  const learner = db.prepare(`SELECT phone_hash FROM learners WHERE id = ?`).get(plan.learnerId);
  if (!learner) {
    throw new Error(`saveLearnerInterventionPlan: no learner found for learnerId ${plan.learnerId}`);
  }
  const phoneHash = learner.phone_hash;

  const problemArea = plan.focusTopics && plan.focusTopics.length > 0
    ? `Focus topics: ${plan.focusTopics.join(', ')}`
    : `General performance in ${plan.subject}`;
  const goals = plan.recommendedActions.join('\n');
  const strategies = JSON.stringify(plan.recommendedActions);
  const durationDays = 14;

  const existing = db.prepare(`
    SELECT id FROM intervention_plans
    WHERE learner_id = ? AND subject = ? AND status = 'active'
  `).get(plan.learnerId, plan.subject);

  let planId;
  if (existing) {
    db.prepare(`
      UPDATE intervention_plans
      SET problem_area = ?,
          goals = ?,
          strategies = ?,
          assessment_id = COALESCE(assessment_id, ?),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(problemArea, goals, strategies, assessmentId, existing.id);
    planId = existing.id;
  } else {
    const result = db.prepare(`
      INSERT INTO intervention_plans (
        phone_hash, assessment_id, problem_area, target_group, goals,
        duration_days, strategies, status, learner_id, subject
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      phoneHash,
      assessmentId,
      problemArea,
      `Learner ${plan.learnerId}`,
      goals,
      durationDays,
      strategies,
      plan.learnerId,
      plan.subject
    );
    planId = result.lastInsertRowid;

    // TSE Evidence Engine (Migration 034): tag as 'intervention' evidence,
    // same convention as interventionPlanService.js's saveInterventionPlan().
    // Non-fatal.
    try {
      require('./tseEvidenceService').tagEvidence(
        phoneHash,
        'intervention',
        'intervention_plans',
        planId
      );
    } catch (evidenceErr) {
      console.error('[TSE] saveLearnerInterventionPlan evidence tagging failed:', evidenceErr.message);
    }
  }

  return planId;
}

module.exports = {
  getLearnerInterventionPlan,
  getLearnerInterventionPlanForSubject,
  saveLearnerInterventionPlan,
  // Exported for unit testing as pure functions; not part of the public
  // contract for other services (same pattern as masteryService.js).
  determinePriority,
  extractFocusTopics,
  buildRecommendedActions,
  buildPlan,
};
