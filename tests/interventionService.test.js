'use strict';
/**
 * Intervention Service (ADR-007, PR7)
 *
 * interventionService.js composes exactly one seam: masteryService — it
 * issues no SQL, builds no timeline, and recomputes no trend/coverage/
 * mastery math of its own. Per the same testing-isolation discipline used
 * by tests/masteryService.test.js, this suite mocks masteryService
 * directly rather than calling through to real ProgressService/
 * CoverageService/TimelineService/MasteryService implementations.
 *
 * Run individually:   node tests/interventionService.test.js
 * Run via npm:         npm test
 */

const masteryService = require('../services/masteryService');
const interventionService = require('../services/interventionService');

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

const realGetLearnerMastery = masteryService.getLearnerMastery;
const realGetLearnerMasteryForSubject = masteryService.getLearnerMasteryForSubject;

function mockMastery(reports) {
  masteryService.getLearnerMastery = () => reports;
}

function mockMasteryForSubject(fn) {
  masteryService.getLearnerMasteryForSubject = fn;
}

function restoreAll() {
  masteryService.getLearnerMastery = realGetLearnerMastery;
  masteryService.getLearnerMasteryForSubject = realGetLearnerMasteryForSubject;
}

/**
 * Builds a MasteryReport fixture matching the real shape produced by
 * masteryService.buildReport(), with sensible defaults so each test only
 * needs to override the fields it cares about.
 */
function makeMasteryReport(overrides = {}) {
  const base = {
    learnerId: 1,
    subject: 'mathematics',
    masteryLevel: 'developing',
    confidence: 0.5,
    evidence: {
      progress: {
        learnerId: 1,
        subject: 'mathematics',
        eventCount: 3,
        trend: 'flat',
        delta: 0,
        latestPercentage: 60,
        earliestPercentage: 60,
        averagePercentage: 60,
        points: [],
      },
      coverage: {
        dataAvailable: true,
        averagePercentage: 55,
        reports: [
          {
            subject: 'mathematics',
            grade: 7,
            term: 2,
            dataAvailable: true,
            coveragePercentage: 55,
            missingTopics: ['Geometry', 'Measurement'],
          },
        ],
      },
      timeline: { eventCount: 3 },
    },
    strengths: [],
    concerns: [],
  };
  return { ...base, ...overrides, evidence: { ...base.evidence, ...(overrides.evidence || {}) } };
}

console.log('Intervention Service (ADR-007, PR7)');
console.log('='.repeat(60));

// ── determinePriority ───────────────────────────────────────────────────
console.log('\n--- determinePriority ---');
{
  assert(
    interventionService.determinePriority(makeMasteryReport({ masteryLevel: 'insufficient-data' })) === 'medium',
    'insufficient-data -> medium priority'
  );
  assert(
    interventionService.determinePriority(makeMasteryReport({ masteryLevel: 'beginning' })) === 'high',
    'beginning -> high priority'
  );
  assert(
    interventionService.determinePriority(
      makeMasteryReport({
        masteryLevel: 'secure',
        evidence: { progress: { trend: 'falling' } },
      })
    ) === 'high',
    'falling trend escalates to high priority even at a higher mastery level'
  );
  assert(
    interventionService.determinePriority(makeMasteryReport({ masteryLevel: 'developing' })) === 'medium',
    'developing (flat/rising trend) -> medium priority'
  );
  assert(
    interventionService.determinePriority(makeMasteryReport({ masteryLevel: 'secure' })) === 'low',
    'secure -> low priority'
  );
  assert(
    interventionService.determinePriority(makeMasteryReport({ masteryLevel: 'advanced' })) === 'low',
    'advanced -> low priority'
  );
}

// ── extractFocusTopics ──────────────────────────────────────────────────
console.log('\n--- extractFocusTopics ---');
{
  assert(interventionService.extractFocusTopics([]) === undefined ? false : Array.isArray(interventionService.extractFocusTopics([])), 'empty coverage reports -> array, not throw');
  assert(interventionService.extractFocusTopics([]).length === 0, 'empty coverage reports -> empty array');

  const noData = [{ subject: 'mathematics', grade: 7, term: 2, dataAvailable: false, missingTopics: [] }];
  assert(interventionService.extractFocusTopics(noData).length === 0, 'dataAvailable:false group -> no focus topics');

  const single = [{ subject: 'mathematics', grade: 7, term: 2, dataAvailable: true, missingTopics: ['Fractions'] }];
  assert(
    JSON.stringify(interventionService.extractFocusTopics(single)) === JSON.stringify(['Fractions']),
    'single group returns its missingTopics verbatim'
  );

  const multi = [
    { subject: 'mathematics', grade: 7, term: 1, dataAvailable: true, missingTopics: ['Old topic'] },
    { subject: 'mathematics', grade: 7, term: 3, dataAvailable: true, missingTopics: ['Newest topic'] },
    { subject: 'mathematics', grade: 7, term: 2, dataAvailable: true, missingTopics: ['Middle topic'] },
  ];
  assert(
    JSON.stringify(interventionService.extractFocusTopics(multi)) === JSON.stringify(['Newest topic']),
    'multiple groups -> only the highest-term (most recent) group\'s missingTopics'
  );
}

// ── buildRecommendedActions ─────────────────────────────────────────────
console.log('\n--- buildRecommendedActions ---');
{
  const insufficientData = makeMasteryReport({
    masteryLevel: 'insufficient-data',
    evidence: { coverage: { dataAvailable: false, averagePercentage: null, reports: [] }, progress: { trend: 'insufficient-data' } },
  });
  const actionsForInsufficient = interventionService.buildRecommendedActions(insufficientData, []);
  assert(actionsForInsufficient.length === 1, 'insufficient-data -> exactly one action');
  assert(/gather more/i.test(actionsForInsufficient[0]), 'insufficient-data action asks to gather more evidence');

  const lowCoverage = makeMasteryReport({
    masteryLevel: 'developing',
    evidence: {
      coverage: { dataAvailable: true, averagePercentage: 20, reports: [] },
      progress: { trend: 'flat' },
    },
  });
  const lowCoverageActions = interventionService.buildRecommendedActions(lowCoverage, ['Geometry']);
  assert(
    lowCoverageActions.some((a) => /revisit missing caps topics/i.test(a) && a.includes('Geometry')),
    'coverage below 40% -> revisit-missing-topics action naming the focus topics'
  );

  const fallingTrend = makeMasteryReport({
    masteryLevel: 'developing',
    evidence: { coverage: { dataAvailable: true, averagePercentage: 80, reports: [] }, progress: { trend: 'falling' } },
  });
  const fallingActions = interventionService.buildRecommendedActions(fallingTrend, []);
  assert(
    fallingActions.some((a) => /schedule targeted revision/i.test(a)),
    'falling progress trend -> schedule-targeted-revision action'
  );

  const beginning = makeMasteryReport({
    masteryLevel: 'beginning',
    evidence: { coverage: { dataAvailable: true, averagePercentage: 20, reports: [] }, progress: { trend: 'flat' } },
  });
  const beginningActions = interventionService.buildRecommendedActions(beginning, []);
  assert(
    beginningActions.some((a) => /small-group intervention/i.test(a)),
    'mastery beginning -> small-group intervention action'
  );

  const secure = makeMasteryReport({
    masteryLevel: 'secure',
    evidence: { coverage: { dataAvailable: true, averagePercentage: 85, reports: [] }, progress: { trend: 'flat' } },
  });
  const secureActions = interventionService.buildRecommendedActions(secure, []);
  assert(secureActions.some((a) => /continue current pace/i.test(a)), 'mastery secure -> continue-current-pace action');

  const advanced = makeMasteryReport({
    masteryLevel: 'advanced',
    evidence: { coverage: { dataAvailable: true, averagePercentage: 90, reports: [] }, progress: { trend: 'rising' } },
  });
  const advancedActions = interventionService.buildRecommendedActions(advanced, []);
  assert(
    advancedActions.some((a) => /enrichment/i.test(a)),
    'mastery advanced -> enrichment-activities action'
  );

  const steadyDeveloping = makeMasteryReport({
    masteryLevel: 'developing',
    evidence: { coverage: { dataAvailable: true, averagePercentage: 55, reports: [] }, progress: { trend: 'flat' } },
  });
  const steadyActions = interventionService.buildRecommendedActions(steadyDeveloping, []);
  assert(steadyActions.length > 0, 'developing with no falling trend and adequate coverage still returns a non-empty action list');
  assert(
    steadyActions.some((a) => /monitoring/i.test(a)),
    'developing/no-triggered-rule falls back to a monitoring action, not an empty list'
  );

  const stacked = makeMasteryReport({
    masteryLevel: 'beginning',
    evidence: { coverage: { dataAvailable: true, averagePercentage: 20, reports: [] }, progress: { trend: 'falling' } },
  });
  const stackedActions = interventionService.buildRecommendedActions(stacked, ['Fractions']);
  assert(
    stackedActions.length >= 3,
    'multiple triggered rules (low coverage + falling trend + beginning) all stack as separate actions, not just one'
  );
}

// ── buildPlan ────────────────────────────────────────────────────────────
console.log('\n--- buildPlan ---');
{
  const mastery = makeMasteryReport({ learnerId: 42, subject: 'english' });
  const plan = interventionService.buildPlan(mastery);
  assert(plan.learnerId === 42, 'plan.learnerId carried through from the MasteryReport');
  assert(plan.subject === 'english', 'plan.subject carried through from the MasteryReport');
  assert(['low', 'medium', 'high'].includes(plan.priority), 'plan.priority is one of the three valid values');
  assert(Array.isArray(plan.focusTopics), 'plan.focusTopics is an array');
  assert(Array.isArray(plan.recommendedActions) && plan.recommendedActions.length > 0, 'plan.recommendedActions is a non-empty array');
  assert(plan.evidence.mastery === mastery, 'plan.evidence.mastery carries the full MasteryReport, not a summary');
  assert(plan.evidence.progress === mastery.evidence.progress, 'plan.evidence.progress is the same ProgressReport MasteryService produced');
  assert(plan.evidence.coverage.dataAvailable === mastery.evidence.coverage.dataAvailable, 'plan.evidence.coverage.dataAvailable mirrors the MasteryReport');
  assert(plan.evidence.coverage.averagePercentage === mastery.evidence.coverage.averagePercentage, 'plan.evidence.coverage.averagePercentage mirrors the MasteryReport');
}

// ── getLearnerInterventionPlan (mocked seam) ─────────────────────────────
console.log('\n--- getLearnerInterventionPlan (mocked seam) ---');
{
  const reports = [
    makeMasteryReport({ learnerId: 7, subject: 'english', masteryLevel: 'secure' }),
    makeMasteryReport({ learnerId: 7, subject: 'mathematics', masteryLevel: 'beginning' }),
  ];
  mockMastery(reports);

  const plans = interventionService.getLearnerInterventionPlan(7);
  assert(plans.length === 2, 'one InterventionPlan per MasteryReport returned by masteryService');
  assert(plans.every((p) => p.learnerId === 7), 'every plan carries the correct learnerId');
  assert(plans.some((p) => p.subject === 'english' && p.priority === 'low'), 'secure english mastery yields a low-priority plan');
  assert(plans.some((p) => p.subject === 'mathematics' && p.priority === 'high'), 'beginning mathematics mastery yields a high-priority plan');

  restoreAll();
}

console.log('\n--- getLearnerInterventionPlan: empty mastery -> empty plan array, not an error ---');
{
  mockMastery([]);
  const plans = interventionService.getLearnerInterventionPlan(999);
  assert(Array.isArray(plans) && plans.length === 0, 'no MasteryReports -> empty InterventionPlan array');
  restoreAll();
}

// ── getLearnerInterventionPlanForSubject (mocked seam) ───────────────────
console.log('\n--- getLearnerInterventionPlanForSubject (mocked seam) ---');
{
  mockMasteryForSubject((learnerId, subject) =>
    makeMasteryReport({ learnerId, subject, masteryLevel: 'advanced' })
  );

  const plan = interventionService.getLearnerInterventionPlanForSubject(3, 'life skills');
  assert(plan.learnerId === 3, 'single-subject accessor carries through the requested learnerId');
  assert(plan.subject === 'life skills', 'single-subject accessor carries through the requested subject');
  assert(plan.priority === 'low', 'single-subject accessor applies the same priority rules as the full pipeline');

  restoreAll();
}

console.log('\n--- getLearnerInterventionPlanForSubject: a subject with no evidence never returns null/undefined ---');
{
  mockMasteryForSubject((learnerId, subject) =>
    makeMasteryReport({
      learnerId,
      subject,
      masteryLevel: 'insufficient-data',
      evidence: {
        coverage: { dataAvailable: false, averagePercentage: null, reports: [] },
        progress: { trend: 'insufficient-data', eventCount: 0 },
      },
    })
  );

  const plan = interventionService.getLearnerInterventionPlanForSubject(5, 'accounting');
  assert(plan != null, 'a subject with zero evidence still returns a plan object, not null/undefined');
  assert(plan.priority === 'medium', 'insufficient-data still resolves to a concrete (medium) priority');
  assert(
    plan.recommendedActions.length === 1 && /gather more/i.test(plan.recommendedActions[0]),
    'insufficient-data plan recommends gathering more evidence, not an empty action list'
  );

  restoreAll();
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
