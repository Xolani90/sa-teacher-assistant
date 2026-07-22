'use strict';
/**
 * Blueprint Analytics Tests (ADR-005 Section 8a, step 5 — Deterministic
 * analytics).
 *
 * Covers:
 *   1. Error paths: unknown assessment id, non-blueprint assessment,
 *      blueprint assessment with zero learner results.
 *   2. Topic aggregation: a topic spanning multiple question numbers
 *      sums maxMarks correctly across all of them.
 *   3. Class averages: mark/percentage averaged correctly across
 *      learners, and per-topic class averages.
 *   4. Strongest/weakest topic ranking.
 *   5. A learner missing one blueprint question still gets a topic
 *      percentage computed against the full (fixed) blueprint maxMarks,
 *      not a maxMarks reduced to only what they answered.
 *
 * Run individually: node tests/blueprint-analytics.test.js
 * Run via npm:       npm test
 */

const Module = require('module');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

let _db = null;

const dbPath = path.resolve(__dirname, '../utils/database');
const stubTargets = {
  [path.resolve(__dirname, '../services/itemAnalysisService.js')]: {
    performItemAnalysis: () => ({ questions: [], error: null }),
    saveItemAnalysis: () => {},
  },
  [path.resolve(__dirname, '../services/errorAnalysisService.js')]: {
    performErrorAnalysis: () => ({ errorPatterns: [], error: null }),
    saveErrorAnalysis: () => {},
  },
  [path.resolve(__dirname, '../services/learnerGroupingService.js')]: {
    groupLearners: () => ({ groups: {} }),
  },
  [path.resolve(__dirname, '../services/interventionPlanService.js')]: {
    generateInterventionPlan: () => ({ plan: [] }),
  },
  [path.resolve(__dirname, '../services/interventionReportsService.js')]: {
    generateInterventionReport: () => ({ report: 'stub' }),
    generateTeacherSummary: () => 'stub summary',
  },
  [path.resolve(__dirname, '../services/curriculumCoverageService.js')]: {
    updateCoverageFromAssessment: () => {},
  },
};

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

for (const [resolvedPath, exportsObj] of Object.entries(stubTargets)) {
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports: exportsObj,
  };
}

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

function assertClose(a, b, label, tolerance = 0.001) {
  const ok = Math.abs(a - b) <= tolerance;
  if (ok) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label} (expected ~${b}, got ${a})`);
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

// ── Schema (mirrors production; same shape as migration-030's test) ───────
function buildSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS learners (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash      TEXT NOT NULL,
      class_id        INTEGER,
      canonical_name  TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_learners_identity_classed
      ON learners(phone_hash, class_id, normalized_name) WHERE class_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_learners_identity_unclassed
      ON learners(phone_hash, normalized_name) WHERE class_id IS NULL;

    CREATE TABLE IF NOT EXISTS assessments (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash      TEXT NOT NULL,
      title           TEXT,
      grade           INTEGER,
      subject         TEXT,
      term            INTEGER,
      assessment_type TEXT,
      total_marks     INTEGER,
      atp_topics      TEXT,
      class_id        INTEGER,
      FOREIGN KEY (phone_hash) REFERENCES teachers(phone_hash)
    );

    CREATE TABLE IF NOT EXISTS learner_results (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      assessment_id INTEGER NOT NULL,
      learner_name  TEXT,
      mark          REAL,
      total_marks   REAL,
      percentage    REAL,
      question_data TEXT,
      learner_id    INTEGER,
      FOREIGN KEY (assessment_id) REFERENCES assessments(id)
    );

    CREATE TABLE IF NOT EXISTS assessment_blueprints (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash           TEXT    NOT NULL,
      title                TEXT    NOT NULL,
      subject              TEXT    NOT NULL,
      grade                INTEGER NOT NULL,
      term                 INTEGER,
      total_marks          INTEGER NOT NULL,
      version              INTEGER NOT NULL DEFAULT 1,
      previous_version_id  INTEGER REFERENCES assessment_blueprints(id),
      status               TEXT    NOT NULL DEFAULT 'draft',
      created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at           TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (phone_hash) REFERENCES teachers(phone_hash)
    );

    CREATE TABLE IF NOT EXISTS blueprint_questions (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      blueprint_id            INTEGER NOT NULL,
      question_number         INTEGER NOT NULL,
      topic                   TEXT    NOT NULL,
      subtopic                TEXT,
      bloom_level             TEXT,
      atp_reference           TEXT,
      expected_misconception  TEXT,
      max_marks               INTEGER NOT NULL,
      created_at              TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (blueprint_id) REFERENCES assessment_blueprints(id)
        ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_assessment_blueprints_phone
      ON assessment_blueprints(phone_hash);
    CREATE INDEX IF NOT EXISTS idx_blueprint_questions_blueprint
      ON blueprint_questions(blueprint_id);
  `);

  try {
    db.exec(`ALTER TABLE assessments ADD COLUMN blueprint_id INTEGER REFERENCES assessment_blueprints(id)`);
  } catch (_) { /* already exists */ }
  try {
    db.exec(`ALTER TABLE assessments ADD COLUMN blueprint_version INTEGER`);
  } catch (_) { /* already exists */ }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_assessments_blueprint
      ON assessments(blueprint_id);
  `);
}

// ── Test runner ─────────────────────────────────────────────────────────
async function run() {
  _db = new DatabaseSync(':memory:');
  buildSchema(_db);

  const { createBlueprint, publishBlueprint } = require('../services/blueprintRepository');
  const { processAssessmentData } = require('../services/diagnosticWorkflowService');
  const { getBlueprintAssessmentAnalytics } = require('../services/blueprintAnalytics');

  const PHONE = 'bp_analytics_test_hash_001';
  _db.prepare(`INSERT INTO teachers (phone_hash) VALUES (?)`).run(PHONE);

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 1: Error paths
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 1: Error paths ────────────────────────────────────────────');

  const unknownResult = getBlueprintAssessmentAnalytics(999999);
  assert(!!unknownResult.error, 'unknown assessment id returns an error, not a throw');

  const plainAssessment = _db.prepare(`
    INSERT INTO assessments (phone_hash, title, total_marks) VALUES (?, ?, ?)
  `).run(PHONE, 'Free-form assessment', 20);
  const plainResult = getBlueprintAssessmentAnalytics(plainAssessment.lastInsertRowid);
  assert(!!plainResult.error, 'assessment with no blueprint_id returns an error, not a crash');

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 2: Build a blueprint with a topic spanning multiple questions
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 2: Blueprint setup ────────────────────────────────────────');

  // Fractions: Q1 (10) + Q2 (5) = 15 total. Algebra: Q3 (15) alone.
  const draft = createBlueprint(
    PHONE,
    { title: 'Term 2 Fractions & Algebra Test', subject: 'Life Orientation', grade: 6, term: 2, totalMarks: 30 },
    [
      { questionNumber: 1, topic: 'fractions', maxMarks: 10 },
      { questionNumber: 2, topic: 'fractions', maxMarks: 5 },
      { questionNumber: 3, topic: 'algebra', maxMarks: 15 },
    ]
  );
  const published = publishBlueprint(draft.blueprintId, PHONE);

  const zeroLearnersAssessment = processAssessmentData(PHONE, {
    title: 'Empty class test',
    grade: 6,
    subject: 'Life Orientation',
    term: 2,
    type: 'test',
    totalMarks: 30,
    blueprintId: published.blueprintId,
    blueprintVersion: 1,
    learnerResults: [
      { learnerName: 'Only Invalid', questionData: { '1': 999 } }, // exceeds max, gets skipped -> zero valid learners stored
    ],
  });
  const zeroLearnersResult = getBlueprintAssessmentAnalytics(zeroLearnersAssessment.assessmentId);
  assert(!!zeroLearnersResult.error, 'blueprint assessment with zero stored (valid) learners returns an error');

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 3: Real class — topic aggregation, class averages, ranking
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 3: Topic aggregation, class averages, ranking ────────────');

  // Thabo: Q1=8, Q2=5, Q3=6  -> fractions 13/15, algebra 6/15, total 19/30
  // Naledi: Q1=10, Q2=5, Q3=15 -> fractions 15/15, algebra 15/15, total 30/30
  // Sipho: Q1=4  (Q2, Q3 omitted -- valid, just incomplete)
  //   -> fractions 4/15, algebra 0/15, total 4/30
  const diagnosticResult = processAssessmentData(PHONE, {
    title: 'Term 2 Fractions & Algebra Test',
    grade: 6,
    subject: 'Life Orientation',
    term: 2,
    type: 'test',
    totalMarks: 30,
    blueprintId: published.blueprintId,
    blueprintVersion: 1,
    learnerResults: [
      { learnerName: 'Thabo Mokoena', questionData: { '1': 8, '2': 5, '3': 6 } },
      { learnerName: 'Naledi Dube', questionData: { '1': 10, '2': 5, '3': 15 } },
      { learnerName: 'Sipho Nkosi', questionData: { '1': 4 } },
    ],
  });
  assert(!diagnosticResult.error, 'processAssessmentData completes for the 3-learner class');
  assertEq(diagnosticResult.skippedLearners, [], 'all three learners pass blueprint validation, none skipped');

  const analytics = getBlueprintAssessmentAnalytics(diagnosticResult.assessmentId);
  assert(!analytics.error, 'analytics computed without error for the real class');

  assertEq(analytics.blueprintId, published.blueprintId, 'analytics reports the correct blueprintId');
  assertEq(analytics.learnerCount, 3, 'learnerCount is 3');

  const fractionsTopic = analytics.topics.find((t) => t.topic === 'fractions');
  const algebraTopic = analytics.topics.find((t) => t.topic === 'algebra');
  assertEq(fractionsTopic.maxMarks, 15, 'fractions topic maxMarks sums Q1(10)+Q2(5) = 15');
  assertEq(algebraTopic.maxMarks, 15, 'algebra topic maxMarks is Q3 alone = 15');

  // Class average mark for fractions: (13 + 15 + 4) / 3 = 10.667
  assertClose(fractionsTopic.classAverageMark, 32 / 3, 'fractions class average mark is (13+15+4)/3');
  // Class average mark for algebra: (6 + 15 + 0) / 3 = 7
  assertClose(algebraTopic.classAverageMark, 7, 'algebra class average mark is (6+15+0)/3');

  // Overall class average mark: (19 + 30 + 4) / 3 = 17.667
  assertClose(analytics.classAverage.mark, 53 / 3, 'overall class average mark is (19+30+4)/3');

  // Strongest topic should be fractions (32/3 / 15 ≈ 71.1%) vs algebra (7/15 ≈ 46.7%)
  assertEq(analytics.strongestTopics[0].topic, 'fractions', 'fractions ranks as the strongest topic');
  assertEq(analytics.weakestTopics[0].topic, 'algebra', 'algebra ranks as the weakest topic');

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 4: Per-learner breakdown, including the incomplete learner
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 4: Per-learner topic breakdown ────────────────────────────');

  const sipho = analytics.learners.find((l) => l.learnerName === 'Sipho Nkosi');
  const siphoFractions = sipho.topics.find((t) => t.topic === 'fractions');
  const siphoAlgebra = sipho.topics.find((t) => t.topic === 'algebra');
  assertEq(siphoFractions.marksAwarded, 4, "Sipho's fractions marks: only Q1 answered, Q2 counts as 0");
  assertEq(siphoFractions.maxMarks, 15, "Sipho's fractions maxMarks is still the full blueprint total (15), not reduced to what he attempted");
  assertClose(siphoFractions.percentage, (4 / 15) * 100, "Sipho's fractions percentage is 4/15, not 4/10 (Q1 alone)");
  assertEq(siphoAlgebra.marksAwarded, 0, "Sipho's algebra marks: Q3 omitted entirely, counts as 0");

  const naledi = analytics.learners.find((l) => l.learnerName === 'Naledi Dube');
  const naledifractions = naledi.topics.find((t) => t.topic === 'fractions');
  assertEq(naledifractions.marksAwarded, 15, "Naledi's fractions marks: Q1(10)+Q2(5) = 15 (full marks)");
  assertClose(naledifractions.percentage, 100, "Naledi's fractions percentage is 100%");

  // ── Summary ─────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`Blueprint Analytics Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
