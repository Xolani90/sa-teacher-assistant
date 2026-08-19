'use strict';
/**
 * Infrastructure Row — "DB migrations verified (apply cleanly on fresh
 * DB, idempotent on re-run)"
 *
 * This test establishes real, reproducible evidence for that milestone
 * line rather than inferring idempotency from source inspection alone.
 * It runs the REAL runMigrations() from utils/database.js (the same
 * function server.js calls at startup) against a genuinely fresh,
 * throwaway file-backed SQLite database, twice, and diffs the schema
 * and migration/version bookkeeping state in between.
 *
 * ── Compatibility layer vs. code under test ──────────────────────────
 * This sandbox cannot compile the native better-sqlite3 addon, so
 * (following the exact convention already established in
 * tests/helpers/createTestDb.js and tests/adr003-learners-migration.test.js)
 * this file monkeypatches `require('better-sqlite3')` to resolve to a
 * thin shim over Node's built-in `node:sqlite` DatabaseSync. That shim
 * is a TEST-ENVIRONMENT COMPATIBILITY LAYER ONLY — it substitutes the
 * underlying SQLite binding, not the migration logic. The actual code
 * under test is the unmodified, real runMigrations()/getDb() from
 * utils/database.js, required fresh in this subprocess exactly as
 * server.js would.
 *
 * ── Migration/version bookkeeping — investigated, not assumed ────────
 * Repo-wide search (utils/database.js and every other .js file, plus
 * PRAGMA usage) found NO migration/version bookkeeping mechanism of any
 * kind: no schema_version / migrations_run / schema_migrations table,
 * and no use of SQLite's built-in `PRAGMA user_version`. runMigrations()
 * is unconditional DDL that runs in full on every process startup and
 * relies entirely on `CREATE TABLE/INDEX IF NOT EXISTS` and
 * try/catch-around-ALTER-TABLE for its idempotency — there is no
 * version marker that gates which migrations execute.
 *
 * Given that, "migration/version state" for this codebase is captured
 * as: (a) PRAGMA user_version (expected to be the SQLite default of 0,
 * unchanged, since the app never sets it), and (b) the full
 * sqlite_master DDL + PRAGMA table_info() column snapshot, which IS
 * this project's only actual record of "what has been migrated" — the
 * schema itself is the bookkeeping. This is documented here explicitly
 * per instruction, rather than assuming a mechanism that doesn't exist.
 *
 * Run individually:  node tests/row-infra-migration-idempotency.test.js
 * Run via npm:        npm test
 */

const path = require('path');
const fs = require('fs');
const Module = require('module');
const { DatabaseSync } = require('node:sqlite');

// ── Shim better-sqlite3 → node:sqlite (test-environment compatibility
// layer only; see file header) ───────────────────────────────────────
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
    if (!_db.pragma) {
      _db.pragma = (stmt) => {
        // Support the one PRAGMA call this test actually needs to read
        // back (user_version), while remaining a no-op for the
        // WAL/synchronous/foreign_keys pragmas utils/database.js sets,
        // which have no effect on a throwaway test database anyway.
        if (typeof stmt === 'string' && stmt.trim().toLowerCase() === 'user_version') {
          const row = _db.prepare('PRAGMA user_version').get();
          return row ? row.user_version : 0;
        }
        return undefined;
      };
    }
    if (!_db.transaction) {
      _db.transaction = (fn) => {
        return (...args) => {
          _db.exec('BEGIN');
          try {
            const result = fn(...args);
            _db.exec('COMMIT');
            return result;
          } catch (err) {
            try { _db.exec('ROLLBACK'); } catch { /* already rolled back */ }
            throw err;
          }
        };
      };
    }
    return _db;
  },
};

// ── Test harness ──────────────────────────────────────────────────────
const results = {
  freshMigration: null,
  secondRun: null,
  schemaUnchanged: null,
  versionStateOk: null,
  noDuplicates: null,
};
let failureDetail = null;
let dbPath = null;

function snapshotSchema(db) {
  const objects = db
    .prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name`)
    .all();

  const tables = objects.filter((o) => o.type === 'table' && !o.name.startsWith('sqlite_'));
  const indexes = objects.filter((o) => o.type === 'index' && !o.name.startsWith('sqlite_'));

  const columnsByTable = {};
  for (const t of tables) {
    columnsByTable[t.name] = db.prepare(`PRAGMA table_info(${t.name})`).all()
      .map((c) => `${c.name}:${c.type}:${c.notnull}:${c.dflt_value}:${c.pk}`);
  }

  return { objects, tables, indexes, columnsByTable };
}

function snapshotVersionState(db) {
  const row = db.prepare('PRAGMA user_version').get();
  return { userVersion: row ? row.user_version : 0 };
}

function diffSnapshots(before, after) {
  const diffs = [];

  if (before.tables.length !== after.tables.length) {
    diffs.push(`table count changed: ${before.tables.length} -> ${after.tables.length}`);
  }
  if (before.indexes.length !== after.indexes.length) {
    diffs.push(`index count changed: ${before.indexes.length} -> ${after.indexes.length}`);
  }

  const beforeNames = new Set(before.objects.map((o) => `${o.type}:${o.name}`));
  const afterNames = new Set(after.objects.map((o) => `${o.type}:${o.name}`));
  for (const name of afterNames) {
    if (!beforeNames.has(name)) diffs.push(`new schema object after second run: ${name}`);
  }
  for (const name of beforeNames) {
    if (!afterNames.has(name)) diffs.push(`schema object disappeared after second run: ${name}`);
  }

  // DDL text diff for objects present in both
  const beforeByKey = Object.fromEntries(before.objects.map((o) => [`${o.type}:${o.name}`, o.sql]));
  const afterByKey = Object.fromEntries(after.objects.map((o) => [`${o.type}:${o.name}`, o.sql]));
  for (const key of Object.keys(beforeByKey)) {
    if (afterByKey[key] !== undefined && beforeByKey[key] !== afterByKey[key]) {
      diffs.push(`DDL changed for ${key}`);
    }
  }

  // Column-level diff
  for (const table of Object.keys(before.columnsByTable)) {
    const b = before.columnsByTable[table] || [];
    const a = after.columnsByTable[table] || [];
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      diffs.push(`column set changed for table ${table}: [${b.join(', ')}] -> [${a.join(', ')}]`);
    }
  }

  return diffs;
}

function findDuplicates(snapshot) {
  const seen = new Map();
  const dupes = [];
  for (const o of snapshot.objects) {
    const key = `${o.type}:${o.name}`;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  for (const [key, count] of seen.entries()) {
    if (count > 1) dupes.push(`${key} appears ${count} times`);
  }
  return dupes;
}

function run() {
  const tmpDir = path.join(__dirname, '.tmp-db');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  dbPath = path.join(tmpDir, `row-infra-migration-idempotency-${process.pid}-${Date.now()}.db`);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  process.env.DB_PATH = dbPath;
  _db = new DatabaseSync(dbPath);

  // Requiring utils/database.js AFTER the shim is installed and
  // DB_PATH is set means its internal require('better-sqlite3')
  // resolves to the shim above, and its module-level DB_PATH const
  // picks up our temp path. This is the REAL runMigrations()/getDb().
  const { getDb, runMigrations } = require('../utils/database');

  // ── Step 1: fresh database migration ────────────────────────────
  let beforeSnapshot = null;
  let beforeVersion = null;
  try {
    runMigrations();
    const db = getDb();
    beforeSnapshot = snapshotSchema(db);
    beforeVersion = snapshotVersionState(db);
    results.freshMigration = 'PASS';
  } catch (err) {
    results.freshMigration = 'FAIL';
    failureDetail = `Fresh migration run threw: ${err && err.stack ? err.stack : err}`;
    return;
  }

  // ── Step 2: second migration run (same open connection/singleton) ─
  let afterSnapshot = null;
  let afterVersion = null;
  try {
    runMigrations();
    const db = getDb();
    afterSnapshot = snapshotSchema(db);
    afterVersion = snapshotVersionState(db);
    results.secondRun = 'PASS';
  } catch (err) {
    results.secondRun = 'FAIL';
    failureDetail = `Second migration run threw: ${err && err.stack ? err.stack : err}`;
    return;
  }

  // ── Step 3: schema diff ─────────────────────────────────────────
  const diffs = diffSnapshots(beforeSnapshot, afterSnapshot);
  if (diffs.length === 0) {
    results.schemaUnchanged = 'PASS';
  } else {
    results.schemaUnchanged = 'FAIL';
    failureDetail = `Schema drift detected after second run:\n  - ${diffs.join('\n  - ')}`;
  }

  // ── Step 4: migration/version state ─────────────────────────────
  // No bookkeeping table exists in this codebase (confirmed by repo
  // search — see file header). The only meaningful "version state" is
  // PRAGMA user_version, which the app never sets, so it is expected
  // to remain 0 before and after. This IS the correct/expected
  // behavior for this codebase's actual mechanism, not a gap.
  if (beforeVersion.userVersion === afterVersion.userVersion) {
    results.versionStateOk = 'PASS';
  } else {
    results.versionStateOk = 'FAIL';
    failureDetail = `PRAGMA user_version changed: ${beforeVersion.userVersion} -> ${afterVersion.userVersion}`;
  }

  // ── Step 5: duplicate schema objects ────────────────────────────
  const dupesBefore = findDuplicates(beforeSnapshot);
  const dupesAfter = findDuplicates(afterSnapshot);
  if (dupesBefore.length === 0 && dupesAfter.length === 0) {
    results.noDuplicates = 'PASS';
  } else {
    results.noDuplicates = 'FAIL';
    failureDetail = `Duplicate schema objects found — before: [${dupesBefore.join(', ')}], after: [${dupesAfter.join(', ')}]`;
  }

  // ── Report ───────────────────────────────────────────────────────
  console.log('');
  console.log('=== Migration Idempotency Evidence ===');
  console.log(`fresh database migration:            ${results.freshMigration}`);
  console.log(`second migration run:                ${results.secondRun}`);
  console.log(`schema unchanged after second run:    ${results.schemaUnchanged}`);
  console.log(`migration/version state correct:      ${results.versionStateOk}`);
  console.log(`no duplicate schema objects:          ${results.noDuplicates}`);
  console.log('');
  console.log(`Tables before second run: ${beforeSnapshot.tables.length}   Tables after: ${afterSnapshot.tables.length}`);
  console.log(`Indexes before second run: ${beforeSnapshot.indexes.length}   Indexes after: ${afterSnapshot.indexes.length}`);
  console.log(`PRAGMA user_version before: ${beforeVersion.userVersion}   after: ${afterVersion.userVersion}`);
  console.log('');
  console.log('Note: no migration/version bookkeeping table exists in this codebase.');
  console.log('runMigrations() relies entirely on CREATE...IF NOT EXISTS and');
  console.log('try/catch-around-ALTER-TABLE for idempotency; the schema itself is');
  console.log('the only record of "what has been migrated." PRAGMA user_version is');
  console.log('unused by the application and is checked here only to confirm no');
  console.log('accidental mutation of that SQLite-native version slot.');
  console.log('');
  if (failureDetail) {
    console.log('FAILURE DETAIL:');
    console.log(failureDetail);
  }
}

try {
  run();
} finally {
  try {
    if (_db) _db.close();
  } catch {
    // already closed — fine
  }
  try {
    if (dbPath && fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    if (dbPath && fs.existsSync(dbPath + '-shm')) fs.unlinkSync(dbPath + '-shm');
    if (dbPath && fs.existsSync(dbPath + '-wal')) fs.unlinkSync(dbPath + '-wal');
  } catch {
    // best-effort cleanup
  }
}

const allPassed = Object.values(results).every((v) => v === 'PASS');
if (!allPassed) {
  console.error('\nMigration idempotency test FAILED — see FAILURE DETAIL above.');
  process.exitCode = 1;
} else {
  console.log('All migration idempotency checks PASSED.');
}
