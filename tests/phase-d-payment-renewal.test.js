'use strict';
// Phase D-fix — Payment renewal & confirmation-message regression test.
//
// Confirmed defects (Phase D audit):
//   D1: a SQL WHERE guard (`pro_expires <= datetime('now', '+31 days')`)
//       caused the 3rd+ early/stacked payment to match zero rows and be
//       silently discarded -- no error, no log distinguishing it from a
//       normal success.
//   D2: the WhatsApp confirmation message computed its claimed expiry via
//       `new Date() + 31 days` independently of the database, so on any
//       renewal made before the prior period lapsed, the message did not
//       match the real (correctly stacked) pro_expires value.
//
// Fix: pro_expires is now computed additively in JS from the teacher's
// CURRENT row (extend from whichever is later: existing expiry or now),
// written via an unconditional UPDATE keyed only on phone_hash, with
// result.changes checked and a payment_failed_reason persisted on any
// no-op. The confirmation message re-reads pro_expires from the DB after
// the write, rather than recomputing it independently.
//
// This test loads the REAL services/yocoService.js against a real
// in-memory better-sqlite3 database (via Module._resolveFilename
// patching, same convention as tests/intervention-reports.test.js) and
// stubs only the outbound WhatsApp network call -- everything else is the
// actual production code path.
//
// Run: node tests/phase-d-payment-renewal.test.js

process.env.PII_SECRET   = 'test-secret-key-32-bytes-long!!';
process.env.PRO_PRICE_ZAR = '99';
process.env.YOCO_SECRET_KEY = 'test-yoco-secret';
process.env.APP_URL = 'https://example.test';

const Module = require('module');
const path = require('path');
const { parseSqliteUtc } = require('../utils/dateUtils');

let passed = 0;
let failed = 0;
function check(condition, label) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ FAIL: ${label}`); failed++; }
}


// MUST be required before any service/repository module — see
// tests/helpers/createTestDb.js's "Why this must be required first".
const { createTestDb } = require('./helpers/createTestDb');
const testDb = createTestDb(__filename);
const db = testDb.db;

// ── Stub services/whatsappService so no real network call is made ──────────
const sentMessages = [];
const whatsappPath = path.resolve(__dirname, '../services/whatsappService');
require.cache[whatsappPath] = {
  id: whatsappPath, filename: whatsappPath, loaded: true,
  exports: {
    sendMessage: async (phone, text) => { sentMessages.push({ phone, text }); return true; },
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

function hashPhoneForTest(phone) {
  const crypto = require('crypto');
  const normalized = phone.trim().replace(/^\+/, '');
  return crypto.createHmac('sha256', process.env.PII_SECRET).update(normalized).digest('hex');
}

function seedPendingCheckout({ checkoutId, phone, amountZar = 99 }) {
  const { encryptPhone } = require('../utils/encryption');
  const phoneHash = hashPhoneForTest(phone);
  const phoneEnc = encryptPhone(phone);
  db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash, phone_enc) VALUES (?, ?)`).run(phoneHash, phoneEnc);
  db.prepare(`
    INSERT INTO subscriptions (phone_hash, yoco_checkout_id, amount_zar, status, phone_enc)
    VALUES (?, ?, ?, 'pending', ?)
  `).run(phoneHash, checkoutId, amountZar, phoneEnc);
  return phoneHash;
}

function getTeacher(phoneHash) {
  return db.prepare(`SELECT * FROM teachers WHERE phone_hash = ?`).get(phoneHash);
}

function succeededEvent(checkoutId, amountCents = 9900) {
  return {
    type: 'payment.succeeded',
    payload: {
      id: `p_${checkoutId}`,
      amount: amountCents,
      metadata: { checkoutId },
    },
  };
}

(async () => {
  const { handleWebhookEvent } = require('../services/yocoService');

  console.log('\n── D-fix Case 1: first payment sets +31 days ───────────────────────────');
  {
    const phone = '+27821110001';
    const checkoutId = 'co-case1';
    const phoneHash = seedPendingCheckout({ checkoutId, phone });

    const before = getTeacher(phoneHash);
    check(before.is_pro === 0, 'D-01: teacher starts as non-Pro');

    const result = await handleWebhookEvent(succeededEvent(checkoutId));
    const after = getTeacher(phoneHash);

    check(result.upgraded === true, 'D-02: handleWebhookEvent reports upgraded=true');
    check(after.is_pro === 1, 'D-03: teacher is now Pro');

    const expiry = parseSqliteUtc(after.pro_expires);
    const expectedExpiry = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    const diffMs = Math.abs(expiry.getTime() - expectedExpiry.getTime());
    check(diffMs < 5000, 'D-04: pro_expires is ~31 days from now (within 5s tolerance)');

    const lastMsg = sentMessages[sentMessages.length - 1];
    check(lastMsg && lastMsg.phone === phone, 'D-05: confirmation WhatsApp message was sent to the right phone');
    const expiryStrInMsg = expiry.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });
    check(lastMsg.text.includes(expiryStrInMsg), 'D-06 (D2 fix): confirmation message expiry text matches the REAL DB pro_expires value');
  }

  console.log('\n── D-fix Case 2: second payment before expiry stacks correctly ────────');
  {
    const phone = '+27821110002';
    const checkoutId1 = 'co-case2-a';
    const checkoutId2 = 'co-case2-b';
    const phoneHash = seedPendingCheckout({ checkoutId: checkoutId1, phone });

    await handleWebhookEvent(succeededEvent(checkoutId1));
    const afterFirst = getTeacher(phoneHash);
    const firstExpiry = parseSqliteUtc(afterFirst.pro_expires);

    // Second real payment, second checkout, while well within the first period.
    seedPendingCheckout({ checkoutId: checkoutId2, phone });
    sentMessages.length = 0;
    const result2 = await handleWebhookEvent(succeededEvent(checkoutId2));
    const afterSecond = getTeacher(phoneHash);
    const secondExpiry = parseSqliteUtc(afterSecond.pro_expires);

    check(result2.upgraded === true, 'D-07: second payment reports upgraded=true');
    const diffDays = (secondExpiry.getTime() - firstExpiry.getTime()) / (24 * 60 * 60 * 1000);
    check(Math.abs(diffDays - 31) < 0.01, 'D-08: second payment extends by exactly +31 days from the FIRST expiry, not from now (correct stacking)');

    const lastMsg = sentMessages[sentMessages.length - 1];
    const expiryStrInMsg = secondExpiry.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });
    check(lastMsg.text.includes(expiryStrInMsg), 'D-09 (D2 fix): second confirmation message matches the real stacked DB value (62 days out), not "today + 31"');
  }

  console.log('\n── D-fix Case 3: third payment far ahead MUST still extend (D1 fix) ───');
  {
    const phone = '+27821110003';
    const checkoutIds = ['co-case3-a', 'co-case3-b', 'co-case3-c'];
    let phoneHash;

    for (let i = 0; i < checkoutIds.length; i++) {
      phoneHash = seedPendingCheckout({ checkoutId: checkoutIds[i], phone });
      sentMessages.length = 0;
      const result = await handleWebhookEvent(succeededEvent(checkoutIds[i]));
      check(result.upgraded === true, `D-10.${i + 1}: payment #${i + 1} reports upgraded=true (no silent no-op)`);
    }

    const finalTeacher = getTeacher(phoneHash);
    const finalExpiry = parseSqliteUtc(finalTeacher.pro_expires);
    const expectedExpiry = new Date(Date.now() + 93 * 24 * 60 * 60 * 1000); // 3 x 31 days
    const diffMs = Math.abs(finalExpiry.getTime() - expectedExpiry.getTime());
    check(diffMs < 5000, 'D-11: three stacked payments correctly total ~93 days, not capped at 62');

    // Confirm no payment_ledger row for any of the three checkouts was
    // marked anything other than 'applied' (i.e. no silent failure/ignore).
    const failedReasons = db.prepare(`
      SELECT checkout_id, status, reason FROM payment_ledger
      WHERE phone_hash = ? AND status != 'applied'
    `).all(phoneHash);
    check(failedReasons.length === 0, 'D-12: no non-applied ledger status recorded for any of the 3 successful payments');
  }

  console.log('\n── D-fix Case 4: duplicate webhook delivery is still idempotent ───────');
  {
    const phone = '+27821110004';
    const checkoutId = 'co-case4';
    const phoneHash = seedPendingCheckout({ checkoutId, phone });

    const result1 = await handleWebhookEvent(succeededEvent(checkoutId));
    const afterFirst = getTeacher(phoneHash);

    sentMessages.length = 0;
    // Yoco redelivers the identical webhook (e.g. our 200-OK ack got lost in transit).
    const result2 = await handleWebhookEvent(succeededEvent(checkoutId));
    const afterSecond = getTeacher(phoneHash);

    check(result1.upgraded === true, 'D-13: original delivery upgrades the teacher');
    check(result2.upgraded === false, 'D-14: duplicate delivery does NOT report upgraded=true again');
    check(afterFirst.pro_expires === afterSecond.pro_expires, 'D-15: duplicate delivery does NOT extend pro_expires a second time (idempotent)');
    check(sentMessages.length === 0, 'D-16: duplicate delivery does not send a second confirmation message');
  }

  console.log('\n── D-fix: payment_failed_reason is recorded when extension genuinely cannot apply ──');
  {
    // Force the "teacher row not found" branch: a subscription row exists
    // (so phoneHash resolves) but its teacher row does not (data-integrity
    // edge case that should not happen, but must fail loudly if it does).
    const phone = '+27821110005';
    const checkoutId = 'co-case5';
    const phoneHash = hashPhoneForTest(phone);
    const { encryptPhone } = require('../utils/encryption');
    // Real schema enforces FOREIGN KEY (phone_hash) REFERENCES teachers,
    // so this deliberately-orphaned row (simulating a data-integrity edge
    // case that should never happen) can only be constructed with FK
    // enforcement briefly disabled.
    db.exec('PRAGMA foreign_keys = OFF');
    db.prepare(`
      INSERT INTO subscriptions (phone_hash, yoco_checkout_id, amount_zar, status, phone_enc)
      VALUES (?, ?, 99, 'pending', ?)
    `).run(phoneHash, checkoutId, encryptPhone(phone));
    db.exec('PRAGMA foreign_keys = ON');
    // Deliberately do NOT insert a teachers row for this phoneHash.

    const result = await handleWebhookEvent(succeededEvent(checkoutId));
    check(result.upgraded === false, 'D-17: missing teacher row results in upgraded=false, not a thrown error');

    const ledgerRow = db.prepare(`SELECT status, reason FROM payment_ledger WHERE checkout_id = ?`).get(checkoutId);
    check(ledgerRow.status === 'failed' && ledgerRow.reason === 'teacher_row_not_found', 'D-18: payment_ledger records the failure reason explaining the no-op (no silent failure)');
  }

  console.log('\n─────────────────────────────────');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total:  ${passed + failed}`);
  console.log('─────────────────────────────────\n');

  Module._resolveFilename = origResolve;
  testDb.cleanup();
  process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
  console.error('UNCAUGHT ERROR IN TEST:', err);
  Module._resolveFilename = origResolve;
  testDb.cleanup();
  process.exit(1);
});
