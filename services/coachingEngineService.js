'use strict';

/**
 * QMS Coaching Engine (PR33, ADR-013 §6).
 *
 * Increment 1 of 7 (per the implementation order agreed for PR33):
 *   1. Evidence retrieval + insufficient-data guard   ← done
 *   2. Confidence calculation (§6.3)                  ← done
 *   3. Recommendation pipeline mechanics (§6.4)        ← this increment
 *   4. Recommendation rules + explanation generation (§6.5)
 *   5. Public API surface (§6.7)
 *   6. Tests
 *
 * Increment 3 scope is deliberately narrow: the deduplication/sort/
 * truncate PIPELINE only — not the domain-specific rule catalogue that
 * produces recommendation candidates in the first place. The pipeline
 * takes already-built candidate objects (`{ topicId, recommendation,
 * confidence, evidence }`) and doesn't care who produced them or how;
 * that separation is what makes adding real rules later trivial instead
 * of a rewrite. `getCoachingInsights()` still returns an empty
 * recommendation set once the guard passes — there are no rules yet to
 * generate candidates from, so the pipeline has nothing to run on.
 *
 * §6.1 resilience note: a persisted topic_id that is not present in the
 * *current* active taxonomy (utils/qmsTopics.js) is treated exactly like
 * a null topic_id everywhere in this file — excluded from evidence, never
 * surfaced, never a source of an error. This matters because §3.3 only
 * guarantees validation at write time, not that every row read later
 * still matches today's taxonomy (a topic could be retired after rows
 * referencing it exist, per §3.4).
 */

const { isValidTopicId, getTopicById } = require('../utils/qmsTopics');
const reflectionService = require('./reflectionService');
const growthPlanService = require('./growthPlanService');

// ── Named configuration defaults (ADR-013 §6.3/§6.4/§6.6) ──────────────────
// All provisional for initial release, not calibrated against usage data —
// stated here as single named constants specifically so the confidence
// formula and the guard are reproducible from the ADR without guessing,
// and so nothing downstream re-declares its own copy of these numbers.

/** Denominator for evidenceScore (§6.3). */
const DEFAULT_REQUIRED_EVIDENCE = 5;

/** Max recommendations returned by getCoachingInsights (§6.4). */
const DEFAULT_MAX_INSIGHTS = 3;

/** Insufficient-data guard threshold (§6.6): reflections < this → insufficient. */
const MIN_REFLECTIONS_FOR_SUFFICIENT_DATA = 3;

/** Insufficient-data guard threshold (§6.6): active growth plans < this → insufficient. */
const MIN_ACTIVE_GROWTH_PLANS_FOR_SUFFICIENT_DATA = 1;

/**
 * §6.1 resilience check: is this topicId usable as evidence right now?
 * A stale/invalid persisted topic_id is treated exactly like null — this
 * is the single point where that rule is enforced, so every other
 * function in this file can just filter through it rather than
 * re-deriving the "is this still in the taxonomy" check itself.
 *
 * @param {*} topicId
 * @returns {boolean}
 */
function hasUsableTopic(topicId) {
  return isValidTopicId(topicId);
}

/**
 * Insufficient-data guard (§6.6).
 *
 * `activeGrowthPlans` is defined precisely as growth plans whose `status`
 * equals `'active'` — not `in_progress`, `completed`, or `abandoned` —
 * per growthPlanService.js's VALID_STATUSES, stated explicitly here so
 * this guard counts the same set of rows regardless of who reads this
 * comment.
 *
 * @param {string} phoneHash
 * @returns {{sufficient: boolean, reflectionCount: number, activeGrowthPlanCount: number}}
 */
function checkInsufficientDataGuard(phoneHash) {
  if (!phoneHash || typeof phoneHash !== 'string') {
    throw new Error('checkInsufficientDataGuard: phoneHash is required');
  }

  const reflectionCount = reflectionService.listReflections(phoneHash).length;
  const activeGrowthPlanCount = growthPlanService
    .listGrowthPlans(phoneHash, { status: 'active' }).length;

  const sufficient = reflectionCount >= MIN_REFLECTIONS_FOR_SUFFICIENT_DATA
    && activeGrowthPlanCount >= MIN_ACTIVE_GROWTH_PLANS_FOR_SUFFICIENT_DATA;

  return { sufficient, reflectionCount, activeGrowthPlanCount };
}

/**
 * A teacher's reflections that carry a currently-usable topicId (§6.1).
 * Untagged reflections, and reflections tagged with a topicId that has
 * since fallen out of the active taxonomy, are both excluded — the same
 * treatment, per §6.1.
 *
 * @param {string} phoneHash
 * @returns {object[]} reflectionService rows, already filtered.
 */
function getTaggedReflections(phoneHash) {
  return reflectionService.listReflections(phoneHash)
    .filter((r) => hasUsableTopic(r.topicId));
}

/**
 * A teacher's growth plans that carry a currently-usable topicId (§6.1).
 * Not restricted to status='active' — evidence retrieval and the
 * insufficient-data guard are deliberately separate concerns; a
 * completed or abandoned plan can still be valid supporting evidence for
 * a pattern even though it no longer counts toward "is there enough
 * active data to coach against" (§6.6).
 *
 * @param {string} phoneHash
 * @returns {object[]} growthPlanService rows, already filtered.
 */
function getTaggedGrowthPlans(phoneHash) {
  return growthPlanService.listGrowthPlans(phoneHash)
    .filter((p) => hasUsableTopic(p.topicId));
}

/**
 * Evidence retrieval (§6.2): every currently-usable reflection and growth
 * plan a teacher has, grouped by topicId as structured `{ type, id }`
 * references — never string identifiers like `"reflection#12"`, so this
 * stays a stable, parse-free contract for the confidence/rules layers
 * landing in the next increment.
 *
 * @param {string} phoneHash
 * @returns {Map<string, Array<{type: 'reflection'|'growth_plan', id: number}>>}
 */
function gatherEvidenceByTopic(phoneHash) {
  if (!phoneHash || typeof phoneHash !== 'string') {
    throw new Error('gatherEvidenceByTopic: phoneHash is required');
  }

  const evidenceByTopic = new Map();

  const addEvidence = (topicId, type, id) => {
    if (!evidenceByTopic.has(topicId)) evidenceByTopic.set(topicId, []);
    evidenceByTopic.get(topicId).push({ type, id });
  };

  getTaggedReflections(phoneHash).forEach((r) => addEvidence(r.topicId, 'reflection', r.id));
  getTaggedGrowthPlans(phoneHash).forEach((p) => addEvidence(p.topicId, 'growth_plan', p.id));

  return evidenceByTopic;
}

// ── Confidence calculation (ADR-013 §6.3) ───────────────────────────────
//
// Every function in this section is pure: no DB access, no clock reads
// (ages/dates are passed in), no dependency on any other function in this
// file. They take already-computed evidence and return a number/label.
// Wiring these against real evidence (turning `gatherEvidenceByTopic()`
// output + row timestamps into the inputs these expect) is increment 3's
// job, alongside the recommendation rules that consume the result.

/**
 * evidenceScore (§6.3): normalized amount of supporting evidence.
 *
 *   evidenceScore = min(supportingEvidenceCount / DEFAULT_REQUIRED_EVIDENCE, 1.0)
 *
 * @param {number} supportingEvidenceCount
 * @param {number} [requiredEvidence=DEFAULT_REQUIRED_EVIDENCE]
 * @returns {number}
 */
function calculateEvidenceScore(supportingEvidenceCount, requiredEvidence = DEFAULT_REQUIRED_EVIDENCE) {
  if (typeof supportingEvidenceCount !== 'number' || supportingEvidenceCount < 0) {
    throw new Error('calculateEvidenceScore: supportingEvidenceCount must be a non-negative number');
  }
  return Math.min(supportingEvidenceCount / requiredEvidence, 1.0);
}

/**
 * recencyScore (§6.3): freshness of the *newest* supporting evidence item
 * only — never averaged across evidence, per the ADR's explicit rationale
 * that averaging would penalize a single recent item from surfacing an
 * insight. Fixed lookup table, no interpolation:
 *
 *   ≤30 days   → 1.00
 *   31–90      → 0.75
 *   91–180     → 0.50
 *   >180       → 0.25
 *
 * @param {number} ageDaysOfNewestEvidence - age in days of the newest
 *   supporting evidence item. A negative value (e.g. a clock-skewed or
 *   future-dated row) is clamped to 0 rather than thrown on, since it
 *   still unambiguously falls in the "≤30 days" bucket.
 * @returns {number}
 */
function calculateRecencyScore(ageDaysOfNewestEvidence) {
  if (typeof ageDaysOfNewestEvidence !== 'number' || Number.isNaN(ageDaysOfNewestEvidence)) {
    throw new Error('calculateRecencyScore: ageDaysOfNewestEvidence must be a number');
  }
  const ageDays = Math.max(ageDaysOfNewestEvidence, 0);

  if (ageDays <= 30) return 1.00;
  if (ageDays <= 90) return 0.75;
  if (ageDays <= 180) return 0.50;
  return 0.25;
}

/**
 * consistencyScore (§6.3): proportion of recent *tagged* reflections
 * supporting the same topic.
 *
 *   consistencyScore = matchingTaggedReflections / relevantTaggedReflections
 *
 * `relevantTaggedReflections` must already be restricted by the caller to
 * the last 10 reflections that carry a non-null (and, per §6.1, still
 * currently-valid) topic_id — untagged reflections are excluded from
 * both numerator and denominator before this function ever sees them, so
 * a teacher is never penalized for writing reflections outside the
 * taxonomy. This function itself does no windowing; it only divides.
 *
 * @param {number} matchingTaggedReflections
 * @param {number} relevantTaggedReflections
 * @returns {number} 0 if relevantTaggedReflections is 0 — no tagged
 *   reflections at all means no evidence of consistency one way or the
 *   other, not an error and not a divide-by-zero.
 */
function calculateConsistencyScore(matchingTaggedReflections, relevantTaggedReflections) {
  if (typeof matchingTaggedReflections !== 'number' || matchingTaggedReflections < 0) {
    throw new Error('calculateConsistencyScore: matchingTaggedReflections must be a non-negative number');
  }
  if (typeof relevantTaggedReflections !== 'number' || relevantTaggedReflections < 0) {
    throw new Error('calculateConsistencyScore: relevantTaggedReflections must be a non-negative number');
  }
  if (matchingTaggedReflections > relevantTaggedReflections) {
    throw new Error('calculateConsistencyScore: matchingTaggedReflections cannot exceed relevantTaggedReflections');
  }
  if (relevantTaggedReflections === 0) return 0;
  return matchingTaggedReflections / relevantTaggedReflections;
}

/**
 * Collapses IEEE-754 binary floating point noise (e.g. 0.9099999999999999
 * from 0.40*1.00 + 0.30*0.70 + 0.30*1.00) without reducing meaningful
 * precision — the three §6.3 sub-scores only ever land on multiples of
 * 0.05 today, so 10 decimal places is far beyond any real precision this
 * formula produces. This is noise correction, not display rounding; the
 * ADR's "do not round internally" instruction is about not truncating
 * evidenceScore/consistencyScore/recencyScore before combining them,
 * which this does not do.
 *
 * @param {number} value
 * @returns {number}
 */
function collapseFloatNoise(value) {
  return Math.round(value * 1e10) / 1e10;
}

/**
 * confidence (§6.3, final reconciled formula — the single canonical
 * version; no other weight set is valid):
 *
 *   confidence = 0.40 × evidenceScore + 0.30 × consistencyScore + 0.30 × recencyScore
 *
 * @param {object} scores
 * @param {number} scores.evidenceScore
 * @param {number} scores.consistencyScore
 * @param {number} scores.recencyScore
 * @returns {number}
 */
function calculateConfidence({ evidenceScore, consistencyScore, recencyScore }) {
  [['evidenceScore', evidenceScore], ['consistencyScore', consistencyScore], ['recencyScore', recencyScore]]
    .forEach(([name, value]) => {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        throw new Error(`calculateConfidence: ${name} must be a number`);
      }
    });

  const raw = (0.40 * evidenceScore) + (0.30 * consistencyScore) + (0.30 * recencyScore);
  return collapseFloatNoise(raw);
}

/**
 * confidenceLabel (§6.3): deterministic label derived from the numeric
 * confidence score, evaluated in this order — first match wins:
 *
 *   confidence >= 0.75             → "High"
 *   0.45 <= confidence < 0.75      → "Medium"
 *   confidence < 0.45              → "Low"
 *
 * Exposed so presentation layers never need to duplicate these
 * thresholds or parse the explanation string to recover the label.
 *
 * @param {number} confidence
 * @returns {'High'|'Medium'|'Low'}
 */
function confidenceLabel(confidence) {
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
    throw new Error('confidenceLabel: confidence must be a number');
  }
  if (confidence >= 0.75) return 'High';
  if (confidence >= 0.45) return 'Medium';
  return 'Low';
}

// ── Recommendation pipeline (ADR-013 §6.4) ──────────────────────────────
//
// Mechanics only — no domain-specific rule catalogue lives here. Every
// function in this section takes candidate objects shaped
// `{ topicId, recommendation, confidence, evidence }` and doesn't care
// which rule produced them or in what order; per the ADR, "rules execute
// independently of one another and of registration/execution order,"
// which is exactly what makes deduplication-after-generation (rather
// than short-circuiting inside a rule) safe here.

/**
 * Looks up a candidate's topic `order` for the tie-break sort. Throws
 * rather than silently defaulting if a candidate references a topicId
 * outside the active taxonomy — unlike evidence retrieval (§6.1), where
 * a stale topic_id on a *persisted row* is expected and must degrade
 * gracefully, a recommendation *candidate* is something the rules layer
 * just generated in this same request; it referencing an invalid topic
 * is a bug in that rule, not stale data to route around silently.
 *
 * @param {string} topicId
 * @returns {number}
 */
function requireTopicOrder(topicId) {
  const topic = getTopicById(topicId);
  if (!topic) {
    throw new Error(`requireTopicOrder: candidate references unknown topicId "${topicId}"`);
  }
  return topic.order;
}

/**
 * Deduplication (§6.4): "keep only the highest-confidence recommendation
 * per topic." Guarantees the engine never emits two contradictory
 * recommendations for the same topic — only the strongest survives.
 * On a confidence tie for the same topic, the first-encountered
 * candidate is kept (stable), since nothing downstream distinguishes
 * between them anyway — sorting/tie-breaking is a separate concern
 * (see `sortRecommendations`), not this function's job.
 *
 * @param {object[]} candidates
 * @returns {object[]} one candidate per distinct topicId, order not yet meaningful.
 */
function deduplicateRecommendationsByTopic(candidates) {
  const bestByTopic = new Map();

  for (const candidate of candidates) {
    const existing = bestByTopic.get(candidate.topicId);
    if (!existing || candidate.confidence > existing.confidence) {
      bestByTopic.set(candidate.topicId, candidate);
    }
  }

  return [...bestByTopic.values()];
}

/**
 * Sort (§6.4): confidence descending; ties broken by topic `order`
 * ascending; any remaining tie broken by `topicId` ascending
 * (lexicographic). The three-level tie-break guarantees stable ordering
 * even if two topics are ever accidentally assigned the same `order`
 * value — `order` is expected unique, but this sort does not depend on
 * that as a precondition.
 *
 * Does not mutate the input array.
 *
 * @param {object[]} candidates
 * @returns {object[]} new array, sorted.
 */
function sortRecommendations(candidates) {
  // Resolve every candidate's topic order upfront rather than lazily
  // inside the comparator. Array.prototype.sort does not guarantee
  // calling the comparator at all for arrays of length <= 1, so an
  // invalid topicId on a single-candidate input would otherwise slip
  // through undetected.
  const orderByTopicId = new Map(
    candidates.map((c) => [c.topicId, requireTopicOrder(c.topicId)])
  );

  return [...candidates].sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;

    const orderA = orderByTopicId.get(a.topicId);
    const orderB = orderByTopicId.get(b.topicId);
    if (orderA !== orderB) return orderA - orderB;

    if (a.topicId < b.topicId) return -1;
    if (a.topicId > b.topicId) return 1;
    return 0;
  });
}

/**
 * Truncate (§6.4): "return the first DEFAULT_MAX_INSIGHTS." Assumes
 * `candidates` is already sorted — this function does no sorting of its
 * own, it only slices.
 *
 * @param {object[]} candidates
 * @param {number} [maxInsights=DEFAULT_MAX_INSIGHTS]
 * @returns {object[]}
 */
function truncateRecommendations(candidates, maxInsights = DEFAULT_MAX_INSIGHTS) {
  return candidates.slice(0, maxInsights);
}

/**
 * Orchestrates the full §6.4 pipeline against a flat list of
 * already-scored candidates from (any number of) rules, run in any
 * order:
 *
 *   dedupe by topic (keep highest confidence)
 *     → sort (confidence desc, order asc, topicId asc)
 *     → truncate to maxInsights
 *
 * This is the only function in this section that combines the three
 * steps — callers needing just one step (e.g. a test asserting
 * dedup behavior in isolation) should call that step directly instead.
 *
 * @param {object[]} candidates - `{ topicId, recommendation, confidence, evidence }[]`
 * @param {object} [options]
 * @param {number} [options.maxInsights=DEFAULT_MAX_INSIGHTS]
 * @returns {object[]}
 */
function processRecommendationCandidates(candidates, { maxInsights = DEFAULT_MAX_INSIGHTS } = {}) {
  const deduped = deduplicateRecommendationsByTopic(candidates);
  const sorted = sortRecommendations(deduped);
  return truncateRecommendations(sorted, maxInsights);
}

/**
 * Public API (§6.7). Returns structured data only — no formatting, no
 * WhatsApp markup, no markdown — so this can be called identically from
 * a future `MY INSIGHTS` WhatsApp command and a dashboard route.
 *
 * Increment-1 scope: the insufficient-data guard is fully wired. Once
 * data is sufficient, confidence scoring (§6.3) and recommendation rules
 * (§6.4) are what would normally populate `recommendations` — those land
 * in the next PR33 increment, so for now a sufficient-data teacher
 * correctly gets `status: "ok"` with an empty recommendation list rather
 * than this function fabricating output ahead of the rules that are
 * supposed to produce it.
 *
 * @param {string} phoneHash
 * @param {object} [options]
 * @returns {{status: string, summary: (string|null), recommendations: object[], generatedAt: string}}
 */
function getCoachingInsights(phoneHash, options = {}) { // eslint-disable-line no-unused-vars
  if (!phoneHash || typeof phoneHash !== 'string') {
    throw new Error('getCoachingInsights: phoneHash is required');
  }

  const guard = checkInsufficientDataGuard(phoneHash);
  if (!guard.sufficient) {
    return {
      status: 'insufficient_data',
      summary: null,
      recommendations: [],
      generatedAt: new Date().toISOString(),
    };
  }

  return {
    status: 'ok',
    summary: null,
    recommendations: [],
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  DEFAULT_REQUIRED_EVIDENCE,
  DEFAULT_MAX_INSIGHTS,
  MIN_REFLECTIONS_FOR_SUFFICIENT_DATA,
  MIN_ACTIVE_GROWTH_PLANS_FOR_SUFFICIENT_DATA,
  hasUsableTopic,
  checkInsufficientDataGuard,
  getTaggedReflections,
  getTaggedGrowthPlans,
  gatherEvidenceByTopic,
  calculateEvidenceScore,
  calculateRecencyScore,
  calculateConsistencyScore,
  calculateConfidence,
  confidenceLabel,
  deduplicateRecommendationsByTopic,
  sortRecommendations,
  truncateRecommendations,
  processRecommendationCandidates,
  getCoachingInsights,
};
