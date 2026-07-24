'use strict';

// ── Yoco webhook signature verifier ─────────────────────────────────────────
// Pure function extracted from server.js's POST /payment/webhook handler.
// No Express, no DB, no I/O — takes headers/rawBody/secret/now in, returns
// a { valid, reason } verdict out. This is what makes the six rejection
// branches unit-testable in milliseconds instead of via a live HTTP server.
//
// Reason codes (mirror the console.warn/error reasons in server.js):
//   'missing_secret'   — YOCO_WEBHOOK_SECRET not set
//   'malformed_secret' — secret missing whsec_ prefix, or decodes to empty bytes
//   'missing_headers'  — webhook-id / webhook-timestamp / webhook-signature absent
//   'replay_attack'    — timestamp outside the 3-minute window
//   'invalid_signature'— HMAC does not match any provided signature
//   null                — valid: true

const crypto = require('crypto');

const REPLAY_WINDOW_SECONDS = 180;

function verifyYocoWebhook({ headers = {}, rawBody, secret, now = Date.now() }) {
  const webhookId        = headers['webhook-id'];
  const webhookTimestamp = headers['webhook-timestamp'];
  const webhookSignature = headers['webhook-signature'];

  if (!secret) {
    return { valid: false, reason: 'missing_secret' };
  }
  if (!secret.startsWith('whsec_')) {
    return { valid: false, reason: 'malformed_secret' };
  }
  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return { valid: false, reason: 'missing_headers' };
  }

  const tsSeconds = parseInt(webhookTimestamp, 10);
  if (!Number.isFinite(tsSeconds) || Math.abs(now / 1000 - tsSeconds) > REPLAY_WINDOW_SECONDS) {
    return { valid: false, reason: 'replay_attack' };
  }

  const rawBodyStr    = Buffer.isBuffer(rawBody) ? rawBody.toString() : String(rawBody ?? '');
  const signedContent = `${webhookId}.${webhookTimestamp}.${rawBodyStr}`;
  const encodedSecret = secret.slice('whsec_'.length);
  const secretBytes   = Buffer.from(encodedSecret, 'base64');

  if (secretBytes.length === 0) {
    return { valid: false, reason: 'malformed_secret' };
  }

  const expectedSig = crypto
    .createHmac('sha256', secretBytes)
    .update(signedContent)
    .digest('base64');
  const expectedBuf = Buffer.from(expectedSig);

  // webhook-signature header can contain multiple space-separated "v1,<sig>" entries
  const providedSigs = webhookSignature
    .split(' ')
    .map(s => s.split(',')[1])
    .filter(Boolean);

  const matched = providedSigs.some(sig => {
    const sigBuf = Buffer.from(sig);
    return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
  });

  if (!matched) {
    return { valid: false, reason: 'invalid_signature' };
  }

  return { valid: true, reason: null };
}

module.exports = { verifyYocoWebhook, REPLAY_WINDOW_SECONDS };
