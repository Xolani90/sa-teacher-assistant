'use strict';
/**
 * tests/tseGrowthInsightService.test.js
 *
 * Uses node:sqlite (same shim convention as tests/tseEvidenceService.test.js)
 * against a minimal hand-built schema covering exactly the tables this
 * service reads: teachers, assessments, curriculum_coverage,
 * intervention_plans, observation_assessments.
 *
 * Run individually: node tests/tseGrowthInsightService.test.js
 * Run via npm:       npm test
 */

// ── Shared real-migrations test DB helper (see docs/TSE_SCHOOL_CALENDAR_TEST_GAP.md) ──
const { createTestDb } = require('./helpers/createTestDb');

// getDb() (utils/database.js) is a true process-wide singleton once
// migrated — it can't be swapped for a fresh db mid-run the way the old
// hand-rolled shim allowed. resetDb() clears rows from just the tables
// this service reads instead. No cross-scenario id reuse is relied on
// here (unlike tests/pr22-whatsapp-otp.test.js), so no sqlite_sequence
// reset is needed.
function resetDb(db) {
  db.exec(`
    DELETE FROM intervention_plans;
    DELETE FROM curriculum_coverage;
    DELETE FROM observation_assessments;
    DELETE FROM assessments;
    DELETE FROM teachers;
  `);
  return db;
}

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  \u2705 ${msg}`);
  } else {
    failed++;
    console.log(`  \u274c ${msg}`);
  }
}

function run() {
  const testDb = createTestDb(__filename);
  let _db = testDb.db;

  const { getGrowthInsights } = require('../services/tseGrowthInsightService');
  const TERM = 3;

  console.log('\n\u2500\u2500 Scenario 1: complete evidence \u2500\u2500');
  resetDb(_db);
  _db.prepare(`INSERT INTO teachers (phone_hash) VALUES (?)`).run('t1');
  _db.prepare(
    `INSERT INTO curriculum_coverage (phone_hash, grade, subject, term, topic, covered) VALUES (?,?,?,?,?,1)`
  ).run('t1', 7, 'mathematics', TERM, 'Fractions');
  const aId = _db
    .prepare(
      `INSERT INTO assessments (phone_hash, title, grade, subject, term, assessment_type, total_marks) VALUES (?,?,?,?,?,?,?)`
    )
    .run('t1', 'Fractions Test', 7, 'mathematics', TERM, 'formal', 50).lastInsertRowid;
  _db.prepare(`INSERT INTO intervention_plans (phone_hash, assessment_id, problem_area, target_group, goals, duration_days, strategies) VALUES (?,?,?,?,?,?,?)`).run(
    't1',
    aId,
    'Fractions', 'Whole class', 'Improve fraction fluency', 14, 'Small-group re-teach'
  );
  let result = getGrowthInsights('t1', { term: TERM });
  assert(result.gaps.length === 0, 'no gaps when coverage -> assessment -> intervention all link up');
  assert(typeof result.strength === 'string', 'strength message present when no gaps');

  console.log('\n\u2500\u2500 Scenario 2: missing intervention evidence \u2500\u2500');
  resetDb(_db);
  _db.prepare(`INSERT INTO teachers (phone_hash) VALUES (?)`).run('t2');
  _db.prepare(
    `INSERT INTO assessments (phone_hash, title, grade, subject, term, assessment_type, total_marks) VALUES (?,?,?,?,?,?,?)`
  ).run('t2', 'Algebra Test', 8, 'mathematics', TERM, 'formal', 50);
  result = getGrowthInsights('t2', { term: TERM });
  assert(
    result.gaps.some((g) => g.type === 'assessment_without_intervention'),
    'flags an assessment with no linked intervention plan'
  );
  assert(result.strength === null, 'no strength message when gaps exist');
  assert(result.suggestedAction !== null, 'suggestedAction populated when gaps exist');

  console.log('\n\u2500\u2500 Scenario 3: coverage marked, no assessment ever recorded \u2500\u2500');
  resetDb(_db);
  _db.prepare(`INSERT INTO teachers (phone_hash) VALUES (?)`).run('t3');
  _db.prepare(
    `INSERT INTO curriculum_coverage (phone_hash, grade, subject, term, topic, covered) VALUES (?,?,?,?,?,1)`
  ).run('t3', 9, 'english', TERM, 'Poetry');
  result = getGrowthInsights('t3', { term: TERM });
  assert(
    result.gaps.some((g) => g.type === 'coverage_without_assessment'),
    'flags covered topic with no matching assessment'
  );

  console.log('\n\u2500\u2500 Scenario 4: observations with zero intervention follow-up \u2500\u2500');
  resetDb(_db);
  _db.prepare(`INSERT INTO teachers (phone_hash) VALUES (?)`).run('t4');
  _db.prepare(`INSERT INTO observation_assessments (phone_hash) VALUES (?)`).run('t4');
  result = getGrowthInsights('t4', { term: TERM });
  assert(
    result.gaps.some((g) => g.type === 'observation_without_followup'),
    'flags observations with no intervention plans at all'
  );

  console.log('\n\u2500\u2500 Scenario 5: empty profile \u2500\u2500');
  resetDb(_db);
  _db.prepare(`INSERT INTO teachers (phone_hash) VALUES (?)`).run('t5');
  result = getGrowthInsights('t5', { term: TERM });
  assert(result.gaps.length === 0, 'a teacher with zero evidence has zero gaps (nothing to compare)');
  assert(result.strength !== null, 'empty profile still resolves to the positive/no-gaps branch');

  console.log('\n\u2500\u2500 Scenario 6: input guard \u2500\u2500');
  resetDb(_db);
  let threw = false;
  try {
    getGrowthInsights(null);
  } catch (e) {
    threw = true;
  }
  assert(threw, 'missing phoneHash throws');

  console.log('\n\u2500\u2500 Scenario 7: DB failure is non-fatal per rule, does not crash the call \u2500\u2500');
  resetDb(_db);
  _db.prepare(`INSERT INTO teachers (phone_hash) VALUES (?)`).run('t7');
  const origPrepare = _db.prepare.bind(_db);
  let callCount = 0;
  _db.prepare = (sql) => {
    callCount++;
    if (callCount === 1) throw new Error('simulated db error');
    return origPrepare(sql);
  };
  let ok = true;
  try {
    getGrowthInsights('t7', { term: TERM });
  } catch (e) {
    ok = false;
  }
  assert(ok, 'a per-rule query failure is caught and logged, not thrown to the caller');

  console.log(`\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nGrowth Insight Results: ${passed} passed, ${failed} failed\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);

  testDb.cleanup();

  if (failed > 0) process.exit(1);
}

run();
