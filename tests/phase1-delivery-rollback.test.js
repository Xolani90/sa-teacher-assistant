'use strict';
// Phase 1 — Delivery-failure usage rollback regression test.
//
// Confirmed defect (pre-fix): processGeneration() in routes/webhook.js only
// rolled back the usage_events row if generateContent() itself failed. If
// generation SUCCEEDED but the subsequent WhatsApp delivery of that content
// failed (safeSendMessage(from, finalContent) throwing), the teacher's
// monthly quota was still consumed even though they received nothing.
//
// Fix: the send is now wrapped in its own try/catch. usageCommitted only
// flips true after WhatsApp accepts the message; on a send failure,
// rollbackUsage() is called with the same insertedRowId-based mechanism
// already used around generateContent(), and a best-effort apology is sent.
//
// This test exercises the REAL processGeneration() function (via the
// module's __testExports), with every external dependency (AI, WhatsApp,
// DB) stubbed so the exact interleaving can be controlled deterministically.
//
// Run: node tests/phase1-delivery-rollback.test.js

process.env.PII_SECRET = 'test-secret-key-32-bytes-long!!';
process.env.FREE_LIMIT = '10';
process.env.APP_URL = 'https://example.test';
process.env.PDF_SECRET = 'pdf-secret';

let passed = 0;
let failed = 0;
function check(condition, label) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ FAIL: ${label}`); failed++; }
}

(async () => {
  const control = require('../utils/mockControl');
  const { getDb } = require('../utils/database');
  const { hashPhone, currentMonthKey } = require('../utils/usageTracker');
  const webhook = require('../routes/webhook');
  const { processGeneration } = webhook.__testExports;

  const db = getDb();
  const phone = '+27821140099';
  const hash = hashPhone(phone);
  const monthKey = currentMonthKey();

  console.log('\n── Phase 1: generation succeeds, delivery fails → usage must roll back ──');
  {
    control.generationShouldFail = false;
    control.sendMessageCallCount = 0;
    control.sendMessageCalls = [];
    // Sequence for a successful-generation/failed-delivery run is expected
    // to be: (1) the "⏳ Generating..." ack, (2) the finalContent delivery
    // attempt — this is the one we fail, (3) the best-effort apology.
    control.sendMessageFailOnCall = 2;

    const intent = { type: 'worksheet', grade: 7, subject: 'general', topic: 'fractions' };
    await processGeneration(phone, intent);

    const rows = db.prepare(
      `SELECT id FROM usage_events WHERE phone_hash = ? AND month_key = ?`
    ).all(hash, monthKey);

    check(rows.length === 0, 'P1-01: usage_events has no surviving row for this teacher/month after delivery failure');
    check(control.sendMessageCallCount === 3, 'P1-02: exactly 3 sendMessage calls occurred (ack + failed content + apology)');
    check(control.sendMessageCalls[0].text.startsWith('⏳'), 'P1-03: call #1 was the generation acknowledgment');
    check(control.sendMessageCalls[1].text.includes('Generated worksheet content'), 'P1-04: call #2 attempted to deliver the actual generated content');
    check(control.sendMessageCalls[2].text.toLowerCase().includes('something went wrong'), 'P1-05: call #3 was the best-effort apology after delivery failure');
  }

  console.log('\n── Sanity check: successful delivery commits usage (no rollback) ──');
  {
    control.generationShouldFail = false;
    control.sendMessageCallCount = 0;
    control.sendMessageCalls = [];
    control.sendMessageFailOnCall = null; // nothing fails this time

    const phone2 = '+27821140100';
    const hash2 = hashPhone(phone2);
    const intent = { type: 'worksheet', grade: 7, subject: 'general', topic: 'fractions' };
    await processGeneration(phone2, intent);

    const rows = db.prepare(
      `SELECT id FROM usage_events WHERE phone_hash = ? AND month_key = ?`
    ).all(hash2, monthKey);

    check(rows.length === 1, 'P1-06 (sanity): a successful generation+delivery leaves exactly one usage_events row (not rolled back)');
  }

  console.log('\n─────────────────────────────────');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total:  ${passed + failed}`);
  console.log('─────────────────────────────────\n');

  process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
  console.error('UNCAUGHT ERROR IN TEST:', err);
  process.exit(1);
});
