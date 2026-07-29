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

const Module = require('module');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

let _db = null;
const dbPath = path.resolve(__dirname, '../utils/database');

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

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE teachers (phone_hash TEXT PRIMARY KEY);

    CREATE TABLE assessments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash TEXT NOT NULL,
      title TEXT NOT NULL,
      grade INTEGER NOT NULL,
      subject TEXT NOT NULL,
      term INTEGER NOT NULL,
      assessment_type TEXT,
      total_marks INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE curriculum_coverage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash TEXT NOT NULL,
      grade INTEGER NOT NULL,
      subject TEXT NOT NULL,
      term INTEGER NOT NULL,
      topic TEXT NOT NULL,
      covered INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE intervention_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash TEXT NOT NULL,
      assessment_id INTEGER,
      problem_area TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE observation_assessments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // better-sqlite3-compatible wrapper over node:sqlite's DatabaseSync API
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        all: (...params) => stmt.all(...params),
        get: (...params) => stmt.get(...params),
        run: (...params) => stmt.run(...params),
      };
    },
    exec: (sql) => db.exec(sql),
  };
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
  const { getGrowthInsights } = require('../services/tseGrowthInsightService');
  const TERM = 3;

  console.log('\n\u2500\u2500 Scenario 1: complete evidence \u2500\u2500');
  _db = freshDb();
  _db.prepare(`INSERT INTO teachers (phone_hash) VALUES (?)`).run('t1');
  _db.prepare(
    `INSERT INTO curriculum_coverage (phone_hash, grade, subject, term, topic, covered) VALUES (?,?,?,?,?,1)`
  ).run('t1', 7, 'mathematics', TERM, 'Fractions');
  const aId = _db
    .prepare(
      `INSERT INTO assessments (phone_hash, title, grade, subject, term) VALUES (?,?,?,?,?)`
    )
    .run('t1', 'Fractions Test', 7, 'mathematics', TERM).lastInsertRowid;
  _db.prepare(`INSERT INTO intervention_plans (phone_hash, assessment_id) VALUES (?,?)`).run(
    't1',
    aId
  );
  let result = getGrowthInsights('t1', { term: TERM });
  assert(result.gaps.length === 0, 'no gaps when coverage -> assessment -> intervention all link up');
  assert(typeof result.strength === 'string', 'strength message present when no gaps');

  console.log('\n\u2500\u2500 Scenario 2: missing intervention evidence \u2500\u2500');
  _db = freshDb();
  _db.prepare(`INSERT INTO teachers (phone_hash) VALUES (?)`).run('t2');
  _db.prepare(
    `INSERT INTO assessments (phone_hash, title, grade, subject, term) VALUES (?,?,?,?,?)`
  ).run('t2', 'Algebra Test', 8, 'mathematics', TERM);
  result = getGrowthInsights('t2', { term: TERM });
  assert(
    result.gaps.some((g) => g.type === 'assessment_without_intervention'),
    'flags an assessment with no linked intervention plan'
  );
  assert(result.strength === null, 'no strength message when gaps exist');
  assert(result.suggestedAction !== null, 'suggestedAction populated when gaps exist');

  console.log('\n\u2500\u2500 Scenario 3: coverage marked, no assessment ever recorded \u2500\u2500');
  _db = freshDb();
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
  _db = freshDb();
  _db.prepare(`INSERT INTO teachers (phone_hash) VALUES (?)`).run('t4');
  _db.prepare(`INSERT INTO observation_assessments (phone_hash) VALUES (?)`).run('t4');
  result = getGrowthInsights('t4', { term: TERM });
  assert(
    result.gaps.some((g) => g.type === 'observation_without_followup'),
    'flags observations with no intervention plans at all'
  );

  console.log('\n\u2500\u2500 Scenario 5: empty profile \u2500\u2500');
  _db = freshDb();
  _db.prepare(`INSERT INTO teachers (phone_hash) VALUES (?)`).run('t5');
  result = getGrowthInsights('t5', { term: TERM });
  assert(result.gaps.length === 0, 'a teacher with zero evidence has zero gaps (nothing to compare)');
  assert(result.strength !== null, 'empty profile still resolves to the positive/no-gaps branch');

  console.log('\n\u2500\u2500 Scenario 6: input guard \u2500\u2500');
  _db = freshDb();
  let threw = false;
  try {
    getGrowthInsights(null);
  } catch (e) {
    threw = true;
  }
  assert(threw, 'missing phoneHash throws');

  console.log('\n\u2500\u2500 Scenario 7: DB failure is non-fatal per rule, does not crash the call \u2500\u2500');
  _db = freshDb();
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
  if (failed > 0) process.exit(1);
}

run();
