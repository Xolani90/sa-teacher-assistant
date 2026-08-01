'use strict';

/**
 * Tests for dashboardSnapshotService (ADR-014).
 *
 * NOTE: uses node:assert/strict directly. Swap for this repo's actual
 * hand-rolled assert/assertEq/assertThrows helper module — the exact
 * import path wasn't available when this file was drafted. The test
 * bodies below don't otherwise need to change.
 *
 * Monkey-patches classAnalyticsService.getClassAnalytics /
 * classInterventionService.getClassInterventionPlan /
 * tseGrowthInsightService.getGrowthInsights directly on the required
 * modules, matching the whole-module-require convention documented in
 * classInterventionService.js (destructuring would capture the function
 * reference before the patch runs).
 */

const assert = require('node:assert/strict');

const classAnalyticsService = require('../services/classAnalyticsService');
const classInterventionService = require('../services/classInterventionService');
const tseGrowthInsightService = require('../services/tseGrowthInsightService');
const { getClassSnapshot, safeCall } = require('../services/dashboardSnapshotService');

function assertEq(actual, expected, message) {
  assert.strictEqual(actual, expected, message);
}

function restoreAll(originals) {
  classAnalyticsService.getClassAnalytics = originals.analytics;
  classInterventionService.getClassInterventionPlan = originals.intervention;
  tseGrowthInsightService.getGrowthInsights = originals.tse;
}

function run() {
  const originals = {
    analytics: classAnalyticsService.getClassAnalytics,
    intervention: classInterventionService.getClassInterventionPlan,
    tse: tseGrowthInsightService.getGrowthInsights,
  };

  // --- safeCall helper ---
  {
    const ok = safeCall(() => 42);
    assertEq(ok.status, 'ok', 'safeCall: status ok on success');
    assertEq(ok.data, 42, 'safeCall: data passed through');
    assertEq(ok.error, null, 'safeCall: error null on success');

    const failed = safeCall(() => { throw new Error('boom'); });
    assertEq(failed.status, 'error', 'safeCall: status error on throw');
    assertEq(failed.data, null, 'safeCall: data null on throw');
    assertEq(failed.error, 'boom', 'safeCall: error message captured');
  }

  // --- All sections succeed ---
  {
    classAnalyticsService.getClassAnalytics = () => ({ classSummary: { learnerCount: 3 } });
    classInterventionService.getClassInterventionPlan = () => ({ summary: { totalLearners: 3 } });
    tseGrowthInsightService.getGrowthInsights = () => ({ term: 2, gaps: [] });

    const result = getClassSnapshot('phoneHash123', 4);

    assertEq(result.class.id, 4, 'class.id echoed');
    assertEq(result.snapshot.analytics.status, 'ok', 'analytics section ok');
    assertEq(result.snapshot.analytics.data.classSummary.learnerCount, 3, 'analytics data passed through');
    assertEq(result.snapshot.intervention.status, 'ok', 'intervention section ok');
    assertEq(result.snapshot.tse.status, 'ok', 'tse section ok');
    assertEq(result.snapshot.tse.data.term, 2, 'tse data passed through');
    assertEq(result.metadata.partial, false, 'metadata.partial false when all ok');
    assertEq(result.metadata.sections.analytics, 'ok', 'metadata.sections.analytics mirrors status');
    assertEq(result.metadata.sections.intervention, 'ok', 'metadata.sections.intervention mirrors status');
    assertEq(result.metadata.sections.tse, 'ok', 'metadata.sections.tse mirrors status');
    assertEq(result.metadata.version, 1, 'metadata.version is 1');
    assert.ok(result.metadata.generatedAt, 'metadata.generatedAt present');

    restoreAll(originals);
  }

  // --- TSE fails, others succeed (partial) ---
  {
    classAnalyticsService.getClassAnalytics = () => ({ classSummary: { learnerCount: 3 } });
    classInterventionService.getClassInterventionPlan = () => ({ summary: { totalLearners: 3 } });
    tseGrowthInsightService.getGrowthInsights = () => { throw new Error('tse unavailable'); };

    const result = getClassSnapshot('phoneHash123', 4);

    assertEq(result.snapshot.analytics.status, 'ok', 'analytics unaffected by tse failure');
    assertEq(result.snapshot.intervention.status, 'ok', 'intervention unaffected by tse failure');
    assertEq(result.snapshot.tse.status, 'error', 'tse section reflects failure');
    assertEq(result.snapshot.tse.data, null, 'tse data null on failure');
    assertEq(result.snapshot.tse.error, 'tse unavailable', 'tse error message captured');
    assertEq(result.metadata.partial, true, 'metadata.partial true when any section fails');
    assertEq(result.metadata.sections.tse, 'error', 'metadata.sections.tse reflects failure');

    restoreAll(originals);
  }

  // --- All sections fail ---
  {
    classAnalyticsService.getClassAnalytics = () => { throw new Error('analytics down'); };
    classInterventionService.getClassInterventionPlan = () => { throw new Error('intervention down'); };
    tseGrowthInsightService.getGrowthInsights = () => { throw new Error('tse down'); };

    const result = getClassSnapshot('phoneHash123', 4);

    assertEq(result.snapshot.analytics.status, 'error', 'analytics fails independently');
    assertEq(result.snapshot.intervention.status, 'error', 'intervention fails independently');
    assertEq(result.snapshot.tse.status, 'error', 'tse fails independently');
    assertEq(result.metadata.partial, true, 'metadata.partial true when all fail');
    assert.doesNotThrow(() => getClassSnapshot('phoneHash123', 4), 'snapshot never throws even when every child service fails');

    restoreAll(originals);
  }

  // --- options.subject forwarded to analytics only; options.term forwarded to tse only ---
  {
    let analyticsOptionsSeen;
    let tseOptsSeen;
    classAnalyticsService.getClassAnalytics = (phoneHash, classId, opts) => {
      analyticsOptionsSeen = opts;
      return {};
    };
    classInterventionService.getClassInterventionPlan = () => ({});
    tseGrowthInsightService.getGrowthInsights = (phoneHash, opts) => {
      tseOptsSeen = opts;
      return {};
    };

    getClassSnapshot('phoneHash123', 4, { subject: 'Mathematics', term: 3 });

    assertEq(analyticsOptionsSeen.subject, 'Mathematics', 'subject option forwarded to classAnalyticsService');
    assertEq(tseOptsSeen.term, 3, 'term option forwarded to tseGrowthInsightService');

    restoreAll(originals);
  }

  console.log('✅ PASS dashboardSnapshotService.test.js (21 assertions)');
}

run();

module.exports = { run };
