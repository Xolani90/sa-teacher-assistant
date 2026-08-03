'use strict';

/**
 * Coaching Trend Service (PR38, ADR-016 §3).
 *
 * Read-only. Computes a deterministic trend for a single topic by
 * comparing the most recently stored `coaching_snapshots` row
 * (coachingSnapshotService.getLatestSnapshot) against a freshly
 * computed current context (coachingEngineService.buildTopicContexts).
 *
 * Explicitly out of scope (ADR-016 §1 ownership table):
 *   - writing/updating coaching_snapshots (PR37 owns that, exclusively);
 *   - recommendation rules / coaching copy (PR39);
 *   - WhatsApp / dashboard presentation (PR40);
 *   - multi-point history — getSnapshotHistory() below is a stub for
 *     PR38+ future work and is intentionally unused by getLatestTrend().
 *
 * Trend window (ADR-016 §3): last-snapshot-to-now. There is exactly one
 * trend engine; calendar framing ("this term", etc.) is a PR40 display
 * concern layered on top of this function's output, never a second
 * computation path.
 */

const { getLatestSnapshot } = require('./coachingSnapshotService');
const { buildTopicContexts } = require('./coachingEngineService');

/**
 * Snapshot-write dedup threshold (ADR-016 §2/§4) — how much confidence
 * must move within a single day before coachingSnapshotService bothers
 * persisting a new row at all. Distinct from TREND_FLAT_THRESHOLD below:
 * this one governs whether history gets a data point in the first place,
 * not how PR38 classifies the direction between two already-stored
 * points. Re-exported (not re-defined) from coachingSnapshotService so
 * the two threshold concepts can never independently drift — see the
 * startup assertion at the bottom of this file.
 */
const { DEFAULT_TREND_NOISE_THRESHOLD: SNAPSHOT_WRITE_THRESHOLD } = require('./coachingSnapshotService');

/**
 * Trend classification threshold (ADR-016 §4). Separate constant from
 * SNAPSHOT_WRITE_THRESHOLD even though both currently equal 0.05:
 * SNAPSHOT_WRITE_THRESHOLD answers "is this change worth storing at
 * all?" (a coachingSnapshotService concern); TREND_FLAT_THRESHOLD
 * answers "given two already-stored points, do they differ enough to
 * call it a trend?" (a coachingTrendService concern). Keeping them
 * separate constants — asserted, not just commented, to be ordered
 * correctly below — means retuning one independently of the other later
 * is a one-line change, not a search-and-replace across two unrelated
 * concerns that happened to share a value at initial release.
 */
const TREND_FLAT_THRESHOLD = 0.05;

if (!(SNAPSHOT_WRITE_THRESHOLD < TREND_FLAT_THRESHOLD + 1e-9)) {
  // Startup assertion, not a runtime check on the hot path: if a future
  // tuning pass changes one threshold without the other, PR38's
  // "delta past TREND_FLAT_THRESHOLD implies past SNAPSHOT_WRITE_THRESHOLD"
  // reasoning silently breaks. Fail loudly at require-time instead.
  throw new Error(
    'coachingTrendService: SNAPSHOT_WRITE_THRESHOLD must not exceed TREND_FLAT_THRESHOLD'
  );
}

/**
 * @typedef {Object} BaselineTrendResult
 * @property {'baseline'} status - no prior snapshot exists for this topic.
 * @property {string} topicId
 * @property {number} currentConfidence
 *
 * @typedef {Object} ComputedTrendResult
 * @property {'trend'} status
 * @property {string} topicId
 * @property {number} currentConfidence
 * @property {number} lastConfidence
 * @property {number} delta - currentConfidence - lastConfidence.
 * @property {'rising'|'falling'|'flat'} trendDirection - derived from
 *   `delta` alone against TREND_FLAT_THRESHOLD (ADR-016 §4).
 * @property {'gained'|'lost'|'unchanged'} evidenceTransition - derived
 *   solely from the two snapshots' hasEvidence flags, independent of
 *   trendDirection/delta. A topic can go from having evidence to having
 *   none (or vice versa) with any confidence delta, so this is a genuinely
 *   orthogonal axis, not a re-derivation of trendDirection.
 * @property {string} sinceDate - captured_at of the last stored snapshot.
 */

/**
 * Classifies a confidence delta into a trend direction. Pure function of
 * the delta alone (ADR-016 §4) — no other signal (evidence count,
 * consistency score movement, etc.) participates in this decision.
 *
 * @param {number} delta
 * @returns {'rising'|'falling'|'flat'}
 */
function classifyDirection(delta) {
  if (delta > TREND_FLAT_THRESHOLD) return 'rising';
  if (delta < -TREND_FLAT_THRESHOLD) return 'falling';
  return 'flat';
}

/**
 * Classifies the evidence-presence transition between the last stored
 * snapshot and the current context, from hasEvidence flags alone.
 *
 * Deliberately NOT derived from confidence or delta: relying on
 * "confidence === 0 implies no evidence" would couple this function to
 * an assumption about how calculateConfidence() happens to be
 * implemented today, rather than the actual fact PR38 needs, which is
 * whether evidence existed. hasEvidence is read directly from both
 * sides for that reason.
 *
 * @param {boolean} lastHasEvidence
 * @param {boolean} currentHasEvidence
 * @returns {'gained'|'lost'|'unchanged'}
 */
function classifyEvidenceTransition(lastHasEvidence, currentHasEvidence) {
  if (!lastHasEvidence && currentHasEvidence) return 'gained';
  if (lastHasEvidence && !currentHasEvidence) return 'lost';
  return 'unchanged';
}

/**
 * Derives whether a stored snapshot row had evidence at capture time.
 *
 * `coaching_snapshots` (Migration 040 / ADR-016 §6) has no `has_evidence`
 * column — only the component scores. This relies on a fact confirmed
 * against this codebase's actual coachingEngineService: evidenceScore is
 * 0 if and only if a topic has zero evidence (calculateEvidenceScore(0)
 * === 0, and every non-zero evidence count scores > 0), so
 * evidence_score === 0 is an exact, not approximate, proxy for
 * hasEvidence === false at write time. This is a one-directional,
 * locally-checked precondition — it is NOT asserted as a global
 * invariant elsewhere in this file, only relied on here where it is
 * actually used.
 *
 * @param {object} snapshotRow - a row as returned by
 *   coachingSnapshotService.getLatestSnapshot().
 * @returns {boolean}
 */
function hadEvidenceAtCapture(snapshotRow) {
  return snapshotRow.evidence_score !== 0;
}

/**
 * Returns the trend for a single topic: last stored snapshot vs. current
 * confidence (ADR-016 §3). Read-only — never writes to coaching_snapshots
 * (ADR-016 §9 invariant 4).
 *
 * @param {string} phoneHash
 * @param {string} topicId
 * @param {Map<string, object>} [precomputedContexts] - if the caller
 *   already has a topic-context map (e.g. coachingEngineService building
 *   trend into its own contexts), pass it here instead of letting this
 *   function call buildTopicContexts() itself. Required to avoid infinite
 *   recursion, since buildTopicContexts() calls getLatestTrend() per
 *   topic to attach ctx.trend (ADR-017 §2/PR39) — without this escape
 *   hatch, getLatestTrend() -> buildTopicContexts() -> getLatestTrend()
 *   would recurse forever.
 * @returns {BaselineTrendResult|ComputedTrendResult}
 */
function getLatestTrend(phoneHash, topicId, precomputedContexts) {
  const latest = getLatestSnapshot(phoneHash, topicId);
  const contexts = precomputedContexts || buildTopicContexts(phoneHash);

  if (!latest) {
    const currentCtx = contexts.get(topicId);
    return {
      status: 'baseline',
      topicId,
      currentConfidence: currentCtx ? currentCtx.confidence : 0,
    };
  }

  const currentCtx = contexts.get(topicId);
  const currentConfidence = currentCtx ? currentCtx.confidence : 0;
  const currentHasEvidence = currentCtx ? currentCtx.hasEvidence : false;

  const delta = currentConfidence - latest.confidence;

  // Local precondition, not a system-wide assertion (deliberately not
  // enforced elsewhere in this file): in this codebase hasEvidence=false
  // implies confidence===0 (evidenceScore is 0 only with zero evidence),
  // but the reverse direction — confidence 0 implying no evidence — does
  // not hold in general, so this function never leans on it. Documented
  // here only because this is the one place a reader might otherwise
  // wonder why evidenceTransition isn't just derived from delta.
  return {
    status: 'trend',
    topicId,
    currentConfidence,
    lastConfidence: latest.confidence,
    delta,
    trendDirection: classifyDirection(delta),
    evidenceTransition: classifyEvidenceTransition(hadEvidenceAtCapture(latest), currentHasEvidence),
    sinceDate: latest.captured_at,
  };
}

/**
 * Multi-point snapshot history for a topic. Stubbed for PR38 — no
 * consumer needs it yet (getLatestTrend only compares the latest two
 * points, ADR-016 §3). Left as an explicit not-implemented stub rather
 * than silently returning [] so a future PR that starts depending on it
 * fails loudly instead of quietly getting no history.
 *
 * @param {string} phoneHash
 * @param {string} topicId
 * @returns {never}
 */
function getSnapshotHistory(phoneHash, topicId) {
  throw new Error('coachingTrendService.getSnapshotHistory: not implemented (PR38 only ships getLatestTrend)');
}

module.exports = {
  SNAPSHOT_WRITE_THRESHOLD,
  TREND_FLAT_THRESHOLD,
  getLatestTrend,
  getSnapshotHistory,
};
