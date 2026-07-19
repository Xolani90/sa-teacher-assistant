'use strict';
/**
 * Phase 6 — Observation Repository Hardening Tests
 *
 * Covers:
 *   1. saveObservationSubmission() input guards
 *   2. Transaction atomicity (failed record insert rolls back the header row)
 *   3. Round-trip retrieval via getObservationAssessment()
 *   4. Grade R ('0') survives storage/retrieval without falsy-drop
 *   5. Record ordering (id ASC)
 *
 * Run individually:   node tests/phase-6-observation-repository.test.js
 * Run via npm:        npm test
 */

// ── Shim better-sqlite3 → node:sqlite ────────────────────────────────────────
const Module = require('module');
const { DatabaseSync } = require('node:sqlite');

let _db = null;

const path = require('path');
const dbPath = path.resolve(__dirname, '../utils/database');

// FIX (test-harness bug, not production code): the previous version of this
// override only special-cased the 'better-sqlite3' request string and relied
// on require.cache[dbPath] alone for '../utils/database'. But Node's real
// resolver returns the fully-resolved filename WITH extension
// (".../utils/database.js"), while dbPath (built via path.resolve, no
// extension) never matched that cache key -- so the mock was silently never
// hit; observationRepository.js was loading the real utils/database.js the
// whole time instead of this test's in-memory _db. Redirecting the request
// string itself (matching the working pattern already used in
// tests/phase-c2-diagnostic-atomicity.test.js) closes that gap.
const _origResolve = Module._resolveFilename.bind(Module);
Module._resolveFilename = function (request, parent, isMain, opts) {
  if (request === 'better-sqlite3') return request;
  if (request === '../utils/database' || request === './database') return dbPath;
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

// ── Helpers ───────────────────────────────────────────────────────────────────
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

function assertThrows(fn, expectedMsg, label) {
  try {
    fn();
    console.error(`  ❌ FAIL: ${label} — expected throw, got no error`);
    failed++;
  } catch (err) {
    if (expectedMsg && !err.message.includes(expectedMsg)) {
      console.error(`  ❌ FAIL: ${label}`);
      console.error(`     expected message to include: "${expectedMsg}"`);
      console.error(`     got: "${err.message}"`);
      failed++;
    } else {
      console.log(`  ✅ ${label}`);
      passed++;
    }
  }
}

// ── Schema (mirrors Migration 022 + Migration 027's class_id addition) ─────
function buildSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash TEXT UNIQUE NOT NULL
    );

    -- Added for ADR-003 PR 3: saveObservationSubmission() now calls
    -- resolveLearner() before every record insert, same as
    -- storeLearnerResults(). classes/learners shape mirrors
    -- tests/learnerIdentityService.test.js -- not re-derived independently,
    -- deliberately kept identical across both integration suites so they
    -- don't silently diverge from each other. Same caveat as the C2 patch:
    -- inferred from test-file usage, not yet checked against the real
    -- migration source in utils/database.js.
    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY,
      phone_hash TEXT NOT NULL,
      name TEXT,
      grade INTEGER,
      subject TEXT,
      FOREIGN KEY (phone_hash) REFERENCES teachers(phone_hash)
    );
    CREATE TABLE IF NOT EXISTS learners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash TEXT NOT NULL,
      class_id INTEGER,
      canonical_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (phone_hash) REFERENCES teachers(phone_hash),
      FOREIGN KEY (class_id) REFERENCES classes(id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_learners_identity_classed
      ON learners(phone_hash, class_id, normalized_name) WHERE class_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_learners_identity_unclassed
      ON learners(phone_hash, normalized_name) WHERE class_id IS NULL;

    CREATE TABLE IF NOT EXISTS observation_assessments (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash        TEXT    NOT NULL,
      grade             TEXT,
      subject           TEXT,
      assessment_name   TEXT,
      class_id          INTEGER,
      created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (phone_hash) REFERENCES teachers(phone_hash),
      FOREIGN KEY (class_id) REFERENCES classes(id)
    );

    CREATE TABLE IF NOT EXISTS observation_records (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      assessment_id         INTEGER NOT NULL,
      learner_name          TEXT    NOT NULL,
      domain                TEXT    NOT NULL,
      developmental_status  TEXT    NOT NULL,
      notes                 TEXT,
      learner_id            INTEGER,
      created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (assessment_id) REFERENCES observation_assessments(id)
    );

    CREATE INDEX IF NOT EXISTS idx_observation_assessments_phone
      ON observation_assessments(phone_hash);
    CREATE INDEX IF NOT EXISTS idx_observation_records_assessment
      ON observation_records(assessment_id);
  `);
}

// ── Test runner ───────────────────────────────────────────────────────────────
async function run() {
  _db = new DatabaseSync(':memory:');
  buildSchema(_db);

  const { saveObservationSubmission, getObservationAssessment } =
    require('../services/observationRepository');

  const PHONE = 'obs_test_hash_001';
  _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(PHONE);

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1: saveObservationSubmission() input guards
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('\n── Section 1: saveObservationSubmission() input guards ─────────────');

  console.log('\nTest P6-01: null phoneHash → throws with clear message');
  assertThrows(
    () => saveObservationSubmission(null, { grade: '0' }, [
      { learnerName: 'Thabo', domain: 'Counting', developmentalStatus: 'Developing' },
    ]),
    'phoneHash must not be null or empty',
    'null phoneHash throws'
  );

  console.log('\nTest P6-02: empty string phoneHash → throws');
  assertThrows(
    () => saveObservationSubmission('', { grade: '0' }, [
      { learnerName: 'Thabo', domain: 'Counting', developmentalStatus: 'Developing' },
    ]),
    'phoneHash must not be null or empty',
    'empty string phoneHash throws'
  );

  console.log('\nTest P6-03: null records → throws');
  assertThrows(
    () => saveObservationSubmission(PHONE, { grade: '0' }, null),
    'records must be a non-empty array',
    'null records throws'
  );

  console.log('\nTest P6-04: empty records array → throws');
  assertThrows(
    () => saveObservationSubmission(PHONE, { grade: '0' }, []),
    'records must be a non-empty array',
    'empty records array throws'
  );

  console.log('\nTest P6-05: non-array records (object) → throws');
  assertThrows(
    () => saveObservationSubmission(PHONE, { grade: '0' }, { not: 'an array' }),
    'records must be a non-empty array',
    'non-array records throws'
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2: Round-trip retrieval, including Grade R ('0') safety
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('\n── Section 2: Round-trip retrieval ──────────────────────────────────');

  console.log('\nTest P6-06: full submission round-trips with correct shape');
  const header = { grade: '0', subject: 'Numeracy', assessment: 'Term 2 Observation' };
  const records = [
    { learnerName: 'Thabo', domain: 'Counting', developmentalStatus: 'Developing', notes: 'Counts to 10 confidently.' },
    { learnerName: 'Lindiwe', domain: 'Counting', developmentalStatus: 'Achieved', notes: null },
  ];
  const { assessmentId, recordCount } = saveObservationSubmission(PHONE, header, records);
  assertEq(recordCount, 2, 'recordCount reflects number of records saved');
  assert(typeof assessmentId === 'number', 'assessmentId is a number');

  const result = getObservationAssessment(assessmentId);
  assertEq(result.phoneHash, PHONE, 'phoneHash matches on retrieval');
  assertEq(result.grade, '0', "Grade R ('0') survives round-trip, not dropped/nulled by falsy checks");
  assertEq(result.subject, 'Numeracy', 'subject matches on retrieval');
  assertEq(result.assessmentName, 'Term 2 Observation', 'assessmentName matches on retrieval');
  assertEq(result.records.length, 2, 'both records retrieved');
  assertEq(result.records[0], {
    learnerName: 'Thabo',
    domain: 'Counting',
    developmentalStatus: 'Developing',
    notes: 'Counts to 10 confidently.',
  }, 'first record matches exactly');
  assertEq(result.records[1], {
    learnerName: 'Lindiwe',
    domain: 'Counting',
    developmentalStatus: 'Achieved',
    notes: null,
  }, 'second record matches exactly, null notes preserved');

  console.log('\nTest P6-07: missing/undefined header fields stored as null, not dropped');
  const { assessmentId: minimalId } = saveObservationSubmission(PHONE, {}, [
    { learnerName: 'Sipho', domain: 'Fine Motor', developmentalStatus: 'Emerging', notes: null },
  ]);
  const minimalResult = getObservationAssessment(minimalId);
  assert(minimalResult.grade === null, 'grade is null when not provided');
  assert(minimalResult.subject === null, 'subject is null when not provided');
  assert(minimalResult.assessmentName === null, 'assessmentName is null when not provided');

  console.log('\nTest P6-08: getObservationAssessment returns null for non-existent id');
  const missing = getObservationAssessment(999999);
  assert(missing === null, 'non-existent assessment id returns null');

  console.log('\nTest P6-09: record ordering is deterministic (id ASC)');
  const { assessmentId: orderId } = saveObservationSubmission(PHONE, { grade: '2' }, [
    { learnerName: 'A', domain: 'X', developmentalStatus: 'Achieved', notes: null },
    { learnerName: 'B', domain: 'X', developmentalStatus: 'Achieved', notes: null },
    { learnerName: 'C', domain: 'X', developmentalStatus: 'Achieved', notes: null },
  ]);
  const orderResult = getObservationAssessment(orderId);
  assertEq(
    orderResult.records.map(r => r.learnerName),
    ['A', 'B', 'C'],
    'records retrieved in insertion (id ASC) order'
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3: Transaction atomicity
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('\n── Section 3: Transaction atomicity ─────────────────────────────────');

  console.log('\nTest P6-10: failed record insert rolls back the assessment header row');
  const ROLLBACK_PHONE = 'obs_rollback_hash';
  _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(ROLLBACK_PHONE);

  // Second record is missing required NOT NULL fields (domain, developmentalStatus),
  // which should fail partway through the loop, after the header row and the
  // first record have already been inserted in-transaction.
  const badRecords = [
    { learnerName: 'Valid Learner', domain: 'Reading', developmentalStatus: 'Achieved', notes: null },
    { learnerName: 'Broken Learner', domain: null, developmentalStatus: null, notes: null },
  ];

  assertThrows(
    () => saveObservationSubmission(ROLLBACK_PHONE, { grade: '1', subject: 'Literacy' }, badRecords),
    null,
    'submission with an invalid record throws'
  );

  const leftoverAssessments = _db
    .prepare('SELECT * FROM observation_assessments WHERE phone_hash = ?')
    .all(ROLLBACK_PHONE);
  const leftoverRecords = _db
    .prepare(`
      SELECT r.* FROM observation_records r
      JOIN observation_assessments a ON a.id = r.assessment_id
      WHERE a.phone_hash = ?
    `)
    .all(ROLLBACK_PHONE);

  assertEq(leftoverAssessments.length, 0, 'assessment header does not survive a failed transaction');
  assertEq(leftoverRecords.length, 0, 'no orphaned records survive a failed transaction');

  console.log('\nTest P6-11: after a rollback, a valid retry succeeds cleanly');
  const retrySave = saveObservationSubmission(ROLLBACK_PHONE, { grade: '1', subject: 'Literacy' }, [
    { learnerName: 'Valid Learner', domain: 'Reading', developmentalStatus: 'Achieved', notes: null },
  ]);
  assert(retrySave.assessmentId > 0, 'retry after rollback returns a valid assessmentId');
  assertEq(retrySave.recordCount, 1, 'retry saves the expected record count');

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`Phase 6 Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
