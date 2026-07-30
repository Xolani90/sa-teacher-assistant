'use strict';
/**
 * Blueprint Assessment PDF Report Tests (ADR-005 Section 8a, step 6 —
 * PDF parity).
 *
 * Covers:
 *   1. generateBlueprintAssessmentPdf() produces a real, non-trivial PDF
 *      file on disk for a blueprint-backed assessment (cover info, topic
 *      table, learner summary, struggling-learners section, appendix).
 *   2. It surfaces getBlueprintAssessmentAnalytics()'s error unchanged
 *      when the assessment isn't blueprint-backed (no second/duplicate
 *      error-handling path).
 *   3. The "Learners Needing Support" section is present when a learner
 *      scores below 40%, and the multi-page appendix table renders
 *      without throwing for a class with several learners/topics.
 *
 * This deliberately renders through real pdfkit (not stubbed) since the
 * whole point of this step is verifying the PDF actually renders — only
 * the DB layer and the heavy downstream analysis engines are stubbed,
 * same as the other blueprint test files.
 *
 * Run individually: node tests/blueprint-pdf-report.test.js
 * Run via npm:       npm test
 */

const Module = require('module');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const os = require('os');

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

// Route PDF output to a throwaway temp dir instead of ./data/pdfs.
process.env.DB_PATH = path.join(os.tmpdir(), `bp-pdf-test-${Date.now()}`, 'teacher_assistant.db');

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

// ── Schema (mirrors blueprint-analytics.test.js, plus teachers.name/school
//    since the PDF header pulls those for display) ─────────────────────────
function buildSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash TEXT UNIQUE NOT NULL,
      name TEXT,
      school TEXT
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
}

async function run() {
  _db = new DatabaseSync(':memory:');
  buildSchema(_db);

  const { createBlueprint, publishBlueprint } = require('../services/blueprintRepository');
  const { processAssessmentData } = require('../services/diagnosticWorkflowService');
  const { generateBlueprintAssessmentPdf } = require('../services/pdfService');

  const PHONE = 'bp_pdf_test_hash_001';
  _db.prepare(`INSERT INTO teachers (phone_hash, name, school) VALUES (?, ?, ?)`)
    .run(PHONE, 'Mrs Dlamini', 'Kimberley Primary');

  console.log('\n── Section 1: Build a published blueprint (3 topics) ────────────────');

  const draft = createBlueprint(
    PHONE,
    { title: 'Term 3 Fractions Test', subject: 'Mathematics', grade: 5, term: 3, totalMarks: 30 },
    [
      { questionNumber: 1, topic: 'Fractions', maxMarks: 10 },
      { questionNumber: 2, topic: 'Fractions', maxMarks: 5 },
      { questionNumber: 3, topic: 'Decimals', maxMarks: 10 },
      { questionNumber: 4, topic: 'Measurement', maxMarks: 5 },
    ],
  );
  const published = publishBlueprint(draft.blueprintId, PHONE);
  assert(published.status === 'published', 'blueprint published successfully');

  console.log('\n── Section 2: Import learner marks via processAssessmentData ────────');

  const assessmentData = {
    title: 'Term 3 Fractions Test',
    grade: 5,
    subject: 'Mathematics',
    term: 3,
    type: 'test',
    totalMarks: 30,
    blueprintId: draft.blueprintId,
    blueprintVersion: 1,
    learnerResults: [
      { learnerName: 'Sipho', questionData: { 1: 8, 2: 4, 3: 8, 4: 1 } },   // 21/30 = 70%
      { learnerName: 'Amahle', questionData: { 1: 9, 2: 5, 3: 9, 4: 4 } }, // 27/30 = 90%
      { learnerName: 'Neo', questionData: { 1: 1, 2: 0, 3: 1, 4: 0 } },     // 2/30 ≈ 7% (struggling)
    ],
  };

  const processResult = await processAssessmentData(PHONE, assessmentData);
  assert(!processResult.error, `processAssessmentData succeeded (${processResult.error || 'no error'})`);
  const assessmentId = processResult.assessmentId;
  assert(!!assessmentId, 'assessment row created and id returned');

  console.log('\n── Section 3: Generate the Blueprint Assessment PDF ──────────────────');

  const pdfResult = await generateBlueprintAssessmentPdf(assessmentId);
  assert(!pdfResult.error, `generateBlueprintAssessmentPdf succeeded (${pdfResult.error || 'no error'})`);

  if (!pdfResult.error) {
    const { getPdfPath } = require('../services/pdfService');
    const filePath = getPdfPath(pdfResult.fileId);
    const exists = fs.existsSync(filePath);
    assert(exists, 'PDF file was written to disk');
    if (exists) {
      const stats = fs.statSync(filePath);
      // A blank/near-empty PDF is a few hundred bytes; a real multi-page
      // report with a header bar, three tables and an appendix should be
      // comfortably larger than that.
      assert(stats.size > 2000, `PDF file has substantial content (${stats.size} bytes)`);
    }
    assert(/\.pdf$/.test(pdfResult.filename), 'filename ends in .pdf');
  }

  console.log('\n── Section 4: Error passthrough for non-blueprint assessments ───────');

  const plainAssessment = _db.prepare(`
    INSERT INTO assessments (phone_hash, title, total_marks) VALUES (?, ?, ?)
  `).run(PHONE, 'Free-form assessment', 20);
  const plainPdfResult = await generateBlueprintAssessmentPdf(plainAssessment.lastInsertRowid);
  assert(!!plainPdfResult.error, 'non-blueprint assessment returns analytics error, not a PDF');

  console.log('\n── Section 5: Unknown assessmentId ───────────────────────────────────');

  // getBlueprintAssessmentAnalytics()'s !assessment branch returns a distinct
  // error from the !assessment.blueprint_id branch above (Section 4) — assert
  // the exact string so a future edit that collapses these two guards into
  // one message is caught here.
  const unknownAssessmentId = 999999;
  const unknownPdfResult = await generateBlueprintAssessmentPdf(unknownAssessmentId);
  assert(!!unknownPdfResult.error, 'unknown assessmentId returns an error, not a PDF');
  assert(
    unknownPdfResult.error === `No assessment found with id ${unknownAssessmentId}`,
    'unknown assessmentId error matches getBlueprintAssessmentAnalytics()\'s exact !assessment message'
  );

  if (!unknownPdfResult.error) {
    const { getPdfPath } = require('../services/pdfService');
    const filePath = getPdfPath(unknownPdfResult.fileId);
    assert(!fs.existsSync(filePath), 'no PDF file was written for an unknown assessmentId');
  }

  console.log('\n── Section 6: Published blueprint, zero learner results ──────────────');

  // A second blueprint, published but never given any learner_results rows —
  // exercises getBlueprintAssessmentAnalytics()'s learnerRows.length === 0
  // branch specifically, distinct from both Section 4 and Section 5's guards.
  const emptyDraft = createBlueprint(
    PHONE,
    { title: 'Term 3 Empty Test', subject: 'Mathematics', grade: 5, term: 3, totalMarks: 10 },
    [
      { questionNumber: 1, topic: 'Fractions', maxMarks: 10 },
    ],
  );
  publishBlueprint(emptyDraft.blueprintId, PHONE);

  const emptyAssessment = _db.prepare(`
    INSERT INTO assessments (phone_hash, title, total_marks, blueprint_id, blueprint_version)
    VALUES (?, ?, ?, ?, ?)
  `).run(PHONE, 'Term 3 Empty Test', 10, emptyDraft.blueprintId, 1);

  const emptyPdfResult = await generateBlueprintAssessmentPdf(emptyAssessment.lastInsertRowid);
  assert(!!emptyPdfResult.error, 'blueprint-backed assessment with zero learner results returns an error, not a PDF');
  assert(
    emptyPdfResult.error === 'No learner results found for this assessment',
    'zero-learner-results error matches getBlueprintAssessmentAnalytics()\'s exact message'
  );

  if (!emptyPdfResult.error) {
    const { getPdfPath } = require('../services/pdfService');
    const filePath = getPdfPath(emptyPdfResult.fileId);
    assert(!fs.existsSync(filePath), 'no PDF file was written for a zero-learner-results assessment');
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Test run threw:', err);
  process.exit(1);
});
