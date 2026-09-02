'use strict';
/**
 * GET /api/blueprints and GET /api/blueprints/:id tests.
 *
 * Thin-route tests only, mirroring tests/api-growth-plans.test.js's style
 * exactly (Assessment Blueprint Dashboard mirroring, Phase 1 of the
 * platform-wide WhatsApp ↔ Dashboard Mirroring requirement).
 * services/blueprintRepository.js's listBlueprints/getBlueprintById are
 * NOT re-tested here — this file only proves the routes wire
 * phoneHash/params/query through correctly, enforce the route-level
 * ownership check on the detail route, map null returns to 404, and
 * degrade safely on unexpected failures.
 *
 * Cross-teacher ownership against a real DB (Teacher B requesting
 * Teacher A's blueprint) is proven in
 * tests/blueprints-dashboard-e2e.test.js, same split as
 * growth-plans-dashboard-e2e.test.js vs this file.
 *
 * Run individually: node tests/api-blueprints.test.js
 * Run via npm:       npm test
 */

const assert = require('assert');
const {
  createGetBlueprintsHandler,
  createGetBlueprintDetailHandler,
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
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

function mockReq(phoneHash = 'hash_owner', { params = {}, query = {} } = {}) {
  return { teacher: { id: 1, phoneHash }, params, query };
}

const sampleBlueprintSummary = {
  id: 5,
  title: 'Term 2 Fractions Test',
  subject: 'Mathematics',
  grade: 7,
  term: 2,
  totalMarks: 50,
  version: 1,
  status: 'draft',
  questionCount: 4,
  updatedAt: '2026-08-01 08:00:00',
};

const sampleBlueprintDetail = {
  id: 5,
  phoneHash: 'hash_owner',
  title: 'Term 2 Fractions Test',
  subject: 'Mathematics',
  grade: 7,
  term: 2,
  totalMarks: 50,
  version: 1,
  previousVersionId: null,
  status: 'draft',
  createdAt: '2026-08-01 08:00:00',
  updatedAt: '2026-08-01 08:00:00',
  questions: [
    { id: 1, questionNumber: 1, topic: 'Fractions', subtopic: null, bloomLevel: 'Application', atpReference: null, expectedMisconception: null, maxMarks: 20 },
    { id: 2, questionNumber: 2, topic: 'Ratio', subtopic: null, bloomLevel: 'Knowledge', atpReference: null, expectedMisconception: null, maxMarks: 30 },
  ],
};

console.log('\n── GET /blueprints: success path ───────────────────────────');
{
  const handler = createGetBlueprintsHandler({
    listBlueprints: () => [sampleBlueprintSummary],
  });

  const res = mockRes();
  handler(mockReq('hash_owner'), res);

  test('responds 200', () => assert.strictEqual(res.statusCode, 200));
  test('returns the blueprints list', () => assert.strictEqual(res.body.blueprints.length, 1));
  test('returns an empty array, not null/undefined, when the repository returns none', () => {
    const emptyHandler = createGetBlueprintsHandler({ listBlueprints: () => [] });
    const emptyRes = mockRes();
    emptyHandler(mockReq('hash_owner'), emptyRes);
    assert.deepStrictEqual(emptyRes.body.blueprints, []);
  });
}

console.log('\n── GET /blueprints: phoneHash passed through unchanged ─────');
{
  let seenPhoneHash = null;
  const handler = createGetBlueprintsHandler({
    listBlueprints: (phoneHash) => { seenPhoneHash = phoneHash; return []; },
  });

  handler(mockReq('hash_specific_teacher'), mockRes());

  test('req.teacher.phoneHash is passed through to listBlueprints unchanged', () => {
    assert.strictEqual(seenPhoneHash, 'hash_specific_teacher');
  });
}

console.log('\n── GET /blueprints: subject/grade/status query params passed through ──');
{
  let seenFilters = null;
  const handler = createGetBlueprintsHandler({
    listBlueprints: (phoneHash, filters) => { seenFilters = filters; return []; },
  });

  handler(mockReq('hash_owner', { query: { subject: 'Mathematics', grade: '7', status: 'published' } }), mockRes());

  test('subject is passed through as-is', () => assert.strictEqual(seenFilters.subject, 'Mathematics'));
  test('grade is coerced to a number', () => assert.strictEqual(seenFilters.grade, 7));
  test('status is passed through as-is', () => assert.strictEqual(seenFilters.status, 'published'));
}

console.log('\n── GET /blueprints: no query params -> filters omitted ─────');
{
  let seenFilters = null;
  const handler = createGetBlueprintsHandler({
    listBlueprints: (phoneHash, filters) => { seenFilters = filters; return []; },
  });

  handler(mockReq('hash_owner'), mockRes());

  test('subject is undefined when omitted', () => assert.strictEqual(seenFilters.subject, undefined));
  test('grade is undefined when omitted', () => assert.strictEqual(seenFilters.grade, undefined));
  test('status is undefined when omitted', () => assert.strictEqual(seenFilters.status, undefined));
}

console.log('\n── GET /blueprints: repository failure degrades to 500 ─────');
{
  const handler = createGetBlueprintsHandler({
    listBlueprints: () => { throw new Error('db unavailable'); },
  });

  const res = mockRes();
  handler(mockReq('hash_owner'), res);

  test('responds 500, not a crash', () => assert.strictEqual(res.statusCode, 500));
  test('includes a generic error message, not the raw db error', () => {
    assert.strictEqual(res.body.error, 'Internal server error');
  });
}

console.log('\n── GET /blueprints/:id: success path ────────────────────────');
{
  const handler = createGetBlueprintDetailHandler({
    getBlueprintById: () => sampleBlueprintDetail,
  });

  const res = mockRes();
  handler(mockReq('hash_owner', { params: { id: '5' } }), res);

  test('responds 200', () => assert.strictEqual(res.statusCode, 200));
  test('returns the blueprint', () => assert.strictEqual(res.body.blueprint.id, 5));
  test('returns the persisted questions/weighting verbatim', () => {
    assert.strictEqual(res.body.blueprint.questions.length, 2);
    assert.strictEqual(res.body.blueprint.questions[0].maxMarks, 20);
  });
}

console.log('\n── GET /blueprints/:id: invalid id rejected ─────────────────');
{
  const handler = createGetBlueprintDetailHandler({ getBlueprintById: () => sampleBlueprintDetail });

  ['abc', '-1', '0', '3.5', ''].forEach((badId) => {
    const res = mockRes();
    handler(mockReq('hash_owner', { params: { id: badId } }), res);
    test(`rejects id="${badId}" with 400`, () => assert.strictEqual(res.statusCode, 400));
  });
}

console.log('\n── GET /blueprints/:id: not found -> 404 ────────────────────');
{
  const handler = createGetBlueprintDetailHandler({ getBlueprintById: () => null });

  const res = mockRes();
  handler(mockReq('hash_owner', { params: { id: '999' } }), res);

  test('responds 404 when getBlueprintById returns null', () => assert.strictEqual(res.statusCode, 404));
}

console.log('\n── GET /blueprints/:id: not owned by requesting teacher -> 404 (not 403) ──');
{
  const handler = createGetBlueprintDetailHandler({
    getBlueprintById: () => ({ ...sampleBlueprintDetail, phoneHash: 'hash_other_teacher' }),
  });

  const res = mockRes();
  handler(mockReq('hash_owner', { params: { id: '5' } }), res);

  test('responds 404, not 403, for another teacher\'s blueprint (matches the no-existence-oracle convention)', () => {
    assert.strictEqual(res.statusCode, 404);
  });
  test('does not leak the blueprint body', () => {
    assert.strictEqual(res.body.blueprint, undefined);
  });
}

console.log('\n── GET /blueprints/:id: repository failure degrades to 500 ──');
{
  const handler = createGetBlueprintDetailHandler({
    getBlueprintById: () => { throw new Error('db unavailable'); },
  });

  const res = mockRes();
  handler(mockReq('hash_owner', { params: { id: '5' } }), res);

  test('responds 500, not a crash', () => assert.strictEqual(res.statusCode, 500));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
