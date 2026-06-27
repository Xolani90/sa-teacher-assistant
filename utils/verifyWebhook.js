'use strict';

const crypto = require('crypto');

/**
 * Verifies the X-Hub-Signature-256 header on incoming WhatsApp webhook POSTs.
 *
 * Meta signs every webhook delivery with HMAC-SHA256 using your App Secret.
 * Without this check, anyone who discovers your webhook URL can send fake messages,
 * drain your AI budget, and inject arbitrary content.
 *
 * Used as the `verify` callback in express.json() — runs BEFORE the body is parsed.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {Buffer} buf - Raw request body bytes
 */
function verifyWebhookSignature(req, res, buf) {
  if (req.method !== 'POST') return; // GET is the Meta verification challenge — no signature

  const signature = req.headers['x-hub-signature-256'];

  if (!signature) {
    console.warn('[SECURITY] Webhook POST missing X-Hub-Signature-256 — rejected');
    res.status(403).json({ error: 'Missing signature' });
    throw new Error('Missing webhook signature');
  }

  if (!process.env.META_APP_SECRET) {
    console.error('[SECURITY] META_APP_SECRET is not set — cannot verify webhook signature');
    res.status(500).json({ error: 'Server misconfiguration' });
    throw new Error('META_APP_SECRET not configured');
  }

  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.META_APP_SECRET)
    .update(buf)
    .digest('hex');

  // Both must be same length for timingSafeEqual
  if (signature.length !== expected.length) {
    console.warn('[SECURITY] Webhook signature length mismatch — rejected');
    res.status(403).json({ error: 'Invalid signature' });
    throw new Error('Invalid webhook signature');
  }

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);

  if (!crypto.timingSafeEqual(sigBuf, expBuf)) {
    console.warn('[SECURITY] Webhook signature mismatch — rejected');
    res.status(403).json({ error: 'Invalid signature' });
    throw new Error('Invalid webhook signature');
  }
}

module.exports = { verifyWebhookSignature };
