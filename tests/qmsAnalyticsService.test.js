'use strict';
/**
 * qmsAnalyticsService Tests (PR30, ADR-011)
 *
 * Covers:
 *   1. getSummary() — reflection/growth-plan counts, term filtering, soft-delete exclusion
 *   2. getGrowthPlanSummary() — status grouping, recentPlans ordering/limit, soft-delete exclusion
 *   3. getCommonFocusAreas() — normalization, first-seen casing, count-desc ordering
 *   4. getGrowthPlanDetail() — ownership scoping, ageDays computed at query time
 *   5. Ownership isolation — every exported function scoped to phone_hash
 *
 * Run individually:   node tests/qmsAnalyticsService.test.js
 * Run via npm:         npm test
 */

// ── Real-migrations test DB (see tests/helpers/createTestDb.js) ──────────
const { createTestDb } = require('./helpers/createTestDb');
const testDb = createTestDb(__filename);
let _db = testDb.db;

// ── Helpers ───────────────────────────────────────────────────────────────────
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

// ── Fixture helpers ─────────────────────────────────────────────────────────
function insertReflection(phoneHash, { term = null, content = 'reflection content', createdAt = null } = {}) {
  if (createdAt) {
    return _db
      .prepare(
        `INSERT INTO qms_reflections (phone_hash, term, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(phoneHash, term, content, createdAt, createdAt).lastInsertRowid;
  }
  return _db
    .prepare(`INSERT INTO qms_reflections (phone_hash, term, content) VALUES (?, ?, ?)`)
    .run(phoneHash, term, content).lastInsertRowid;
}

function insertGrowthPlan(
  phoneHash,
  { term = null, goalText = 'goal', targetArea = null, status = 'active', createdAt = null } = {}
) {
  if (createdAt) {
    return Number(
      _db
        .prepare(
          `INSERT INTO qms_growth_plans (phone_hash, term, goal_text, target_area, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(phoneHash, term, goalText, targetArea, status, createdAt, createdAt).lastInsertRowid
    );
  }
  return Number(
    _db
      .prepare(
        `INSERT INTO qms_growth_plans (phone_hash, term, goal_text, target_area, status)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(phoneHash, term, goalText, targetArea, status).lastInsertRowid
  );
}

function softDeleteReflection(id) {
  _db.prepare(`UPDATE qms_reflections SET deleted_at = datetime('now') WHERE id = ?`).run(id);
}

function softDeleteGrowthPlan(id) {
  _db.prepare(`UPDATE qms_growth_plans SET deleted_at = datetime('now') WHERE id = ?`).run(id);
}

function clearAll() {
  _db.exec(`DELETE FROM qms_reflections`);
  _db.exec(`DELETE FROM qms_growth_plans`);
}

// ── Test runner ───────────────────────────────────────────────────────────────
async function run() {
  const {
    getSummary,
    getGrowthPlanSummary,
    getCommonFocusAreas,
    getGrowthPlanDetail,
  } = require('../services/qmsAnalyticsService');

  const PHONE = 'qms_analytics_test_hash_001';
  const OTHER_PHONE = 'qms_analytics_test_hash_002';

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 1: getSummary()
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 1: getSummary() ───────────────────────────────');

  console.log('\nTest S-01: empty database returns zero counts');
  {
    const summary = getSummary(PHONE);
    assertEq(summary.reflectionCount, 0, 'reflectionCount is 0 for an unseen teacher');
    assertEq(summary.growthPlanCountsByStatus, {}, 'growthPlanCountsByStatus is empty');
    assertEq(summary.latestActivity, null, 'latestActivity is null when there is nothing');
  }

  console.log('\nTest S-02: reflection and growth-plan counts reflect seeded data (all-time)');
  clearAll();
  {
    insertReflection(PHONE, { term: 1 });
    insertReflection(PHONE, { term: 2 });
    insertGrowthPlan(PHONE, { term: 1, status: 'active' });
    insertGrowthPlan(PHONE, { term: 2, status: 'completed' });
    insertGrowthPlan(PHONE, { term: 2, status: 'active' });

    const summary = getSummary(PHONE);
    assertEq(summary.reflectionCount, 2, 'reflectionCount reflects both seeded reflections');
    assertEq(summary.growthPlanCountsByStatus, { active: 2, completed: 1 }, 'growthPlanCountsByStatus grouped correctly');
  }

  console.log('\nTest S-03: term filtering scopes both reflections and growth plans');
  clearAll();
  {
    insertReflection(PHONE, { term: 1 });
    insertReflection(PHONE, { term: 2 });
    insertGrowthPlan(PHONE, { term: 1, status: 'active' });
    insertGrowthPlan(PHONE, { term: 2, status: 'active' });

    const summary = getSummary(PHONE, { term: 1 });
    assertEq(summary.reflectionCount, 1, 'reflectionCount scoped to term 1 only');
    assertEq(summary.growthPlanCountsByStatus, { active: 1 }, 'growthPlanCountsByStatus scoped to term 1 only');
  }

  console.log('\nTest S-04: soft-deleted reflections excluded from the count');
  clearAll();
  {
    const keep = insertReflection(PHONE);
    const deleted = insertReflection(PHONE);
    softDeleteReflection(deleted);

    const summary = getSummary(PHONE);
    assertEq(summary.reflectionCount, 1, 'soft-deleted reflection excluded, only the live one counted');
  }

  console.log('\nTest S-05: soft-deleted growth plans excluded from the counts');
  clearAll();
  {
    insertGrowthPlan(PHONE, { status: 'active' });
    const deletedId = insertGrowthPlan(PHONE, { status: 'active' });
    softDeleteGrowthPlan(deletedId);

    const summary = getSummary(PHONE);
    assertEq(summary.growthPlanCountsByStatus, { active: 1 }, 'soft-deleted growth plan excluded from status counts');
  }

  console.log('\nTest S-06: latestActivity reflects the most recent row across both tables');
  clearAll();
  {
    insertReflection(PHONE, { createdAt: '2026-01-01 09:00:00' });
    insertGrowthPlan(PHONE, { createdAt: '2026-03-01 09:00:00' });

    const summary = getSummary(PHONE);
    assertEq(summary.latestActivity, '2026-03-01 09:00:00', 'latestActivity picks the newer growth plan timestamp');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 2: getGrowthPlanSummary()
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 2: getGrowthPlanSummary() ─────────────────────');

  console.log('\nTest GS-01: counts grouped by status');
  clearAll();
  {
    insertGrowthPlan(PHONE, { status: 'active' });
    insertGrowthPlan(PHONE, { status: 'active' });
    insertGrowthPlan(PHONE, { status: 'completed' });

    const { countsByStatus } = getGrowthPlanSummary(PHONE);
    assertEq(countsByStatus, { active: 2, completed: 1 }, 'counts grouped by status correctly');
  }

  console.log('\nTest GS-02: recentPlans ordered newest first');
  clearAll();
  {
    insertGrowthPlan(PHONE, { goalText: 'oldest', createdAt: '2026-01-01 09:00:00' });
    insertGrowthPlan(PHONE, { goalText: 'newest', createdAt: '2026-03-01 09:00:00' });
    insertGrowthPlan(PHONE, { goalText: 'middle', createdAt: '2026-02-01 09:00:00' });

    const { recentPlans } = getGrowthPlanSummary(PHONE);
    assertEq(recentPlans[0].goalText, 'newest', 'newest plan appears first');
    assertEq(recentPlans[2].goalText, 'oldest', 'oldest plan appears last');
  }

  console.log('\nTest GS-03: recentPlans respects the recentLimit option');
  clearAll();
  {
    for (let i = 0; i < 8; i++) {
      insertGrowthPlan(PHONE, { goalText: `plan ${i}`, createdAt: `2026-01-0${(i % 9) + 1} 09:00:00` });
    }
    const { recentPlans } = getGrowthPlanSummary(PHONE, { recentLimit: 3 });
    assertEq(recentPlans.length, 3, 'recentPlans capped at the requested limit');
  }

  console.log('\nTest GS-04: soft-deleted plans excluded from both counts and recentPlans');
  clearAll();
  {
    insertGrowthPlan(PHONE, { status: 'active', goalText: 'kept' });
    const deletedId = insertGrowthPlan(PHONE, { status: 'active', goalText: 'deleted-plan' });
    softDeleteGrowthPlan(deletedId);

    const { countsByStatus, recentPlans } = getGrowthPlanSummary(PHONE);
    assertEq(countsByStatus, { active: 1 }, 'soft-deleted plan excluded from countsByStatus');
    assert(
      !recentPlans.some((p) => p.goalText === 'deleted-plan'),
      'soft-deleted plan excluded from recentPlans'
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 3: getCommonFocusAreas()
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 3: getCommonFocusAreas() ──────────────────────');

  console.log('\nTest CF-01: case normalization merges differently-cased entries');
  clearAll();
  {
    insertGrowthPlan(PHONE, { targetArea: 'Classroom Management' });
    insertGrowthPlan(PHONE, { targetArea: 'classroom management' });
    insertGrowthPlan(PHONE, { targetArea: 'CLASSROOM MANAGEMENT' });

    const areas = getCommonFocusAreas(PHONE);
    assertEq(areas.length, 1, 'all three casings merge into a single focus area');
    assertEq(areas[0].count, 3, 'merged focus area count is 3');
  }

  console.log('\nTest CF-02: leading/trailing whitespace normalized');
  clearAll();
  {
    insertGrowthPlan(PHONE, { targetArea: '  Fractions  ' });
    insertGrowthPlan(PHONE, { targetArea: 'Fractions' });

    const areas = getCommonFocusAreas(PHONE);
    assertEq(areas.length, 1, 'whitespace-padded entry merges with the trimmed one');
    assertEq(areas[0].count, 2, 'merged count is 2');
  }

  console.log('\nTest CF-03: multiple internal spaces collapsed');
  clearAll();
  {
    insertGrowthPlan(PHONE, { targetArea: 'Reading   Comprehension' });
    insertGrowthPlan(PHONE, { targetArea: 'Reading Comprehension' });

    const areas = getCommonFocusAreas(PHONE);
    assertEq(areas.length, 1, 'collapsed internal whitespace merges with the single-spaced entry');
    assertEq(areas[0].count, 2, 'merged count is 2');
  }

  console.log('\nTest CF-04: blank and NULL target_area are ignored');
  clearAll();
  {
    insertGrowthPlan(PHONE, { targetArea: null });
    insertGrowthPlan(PHONE, { targetArea: '' });
    insertGrowthPlan(PHONE, { targetArea: '   ' });
    insertGrowthPlan(PHONE, { targetArea: 'Real Area' });

    const areas = getCommonFocusAreas(PHONE);
    assertEq(areas.length, 1, 'only the one real target_area is reported');
    assertEq(areas[0].label, 'Real Area', 'the real target_area is the one reported');
  }

  console.log('\nTest CF-05: ordered by count descending');
  clearAll();
  {
    insertGrowthPlan(PHONE, { targetArea: 'Rare' });
    insertGrowthPlan(PHONE, { targetArea: 'Common' });
    insertGrowthPlan(PHONE, { targetArea: 'Common' });
    insertGrowthPlan(PHONE, { targetArea: 'Common' });

    const areas = getCommonFocusAreas(PHONE);
    assertEq(areas[0].label, 'Common', 'higher-count area sorts first');
    assertEq(areas[0].count, 3, 'higher-count area has count 3');
    assertEq(areas[1].label, 'Rare', 'lower-count area sorts second');
  }

  console.log('\nTest CF-06: first-seen casing is used as the display label');
  clearAll();
  {
    insertGrowthPlan(PHONE, { targetArea: 'time Management', createdAt: '2026-01-01 09:00:00' });
    insertGrowthPlan(PHONE, { targetArea: 'Time Management', createdAt: '2026-01-02 09:00:00' });

    const areas = getCommonFocusAreas(PHONE);
    assertEq(areas.length, 1, 'still merges to one area');
    assertEq(areas[0].label, 'time Management', 'first-seen (insertion order) casing wins as the label');
  }

  console.log('\nTest CF-07: soft-deleted growth plans excluded from focus-area aggregation');
  clearAll();
  {
    insertGrowthPlan(PHONE, { targetArea: 'Kept Area' });
    const deletedId = insertGrowthPlan(PHONE, { targetArea: 'Deleted Area' });
    softDeleteGrowthPlan(deletedId);

    const areas = getCommonFocusAreas(PHONE);
    assertEq(areas.length, 1, 'only the live growth plan contributes a focus area');
    assertEq(areas[0].label, 'Kept Area', 'the surviving focus area is the correct one');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 4: getGrowthPlanDetail()
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 4: getGrowthPlanDetail() ──────────────────────');

  console.log('\nTest GD-01: correct plan returned for its owner');
  clearAll();
  {
    const id = insertGrowthPlan(PHONE, { goalText: 'Improve pacing', targetArea: 'Pacing', status: 'active' });
    const detail = getGrowthPlanDetail(PHONE, id);
    assert(detail !== null, 'detail is not null for a valid owned plan');
    assertEq(detail.goalText, 'Improve pacing', 'goalText matches');
    assertEq(detail.targetArea, 'Pacing', 'targetArea matches');
    assertEq(detail.status, 'active', 'status matches');
  }

  console.log('\nTest GD-02: wrong phone_hash returns null (ownership scoping)');
  clearAll();
  {
    const id = insertGrowthPlan(PHONE, { goalText: 'Owned by PHONE' });
    const detail = getGrowthPlanDetail(OTHER_PHONE, id);
    assertEq(detail, null, 'a teacher cannot fetch another teacher\'s growth plan detail');
  }

  console.log('\nTest GD-03: unknown id returns null');
  clearAll();
  {
    const detail = getGrowthPlanDetail(PHONE, 999999);
    assertEq(detail, null, 'nonexistent id returns null, not a throw');
  }

  console.log('\nTest GD-04: soft-deleted plan returns null');
  clearAll();
  {
    const id = insertGrowthPlan(PHONE, { goalText: 'Will be deleted' });
    softDeleteGrowthPlan(id);
    const detail = getGrowthPlanDetail(PHONE, id);
    assertEq(detail, null, 'a soft-deleted plan is not resolvable via getGrowthPlanDetail');
  }

  console.log('\nTest GD-05: ageDays is computed from created_at, not stored');
  clearAll();
  {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const createdAt = tenDaysAgo.toISOString().slice(0, 19).replace('T', ' ');
    const id = insertGrowthPlan(PHONE, { goalText: 'Old plan', createdAt });

    const detail = getGrowthPlanDetail(PHONE, id);
    assert(detail.ageDays !== null, 'ageDays is computed, not null');
    // Allow a 1-day tolerance for clock skew / rounding at the boundary.
    assert(
      detail.ageDays >= 9 && detail.ageDays <= 11,
      `ageDays is approximately 10 for a plan created 10 days ago (got ${detail.ageDays})`
    );
  }

  console.log('\nTest GD-06: ageDays is 0 for a plan created moments ago');
  clearAll();
  {
    const id = insertGrowthPlan(PHONE, { goalText: 'Brand new plan' });
    const detail = getGrowthPlanDetail(PHONE, id);
    assertEq(detail.ageDays, 0, 'a freshly created plan has ageDays 0');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 5: Ownership isolation across all exported functions
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 5: Ownership isolation ────────────────────────');

  console.log('\nTest OI-01: getSummary() never leaks another teacher\'s counts');
  clearAll();
  {
    insertReflection(PHONE);
    insertReflection(OTHER_PHONE);
    insertReflection(OTHER_PHONE);
    insertGrowthPlan(OTHER_PHONE, { status: 'active' });

    const summary = getSummary(PHONE);
    assertEq(summary.reflectionCount, 1, 'PHONE only sees its own reflection, not OTHER_PHONE\'s two');
    assertEq(summary.growthPlanCountsByStatus, {}, 'PHONE sees no growth plans belonging to OTHER_PHONE');
  }

  console.log('\nTest OI-02: getGrowthPlanSummary() never leaks another teacher\'s plans');
  clearAll();
  {
    insertGrowthPlan(PHONE, { goalText: 'mine' });
    insertGrowthPlan(OTHER_PHONE, { goalText: 'not mine' });

    const { recentPlans } = getGrowthPlanSummary(PHONE);
    assertEq(recentPlans.length, 1, 'only PHONE\'s own plan is returned');
    assertEq(recentPlans[0].goalText, 'mine', 'the returned plan is the correct one');
  }

  console.log('\nTest OI-03: getCommonFocusAreas() never aggregates another teacher\'s target_area values');
  clearAll();
  {
    insertGrowthPlan(PHONE, { targetArea: 'Mine' });
    insertGrowthPlan(OTHER_PHONE, { targetArea: 'Mine' });
    insertGrowthPlan(OTHER_PHONE, { targetArea: 'Mine' });

    const areas = getCommonFocusAreas(PHONE);
    assertEq(areas.length, 1, 'only PHONE\'s own target_area value contributes');
    assertEq(areas[0].count, 1, 'count reflects only PHONE\'s single plan, not OTHER_PHONE\'s two');
  }

  console.log('\nTest OI-04: term filters remain teacher-scoped, not just term-scoped');
  clearAll();
  {
    insertReflection(PHONE, { term: 1 });
    insertReflection(OTHER_PHONE, { term: 1 });
    insertGrowthPlan(PHONE, { term: 1, status: 'active' });
    insertGrowthPlan(OTHER_PHONE, { term: 1, status: 'active' });

    const summary = getSummary(PHONE, { term: 1 });
    assertEq(summary.reflectionCount, 1, 'term filter does not leak OTHER_PHONE\'s term-1 reflection');
    assertEq(summary.growthPlanCountsByStatus, { active: 1 }, 'term filter does not leak OTHER_PHONE\'s term-1 growth plan');
  }

  console.log('\nTest OI-05: getGrowthPlanDetail() ownership check holds even for identical goalText');
  clearAll();
  {
    const mineId = insertGrowthPlan(PHONE, { goalText: 'Same wording' });
    insertGrowthPlan(OTHER_PHONE, { goalText: 'Same wording' });

    const detail = getGrowthPlanDetail(OTHER_PHONE, mineId);
    assertEq(detail, null, 'OTHER_PHONE cannot read PHONE\'s plan by id, even with matching content elsewhere');
  }

  clearAll();

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`qmsAnalyticsService Results: ${passed} passed, ${failed} failed`);
  testDb.cleanup();
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
