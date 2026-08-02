'use strict';
/**
 * Backfill script tests (scripts/backfillTseEvidence.js).
 *
 * Covers:
 *   1. Backfilling pre-existing rows tags them correctly
 *   2. Re-running the backfill is idempotent (no duplicate rows)
 *   3. --dry-run mode makes no writes but reports what it would do
 *   4. Rows with a falsy phone_hash are skipped, not errored on
 *
 * Run individually:   node tests/backfillTseEvidence.test.js
 * Run via npm:        npm test
 */

// ── Shared real-migrations test DB helper (see docs/TSE_SCHOOL_CALENDAR_TEST_GAP.md) ──
const { createTestDb } = require('./helpers/createTestDb');

let passed = 0;
let failed = 0;

function assertEq(a, b, label) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) { console.log(`  ✅ ${label}`); passed++; }
  else {
    console.error(`  ❌ FAIL: ${label}`);
    console.error(`     expected: ${JSON.stringify(b)}`);
    console.error(`     got:      ${JSON.stringify(a)}`);
    failed++;
  }
}

async function run() {
  const testDb = createTestDb(__filename);
  const _db = testDb.db;

  const PHONE = 'backfill_test_hash';

  // Real tables enforce FOREIGN KEY (phone_hash) REFERENCES teachers(phone_hash),
  // unlike the hand-rolled schema this replaces — seed the teacher row first.
  _db.prepare(`INSERT INTO teachers (phone_hash) VALUES (?)`).run(PHONE);
  // Also seed a teacher row for the empty-phone_hash edge case below, since
  // the real schema's FK constraint checks even a non-NULL empty string.
  _db.prepare(`INSERT INTO teachers (phone_hash) VALUES ('')`).run();

  // Seed pre-existing rows across all six source tables, filling every
  // NOT NULL column the real migrated schema requires (the hand-rolled
  // schema this replaces only had id/phone_hash/term, which the real
  // tables no longer accept).
  const assessmentId = _db
    .prepare(
      `INSERT INTO assessments (phone_hash, title, grade, subject, term, assessment_type, total_marks)
       VALUES (?, 'Fractions Test', 7, 'mathematics', 3, 'test', 20)`
    )
    .run(PHONE).lastInsertRowid;

  _db.prepare(
    `INSERT INTO saved_resources (phone_hash, resource_type, title, content)
     VALUES (?, 'worksheet', 'Fractions — worksheet', 'content body')`
  ).run(PHONE);

  _db.prepare(
    `INSERT INTO reports (phone_hash, assessment_id, report_type, content)
     VALUES (?, ?, 'diagnostic', 'report body')`
  ).run(PHONE, assessmentId);

  _db.prepare(
    `INSERT INTO intervention_plans (phone_hash, problem_area, target_group, goals, duration_days, strategies)
     VALUES (?, 'Fractions', 'Whole class', 'Improve mastery', 14, 'Small-group revision')`
  ).run(PHONE);

  _db.prepare(
    `INSERT INTO curriculum_coverage (phone_hash, grade, subject, term, topic)
     VALUES (?, 7, 'mathematics', 3, 'Fractions')`
  ).run(PHONE);

  _db.prepare(
    `INSERT INTO observation_assessments (phone_hash, grade, subject, assessment_name)
     VALUES (?, '0', 'life skills', 'Term 3 observation')`
  ).run(PHONE);

  // Edge case: a row with a falsy (but schema-legal, since phone_hash is
  // NOT NULL in the real tables) phone_hash — should be skipped, not
  // thrown on. An empty string exercises backfillTable()'s `!row.phone_hash`
  // guard the same way a literal NULL would, without violating the real
  // schema's NOT NULL constraint (a genuine NULL is no longer insertable
  // here — see docs/TSE_SCHOOL_CALENDAR_TEST_GAP.md).
  _db.prepare(
    `INSERT INTO saved_resources (phone_hash, resource_type, title, content)
     VALUES ('', 'worksheet', 'Orphaned — worksheet', 'content body')`
  ).run();

  const { backfillTable } = require('../scripts/backfillTseEvidence');

  console.log('\n── Backfill: dry run ─────────────────────────────────────────────────');

  console.log('\nTest BF-01: --dry-run does not write any rows');
  process.argv.push('--dry-run');
  delete require.cache[require.resolve('../scripts/backfillTseEvidence')];
  const dryRunModule = require('../scripts/backfillTseEvidence');
  dryRunModule.backfillTable({ table: 'saved_resources', category: 'resource' });
  const countAfterDryRun = _db.prepare(`SELECT COUNT(*) as c FROM tse_evidence_links`).get();
  assertEq(countAfterDryRun.c, 0, 'no rows written during --dry-run');
  process.argv = process.argv.filter((a) => a !== '--dry-run');
  delete require.cache[require.resolve('../scripts/backfillTseEvidence')];

  console.log('\n── Backfill: real run ────────────────────────────────────────────────');

  const { backfillTable: realBackfillTable } = require('../scripts/backfillTseEvidence');

  console.log('\nTest BF-02: backfilling each table tags exactly one row (one pre-existing row per table)');
  const targets = [
    { table: 'saved_resources', category: 'resource' },
    { table: 'assessments', category: 'assessment' },
    { table: 'reports', category: 'assessment' },
    { table: 'intervention_plans', category: 'intervention' },
    { table: 'curriculum_coverage', category: 'curriculum' },
    { table: 'observation_assessments', category: 'observation' },
  ];
  let totalTagged = 0;
  for (const target of targets) {
    const { tagged } = realBackfillTable(target);
    totalTagged += tagged;
  }
  // saved_resources has 2 rows (1 valid + 1 empty phone_hash, skipped) → 1 tagged.
  assertEq(totalTagged, 6, 'exactly 6 evidence rows tagged (one per table, empty-phone row skipped)');

  console.log('\nTest BF-03: falsy phone_hash row was skipped, not errored on');
  const resourceEvidenceCount = _db.prepare(`SELECT COUNT(*) as c FROM tse_evidence_links WHERE source_table='saved_resources'`).get();
  assertEq(resourceEvidenceCount.c, 1, 'only the valid saved_resources row was tagged');

  console.log('\nTest BF-04: re-running backfill is idempotent (no duplicate rows)');
  let totalTaggedSecondRun = 0;
  for (const target of targets) {
    const { tagged } = realBackfillTable(target);
    totalTaggedSecondRun += tagged;
  }
  assertEq(totalTaggedSecondRun, 0, 'second backfill run tags zero new rows');
  const finalCount = _db.prepare(`SELECT COUNT(*) as c FROM tse_evidence_links`).get();
  assertEq(finalCount.c, 6, 'total evidence row count unchanged after re-running backfill');

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`backfillTseEvidence.test.js: ${passed} passed, ${failed} failed`);

  testDb.cleanup();

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Test run crashed:', err);
  process.exit(1);
});
