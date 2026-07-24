// Unit tests for utils/yocoWebhookVerifier.js
// Pure function — no Express, no SQLite, no network. Runs in milliseconds.

const crypto = require('crypto');
const { verifyYocoWebhook } = require('../utils/yocoWebhookVerifier');

const SECRET = 'whsec_' + Buffer.from('a-32-byte-test-signing-secret!!').toString('base64');

function sign({ id, timestamp, body, secret = SECRET }) {
  const signedContent = `${id}.${timestamp}.${body}`;
  const secretBytes = Buffer.from(secret.slice('whsec_'.length), 'base64');
  const sig = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');
  return `v1,${sig}`;
}

function baseCase(overrides = {}) {
  const id = 'evt_123';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ type: 'payment.succeeded', payload: { id: 'p_1' } });
  const signature = sign({ id, timestamp, body });
  return {
    headers: {
      'webhook-id': id,
      'webhook-timestamp': timestamp,
      'webhook-signature': signature,
    },
    rawBody: body,
    secret: SECRET,
    ...overrides,
  };
}

const results = [];
function check(name, actualReason, expectedReason, actualValid, expectedValid) {
  const pass = actualReason === expectedReason && actualValid === expectedValid;
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${name}` +
    (pass ? '' : ` (got valid=${actualValid} reason=${actualReason}, expected valid=${expectedValid} reason=${expectedReason})`));
}

console.log('=== yocoWebhookVerifier unit tests ===\n');

// 1. Valid signature
{
  const v = verifyYocoWebhook(baseCase());
  check('valid signature accepted', v.reason, null, v.valid, true);
}

// 2. Invalid / tampered signature (body modified after signing)
{
  const c = baseCase();
  c.rawBody = c.rawBody.replace('p_1', 'p_2'); // one-byte-ish tamper post-signing
  const v = verifyYocoWebhook(c);
  check('tampered payload rejected', v.reason, 'invalid_signature', v.valid, false);
}

// 3. Wrong signature entirely
{
  const c = baseCase();
  c.headers['webhook-signature'] = 'v1,' + Buffer.from('not-the-real-signature').toString('base64');
  const v = verifyYocoWebhook(c);
  check('wrong signature rejected', v.reason, 'invalid_signature', v.valid, false);
}

// 4. Replay attack — timestamp outside the 3-minute window
{
  const id = 'evt_replay';
  const staleTimestamp = String(Math.floor(Date.now() / 1000) - 3600); // 1hr old
  const body = JSON.stringify({ type: 'payment.succeeded' });
  const signature = sign({ id, timestamp: staleTimestamp, body });
  const v = verifyYocoWebhook({
    headers: { 'webhook-id': id, 'webhook-timestamp': staleTimestamp, 'webhook-signature': signature },
    rawBody: body,
    secret: SECRET,
  });
  check('replayed (stale) timestamp rejected', v.reason, 'replay_attack', v.valid, false);
}

// 5. Missing headers
{
  const c = baseCase();
  delete c.headers['webhook-signature'];
  const v = verifyYocoWebhook(c);
  check('missing headers rejected', v.reason, 'missing_headers', v.valid, false);
}

// 6. Malformed secret — missing whsec_ prefix
{
  const c = baseCase({ secret: 'not-a-real-secret-format' });
  const v = verifyYocoWebhook(c);
  check('malformed secret (bad prefix) rejected', v.reason, 'malformed_secret', v.valid, false);
}

// 7. Malformed secret — empty after prefix
{
  const c = baseCase({ secret: 'whsec_' });
  const v = verifyYocoWebhook(c);
  check('malformed secret (empty payload) rejected', v.reason, 'malformed_secret', v.valid, false);
}

// 8. Missing secret entirely
{
  const c = baseCase({ secret: undefined });
  const v = verifyYocoWebhook(c);
  check('missing secret rejected', v.reason, 'missing_secret', v.valid, false);
}

// 9. Multiple signature entries — matches the second one (Yoco can send several)
{
  const c = baseCase();
  const decoy = 'v1,' + Buffer.from('decoy-signature-value').toString('base64');
  c.headers['webhook-signature'] = `${decoy} ${c.headers['webhook-signature']}`;
  const v = verifyYocoWebhook(c);
  check('multi-signature header, real one matches', v.reason, null, v.valid, true);
}

const passed = results.filter(Boolean).length;
const total = results.length;
console.log(`\n=== Results: ${passed}/${total} tests passed ===`);
process.exit(passed === total ? 0 : 1);
