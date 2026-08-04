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

const { isValidTopicId, getTopicById, listTopicsOrdered } = require('../utils/qmsTopics');
const reflectionService = require('./reflectionService');
const growthPlanService = require('./growthPlanService');
const { parseSqliteUtc } = require('../utils/dateUtils');
// coachingTrendService requires this module (for buildTopicContexts) at its
// own top level, so requiring it here at top level too would create a
// require cycle where one side sees an incomplete module.exports. Required
// lazily inside buildTopicContexts() instead — by the time it's actually
// called, both modules have finished loading.
let coachingTrendService = null;
function getTrendService() {
  if (!coachingTrendService) {
    coachingTrendService = require('./coachingTrendService');
  }
  return coachingTrendService;
}

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

/** PR36: low_confidence_recommendation rule fires when confidence is below this. */
const LOW_CONFIDENCE_THRESHOLD = 0.45;

/** PR36: stale_evidence rule fires when the newest evidence is older than this (days). */
const STALE_EVIDENCE_THRESHOLD_DAYS = 60;

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
 * Sort (§6.4, revised by ADR-017 §3/§4): `priority` descending (the rule
 * that produced the candidate), then `confidence` descending, then topic
 * `order` ascending, then `topicId` ascending (lexicographic) as a final
 * tiebreak. The priority tier lets a categorical rule (e.g.
 * `growth_plan_missing`) always outrank a lower-priority rule (e.g.
 * `trend_falling`) regardless of either one's confidence score — see
 * ADR-017 §3 for the full priority ladder and rationale. Below a shared
 * priority, ordering degrades to the original PR36 confidence-first
 * contract unchanged.
 *
 * A candidate missing a numeric `priority` is treated as priority 0 —
 * this only matters for candidates hand-built in tests that predate
 * ADR-017; real rule output always carries a real priority because
 * validateRecommendationRules() enforces it at load time.
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
    const priorityA = Number.isFinite(a.priority) ? a.priority : 0;
    const priorityB = Number.isFinite(b.priority) ? b.priority : 0;
    if (priorityB !== priorityA) return priorityB - priorityA;

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

// ── Rule context (feeds §6.4 rules + §6.5 explanations) ─────────────────
//
// Builds, per topic, everything a rule or the explanation template needs
// to make a decision — evidence refs, the three §6.3 sub-scores, the
// combined confidence, and the raw counts the explanation template quotes
// verbatim. Built once per getCoachingInsights() call and handed to every
// rule unchanged, which is what makes "rules execute independently of
// registration/execution order" (§6.4) true in practice: no rule mutates
// this, no rule reads another rule's output, every rule sees the same
// snapshot regardless of catalogue order.

/**
 * Age in whole days between now and a SQLite UTC timestamp. Mirrors the
 * clamping behavior calculateRecencyScore already expects (a clock-skewed
 * or future-dated row still just falls in the "≤30 days" bucket there).
 *
 * @param {string} sqliteDatetime
 * @returns {number}
 */
function ageInDays(sqliteDatetime) {
  const then = parseSqliteUtc(sqliteDatetime);
  const ms = Date.now() - then.getTime();
  return ms / (1000 * 60 * 60 * 24);
}

/**
 * The last 10 tagged reflections (§6.3 consistencyScore window), newest
 * first. "Tagged" here means currently-usable per §6.1, matching the same
 * treatment gatherEvidenceByTopic() already applies.
 *
 * @param {string} phoneHash
 * @returns {object[]}
 */
function getRecentTaggedReflectionsWindow(phoneHash) {
  return getTaggedReflections(phoneHash)
    .slice()
    .sort((a, b) => parseSqliteUtc(b.createdAt) - parseSqliteUtc(a.createdAt))
    .slice(0, 10);
}

/**
 * Builds the full per-topic rule context for every topic in the active
 * taxonomy (§4.1) — including topics with no currently-usable evidence
 * at all.
 *
 * Revised by ADR-016 (coaching trend architecture): the original PR33
 * contract omitted zero-evidence topics entirely, on the reasoning that
 * there was nothing for a rule to evaluate. That was fine for a
 * single-snapshot engine, but once history is persisted (PR37) it breaks
 * silently: a topic whose only evidence is later deleted (or reassigned
 * away) simply vanishes from this map, so nothing downstream ever
 * records that its confidence dropped — trend history freezes at the
 * old value with no signal that evidence disappeared. Returning a
 * `hasEvidence: false, confidence: 0` context for every untouched/
 * emptied topic instead means the snapshot writer, trend engine, and
 * rules all see one consistent, complete state per topic — no component
 * has to separately track "did this topic just disappear".
 *
 * Rules must not blindly evaluate zero-evidence contexts: only
 * `recurring_topic_pattern` and `low_confidence_recommendation` need an
 * explicit `ctx.hasEvidence`/`ctx.evidenceCount > 0` guard (see
 * RECOMMENDATION_RULES below) — `growth_plan_missing` and
 * `stale_evidence` already gate on evidence being present as a side
 * effect of their own `applies()` checks.
 *
 * @param {string} phoneHash
 * @returns {Map<string, object>} topicId → {
 *   topicId, topic, evidence, evidenceCount, hasEvidence, ageDaysNewest,
 *   matchingTaggedReflections, relevantTaggedReflections,
 *   evidenceScore, recencyScore, consistencyScore, confidence, confidenceLabel
 * }
 */
function buildTopicContexts(phoneHash) {
  const evidenceByTopic = gatherEvidenceByTopic(phoneHash);
  const taggedReflections = getTaggedReflections(phoneHash);
  const taggedGrowthPlans = getTaggedGrowthPlans(phoneHash);
  const recentWindow = getRecentTaggedReflectionsWindow(phoneHash);
  const relevantTaggedReflections = recentWindow.length;

  const recordsByTopic = new Map();
  taggedReflections.forEach((r) => {
    if (!recordsByTopic.has(r.topicId)) recordsByTopic.set(r.topicId, []);
    recordsByTopic.get(r.topicId).push(r.createdAt);
  });
  taggedGrowthPlans.forEach((p) => {
    if (!recordsByTopic.has(p.topicId)) recordsByTopic.set(p.topicId, []);
    recordsByTopic.get(p.topicId).push(p.createdAt);
  });

  // PR36: derived from taggedGrowthPlans, already fetched above — no new
  // query. Lets growth_plan_missing distinguish "no growth plan at all
  // for this topic" from "has one, but it's completed/abandoned", which
  // ctx.evidence (a bare {type,id} list) can't express on its own.
  const hasActiveGrowthPlanByTopic = new Set(
    taggedGrowthPlans.filter((p) => p.status === 'active').map((p) => p.topicId)
  );

  const contexts = new Map();

  for (const topic of listTopicsOrdered()) {
    const topicId = topic.id;
    const evidence = evidenceByTopic.get(topicId) || [];
    const hasEvidence = evidence.length > 0;

    const timestamps = recordsByTopic.get(topicId) || [];
    const ageDaysNewest = timestamps.length
      ? Math.min(...timestamps.map(ageInDays))
      : Infinity;

    const matchingTaggedReflections = recentWindow
      .filter((r) => r.topicId === topicId).length;

    const evidenceScore = calculateEvidenceScore(evidence.length);
    // A topic with no evidence has no "newest evidence" to be fresh or
    // stale — recencyScore is 0, not calculateRecencyScore(Infinity)
    // (which would land in the ">180 days" bucket at 0.25, wrongly
    // implying stale-but-present evidence for a topic that has none).
    const recencyScore = hasEvidence
      ? calculateRecencyScore(ageDaysNewest)
      : 0;
    const consistencyScore = calculateConsistencyScore(
      matchingTaggedReflections,
      relevantTaggedReflections
    );
    const confidence = calculateConfidence({ evidenceScore, consistencyScore, recencyScore });

    contexts.set(topicId, {
      topicId,
      topic,
      evidence,
      evidenceCount: evidence.length,
      hasEvidence,
      ageDaysNewest,
      matchingTaggedReflections,
      relevantTaggedReflections,
      evidenceScore,
      recencyScore,
      consistencyScore,
      confidence,
      confidenceLabel: confidenceLabel(confidence),
      hasActiveGrowthPlan: hasActiveGrowthPlanByTopic.has(topicId),
    });
  }

  // PR39 (ADR-017 §2): trend is attached in a second pass, once every
  // topic's base context (in particular its confidence) already exists.
  // coachingTrendService.getLatestTrend() is given this same `contexts`
  // map as its precomputedContexts argument so it never has to rebuild
  // contexts itself — calling it without that argument here would recurse
  // forever (getLatestTrend -> buildTopicContexts -> getLatestTrend ->
  // ...). Every context always carries a ctx.trend object — either
  // { status: 'baseline' } or a full trend result — so trend rules can
  // gate on ctx.trend.status uniformly without a defensive null-check at
  // every call site.
  for (const [topicId, ctx] of contexts) {
    ctx.trend = getTrendService().getLatestTrend(phoneHash, topicId, contexts);
  }

  return contexts;
}

// ── Recommendation rule catalogue (ADR-013 §6.4) ────────────────────────
//
// Each rule is `{ id, applies(ctx), evaluate(ctx) }`:
//   - applies(ctx)  → boolean, pure, reads only the topic context passed in
//   - evaluate(ctx) → { topicId, recommendation, confidence, evidence }
// Rules never read another rule's output and never read or affect
// execution order — see runRules() below. Adding a new rule means adding
// a new entry here; nothing else in this file changes.

// PR36: three additional rules, all evaluated purely from the TopicContext
// buildTopicContexts() already produces — no trend analysis, no new
// database queries, no schema changes. Each `applies()` predicate below
// is written to be mutually exclusive with the others for a given topic
// (growth_plan_missing > stale_evidence > low_confidence_recommendation >
// recurring_topic_pattern, most-specific first), so at most one rule ever
// fires per topic. This is deliberate: dedupeRecommendationsByTopic()
// only keeps the highest-confidence candidate per topic and breaks ties
// by first-inserted, which would otherwise make the final output depend
// on catalogue order whenever two rules tie on confidence for the same
// topic — exactly what §6.4's order-independence guarantee rules out.
// Mutual exclusivity via applies() (not via one rule reading another's
// output) keeps every rule pure and order-independent by construction.

/** PR36: reflections exist for the topic, but no *active* growth plan does. */
function growthPlanMissingApplies(ctx) {
  return ctx.evidence.some((e) => e.type === 'reflection') && !ctx.hasActiveGrowthPlan;
}

/** PR36: the newest supporting evidence for the topic has gone stale. */
function staleEvidenceApplies(ctx) {
  return Number.isFinite(ctx.ageDaysNewest) && ctx.ageDaysNewest > STALE_EVIDENCE_THRESHOLD_DAYS;
}

/** PR36: confidence is below the threshold for acting on the recommendation. */
function lowConfidenceApplies(ctx) {
  return ctx.confidence < LOW_CONFIDENCE_THRESHOLD;
}

// PR39 (ADR-017): trend-aware rules layered onto the same catalogue.
// Each reads coachingTrendService.getLatestTrend(phoneHash, topicId)
// itself rather than having trend data threaded through ctx, since
// buildTopicContexts() is a pure, trend-unaware function per ADR-016 §9
// (trend augments the engine, it isn't baked into the base context).
// Every trend rule's applies() begins with the ctx.trend.status === 'trend'
// baseline guard (ADR-017 §2) — a topic with no prior snapshot history
// contributes no trend-based recommendation and falls through to the
// PR36 rules unchanged.

/** PR39: newest evidence appeared where none existed at the last snapshot. */
function evidenceGainedApplies(ctx) {
  return ctx.trend.status === 'trend' && ctx.trend.evidenceTransition === 'gained';
}

/** PR39: evidence that existed at the last snapshot is gone now. */
function evidenceRemovedApplies(ctx) {
  return ctx.trend.status === 'trend' && ctx.trend.evidenceTransition === 'lost';
}

/** PR39: confidence has fallen meaningfully since the last snapshot. */
function trendFallingApplies(ctx) {
  return ctx.trend.status === 'trend' && ctx.trend.trendDirection === 'falling';
}

/** PR39: confidence has risen meaningfully since the last snapshot. */
function trendRisingApplies(ctx) {
  return ctx.trend.status === 'trend' && ctx.trend.trendDirection === 'rising';
}

const RECOMMENDATION_RULES = [
  {
    id: 'growth_plan_missing',
    messageId: 'growth_plan_missing',
    priority: 100,
    applies: (ctx) => growthPlanMissingApplies(ctx),
    evaluate: (ctx) => ({
      topicId: ctx.topicId,
      priority: 100,
      messageId: 'growth_plan_missing',
      recommendation: `You have identified a recurring pattern in ${ctx.topic.label} `
        + `but don't yet have an active growth plan.`,
      confidence: ctx.confidence,
      evidence: ctx.evidence,
      // ADR-018 Phase 1: populated alongside `recommendation` but not yet
      // consumed anywhere — coachingMessageRenderer can already render
      // from this today; `recommendation` itself only stops being
      // hand-composed here in Phase 2.
      templateData: { topicLabel: ctx.topic.label },
    }),
  },
  {
    id: 'evidence_removed',
    messageId: 'evidence_removed',
    priority: 90,
    // Mutually exclusive with growth_plan_missing (higher priority, so it
    // wins on priority alone even if both applied) — excluded here anyway
    // to keep applies() self-documenting about which rule "owns" a topic.
    applies: (ctx) => !growthPlanMissingApplies(ctx) && evidenceRemovedApplies(ctx),
    evaluate: (ctx) => ({
      topicId: ctx.topicId,
      priority: 90,
      messageId: 'evidence_removed',
      recommendation: `Evidence you previously recorded for ${ctx.topic.label} is no `
        + `longer present. Confirm whether this topic still needs attention.`,
      confidence: ctx.confidence,
      evidence: ctx.evidence,
      templateData: { topicLabel: ctx.topic.label },
    }),
  },
  {
    id: 'stale_evidence',
    messageId: 'stale_evidence',
    priority: 80,
    applies: (ctx) => !growthPlanMissingApplies(ctx)
      && !evidenceRemovedApplies(ctx)
      && staleEvidenceApplies(ctx),
    evaluate: (ctx) => ({
      topicId: ctx.topicId,
      priority: 80,
      messageId: 'stale_evidence',
      recommendation: `You haven't recorded recent evidence for ${ctx.topic.label}. `
        + `Add a recent reflection to keep recommendations current.`,
      confidence: ctx.confidence,
      evidence: ctx.evidence,
      templateData: { topicLabel: ctx.topic.label },
    }),
  },
  {
    id: 'trend_falling',
    messageId: 'trend_falling',
    priority: 70,
    applies: (ctx) => !growthPlanMissingApplies(ctx)
      && !evidenceRemovedApplies(ctx)
      && !staleEvidenceApplies(ctx)
      && trendFallingApplies(ctx),
    evaluate: (ctx) => ({
      topicId: ctx.topicId,
      priority: 70,
      messageId: 'trend_falling',
      recommendation: `Your confidence in ${ctx.topic.label} has declined since your `
        + `last check-in. Consider revisiting this area soon.`,
      confidence: ctx.confidence,
      evidence: ctx.evidence,
      templateData: {
        topicLabel: ctx.topic.label,
        currentConfidence: ctx.trend.currentConfidence,
        previousConfidence: ctx.trend.lastConfidence,
      },
    }),
  },
  {
    id: 'evidence_gained',
    messageId: 'evidence_gained',
    priority: 60,
    applies: (ctx) => !growthPlanMissingApplies(ctx)
      && !evidenceRemovedApplies(ctx)
      && !staleEvidenceApplies(ctx)
      && !trendFallingApplies(ctx)
      && evidenceGainedApplies(ctx),
    evaluate: (ctx) => ({
      topicId: ctx.topicId,
      priority: 60,
      messageId: 'evidence_gained',
      recommendation: `New evidence has appeared for ${ctx.topic.label} since your last `
        + `check-in. Keep building on this momentum.`,
      confidence: ctx.confidence,
      evidence: ctx.evidence,
      templateData: { topicLabel: ctx.topic.label },
    }),
  },
  {
    id: 'low_confidence_recommendation',
    messageId: 'low_confidence_recommendation',
    priority: 50,
    applies: (ctx) => ctx.hasEvidence
      && !growthPlanMissingApplies(ctx)
      && !evidenceRemovedApplies(ctx)
      && !staleEvidenceApplies(ctx)
      && !trendFallingApplies(ctx)
      && !evidenceGainedApplies(ctx)
      && lowConfidenceApplies(ctx),
    evaluate: (ctx) => ({
      topicId: ctx.topicId,
      priority: 50,
      messageId: 'low_confidence_recommendation',
      recommendation: 'Evidence is currently limited for this recommendation. '
        + 'Continue recording reflections before making major changes.',
      confidence: ctx.confidence,
      evidence: ctx.evidence,
      templateData: {},
    }),
  },
  {
    id: 'trend_rising',
    messageId: 'trend_rising',
    priority: 40,
    applies: (ctx) => !growthPlanMissingApplies(ctx)
      && !evidenceRemovedApplies(ctx)
      && !staleEvidenceApplies(ctx)
      && !trendFallingApplies(ctx)
      && !evidenceGainedApplies(ctx)
      && !lowConfidenceApplies(ctx)
      && trendRisingApplies(ctx),
    evaluate: (ctx) => ({
      topicId: ctx.topicId,
      priority: 40,
      messageId: 'trend_rising',
      recommendation: `Your confidence in ${ctx.topic.label} has improved since your `
        + `last check-in. Keep up the current approach.`,
      confidence: ctx.confidence,
      evidence: ctx.evidence,
      templateData: {
        topicLabel: ctx.topic.label,
        currentConfidence: ctx.trend.currentConfidence,
        previousConfidence: ctx.trend.lastConfidence,
      },
    }),
  },
  {
    id: 'recurring_topic_pattern',
    messageId: 'recurring_topic_pattern',
    priority: 10,
    // Any topic with currently-usable evidence is an applicable pattern —
    // the insufficient-data guard (§6.6) already establishes there's
    // enough data overall before rules ever run. Falls through only when
    // none of the more specific rules above applied.
    applies: (ctx) => ctx.evidenceCount > 0
      && !growthPlanMissingApplies(ctx)
      && !evidenceRemovedApplies(ctx)
      && !staleEvidenceApplies(ctx)
      && !trendFallingApplies(ctx)
      && !evidenceGainedApplies(ctx)
      && !lowConfidenceApplies(ctx)
      && !trendRisingApplies(ctx),
    evaluate: (ctx) => ({
      topicId: ctx.topicId,
      priority: 10,
      messageId: 'recurring_topic_pattern',
      recommendation: `Continue focused coaching support on ${ctx.topic.label}.`,
      confidence: ctx.confidence,
      evidence: ctx.evidence,
      templateData: { topicLabel: ctx.topic.label },
    }),
  },
];

/**
 * ADR-017 §7: every recommendation rule must declare a numeric priority.
 * A missing or non-numeric priority is a configuration error and must
 * fail loudly at load time, not silently at sort time (where it would
 * otherwise be treated as priority 0 by sortRecommendations()'s fallback).
 *
 * @param {object[]} [rules=RECOMMENDATION_RULES]
 * @throws {Error} if any rule lacks a finite numeric priority.
 */
function validateRecommendationRules(rules = RECOMMENDATION_RULES) {
  for (const rule of rules) {
    if (!Number.isFinite(rule.priority)) {
      throw new Error(`Recommendation rule '${rule.id}' is missing a numeric priority`);
    }
  }
}

validateRecommendationRules(RECOMMENDATION_RULES);

/**
 * Runs every rule in the catalogue against every topic context and
 * collects the resulting candidates into a single flat list. Iteration
 * order (rules-outer/topics-inner here) is not meaningful — §6.4
 * guarantees the same final output regardless of it, since deduplication
 * and sorting happen entirely afterward in processRecommendationCandidates().
 *
 * @param {Map<string, object>} topicContexts
 * @param {object[]} [rules=RECOMMENDATION_RULES]
 * @returns {object[]} candidates: `{topicId, recommendation, confidence, evidence}[]`
 */
function runRules(topicContexts, rules = RECOMMENDATION_RULES) {
  const candidates = [];
  for (const rule of rules) {
    for (const ctx of topicContexts.values()) {
      if (rule.applies(ctx)) {
        candidates.push(rule.evaluate(ctx));
      }
    }
  }
  return candidates;
}

// ── Explanation generation (ADR-013 §6.5) ───────────────────────────────

/**
 * Template-generates the `explanation` field from the same inputs as the
 * confidence score — never free text, never LLM-authored at this layer,
 * per §6.5's explicit rationale (this field must stay reproducible, not
 * reintroduce non-determinism).
 *
 * Fixed template:
 *   "Supported by {evidenceCount} evidence item(s). Observed in {matching}
 *   of the last {relevant} tagged reflections. Latest supporting
 *   evidence: {ageDays} days ago. Confidence: {confidenceLabel}."
 *
 * @param {object} ctx - a topic context from buildTopicContexts().
 * @returns {string}
 */
function generateExplanation(ctx) {
  const ageDays = Number.isFinite(ctx.ageDaysNewest)
    ? Math.round(ctx.ageDaysNewest)
    : 'unknown';

  return `Supported by ${ctx.evidenceCount} evidence item(s). `
    + `Observed in ${ctx.matchingTaggedReflections} of the last `
    + `${ctx.relevantTaggedReflections} tagged reflections. `
    + `Latest supporting evidence: ${ageDays} days ago. `
    + `Confidence: ${ctx.confidenceLabel}.`;
}

/**
 * Public API (§6.7). Returns structured data only — no formatting, no
 * WhatsApp markup, no markdown — so this can be called identically from
 * a future `MY INSIGHTS` WhatsApp command and a dashboard route.
 *
 * Full pipeline (increment 4):
 *   guard → buildTopicContexts() → runRules() →
 *   processRecommendationCandidates() → attach topicLabel + explanation
 *
 * @param {string} phoneHash
 * @param {object} [options]
 * @param {number} [options.maxInsights=DEFAULT_MAX_INSIGHTS]
 * @returns {{status: string, summary: (string|null), recommendations: object[], generatedAt: string}}
 */
function getCoachingInsights(phoneHash, options = {}) {
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

  const topicContexts = buildTopicContexts(phoneHash);
  const candidates = runRules(topicContexts);
  const { maxInsights = DEFAULT_MAX_INSIGHTS } = options;
  const finalCandidates = processRecommendationCandidates(candidates, { maxInsights });

  const recommendations = finalCandidates.map((candidate) => {
    const ctx = topicContexts.get(candidate.topicId);
    return {
      topicId: candidate.topicId,
      topicLabel: ctx.topic.label,
      recommendation: candidate.recommendation,
      confidence: candidate.confidence,
      confidenceLabel: confidenceLabel(candidate.confidence),
      evidence: candidate.evidence,
      explanation: generateExplanation(ctx),
    };
  });

  return {
    status: 'ok',
    summary: null,
    recommendations,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  DEFAULT_REQUIRED_EVIDENCE,
  DEFAULT_MAX_INSIGHTS,
  MIN_REFLECTIONS_FOR_SUFFICIENT_DATA,
  MIN_ACTIVE_GROWTH_PLANS_FOR_SUFFICIENT_DATA,
  LOW_CONFIDENCE_THRESHOLD,
  STALE_EVIDENCE_THRESHOLD_DAYS,
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
  buildTopicContexts,
  runRules,
  generateExplanation,
  getCoachingInsights,
  RECOMMENDATION_RULES,
  validateRecommendationRules,
};
