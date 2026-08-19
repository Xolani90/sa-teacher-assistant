'use strict';
/**
 * Runtime unit tests for utils/adminAuth.js's requireAdminSecret() middleware
 * (RC1 Phase B Security, Row 7).
 *
 * requireAdminSecret reads process.env.ADMIN_SECRET at invocation time (not
 * require-time — the module only defines the function at load time; the
 * env lookup happens inside the function body on each call), so no
 * process.env caching concern applies here. Each case below still sets
 * process.env.ADMIN_SECRET explicitly immediately before invoking the
 * middleware and deletes it immediately after, so no case can leak its
 * value into a later case.
 *
 * This is middleware unit testing: req/res/next are lightweight mocks
 * (no Express, no HTTP, no server, no database). The middleware itself —
 * utils/adminAuth.js — is loaded and executed for real, unmocked, and
 * crypto.timingSafeEqual is never mocked or stubbed.
 *
 * Run individually: node tests/adminAuth.test.js
 */

const path = require('path');
const { requireAdminSecret } = require(path.resolve(__dirname, '../utils/adminAuth'));

// ── Mock req/res/next helpers ───────────────────────────────────────────
function makeReq(authHeader) {
  const headers = {};
  if (authHeader !== undefined) headers['authorization'] = authHeader;
  return { headers };
}

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

function makeNext() {
  const calls = [];
  const next = (...args) => calls.push(args);
  next.calls = calls;
  return next;
}

// ── Environment isolation helper ────────────────────────────────────────
// Explicitly sets or deletes ADMIN_SECRET around a single invocation so no
// case can be affected by a value left over from a previous case.
function withAdminSecret(value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'ADMIN_SECRET');
  const prior = process.env.ADMIN_SECRET;
  if (value === undefined) {
    delete process.env.ADMIN_SECRET;
  } else {
    process.env.ADMIN_SECRET = value;
  }
  try {
    return fn();
  } finally {
    if (had) {
      process.env.ADMIN_SECRET = prior;
    } else {
      delete process.env.ADMIN_SECRET;
    }
  }
}

const results = [];
function check(name, condition, detail) {
  if (condition) {
    console.log(`PASS: ${name}`);
    results.push(true);
  } else {
    console.error(`FAIL: ${name}${detail ? ' — ' + detail : ''}`);
    results.push(false);
  }
}

console.log('=== requireAdminSecret runtime unit tests ===\n');

// 1. ADMIN_SECRET absent → 500, Server misconfiguration, no next()
withAdminSecret(undefined, () => {
  const req = makeReq('anything');
  const res = makeRes();
  const next = makeNext();
  requireAdminSecret(req, res, next);
  check(
    'ADMIN_SECRET absent → 500 + Server misconfiguration, next() not called',
    res.statusCode === 500 &&
      res.body &&
      res.body.error === 'Server misconfiguration' &&
      next.calls.length === 0,
    `status=${res.statusCode} body=${JSON.stringify(res.body)} nextCalls=${next.calls.length}`
  );
});

// 2. ADMIN_SECRET configured + Authorization header absent → 401, Unauthorized, no next()
withAdminSecret('correct-admin-secret-value', () => {
  const req = makeReq(undefined);
  const res = makeRes();
  const next = makeNext();
  requireAdminSecret(req, res, next);
  check(
    'header absent → 401 + Unauthorized, next() not called',
    res.statusCode === 401 &&
      res.body &&
      res.body.error === 'Unauthorized' &&
      next.calls.length === 0,
    `status=${res.statusCode} body=${JSON.stringify(res.body)} nextCalls=${next.calls.length}`
  );
});

// 3. ADMIN_SECRET configured + wrong credential, SAME length → 401, no next()
//    Exercises the real timingSafeEqual comparison path (equal lengths).
withAdminSecret('correct-admin-secret-value', () => {
  const realSecret = 'correct-admin-secret-value';
  // Build a same-length wrong value programmatically (rotate each char by
  // one) rather than hand-typing a string whose length must be kept in
  // sync by eye — guarantees length equality without a brittle literal.
  const wrongSameLength = realSecret
    .split('')
    .map(c => String.fromCharCode(c.charCodeAt(0) + 1))
    .join('');
  if (wrongSameLength.length !== realSecret.length) {
    throw new Error('test setup error: same-length fixture does not match real secret length');
  }
  if (wrongSameLength === realSecret) {
    throw new Error('test setup error: same-length fixture is identical to the real secret');
  }
  const req = makeReq(wrongSameLength);
  const res = makeRes();
  const next = makeNext();
  requireAdminSecret(req, res, next);
  check(
    'wrong credential, same length → 401, next() not called (real timingSafeEqual path)',
    res.statusCode === 401 && next.calls.length === 0,
    `status=${res.statusCode} nextCalls=${next.calls.length}`
  );
});

// 4. ADMIN_SECRET configured + wrong credential, DIFFERENT length → 401, no crash, no next()
//    Exercises the length-check branch that must short-circuit before
//    calling crypto.timingSafeEqual (which throws on mismatched-length buffers).
withAdminSecret('correct-admin-secret-value', () => {
  const req = makeReq('short');
  const res = makeRes();
  const next = makeNext();
  let threw = false;
  try {
    requireAdminSecret(req, res, next);
  } catch (e) {
    threw = true;
  }
  check(
    'wrong credential, different length → 401, no throw, next() not called',
    !threw && res.statusCode === 401 && next.calls.length === 0,
    `threw=${threw} status=${res.statusCode} nextCalls=${next.calls.length}`
  );
});

// 5. ADMIN_SECRET configured + exact correct credential → next() called exactly once, no response sent
withAdminSecret('correct-admin-secret-value', () => {
  const req = makeReq('correct-admin-secret-value');
  const res = makeRes();
  const next = makeNext();
  requireAdminSecret(req, res, next);
  check(
    'correct credential → next() called exactly once, no response sent',
    next.calls.length === 1 && res.statusCode === null && res.body === null,
    `nextCalls=${next.calls.length} status=${res.statusCode} body=${JSON.stringify(res.body)}`
  );
});

const passed = results.filter(Boolean).length;
const total = results.length;
console.log(`\n=== Results: ${passed}/${total} tests passed ===`);

if (passed === total) {
  console.log('All tests passed!');
  process.exit(0);
} else {
  console.log('Some tests failed.');
  process.exit(1);
}
