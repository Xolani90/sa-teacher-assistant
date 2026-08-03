'use strict';

/**
 * dashboardSnapshotService (ADR-014).
 *
 * Pure orchestration layer. Composes classAnalyticsService (ADR-015),
 * classInterventionService (ADR-009), and tseGrowthInsightService (TSE
 * Phase 4) into a single ClassSnapshot. Performs no calculations of its
 * own — only invokes child services, isolates failures per section, and
 * assembles the response contract.
 *
 * Required as whole modules (not destructured), matching the convention
 * in classInterventionService.js / classAnalyticsService.js, so tests can
 * monkey-patch classAnalyticsService.getClassAnalytics /
 * classInterventionService.getClassInterventionPlan /
 * tseGrowthInsightService.getGrowthInsights directly.
 *
 * IMPORTANT — signature mismatch flagged during implementation:
 * tseGrowthInsightService.getGrowthInsights(phoneHash, opts) is NOT
 * class-scoped — it takes { term? } only, no classId. This service calls
 * it once per snapshot using phoneHash alone; classId is not passed
 * through. If TSE insights are later meant to be class-scoped, that is a
 * tseGrowthInsightService change, not something to fake here.
 */

const classAnalyticsService = require('./classAnalyticsService');
const classInterventionService = require('./classInterventionService');
const tseGrowthInsightService = require('./tseGrowthInsightService');

/**
 * Wraps a child service call so a thrown error becomes a
 * { status, data, error } section instead of aborting the whole snapshot.
 * Mirrors the try/catch-per-learner fault isolation pattern already used
 * in classInterventionService.js / classAnalyticsService.js, applied here
 * at the per-service level instead of per-learner.
 *
 * @param {Function} fn - zero-arg function invoking the child service
 * @returns {{status: 'ok'|'error', data: *, error: string|null}}
 */
function safeCall(fn) {
  try {
    return { status: 'ok', data: fn(), error: null };
  } catch (err) {
    return { status: 'error', data: null, error: err.message };
  }
}

/**
 * Builds a ClassSnapshot for the dashboard (ADR-014).
 *
 * @param {string} phoneHash
 * @param {number} classId
 * @param {{subject?: string, term?: number}} [options] - `subject` is
 *   forwarded to classAnalyticsService; `term` is forwarded to
 *   tseGrowthInsightService (see signature-mismatch note above regarding
 *   classId not being forwarded to TSE).
 * @returns {import('./dashboardSnapshotService').ClassSnapshot}
 */
function getClassSnapshot(phoneHash, classId, options = {}) {
  // Section registry (ADR-014): adding a future section (attendance,
  // observations, AI insights, etc.) is a one-line addition here, not
  // new orchestration code.
  const snapshotSections = {
    analytics: () => classAnalyticsService.getClassAnalytics(phoneHash, classId, { subject: options.subject }),
    intervention: () => classInterventionService.getClassInterventionPlan(phoneHash, classId, options),
    tse: () => tseGrowthInsightService.getGrowthInsights(phoneHash, { term: options.term }),
  };

  const snapshot = {};
  const sections = {};

  for (const [key, call] of Object.entries(snapshotSections)) {
    const result = safeCall(call);
    snapshot[key] = result;
    sections[key] = result.status;
  }

  const partial = Object.values(sections).some((status) => status !== 'ok');

  return {
    class: { id: classId },
    snapshot,
    metadata: {
      generatedAt: new Date().toISOString(),
      version: 1,
      partial,
      sections,
    },
  };
}

module.exports = {
  getClassSnapshot,
  // Exported for unit testing as a pure function; not part of the public
  // contract for other services (same pattern as classInterventionService.js).
  safeCall,
};
