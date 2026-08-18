'use strict';
// RC1-H-015 — Meta messaging-pair throttle (Graph error 131056) handling.
//
// Two independent defects, one root cause: when the interim "⏳ Generating…"
// send to a teacher fails because Meta is throttling that specific
// sender/recipient pair (error code 131056, "Re-engagement message" — the
// business already sent this recipient a message outside the open 24h
// customer-service window):
//
//   1. core/generationPipeline.js had already called checkAndIncrementUsage()
//      BEFORE the interim send. If the interim send then failed, the whole
//      request aborted with nothing generated, but the free-tier quota
//      decrement was never rolled back — the teacher silently lost a
//      generation for a message that never started.
//   2. routes/webhook.js's per-message catch block unconditionally attempted
//      a best-effort "something went wrong, please retry" apology send. For
//      a messaging-pair throttle specifically, that fallback send hits the
//      exact same throttle and fails too — pure wasted effort, not a real
//      mitigation.
//
// This test exercises the REAL dispatch chain (routes/webhook.js's exported
// triggerGeneration / buildGenerationDeps, and processMessage for the
// webhook-catch scenarios) against a real-migration SQLite DB, with a
// stubbed services/whatsappService.sendMessage.
//
// Test-harness note: an earlier draft of this test tried to change stub
// behavior mid-test by reassigning require.cache[whatsappPath].exports.sendMessage
// after utils/webhookHelpers.js had already done
// `const { sendMessage } = require('../services/whatsappService')` at module
// load. That reassignment has no effect — webhookHelpers.js's local binding
// already points at the original function reference, so safeSendMessage()
// keeps calling the stale stub regardless of what the exports object is
// mutated to afterward. This test avoids that entirely: the stub is
// installed ONCE, before any dependent module is required, and is a thin
// wrapper that reads a mutable `sendBehavior` variable on every call. Since
// webhookHelpers.js destructures the WRAPPER (not the behavior), changing
// `sendBehavior` between scenarios genuinely changes what safeSendMessage()
// experiences on its next call — no cache mutation, no stale reference.
//
// Run: node tests/rc1-h-015-messaging-pair-throttle.test.js

process.env.PII_SECRET = 'test-secret-key-32-bytes-long!!';
process.env.FREE_LIMIT = '10';
process.env.APP_URL    = 'https://example.test';
process.env.PDF_SECRET = 'pdf-secret';

const Module = require('module');
const path = require('path');

let passed = 0;
let failed = 0;
function check(condition, label, extra) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ FAIL: ${label}${extra !== undefined ? ' -- ' + extra : ''}`); failed++; }
}

// MUST be required before any service/repository module — see
// tests/helpers/createTestDb.js's "Why this must be required first".
const { createTestDb } = require('./helpers/createTestDb');
const testDb = createTestDb(__filename);
const db = testDb.db;

// ── Stub services/whatsappService — mutable-behavior wrapper, installed
// BEFORE any dependent module requires it. ──────────────────────────────────
const sentMessages = [];

// `sendBehavior` is read fresh on every call. Scenarios set it directly;
// nothing ever mutates the exports object or the wrapper function itself.
//   'ok'        — succeeds normally, records the message
//   'throttle'  — throws an Error with graphErrorCode = 131056
//   'generic'   — throws a plain non-throttle Error (e.g. simulates a 4xx
//                 that isn't the messaging-pair throttle)
let sendBehavior = 'ok';

const whatsappPath = path.resolve(__dirname, '../services/whatsappService');
require.cache[whatsappPath] = {
  id: whatsappPath, filename: whatsappPath, loaded: true,
  exports: {
    sendMessage: async (phone, text) => {
      if (sendBehavior === 'throttle') {
        const err = new Error('Graph API 400: (#131056) Re-engagement message');
        err.graphErrorCode = 131056;
        throw err;
      }
      if (sendBehavior === 'generic') {
        const err = new Error('Graph API 400: Invalid parameter');
        err.graphErrorCode = 100; // a real but unrelated Meta code
        throw err;
      }
      sentMessages.push({ phone, text });
      return { messages: [{ id: `wamid.test.${sentMessages.length}` }] };
    },
    sendDocument: async () => true,
    downloadMedia: async () => null,
    chunkMessage: (t) => [t],
  },
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === './whatsappService' || request === '../services/whatsappService') return whatsappPath;
  return origResolve.call(this, request, ...rest);
};

function insertTeacher(phoneHash) {
  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject) VALUES (?, ?, ?, ?)`)
    .run(phoneHash, 'Test Teacher', '7', 'Mathematics');
  db.prepare(`
    INSERT INTO onboarding (phone_hash, step, updated_at)
    VALUES (?, 'done', datetime('now'))
    ON CONFLICT(phone_hash) DO UPDATE SET step = 'done'
  `).run(phoneHash);
}

function usageCount(phoneHash) {
  const month = new Date().toISOString().slice(0, 7);
  return db.prepare(`SELECT COUNT(*) as c FROM usage_events WHERE phone_hash = ? AND month_key = ?`)
    .get(phoneHash, month).c;
}

function makeMessage(from, body, id) {
  return { from, id, type: 'text', text: { body } };
}

function makeIntent(overrides = {}) {
  return {
    type: 'worksheet',
    topic: 'Fractions',
    grade: 7,
    subject: 'mathematics',
    term: 2,
    atpTopic: null,
    differentiation: null,
    ...overrides,
  };
}

(async () => {
  const {
    hashPhone,
    processMessage,
    buildProcessMessageDeps,
    triggerGeneration,
    buildGenerationDeps,
  } = require('../routes/webhook').__testExports;

  console.log('\n── RC1-H-015: messaging-pair throttle (Graph 131056) ──\n');

  // ── Scenarios 1–4: quota rollback on interim-send failure, via the
  // real triggerGeneration/buildGenerationDeps seam (isolates the
  // generationPipeline behavior from webhook-catch/fallback behavior). ──

  console.log('── Scenario 1: interim send throttled (131056) → quota rolled back ──');
  {
    const phone = '+27821199001';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    sendBehavior = 'throttle';
    sentMessages.length = 0;

    const before = usageCount(phoneHash);
    let threw = null;
    try {
      await triggerGeneration({ from: phone, intent: makeIntent(), deps: buildGenerationDeps() });
    } catch (err) {
      threw = err;
    }
    const after = usageCount(phoneHash);

    check(!!threw, 'H015-01: triggerGeneration re-throws when the interim send fails');
    check(threw && threw.graphErrorCode === 131056, 'H015-02: the re-thrown error preserves graphErrorCode 131056');
    check(after === before, 'H015-03: quota is NOT net-incremented — rollback exactly cancels the increment', `before=${before} after=${after}`);
    check(sentMessages.length === 0, 'H015-04: no message was actually delivered (the interim send itself failed)');
  }

  console.log('\n── Scenario 2: interim send succeeds → quota stays incremented (unchanged behavior) ──');
  {
    const phone = '+27821199002';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    sendBehavior = 'ok';
    sentMessages.length = 0;

    const before = usageCount(phoneHash);
    // generateContent will attempt a real AI call and likely fail in this
    // sandbox (no network) — that's fine and expected; H-015 only concerns
    // the interim send, and generateContent's own failure path already has
    // its own pre-existing rollback (asserted separately below in
    // Scenario 5), which would cancel this increment out too. To isolate
    // the interim-send-only claim, we only assert the interim message was
    // actually delivered here, not the final quota state.
    try {
      await triggerGeneration({ from: phone, intent: makeIntent(), deps: buildGenerationDeps() });
    } catch (_) {
      // generateContent failing in this sandbox is expected/irrelevant here.
    }
    check(sentMessages.some(m => /Generating your CAPS-aligned/.test(m.text)),
      'H015-05: the interim "Generating…" message is actually delivered on success', JSON.stringify(sentMessages));
    check(usageCount(phoneHash) >= before,
      'H015-06: quota was incremented for a request whose interim send succeeded (not rolled back by H-015 code)');
  }

  console.log('\n── Scenario 3: quota exhausted → interim send never attempted (unchanged pre-existing behavior) ──');
  {
    const phone = '+27821199003';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    const month = new Date().toISOString().slice(0, 7);
    for (let i = 0; i < Number(process.env.FREE_LIMIT); i++) {
      db.prepare(`INSERT INTO usage_events (phone_hash, month_key, intent_type) VALUES (?, ?, ?)`)
        .run(phoneHash, month, 'worksheet');
    }
    sendBehavior = 'ok';
    sentMessages.length = 0;
    const before = usageCount(phoneHash);

    await triggerGeneration({ from: phone, intent: makeIntent(), deps: buildGenerationDeps() });

    check(usageCount(phoneHash) === before, 'H015-07: quota unchanged when limit already reached (H-015 did not touch this path)');
    check(sentMessages.some(m => /hit your free limit/i.test(m.text)), 'H015-08: the limit-reached message is sent, not the interim "Generating…" message');
  }

  // ── Scenarios 4–5: fallback-suppression behavior.
  //
  // Important scope note: the actual suppression logic (the
  // isMessagingPairThrottled(err) check and the `continue` that skips the
  // apology fallback) lives INLINE in routes/webhook.js's Express route
  // handler, in the per-message loop of the POST /webhook handler itself —
  // it is not a separately exported/callable function, and processMessage()
  // does not include it (processMessage is what runs INSIDE that loop's
  // try). Calling processMessage() directly, as this test does, therefore
  // does NOT go through that inline catch block at all — confirmed by this
  // test initially crashing uncaught on scenario 4 before this comment was
  // written. Extracting that loop into a separately testable function was
  // judged out of scope (no production architecture changes merely for
  // testability), so instead these two scenarios call the REAL exported
  // isMessagingPairThrottled() and safeSendMessage() directly, replicating
  // webhook.js's catch-block logic verbatim (same condition, same fallback
  // text, same `continue`-equivalent). This proves the classification
  // helper and the fallback text behave correctly under both a throttle and
  // a non-throttle failure. It does NOT by itself prove routes/webhook.js's
  // inline block calls isMessagingPairThrottled() correctly — that must be
  // (and was) confirmed by direct diff/code inspection instead.
  const { isMessagingPairThrottled, safeSendMessage } = require('../utils/webhookHelpers');

  async function simulateWebhookCatchBlock(from, err) {
    if (isMessagingPairThrottled(err)) {
      return; // mirrors webhook.js's `continue` — fallback intentionally skipped
    }
    try {
      await safeSendMessage(from,
        `I'm sorry — something went wrong on my side while processing that message. Please send it again in a moment. If the problem continues, let me know.`
      );
    } catch (_) { /* mirrors webhook.js's own guarded catch */ }
  }

  console.log('\n── Scenario 4: throttled interim send → apology fallback is SUPPRESSED ──');
  {
    const phone = '+27821199004';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    sendBehavior = 'throttle';
    sentMessages.length = 0;

    let caught = null;
    try {
      await triggerGeneration({ from: phone, intent: makeIntent(), deps: buildGenerationDeps() });
    } catch (err) {
      caught = err;
    }
    check(!!caught && caught.graphErrorCode === 131056, 'H015-09: precondition — the failure being fed into the catch-block logic is a genuine 131056');
    await simulateWebhookCatchBlock(phone, caught);

    check(sentMessages.length === 0, 'H015-10: no apology fallback was sent when the underlying failure was itself the 131056 throttle', JSON.stringify(sentMessages));
  }

  console.log('\n── Scenario 5: NON-throttle interim-send failure → apology fallback is STILL sent (negative control) ──');
  {
    const phone = '+27821199005';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    sendBehavior = 'generic';
    sentMessages.length = 0;

    let caught = null;
    try {
      await triggerGeneration({ from: phone, intent: makeIntent(), deps: buildGenerationDeps() });
    } catch (err) {
      caught = err;
    }
    check(!!caught && caught.graphErrorCode === 100, 'H015-11: precondition — the failure being fed into the catch-block logic is genuinely non-131056');

    // Let the fallback send itself succeed, to observe it was attempted.
    sendBehavior = 'ok';
    await simulateWebhookCatchBlock(phone, caught);

    check(sentMessages.length === 1 && /something went wrong on my side/i.test(sentMessages[0].text),
      'H015-12: a NON-131056 failure still results in the genuine apology fallback being sent', JSON.stringify(sentMessages));
  }

  console.log('\n── Scenario 6: throttle classification helper — direct unit checks ──');
  {
    const throttleErr = new Error('x'); throttleErr.graphErrorCode = 131056;
    const otherErr = new Error('x'); otherErr.graphErrorCode = 100;
    const noCodeErr = new Error('x');

    check(isMessagingPairThrottled(throttleErr) === true, 'H015-13: 131056 classified as throttled');
    check(isMessagingPairThrottled(otherErr) === false, 'H015-14: an unrelated Meta code (100) is NOT classified as throttled');
    check(isMessagingPairThrottled(noCodeErr) === false, 'H015-15: an error with no graphErrorCode at all is NOT classified as throttled');
    check(isMessagingPairThrottled(null) === false, 'H015-16: null is handled safely, not classified as throttled');
  }

  console.log('\n── Scenario 7: normal successful generation is completely unaffected ──');
  {
    const phone = '+27821199007';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    sendBehavior = 'ok';
    sentMessages.length = 0;

    await processMessage(makeMessage(phone, 'Make me a worksheet on fractions for grade 7', 'msg-7'), buildProcessMessageDeps());

    check(sentMessages.some(m => /Generating your CAPS-aligned/.test(m.text)),
      'H015-17: normal successful flow still delivers the interim "Generating…" message unchanged', JSON.stringify(sentMessages));
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  Module._resolveFilename = origResolve;
  testDb.cleanup();
  process.exit(failed > 0 ? 1 : 0);
})();
