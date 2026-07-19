'use strict';
/**
 * ADR-003 PR 1 — Learner identity schema foundation
 *
 * Verifies Migration 024 (create `learners`) and Migration 025 (add
 * nullable `learner_id` to `learner_results` / `observation_records`)
 * per docs/adr/ADR-003-longitudinal-learner-progress.md.
 *
 * Scope is intentionally narrow, matching PR 1 of the ADR-003
 * implementation sequence: schema evolution only, zero behavioural
 * change. No matching logic, no data migration, no backfill is
 * exercised here.
 *
 * Runs runMigrations() for real (same function server.js calls at
 * startup) against a throwaway file-backed DB, same convention as
 * scripts/bootstrap-check.js — not a hand-copied schema mock, so this
 * test fails if the real migration ever drifts from what's asserted
 * here.
 *
 * Run individually:   node tests/adr003-learners-migration.test.js
 * Run via npm:         npm test
 */

const path = require('path');
const fs = require('fs');

// ── Shim better-sqlite3 → node:sqlite ────────────────────────────────────
// Same convention as tests/phase-6-observation-repository.test.js. This
// still exercises the REAL runMigrations()/getDb() from utils/database.js
// — only the underlying SQLite binding is swapped, because DatabaseSync's
// API is close enough to better-sqlite3's for schema/DDL purposes.
const Module = require('module');
const { DatabaseSync } = require('node:sqlite');

let _db = null;

const _origResolve = Module._resolveFilename.bind(Module);
Module._resolveFilename = function (request, parent, isMain, opts) {
  if (request === 'better-sqlite3') return request;
  return _origResolve(request, parent, isMain, opts);
};
require.cache['better-sqlite3'] = {
  id: 'better-sqlite3',
  filename: 'better-sqlite3',
  loaded: true,
  exports: function Database() {
    if (!_db.pragma) _db.pragma = () => {};
    return _db;
  },
};

process.env.DB_PATH = path.join(__dirname, '..', 'adr003-migration-test.db');
if (fs.existsSync(process.env.DB_PATH)) fs.unlinkSync(process.env.DB_PATH);
_db = new DatabaseSync(process.env.DB_PATH);

// ── Helpers ───────────────────────────────────────────────────────────────
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

async function run() {
  const { getDb, runMigrations } = require('../utils/database');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 1: Migration — schema applies cleanly (and idempotently)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\nSection 1: migration application');

  runMigrations();
  const db = getDb();

  const tableNames = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .all()
    .map((r) => r.name);
  assert(tableNames.includes('learners'), 'learners table created');

  const indexNames = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`)
    .all()
    .map((r) => r.name);
  for (const idx of [
    'idx_learners_phone',
    'idx_learners_class',
    'idx_learners_lookup',
    'idx_learner_results_learner',
    'idx_observation_records_learner',
  ]) {
    assert(indexNames.includes(idx), `index ${idx} created`);
  }

  const learnerResultsCols = db.prepare(`PRAGMA table_info(learner_results)`).all();
  const lrLearnerId = learnerResultsCols.find((c) => c.name === 'learner_id');
  assert(!!lrLearnerId, 'learner_results gains a learner_id column');
  assertEq(lrLearnerId && lrLearnerId.notnull, 0, 'learner_results.learner_id is nullable');

  const obsRecordsCols = db.prepare(`PRAGMA table_info(observation_records)`).all();
  const orLearnerId = obsRecordsCols.find((c) => c.name === 'learner_id');
  assert(!!orLearnerId, 'observation_records gains a learner_id column');
  assertEq(orLearnerId && orLearnerId.notnull, 0, 'observation_records.learner_id is nullable');

  // Re-running migrations (as happens on every server restart) must be a
  // safe no-op — this is the whole premise of the try/catch ALTER pattern
  // and CREATE ... IF NOT EXISTS used throughout utils/database.js.
  let rerunThrew = false;
  try {
    runMigrations();
  } catch (err) {
    rerunThrew = true;
    console.error('     rerun error:', err.message);
  }
  assert(!rerunThrew, 'running migrations twice does not throw');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 2: Compatibility — existing rows untouched
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\nSection 2: backward compatibility with pre-existing rows');

  const PHONE = 'adr003_test_hash_001';
  db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(PHONE);

  const assessmentId = db
    .prepare(
      `INSERT INTO assessments (phone_hash, title, grade, subject, term, assessment_type, total_marks)
       VALUES (?, 'Legacy Assessment', 7, 'Maths', 1, 'test', 10)`
    )
    .run(PHONE).lastInsertRowid;

  // Simulates a row exactly as it would have been written before Migration
  // 024/025 existed: learner_name populated, no awareness of learner_id.
  db.prepare(
    `INSERT INTO learner_results (assessment_id, learner_name, mark, total_marks, percentage)
     VALUES (?, 'Sipho', 8, 10, 80.0)`
  ).run(assessmentId);

  const legacyRow = db
    .prepare(`SELECT * FROM learner_results WHERE assessment_id = ?`)
    .get(assessmentId);
  assertEq(legacyRow.learner_name, 'Sipho', 'pre-existing learner_name is preserved unchanged');
  assertEq(legacyRow.mark, 8, 'pre-existing mark is preserved unchanged');
  assertEq(legacyRow.learner_id, null, 'pre-existing row has no learner_id (left NULL, not guessed at)');

  const obsAssessmentId = db
    .prepare(
      `INSERT INTO observation_assessments (phone_hash, grade, subject, assessment_name)
       VALUES (?, 'R', 'Literacy', 'Legacy Observation')`
    )
    .run(PHONE).lastInsertRowid;

  db.prepare(
    `INSERT INTO observation_records (assessment_id, learner_name, domain, developmental_status)
     VALUES (?, 'sipho', 'Reading', 'Achieved')`
  ).run(obsAssessmentId);

  const legacyObsRow = db
    .prepare(`SELECT * FROM observation_records WHERE assessment_id = ?`)
    .get(obsAssessmentId);
  assertEq(legacyObsRow.learner_name, 'sipho', 'pre-existing observation learner_name is preserved unchanged');
  assertEq(legacyObsRow.learner_id, null, 'pre-existing observation row has no learner_id');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 3: Null FK — learner_id may be NULL, and can be set later
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\nSection 3: learner_id nullability');

  let insertThrew = false;
  try {
    db.prepare(
      `INSERT INTO learner_results (assessment_id, learner_name, mark, total_marks, percentage)
       VALUES (?, 'Thandi', 5, 10, 50.0)`
    ).run(assessmentId);
  } catch (err) {
    insertThrew = true;
  }
  assert(!insertThrew, 'inserting learner_results without learner_id succeeds');

  let learnerInsertThrew = false;
  let newLearnerId = null;
  try {
    newLearnerId = db
      .prepare(
        `INSERT INTO learners (phone_hash, canonical_name, normalized_name)
         VALUES (?, 'Sipho N', 'sipho n')`
      )
      .run(PHONE).lastInsertRowid;
  } catch (err) {
    learnerInsertThrew = true;
  }
  assert(!learnerInsertThrew, 'inserting a learner without a class_id succeeds');

  db.prepare(`UPDATE learner_results SET learner_id = ? WHERE learner_name = 'Thandi'`).run(newLearnerId);
  const linkedRow = db.prepare(`SELECT learner_id FROM learner_results WHERE learner_name = 'Thandi'`).get();
  assertEq(linkedRow.learner_id, newLearnerId, 'a learner_results row can be linked via learner_id after the fact');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 4: Rollback safety — existing query patterns still work
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\nSection 4: existing query patterns remain valid without learner_id');

  const allResults = db.prepare(`SELECT * FROM learner_results`).all();
  assert(allResults.length > 0, 'plain SELECT * over learner_results does not require learner_id');

  const byName = db
    .prepare(`SELECT * FROM learner_results WHERE LOWER(learner_name) = ?`)
    .all('sipho');
  assert(byName.length > 0, 'existing name-based lookups (pre-ADR-003 pattern) still return rows');

  // Documents the trap this ADR warns about: code that assumes every
  // evidence row has a matched learner should use LEFT JOIN, not INNER
  // JOIN, until backfill/matching (PR 2+) is complete. An INNER JOIN here
  // silently drops the still-unmatched 'Sipho' row from Section 2.
  const innerJoined = db
    .prepare(
      `SELECT lr.* FROM learner_results lr
       INNER JOIN learners l ON l.id = lr.learner_id`
    )
    .all();
  const leftJoined = db
    .prepare(
      `SELECT lr.* FROM learner_results lr
       LEFT JOIN learners l ON l.id = lr.learner_id`
    )
    .all();
  assert(
    leftJoined.length > innerJoined.length,
    'INNER JOIN against learners silently drops unmatched legacy rows (LEFT JOIN required until backfill exists)'
  );

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`ADR-003 PR1 Migration Results: ${passed} passed, ${failed} failed`);

  db.close();
  fs.unlinkSync(process.env.DB_PATH);
  for (const ext of ['-wal', '-shm']) {
    const f = process.env.DB_PATH + ext;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
