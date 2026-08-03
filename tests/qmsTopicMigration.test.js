'use strict';
/**
 * Migration 039 Tests (PR32, ADR-013 §4.4/§4.5/§8 Section 6)
 *
 * Covers:
 *   1. qms_reflections and qms_growth_plans both gain a topic_id column
 *   2. Existing (pre-migration) rows remain readable with topic_id NULL
 *   3. New rows can write a valid topicId
 *   4. Migration is idempotent — running it twice is a no-op, not an error
 *   5. target_area is left in place on qms_growth_plans (not dropped)
 *
 * Run individually:   node tests/qmsTopicMigration.test.js
 * Run via npm:         npm test
 */

const { createTestDb } = require('./helpers/createTestDb');
const testDb = createTestDb(__filename);
const _db = testDb.db;

const { getDb, runMigrations } = require('../utils/database');

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

function columnNames(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

async function run() {
  const db = getDb();

  console.log('📋 Section 6: Migration 039 — topic_id columns');

  const reflectionCols = columnNames(db, 'qms_reflections');
  assert(reflectionCols.includes('topic_id'), 'qms_reflections gained topic_id column');

  const growthPlanCols = columnNames(db, 'qms_growth_plans');
  assert(growthPlanCols.includes('topic_id'), 'qms_growth_plans gained topic_id column');
  assert(growthPlanCols.includes('target_area'), 'qms_growth_plans.target_area was left in place, not dropped (ADR-013 §4.4)');

  // Simulate a pre-PR32 row: insert without topic_id (as the old code path would).
  const insertedReflection = db
    .prepare(`INSERT INTO qms_reflections (phone_hash, content) VALUES (?, ?)`)
    .run('27821110099', 'Legacy reflection with no topic.');
  const legacyReflection = db
    .prepare(`SELECT * FROM qms_reflections WHERE id = ?`)
    .get(Number(insertedReflection.lastInsertRowid));

  assert(legacyReflection !== undefined, 'pre-migration-style reflection row remains readable');
  assert(legacyReflection.topic_id === null, 'legacy reflection has topic_id IS NULL (ADR-013 §4.5)');

  const insertedPlan = db
    .prepare(`INSERT INTO qms_growth_plans (phone_hash, goal_text, target_area) VALUES (?, ?, ?)`)
    .run('27821110099', 'Legacy goal', 'Some free text focus area');
  const legacyPlan = db
    .prepare(`SELECT * FROM qms_growth_plans WHERE id = ?`)
    .get(Number(insertedPlan.lastInsertRowid));

  assert(legacyPlan !== undefined, 'pre-migration-style growth plan row remains readable');
  assert(legacyPlan.topic_id === null, 'legacy growth plan has topic_id IS NULL (ADR-013 §4.5)');
  assertEq(legacyPlan.target_area, 'Some free text focus area', 'legacy target_area value is preserved, untouched');

  // New row with a valid topicId.
  const insertedTagged = db
    .prepare(`INSERT INTO qms_reflections (phone_hash, content, topic_id) VALUES (?, ?, ?)`)
    .run('27821110099', 'A properly tagged new reflection.', 'TOPIC_CLASSROOM_MANAGEMENT');
  const taggedReflection = db
    .prepare(`SELECT * FROM qms_reflections WHERE id = ?`)
    .get(Number(insertedTagged.lastInsertRowid));

  assertEq(taggedReflection.topic_id, 'TOPIC_CLASSROOM_MANAGEMENT', 'new row can write a valid topicId');

  console.log('📋 Idempotency');

  let secondRunThrew = false;
  try {
    runMigrations();
  } catch (err) {
    secondRunThrew = true;
    console.error('     unexpected throw:', err.message);
  }
  assert(!secondRunThrew, 'running migrations a second time does not throw');

  const reflectionColsAfterRerun = columnNames(db, 'qms_reflections');
  const topicIdCount = reflectionColsAfterRerun.filter((c) => c === 'topic_id').length;
  assertEq(topicIdCount, 1, 'topic_id column was not duplicated by re-running migrations');

  // Confirm the row inserted before the second migration run is still intact.
  const stillThere = db
    .prepare(`SELECT * FROM qms_reflections WHERE id = ?`)
    .get(Number(insertedTagged.lastInsertRowid));
  assertEq(stillThere.topic_id, 'TOPIC_CLASSROOM_MANAGEMENT', 'data survives a second migration run');

  console.log('─────────────────────────────────');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('─────────────────────────────────');

  testDb.cleanup();
  if (failed > 0) process.exit(1);
}

run();
