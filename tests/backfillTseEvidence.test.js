'use strict';
/**
 * Backfill script tests (scripts/backfillTseEvidence.js).
 *
 * Covers:
 *   1. Backfilling pre-existing rows tags them correctly
 *   2. Re-running the backfill is idempotent (no duplicate rows)
 *   3. --dry-run mode makes no writes but reports what it would do
 *   4. Rows with a NULL phone_hash are skipped, not errored on
 *
 * Run individually:   node tests/backfillTseEvidence.test.js
 * Run via npm:        npm test
 */

const Module = require('module');
const { DatabaseSync } = require('node:sqlite');

let _db = null;

const path = require('path');
const dbPath = path.resolve(__dirname, '../utils/database');

const _origResolve = Module._resolveFilename.bind(Module);
Module._resolveFilename = function (request, parent, isMain, opts) {
  if (request === 'better-sqlite3') return request;
  if (request === '../utils/database' || request === './database' || request === '../../utils/database') return dbPath;
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
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { getDb: () => _db },
};

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

function buildSchema(db) {
  db.exec(`
    CREATE TABLE saved_resources (id INTEGER PRIMARY KEY AUTOINCREMENT, phone_hash TEXT);
    CREATE TABLE assessments (id INTEGER PRIMARY KEY AUTOINCREMENT, phone_hash TEXT, term INTEGER);
    CREATE TABLE reports (id INTEGER PRIMARY KEY AUTOINCREMENT, phone_hash TEXT);
    CREATE TABLE intervention_plans (id INTEGER PRIMARY KEY AUTOINCREMENT, phone_hash TEXT);
    CREATE TABLE curriculum_coverage (id INTEGER PRIMARY KEY AUTOINCREMENT, phone_hash TEXT, term INTEGER);
    CREATE TABLE observation_assessments (id INTEGER PRIMARY KEY AUTOINCREMENT, phone_hash TEXT);
    CREATE TABLE school_calendar (
      id INTEGER PRIMARY KEY AUTOINCREMENT, year INTEGER, term INTEGER,
      start_date TEXT, end_date TEXT, UNIQUE(year, term)
    );
    CREATE TABLE tse_evidence_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash TEXT NOT NULL,
      category TEXT NOT NULL,
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      term INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source_table, source_id, category)
    );
  `);
}

async function run() {
  _db = new DatabaseSync(':memory:');
  buildSchema(_db);

  const PHONE = 'backfill_test_hash';

  // Seed pre-existing rows across all six source tables, plus one row
  // with a NULL phone_hash (edge case — should be skipped, not thrown on).
  _db.prepare(`INSERT INTO saved_resources (phone_hash) VALUES (?)`).run(PHONE);
  _db.prepare(`INSERT INTO assessments (phone_hash, term) VALUES (?, 3)`).run(PHONE);
  _db.prepare(`INSERT INTO reports (phone_hash) VALUES (?)`).run(PHONE);
  _db.prepare(`INSERT INTO intervention_plans (phone_hash) VALUES (?)`).run(PHONE);
  _db.prepare(`INSERT INTO curriculum_coverage (phone_hash, term) VALUES (?, 3)`).run(PHONE);
  _db.prepare(`INSERT INTO observation_assessments (phone_hash) VALUES (?)`).run(PHONE);
  _db.prepare(`INSERT INTO saved_resources (phone_hash) VALUES (NULL)`).run();

  const { run: runBackfill, backfillTable } = require('../scripts/backfillTseEvidence');

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
  // saved_resources has 2 rows (1 valid + 1 NULL phone_hash, skipped) → 1 tagged.
  assertEq(totalTagged, 6, 'exactly 6 evidence rows tagged (one per table, NULL-phone row skipped)');

  console.log('\nTest BF-03: NULL phone_hash row was skipped, not errored on');
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
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Test run crashed:', err);
  process.exit(1);
});
