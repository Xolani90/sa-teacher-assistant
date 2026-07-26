'use strict';
/**
 * Class Intervention Rollup Service (ADR-009, PR11)
 *
 * classInterventionService.js composes exactly one seam:
 * interventionService.getLearnerInterventionPlan — it issues no SQL of
 * its own beyond the roster read, and performs no new mastery/progress/
 * coverage/intervention calculations. Per the same testing-isolation
 * discipline used by tests/interventionService.test.js, this suite mocks
 * interventionService and learnerRosterService directly.
 *
 * Run individually:   node tests/classInterventionService.test.js
 * Run via npm:         npm test
 */

const interventionService = require('../services/interventionService');
const rosterService = require('../services/learnerRosterService');
const classInterventionService = require('../services/classInterventionService');

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

const realGetLearnerInterventionPlan = interventionService.getLearnerInterventionPlan;
const realGetRoster = rosterService.getRoster;

function mockRoster(roster) {
  rosterService.getRoster = () => roster;
}

function mockPlans(byLearnerId) {
  // byLearnerId: Map<learnerId, InterventionPlan[] | Error>
  interventionService.getLearnerInterventionPlan = (learnerId) => {
    const result = byLearnerId.get(learnerId);
    if (result instanceof Error) throw result;
    return result;
  };
}

function restoreAll() {
  interventionService.getLearnerInterventionPlan = realGetLearnerInterventionPlan;
  rosterService.getRoster = realGetRoster;
}

/**
 * Builds an InterventionPlan fixture matching the real shape produced by
 * interventionService.buildPlan(), with sensible defaults so each test
 * only needs to override what it cares about.
 */
function makePlan(overrides = {}) {
  const masteryLevel = overrides.masteryLevel || 'developing';
  const base = {
    learnerId: overrides.learnerId ?? 1,
    subject: overrides.subject || 'mathematics',
    priority: overrides.priority || 'medium',
    focusTopics: overrides.focusTopics || [],
    recommendedActions: overrides.recommendedActions || ['Continue monitoring.'],
    evidence: {
      mastery: { masteryLevel, learnerId: overrides.learnerId ?? 1, subject: overrides.subject || 'mathematics' },
      progress: {},
      coverage: { dataAvailable: false, averagePercentage: null },
    },
  };
  return base;
}

console.log('Class Intervention Rollup Service (ADR-009, PR11)');
console.log('='.repeat(60));

// ── Section 1: empty class ────────────────────────────────────────────
console.log('\n--- empty class ---');
{
  mockRoster([]);
  mockPlans(new Map());
  const result = classInterventionService.getClassInterventionPlan('hash1', 1);
  assert(result.summary.totalLearners === 0, 'totalLearners is 0');
  assert(result.summary.evaluatedLearners === 0, 'evaluatedLearners is 0');
  assert(result.summary.insufficientData === 0, 'insufficientData is 0');
  assert(result.summary.erroredLearners === 0, 'erroredLearners is 0');
  assert(result.priorityLearners.high.length === 0 && result.priorityLearners.medium.length === 0 && result.priorityLearners.low.length === 0, 'all priority buckets empty');
  assert(result.commonFocusTopics.length === 0, 'no common focus topics');
  assert(result.errors.length === 0, 'no errors');
  restoreAll();
}

// ── Section 2: all learners evaluated ─────────────────────────────────
console.log('\n--- all learners evaluated ---');
{
  mockRoster([{ id: 1, name: 'Sipho' }, { id: 2, name: 'Ayanda' }]);
  mockPlans(new Map([
    [1, [makePlan({ learnerId: 1, subject: 'mathematics', priority: 'high' })]],
    [2, [makePlan({ learnerId: 2, subject: 'mathematics', priority: 'low' })]],
  ]));
  const result = classInterventionService.getClassInterventionPlan('hash1', 1);
  assert(result.summary.evaluatedLearners === 2, 'both learners evaluated');
  assert(result.summary.insufficientData === 0, 'no insufficient-data learners');
  assert(result.priorityCounts.high === 1 && result.priorityCounts.low === 1, 'priority counts correct');
  assert(result.priorityLearners.high[0].learnerId === 1, 'Sipho in high bucket');
  assert(result.priorityLearners.low[0].learnerId === 2, 'Ayanda in low bucket');
  restoreAll();
}

// ── Section 3: all learners insufficient-data ─────────────────────────
console.log('\n--- all learners insufficient-data ---');
{
  mockRoster([{ id: 1, name: 'Sipho' }]);
  mockPlans(new Map([
    [1, [makePlan({ learnerId: 1, subject: 'mathematics', priority: 'medium', masteryLevel: 'insufficient-data' })]],
  ]));
  const result = classInterventionService.getClassInterventionPlan('hash1', 1);
  assert(result.summary.evaluatedLearners === 0, 'evaluatedLearners is 0');
  assert(result.summary.insufficientData === 1, 'insufficientData is 1');
  assert(result.priorityLearners.high.length === 0 && result.priorityLearners.medium.length === 0 && result.priorityLearners.low.length === 0, 'not placed in any priority bucket despite priority=medium');
  restoreAll();
}

// ── Section 4: mixed evaluated/insufficient across subjects (same learner) ─
console.log('\n--- mixed subjects: Maths high, English insufficient-data ---');
{
  mockRoster([{ id: 1, name: 'Sipho' }]);
  mockPlans(new Map([
    [1, [
      makePlan({ learnerId: 1, subject: 'mathematics', priority: 'high' }),
      makePlan({ learnerId: 1, subject: 'english', priority: 'medium', masteryLevel: 'insufficient-data' }),
    ]],
  ]));
  const result = classInterventionService.getClassInterventionPlan('hash1', 1);
  assert(result.priorityLearners.high[0].overallPriority === 'high', 'overall priority is high, not diluted by insufficient-data subject');
  assert(result.summary.insufficientData === 0, 'learner is NOT double-counted as insufficientData');
  assert(result.summary.evaluatedLearners === 1, 'learner counted once as evaluated');
  restoreAll();
}

// ── Section 5: partial failure — one learner throws ───────────────────
console.log('\n--- partial failure: one learner throws ---');
{
  mockRoster([{ id: 1, name: 'Sipho' }, { id: 2, name: 'Ayanda' }]);
  mockPlans(new Map([
    [1, new Error('db exploded')],
    [2, [makePlan({ learnerId: 2, subject: 'mathematics', priority: 'low' })]],
  ]));
  const result = classInterventionService.getClassInterventionPlan('hash1', 1);
  assert(result.summary.erroredLearners === 1, 'erroredLearners is 1');
  assert(result.errors[0].learnerId === 1 && result.errors[0].reason === 'db exploded', 'error entry names learner and reason');
  assert(result.summary.evaluatedLearners === 1, 'remaining learner still evaluated');
  assert(result.priorityLearners.low[0].learnerId === 2, 'remaining learner still bucketed correctly');
  restoreAll();
}

// ── Section 6: multiple failures ──────────────────────────────────────
console.log('\n--- multiple failures ---');
{
  mockRoster([{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }]);
  mockPlans(new Map([
    [1, new Error('fail 1')],
    [2, new Error('fail 2')],
    [3, [makePlan({ learnerId: 3, priority: 'medium' })]],
  ]));
  const result = classInterventionService.getClassInterventionPlan('hash1', 1);
  assert(result.summary.erroredLearners === 2, 'two errored learners');
  assert(result.errors.length === 2, 'two error entries recorded');
  assert(result.summary.totalLearners === 3, 'totalLearners reflects full roster regardless of errors');
  restoreAll();
}

// ── Section 7: priority ordering — High -> Medium -> Low, alphabetical within bucket ─
console.log('\n--- priority ordering ---');
{
  mockRoster([
    { id: 1, name: 'Zanele' },
    { id: 2, name: 'Alice' },
    { id: 3, name: 'Sipho' },
  ]);
  mockPlans(new Map([
    [1, [makePlan({ learnerId: 1, priority: 'high' })]],
    [2, [makePlan({ learnerId: 2, priority: 'high' })]],
    [3, [makePlan({ learnerId: 3, priority: 'high' })]],
  ]));
  const result = classInterventionService.getClassInterventionPlan('hash1', 1);
  const names = result.priorityLearners.high.map((l) => l.learnerName);
  assert(JSON.stringify(names) === JSON.stringify(['Alice', 'Sipho', 'Zanele']), 'high bucket sorted alphabetically');
  restoreAll();
}

// ── Section 8: common topic threshold ─────────────────────────────────
console.log('\n--- common focus topic threshold (0.5) ---');
{
  mockRoster([
    { id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }, { id: 4, name: 'D' },
  ]);
  mockPlans(new Map([
    [1, [makePlan({ learnerId: 1, subject: 'mathematics', focusTopics: ['Fractions'] })]],
    [2, [makePlan({ learnerId: 2, subject: 'mathematics', focusTopics: ['Fractions'] })]],
    [3, [makePlan({ learnerId: 3, subject: 'mathematics', focusTopics: [] })]],
    [4, [makePlan({ learnerId: 4, subject: 'mathematics', focusTopics: [] })]],
  ]));
  const result = classInterventionService.getClassInterventionPlan('hash1', 1);
  const fractions = result.commonFocusTopics.find((t) => t.topic === 'Fractions');
  assert(fractions !== undefined, 'Fractions included at exactly 50% (2/4)');
  assert(fractions.affectedLearners === 2 && fractions.percentage === 0.5, 'affectedLearners and percentage correct');
  restoreAll();
}
{
  mockRoster([
    { id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' },
  ]);
  mockPlans(new Map([
    [1, [makePlan({ learnerId: 1, subject: 'mathematics', focusTopics: ['Fractions'] })]],
    [2, [makePlan({ learnerId: 2, subject: 'mathematics', focusTopics: [] })]],
    [3, [makePlan({ learnerId: 3, subject: 'mathematics', focusTopics: [] })]],
  ]));
  const result = classInterventionService.getClassInterventionPlan('hash1', 1);
  const fractions = result.commonFocusTopics.find((t) => t.topic === 'Fractions');
  assert(fractions === undefined, 'Fractions excluded below 50% (1/3)');
  restoreAll();
}

// ── Section 9: insufficient-data subjects excluded from topic aggregation ─
console.log('\n--- insufficient-data subjects excluded from topic aggregation ---');
{
  mockRoster([{ id: 1, name: 'A' }, { id: 2, name: 'B' }]);
  mockPlans(new Map([
    [1, [makePlan({ learnerId: 1, subject: 'mathematics', focusTopics: ['Fractions'], masteryLevel: 'insufficient-data', priority: 'medium' })]],
    [2, [makePlan({ learnerId: 2, subject: 'mathematics', focusTopics: ['Fractions'] })]],
  ]));
  const result = classInterventionService.getClassInterventionPlan('hash1', 1);
  const fractions = result.commonFocusTopics.find((t) => t.topic === 'Fractions');
  // Only learner 2 is evaluated for mathematics -> denominator 1, affected 1 -> 100%, included.
  assert(fractions.affectedLearners === 1 && fractions.percentage === 1, 'insufficient-data subject excluded from both numerator and denominator');
  restoreAll();
}

// ── Section 10: priorityLearners retains all contributing subject plans ─
console.log('\n--- priorityLearners retains subjectPlans ---');
{
  mockRoster([{ id: 1, name: 'Sipho' }]);
  const plans = [
    makePlan({ learnerId: 1, subject: 'mathematics', priority: 'high' }),
    makePlan({ learnerId: 1, subject: 'english', priority: 'low' }),
  ];
  mockPlans(new Map([[1, plans]]));
  const result = classInterventionService.getClassInterventionPlan('hash1', 1);
  assert(result.priorityLearners.high[0].subjectPlans.length === 2, 'both subject plans retained, not just the winning one');
  restoreAll();
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(51));
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📊 Total:  ${passed + failed}`);
console.log('─'.repeat(51));

if (failed > 0) process.exit(1);
