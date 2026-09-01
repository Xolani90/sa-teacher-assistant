'use strict';
/**
 * GET/POST/PATCH/DELETE /api/growth-plans tests.
 *
 * Thin-route tests only, mirroring tests/api-reflections-write.test.js's
 * style exactly (Growth Plans dashboard feature — Reflections is the
 * architectural template, per product decision). growthPlanService.js's
 * create/get/list/update/deleteGrowthPlan are NOT re-tested here — this
 * file only proves the routes wire phoneHash/body/params/query through
 * correctly, map service validation errors to 400, map null/false
 * returns to 404, and degrade safely on unexpected failures.
 *
 * Cross-teacher ownership itself (the real WHERE phone_hash=? check) is
 * proven against a real DB in tests/growth-plans-dashboard-e2e.test.js,
 * same split as resources-dashboard-e2e.test.js vs api-resources.test.js.
 *
 * Run individually: node tests/api-growth-plans.test.js
 * Run via npm:       npm test
 */

const assert = require('assert');
const {
  createGetGrowthPlansHandler,
  createGetGrowthPlanDetailHandler,
  createPostGrowthPlanHandler,
  createPatchGrowthPlanHandler,
  createDeleteGrowthPlanHandler,
} = require('../routes/api').__testExports;

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

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    sent: false,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    send() { this.sent = true; return this; },
  };
  return res;
}

function mockReq(phoneHash = 'hash_owner', { body = {}, params = {}, query = {} } = {}) {
  return { teacher: { id: 1, phoneHash }, body, params, query };
}

const sampleGrowthPlan = {
  id: 5,
  phoneHash: 'hash_owner',
  term: 2,
  goalText: 'Improve formative assessment feedback.',
  topicId: 'TOPIC_ASSESSMENT',
  status: 'active',
  createdAt: '2026-07-01 08:00:00',
  updatedAt: '2026-07-01 08:00:00',
  deletedAt: null,
};

console.log('\n── GET /growth-plans: success path ───────────────────────');
{
  const handler = createGetGrowthPlansHandler({
    listGrowthPlans: () => [sampleGrowthPlan],
  });

  const res = mockRes();
  handler(mockReq('hash_owner'), res);

  test('responds 200', () => assert.strictEqual(res.statusCode, 200));
  test('returns the growth plans list', () => assert.strictEqual(res.body.growthPlans.length, 1));
  test('returns an empty array, not null/undefined, when the service returns none', () => {
    const emptyHandler = createGetGrowthPlansHandler({ listGrowthPlans: () => [] });
    const emptyRes = mockRes();
    emptyHandler(mockReq('hash_owner'), emptyRes);
    assert.deepStrictEqual(emptyRes.body.growthPlans, []);
  });
}

console.log('\n── GET /growth-plans: term/status query params passed through ──');
{
  let seenOptions = null;
  const handler = createGetGrowthPlansHandler({
    listGrowthPlans: (phoneHash, options) => { seenOptions = options; return []; },
  });

  handler(mockReq('hash_owner', { query: { term: '2', status: 'active' } }), mockRes());

  test('term is coerced to a number', () => assert.strictEqual(seenOptions.term, 2));
  test('status is passed through as-is', () => assert.strictEqual(seenOptions.status, 'active'));
}

console.log('\n── GET /growth-plans: no query params -> null term/status ─');
{
  let seenOptions = null;
  const handler = createGetGrowthPlansHandler({
    listGrowthPlans: (phoneHash, options) => { seenOptions = options; return []; },
  });

  handler(mockReq('hash_owner'), mockRes());

  test('term defaults to null when omitted', () => assert.strictEqual(seenOptions.term, null));
  test('status defaults to null when omitted', () => assert.strictEqual(seenOptions.status, null));
}

console.log('\n── GET /growth-plans: service failure degrades to 500 ──────');
{
  const handler = createGetGrowthPlansHandler({
    listGrowthPlans: () => { throw new Error('db unavailable'); },
  });

  const res = mockRes();
  handler(mockReq('hash_owner'), res);

  test('responds 500, not a crash', () => assert.strictEqual(res.statusCode, 500));
  test('includes a generic error message, not the raw db error', () => {
    assert.strictEqual(res.body.error, 'Internal server error');
  });
}

console.log('\n── GET /growth-plans/:id: success path ─────────────────────');
{
  const handler = createGetGrowthPlanDetailHandler({
    getGrowthPlan: () => sampleGrowthPlan,
  });

  const res = mockRes();
  handler(mockReq('hash_owner', { params: { id: '5' } }), res);

  test('responds 200', () => assert.strictEqual(res.statusCode, 200));
  test('returns the growth plan', () => assert.strictEqual(res.body.growthPlan.id, 5));
}

console.log('\n── GET /growth-plans/:id: invalid id rejected ──────────────');
{
  const handler = createGetGrowthPlanDetailHandler({ getGrowthPlan: () => sampleGrowthPlan });

  ['abc', '-1', '0', '3.5', ''].forEach((badId) => {
    const res = mockRes();
    handler(mockReq('hash_owner', { params: { id: badId } }), res);
    test(`rejects id="${badId}" with 400`, () => assert.strictEqual(res.statusCode, 400));
  });
}

console.log('\n── GET /growth-plans/:id: not found / not owned -> 404 ─────');
{
  const handler = createGetGrowthPlanDetailHandler({ getGrowthPlan: () => null });

  const res = mockRes();
  handler(mockReq('hash_owner', { params: { id: '999' } }), res);

  test('responds 404 when getGrowthPlan returns null (matches the reflections/resources no-existence-oracle convention)', () => {
    assert.strictEqual(res.statusCode, 404);
  });
}

console.log('\n── GET /growth-plans/:id: service failure degrades to 500 ──');
{
  const handler = createGetGrowthPlanDetailHandler({
    getGrowthPlan: () => { throw new Error('db unavailable'); },
  });

  const res = mockRes();
  handler(mockReq('hash_owner', { params: { id: '5' } }), res);

  test('responds 500, not a crash', () => assert.strictEqual(res.statusCode, 500));
}

console.log('\n── POST /growth-plans: success path ────────────────────────');
{
  const handler = createPostGrowthPlanHandler({
    createGrowthPlan: (phoneHash, params) => ({ ...sampleGrowthPlan, phoneHash, goalText: params.goalText }),
  });

  const req = mockReq('hash_owner', { body: { goalText: 'Build stronger CAPS pacing.', topicId: 'TOPIC_CURRICULUM' } });
  const res = mockRes();
  handler(req, res);

  test('responds 201', () => assert.strictEqual(res.statusCode, 201));
  test('returns the created growth plan', () => assert.strictEqual(res.body.growthPlan.goalText, 'Build stronger CAPS pacing.'));
}

console.log('\n── POST /growth-plans: phoneHash passed through unchanged ──');
{
  let seenPhoneHash = null;
  const handler = createPostGrowthPlanHandler({
    createGrowthPlan: (phoneHash) => { seenPhoneHash = phoneHash; return sampleGrowthPlan; },
  });

  handler(mockReq('hash_specific_teacher', { body: { goalText: 'x', topicId: 'TOPIC_ASSESSMENT' } }), mockRes());

  test('req.teacher.phoneHash is passed through to createGrowthPlan unchanged', () => {
    assert.strictEqual(seenPhoneHash, 'hash_specific_teacher');
  });
}

console.log('\n── POST /growth-plans: service validation error maps to 400 ──');
{
  const handler = createPostGrowthPlanHandler({
    createGrowthPlan: () => { throw new Error('createGrowthPlan: goalText is required'); },
  });

  const res = mockRes();
  handler(mockReq('hash_owner', { body: {} }), res);

  test('responds 400 for a createGrowthPlan validation error', () => assert.strictEqual(res.statusCode, 400));
  test('surfaces the service error message', () => {
    assert.strictEqual(res.body.error, 'createGrowthPlan: goalText is required');
  });
}

console.log('\n── POST /growth-plans: invalid topicId maps to 400 ─────────');
{
  const handler = createPostGrowthPlanHandler({
    createGrowthPlan: () => { throw new Error('createGrowthPlan: topicId must be a valid QMS topic id, got "bogus"'); },
  });

  const res = mockRes();
  handler(mockReq('hash_owner', { body: { goalText: 'x', topicId: 'bogus' } }), res);

  test('responds 400 for an invalid topicId', () => assert.strictEqual(res.statusCode, 400));
}

console.log('\n── POST /growth-plans: unexpected failure degrades to 500 ──');
{
  const handler = createPostGrowthPlanHandler({
    createGrowthPlan: () => { throw new Error('db unavailable'); },
  });

  const res = mockRes();
  handler(mockReq('hash_owner', { body: { goalText: 'x', topicId: 'TOPIC_ASSESSMENT' } }), res);

  test('non-validation errors degrade to 500, not a crash', () => assert.strictEqual(res.statusCode, 500));
  test('includes a generic error message, not the raw db error', () => {
    assert.strictEqual(res.body.error, 'Internal server error');
  });
}

console.log('\n── PATCH /growth-plans/:id: success path (plain edit) ──────');
{
  const handler = createPatchGrowthPlanHandler({
    updateGrowthPlan: (phoneHash, id, params) => ({ ...sampleGrowthPlan, id, goalText: params.goalText }),
  });

  const req = mockReq('hash_owner', { body: { goalText: 'Updated goal text.' }, params: { id: '5' } });
  const res = mockRes();
  handler(req, res);

  test('responds 200', () => assert.strictEqual(res.statusCode, 200));
  test('returns the updated growth plan', () => assert.strictEqual(res.body.growthPlan.goalText, 'Updated goal text.'));
}

console.log('\n── PATCH /growth-plans/:id: status-only body marks a goal complete ──');
{
  let seenParams = null;
  const handler = createPatchGrowthPlanHandler({
    updateGrowthPlan: (phoneHash, id, params) => { seenParams = params; return { ...sampleGrowthPlan, status: params.status }; },
  });

  const req = mockReq('hash_owner', { body: { status: 'completed' }, params: { id: '5' } });
  const res = mockRes();
  handler(req, res);

  test('responds 200 for a status-only update (no separate complete route needed)', () => assert.strictEqual(res.statusCode, 200));
  test('status is passed through, goalText/topicId left undefined (partial update)', () => {
    assert.strictEqual(seenParams.status, 'completed');
    assert.strictEqual(seenParams.goalText, undefined);
    assert.strictEqual(seenParams.topicId, undefined);
  });
  test('the completed status is reflected in the response', () => assert.strictEqual(res.body.growthPlan.status, 'completed'));
}

console.log('\n── PATCH /growth-plans/:id: invalid id rejected ─────────────');
{
  const handler = createPatchGrowthPlanHandler({ updateGrowthPlan: () => sampleGrowthPlan });

  ['abc', '-1', '0', '3.5', ''].forEach((badId) => {
    const res = mockRes();
    handler(mockReq('hash_owner', { body: { goalText: 'x' }, params: { id: badId } }), res);
    test(`rejects id="${badId}" with 400`, () => assert.strictEqual(res.statusCode, 400));
  });
}

console.log('\n── PATCH /growth-plans/:id: not found / not owned -> 404 ───');
{
  const handler = createPatchGrowthPlanHandler({ updateGrowthPlan: () => null });

  const res = mockRes();
  handler(mockReq('hash_owner', { body: { goalText: 'x' }, params: { id: '999' } }), res);

  test('responds 404 when updateGrowthPlan returns null', () => assert.strictEqual(res.statusCode, 404));
}

console.log('\n── PATCH /growth-plans/:id: service validation error maps to 400 ──');
{
  const handler = createPatchGrowthPlanHandler({
    updateGrowthPlan: () => { throw new Error('updateGrowthPlan: goalText cannot be empty'); },
  });

  const res = mockRes();
  handler(mockReq('hash_owner', { body: { goalText: '' }, params: { id: '5' } }), res);

  test('responds 400 for an updateGrowthPlan validation error', () => assert.strictEqual(res.statusCode, 400));
}

console.log('\n── PATCH /growth-plans/:id: unexpected failure degrades to 500 ──');
{
  const handler = createPatchGrowthPlanHandler({
    updateGrowthPlan: () => { throw new Error('db unavailable'); },
  });

  const res = mockRes();
  handler(mockReq('hash_owner', { body: { goalText: 'x' }, params: { id: '5' } }), res);

  test('non-validation errors degrade to 500, not a crash', () => assert.strictEqual(res.statusCode, 500));
}

console.log('\n── DELETE /growth-plans/:id: success path ───────────────────');
{
  const handler = createDeleteGrowthPlanHandler({ deleteGrowthPlan: () => true });

  const res = mockRes();
  handler(mockReq('hash_owner', { params: { id: '5' } }), res);

  test('responds 204', () => assert.strictEqual(res.statusCode, 204));
  test('sends no body', () => assert.strictEqual(res.sent, true));
}

console.log('\n── DELETE /growth-plans/:id: invalid id rejected ────────────');
{
  const handler = createDeleteGrowthPlanHandler({ deleteGrowthPlan: () => true });

  ['abc', '-1', '0'].forEach((badId) => {
    const res = mockRes();
    handler(mockReq('hash_owner', { params: { id: badId } }), res);
    test(`rejects id="${badId}" with 400`, () => assert.strictEqual(res.statusCode, 400));
  });
}

console.log('\n── DELETE /growth-plans/:id: not found / not owned / already deleted -> 404 ──');
{
  const handler = createDeleteGrowthPlanHandler({ deleteGrowthPlan: () => false });

  const res = mockRes();
  handler(mockReq('hash_owner', { params: { id: '999' } }), res);

  test('responds 404 when deleteGrowthPlan returns false', () => assert.strictEqual(res.statusCode, 404));
}

console.log('\n── DELETE /growth-plans/:id: dependency failure degrades to 500 ──');
{
  const handler = createDeleteGrowthPlanHandler({
    deleteGrowthPlan: () => { throw new Error('db unavailable'); },
  });

  const res = mockRes();
  handler(mockReq('hash_owner', { params: { id: '5' } }), res);

  test('deleteGrowthPlan throwing degrades to 500, not a crash', () => assert.strictEqual(res.statusCode, 500));
}

console.log('\n── phoneHash scoping — GET/PATCH/DELETE all pass it through unchanged ──');
{
  let getPhoneHash = null;
  const getHandler = createGetGrowthPlanDetailHandler({
    getGrowthPlan: (phoneHash) => { getPhoneHash = phoneHash; return sampleGrowthPlan; },
  });
  getHandler(mockReq('hash_specific_teacher', { params: { id: '5' } }), mockRes());
  test('GET detail passes req.teacher.phoneHash through unchanged', () => {
    assert.strictEqual(getPhoneHash, 'hash_specific_teacher');
  });

  let patchPhoneHash = null;
  const patchHandler = createPatchGrowthPlanHandler({
    updateGrowthPlan: (phoneHash) => { patchPhoneHash = phoneHash; return sampleGrowthPlan; },
  });
  patchHandler(mockReq('hash_specific_teacher', { body: { goalText: 'x' }, params: { id: '5' } }), mockRes());
  test('PATCH passes req.teacher.phoneHash through unchanged', () => {
    assert.strictEqual(patchPhoneHash, 'hash_specific_teacher');
  });

  let deletePhoneHash = null;
  const deleteHandler = createDeleteGrowthPlanHandler({
    deleteGrowthPlan: (phoneHash) => { deletePhoneHash = phoneHash; return true; },
  });
  deleteHandler(mockReq('hash_specific_teacher', { params: { id: '5' } }), mockRes());
  test('DELETE passes req.teacher.phoneHash through unchanged', () => {
    assert.strictEqual(deletePhoneHash, 'hash_specific_teacher');
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;