'use strict';
/**
 * Cycle 22 Priority 1 regression test.
 *
 * Bug: a client-side request timeout in services/whatsappService.js's
 * graphPost() called req.destroy(new Error(...)) with a plain Error that
 * carried no `.code`. isRetryableError() classifies retryability by
 * err.code (ECONNRESET/ETIMEDOUT/ENOTFOUND) or a "Graph API 5xx" message
 * match — neither matched, so a genuine request timeout (the textbook
 * ambiguous "did it actually reach Meta?" outcome) was thrown to the
 * caller on the very first attempt, with the 3-attempt exponential-backoff
 * retry loop never engaged.
 *
 * Fix: tag the timeout error with `.code = 'ETIMEDOUT'` before destroying
 * the request, so it is classified identically to the native Node
 * ETIMEDOUT/ECONNRESET errors and gets retried like any other transient
 * failure.
 *
 * This test mocks the `https` module so the first attempt's request
 * always times out (simulating req.setTimeout firing) and the second
 * attempt succeeds, then asserts sendMessage() resolves without throwing
 * — i.e. the retry loop actually ran.
 *
 * Run individually: node tests/whatsapp-timeout-retry.test.js
 */

const Module = require('module');
const { EventEmitter } = require('events');

let passed = 0;
let failed = 0;
function assert(condition, label) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ FAIL: ${label}`); failed++; }
}

process.env.WHATSAPP_TOKEN = 'test-token';
process.env.WHATSAPP_PHONE_NUMBER_ID = '123456';

// ── Mock https.request ───────────────────────────────────────────────────
// First call: never responds, only fires the timeout callback (mirrors a
// real network hang). Second call: responds immediately with success.
let callCount = 0;
const https = require('https');
const originalRequest = https.request;

https.request = function mockRequest(options, callback) {
  callCount += 1;
  const req = new EventEmitter();
  req.setTimeout = (ms, onTimeout) => {
    if (callCount === 1) {
      // Simulate the timeout firing asynchronously, like the real socket
      // timeout would, before any 'response' ever arrives.
      setImmediate(onTimeout);
    }
  };
  req.destroy = (err) => {
    if (err) setImmediate(() => req.emit('error', err));
  };
  req.write = () => {};
  req.end = () => {
    if (callCount > 1) {
      // Second (retried) attempt: succeed.
      setImmediate(() => {
        const res = new EventEmitter();
        callback(res);
        setImmediate(() => {
          res.emit('data', JSON.stringify({ messages: [{ id: 'wamid.TEST123' }] }));
          res.emit('end');
        });
        res.statusCode = 200;
      });
    }
    // First attempt: intentionally do nothing further — only the
    // setTimeout callback above will fire for it.
  };
  return req;
};

async function run() {
  const whatsappService = require('../services/whatsappService.js');

  let threw = false;
  let result;
  try {
    result = await whatsappService.sendMessage('27821234567', 'test message');
  } catch (err) {
    threw = true;
  }

  assert(callCount >= 2, `retry loop engaged after timeout (calls=${callCount})`);
  assert(!threw, 'sendMessage resolved instead of throwing on first-attempt timeout');
  assert(result?.messages?.[0]?.id === 'wamid.TEST123', 'second attempt result returned to caller');

  https.request = originalRequest;

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test harness error:', err);
  process.exit(1);
});
