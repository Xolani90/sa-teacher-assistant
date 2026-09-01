'use strict';
/**
 * GET /api/resources and GET /api/resources/:id tests — dashboard
 * lesson-plan/homework retrieval (Feature 2 dashboard integration).
 *
 * Thin-route test only, mirroring tests/api-observations.test.js's
 * style. getSavedResources/getSavedResource themselves
 * (services/teacherWorkspaceService.js) are already tested elsewhere
 * (tests/workspace.test.js) and are NOT re-tested here — this file only
 * proves the routes wire phoneHash/params through correctly, shape the
 * response (including parsing metadata.homework), and degrade safely on
 * failure. Cross-teacher ownership enforcement against the REAL database
 * query (not a mock) is covered separately in
 * tests/resources-dashboard-e2e.test.js.
 *
 * Covers:
 *   1. GET /resources — 200 success, list shape, req.teacher.phoneHash
 *      passed through unchanged, resourceType/grade/subject query
 *      params mapped into filters correctly.
 *   2. GET /resources — 200 with `resources: []` for a teacher with none.
 *   3. GET /resources — 500 passthrough if getSavedResources throws.
 *   4. GET /resources/:id — 200 success, full detail shape including
 *      homework parsed from the metadata JSON column.
 *   5. GET /resources/:id — homework is null for a non-lessonPlan
 *      resource, and for a lessonPlan row saved before Feature 2 (no
 *      metadata.homework key at all).
 *   6. GET /resources/:id — 400 for a non-positive-integer id.
 *   7. GET /resources/:id — 404 when getSavedResource returns null
 *      (covers both "doesn't exist" and "belongs to another teacher" —
 *      the service itself can't distinguish them by design).
 *   8. GET /resources/:id — 500 passthrough if getSavedResource throws.
 *
 * Mocks getSavedResources/getSavedResource directly (injected per
 * routes/api.js's DI convention) — no database required.
 *
 * Run individually: node tests/api-resources.test.js
 * Run via npm:       npm test
 */

const assert = require('assert');
const { createGetResourcesHandler, createGetResourceDetailHandler } = require('../routes/api').__testExports;

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

function mockReq(phoneHash = 'hash_owner', query = {}, params = {}) {
  return { teacher: { id: 1, phoneHash }, query, params };
}

const sampleResources = [
  {
    id: 5,
    phone_hash: 'hash_owner',
    resource_type: 'lessonPlan',
    title: 'Grade 7 Mathematics — Fractions',
    content: '*LESSON PLAN...*',
    grade: 7,
    subject: 'Mathematics',
    topic: 'Fractions',
    metadata: JSON.stringify({ term: 2, atpTopic: true, homework: 'Complete Ex 4B questions 1-10.' }),
    created_at: '2026-08-01 09:00:00',
  },
  {
    id: 6,
    phone_hash: 'hash_owner',
    resource_type: 'worksheet',
    title: 'Grade 7 worksheet',
    content: '...',
    grade: 7,
    subject: 'Mathematics',
    topic: 'Fractions',
    metadata: JSON.stringify({ grade: 7 }),
    created_at: '2026-08-02 09:00:00',
  },
];

console.log('\n── Section 1: GET /resources — success path ─────────────');
{
  const handler = createGetResourcesHandler({
    getSavedResources: (phoneHash) => (phoneHash === 'hash_owner' ? sampleResources : []),
  });
  const req = mockReq('hash_owner');
  const res = mockRes();
  handler(req, res);

  test('returns 200', () => assert.strictEqual(res.statusCode, 200));
  test('returns both resources', () => assert.strictEqual(res.body.resources.length, 2));
  test('list item uses camelCase resourceType', () => assert.strictEqual(res.body.resources[0].resourceType, 'lessonPlan'));
  test('list item does NOT include full content', () => assert.strictEqual(res.body.resources[0].content, undefined));
  test('list item does NOT include homework (list is lightweight)', () => assert.strictEqual(res.body.resources[0].homework, undefined));
}

console.log('\n── Section 2: GET /resources — empty + phoneHash scoping ─');
{
  const handler = createGetResourcesHandler({
    getSavedResources: (phoneHash) => (phoneHash === 'hash_owner' ? sampleResources : []),
  });
  const req = mockReq('hash_other_teacher');
  const res = mockRes();
  handler(req, res);

  test('returns 200 for a teacher with none', () => assert.strictEqual(res.statusCode, 200));
  test('returns empty array, not an error', () => assert.deepStrictEqual(res.body.resources, []));
}

console.log('\n── Section 3: GET /resources — filters mapped correctly ──');
{
  let capturedPhoneHash, capturedFilters;
  const handler = createGetResourcesHandler({
    getSavedResources: (phoneHash, filters) => {
      capturedPhoneHash = phoneHash;
      capturedFilters = filters;
      return [];
    },
  });
  const req = mockReq('hash_owner', { resourceType: 'lessonPlan', grade: '7', subject: 'Mathematics' });
  handler(req, mockRes());

  test('phoneHash passed through from req.teacher, not query/body', () => assert.strictEqual(capturedPhoneHash, 'hash_owner'));
  test('resourceType query param mapped', () => assert.strictEqual(capturedFilters.resourceType, 'lessonPlan'));
  test('grade query param coerced to number', () => assert.strictEqual(capturedFilters.grade, 7));
  test('subject query param mapped', () => assert.strictEqual(capturedFilters.subject, 'Mathematics'));
}

console.log('\n── Section 4: GET /resources — 500 passthrough ───────────');
{
  const handler = createGetResourcesHandler({
    getSavedResources: () => { throw new Error('db exploded'); },
  });
  const res = mockRes();
  handler(mockReq(), res);

  test('returns 500 on service throw', () => assert.strictEqual(res.statusCode, 500));
  test('does not leak the raw error message', () => assert.strictEqual(res.body.error, 'Internal server error'));
}

console.log('\n── Section 5: GET /resources/:id — success + homework ────');
{
  const handler = createGetResourceDetailHandler({
    getSavedResource: (id, phoneHash) =>
      (id === 5 && phoneHash === 'hash_owner') ? sampleResources[0] : null,
  });
  const req = mockReq('hash_owner', {}, { id: '5' });
  const res = mockRes();
  handler(req, res);

  test('returns 200', () => assert.strictEqual(res.statusCode, 200));
  test('includes full content', () => assert.strictEqual(res.body.content, '*LESSON PLAN...*'));
  test('includes the exact persisted homework text', () =>
    assert.strictEqual(res.body.homework, 'Complete Ex 4B questions 1-10.'));
  test('includes term from metadata', () => assert.strictEqual(res.body.term, 2));
  test('includes grade/subject/topic', () => {
    assert.strictEqual(res.body.grade, 7);
    assert.strictEqual(res.body.subject, 'Mathematics');
    assert.strictEqual(res.body.topic, 'Fractions');
  });
  test('includes createdAt', () => assert.strictEqual(res.body.createdAt, '2026-08-01 09:00:00'));
}

console.log('\n── Section 6: GET /resources/:id — homework is null when absent ──');
{
  const handler = createGetResourceDetailHandler({
    getSavedResource: () => sampleResources[1], // worksheet, no homework key in metadata
  });
  const res = mockRes();
  handler(mockReq('hash_owner', {}, { id: '6' }), res);

  test('homework is null for a non-lessonPlan resource', () => assert.strictEqual(res.body.homework, null));
}
{
  const preFeature2Row = {
    ...sampleResources[0],
    metadata: JSON.stringify({ term: 2 }), // no homework key — pre-Feature-2 row
  };
  const handler = createGetResourceDetailHandler({ getSavedResource: () => preFeature2Row });
  const res = mockRes();
  handler(mockReq('hash_owner', {}, { id: '5' }), res);

  test('homework is null (not a crash) for a lesson plan saved before Feature 2', () =>
    assert.strictEqual(res.body.homework, null));
}
{
  const malformedMetadataRow = { ...sampleResources[0], metadata: 'not valid json{' };
  const handler = createGetResourceDetailHandler({ getSavedResource: () => malformedMetadataRow });
  const res = mockRes();
  handler(mockReq('hash_owner', {}, { id: '5' }), res);

  test('malformed metadata degrades to null homework rather than 500ing', () => {
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.homework, null);
  });
}

console.log('\n── Section 7: GET /resources/:id — validation ────────────');
{
  const handler = createGetResourceDetailHandler({ getSavedResource: () => sampleResources[0] });

  const res1 = mockRes();
  handler(mockReq('hash_owner', {}, { id: 'abc' }), res1);
  test('non-numeric id -> 400', () => assert.strictEqual(res1.statusCode, 400));

  const res2 = mockRes();
  handler(mockReq('hash_owner', {}, { id: '-1' }), res2);
  test('negative id -> 400', () => assert.strictEqual(res2.statusCode, 400));

  const res3 = mockRes();
  handler(mockReq('hash_owner', {}, { id: '0' }), res3);
  test('zero id -> 400', () => assert.strictEqual(res3.statusCode, 400));
}

console.log('\n── Section 8: GET /resources/:id — 404 (missing OR wrong owner, identical) ──');
{
  const handler = createGetResourceDetailHandler({
    // Mirrors the real service: returns null for both "doesn't exist"
    // and "exists but belongs to someone else" — the route can't and
    // shouldn't distinguish them in its response.
    getSavedResource: (id, phoneHash) => (id === 5 && phoneHash === 'hash_owner') ? sampleResources[0] : null,
  });

  const resMissing = mockRes();
  handler(mockReq('hash_owner', {}, { id: '999' }), resMissing);
  test('nonexistent id -> 404', () => assert.strictEqual(resMissing.statusCode, 404));

  const resWrongOwner = mockRes();
  handler(mockReq('hash_intruder', {}, { id: '5' }), resWrongOwner);
  test('correct id but wrong teacher -> 404 (Teacher B cannot read Teacher A\'s lesson plan)', () =>
    assert.strictEqual(resWrongOwner.statusCode, 404));
  test('the two 404s are byte-identical (no existence oracle)', () =>
    assert.deepStrictEqual(resMissing.body, resWrongOwner.body));
}

console.log('\n── Section 9: GET /resources/:id — 500 passthrough ───────');
{
  const handler = createGetResourceDetailHandler({
    getSavedResource: () => { throw new Error('db exploded'); },
  });
  const res = mockRes();
  handler(mockReq('hash_owner', {}, { id: '5' }), res);

  test('returns 500 on service throw', () => assert.strictEqual(res.statusCode, 500));
}

console.log(`\n📊 Total:  ${passed + failed}`);
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
