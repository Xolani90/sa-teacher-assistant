'use strict';
/**
 * PATCH /api/observations/records/:recordId tests (Phase 6 continuation
 * — observation follow-up resolution).
 *
 * services/observationRepository.js#resolveObservationRecord already
 * existed, fully implemented and ownership-scoped, driving the WhatsApp
 * "RESOLVE" command, but had no HTTP route or Dashboard consumer —
 * ObservationDetail.jsx was read-only. A teacher reviewing a "Needs
 * follow-up" record on the Dashboard had no way to mark it resolved
 * without switching to WhatsApp. This is the Dashboard mirror, following
 * the same pattern as tests/api-learners-delete.test.js.
 *
 * Thin-route test only. resolveObservationRecord's own DB behaviour
 * (idempotency, per-record scoping) is exercised against the real
 * database in tests/observationRepository-corrections-delete-resolve.test.js;
 * this file only covers the handler's own branching: parsing, body
 * validation, ownership, and error passthrough.
 *
 * Covers:
 *   1. 200 with the record on success.
 *   2. 400 for a non-positive-integer recordId.
 *   3. 400 when the body isn't exactly { resolved: true }.
 *   4. 404 when resolveObservationRecord returns null (no such record).
 *   5. 404 when resolveObservationRecord throws the ownership error
 *      (record belongs to a different teacher).
 *   6. 500 passthrough for any other thrown error.
 *
 * Run individually: node tests/api-observations-resolve.test.js
 * Run via npm:       npm test
 */

const assert = require('assert');
const { createPatchObservationRecordHandler } = require('../routes/api').__testExports;

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

function mockReq(phoneHash, params, body) {
  return { teacher: { id: 1, phoneHash }, params, body };
}

console.log('\n📋 PATCH /api/observations/records/:recordId\n');

test('200 with the record on success', () => {
  const handler = createPatchObservationRecordHandler({
    resolveObservationRecord: () => ({ id: 9, resolved: true }),
  });
  const res = mockRes();
  handler(mockReq('hash_owner', { recordId: '9' }, { resolved: true }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { record: { id: 9, resolved: true } });
});

test('400 for a non-positive-integer recordId', () => {
  const handler = createPatchObservationRecordHandler({
    resolveObservationRecord: () => ({ id: 9, resolved: true }),
  });
  for (const bad of ['0', '-1', 'abc', '']) {
    const res = mockRes();
    handler(mockReq('hash_owner', { recordId: bad }, { resolved: true }), res);
    assert.strictEqual(res.statusCode, 400, `expected 400 for recordId=${JSON.stringify(bad)}`);
  }
});

test('400 when the body is not exactly { resolved: true }', () => {
  let called = false;
  const handler = createPatchObservationRecordHandler({
    resolveObservationRecord: () => { called = true; return { id: 9, resolved: true }; },
  });
  for (const badBody of [{}, { resolved: false }, { resolved: 'true' }, {}]) {
    const res = mockRes();
    handler(mockReq('hash_owner', { recordId: '9' }, badBody), res);
    assert.strictEqual(res.statusCode, 400, `expected 400 for body=${JSON.stringify(badBody)}`);
  }
  assert.strictEqual(called, false, 'resolveObservationRecord must not run for a malformed body');
});

test('404 when resolveObservationRecord returns null — no such record', () => {
  const handler = createPatchObservationRecordHandler({
    resolveObservationRecord: () => null,
  });
  const res = mockRes();
  handler(mockReq('hash_owner', { recordId: '999' }, { resolved: true }), res);
  assert.strictEqual(res.statusCode, 404);
});

test('404 when resolveObservationRecord throws the ownership error', () => {
  const handler = createPatchObservationRecordHandler({
    resolveObservationRecord: () => { throw new Error('resolveObservationRecord: record does not belong to this teacher'); },
  });
  const res = mockRes();
  handler(mockReq('hash_intruder', { recordId: '9' }, { resolved: true }), res);
  assert.strictEqual(res.statusCode, 404);
});

test('500 passthrough for any other thrown error', () => {
  const handler = createPatchObservationRecordHandler({
    resolveObservationRecord: () => { throw new Error('db exploded'); },
  });
  const res = mockRes();
  handler(mockReq('hash_owner', { recordId: '9' }, { resolved: true }), res);
  assert.strictEqual(res.statusCode, 500);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
