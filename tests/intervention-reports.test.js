'use strict';
// Integration test for interventionReportsService.js — uses better-sqlite3
// directly (same lib production uses) against an in-memory DB.
// Run via: npm test, or directly: node tests/intervention-reports.test.js

const Database = require('better-sqlite3');
const Module = require('module');
const path = require('path');
const assert = require('assert');

const db = new Database(':memory:');

db.exec(`
  CREATE TABLE teachers (phone_hash TEXT PRIMARY KEY, last_assessment_id INTEGER);
  CREATE TABLE assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone_hash TEXT NOT NULL,
    title TEXT NOT NULL,
    grade INTEGER NOT NULL,
    subject TEXT NOT NULL,
    term INTEGER NOT NULL,
    assessment_type TEXT NOT NULL,
    total_marks INTEGER NOT NULL,
    atp_topics TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE learner_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assessment_id INTEGER NOT NULL,
    learner_name TEXT NOT NULL,
    mark INTEGER NOT NULL,
    total_marks INTEGER NOT NULL,
    percentage REAL NOT NULL,
    question_data TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone_hash TEXT NOT NULL,
    assessment_id INTEGER NOT NULL,
    report_type TEXT NOT NULL,
    learner_name TEXT,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE item_analysis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assessment_id INTEGER NOT NULL,
    question_number INTEGER NOT NULL,
    topic TEXT NOT NULL,
    difficulty REAL NOT NULL,
    success_rate REAL NOT NULL,
    cognitive_level TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE error_analysis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assessment_id INTEGER NOT NULL,
    error_type TEXT NOT NULL,
    topic TEXT NOT NULL,
    frequency INTEGER NOT NULL,
    description TEXT,
    reteach_action TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE intervention_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone_hash TEXT NOT NULL,
    assessment_id INTEGER,
    problem_area TEXT NOT NULL,
    target_group TEXT NOT NULL,
    goals TEXT NOT NULL,
    duration_days INTEGER NOT NULL,
    strategies TEXT NOT NULL,
    resources TEXT,
    monitoring_plan TEXT,
    success_indicators TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// fakeDb is just an alias for clarity in the require.cache injection below —
// better-sqlite3's Database instance already has the .prepare().get/.all/.run()
// shape that utils/database.js's getDb() consumers expect.
const fakeDb = db;

// Intercept require('../utils/database') across all services to return our fakeDb.
const stubPath = path.join(__dirname, '__stub_database.js');
require('fs').writeFileSync(stubPath, `module.exports = { getDb: () => require(${JSON.stringify(path.join(__dirname, '__test_db_holder.js'))}).db };`);
require('fs').writeFileSync(path.join(__dirname, '__test_db_holder.js'), '// placeholder');
require.cache[path.join(__dirname, '__test_db_holder.js')] = { exports: { db: fakeDb }, id: path.join(__dirname, '__test_db_holder.js'), filename: path.join(__dirname, '__test_db_holder.js'), loaded: true };

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === '../utils/database') {
    return stubPath;
  }
  return origResolve.call(this, request, ...rest);
};

try {
  const phoneHash = 'testhash123';
  db.prepare(`INSERT INTO teachers (phone_hash) VALUES (?)`).run(phoneHash);

  const assessmentId = db.prepare(`
    INSERT INTO assessments (phone_hash, title, grade, subject, term, assessment_type, total_marks)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(phoneHash, 'Term 2 Fractions Test', 7, 'mathematics', 2, 'test', 50).lastInsertRowid;

  // Seed learners across the full performance spectrum, each with question-level
  // data so item/error analysis have something real to chew on.
  const learners = [
    { name: 'Thabo',  mark: 48, q: { 1: { mark: 10, maxMark: 10, topic: 'fractions' }, 2: { mark: 38, maxMark: 40, topic: 'fractions' } } },
    { name: 'Naledi', mark: 45, q: { 1: { mark: 9,  maxMark: 10, topic: 'fractions' }, 2: { mark: 36, maxMark: 40, topic: 'fractions' } } },
    { name: 'Sipho',  mark: 28, q: { 1: { mark: 5,  maxMark: 10, topic: 'fractions' }, 2: { mark: 23, maxMark: 40, topic: 'fractions' } } },
    { name: 'Lindiwe',mark: 15, q: { 1: { mark: 2,  maxMark: 10, topic: 'fractions' }, 2: { mark: 13, maxMark: 40, topic: 'fractions' } } },
  ];
  for (const l of learners) {
    db.prepare(`
      INSERT INTO learner_results (assessment_id, learner_name, mark, total_marks, percentage, question_data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(assessmentId, l.name, l.mark, 50, Math.round((l.mark / 50) * 100), JSON.stringify(l.q));
  }

  // Now load the real service files (uncached, so they pick up our resolver hook)
  delete require.cache[require.resolve('../services/interventionReportsService.js')];
  delete require.cache[require.resolve('../services/itemAnalysisService.js')];
  delete require.cache[require.resolve('../services/errorAnalysisService.js')];
  delete require.cache[require.resolve('../services/learnerGroupingService.js')];
  delete require.cache[require.resolve('../services/interventionPlanService.js')];

  const itemAnalysisSvc = require('../services/itemAnalysisService.js');
  const svc = require('../services/interventionReportsService.js');

  // Replicate the real production order (diagnosticWorkflowService.processAssessmentData):
  // item analysis is computed AND PERSISTED before error analysis ever runs, since
  // performErrorAnalysis reads from the item_analysis table rather than recomputing.
  const liveItemAnalysis = itemAnalysisSvc.performItemAnalysis(assessmentId);
  assert(!liveItemAnalysis.error, `seed item analysis should not error: ${liveItemAnalysis.error}`);
  itemAnalysisSvc.saveItemAnalysis(assessmentId, liveItemAnalysis.questions, 'mathematics');
  console.log('✅ Seed step passed: item_analysis persisted (mirrors diagnosticWorkflowService ordering)');

  // ── Test 1: full report generation with real grouped data ──
  const report = svc.generateInterventionReport(assessmentId);
  assert(!report.error, `report should not error: ${report.error}`);
  assert.strictEqual(report.learnerGrouping.totalLearners, 4);
  assert.strictEqual(report.learnerGrouping.classAverage, Math.round((96 + 90 + 56 + 30) / 4));
  console.log('✅ Test 1 passed: generateInterventionReport returns correct grouping for seeded data');

  // ── Test 2: rules-based fallback plan kicks in (no AI plan saved yet) ──
  assert(report.interventionPlan, 'interventionPlan should be present via rules-based fallback');
  assert.strictEqual(report.interventionPlan.source, 'rules');
  console.log('✅ Test 2 passed: falls back to rules-based plan when no AI plan saved');

  // ── Test 3: teacher summary renders without throwing, contains key data ──
  const teacherSummary = svc.generateTeacherSummary(report);
  assert(teacherSummary.includes('Term 2 Fractions Test'));
  assert(teacherSummary.includes('Class Average'));
  console.log('✅ Test 3 passed: generateTeacherSummary renders correctly');

  // ── Test 4: HOD summary renders, includes moderation-relevant fields ──
  const hodSummary = svc.generateHodSummary(report);
  assert(hodSummary.includes('HOD REPORT'));
  assert(hodSummary.includes('Average Facility Value'));
  assert(hodSummary.includes('HOD Comments'));
  console.log('✅ Test 4 passed: generateHodSummary renders correctly');

  // ── Test 5: parent summary for a specific learner ──
  const parentSummaryNamed = svc.generateParentSummary(report, 'Thabo');
  assert(parentSummaryNamed.includes("Thabo's Performance"));
  assert(parentSummaryNamed.includes('96%'));
  console.log('✅ Test 5 passed: generateParentSummary scopes correctly to a named learner');

  // ── Test 6: parent summary for unknown learner doesn't throw, says not found ──
  const parentSummaryUnknown = svc.generateParentSummary(report, 'NotARealLearner');
  assert(parentSummaryUnknown.includes('not found'));
  console.log('✅ Test 6 passed: unknown learner name handled gracefully');

  // ── Test 7: general (no learnerName) parent summary — this is the path that
  // had the unguarded report.learnerGrouping.classAverage access bug ──
  const parentSummaryGeneral = svc.generateParentSummary(report, null);
  assert(parentSummaryGeneral.includes('Class Overview'));
  assert(parentSummaryGeneral.includes('Class Average'));
  console.log('✅ Test 7 passed: general parent summary (no learner name) does not throw');

  // ── Test 8: the previously-crashing case — assessment exists but has ZERO
  // learner results, so learnerGrouping.error is set. generateParentSummary
  // must not crash on report.learnerGrouping.classAverage. ──
  const emptyAssessmentId = db.prepare(`
    INSERT INTO assessments (phone_hash, title, grade, subject, term, assessment_type, total_marks)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(phoneHash, 'Empty Test', 7, 'mathematics', 2, 'test', 50).lastInsertRowid;
  const emptyReport = svc.generateInterventionReport(emptyAssessmentId);
  assert(emptyReport.learnerGrouping.error, 'expected learnerGrouping to error on zero learners');
  const emptyParentSummary = svc.generateParentSummary(emptyReport, null);
  assert(emptyParentSummary.includes('No learner results are available'));
  console.log('✅ Test 8 passed: zero-learner-results case no longer crashes generateParentSummary (this was the original bug)');

  // ── Test 9: save + retrieve a report round-trips correctly ──
  svc.saveReport(phoneHash, assessmentId, 'hod', hodSummary);
  const fetched = svc.getSavedReport(assessmentId, 'hod');
  assert.strictEqual(fetched.content, hodSummary);
  console.log('✅ Test 9 passed: saveReport/getSavedReport round-trip correctly');

  // ── Test 10: AI plan preference — once an ai_intervention_plan is saved,
  // generateInterventionReport should prefer it over the rules-based fallback ──
  svc.saveReport(phoneHash, assessmentId, 'ai_intervention_plan', '*Step 6 — Intervention Plan*\nFocus on fraction equivalence for Group D.');
  const reportWithAiPlan = svc.generateInterventionReport(assessmentId);
  assert.strictEqual(reportWithAiPlan.interventionPlan.source, 'ai');
  assert(reportWithAiPlan.interventionPlan.text.includes('fraction equivalence'));
  console.log('✅ Test 10 passed: AI-generated plan is preferred over rules-based fallback once saved');

  // ── Test 11: administrator summary across multiple assessments ──
  const adminSummary = svc.generateAdministratorSummary([assessmentId, emptyAssessmentId]);
  assert(adminSummary.includes('Administrator Intervention Report'));
  assert(adminSummary.includes('Assessments Analyzed: 2'));
  console.log('✅ Test 11 passed: generateAdministratorSummary handles a mix of populated and empty assessments');

  console.log('\n🎉 All 11 tests passed.');
} finally {
  Module._resolveFilename = origResolve;
  try { require('fs').unlinkSync(stubPath); } catch {}
  try { require('fs').unlinkSync(path.join(__dirname, '__test_db_holder.js')); } catch {}
}
