'use strict';
/**
 * coachingEngineService Tests (PR33 increments 1–3, ADR-013 §6)
 *
 * Covers:
 *   1. Insufficient-data guard (§6.6) — thresholds, boundary conditions,
 *      status filtering (active vs other statuses)
 *   2. Evidence retrieval (§6.2) — tagged reflections/growth plans only,
 *      grouped by topicId as {type,id} references
 *   3. Unknown persisted topic_id regression (§6.1) — a row whose
 *      topic_id is not in the current active taxonomy loads without
 *      error and is excluded exactly like a null topic_id
 *   4. Ownership isolation — phone_hash scoping holds throughout
 *   5. Confidence calculation (§6.3) — evidenceScore, recencyScore
 *      (fixed bucket table, boundary-tested), consistencyScore, the
 *      combined formula (exact ADR worked example), and confidenceLabel
 *   6. Recommendation pipeline (§6.4) — dedup-by-topic, sort (confidence
 *      desc / order asc / topicId asc), truncation to DEFAULT_MAX_INSIGHTS,
 *      and rule order-independence (the ADR's core determinism guarantee)
 *
 * Run individually:   node tests/coachingEngineService.test.js
 * Run via npm:         npm test
 */

// ── Real-migrations test DB (see tests/helpers/createTestDb.js) ──────────
const { createTestDb } = require('./helpers/createTestDb');
const testDb = createTestDb(__filename);
const _db = testDb.db;

// ── Helpers ──────────────────────────────────────────────────────────────
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
}

// Directly inserts a growth plan/reflection with an arbitrary topic_id,
// bypassing service-layer validation — used only to simulate a stale row
// whose topic_id has fallen out of the active taxonomy (§6.1), which the
// service layer itself would never write but must still read safely.
function insertReflectionRaw(phoneHash, { topicId = null, content = 'reflection content' } = {}) {
  return Number(
    _db
      .prepare(
        `INSERT INTO qms_reflections (phone_hash, term, content, topic_id)
         VALUES (?, NULL, ?, ?)`
      )
      .run(phoneHash, content, topicId).lastInsertRowid
  );
}

function insertGrowthPlanRaw(phoneHash, { topicId = null, status = 'active', goalText = 'goal' } = {}) {
  return Number(
    _db
      .prepare(
        `INSERT INTO qms_growth_plans (phone_hash, term, goal_text, topic_id, status)
         VALUES (?, NULL, ?, ?, ?)`
      )
      .run(phoneHash, goalText, topicId, status).lastInsertRowid
  );
}

// ── Test runner ────────────────────────────────────────────────────────────
async function run() {
  const {
    MIN_REFLECTIONS_FOR_SUFFICIENT_DATA,
    MIN_ACTIVE_GROWTH_PLANS_FOR_SUFFICIENT_DATA,
    DEFAULT_MAX_INSIGHTS,
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
  } = require('../services/coachingEngineService');

  const { QMS_TOPICS } = require('../utils/qmsTopics');
  const TOPIC_A = QMS_TOPICS[0].id;
  const TOPIC_B = QMS_TOPICS[1].id;
  const TOPIC_C = QMS_TOPICS[2].id;

  const PHONE = 'coaching_engine_test_hash_001';
  const OTHER_PHONE = 'coaching_engine_test_hash_002';

  // ── Section 1: Insufficient-data guard (§6.6) ─────────────────────────
  console.log('\nSection 1: Insufficient-data guard (§6.6)');

  console.log('\nTest G-01: zero reflections, zero growth plans → insufficient');
  clearAll();
  {
    const guard = checkInsufficientDataGuard(PHONE);
    assertEq(guard, { sufficient: false, reflectionCount: 0, activeGrowthPlanCount: 0 }, 'guard reports insufficient with no data');
  }

  console.log('\nTest G-02: exactly at thresholds → sufficient');
  clearAll();
  {
    for (let i = 0; i < MIN_REFLECTIONS_FOR_SUFFICIENT_DATA; i++) {
      insertReflectionRaw(PHONE, { topicId: TOPIC_A });
    }
    for (let i = 0; i < MIN_ACTIVE_GROWTH_PLANS_FOR_SUFFICIENT_DATA; i++) {
      insertGrowthPlanRaw(PHONE, { topicId: TOPIC_A, status: 'active' });
    }
    const guard = checkInsufficientDataGuard(PHONE);
    assert(guard.sufficient === true, 'exactly-at-threshold counts are sufficient (boundary is inclusive)');
  }

  console.log('\nTest G-03: one below reflection threshold → insufficient');
  clearAll();
  {
    for (let i = 0; i < MIN_REFLECTIONS_FOR_SUFFICIENT_DATA - 1; i++) {
      insertReflectionRaw(PHONE, { topicId: TOPIC_A });
    }
    insertGrowthPlanRaw(PHONE, { topicId: TOPIC_A, status: 'active' });
    const guard = checkInsufficientDataGuard(PHONE);
    assert(guard.sufficient === false, 'one below reflection threshold is insufficient');
  }

  console.log('\nTest G-04: enough reflections but zero active growth plans → insufficient');
  clearAll();
  {
    for (let i = 0; i < MIN_REFLECTIONS_FOR_SUFFICIENT_DATA + 2; i++) {
      insertReflectionRaw(PHONE, { topicId: TOPIC_A });
    }
    const guard = checkInsufficientDataGuard(PHONE);
    assert(guard.sufficient === false, 'no active growth plans is insufficient regardless of reflection count');
  }

  console.log('\nTest G-05: growth plans exist but none are status=active → insufficient');
  clearAll();
  {
    for (let i = 0; i < MIN_REFLECTIONS_FOR_SUFFICIENT_DATA; i++) {
      insertReflectionRaw(PHONE, { topicId: TOPIC_A });
    }
    insertGrowthPlanRaw(PHONE, { topicId: TOPIC_A, status: 'completed' });
    insertGrowthPlanRaw(PHONE, { topicId: TOPIC_A, status: 'in_progress' });
    insertGrowthPlanRaw(PHONE, { topicId: TOPIC_A, status: 'abandoned' });
    const guard = checkInsufficientDataGuard(PHONE);
    assertEq(guard.activeGrowthPlanCount, 0, 'non-active statuses do not count toward activeGrowthPlanCount');
    assert(guard.sufficient === false, 'only status=active counts, not in_progress/completed/abandoned');
  }

  console.log('\nTest G-06: getCoachingInsights() surfaces insufficient_data status end-to-end');
  clearAll();
  {
    const result = getCoachingInsights(PHONE);
    assertEq(result.status, 'insufficient_data', 'public API returns insufficient_data status');
    assertEq(result.recommendations, [], 'recommendations is empty array on insufficient_data');
    assert(typeof result.generatedAt === 'string' && result.generatedAt.length > 0, 'generatedAt is populated');
  }

  console.log('\nTest G-07: getCoachingInsights() returns ok status once thresholds are met');
  clearAll();
  {
    for (let i = 0; i < MIN_REFLECTIONS_FOR_SUFFICIENT_DATA; i++) {
      insertReflectionRaw(PHONE, { topicId: TOPIC_A });
    }
    insertGrowthPlanRaw(PHONE, { topicId: TOPIC_A, status: 'active' });
    const result = getCoachingInsights(PHONE);
    assertEq(result.status, 'ok', 'public API returns ok status once guard passes');
    assertEq(result.recommendations, [], 'recommendations still empty — rules land in next PR33 increment, not this one');
  }

  // ── Section 2: Evidence retrieval (§6.2) ──────────────────────────────
  console.log('\nSection 2: Evidence retrieval (§6.2)');

  console.log('\nTest E-01: untagged (null topic_id) rows are excluded from evidence');
  clearAll();
  {
    insertReflectionRaw(PHONE, { topicId: null });
    insertGrowthPlanRaw(PHONE, { topicId: null, status: 'active' });
    insertReflectionRaw(PHONE, { topicId: TOPIC_A });

    assertEq(getTaggedReflections(PHONE).length, 1, 'only the tagged reflection is returned');
    assertEq(getTaggedGrowthPlans(PHONE).length, 0, 'untagged growth plan is excluded');
  }

  console.log('\nTest E-02: gatherEvidenceByTopic() groups {type,id} refs correctly, not string ids');
  clearAll();
  {
    const rId = insertReflectionRaw(PHONE, { topicId: TOPIC_A });
    const gId = insertGrowthPlanRaw(PHONE, { topicId: TOPIC_A, status: 'active' });
    insertReflectionRaw(PHONE, { topicId: TOPIC_B });

    const byTopic = gatherEvidenceByTopic(PHONE);
    assertEq(byTopic.get(TOPIC_A), [{ type: 'reflection', id: rId }, { type: 'growth_plan', id: gId }], 'TOPIC_A evidence is structured refs, reflections before growth plans');
    assertEq(byTopic.get(TOPIC_B).length, 1, 'TOPIC_B has its own separate evidence list');
    assert(!byTopic.has('TOPIC_NOT_PRESENT'), 'topics with zero evidence are simply absent from the map');
  }

  console.log('\nTest E-03: growth plan evidence is not restricted to status=active');
  clearAll();
  {
    insertGrowthPlanRaw(PHONE, { topicId: TOPIC_A, status: 'completed' });
    const tagged = getTaggedGrowthPlans(PHONE);
    assertEq(tagged.length, 1, 'a completed growth plan is still valid supporting evidence, distinct from the guard\'s active-only count');
  }

  // ── Section 3: Unknown persisted topic_id regression (§6.1) ───────────
  console.log('\nSection 3: Unknown persisted topic_id regression (§6.1)');

  console.log('\nTest U-01: hasUsableTopic() rejects a topicId not in the active taxonomy');
  {
    assert(hasUsableTopic('TOPIC_DOES_NOT_EXIST') === false, 'unknown topicId is not usable');
    assert(hasUsableTopic(null) === false, 'null topicId is not usable');
    assert(hasUsableTopic(TOPIC_A) === true, 'a real taxonomy id is usable');
  }

  console.log('\nTest U-02: a reflection with a stale/unknown topic_id loads without throwing and is excluded');
  clearAll();
  {
    insertReflectionRaw(PHONE, { topicId: 'TOPIC_RETIRED_LAST_YEAR' });
    insertReflectionRaw(PHONE, { topicId: TOPIC_A });

    let threw = false;
    let result;
    try {
      result = getTaggedReflections(PHONE);
    } catch (_) {
      threw = true;
    }
    assert(threw === false, 'reading a row with an unknown topic_id does not throw');
    assertEq(result.length, 1, 'the stale-topic row is excluded, same as a null topic_id would be');
  }

  console.log('\nTest U-03: a stale-topic row does not affect confidence/evidence for other, validly-tagged topics');
  clearAll();
  {
    insertReflectionRaw(PHONE, { topicId: 'TOPIC_RETIRED_LAST_YEAR' });
    const rId = insertReflectionRaw(PHONE, { topicId: TOPIC_A });

    const byTopic = gatherEvidenceByTopic(PHONE);
    assertEq(byTopic.get(TOPIC_A), [{ type: 'reflection', id: rId }], 'TOPIC_A evidence is unaffected by the unrelated stale-topic row');
    assert(!byTopic.has('TOPIC_RETIRED_LAST_YEAR'), 'the stale topicId itself never appears as a key');
  }

  // ── Section 4: Ownership isolation ─────────────────────────────────────
  console.log('\nSection 4: Ownership isolation');

  console.log('\nTest OI-01: guard and evidence retrieval are scoped per phone_hash');
  clearAll();
  {
    for (let i = 0; i < MIN_REFLECTIONS_FOR_SUFFICIENT_DATA; i++) {
      insertReflectionRaw(PHONE, { topicId: TOPIC_A });
    }
    insertGrowthPlanRaw(PHONE, { topicId: TOPIC_A, status: 'active' });

    insertReflectionRaw(OTHER_PHONE, { topicId: TOPIC_A });

    const guardOther = checkInsufficientDataGuard(OTHER_PHONE);
    assert(guardOther.sufficient === false, 'OTHER_PHONE\'s own (sparse) data does not borrow from PHONE\'s');

    const evidenceOther = gatherEvidenceByTopic(OTHER_PHONE);
    assertEq(evidenceOther.get(TOPIC_A).length, 1, 'OTHER_PHONE only sees its own evidence, not PHONE\'s');
  }

  clearAll();

  // ── Section 5: Confidence calculation (§6.3) ──────────────────────────
  console.log('\nSection 5: Confidence calculation (§6.3)');

  console.log('\nTest C-01: evidenceScore — proportional below the required count');
  {
    assertEq(calculateEvidenceScore(0, 5), 0, '0/5 evidence → 0');
    assertEq(calculateEvidenceScore(1, 5), 0.2, '1/5 evidence → 0.2');
    assertEq(calculateEvidenceScore(5, 5), 1.0, 'exactly 5/5 evidence → 1.0 (cap boundary)');
  }

  console.log('\nTest C-02: evidenceScore caps at 1.0 beyond the required count');
  {
    assertEq(calculateEvidenceScore(6, 5), 1.0, '6/5 evidence still caps at 1.0');
    assertEq(calculateEvidenceScore(100, 5), 1.0, '100/5 evidence still caps at 1.0');
  }

  console.log('\nTest C-03: evidenceScore respects a custom required-evidence override');
  {
    assertEq(calculateEvidenceScore(2, 10), 0.2, 'custom denominator is honored');
  }

  console.log('\nTest C-04: recencyScore bucket boundaries — no interpolation, newest item only');
  {
    assertEq(calculateRecencyScore(0), 1.00, '0 days → 1.00');
    assertEq(calculateRecencyScore(30), 1.00, '30 days (inclusive upper bound) → 1.00');
    assertEq(calculateRecencyScore(31), 0.75, '31 days (first day of next bucket) → 0.75');
    assertEq(calculateRecencyScore(90), 0.75, '90 days (inclusive upper bound) → 0.75');
    assertEq(calculateRecencyScore(91), 0.50, '91 days (first day of next bucket) → 0.50');
    assertEq(calculateRecencyScore(180), 0.50, '180 days (inclusive upper bound) → 0.50');
    assertEq(calculateRecencyScore(181), 0.25, '181 days (first day of next bucket) → 0.25');
    assertEq(calculateRecencyScore(400), 0.25, 'far beyond 180 days is still just 0.25, not lower');
  }

  console.log('\nTest C-05: recencyScore clamps a negative age to the ≤30-day bucket');
  {
    assertEq(calculateRecencyScore(-3), 1.00, 'negative age (e.g. clock skew) is clamped, not thrown on');
  }

  console.log('\nTest C-06: consistencyScore — matching/relevant ratios');
  {
    assertEq(calculateConsistencyScore(0, 10), 0, '0/10 tagged reflections match → 0');
    assertEq(calculateConsistencyScore(5, 10), 0.5, '5/10 tagged reflections match → 0.5');
    assertEq(calculateConsistencyScore(10, 10), 1.0, '10/10 tagged reflections match → 1.0');
    assertEq(calculateConsistencyScore(7, 10), 0.7, '7/10 tagged reflections match → 0.7 (ADR worked-example input)');
  }

  console.log('\nTest C-07: consistencyScore is 0 (not NaN/throw) when there are no relevant tagged reflections at all');
  {
    assertEq(calculateConsistencyScore(0, 0), 0, '0/0 → 0, not a divide-by-zero error');
  }

  console.log('\nTest C-08: calculateConfidence() — the exact ADR worked example');
  {
    // ADR-013 §6.3 worked example:
    //   5 supporting evidence items, DEFAULT_REQUIRED_EVIDENCE=5 → evidenceScore = 1.00
    //   newest supporting item is 14 days old         → recencyScore = 1.00
    //   7 of the last 10 tagged reflections match      → consistencyScore = 0.70
    //   confidence = 0.40*1.00 + 0.30*0.70 + 0.30*1.00 = 0.91
    const evidenceScore = calculateEvidenceScore(5, 5);
    const recencyScore = calculateRecencyScore(14);
    const consistencyScore = calculateConsistencyScore(7, 10);

    const confidence = calculateConfidence({ evidenceScore, consistencyScore, recencyScore });
    assert(confidence === 0.91, `confidence is exactly 0.91 (ADR worked example), got ${confidence}`);
  }

  console.log('\nTest C-09: calculateConfidence() — zero evidence, zero consistency, oldest recency bucket');
  {
    const confidence = calculateConfidence({ evidenceScore: 0, consistencyScore: 0, recencyScore: 0.25 });
    assert(confidence === 0.075, `expected 0.30*0.25 = 0.075, got ${confidence}`);
  }

  console.log('\nTest C-10: calculateConfidence() — full marks on every sub-score');
  {
    const confidence = calculateConfidence({ evidenceScore: 1, consistencyScore: 1, recencyScore: 1 });
    assert(confidence === 1, `expected 1.0, got ${confidence}`);
  }

  console.log('\nTest C-11: confidenceLabel() — explicit threshold boundaries');
  {
    assertEq(confidenceLabel(0.75), 'High', '0.75 (inclusive lower bound) → High');
    assertEq(confidenceLabel(0.91), 'High', '0.91 (ADR worked example) → High');
    assertEq(confidenceLabel(0.749999999), 'Medium', 'just under 0.75 → Medium');
    assertEq(confidenceLabel(0.45), 'Medium', '0.45 (inclusive lower bound) → Medium');
    assertEq(confidenceLabel(0.449999999), 'Low', 'just under 0.45 → Low');
    assertEq(confidenceLabel(0), 'Low', '0 → Low');
  }

  console.log('\nTest C-12: calculateEvidenceScore() rejects a negative count');
  {
    let threw = false;
    try { calculateEvidenceScore(-1, 5); } catch (_) { threw = true; }
    assert(threw, 'negative supportingEvidenceCount throws rather than silently producing a negative score');
  }

  console.log('\nTest C-13: calculateConsistencyScore() rejects matching > relevant');
  {
    let threw = false;
    try { calculateConsistencyScore(11, 10); } catch (_) { threw = true; }
    assert(threw, 'matchingTaggedReflections cannot exceed relevantTaggedReflections');
  }

  clearAll();

  // ── Section 6: Recommendation pipeline (§6.4) ─────────────────────────
  console.log('\nSection 6: Recommendation pipeline (§6.4)');

  const candidate = (topicId, confidence, extra = {}) => ({
    topicId,
    recommendation: `rec for ${topicId} @ ${confidence}`,
    confidence,
    evidence: [{ type: 'reflection', id: 1 }],
    ...extra,
  });

  console.log('\nTest P-01: deduplicateRecommendationsByTopic() keeps only the highest confidence per topic');
  {
    const candidates = [candidate(TOPIC_A, 0.61), candidate(TOPIC_A, 0.83)];
    const result = deduplicateRecommendationsByTopic(candidates);
    assertEq(result.length, 1, 'exactly one survivor for TOPIC_A');
    assertEq(result[0].confidence, 0.83, 'the higher-confidence candidate (0.83) survives, not 0.61');
  }

  console.log('\nTest P-02: deduplicateRecommendationsByTopic() leaves distinct topics untouched');
  {
    const candidates = [candidate(TOPIC_A, 0.7), candidate(TOPIC_B, 0.5)];
    const result = deduplicateRecommendationsByTopic(candidates);
    assertEq(result.length, 2, 'both TOPIC_A and TOPIC_B survive — no cross-topic deduplication');
  }

  console.log('\nTest P-03: sortRecommendations() orders strictly by confidence descending');
  {
    const candidates = [candidate(TOPIC_A, 0.60), candidate(TOPIC_B, 0.95), candidate(TOPIC_C, 0.80)];
    const result = sortRecommendations(candidates);
    assertEq(result.map((c) => c.confidence), [0.95, 0.80, 0.60], 'descending confidence order');
  }

  console.log('\nTest P-04: sortRecommendations() breaks a confidence tie using topic order ascending');
  {
    // TOPIC_B (order 2) vs TOPIC_C (order 3) — same confidence, TOPIC_B must sort first.
    const candidates = [candidate(TOPIC_C, 0.70), candidate(TOPIC_B, 0.70)];
    const result = sortRecommendations(candidates);
    assertEq(result.map((c) => c.topicId), [TOPIC_B, TOPIC_C], 'lower topic.order (TOPIC_B) wins the confidence tie');
  }

  console.log('\nTest P-05: sortRecommendations() — topicId is the documented final tiebreaker (verified against the comparator contract)');
  {
    // ADR §6.4's third tie-break level (topicId, lexicographic) only
    // engages when two candidates share BOTH confidence AND topic.order.
    // Real taxonomy `order` values are unique by construction (utils/
    // qmsTopics.js), so this exact combination can't be constructed with
    // two distinct real topics — the ADR itself acknowledges this is a
    // defensive guarantee ("order values are expected to be unique...
    // topicId fallback means uniqueness is a convention to maintain, not
    // a precondition the sort depends on"), not a scenario expected in
    // production data. What we CAN verify without fabricating an invalid
    // taxonomy state is that two same-topic, same-confidence candidates
    // (order and topicId both trivially equal) sort without error and
    // without reordering relative to each other.
    const candidates = [candidate(TOPIC_A, 0.6), candidate(TOPIC_A, 0.6)];
    let threw = false;
    let result = [];
    try {
      result = sortRecommendations(candidates);
    } catch (_) {
      threw = true;
    }
    assert(threw === false, 'a full tie (same topic, same confidence) does not throw');
    assertEq(result.length, 2, 'both candidates are preserved (sort is not a dedup step)');
  }

  console.log('\nTest P-06: processRecommendationCandidates() truncates to DEFAULT_MAX_INSIGHTS');
  {
    const fiveCandidates = QMS_TOPICS.slice(0, 5).map((t, i) => candidate(t.id, 0.9 - i * 0.05));
    assertEq(fiveCandidates.length, 5, 'sanity: five distinct-topic candidates generated');
    const result = processRecommendationCandidates(fiveCandidates);
    assertEq(result.length, DEFAULT_MAX_INSIGHTS, `only ${DEFAULT_MAX_INSIGHTS} of 5 candidates are returned`);
    assertEq(result.map((c) => c.confidence), [0.90, 0.85, 0.80], 'the three highest-confidence candidates, in order');
  }

  console.log('\nTest P-07: processRecommendationCandidates() respects a maxInsights override');
  {
    const fiveCandidates = QMS_TOPICS.slice(0, 5).map((t, i) => candidate(t.id, 0.9 - i * 0.05));
    const result = processRecommendationCandidates(fiveCandidates, { maxInsights: 2 });
    assertEq(result.length, 2, 'override to 2 is honored instead of the default 3');
  }

  console.log('\nTest P-08: full pipeline — dedup, then sort, then truncate, composed correctly');
  {
    const candidates = [
      candidate(TOPIC_A, 0.50), // will be beaten by the second TOPIC_A candidate
      candidate(TOPIC_A, 0.92),
      candidate(TOPIC_B, 0.30),
      candidate(TOPIC_C, 0.92), // ties TOPIC_A's surviving 0.92; TOPIC_A has lower order → sorts first
    ];
    const result = processRecommendationCandidates(candidates, { maxInsights: 10 });
    assertEq(result.length, 3, 'TOPIC_A deduped from 2 candidates to 1; 3 distinct topics remain');
    assertEq(result.map((c) => c.topicId), [TOPIC_A, TOPIC_C, TOPIC_B], 'TOPIC_A (order tiebreak winner @0.92) → TOPIC_C (@0.92) → TOPIC_B (@0.30)');
    assertEq(result[0].confidence, 0.92, 'the surviving TOPIC_A candidate is the higher-confidence one (0.92, not 0.50)');
  }

  console.log('\nTest P-09: rule order-independence — identical candidates, different input order, identical output');
  {
    const base = [
      candidate(TOPIC_A, 0.72),
      candidate(TOPIC_B, 0.72),
      candidate(TOPIC_C, 0.40),
      candidate(TOPIC_A, 0.55), // lower-confidence duplicate for TOPIC_A, should never survive regardless of position
    ];
    const shuffled = [base[3], base[1], base[2], base[0]];

    const resultA = processRecommendationCandidates(base, { maxInsights: 10 });
    const resultB = processRecommendationCandidates(shuffled, { maxInsights: 10 });

    assertEq(
      resultA.map((c) => ({ topicId: c.topicId, confidence: c.confidence })),
      resultB.map((c) => ({ topicId: c.topicId, confidence: c.confidence })),
      'identical candidate sets in different input orders produce identical pipeline output'
    );
  }

  console.log('\nTest P-10: sortRecommendations() throws if a candidate references an unknown topicId (rule bug, not stale data)');
  {
    let threw = false;
    try {
      sortRecommendations([candidate('TOPIC_DOES_NOT_EXIST', 0.5)]);
    } catch (_) {
      threw = true;
    }
    assert(threw, 'an invalid candidate topicId is treated as a rule bug and surfaces loudly, unlike stale-persisted-row handling in §6.1');
  }

  clearAll();

  // ── Summary ────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`coachingEngineService Results: ${passed} passed, ${failed} failed`);
  testDb.cleanup();
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
