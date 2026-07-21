'use strict';
/**
 * Migration 028 — observation corrections (corrects_assessment_id) +
 * resolved follow-up flag, and a guard against the bug class that
 * caused it to reach production without the columns.
 *
 * BACKGROUND: this migration was originally shipped as a standalone
 * migration_observation_corrections_resolution.sql file at the repo
 * root. Nothing in this app's startup path executes loose .sql files —
 * only the in-code `alterations` array inside utils/database.js's
 * runMigrations() actually runs against the live Render database. The
 * .sql file was committed, reviewed, and merged, and every existing
 * test suite passed, because every one of them either builds its own
 * schema from scratch or mocks the repository boundary — none of them
 * exercise "does a deploy of this exact repo actually get this column."
 * It surfaced in production as:
 *   [ERROR] Failed to save observation submission ... "error":
 *   "table observation_assessments has no column named
 *   corrects_assessment_id"
 *
 * This file has two jobs:
 *   1. Prove Migration 028 is actually wired into the real
 *      runMigrations() (same function server.js calls at startup) and
 *      is idempotent.
 *   2. Guard against the exact failure mode recurring: any .sql file
 *      sitting in the repo outside utils/database.js's migration
 *      runner is a silent no-op in production. If one shows up again,
 *      this test fails loudly instead of shipping quietly.
 *
 * Run individually:   node tests/migration-028-observation-corrections.test.js
 * Run via npm:         npm test
 */

const path = require('path');
const fs = require('fs');

// ── Shim better-sqlite3 → node:sqlite (same convention as
//    tests/adr003-learners-migration.test.js) ──────────────────────────────
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

const TEST_DB_PATH = path.join(__dirname, '..', 'migration-028-test.db');
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
  // SECTION 1: Migration 028 is actually wired into the real runMigrations()
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\nSection 1: Migration 028 applies via the real runMigrations()');

  runMigrations();
  const db = getDb();

  function columnNames(table) {
    return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  }

  const assessmentCols = columnNames('observation_assessments');
  assert(assessmentCols.includes('corrects_assessment_id'), 'observation_assessments gains corrects_assessment_id — the exact column production was missing');

  const recordCols = columnNames('observation_records');
  assert(recordCols.includes('resolved'), 'observation_records gains resolved');

  const indexNames = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`)
    .all()
    .map(r => r.name);
  assert(indexNames.includes('idx_observation_assessments_corrects'), 'supporting index on corrects_assessment_id is created');

  console.log('\nSection 2: the real save/query path actually works against the migrated schema');
  // Not a repository-boundary mock — inserts through raw SQL against the
  // exact schema runMigrations() just produced, proving the columns are
  // usable, not merely present.
  db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run('migration028_smoke');
  const insertResult = db.prepare(`
    INSERT INTO observation_assessments (phone_hash, grade, subject, corrects_assessment_id)
    VALUES (?, ?, ?, NULL)
  `).run('migration028_smoke', 'R', 'Life Skills');
  assert(insertResult.lastInsertRowid > 0, 'a row referencing corrects_assessment_id inserts without error against the real migrated table');

  const recordInsert = db.prepare(`
    INSERT INTO observation_records (assessment_id, learner_name, domain, developmental_status, resolved)
    VALUES (?, ?, ?, ?, 0)
  `).run(insertResult.lastInsertRowid, 'Test Learner', 'Oral Language', 'Achieved');
  assert(recordInsert.lastInsertRowid > 0, 'a row referencing resolved inserts without error against the real migrated table');

  console.log('\nSection 3: Migration 028 is idempotent — a second runMigrations() call does not throw');
  let secondRunErr = null;
  try {
    runMigrations();
  } catch (err) {
    secondRunErr = err;
  }
  assert(secondRunErr === null, `re-running runMigrations() against an already-migrated db does not throw${secondRunErr ? ': ' + secondRunErr.message : ''}`);
  assert(columnNames('observation_assessments').includes('corrects_assessment_id'), 'column still present after the second run');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 4: Repo-wide guard against the exact bug class
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\nSection 4: no stray .sql migration files sit outside the real migration runner');
  // This codebase's actual convention is 100% in-code migrations inside
  // utils/database.js's `alterations` array (see its own comments — e.g.
  // "Migration 001", "Migration 028", etc.). A loose .sql file at the repo
  // root LOOKS like a migration, gets reviewed and merged like one, but is
  // never executed by anything in the startup path. This is precisely
  // what happened here. If a .sql file reappears anywhere in the repo
  // (outside node_modules/.git), that's the same bug recurring.
  const repoRoot = path.join(__dirname, '..');
  const skipDirs = new Set(['node_modules', '.git', 'data']);

  function findSqlFiles(dir) {
    let found = [];
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return found;
    }
    for (const entry of entries) {
      if (skipDirs.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        found = found.concat(findSqlFiles(full));
      } else if (entry.isFile() && entry.name.endsWith('.sql')) {
        found.push(full);
      }
    }
    return found;
  }

  const sqlFiles = findSqlFiles(repoRoot);
  assert(
    sqlFiles.length === 0,
    sqlFiles.length === 0
      ? 'no stray .sql files found in the repo'
      : `found ${sqlFiles.length} loose .sql file(s) that runMigrations() will never execute: ${sqlFiles.map(f => path.relative(repoRoot, f)).join(', ')} — move their ALTER/CREATE statements into utils/database.js's runMigrations()`
  );

  // ── Cleanup ──────────────────────────────────────────────────────────────
  try { fs.unlinkSync(TEST_DB_PATH); } catch (_) { /* best-effort */ }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`Migration 028 Regression Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
