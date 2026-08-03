'use strict';

/**
 * Coaching Snapshot Service (PR37, ADR-016).
 *
 * Owns the `coaching_snapshots` table (Migration 040) end to end: the
 * only writer. Nothing else in the codebase should INSERT/UPDATE this
 * table directly — reflectionService.js and growthPlanService.js invoke
 * `recordSnapshotsForTeacher()` after a successful commit; that is the
 * entire integration surface.
 *
 * ADR-016 §9 invariant 1 (restated as the design rule for this file):
 * snapshot creation must be a side effect of evidence changes, never of
 * evidence reads. This service exposes no function that is safe to call
 * from a read path (MY COACHING, a future dashboard route, or any other
 * consumer of coaching insights). If a future change finds itself
 * calling this service from inside a `get*`/list-style function, that is
 * a violation of this ADR, not a valid new use of the service.
 *
 * Dedup policy (ADR-016 §2): at most one stored row per
 * (phoneHash, topicId) per UTC calendar day. Within that daily cap, a
 * write is only persisted if confidence moved by more than the shared
 * noise threshold (§4) since the last stored snapshot for that
 * (phoneHash, topicId) — a trigger firing multiple times in one day with
 * no meaningful change is a no-op, not a series of near-identical rows.
 * History is append-only (§9 invariant 5): a same-day write UPDATEs that
 * day's existing row in place; it never deletes or rewrites a prior
 * day's row.
 */

const { getDb } = require('../utils/database');
const { buildTopicContexts } = require('./coachingEngineService');

/**
 * Shared noise threshold (ADR-016 §4): the same constant used by the
 * trend-classification rule (PR39) to decide improving/declining/stable.
 * Defined here, not duplicated, since both the write-dedup check and the
 * future trend rule are answering the same question — "has this changed
 * enough to matter?" A provisional default for initial release, not a
 * calibrated value (ADR-016 §4 note).
 */
const DEFAULT_TREND_NOISE_THRESHOLD = 0.05;

/**
 * Float-imprecision tolerance for comparisons against
 * DEFAULT_TREND_NOISE_THRESHOLD. Confidence is a sum of weighted floats
 * (§6.3), so a delta that is conceptually exactly the threshold can land
 * a few ULPs on either side of it (e.g. 0.50 + 0.05 - 0.50 ===
 * 0.050000000000000044 in JS) — without this, "exactly at the threshold"
 * is not reliably classified as "not past it" (this ADR's own §4 wording).
 */
const THRESHOLD_EPSILON = 1e-9;

/**
 * Returns the most recently stored snapshot for a (phoneHash, topicId)
 * pair, or null if none exists yet.
 *
 * @param {string} phoneHash
 * @param {string} topicId
 * @returns {object|null}
 */
function getLatestSnapshot(phoneHash, topicId) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM coaching_snapshots
       WHERE phone_hash = ? AND topic_id = ?
       ORDER BY captured_at DESC, id DESC
       LIMIT 1`
    )
    .get(phoneHash, topicId);

  return row || null;
}

/**
 * Returns today's stored snapshot row for a (phoneHash, topicId) pair —
 * i.e. a row whose captured_at falls on the current UTC calendar day —
 * or null if no snapshot has been written yet today. Distinct from
 * `getLatestSnapshot`: that returns the most recent row regardless of
 * date (used as the trend comparison point); this returns only a
 * same-day row (used to decide update-in-place vs. insert, §2).
 *
 * @param {string} phoneHash
 * @param {string} topicId
 * @returns {object|null}
 */
function getTodaysSnapshot(phoneHash, topicId) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM coaching_snapshots
       WHERE phone_hash = ? AND topic_id = ?
         AND date(captured_at) = date('now')
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(phoneHash, topicId);

  return row || null;
}

/**
 * Persists (or updates) a single topic's snapshot for a teacher, applying
 * the §2 dedup policy. Pure side effect — no return value consumers
 * should depend on beyond "did it write" for testing purposes.
 *
 * @param {string} phoneHash
 * @param {object} ctx - a single topic context, as produced by
 *   coachingEngineService.buildTopicContexts() (has topicId, confidence,
 *   confidenceLabel, evidenceScore, consistencyScore, recencyScore).
 * @param {object} [options]
 * @param {string} [options.ruleId] - optional triggering rule id (PR39).
 * @returns {'inserted'|'updated'|'skipped'} what happened, for tests/logging.
 */
function writeSnapshotForTopic(phoneHash, ctx, { ruleId = null } = {}) {
  const db = getDb();
  const { topicId, confidence, confidenceLabel, evidenceScore, consistencyScore, recencyScore, hasEvidence } = ctx;

  const latest = getLatestSnapshot(phoneHash, topicId);

  // buildTopicContexts() (ADR-016-revised) now returns a context for
  // every taxonomy topic, including ones the teacher has never touched.
  // Recording confidence=0 for a topic with no evidence and no prior
  // snapshot would be noise, not history — so skip entirely. Once a
  // topic HAS a stored snapshot (it had evidence at some point), its
  // later drop to zero evidence is genuine history and must still be
  // recorded, which is why this only skips when both conditions hold.
  if (!hasEvidence && !latest) {
    return 'skipped';
  }

  const delta = latest ? Math.abs(confidence - latest.confidence) : Infinity;

  // No prior snapshot at all is always worth recording (first data point).
  // Otherwise, only record if confidence moved past the shared noise
  // threshold since the last stored value (§2/§4) — this applies
  // regardless of whether today's row already exists, since the check is
  // "has anything changed enough to matter", not "has today changed".
  if (latest && delta <= DEFAULT_TREND_NOISE_THRESHOLD + THRESHOLD_EPSILON) {
    return 'skipped';
  }

  const todays = getTodaysSnapshot(phoneHash, topicId);

  if (todays) {
    db.prepare(
      `UPDATE coaching_snapshots
       SET confidence = ?, confidence_label = ?, evidence_score = ?,
           consistency_score = ?, recency_score = ?, rule_id = ?,
           captured_at = datetime('now')
       WHERE id = ?`
    ).run(confidence, confidenceLabel, evidenceScore, consistencyScore, recencyScore, ruleId, todays.id);
    return 'updated';
  }

  db.prepare(
    `INSERT INTO coaching_snapshots
       (phone_hash, topic_id, confidence, confidence_label,
        evidence_score, consistency_score, recency_score, rule_id, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(phoneHash, topicId, confidence, confidenceLabel, evidenceScore, consistencyScore, recencyScore, ruleId);
  return 'inserted';
}

/**
 * Entry point for callers: recomputes every topic's current context for
 * this teacher (via the existing PR33 coaching engine) and writes/updates
 * a snapshot for each, applying the dedup policy per topic independently.
 *
 * This is the ONLY function reflectionService.js / growthPlanService.js
 * should call, and only after a successful commit of their own write
 * (ADR-016 §2, §9 invariant 1). It intentionally recomputes all of the
 * teacher's topic contexts rather than just the one topic the triggering
 * write touched — a reflection or growth-plan change can shift
 * consistencyScore for other topics too (§6.3's consistency window is
 * shared across topics), so recomputing everything is the only way to
 * keep every topic's snapshot accurate.
 *
 * @param {string} phoneHash
 * @param {object} [options]
 * @param {string} [options.ruleId]
 * @returns {{topicId: string, result: 'inserted'|'updated'|'skipped'}[]}
 */
function recordSnapshotsForTeacher(phoneHash, { ruleId = null } = {}) {
  const contexts = buildTopicContexts(phoneHash);
  const results = [];

  for (const ctx of contexts.values()) {
    const result = writeSnapshotForTopic(phoneHash, ctx, { ruleId });
    results.push({ topicId: ctx.topicId, result });
  }

  return results;
}

module.exports = {
  DEFAULT_TREND_NOISE_THRESHOLD,
  THRESHOLD_EPSILON,
  getLatestSnapshot,
  getTodaysSnapshot,
  writeSnapshotForTopic,
  recordSnapshotsForTeacher,
};
