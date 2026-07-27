'use strict';
/**
 * POST /api/auth/login tests (ADR-008 PR21 — JWT issuance, the missing
 * half of ADR-008 alongside PR16's requireTeacherAuth).
 *
 * Covers:
 *   1. 200 success — valid identity returns a signed JWT + response contract.
 *   2. Signed token's `sub` claim matches teacher.id, expiry is 1h (3600s).
 *   3. identityVerifier returning null/falsy -> generic 401.
 *   4. identityVerifier throwing -> generic 401 (not a 500 — "identity not
 *      proven" is a normal outcome, not a server error).
 *   5. TEACHER_JWT_SECRET unset -> 500.
 *   6. Response shape — accessToken/tokenType/expiresIn/teacher{id,name} only.
 *
 * Mocks only identityVerifier (injected directly, per routes/api.js's DI
 * convention, mirrored here) — no database required.
 *
 * Run individually: node tests/auth-login.test.js
 * Run via npm:       npm test
 */

const assert = require('assert');
const jwt = require('jsonwebtoken');
const { createLoginHandler } = require('../routes/auth').__testExports;

const TEST_SECRET = 'test-secret-for-auth-login';

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

function mockReq(body = {}) {
  return { body };
}

function withSecret(secret, fn) {
  const original = process.env.TEACHER_JWT_SECRET;
  if (secret === undefined) delete process.env.TEACHER_JWT_SECRET;
  else process.env.TEACHER_JWT_SECRET = secret;
  try {
    fn();
  } finally {
    if (original === undefined) delete process.env.TEACHER_JWT_SECRET;
    else process.env.TEACHER_JWT_SECRET = original;
  }
}

console.log('\n── Section 1: success path ──────────────────────────────');
withSecret(TEST_SECRET, () => {
  const handler = createLoginHandler({
    identityVerifier: () => ({ id: 17, name: 'Jane Smith' }),
  });

  const req = mockReq({ teacherId: 17 });
  const res = mockRes();
  handler(req, res);

  test('responds 200', () => assert.strictEqual(res.statusCode, 200));
  test('response includes accessToken', () => assert.ok(res.body.accessToken));
  test('tokenType is Bearer', () => assert.strictEqual(res.body.tokenType, 'Bearer'));
  test('expiresIn is 3600 (1 hour, in seconds)', () => assert.strictEqual(res.body.expiresIn, 3600));
  test('teacher.id matches verified identity', () => assert.strictEqual(res.body.teacher.id, 17));
  test('teacher.name matches verified identity', () => assert.strictEqual(res.body.teacher.name, 'Jane Smith'));
});

console.log('\n── Section 2: issued token contents ──────────────────────');
withSecret(TEST_SECRET, () => {
  const handler = createLoginHandler({
    identityVerifier: () => ({ id: 42, name: null }),
  });

  const req = mockReq({ teacherId: 42 });
  const res = mockRes();
  handler(req, res);

  const decoded = jwt.verify(res.body.accessToken, TEST_SECRET);

  test('token sub claim equals teacher.id', () => assert.strictEqual(decoded.sub, 42));
  test('token has an exp claim roughly 1 hour out', () => {
    const secondsUntilExpiry = decoded.exp - decoded.iat;
    assert.strictEqual(secondsUntilExpiry, 3600);
  });
  test('teacher.name is null when verifier returns no name', () => assert.strictEqual(res.body.teacher.name, null));
});

console.log('\n── Section 3: identityVerifier returns falsy -> 401 ──────');
withSecret(TEST_SECRET, () => {
  const handler = createLoginHandler({
    identityVerifier: () => null,
  });

  const req = mockReq({ teacherId: 999 });
  const res = mockRes();
  handler(req, res);

  test('responds 401', () => assert.strictEqual(res.statusCode, 401));
  test('generic error body (no leaked detail)', () => assert.deepStrictEqual(res.body, { error: 'Unauthorized' }));
});

console.log('\n── Section 4: identityVerifier throws -> 401, not 500 ────');
withSecret(TEST_SECRET, () => {
  const handler = createLoginHandler({
    identityVerifier: () => { throw new Error('verification backend unreachable'); },
  });

  const req = mockReq({ teacherId: 1 });
  const res = mockRes();
  handler(req, res);

  test('responds 401 (identity-not-proven is not a server error)', () => assert.strictEqual(res.statusCode, 401));
  test('generic error body, no exception message leaked', () => assert.deepStrictEqual(res.body, { error: 'Unauthorized' }));
});

console.log('\n── Section 5: TEACHER_JWT_SECRET unset -> 500 ────────────');
withSecret(undefined, () => {
  const handler = createLoginHandler({
    identityVerifier: () => ({ id: 1, name: 'Someone' }),
  });

  const req = mockReq({ teacherId: 1 });
  const res = mockRes();
  handler(req, res);

  test('responds 500 when TEACHER_JWT_SECRET is not configured', () => assert.strictEqual(res.statusCode, 500));
  test('does not attempt to sign or return a token', () => assert.strictEqual(res.body.accessToken, undefined));
});

console.log('\n── Section 6: identityVerifier returns malformed identity -> 401 ──');
withSecret(TEST_SECRET, () => {
  const handler = createLoginHandler({
    identityVerifier: () => ({ id: 'not-a-number', name: 'Bad' }),
  });

  const req = mockReq({ teacherId: 1 });
  const res = mockRes();
  handler(req, res);

  test('non-integer id is rejected with 401', () => assert.strictEqual(res.statusCode, 401));
});

console.log('\n── Section 7: response shape — exactly the documented fields ─');
withSecret(TEST_SECRET, () => {
  const handler = createLoginHandler({
    identityVerifier: () => ({ id: 5, name: 'Thabo Mokoena' }),
  });

  const req = mockReq({ teacherId: 5 });
  const res = mockRes();
  handler(req, res);

  test('top-level response has exactly the documented keys', () => {
    assert.deepStrictEqual(
      Object.keys(res.body).sort(),
      ['accessToken', 'expiresIn', 'teacher', 'tokenType']
    );
  });
  test('teacher object has exactly id and name', () => {
    assert.deepStrictEqual(Object.keys(res.body.teacher).sort(), ['id', 'name']);
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
