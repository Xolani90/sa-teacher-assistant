'use strict';

/**
 * Token verification for the /pdf/:fileId download route (Cycle 46 audit).
 *
 * Extracted out of server.js's inline route handler for the same reason
 * utils/adminAuth.js was: server.js calls app.listen() at module-load
 * time and so can never be required into a test process (see
 * utils/adminAuth.js's own header comment on this constraint) — putting
 * the actual comparison logic in a plain, DB-free, side-effect-free
 * function makes it directly unit-testable without spawning a real
 * server or touching SQLite at all.
 *
 * Cycle 46 finding this replaces: the inline route previously compared
 * the query-string token to the expected HMAC with plain `!==`, unlike
 * every other same-purpose comparison in this codebase (the admin shared
 * secret in utils/adminAuth.js, the WhatsApp webhook signature in
 * utils/verifyWebhook.js — both already use crypto.timingSafeEqual).
 * `t` here is fully attacker-controlled and compared directly against a
 * server-computed secret-derived value, so a non-constant-time compare
 * is exactly the shape a timing side-channel applies to.
 */

const crypto = require('crypto');

/**
 * Computes the expected token for a given fileId.
 *
 * @param {string} fileId
 * @param {string} secret - process.env.PDF_SECRET
 * @returns {string} 16-hex-char truncated HMAC-SHA256
 */
function computePdfToken(fileId, secret) {
  return crypto.createHmac('sha256', secret).update(fileId).digest('hex').slice(0, 16);
}

/**
 * Verifies a caller-supplied PDF download token in constant time.
 *
 * @param {string} fileId
 * @param {unknown} suppliedToken - req.query.t, of unknown/untrusted shape
 * @param {string} secret - process.env.PDF_SECRET
 * @returns {boolean}
 */
function verifyPdfToken(fileId, suppliedToken, secret) {
  // Express's query parser can produce an array/object for a repeated or
  // bracketed query param (e.g. ?t[]=x&t[]=y) — Buffer.from() throws on
  // those rather than failing closed, so a non-string is rejected here
  // before ever reaching the comparison.
  if (typeof suppliedToken !== 'string') return false;

  const expected = computePdfToken(fileId, secret);
  const suppliedBuf = Buffer.from(suppliedToken);
  const expectedBuf = Buffer.from(expected);

  return suppliedBuf.length === expectedBuf.length && crypto.timingSafeEqual(suppliedBuf, expectedBuf);
}

module.exports = { computePdfToken, verifyPdfToken };
