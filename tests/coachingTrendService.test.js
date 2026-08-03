'use strict';
/**
 * coachingTrendService Tests (PR38, ADR-016 §3/§4/§9)
 *
 * Contract tests written against the frozen PR38 spec (see design
 * discussion referenced in ADR-016 §3/§4). Implementation-agnostic:
 * these assert observable behavior (status, delta, trendDirection,
 * evidenceTransition, threshold ordering) rather than internal
 * mechanics, so refactors of coachingTrendService's internals should
 * never require rewriting this file.
 *
 * Covers:
 *   1. Baseline: a topic with a prior stored snapshot compared against
 *      itself unchanged still reports "trend" (not "baseline") — this
 *      establishes the general shape once a snapshot exists.
 *   1b. Rising trend: confidence increased past TREND_FLAT_THRESHOLD.
 *   2. Falling trend: confidence decreased past TREND_FLAT_THRESHOLD.
 *   3. Flat trend: confidence moved, but not past TREND_FLAT_THRESHOLD.
 *   4. Evidence added: evidenceTransition === 'gained' when the last
 *      stored snapshot had none and the topic now has evidence.
 *   5. Evidence removed: evidenceTransition === 'lost' when the last
 *      stored snapshot had evidence and the topic now has none.
 *   6. No prior snapshot at all: a topic that has literally never had a
 *      coaching_snapshots row (distinct from #1 above, where a row
 *      exists) reports status "baseline", not "trend".
 *   7. Threshold ordering: SNAPSHOT_WRITE_THRESHOLD is not greater than
 *      TREND_FLAT_THRESHOLD (the startup assertion the module makes at
 *      require-time).
 *   8. Latest-two snapshot selection: with multiple historical rows for
 *      a topic, getLatestTrend() compares current confidence against
 *      the single most recent row, not an older one.
 *   9. Zero-evidence transition: both the last snapshot and the current
 *      context have no evidence — evidenceTransition === 'unchanged',
 *      independent of whatever confidence/delta value results.
 *   10. Read-only: calling getLatestTrend() never writes to
 *      coaching_snapshots (ADR-016 §9 invariant 4).
 *
 * Run individually:   node tests/coachingTrendService.test.js
 * Run via npm:         npm test
 */

const { createTestDb } = require('./helpers/createTestDb');
const testDb = createTestDb(__filename);
const _db = testDb.db;

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

function assertEq(a, b, label) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    console.error(`     expected: ${JSON.stringify(b)}`);
    console.error(`     got:      ${JSON.stringify(a)}`);
    failed++;
  }
}

function clearAll() {
  _db.exec(`DELETE FROM qms_reflections`);
  _db.exec(`DELETE FROM qms_growth_plans`);
  _db.exec(`DELETE FROM coaching_snapshots`);
}

function snapshotRows(phoneHash, topicId) {
  return _db
    .prepare(
      `SELECT * FROM coaching_snapshots WHERE phone_hash = ? AND topic_id = ? ORDER BY id`
    )
    .all(phoneHash, topicId);
}

// Directly inserts a coaching_snapshots row with an explicit captured_at,
// bypassing coachingSnapshotService's dedup/trigger logic entirely — PR38
// tests need full control over historical timestamps and values that
// PR37's real write path (evidence-event-triggered, deduped) doesn't
// expose a way to construct on demand.
function insertSnapshotRow(phoneHash, topicId, { confidence, evidenceScore, capturedAt }) {
  _db.prepare(
    `INSERT INTO coaching_snapshots
       (phone_hash, topic_id, confidence, confidence_label,
        evidence_score, consistency_score, recency_score, rule_id, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(phoneHash, topicId, confidence, 'Medium', evidenceScore, 0.5, 0.5, null, capturedAt);
}

async function run() {
  const reflectionService = require('../services/reflectionService');
  const {
    getLatestTrend,
    SNAPSHOT_WRITE_THRESHOLD,
    TREND_FLAT_THRESHOLD,
  } = require('../services/coachingTrendService');

  const PHONE = 'phone-hash-pr38';
  const TOPIC_A = 'TOPIC_CLASSROOM_MANAGEMENT';
  const TOPIC_UNTOUCHED = 'TOPIC_DIFFERENTIATION';

  console.log('\nTest 1: a topic with a prior snapshot reports status "trend"');
  clearAll();
  {
    reflectionService.createReflection(PHONE, { content: 'r1', topicId: TOPIC_A });
    const result = getLatestTrend(PHONE, TOPIC_A);
    assertEq(result.status, 'trend', 'status is "trend" once a prior snapshot exists');
  }

  console.log('\nTest 1b: rising trend — confidence increased past TREND_FLAT_THRESHOLD');
  clearAll();
  {
    // Evidence created first (this auto-triggers PR37's own snapshot
    // write); the manual baseline row is inserted AFTER, and after
    // clearing that auto-written row, so getLatestSnapshot() picks up
    // the intended 0.30 baseline rather than the row PR37's live
    // trigger already wrote for today's current confidence.
    reflectionService.createReflection(PHONE, { content: 'r1', topicId: TOPIC_A });
    reflectionService.createReflection(PHONE, { content: 'r2', topicId: TOPIC_A });
    reflectionService.createReflection(PHONE, { content: 'r3', topicId: TOPIC_A });
    _db.exec(`DELETE FROM coaching_snapshots`);
    insertSnapshotRow(PHONE, TOPIC_A, {
      confidence: 0.30, evidenceScore: 0.3, capturedAt: '2026-01-01T00:00:00.000Z',
    });
    const result = getLatestTrend(PHONE, TOPIC_A);
    assert(result.delta > TREND_FLAT_THRESHOLD, 'delta exceeds TREND_FLAT_THRESHOLD');
    assertEq(result.trendDirection, 'rising', 'trendDirection is "rising"');
  }

  console.log('\nTest 2: falling trend — confidence decreased past TREND_FLAT_THRESHOLD');
  clearAll();
  {
    insertSnapshotRow(PHONE, TOPIC_A, {
      confidence: 0.90, evidenceScore: 0.9, capturedAt: '2026-01-01T00:00:00.000Z',
    });
    // No new evidence recorded: current confidence for an untouched
    // topic (per ADR-016 §6 amendment) is 0 — well past the threshold
    // below the stored 0.90, which is sufficient to exercise "falling"
    // without needing to fabricate a partial-decay scenario.
    const result = getLatestTrend(PHONE, TOPIC_A);
    assert(result.delta < -TREND_FLAT_THRESHOLD, 'delta is below -TREND_FLAT_THRESHOLD');
    assertEq(result.trendDirection, 'falling', 'trendDirection is "falling"');
  }

  console.log('\nTest 3: flat trend — confidence moved, but not past TREND_FLAT_THRESHOLD');
  clearAll();
  {
    // Regression test:
    //
    // Snapshot persistence (PR37) only writes a new coaching_snapshots
    // row once a delta exceeds SNAPSHOT_WRITE_THRESHOLD. Trend
    // classification (PR38) intentionally uses the separate
    // TREND_FLAT_THRESHOLD constant — today they happen to share the
    // same value (0.05), but coachingTrendService never assumes that.
    // If a future tuning pass collapses the two constants into one
    // shared threshold, this test would stop exercising a real flat
    // zone at all, so it pins an exact in-band delta rather than just
    // checking "flat" is one of the allowed strings.
    //
    // currentConfidence comes from buildTopicContexts(), which derives
    // confidence from real evidence/consistency/recency scoring —
    // there's no reliable way to make live reflections land on an
    // exact 0.52 without coupling this test to that formula. So
    // buildTopicContexts is stubbed for this one case only, then
    // restored immediately after.
    insertSnapshotRow(PHONE, TOPIC_A, {
      confidence: 0.50, evidenceScore: 0.5, capturedAt: '2026-01-01T00:00:00.000Z',
    });

    const coachingEngineService = require('../services/coachingEngineService');
    const originalBuildTopicContexts = coachingEngineService.buildTopicContexts;
    let result;
    try {
      coachingEngineService.buildTopicContexts = () =>
        new Map([[TOPIC_A, { confidence: 0.52, hasEvidence: true }]]);
      delete require.cache[require.resolve('../services/coachingTrendService')];
      const stubbed = require('../services/coachingTrendService');
      result = stubbed.getLatestTrend(PHONE, TOPIC_A);
    } finally {
      coachingEngineService.buildTopicContexts = originalBuildTopicContexts;
      delete require.cache[require.resolve('../services/coachingTrendService')];
    }

    assertEq(result.status, 'trend', 'status is "trend" in the flat-zone case');
    assert(result.delta > 0, 'delta is positive (0.52 - 0.50)');
    assert(result.delta < TREND_FLAT_THRESHOLD, 'delta is inside the flat zone (< TREND_FLAT_THRESHOLD)');
    assertEq(result.trendDirection, 'flat', 'trendDirection is "flat" for a delta inside the threshold band');
  }

  console.log('\nTest 4: evidence added — evidenceTransition is "gained"');
  clearAll();
  {
    reflectionService.createReflection(PHONE, { content: 'r1', topicId: TOPIC_A });
    _db.exec(`DELETE FROM coaching_snapshots`);
    insertSnapshotRow(PHONE, TOPIC_A, {
      confidence: 0, evidenceScore: 0, capturedAt: '2026-01-01T00:00:00.000Z',
    });
    const result = getLatestTrend(PHONE, TOPIC_A);
    assertEq(result.evidenceTransition, 'gained', 'evidenceTransition is "gained" when evidence newly exists');
  }

  console.log('\nTest 5: evidence removed — evidenceTransition is "lost"');
  clearAll();
  {
    insertSnapshotRow(PHONE, TOPIC_A, {
      confidence: 0.40, evidenceScore: 0.4, capturedAt: '2026-01-01T00:00:00.000Z',
    });
    // No corresponding evidence created for TOPIC_A in the live tables:
    // buildTopicContexts() will report hasEvidence:false / confidence 0
    // for it, simulating the stored evidence having since been deleted.
    const result = getLatestTrend(PHONE, TOPIC_A);
    assertEq(result.evidenceTransition, 'lost', 'evidenceTransition is "lost" when evidence no longer exists');
  }

  console.log('\nTest 6: a topic with literally no prior snapshot row reports "baseline"');
  clearAll();
  {
    const result = getLatestTrend(PHONE, TOPIC_UNTOUCHED);
    assertEq(result.status, 'baseline', 'status is "baseline" with zero snapshot history');
    assertEq(Object.prototype.hasOwnProperty.call(result, 'delta'), false, 'baseline result has no delta field');
    assertEq(Object.prototype.hasOwnProperty.call(result, 'trendDirection'), false, 'baseline result has no trendDirection field');
  }

  console.log('\nTest 7: SNAPSHOT_WRITE_THRESHOLD does not exceed TREND_FLAT_THRESHOLD');
  clearAll();
  {
    assert(SNAPSHOT_WRITE_THRESHOLD <= TREND_FLAT_THRESHOLD, 'write threshold is not greater than the trend-flat threshold');
  }

  console.log('\nTest 8: getLatestTrend compares against the single most recent snapshot row');
  clearAll();
  {
    insertSnapshotRow(PHONE, TOPIC_A, {
      confidence: 0.10, evidenceScore: 0.1, capturedAt: '2026-01-01T00:00:00.000Z',
    });
    insertSnapshotRow(PHONE, TOPIC_A, {
      confidence: 0.80, evidenceScore: 0.8, capturedAt: '2026-01-15T00:00:00.000Z',
    });
    const result = getLatestTrend(PHONE, TOPIC_A);
    assertEq(result.lastConfidence, 0.80, 'compares against the most recent row (0.80), not the older one (0.10)');
    assertEq(result.sinceDate, '2026-01-15T00:00:00.000Z', 'sinceDate reflects the most recent row');
  }

  console.log('\nTest 9: zero-evidence transition — no evidence then vs. now yields "unchanged"');
  clearAll();
  {
    insertSnapshotRow(PHONE, TOPIC_A, {
      confidence: 0, evidenceScore: 0, capturedAt: '2026-01-01T00:00:00.000Z',
    });
    const result = getLatestTrend(PHONE, TOPIC_A);
    assertEq(result.evidenceTransition, 'unchanged', 'evidenceTransition is "unchanged" when neither side has evidence');
  }

  console.log('\nTest 10: getLatestTrend never writes to coaching_snapshots (§9 invariant 4)');
  clearAll();
  {
    reflectionService.createReflection(PHONE, { content: 'r1', topicId: TOPIC_A });
    const before = snapshotRows(PHONE, TOPIC_A).length;
    getLatestTrend(PHONE, TOPIC_A);
    getLatestTrend(PHONE, TOPIC_A);
    const after = snapshotRows(PHONE, TOPIC_A).length;
    assertEq(after, before, 'calling getLatestTrend repeatedly writes no additional snapshot rows');
  }

  clearAll();

  console.log(`\n${'─'.repeat(55)}`);
  console.log(`coachingTrendService Results: ${passed} passed, ${failed} failed`);
  testDb.cleanup();
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
