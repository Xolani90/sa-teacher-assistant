'use strict';
/**
 * GET /api/learners/:learnerId/intervention-plan tests (ADR-007 PR10 —
 * Dashboard/API exposure).
 *
 * Third independent delivery surface for InterventionService's
 * InterventionPlan[], alongside flows/workspaceFlow.js's WhatsApp
 * `LEARNER PROGRESS <n>` (PR8) and services/pdfService.js's
 * generateLearnerInterventionPdf() (PR9).
 *
 * Covers:
 *   1. 200 success — the response is exactly what the stubbed
 *      getLearnerInterventionPlan() returned, unchanged (no mastery,
 *      coverage, progress, or intervention computation happens in this
 *      file's handler).
 *   2. 404 for an unknown learner.
 *   3. 200 with `plans: []` for a resolved learner with zero
 *      InterventionPlans — deliberately NOT an error, unlike PR9's PDF
 *      generator (see routes/api.js's file header for why).
 *   4. 400 for a non-numeric / non-positive learnerId.
 *   5. 500 passthrough if either dependency throws, rather than crashing
 *      the process.
 *
 * Mocks only getLearnerById and getLearnerInterventionPlan (injected
 * directly, per routes/api.js's DI convention) — ProgressService,
 * CoverageService, MasteryService and learnerTimelineService are never
 * required by this test at all, matching the "don't re-mock a boundary
 * that's already tested" rule from tests/learner-intervention-pdf.test.js.
 *
 * Run individually: node tests/api-intervention-plan.test.js
 * Run via npm:       npm test
 */

const assert = require('assert');
const { createGetInterventionPlanHandler } = require('../routes/api').__testExports;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}`);
    console.log(`       ${e.message}`);
    failed++;
    process.exitCode = 1;
  }
}

// Minimal mock res — just enough of the Express response API for this
// handler (status/json), capturing what was sent for assertions.
function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

function mockReq(learnerIdParam) {
  return { params: { learnerId: learnerIdParam } };
}

const samplePlans = [
  {
    learnerId: 42,
    subject: 'Mathematics',
    priority: 'medium',
    focusTopics: ['Geometry'],
    recommendedActions: ['Continue monitoring — performance is developing steadily.'],
    evidence: { mastery: { level: 'Developing' } },
  },
];

console.log('\n── Section 1: success path ──────────────────────────────');
{
  const handler = createGetInterventionPlanHandler({
    getLearnerById: (id) => (id === 42 ? { id: 42, canonicalName: 'Sipho Dlamini' } : null),
    getLearnerInterventionPlan: (id) => (id === 42 ? samplePlans : []),
  });

  const req = mockReq('42');
  const res = mockRes();
  handler(req, res);

  test('responds 200', () => assert.strictEqual(res.statusCode, 200));
  test('echoes learnerId as a number', () => assert.strictEqual(res.body.learnerId, 42));
  test('returns the plans array unchanged (same reference contents)', () => {
    assert.deepStrictEqual(res.body.plans, samplePlans);
  });
  test('does not add, rename, or drop any fields on the plan', () => {
    assert.deepStrictEqual(Object.keys(res.body.plans[0]).sort(), Object.keys(samplePlans[0]).sort());
  });
}

console.log('\n── Section 2: unknown learner ───────────────────────────');
{
  const handler = createGetInterventionPlanHandler({
    getLearnerById: () => null,
    getLearnerInterventionPlan: () => {
      throw new Error('should not be called for an unknown learner');
    },
  });

  const req = mockReq('999');
  const res = mockRes();
  handler(req, res);

  test('responds 404', () => assert.strictEqual(res.statusCode, 404));
  test('includes an error message', () => assert.ok(res.body.error));
}

console.log('\n── Section 3: resolved learner, zero InterventionPlans ──');
{
  const handler = createGetInterventionPlanHandler({
    getLearnerById: () => ({ id: 7, canonicalName: 'New Learner' }),
    getLearnerInterventionPlan: () => [],
  });

  const req = mockReq('7');
  const res = mockRes();
  handler(req, res);

  test('responds 200 (not an error) for a learner with no data yet', () => {
    assert.strictEqual(res.statusCode, 200);
  });
  test('plans is an empty array, not an error object', () => {
    assert.deepStrictEqual(res.body.plans, []);
  });
}

console.log('\n── Section 4: invalid learnerId ─────────────────────────');
{
  const handler = createGetInterventionPlanHandler({
    getLearnerById: () => {
      throw new Error('should not be called for an invalid id');
    },
    getLearnerInterventionPlan: () => {
      throw new Error('should not be called for an invalid id');
    },
  });

  ['abc', '-1', '0', '3.5', ''].forEach((bad) => {
    const req = mockReq(bad);
    const res = mockRes();
    handler(req, res);
    test(`responds 400 for learnerId=${JSON.stringify(bad)}`, () => {
      assert.strictEqual(res.statusCode, 400);
    });
  });
}

console.log('\n── Section 5: dependency failures degrade to 500 ────────');
{
  const handlerRepoFails = createGetInterventionPlanHandler({
    getLearnerById: () => { throw new Error('db unavailable'); },
    getLearnerInterventionPlan: () => samplePlans,
  });
  const res1 = mockRes();
  handlerRepoFails(mockReq('42'), res1);
  test('getLearnerById throwing degrades to 500, not a crash', () => {
    assert.strictEqual(res1.statusCode, 500);
  });

  const handlerServiceFails = createGetInterventionPlanHandler({
    getLearnerById: () => ({ id: 42, canonicalName: 'Sipho Dlamini' }),
    getLearnerInterventionPlan: () => { throw new Error('intervention service exploded'); },
  });
  const res2 = mockRes();
  handlerServiceFails(mockReq('42'), res2);
  test('getLearnerInterventionPlan throwing degrades to 500, not a crash', () => {
    assert.strictEqual(res2.statusCode, 500);
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
