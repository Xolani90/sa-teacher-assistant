'use strict';
/**
 * Unit tests for utils/pdfTokenAuth.js (Cycle 46 audit).
 *
 * Finding fixed: the /pdf/:fileId route (server.js) compared the caller-
 * supplied token to the expected HMAC with plain `!==` instead of
 * crypto.timingSafeEqual — inconsistent with the same-purpose comparisons
 * already hardened elsewhere in this codebase (utils/adminAuth.js's shared
 * secret, utils/verifyWebhook.js's WhatsApp signature). This is pure,
 * DB-free logic — no database, no server, no better-sqlite3 — so it's
 * tested directly and deterministically, same convention as
 * tests/adminAuth.test.js.
 *
 * Run: node tests/pdfTokenAuth.test.js
 */

const path = require('path');
const crypto = require('crypto');
const { computePdfToken, verifyPdfToken } = require(path.resolve(__dirname, '../utils/pdfTokenAuth'));

let passed = 0;
let failed = 0;
function check(condition, label) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ FAIL: ${label}`); failed++; }
}

const SECRET = 'test-pdf-secret-do-not-use-in-prod';
const FILE_ID = 'abc123-file-id';

console.log('\n── computePdfToken / verifyPdfToken round-trip ─────────────────');
{
  const token = computePdfToken(FILE_ID, SECRET);
  check(typeof token === 'string' && token.length === 16, 'computePdfToken returns a 16-char hex string');
  check(verifyPdfToken(FILE_ID, token, SECRET) === true, 'a token computed for a fileId verifies successfully for that same fileId');
}

console.log('\n── Rejection cases (proves no entitlement/download without a valid token) ──');
{
  const token = computePdfToken(FILE_ID, SECRET);
  check(verifyPdfToken(FILE_ID, 'a'.repeat(16), SECRET) === false, 'a wrong-but-well-formed token is rejected');
  check(verifyPdfToken('different-file-id', token, SECRET) === false, 'a token computed for one fileId does not verify for a different fileId');
  check(verifyPdfToken(FILE_ID, token, 'wrong-secret') === false, 'a token verified against the wrong secret is rejected');
  check(verifyPdfToken(FILE_ID, token.slice(0, 15), SECRET) === false, 'a truncated token is rejected, not accepted as a length-mismatched partial match');
  check(verifyPdfToken(FILE_ID, token + 'a', SECRET) === false, 'a token with a trailing extra character is rejected');
}

console.log('\n── Non-string input is rejected cleanly, not thrown (Cycle 46 regression) ──');
{
  // Express's query parser can produce an array/object for a repeated or
  // bracketed query param (e.g. ?t[]=x&t[]=y). Buffer.from() throws on a
  // non-string, so verifyPdfToken must reject these before reaching the
  // comparison rather than letting the route 500.
  check(verifyPdfToken(FILE_ID, undefined, SECRET) === false, 'undefined token is rejected, not thrown');
  check(verifyPdfToken(FILE_ID, null, SECRET) === false, 'null token is rejected, not thrown');
  check(verifyPdfToken(FILE_ID, ['x', 'y'], SECRET) === false, 'array-shaped token (repeated query param) is rejected, not thrown');
  check(verifyPdfToken(FILE_ID, { foo: 'bar' }, SECRET) === false, 'object-shaped token is rejected, not thrown');
  check(verifyPdfToken(FILE_ID, 12345, SECRET) === false, 'numeric token is rejected, not thrown');
}

console.log('\n── Constant-time comparison is actually used (structural, not timed) ──');
{
  // Cycle 44 established the convention for protecting a security
  // invariant deterministically rather than with timed measurements:
  // spy on crypto.timingSafeEqual to prove verifyPdfToken's comparison
  // path actually calls it, rather than asserting on wall-clock timing
  // (nondeterministic and unsuitable for this suite).
  const original = crypto.timingSafeEqual;
  let called = false;
  crypto.timingSafeEqual = (...args) => {
    called = true;
    return original(...args);
  };
  const token = computePdfToken(FILE_ID, SECRET);
  const result = verifyPdfToken(FILE_ID, token, SECRET);
  crypto.timingSafeEqual = original;

  check(called, 'verifyPdfToken uses crypto.timingSafeEqual for the comparison');
  check(result === true, 'the verification result is still correct while spied on');
}

console.log('\n─────────────────────────────────');
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📊 Total:  ${passed + failed}`);
console.log('─────────────────────────────────\n');

process.exit(failed > 0 ? 1 : 0);
