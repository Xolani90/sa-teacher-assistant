'use strict';
/**
 * POST/PATCH/DELETE /api/reflections tests — Reflection Editing.
 *
 * Thin-route tests only, mirroring tests/api-observations.test.js's
 * style. reflectionService.js's create/update/deleteReflection are
 * already tested in tests/reflectionService.test.js and are NOT
 * re-tested here — this file only proves the routes wire
 * phoneHash/body/params through correctly, map service validation
 * errors to 400, map null/false returns to 404, and degrade safely
 * on unexpected failures.
 *
 * Run individually: node tests/api-reflections-write.test.js
 * Run via npm:       npm test
 */

const assert = require('assert');
const {
  createPostReflectionHandler,
  createPatchReflectionHandler,
  createDeleteReflectionHandler,
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

function mockReq(phoneHash = 'hash_owner', { body = {}, params = {} } = {}) {
  return { teacher: { id: 1, phoneHash }, body, params };
}

const sampleReflection = {
  id: 5,
  phoneHash: 'hash_owner',
  term: 2,
  content: 'Went well overall.',
  aiAssisted: false,
  evidenceLinkIds: [],
  createdAt: '2026-07-01 08:00:00',
  updatedAt: '2026-07-01 08:00:00',
};

console.log('\n── POST /reflections: success path ───────────────────────');
{
  const handler = createPostReflectionHandler({
    createReflection: (phoneHash, params) => ({ ...sampleReflection, phoneHash, content: params.content }),
  });

  const req = mockReq('hash_owner', { body: { content: 'Great lesson today.' } });
  const res = mockRes();
  handler(req, res);

  test('responds 201', () => assert.strictEqual(res.statusCode, 201));
  test('returns the created reflection', () => assert.strictEqual(res.body.reflection.content, 'Great lesson today.'));
}

console.log('\n── POST /reflections: phoneHash passed through unchanged ──');
{
  let seenPhoneHash = null;
  const handler = createPostReflectionHandler({
    createReflection: (phoneHash) => { seenPhoneHash = phoneHash; return sampleReflection; },
  });

  handler(mockReq('hash_specific_teacher', { body: { content: 'x' } }), mockRes());

  test('req.teacher.phoneHash is passed through to createReflection unchanged', () => {
    assert.strictEqual(seenPhoneHash, 'hash_specific_teacher');
  });
}

console.log('\n── POST /reflections: service validation error maps to 400 ─');
{
  const handler = createPostReflectionHandler({
    createReflection: () => { throw new Error('createReflection: content is required'); },
  });

  const res = mockRes();
  handler(mockReq('hash_owner', { body: {} }), res);

  test('responds 400 for a createReflection validation error', () => assert.strictEqual(res.statusCode, 400));
  test('surfaces the service error message', () => {
    assert.strictEqual(res.body.error, 'createReflection: content is required');
  });
}

console.log('\n── POST /reflections: unexpected failure degrades to 500 ──');
{
  const handler = createPostReflectionHandler({
    createReflection: () => { throw new Error('db unavailable'); },
  });

  const res = mockRes();
  handler(mockReq('hash_owner', { body: { content: 'x' } }), res);

  test('non-validation errors degrade to 500, not a crash', () => assert.strictEqual(res.statusCode, 500));
  test('includes a generic error message, not the raw db error', () => {
    assert.strictEqual(res.body.error, 'Internal server error');
  });
}

console.log('\n── PATCH /reflections/:id: success path ──────────────────');
{
  const handler = createPatchReflectionHandler({
    updateReflection: (phoneHash, id, params) => ({ ...sampleReflection, id, content: params.content }),
  });

  const req = mockReq('hash_owner', { body: { content: 'Updated text.' }, params: { id: '5' } });
  const res = mockRes();
  handler(req, res);

  test('responds 200', () => assert.strictEqual(res.statusCode, 200));
  test('returns the updated reflection', () => assert.strictEqual(res.body.reflection.content, 'Updated text.'));
}

console.log('\n── PATCH /reflections/:id: invalid id rejected ────────────');
{
  const handler = createPatchReflectionHandler({ updateReflection: () => sampleReflection });

  ['abc', '-1', '0', '3.5', ''].forEach((badId) => {
    const res = mockRes();
    handler(mockReq('hash_owner', { body: { content: 'x' }, params: { id: badId } }), res);
    test(`rejects id="${badId}" with 400`, () => assert.strictEqual(res.statusCode, 400));
  });
}

console.log('\n── PATCH /reflections/:id: not found / not owned -> 404 ───');
{
  const handler = createPatchReflectionHandler({ updateReflection: () => null });

  const res = mockRes();
  handler(mockReq('hash_owner', { body: { content: 'x' }, params: { id: '999' } }), res);

  test('responds 404 when updateReflection returns null', () => assert.strictEqual(res.statusCode, 404));
}

console.log('\n── PATCH /reflections/:id: service validation error maps to 400 ──');
{
  const handler = createPatchReflectionHandler({
    updateReflection: () => { throw new Error('updateReflection: content cannot be empty'); },
  });

  const res = mockRes();
  handler(mockReq('hash_owner', { body: { content: '' }, params: { id: '5' } }), res);

  test('responds 400 for an updateReflection validation error', () => assert.strictEqual(res.statusCode, 400));
}

console.log('\n── PATCH /reflections/:id: unexpected failure degrades to 500 ─');
{
  const handler = createPatchReflectionHandler({
    updateReflection: () => { throw new Error('db unavailable'); },
  });

  const res = mockRes();
  handler(mockReq('hash_owner', { body: { content: 'x' }, params: { id: '5' } }), res);

  test('non-validation errors degrade to 500, not a crash', () => assert.strictEqual(res.statusCode, 500));
}

console.log('\n── DELETE /reflections/:id: success path ──────────────────');
{
  const handler = createDeleteReflectionHandler({ deleteReflection: () => true });

  const res = mockRes();
  handler(mockReq('hash_owner', { params: { id: '5' } }), res);

  test('responds 204', () => assert.strictEqual(res.statusCode, 204));
  test('sends no body', () => assert.strictEqual(res.sent, true));
}

console.log('\n── DELETE /reflections/:id: invalid id rejected ───────────');
{
  const handler = createDeleteReflectionHandler({ deleteReflection: () => true });

  ['abc', '-1', '0'].forEach((badId) => {
    const res = mockRes();
    handler(mockReq('hash_owner', { params: { id: badId } }), res);
    test(`rejects id="${badId}" with 400`, () => assert.strictEqual(res.statusCode, 400));
  });
}

console.log('\n── DELETE /reflections/:id: not found / not owned / already deleted -> 404 ──');
{
  const handler = createDeleteReflectionHandler({ deleteReflection: () => false });

  const res = mockRes();
  handler(mockReq('hash_owner', { params: { id: '999' } }), res);

  test('responds 404 when deleteReflection returns false', () => assert.strictEqual(res.statusCode, 404));
}

console.log('\n── DELETE /reflections/:id: dependency failure degrades to 500 ──');
{
  const handler = createDeleteReflectionHandler({
    deleteReflection: () => { throw new Error('db unavailable'); },
  });

  const res = mockRes();
  handler(mockReq('hash_owner', { params: { id: '5' } }), res);

  test('deleteReflection throwing degrades to 500, not a crash', () => assert.strictEqual(res.statusCode, 500));
}

console.log('\n── phoneHash scoping — PATCH and DELETE both pass it through unchanged ──');
{
  let patchPhoneHash = null;
  const patchHandler = createPatchReflectionHandler({
    updateReflection: (phoneHash) => { patchPhoneHash = phoneHash; return sampleReflection; },
  });
  patchHandler(mockReq('hash_specific_teacher', { body: { content: 'x' }, params: { id: '5' } }), mockRes());
  test('PATCH passes req.teacher.phoneHash through unchanged', () => {
    assert.strictEqual(patchPhoneHash, 'hash_specific_teacher');
  });

  let deletePhoneHash = null;
  const deleteHandler = createDeleteReflectionHandler({
    deleteReflection: (phoneHash) => { deletePhoneHash = phoneHash; return true; },
  });
  deleteHandler(mockReq('hash_specific_teacher', { params: { id: '5' } }), mockRes());
  test('DELETE passes req.teacher.phoneHash through unchanged', () => {
    assert.strictEqual(deletePhoneHash, 'hash_specific_teacher');
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
