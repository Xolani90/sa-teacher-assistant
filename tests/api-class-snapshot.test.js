'use strict';
/**
 * GET /api/classes/:classId/snapshot tests (ADR-014).
 *
 * Covers:
 *   1. 200 success — resolves classInfo via getClass(classId, phoneHash),
 *      then passes it plus phoneHash/classId/options through to
 *      getClassSnapshot verbatim.
 *   2. 404 when getClass returns null (unknown class, or a class
 *      belonging to a different teacher — same response either way,
 *      matching api-class-detail.test.js).
 *   3. 400 for a non-positive-integer classId (missing, zero, negative,
 *      non-numeric).
 *   4. 500 passthrough if getClass throws. (getClassSnapshot itself is
 *      not expected to throw — classSnapshotService isolates its own
 *      section failures — so no 500 case is tested for it here.)
 *   5. ?subject= query param is forwarded into options.subject only when
 *      present and non-blank.
 *
 * Mocks only getClassSnapshot / getClass (injected directly, per
 * routes/api.js's DI convention) — no database required.
 *
 * Run individually: node tests/api-class-snapshot.test.js
 * Run via npm:       npm test
 */

const assert = require('assert');
const { createGetClassSnapshotHandler } = require('../routes/api').__testExports;

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

function mockReq(classId, query = {}, phoneHash = 'hash_owner') {
  return { teacher: { id: 1, phoneHash }, params: { classId }, query };
}

const sampleClassRecord = { id: 5, name: 'Grade 6 Mathematics', phone_hash: 'hash_owner' };

const sampleSnapshot = {
  class: { id: 5, name: 'Grade 6 Mathematics' },
  snapshot: {
    analytics: { status: 'ok', data: {}, error: null },
    intervention: { status: 'ok', data: {}, error: null },
    qms: { status: 'unavailable', data: null, error: null },
  },
  metadata: { generatedAt: '2026-08-01T00:00:00.000Z', partial: true, errors: [] },
};

console.log('\n── 200 success ────────────────────────────────────────────');
{
  test('resolves classInfo via getClass, then returns getClassSnapshot payload verbatim', () => {
    const handler = createGetClassSnapshotHandler({
      getClass: (classId, phoneHash) => {
        assert.strictEqual(classId, 5);
        assert.strictEqual(phoneHash, 'hash_owner');
        return sampleClassRecord;
      },
      getClassSnapshot: (phoneHash, classId, options, classInfo) => {
        assert.strictEqual(phoneHash, 'hash_owner');
        assert.strictEqual(classId, 5);
        assert.deepStrictEqual(options, {});
        assert.deepStrictEqual(classInfo, { name: 'Grade 6 Mathematics' });
        return sampleSnapshot;
      },
    });
    const res = mockRes();
    handler(mockReq('5'), res);
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body, sampleSnapshot);
  });

  test('forwards a non-blank ?subject= query param into options.subject', () => {
    const handler = createGetClassSnapshotHandler({
      getClass: () => sampleClassRecord,
      getClassSnapshot: (phoneHash, classId, options) => {
        assert.deepStrictEqual(options, { subject: 'Mathematics' });
        return sampleSnapshot;
      },
    });
    const res = mockRes();
    handler(mockReq('5', { subject: 'Mathematics' }), res);
    assert.strictEqual(res.statusCode, 200);
  });

  test('ignores a blank ?subject= query param', () => {
    const handler = createGetClassSnapshotHandler({
      getClass: () => sampleClassRecord,
      getClassSnapshot: (phoneHash, classId, options) => {
        assert.deepStrictEqual(options, {});
        return sampleSnapshot;
      },
    });
    const res = mockRes();
    handler(mockReq('5', { subject: '   ' }), res);
    assert.strictEqual(res.statusCode, 200);
  });
}

console.log('\n── 404 not found / not owned ────────────────────────────────');
{
  test('returns 404 when getClass returns null', () => {
    const handler = createGetClassSnapshotHandler({
      getClass: () => null,
      getClassSnapshot: () => { throw new Error('should not be called'); },
    });
    const res = mockRes();
    handler(mockReq('999'), res);
    assert.strictEqual(res.statusCode, 404);
    assert.deepStrictEqual(res.body, { error: 'Class not found.' });
  });
}

console.log('\n── 400 invalid classId ──────────────────────────────────────');
{
  const noopDeps = { getClass: () => sampleClassRecord, getClassSnapshot: () => sampleSnapshot };

  test('rejects a non-numeric classId', () => {
    const handler = createGetClassSnapshotHandler(noopDeps);
    const res = mockRes();
    handler(mockReq('abc'), res);
    assert.strictEqual(res.statusCode, 400);
  });

  test('rejects zero', () => {
    const handler = createGetClassSnapshotHandler(noopDeps);
    const res = mockRes();
    handler(mockReq('0'), res);
    assert.strictEqual(res.statusCode, 400);
  });

  test('rejects a negative classId', () => {
    const handler = createGetClassSnapshotHandler(noopDeps);
    const res = mockRes();
    handler(mockReq('-3'), res);
    assert.strictEqual(res.statusCode, 400);
  });

  test('rejects a non-integer classId', () => {
    const handler = createGetClassSnapshotHandler(noopDeps);
    const res = mockRes();
    handler(mockReq('5.5'), res);
    assert.strictEqual(res.statusCode, 400);
  });
}

console.log('\n── 500 passthrough ───────────────────────────────────────────');
{
  test('returns 500 if getClass throws', () => {
    const handler = createGetClassSnapshotHandler({
      getClass: () => { throw new Error('boom'); },
      getClassSnapshot: () => { throw new Error('should not be called'); },
    });
    const res = mockRes();
    handler(mockReq('5'), res);
    assert.strictEqual(res.statusCode, 500);
    assert.deepStrictEqual(res.body, { error: 'Internal server error' });
  });
}

console.log('\n' + '='.repeat(75));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
