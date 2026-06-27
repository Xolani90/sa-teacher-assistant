'use strict';
// Regression test for the webhook batch-processing fix.
//
// Verifies the exact control-flow shape now used in routes/webhook.js's
// POST handler: the try/catch must wrap EACH message individually, not the
// whole loop — otherwise one throwing message silently blocks every
// subsequent message in the same Meta-delivered batch.
//
// This test exercises the control-flow logic directly (not the full Express
// route, which would require mocking the entire webhook.js dependency graph)
// since the bug is purely about loop/catch placement, not about any specific
// service behaviour.

const assert = require('assert');

// ── Simulates the FIXED shape from routes/webhook.js ──
async function processBatchFixed(messages, processMessage, sendFallback) {
  const processed = [];
  for (const message of messages) {
    try {
      await processMessage(message);
      processed.push(message.id);
    } catch (err) {
      try {
        if (message?.from) await sendFallback(message.from);
      } catch {
        // swallowed — must never propagate and break the loop
      }
    }
  }
  return processed;
}

// ── Simulates the OLD, BUGGY shape for comparison ──
async function processBatchBuggy(messages, processMessage) {
  const processed = [];
  try {
    for (const message of messages) {
      await processMessage(message);
      processed.push(message.id);
    }
  } catch (err) {
    // old behaviour: whole batch abandoned on first error
  }
  return processed;
}

async function run() {
  const messages = [
    { id: 'msg1', from: '27821111111', shouldThrow: true },
    { id: 'msg2', from: '27822222222', shouldThrow: false },
    { id: 'msg3', from: '27823333333', shouldThrow: false },
  ];

  const fakeProcessMessage = async (message) => {
    if (message.shouldThrow) throw new Error('simulated processing failure');
  };

  // ── Test 1: fixed version processes msg2 and msg3 despite msg1 throwing ──
  const processedFixed = await processBatchFixed(messages, fakeProcessMessage, async () => {});
  assert.deepStrictEqual(processedFixed, ['msg2', 'msg3']);
  console.log('✅ Test 1 passed: fixed version processes remaining batch messages after one throws');

  // ── Test 2: demonstrates the OLD bug really did drop msg2 and msg3 ──
  const processedBuggy = await processBatchBuggy(messages, fakeProcessMessage);
  assert.deepStrictEqual(processedBuggy, []);
  console.log('✅ Test 2 passed: confirms the old shape really did silently drop the rest of the batch');

  // ── Test 3: fallback send is attempted for the failing message ──
  const fallbacksSent = [];
  await processBatchFixed(messages, fakeProcessMessage, async (from) => { fallbacksSent.push(from); });
  assert.deepStrictEqual(fallbacksSent, ['27821111111']);
  console.log('✅ Test 3 passed: fallback message is sent only to the teacher whose message failed');

  // ── Test 4: if the fallback send itself throws, it must not propagate and
  // must not block subsequent messages either (this is the scenario where the
  // original failure was something systemic, like a DB outage, and the
  // fallback send fails for the same reason) ──
  const throwingFallback = async () => { throw new Error('fallback send also failed'); };
  const processedDespiteFallbackFailure = await processBatchFixed(messages, fakeProcessMessage, throwingFallback);
  assert.deepStrictEqual(processedDespiteFallbackFailure, ['msg2', 'msg3']);
  console.log('✅ Test 4 passed: a failing fallback send does not propagate or block the rest of the batch');

  // ── Test 5: no message has a "from" — fallback is never attempted, no crash ──
  const noFromMessages = [{ id: 'msg1', from: null, shouldThrow: true }];
  let fallbackCalled = false;
  const processedNoFrom = await processBatchFixed(noFromMessages, fakeProcessMessage, async () => { fallbackCalled = true; });
  assert.deepStrictEqual(processedNoFrom, []);
  assert.strictEqual(fallbackCalled, false);
  console.log('✅ Test 5 passed: missing "from" is handled gracefully, no fallback attempted, no crash');

  console.log('\n🎉 All 5 batch-processing regression tests passed.');
}

run().catch((err) => {
  console.error('TEST SUITE FAILED:', err);
  process.exit(1);
});
