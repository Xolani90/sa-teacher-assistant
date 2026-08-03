'use strict';
/**
 * coachingSnapshotService Tests (PR37, ADR-016 §2/§6/§9)
 *
 * Covers (evidence-event trigger philosophy, ADR-016 §2 revised):
 *   1. First snapshot for a topic is always recorded (no prior row).
 *   2. Dedup: a second write within the noise threshold is skipped, not
 *      inserted or updated.
 *   2b. Dedup boundary: delta exactly equal to the threshold is skipped
 *      (the threshold is "more than", not "at least").
 *   3. Dedup boundary: a write that moves confidence past the threshold
 *      is recorded.
 *   4. Same-day cap: two meaningfully-different writes on the same UTC
 *      day update the existing row in place rather than inserting a
 *      second row (append-only history is still one row per day).
 *   5. Trigger wiring: reflectionService.createReflection and
 *      growthPlanService.updateGrowthPlan (status change) each produce a
 *      snapshot as a side effect.
 *   6. Non-trigger: updateGrowthPlan with neither status nor topicId
 *      changed does NOT write a snapshot.
 *   6b. growthPlanService.createGrowthPlan triggers a snapshot (new
 *      evidence, regardless of status).
 *   6c. updateGrowthPlan triggers on a topicId reassignment even with no
 *      status change.
 *   6d. reflectionService.updateReflection triggers only when topicId
 *      changes — a content-only edit is not a trigger.
 *   6e. reflectionService.deleteReflection triggers a snapshot.
 *   7. Read paths never write: calling getCoachingInsights (a read) does
 *      not itself create any coaching_snapshots rows (§9 invariant 1).
 *
 * Run individually:   node tests/coachingSnapshotService.test.js
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

async function run() {
  const reflectionService = require('../services/reflectionService');
  const growthPlanService = require('../services/growthPlanService');
  const {
    writeSnapshotForTopic,
    recordSnapshotsForTeacher,
    DEFAULT_TREND_NOISE_THRESHOLD,
  } = require('../services/coachingSnapshotService');
  const { getCoachingInsights } = require('../services/coachingEngineService');

  const PHONE = 'phone-hash-pr37';
  const TOPIC_A = 'TOPIC_CLASSROOM_MANAGEMENT';

  console.log('\nTest 1: first snapshot for a topic is always recorded');
  clearAll();
  {
    const result = writeSnapshotForTopic(PHONE, {
      topicId: TOPIC_A,
      confidence: 0.5,
      confidenceLabel: 'Medium',
      evidenceScore: 0.4,
      consistencyScore: 0.5,
      recencyScore: 0.6,
      hasEvidence: true,
    });
    assertEq(result, 'inserted', 'first write for a topic inserts');
    assertEq(snapshotRows(PHONE, TOPIC_A).length, 1, 'exactly one row after first write');
  }

  console.log('\nTest 2: a write within the noise threshold is skipped');
  clearAll();
  {
    writeSnapshotForTopic(PHONE, {
      topicId: TOPIC_A, confidence: 0.50, confidenceLabel: 'Medium',
      evidenceScore: 0.4, consistencyScore: 0.5, recencyScore: 0.6, hasEvidence: true,
    });
    const result = writeSnapshotForTopic(PHONE, {
      topicId: TOPIC_A, confidence: 0.50 + DEFAULT_TREND_NOISE_THRESHOLD / 2, confidenceLabel: 'Medium',
      evidenceScore: 0.4, consistencyScore: 0.5, recencyScore: 0.6, hasEvidence: true,
    });
    assertEq(result, 'skipped', 'a sub-threshold confidence move is skipped');
    assertEq(snapshotRows(PHONE, TOPIC_A).length, 1, 'still exactly one row');
  }

  console.log('\nTest 2b: a write exactly at the noise threshold is skipped');
  clearAll();
  {
    writeSnapshotForTopic(PHONE, {
      topicId: TOPIC_A, confidence: 0.50, confidenceLabel: 'Medium',
      evidenceScore: 0.4, consistencyScore: 0.5, recencyScore: 0.6, hasEvidence: true,
    });
    const result = writeSnapshotForTopic(PHONE, {
      topicId: TOPIC_A, confidence: 0.50 + DEFAULT_TREND_NOISE_THRESHOLD, confidenceLabel: 'Medium',
      evidenceScore: 0.4, consistencyScore: 0.5, recencyScore: 0.6, hasEvidence: true,
    });
    assertEq(result, 'skipped', 'a move exactly equal to the threshold is skipped ("more than", not "at least")');
    assertEq(snapshotRows(PHONE, TOPIC_A).length, 1, 'still exactly one row');
  }

  console.log('\nTest 3: a write past the noise threshold is recorded');
  clearAll();
  {
    writeSnapshotForTopic(PHONE, {
      topicId: TOPIC_A, confidence: 0.50, confidenceLabel: 'Medium',
      evidenceScore: 0.4, consistencyScore: 0.5, recencyScore: 0.6, hasEvidence: true,
    });
    const result = writeSnapshotForTopic(PHONE, {
      topicId: TOPIC_A, confidence: 0.50 + DEFAULT_TREND_NOISE_THRESHOLD + 0.01, confidenceLabel: 'Medium',
      evidenceScore: 0.4, consistencyScore: 0.5, recencyScore: 0.6, hasEvidence: true,
    });
    assertEq(result, 'updated', 'a past-threshold move on the same day updates in place');
    assertEq(snapshotRows(PHONE, TOPIC_A).length, 1, 'same-day cap: still one row, updated not inserted');
  }

  console.log('\nTest 4: same-day cap holds across more than two writes');
  clearAll();
  {
    writeSnapshotForTopic(PHONE, {
      topicId: TOPIC_A, confidence: 0.10, confidenceLabel: 'Low',
      evidenceScore: 0.1, consistencyScore: 0.1, recencyScore: 0.1, hasEvidence: true,
    });
    writeSnapshotForTopic(PHONE, {
      topicId: TOPIC_A, confidence: 0.30, confidenceLabel: 'Medium',
      evidenceScore: 0.3, consistencyScore: 0.3, recencyScore: 0.3, hasEvidence: true,
    });
    writeSnapshotForTopic(PHONE, {
      topicId: TOPIC_A, confidence: 0.60, confidenceLabel: 'Medium',
      evidenceScore: 0.6, consistencyScore: 0.6, recencyScore: 0.6, hasEvidence: true,
    });
    const rows = snapshotRows(PHONE, TOPIC_A);
    assertEq(rows.length, 1, 'three meaningfully-different same-day writes still yield one row');
    assertEq(rows[0].confidence, 0.60, 'the one row reflects the latest written value');
  }

  console.log('\nTest 5: createReflection triggers a snapshot');
  clearAll();
  {
    reflectionService.createReflection(PHONE, { content: 'Went well today', topicId: TOPIC_A });
    const rows = snapshotRows(PHONE, TOPIC_A);
    assert(rows.length === 1, 'saving a reflection produces exactly one snapshot row for its topic');
  }

  console.log('\nTest 6: a growth plan status change triggers a snapshot');
  clearAll();
  {
    reflectionService.createReflection(PHONE, { content: 'r1', topicId: TOPIC_A });
    _db.exec(`DELETE FROM coaching_snapshots`); // isolate this test from Test 5's trigger
    const plan = growthPlanService.createGrowthPlan(PHONE, { goalText: 'goal', topicId: TOPIC_A });
    _db.exec(`DELETE FROM coaching_snapshots`); // isolate from createGrowthPlan's own trigger (Test 6b covers that)
    const afterCreate = snapshotRows(PHONE, TOPIC_A).length;
    growthPlanService.updateGrowthPlan(PHONE, plan.id, { status: 'in_progress' });
    const afterStatusChange = snapshotRows(PHONE, TOPIC_A).length;
    assertEq(afterCreate, 0, 'no snapshot row yet immediately before the status-change call');
    assertEq(afterStatusChange, 1, 'the status change specifically produces exactly one snapshot row');
  }

  console.log('\nTest 6b: growth plan creation triggers a snapshot (evidence-event philosophy)');
  clearAll();
  {
    reflectionService.createReflection(PHONE, { content: 'r1', topicId: TOPIC_A });
    _db.exec(`DELETE FROM coaching_snapshots`); // isolate from the reflection's own trigger
    growthPlanService.createGrowthPlan(PHONE, { goalText: 'goal', topicId: TOPIC_A });
    assertEq(snapshotRows(PHONE, TOPIC_A).length, 1, 'creating a growth plan writes a snapshot');
  }

  console.log('\nTest 6c: a growth plan topicId reassignment (no status change) triggers a snapshot');
  clearAll();
  {
    const TOPIC_B = 'TOPIC_ASSESSMENT';
    reflectionService.createReflection(PHONE, { content: 'r1', topicId: TOPIC_A });
    reflectionService.createReflection(PHONE, { content: 'r2', topicId: TOPIC_B });
    const plan = growthPlanService.createGrowthPlan(PHONE, { goalText: 'goal', topicId: TOPIC_A });
    _db.exec(`DELETE FROM coaching_snapshots`); // isolate from the creates above
    growthPlanService.updateGrowthPlan(PHONE, plan.id, { topicId: TOPIC_B });
    assertEq(snapshotRows(PHONE, TOPIC_B).length, 1, 'reassigning topicId alone still writes a snapshot');
  }

  console.log('\nTest 7: updating a growth plan WITHOUT a status or topicId change does not snapshot');
  clearAll();
  {
    const plan = growthPlanService.createGrowthPlan(PHONE, { goalText: 'goal', topicId: TOPIC_A });
    _db.exec(`DELETE FROM coaching_snapshots`); // isolate from createGrowthPlan (Test 6b covers that trigger)
    growthPlanService.updateGrowthPlan(PHONE, plan.id, { goalText: 'revised goal text' });
    assertEq(snapshotRows(PHONE, TOPIC_A).length, 0, 'editing goalText alone writes no snapshot');
  }

  console.log('\nTest 7b: reflection topicId reassignment triggers a snapshot; content-only edit does not');
  clearAll();
  {
    const TOPIC_B = 'TOPIC_ASSESSMENT';
    const r = reflectionService.createReflection(PHONE, { content: 'r1', topicId: TOPIC_A });
    _db.exec(`DELETE FROM coaching_snapshots`); // isolate from createReflection's own trigger
    reflectionService.updateReflection(PHONE, r.id, { content: 'revised content' });
    assertEq(snapshotRows(PHONE, TOPIC_A).length, 0, 'editing content alone writes no snapshot');
    reflectionService.updateReflection(PHONE, r.id, { topicId: TOPIC_B });
    assertEq(snapshotRows(PHONE, TOPIC_B).length, 1, 'reassigning topicId writes a snapshot');
  }

  console.log('\nTest 7c: deleting a reflection triggers a snapshot, capturing the drop to zero evidence');
  clearAll();
  {
    const r = reflectionService.createReflection(PHONE, { content: 'r1', topicId: TOPIC_A });
    const beforeDelete = snapshotRows(PHONE, TOPIC_A);
    assert(beforeDelete.length === 1 && beforeDelete[0].confidence > 0, 'sanity: topic has a positive-confidence snapshot before deletion');
    reflectionService.deleteReflection(PHONE, r.id);
    const afterDelete = snapshotRows(PHONE, TOPIC_A);
    assertEq(afterDelete.length, 1, 'still one row (same-day update, not a new insert)');
    assertEq(afterDelete[0].confidence, 0, 'confidence drops to 0 once the only evidence is deleted');
  }

  console.log('\nTest 7d: a topic the teacher never touches gets no snapshot row at all');
  clearAll();
  {
    const TOPIC_UNTOUCHED = 'TOPIC_DIFFERENTIATION';
    reflectionService.createReflection(PHONE, { content: 'r1', topicId: TOPIC_A });
    assertEq(snapshotRows(PHONE, TOPIC_UNTOUCHED).length, 0, 'a never-touched topic writes no zero-confidence noise row');
  }

  console.log('\nTest 8: read paths never write (§9 invariant 1)');
  clearAll();
  {
    reflectionService.createReflection(PHONE, { content: 'r1', topicId: TOPIC_A });
    const before = snapshotRows(PHONE, TOPIC_A).length;
    getCoachingInsights(PHONE);
    getCoachingInsights(PHONE);
    const after = snapshotRows(PHONE, TOPIC_A).length;
    assertEq(after, before, 'calling getCoachingInsights (a read) does not create additional snapshot rows');
  }

  console.log('\nTest 9: recordSnapshotsForTeacher covers every topic with evidence, not just one');
  clearAll();
  {
    const TOPIC_B = 'TOPIC_ASSESSMENT';
    reflectionService.createReflection(PHONE, { content: 'r1', topicId: TOPIC_A });
    reflectionService.createReflection(PHONE, { content: 'r2', topicId: TOPIC_B });
    _db.exec(`DELETE FROM coaching_snapshots`);
    recordSnapshotsForTeacher(PHONE);
    assertEq(snapshotRows(PHONE, TOPIC_A).length, 1, 'topic A actually has a stored snapshot row');
    assertEq(snapshotRows(PHONE, TOPIC_B).length, 1, 'topic B actually has a stored snapshot row');
  }

  clearAll();

  console.log(`\n${'─'.repeat(55)}`);
  console.log(`coachingSnapshotService Results: ${passed} passed, ${failed} failed`);
  testDb.cleanup();
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
