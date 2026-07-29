'use strict';
/**
 * Migration 035 — link intervention_plans to learner identity
 * (learner_id) and add an outcome_status slot.
 *
 * Same convention as tests/migration-028-observation-corrections.test.js:
 * runs the real runMigrations() (the function server.js calls at
 * startup) against a temp SQLite file via node:sqlite, rather than a
 * hand-built schema mock — proves the migration is actually wired in,
 * not just syntactically valid.
 *
 * Run individually:   node tests/migration-035-intervention-learner-link.test.js
 * Run via npm:         npm test
 */

const path = require('path');
const fs = require('fs');

// ── Shim better-sqlite3 → node:sqlite (same convention as
//    tests/migration-028-observation-corrections.test.js) ──────────────────
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

const TEST_DB_PATH = path.join(__dirname, '..', 'migration-035-test.db');
process.env.DB_PATH = TEST_DB_PATH;
if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
_db = new DatabaseSync(TEST_DB_PATH);

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

async function run() {
  const { getDb, runMigrations } = require('../utils/database');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 1: Migration 035 is actually wired into the real runMigrations()
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\nSection 1: Migration 035 applies via the real runMigrations()');

  runMigrations();
  const db = getDb();

  function columnNames(table) {
    return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  }

  const planCols = columnNames('intervention_plans');
  assert(planCols.includes('learner_id'), 'intervention_plans gains learner_id');
  assert(planCols.includes('outcome_status'), 'intervention_plans gains outcome_status');

  const indexNames = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`)
    .all()
    .map(r => r.name);
  assert(indexNames.includes('idx_intervention_plans_learner'), 'supporting index on learner_id is created');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 2: the columns are actually usable against the real migrated
  // schema — insert through raw SQL, not a repository-boundary mock.
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\nSection 2: the real schema accepts writes referencing the new columns');

  db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run('migration035_smoke');

  const learnerInsert = db.prepare(`
    INSERT INTO learners (phone_hash, canonical_name, normalized_name)
    VALUES (?, ?, ?)
  `).run('migration035_smoke', 'Thabo M', 'thabo m');
  const learnerId = learnerInsert.lastInsertRowid;
  assert(learnerId > 0, 'a learner row inserts to link against');

  const planWithLearner = db.prepare(`
    INSERT INTO intervention_plans
      (phone_hash, problem_area, target_group, goals, duration_days, strategies, learner_id, outcome_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('migration035_smoke', 'Fractions', 'Group A', 'Master common fractions', 14, 'Small-group reteach', learnerId, 'improved');
  assert(planWithLearner.lastInsertRowid > 0, 'a plan referencing learner_id and outcome_status inserts without error');

  const planWithoutLearner = db.prepare(`
    INSERT INTO intervention_plans
      (phone_hash, problem_area, target_group, goals, duration_days, strategies)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('migration035_smoke', 'Place value', 'Group B', 'Master place value', 14, 'Whole-class reteach');
  assert(planWithoutLearner.lastInsertRowid > 0, 'a pre-existing-style plan with no learner_id still inserts (nullable + additive)');

  const readBack = db.prepare(`SELECT learner_id, outcome_status FROM intervention_plans WHERE id = ?`).get(planWithLearner.lastInsertRowid);
  assert(readBack.learner_id === learnerId, 'learner_id round-trips correctly');
  assert(readBack.outcome_status === 'improved', 'outcome_status round-trips correctly');

  const readBackNull = db.prepare(`SELECT learner_id, outcome_status FROM intervention_plans WHERE id = ?`).get(planWithoutLearner.lastInsertRowid);
  assert(readBackNull.learner_id === null, 'learner_id defaults to NULL when not supplied');
  assert(readBackNull.outcome_status === null, 'outcome_status defaults to NULL when not supplied');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 3: idempotency — a second runMigrations() call does not throw
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\nSection 3: Migration 035 is idempotent — a second runMigrations() call does not throw');
  let secondRunErr = null;
  try {
    runMigrations();
  } catch (err) {
    secondRunErr = err;
  }
  assert(secondRunErr === null, `re-running runMigrations() against an already-migrated db does not throw${secondRunErr ? ': ' + secondRunErr.message : ''}`);
  assert(columnNames('intervention_plans').includes('learner_id'), 'learner_id still present after the second run');
  assert(columnNames('intervention_plans').includes('outcome_status'), 'outcome_status still present after the second run');

  // ── Cleanup ──────────────────────────────────────────────────────────────
  try { fs.unlinkSync(TEST_DB_PATH); } catch (_) { /* best-effort */ }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`Migration 035 Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
