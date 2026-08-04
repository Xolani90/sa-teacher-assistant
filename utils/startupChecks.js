'use strict';

/**
 * Startup validation (ADR-018 §5 — dependency-inversion cleanup).
 *
 * The one place in the codebase allowed to know about *both*
 * coachingEngineService and coachingMessageRenderer. Neither of those
 * modules requires the other any more:
 *
 *   coachingEngineService     — owns rules, has no idea rendering exists
 *   coachingMessageRenderer   — owns wording, has no idea the engine exists
 *   startupChecks (this file) — wires them together once, at boot, and
 *                                fails fast if they've drifted apart
 *
 * This mirrors validateRecommendationRules(), which already
 * self-validates at coachingEngineService's own module load (every rule
 * has a numeric priority) — that check stays where it is, since it only
 * concerns coachingEngineService's own internal data. What moved here is
 * specifically the *cross-module* check: every rule's messageId has a
 * matching renderer template, and vice versa. That can only be verified
 * by something that imports both, so it doesn't belong inside either
 * module itself.
 *
 * Call runStartupChecks() once, early in server.js, before the app
 * starts accepting traffic. Throws (rather than logging and continuing)
 * on failure — a missing/mismatched template is a deploy-blocking
 * configuration error, not something to discover from a teacher's bug
 * report after a rule silently fails to render.
 */

function runStartupChecks() {
  const { RECOMMENDATION_RULES, validateRecommendationRules } = require('../services/coachingEngineService');
  const { validateMessageTemplates } = require('../services/coachingMessageRenderer');

  // Re-asserted here (not just relied on at coachingEngineService's own
  // module load) so that a future refactor which removes that self-check
  // still can't ship silently — startup is the single source of truth
  // for "is the coaching rule catalogue internally consistent".
  validateRecommendationRules(RECOMMENDATION_RULES);
  validateMessageTemplates(RECOMMENDATION_RULES);

  console.log('[STARTUP] Coaching rule catalogue validated (rules ↔ templates in sync)');
}

module.exports = { runStartupChecks };
