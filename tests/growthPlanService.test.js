'use strict';
/**
 * Migration 038 + growthPlanService Tests (PR29, ADR-011)
 *
 * Covers:
 *   1. Migration 038 verification — qms_growth_plans table shape/defaults
 *   2. createGrowthPlan() input guards + round-trip insert
 *   3. getGrowthPlan() — phone_hash scoping, excludes soft-deleted rows
 *   4. listGrowthPlans() — ordering, term/status scoping, excludes soft-deleted
 *   5. updateGrowthPlan() — editable fields, status validation, ownership scoping
 *   6. completeGrowthPlan() — convenience status transition
 *   7. deleteGrowthPlan() — soft delete semantics (never a hard DELETE)
 *
 * Run individually:   node tests/growthPlanService.test.js
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

function assertThrows(fn, expectedMsg, label) {
  try {
    fn();
    console.error(`  ❌ FAIL: ${label} — expected throw, got no error`);
    failed++;
  } catch (err) {
    if (expectedMsg && !err.message.includes(expectedMsg)) {
      console.error(`  ❌ FAIL: ${label}`);
      console.error(`     expected message to include: "${expectedMsg}"`);
      console.error(`     got: "${err.message}"`);
      failed++;
    } else {
      console.log(`  ✅ ${label}`);
      passed++;
    }
  }
}

// ── Test runner ───────────────────────────────────────────────────────────────
async function run() {
  const {
    createGrowthPlan,
    getGrowthPlan,
    listGrowthPlans,
    updateGrowthPlan,
    completeGrowthPlan,
    deleteGrowthPlan,
  } = require('../services/growthPlanService');

  const PHONE = 'growthplan_test_hash_001';
  const OTHER_PHONE = 'growthplan_test_hash_002';

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 1: Migration 038 verification
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 1: Migration 038 verification ───────────────────────────');

  console.log('\nTest M38-01: qms_growth_plans row defaults status=active, deleted_at NULL');
  const rawInsert = _db
    .prepare(`INSERT INTO qms_growth_plans (phone_hash, goal_text) VALUES (?, ?)`)
    .run(PHONE, 'raw insert for defaults check');
  const rawRow = _db.prepare(`SELECT * FROM qms_growth_plans WHERE id = ?`).get(Number(rawInsert.lastInsertRowid));
  assertEq(rawRow.status, 'active', 'status defaults to active');
  assertEq(rawRow.deleted_at, null, 'deleted_at defaults to NULL');
  assertEq(rawRow.term, null, 'term defaults to NULL (unscoped) when omitted');
  assertEq(rawRow.target_area, null, 'target_area defaults to NULL when omitted');
  _db.exec(`DELETE FROM qms_growth_plans`);

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 2: createGrowthPlan()
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 2: createGrowthPlan() ────────────────────────────────────');

  console.log('\nTest C-01: rejects missing phoneHash');
  assertThrows(() => createGrowthPlan(null, { goalText: 'x' }), 'phoneHash is required', 'throws without phoneHash');

  console.log('\nTest C-02: rejects missing goalText');
  assertThrows(() => createGrowthPlan(PHONE, {}), 'goalText is required', 'throws without goalText');

  console.log('\nTest C-03: rejects whitespace-only goalText');
  assertThrows(() => createGrowthPlan(PHONE, { goalText: '   ' }), 'goalText is required', 'throws on whitespace-only goalText');

  console.log('\nTest C-04: rejects invalid status');
  assertThrows(
    () => createGrowthPlan(PHONE, { goalText: 'x', status: 'bogus' }),
    'status must be one of',
    'throws on invalid status'
  );

  console.log('\nTest C-05: round-trip insert with all fields');
  const created = createGrowthPlan(PHONE, {
    goalText: 'Improve questioning technique to elicit deeper responses.',
    term: 2,
    targetArea: 'Classroom practice',
    status: 'in_progress',
  });
  assert(typeof created.id === 'number', 'created growth plan has a numeric id');
  assertEq(created.phoneHash, PHONE, 'phoneHash round-trips');
  assertEq(created.term, 2, 'term round-trips');
  assertEq(created.goalText, 'Improve questioning technique to elicit deeper responses.', 'goalText round-trips');
  assertEq(created.targetArea, 'Classroom practice', 'targetArea round-trips');
  assertEq(created.status, 'in_progress', 'status round-trips');
  assertEq(created.deletedAt, null, 'new growth plan is not soft-deleted');

  console.log('\nTest C-06: goalText is trimmed on insert');
  const trimmed = createGrowthPlan(PHONE, { goalText: '  padded goal  ' });
  assertEq(trimmed.goalText, 'padded goal', 'leading/trailing whitespace stripped');

  console.log('\nTest C-07: defaults to status=active when omitted');
  const defaultStatus = createGrowthPlan(PHONE, { goalText: 'Default status check' });
  assertEq(defaultStatus.status, 'active', 'status defaults to active');

  _db.exec(`DELETE FROM qms_growth_plans`);

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 3: getGrowthPlan() — ownership scoping + soft-delete exclusion
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 3: getGrowthPlan() ───────────────────────────────────────');

  const owned = createGrowthPlan(PHONE, { goalText: 'Owned by PHONE' });

  console.log('\nTest G-01: fetches an owned growth plan');
  const fetched = getGrowthPlan(PHONE, owned.id);
  assert(fetched !== null, 'returns the growth plan');
  assertEq(fetched.id, owned.id, 'returns the correct id');

  console.log('\nTest G-02: returns null for another teacher\'s growth plan (ownership scoping)');
  const wrongOwner = getGrowthPlan(OTHER_PHONE, owned.id);
  assertEq(wrongOwner, null, 'a teacher cannot fetch another teacher\'s growth plan by id');

  console.log('\nTest G-03: returns null for a nonexistent id');
  assertEq(getGrowthPlan(PHONE, 999999), null, 'nonexistent id returns null, not a throw');

  console.log('\nTest G-04: returns null after soft delete');
  deleteGrowthPlan(PHONE, owned.id);
  assertEq(getGrowthPlan(PHONE, owned.id), null, 'soft-deleted growth plan is excluded from getGrowthPlan');

  _db.exec(`DELETE FROM qms_growth_plans`);

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 4: listGrowthPlans() — ordering, term/status scoping, soft-delete exclusion
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 4: listGrowthPlans() ─────────────────────────────────────');

  const first = createGrowthPlan(PHONE, { goalText: 'First', term: 1, status: 'active' });
  const second = createGrowthPlan(PHONE, { goalText: 'Second', term: 2, status: 'active' });
  const third = createGrowthPlan(PHONE, { goalText: 'Third', term: 2, status: 'completed' });
  createGrowthPlan(OTHER_PHONE, { goalText: 'Someone else entirely', term: 2 });

  console.log('\nTest L-01: lists only the requesting teacher\'s growth plans');
  const all = listGrowthPlans(PHONE);
  assertEq(all.length, 3, 'only PHONE\'s 3 growth plans are returned, not OTHER_PHONE\'s');

  console.log('\nTest L-02: most recent first');
  assertEq(all[0].id, third.id, 'newest growth plan appears first');
  assertEq(all[2].id, first.id, 'oldest growth plan appears last');

  console.log('\nTest L-03: scoped to a single term when requested');
  const termTwo = listGrowthPlans(PHONE, { term: 2 });
  assertEq(termTwo.length, 2, 'only term-2 growth plans returned');
  assert(termTwo.every((p) => p.term === 2), 'every returned growth plan is term 2');

  console.log('\nTest L-04: scoped to a single status when requested');
  const completedOnly = listGrowthPlans(PHONE, { status: 'completed' });
  assertEq(completedOnly.length, 1, 'only the completed growth plan returned');
  assertEq(completedOnly[0].id, third.id, 'the completed growth plan is the third one');

  console.log('\nTest L-05: excludes soft-deleted growth plans');
  deleteGrowthPlan(PHONE, second.id);
  const afterDelete = listGrowthPlans(PHONE);
  assertEq(afterDelete.length, 2, 'soft-deleted growth plan is excluded from the list');
  assert(!afterDelete.some((p) => p.id === second.id), 'the deleted id specifically is absent');

  _db.exec(`DELETE FROM qms_growth_plans`);

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 5: updateGrowthPlan()
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 5: updateGrowthPlan() ────────────────────────────────────');

  const toUpdate = createGrowthPlan(PHONE, {
    goalText: 'Original goal',
    targetArea: 'Original area',
    status: 'active',
  });

  console.log('\nTest U-01: updates goalText');
  const updatedGoal = updateGrowthPlan(PHONE, toUpdate.id, { goalText: 'Revised goal' });
  assertEq(updatedGoal.goalText, 'Revised goal', 'goalText is updated');
  assertEq(updatedGoal.targetArea, 'Original area', 'targetArea unchanged when not passed');
  assertEq(updatedGoal.status, 'active', 'status unchanged when not passed');

  console.log('\nTest U-02: updates status independently');
  const updatedStatus = updateGrowthPlan(PHONE, toUpdate.id, { status: 'in_progress' });
  assertEq(updatedStatus.status, 'in_progress', 'status transitions to in_progress');
  assertEq(updatedStatus.goalText, 'Revised goal', 'goalText unaffected by a status-only update');

  console.log('\nTest U-03: rejects invalid status on update');
  assertThrows(
    () => updateGrowthPlan(PHONE, toUpdate.id, { status: 'bogus' }),
    'status must be one of',
    'throws on invalid status update'
  );

  console.log('\nTest U-04: rejects clearing goalText to empty');
  assertThrows(
    () => updateGrowthPlan(PHONE, toUpdate.id, { goalText: '   ' }),
    'goalText cannot be empty',
    'throws when attempting to update goalText to whitespace-only'
  );

  console.log('\nTest U-05: returns null for another teacher\'s growth plan (ownership scoping)');
  const wrongOwnerUpdate = updateGrowthPlan(OTHER_PHONE, toUpdate.id, { goalText: 'hijack attempt' });
  assertEq(wrongOwnerUpdate, null, 'cannot update another teacher\'s growth plan');
  assertEq(getGrowthPlan(PHONE, toUpdate.id).goalText, 'Revised goal', 'original goalText untouched by the failed cross-owner update');

  console.log('\nTest U-06: returns null for a nonexistent id');
  assertEq(updateGrowthPlan(PHONE, 999999, { goalText: 'x' }), null, 'nonexistent id returns null, not a throw');

  console.log('\nTest U-07: returns null when attempting to update a soft-deleted growth plan');
  deleteGrowthPlan(PHONE, toUpdate.id);
  assertEq(updateGrowthPlan(PHONE, toUpdate.id, { goalText: 'resurrect?' }), null, 'cannot update a soft-deleted growth plan');

  _db.exec(`DELETE FROM qms_growth_plans`);

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 6: completeGrowthPlan()
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 6: completeGrowthPlan() ──────────────────────────────────');

  const toComplete = createGrowthPlan(PHONE, { goalText: 'Will be completed', status: 'in_progress' });

  console.log('\nTest CP-01: transitions status to completed');
  const completed = completeGrowthPlan(PHONE, toComplete.id);
  assertEq(completed.status, 'completed', 'status is now completed');
  assertEq(completed.goalText, 'Will be completed', 'goalText unaffected');

  console.log('\nTest CP-02: returns null for another teacher\'s growth plan');
  const otherToComplete = createGrowthPlan(PHONE, { goalText: 'Owned by PHONE only' });
  assertEq(completeGrowthPlan(OTHER_PHONE, otherToComplete.id), null, 'cannot complete another teacher\'s growth plan');

  _db.exec(`DELETE FROM qms_growth_plans`);

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 7: deleteGrowthPlan() — soft delete semantics (ADR-011 §7)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 7: deleteGrowthPlan() ────────────────────────────────────');

  const toDelete = createGrowthPlan(PHONE, { goalText: 'Will be soft-deleted' });

  console.log('\nTest D-01: soft-deletes successfully');
  const deleteResult = deleteGrowthPlan(PHONE, toDelete.id);
  assertEq(deleteResult, true, 'deleteGrowthPlan returns true on success');

  console.log('\nTest D-02: row still exists in the table (never a hard DELETE)');
  const rawAfterDelete = _db.prepare(`SELECT * FROM qms_growth_plans WHERE id = ?`).get(toDelete.id);
  assert(rawAfterDelete !== undefined, 'the row is still physically present in qms_growth_plans');
  assert(rawAfterDelete.deleted_at !== null, 'deleted_at is set to a non-null timestamp');

  console.log('\nTest D-03: deleting an already-deleted growth plan is a safe no-op');
  const doubleDelete = deleteGrowthPlan(PHONE, toDelete.id);
  assertEq(doubleDelete, false, 'a second delete call returns false, not an error');

  console.log('\nTest D-04: returns false for another teacher\'s growth plan (ownership scoping)');
  const another = createGrowthPlan(PHONE, { goalText: 'Owned by PHONE, attacked by OTHER_PHONE' });
  const wrongOwnerDelete = deleteGrowthPlan(OTHER_PHONE, another.id);
  assertEq(wrongOwnerDelete, false, 'cannot delete another teacher\'s growth plan');
  assert(getGrowthPlan(PHONE, another.id) !== null, 'the growth plan survives the failed cross-owner delete attempt');

  console.log('\nTest D-05: returns false for a nonexistent id');
  assertEq(deleteGrowthPlan(PHONE, 999999), false, 'nonexistent id returns false, not a throw');

  _db.exec(`DELETE FROM qms_growth_plans`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`Migration 038 / growthPlanService Results: ${passed} passed, ${failed} failed`);
  testDb.cleanup();
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
