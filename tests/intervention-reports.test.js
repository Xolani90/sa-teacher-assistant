'use strict';
// Integration test for interventionReportsService.js — uses the REAL
// migration chain (tests/helpers/createTestDb.js) against a throwaway
// file-backed SQLite database, so it exercises the actual production
// schema instead of a hand-rolled subset.
// Run via: npm test, or directly: node tests/intervention-reports.test.js

const assert = require('assert');

// MUST be required before any service/repository module — see
// tests/helpers/createTestDb.js's "Why this must be required first".
const { createTestDb } = require('./helpers/createTestDb');
const testDb = createTestDb(__filename);
const db = testDb.db;

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

  // ── Test 12: RC1-H-003 regression — interventionPlanService must expose
  // problemAreas (plural array), not just problemArea (singular string),
  // or generateTeacherSummary/generateHodSummary silently fall back to
  // 'none identified' / 'general revision' even when problem areas were
  // correctly identified. See services/interventionPlanService.js.
  //
  // Needs its own assessment (not the shared fixture above) because it
  // requires a question with success_rate < 0.5 to make errorAnalysis
  // actually populate errorPatterns — the shared fixture's class does too
  // well on both questions to trigger that path. ──
  const weakAssessmentId = db.prepare(`
    INSERT INTO assessments (phone_hash, title, grade, subject, term, assessment_type, total_marks)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(phoneHash, 'Term 2 Fractions Retest', 7, 'mathematics', 2, 'test', 50).lastInsertRowid;

  const weakLearners = [
    { name: 'Bongani', mark: 45, q: { 1: { mark: 10, maxMark: 10, topic: 'fractions' }, 2: { mark: 35, maxMark: 40, topic: 'fractions' } } },
    { name: 'Zanele',  mark: 20, q: { 1: { mark: 4,  maxMark: 10, topic: 'fractions' }, 2: { mark: 16, maxMark: 40, topic: 'fractions' } } },
    { name: 'Kagiso',  mark: 15, q: { 1: { mark: 3,  maxMark: 10, topic: 'fractions' }, 2: { mark: 12, maxMark: 40, topic: 'fractions' } } },
    { name: 'Precious',mark: 8,  q: { 1: { mark: 1,  maxMark: 10, topic: 'fractions' }, 2: { mark: 7,  maxMark: 40, topic: 'fractions' } } },
  ];
  for (const l of weakLearners) {
    db.prepare(`
      INSERT INTO learner_results (assessment_id, learner_name, mark, total_marks, percentage, question_data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(weakAssessmentId, l.name, l.mark, 50, Math.round((l.mark / 50) * 100), JSON.stringify(l.q));
  }

  const weakItemAnalysis = itemAnalysisSvc.performItemAnalysis(weakAssessmentId);
  assert(!weakItemAnalysis.error, `seed item analysis (weak fixture) should not error: ${weakItemAnalysis.error}`);
  itemAnalysisSvc.saveItemAnalysis(weakAssessmentId, weakItemAnalysis.questions, 'mathematics');

  const weakReport = svc.generateInterventionReport(weakAssessmentId);
  assert(!weakReport.error, `weak report should not error: ${weakReport.error}`);
  assert(
    Array.isArray(weakReport.interventionPlan.problemAreas),
    'interventionPlan.problemAreas should be an array'
  );
  assert(
    weakReport.interventionPlan.problemAreas.length > 0,
    'interventionPlan.problemAreas should be non-empty when questions have success_rate < 0.5'
  );
  const [firstProblemArea] = weakReport.interventionPlan.problemAreas;

  const weakTeacherSummary = svc.generateTeacherSummary(weakReport);
  assert(
    weakTeacherSummary.includes(firstProblemArea),
    `teacher summary should mention problem area "${firstProblemArea}" instead of falling back to 'general revision'`
  );

  const weakHodSummary = svc.generateHodSummary(weakReport);
  assert(
    !weakHodSummary.includes('Problem areas: none identified'),
    'HOD summary should not fall back to "none identified" when problem areas exist'
  );
  assert(
    weakHodSummary.includes(firstProblemArea),
    `HOD summary should mention problem area "${firstProblemArea}"`
  );
  console.log('✅ Test 12 passed: problemAreas contract honored end-to-end (RC1-H-003 regression)');

  console.log('\n🎉 All 12 tests passed.');
} finally {
  testDb.cleanup();
}
