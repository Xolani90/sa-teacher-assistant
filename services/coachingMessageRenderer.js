'use strict';
/**
 * coachingMessageRenderer (PR40, ADR-018)
 *
 * Owns all teacher-facing wording for coaching recommendations. This
 * module is deliberately "dumb": it holds a `messageId -> template
 * function` map and nothing else. Template functions read only the
 * fields handed to them in `templateData` — they never inspect trend
 * direction, evidence transitions, confidence thresholds, or any other
 * analytical concept. Those decisions already happened in
 * coachingEngineService by the time a recommendation object reaches this
 * module (ADR-018 §4).
 *
 * ADR-018 keeps `messageId` distinct from `ruleId` even though every rule
 * maps to exactly one message today — see ADR-018 §2 for why.
 *
 * PHASE 2 (dependency-inversion cleanup): this module now knows nothing
 * about coachingEngineService. It no longer requires the engine to
 * validate itself at load time — `validateMessageTemplates(rules)` is a
 * pure function of whatever `rules` array is handed to it, and it is the
 * *caller's* job to supply RECOMMENDATION_RULES. That caller is
 * server.js's startup sequence (see startupChecks.js), which requires
 * both this module and coachingEngineService and wires them together —
 * neither module requires the other. This keeps both independently
 * requireable/testable and removes the last cross-module coupling this
 * file had (previously: renderer → engine, one-directional but still a
 * presentation-only module transitively pulling in the full DB stack via
 * better-sqlite3/migrations just to validate templates).
 *
 * Run individually:   node -e "require('./services/coachingMessageRenderer')"
 */

/**
 * messageId -> template function. Each template function receives only
 * `templateData` (never the full recommendation object, never `ctx`) and
 * returns a string. Wording here is identical, word-for-word, to what
 * each rule's `evaluate()` currently composes inline in
 * coachingEngineService.js — this is a location change, not a copy
 * rewrite (ADR-018 §6).
 */
const MESSAGE_TEMPLATES = {
  growth_plan_missing: (data) =>
    `You have identified a recurring pattern in ${data.topicLabel} `
    + `but don't yet have an active growth plan.`,

  evidence_removed: (data) =>
    `Evidence you previously recorded for ${data.topicLabel} is no `
    + `longer present. Confirm whether this topic still needs attention.`,

  stale_evidence: (data) =>
    `You haven't recorded recent evidence for ${data.topicLabel}. `
    + `Add a recent reflection to keep recommendations current.`,

  trend_falling: (data) =>
    `Your confidence in ${data.topicLabel} has declined since your `
    + `last check-in. Consider revisiting this area soon.`,

  evidence_gained: (data) =>
    `New evidence has appeared for ${data.topicLabel} since your last `
    + `check-in. Keep building on this momentum.`,

  low_confidence_recommendation: () =>
    'Evidence is currently limited for this recommendation. '
    + 'Continue recording reflections before making major changes.',

  trend_rising: (data) =>
    `Your confidence in ${data.topicLabel} has improved since your `
    + `last check-in. Keep up the current approach.`,

  recurring_topic_pattern: (data) =>
    `Continue focused coaching support on ${data.topicLabel}.`,
};

/**
 * Renders a structured recommendation object into a teacher-facing
 * string, using the template registered under `recommendation.messageId`.
 *
 * @param {object} recommendation - as produced by a
 *   coachingEngineService rule's evaluate(); must carry `messageId` and
 *   `templateData`.
 * @returns {string}
 * @throws {Error} if `messageId` has no registered template — a
 *   configuration error, not something to silently fall back on
 *   (ADR-018 §3, mirroring ADR-017's validateRecommendationRules()).
 */
function renderRecommendation(recommendation) {
  const { messageId, templateData } = recommendation || {};
  const template = MESSAGE_TEMPLATES[messageId];
  if (!template) {
    throw new Error(`coachingMessageRenderer: no template registered for messageId '${messageId}'`);
  }
  return template(templateData || {});
}

/**
 * ADR-018 §3: every messageId referenced by RECOMMENDATION_RULES must
 * have a matching template, and vice versa — a missing template must
 * fail at module load, not the first time a particular rule fires in
 * production.
 *
 * Takes `rules` as a parameter (rather than requiring
 * coachingEngineService internally at call time) so this can be unit
 * tested against synthetic rule/template sets without needing a real
 * database-backed engine module in scope.
 *
 * @param {object[]} rules - rule objects, each carrying a `messageId`.
 * @param {object} [templates=MESSAGE_TEMPLATES]
 * @throws {Error} if any rule's messageId has no template, or any
 *   template has no corresponding rule.
 */
function validateMessageTemplates(rules, templates = MESSAGE_TEMPLATES) {
  const ruleMessageIds = new Set(rules.map((rule) => rule.messageId));
  const templateIds = new Set(Object.keys(templates));

  for (const rule of rules) {
    if (!templates[rule.messageId]) {
      throw new Error(
        `coachingMessageRenderer: rule '${rule.id}' references unknown messageId '${rule.messageId}'`
      );
    }
  }

  for (const templateId of templateIds) {
    if (!ruleMessageIds.has(templateId)) {
      throw new Error(
        `coachingMessageRenderer: template '${templateId}' has no corresponding rule messageId`
      );
    }
  }
}

module.exports = {
  MESSAGE_TEMPLATES,
  renderRecommendation,
  validateMessageTemplates,
};
