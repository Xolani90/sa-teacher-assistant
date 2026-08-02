'use strict';
/**
 * Shared test-database helper (technical debt cleanup, see
 * docs/TSE_SCHOOL_CALENDAR_TEST_GAP.md for the investigation that
 * motivated this).
 *
 * Root cause being fixed: a large number of test files hand-rolled a
 * partial CREATE TABLE schema instead of running the real migration
 * chain. When the TSE Evidence Engine (Migrations 033/034) landed,
 * those hand-rolled schemas were never updated, so every call to
 * tagEvidence() in those tests silently failed with
 * "no such table: school_calendar" — caught and swallowed by
 * tagEvidence()'s non-fatal error handling, so the tests kept passing
 * without ever actually exercising evidence tagging.
 *
 * This helper replaces hand-rolled schemas with the REAL runMigrations()
 * from utils/database.js (the same function server.js calls at startup),
 * run against a throwaway file-backed SQLite database. A handful of
 * newer test files (tests/adr003-learners-migration.test.js,
 * tests/phase-6-observation-repository.test.js, etc.) already used this
 * pattern independently; this helper is that pattern extracted so every
 * test file shares one source of truth instead of copy-pasting the shim.
 *
 * Because this is the REAL migration chain, any table/column/index
 * added in a future migration automatically appears in every test that
 * uses this helper — schema drift between tests and production becomes
 * structurally impossible instead of something to remember.
 *
 * ── Usage ────────────────────────────────────────────────────────────
 *
 *   // MUST be the very first require in the test file, before any
 *   // service/repository module is required — see "Why this must be
 *   // required first" below.
 *   const { createTestDb } = require('./helpers/createTestDb');
 *   const db = createTestDb(__filename);
 *
 *   const { getDb } = require('../utils/database');
 *   // ... require your services/repositories as normal from here ...
 *
 *   // at the end of the file:
 *   db.cleanup();
 *
 * ── Why this must be required first ─────────────────────────────────
 * This helper monkeypatches Node's module resolver so that any
 * `require('better-sqlite3')` anywhere in the process (including
 * transitively, inside utils/database.js or any service file) resolves
 * to a thin shim over node:sqlite's DatabaseSync instead of the native
 * better-sqlite3 addon. That's necessary because this sandbox/CI
 * environment cannot compile the native addon. The patch is installed
 * as a side effect of requiring this file, so it must happen before
 * anything else pulls in better-sqlite3 (directly or indirectly).
 *
 * Each test file in this project runs in its own subprocess (see
 * tests/run-all.js's use of spawnSync), so this global monkeypatch is
 * process-isolated per test file and safe to install unconditionally.
 */

const path = require('path');
const fs = require('fs');
const Module = require('module');
const { DatabaseSync } = require('node:sqlite');

let _installed = false;
let _db = null;

function installShim() {
  if (_installed) return;
  _installed = true;

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
      // node:sqlite's DatabaseSync doesn't have .pragma() — utils/database.js
      // calls it for WAL/synchronous/foreign_keys settings that have no
      // effect on an in-memory/throwaway test database anyway.
      if (!_db.pragma) _db.pragma = () => {};
      return _db;
    },
  };
}

/**
 * Creates a fresh, fully-migrated, file-backed SQLite test database by
 * running the REAL runMigrations() from utils/database.js.
 *
 * @param {string} testFilename - pass `__filename` from the calling test
 *   file. Used to derive a unique, collision-free temp DB path (e.g.
 *   `tests/.tmp-db/workspace.test.js.db`) so parallel/repeated test runs
 *   never clash on the same file.
 * @param {object} [options]
 * @param {boolean} [options.verbose=false] - if false (default), suppresses
 *   the "[DB] Connected..." / "[DB] Migrations complete" console noise
 *   that runMigrations()/getDb() normally print, keeping test output
 *   readable. Set true to debug migration issues.
 * @returns {{
 *   db: import('node:sqlite').DatabaseSync,
 *   getDb: () => import('node:sqlite').DatabaseSync,
 *   runMigrations: () => void,
 *   cleanup: () => void,
 * }}
 */
function createTestDb(testFilename, options = {}) {
  const { verbose = false } = options;

  installShim();

  const tmpDir = path.join(__dirname, '..', '.tmp-db');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const baseName = testFilename ? path.basename(testFilename) : `test-${Date.now()}`;
  const dbPath = path.join(tmpDir, `${baseName}-${process.pid}.db`);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  process.env.DB_PATH = dbPath;
  _db = new DatabaseSync(dbPath);

  let restoreConsole = null;
  if (!verbose) {
    const origLog = console.log;
    const origWarn = console.warn;
    console.log = (...args) => {
      const msg = String(args[0] || '');
      if (msg.startsWith('[DB]')) return;
      origLog(...args);
    };
    console.warn = (...args) => {
      const msg = String(args[0] || '');
      if (msg.startsWith('[DB]')) return;
      origWarn(...args);
    };
    restoreConsole = () => {
      console.log = origLog;
      console.warn = origWarn;
    };
  }

  // Requiring utils/database.js AFTER installing the shim means its
  // internal `require('better-sqlite3')` resolves to our node:sqlite
  // shim above. This is the REAL runMigrations() — same function
  // server.js calls at startup — not a hand-copied schema.
  const { getDb, runMigrations } = require('../../utils/database');
  runMigrations();
  const db = getDb();

  if (restoreConsole) restoreConsole();

  return {
    db,
    getDb,
    runMigrations,
    cleanup() {
      try {
        db.close();
      } catch {
        // already closed — fine
      }
      try {
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      } catch {
        // best-effort cleanup; leftover .tmp-db files are harmless and
        // gitignored, not worth failing a test run over
      }
    },
  };
}

module.exports = { createTestDb };
