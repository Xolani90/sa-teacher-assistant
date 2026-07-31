'use strict';

/**
 * Dashboard Snapshot Service (ADR-014).
 *
 * Composes classAnalyticsService, classInterventionService, and
 * tseGrowthInsightService once per request into a single ClassSnapshot.
 * Pure orchestration — no new calculations, no direct repository access:
 *
 *   classAnalyticsService ──┐
 *   classInterventionService ─┴──> classSnapshotService ──> API route ──> Dashboard
 *   tseGrowthInsightService ──┘
 *
 * See ADR-014 for the full contract this implements.
 */

const classAnalyticsService = require('./classAnalyticsService');
const classInterventionService = require('./classInterventionService');
const tseGrowthInsightService = require('./tseGrowthInsightService');

/**
 * @typedef {Object} SnapshotSection
 * @property {"ok"|"error"|"unavailable"} status
 * @property {*} data - null unless status === "ok"
 * @property {?string} error - null unless status === "error"
 */

/**
 * Wraps a synchronous section-producing call in try/catch per ADR-014
 * §3.2. One section failing never blocks or nulls out the others.
 *
 * @param {() => *} fn
 * @returns {SnapshotSection}
 */
function runSection(fn) {
  try {
    return { status: 'ok', data: fn(), error: null };
  } catch (err) {
    return { status: 'error', data: null, error: err.message };
  }
}

/**
 * ADR-014 §3.4: tseGrowthInsightService.getGrowthInsights(phoneHash, opts)
 * is teacher-scoped, not class-scoped. Until a class-scoped accessor
 * exists, the qms section always reports "unavailable" rather than
 * silently calling the teacher-scoped function with a classId it can't
 * use, or omitting the key entirely (ADR-014 §3.5 reserves the key).
 *
 * @returns {SnapshotSection}
 */
function buildQmsSection() {
  return { status: 'unavailable', data: null, error: null };
}

/**
 * Composes a full ClassSnapshot for one class.
 *
 * @param {string} phoneHash
 * @param {number} classId
 * @param {{subject?: string}} [options]
 * @param {{name: string}} classInfo - class.id/class.name; caller resolves
 *        this (e.g. via teacherWorkspaceService.getTeacherClasses()) since
 *        this service has no direct classes-table access of its own.
 * @returns {{class: {id:number,name:string}, snapshot: Object, metadata: Object}}
 */
function getClassSnapshot(phoneHash, classId, options = {}, classInfo = {}) {
  const { subject } = options;

  const analyticsSection = runSection(() => classAnalyticsService.getClassAnalytics(phoneHash, classId, { subject }));
  const interventionSection = runSection(() => classInterventionService.getClassInterventionPlan(phoneHash, classId));
  const qmsSection = buildQmsSection();

  const snapshot = {
    analytics: analyticsSection,
    intervention: interventionSection,
    qms: qmsSection,
  };

  const errors = [];
  for (const [section, result] of Object.entries(snapshot)) {
    if (result.status === 'error') {
      errors.push({ section, reason: result.error });
    }
  }

  const partial = Object.values(snapshot).some((s) => s.status !== 'ok');

  return {
    class: { id: classId, name: classInfo.name || null },
    snapshot,
    metadata: {
      generatedAt: new Date().toISOString(),
      partial,
      errors,
    },
  };
}

module.exports = {
  getClassSnapshot,
  // Exported for unit testing as pure functions; not part of the public
  // contract for other services (same pattern as masteryService.js).
  runSection,
  buildQmsSection,
};
