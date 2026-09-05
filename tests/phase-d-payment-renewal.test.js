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

  // ── Cycle 44: stale payment_ledger 'received'-row reclaim coverage ──────
  // Helper: seeds a payment_ledger row directly at a given age, simulating
  // an earlier delivery for the same checkout that reached 'received' but
  // never reached a terminal status (see Cycle 43/44's documented
  // rationale in services/yocoService.js for why this is the only way such
  // a row can exist — an abandoned prior invocation, not a live one).
  function seedReceivedLedgerRow(checkoutId, ageSeconds) {
    const { v4: uuidv4 } = require('uuid');
    db.prepare(`
      INSERT INTO payment_ledger (id, checkout_id, amount, status, created_at, updated_at)
      VALUES (?, ?, NULL, 'received', datetime('now', ?), datetime('now', ?))
    `).run(uuidv4(), checkoutId, `-${ageSeconds} seconds`, `-${ageSeconds} seconds`);
  }

  console.log('\n── Cycle 44 Test A: fresh received row (well inside 2min) is NOT reclaimed ──');
  {
    const phone = '+27821110006';
    const checkoutId = 'co-cycle44-a';
    const phoneHash = seedPendingCheckout({ checkoutId, phone });
    seedReceivedLedgerRow(checkoutId, 10); // 10s old — well inside the 2-minute window

    const result = await handleWebhookEvent(succeededEvent(checkoutId));
    const teacher = getTeacher(phoneHash);

    check(result.upgraded === false, 'C44-A-01: fresh in-flight-looking received row is not reclaimed (upgraded=false)');
    check(teacher.is_pro === 0, 'C44-A-02: no business effect occurred — teacher was not upgraded');
    const ledgerRow = db.prepare(`SELECT status FROM payment_ledger WHERE checkout_id = ?`).get(checkoutId);
    check(ledgerRow.status === 'received', 'C44-A-03: ledger row remains at received, untouched');
  }

  console.log('\n── Cycle 44 Test B: stale received row (well past 2min) IS reclaimed ───');
  {
    const phone = '+27821110007';
    const checkoutId = 'co-cycle44-b';
    const phoneHash = seedPendingCheckout({ checkoutId, phone });
    seedReceivedLedgerRow(checkoutId, 300); // 5 minutes old — well past the threshold

    const result = await handleWebhookEvent(succeededEvent(checkoutId));
    const teacher = getTeacher(phoneHash);

    check(result.upgraded === true, 'C44-B-01: stale received row is reclaimed and payment processes (upgraded=true)');
    check(teacher.is_pro === 1, 'C44-B-02: business effect occurred exactly once — teacher is now Pro');
    const ledgerRow = db.prepare(`SELECT status, id FROM payment_ledger WHERE checkout_id = ?`).get(checkoutId);
    check(ledgerRow.status === 'applied', 'C44-B-03: ledger reaches the applied terminal state');
    const allRowsForCheckout = db.prepare(`SELECT COUNT(*) AS n FROM payment_ledger WHERE checkout_id = ?`).get(checkoutId);
    check(allRowsForCheckout.n === 1, 'C44-B-04: exactly one ledger row exists for this checkout (reclaim reused it, did not duplicate it)');
  }

  console.log('\n── Cycle 44 Test C: just-inside the 2min boundary is NOT reclaimed ────');
  {
    const phone = '+27821110008';
    const checkoutId = 'co-cycle44-c';
    const phoneHash = seedPendingCheckout({ checkoutId, phone });
    seedReceivedLedgerRow(checkoutId, 110); // 1min50s old — inside the 2-minute window

    const result = await handleWebhookEvent(succeededEvent(checkoutId));
    const teacher = getTeacher(phoneHash);

    check(result.upgraded === false, 'C44-C-01: just-inside-threshold received row is NOT reclaimed');
    check(teacher.is_pro === 0, 'C44-C-02: no business effect occurred at the just-inside boundary');
  }

  console.log('\n── Cycle 44 Test D: just-outside the 2min boundary IS reclaimed ───────');
  {
    const phone = '+27821110009';
    const checkoutId = 'co-cycle44-d';
    const phoneHash = seedPendingCheckout({ checkoutId, phone });
    seedReceivedLedgerRow(checkoutId, 130); // 2min10s old — just past the 2-minute window

    const result = await handleWebhookEvent(succeededEvent(checkoutId));
    const teacher = getTeacher(phoneHash);

    check(result.upgraded === true, 'C44-D-01: just-outside-threshold received row IS reclaimed');
    check(teacher.is_pro === 1, 'C44-D-02: business effect occurred exactly once at the just-outside boundary');
    const ledgerRow = db.prepare(`SELECT status FROM payment_ledger WHERE checkout_id = ?`).get(checkoutId);
    check(ledgerRow.status === 'applied', 'C44-D-03: ledger reaches the applied terminal state at the boundary');
  }

  console.log('\n── Cycle 44 Test E: recovery after an interrupted prior delivery ──────');
  {
    // Simulates the documented recovery scenario: an earlier delivery for
    // this checkout reached 'received' but never reached a terminal status
    // (the only way that can happen per the invariant documented in
    // services/yocoService.js — an abandoned prior invocation, not a live
    // one). A later delivery (Yoco's own retry, or an operator-triggered
    // resend) must be able to recover it to exactly one applied business
    // effect.
    const phone = '+27821110010';
    const checkoutId = 'co-cycle44-e';
    const phoneHash = seedPendingCheckout({ checkoutId, phone });
    seedReceivedLedgerRow(checkoutId, 400); // well past threshold — abandoned row

    sentMessages.length = 0;
    const result = await handleWebhookEvent(succeededEvent(checkoutId));
    const teacher = getTeacher(phoneHash);

    check(result.upgraded === true, 'C44-E-01: interrupted-then-retried delivery is recoverable');
    check(teacher.is_pro === 1, 'C44-E-02: subscription is extended — the entitlement mutation actually applies');
    const expiry = parseSqliteUtc(teacher.pro_expires);
    const expectedExpiry = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    check(Math.abs(expiry.getTime() - expectedExpiry.getTime()) < 5000, 'C44-E-03: pro_expires reflects exactly one 31-day extension, not zero or double');
    check(sentMessages.length === 1, 'C44-E-04: exactly one WhatsApp confirmation is sent for the recovered payment');

    // A further duplicate of the same checkout (e.g. Yoco's own later
    // redelivery arriving after recovery already completed) must not
    // apply a second time.
    sentMessages.length = 0;
    const resultDup = await handleWebhookEvent(succeededEvent(checkoutId));
    const teacherAfterDup = getTeacher(phoneHash);
    check(resultDup.upgraded === false, 'C44-E-05: a further duplicate after recovery does not upgrade again');
    check(teacherAfterDup.pro_expires === teacher.pro_expires, 'C44-E-06: pro_expires is unchanged by the further duplicate — no second business effect');
    check(sentMessages.length === 0, 'C44-E-07: no second confirmation message sent for the further duplicate');
  }

  console.log('\n── Cycle 44 Phase 5: no-await critical-section invariant (structural) ──');
  {
    // Cycle 43 established that the 2-minute reclaim window's safety rests
    // on there being zero `await` between the payment_ledger claim and the
    // terminal status write in handleWebhookEvent — not on any assumption
    // about Yoco's retry timing. A live concurrent-request race test is
    // not constructible here (Node's single-threaded, synchronous-db
    // execution model means such a race cannot be manufactured against
    // the real code), so per Cycle 44 Phase 5 this is instead a structural
    // regression on the invariant itself: if a future change introduces
    // an `await` inside this span, the safety argument this reclaim
    // window relies on no longer holds, and this check will fail loudly
    // rather than silently regressing. Deliberately source-text-based
    // (same convention as tests/routing-order-assessment-session-priority.test.js),
    // not measured/timed.
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.resolve(__dirname, '../services/yocoService.js'), 'utf8');

    const claimMarker = `INSERT OR IGNORE INTO payment_ledger`;
    const terminalMarker = `SET status = 'applied', phone_hash = ?`;
    const claimIdx = source.indexOf(claimMarker);
    const terminalIdx = source.indexOf(terminalMarker);

    check(claimIdx !== -1 && terminalIdx !== -1 && claimIdx < terminalIdx,
      'C44-INV-01: both the ledger claim and the applied-terminal-write markers were found, in the expected order');

    if (claimIdx !== -1 && terminalIdx !== -1 && claimIdx < terminalIdx) {
      const criticalSection = source.slice(claimIdx, terminalIdx);
      const awaitMatches = criticalSection.match(/\bawait\b/g) || [];
      check(awaitMatches.length === 0,
        `C44-INV-02: no 'await' appears between the ledger claim and the applied-terminal write (found ${awaitMatches.length})`);
    }
  }

  console.log('\n── Cycle 45 Test F: underpayment is rejected BEFORE entitlement ────────');
  {
    // PRO_PRICE_ZAR is 99 in this test env (process.env.PRO_PRICE_ZAR set at
    // the top of this file) => floor is 9900 cents. A webhook claiming a
    // lower paid amount for a real, valid, correctly-signed-equivalent
    // checkout must not grant Pro.
    const phone = '+27821110011';
    const checkoutId = 'co-cycle45-f';
    const phoneHash = seedPendingCheckout({ checkoutId, phone });

    const result = await handleWebhookEvent(succeededEvent(checkoutId, 1000)); // R10, below the R99 floor
    const teacher = getTeacher(phoneHash);

    check(result.upgraded === false, 'C45-F-01: underpayment does not report upgraded=true');
    check(teacher.is_pro === 0, 'C45-F-02: underpayment grants no Pro entitlement');
    const ledgerRow = db.prepare(`SELECT status, reason FROM payment_ledger WHERE checkout_id = ?`).get(checkoutId);
    check(ledgerRow.status === 'ignored' && ledgerRow.reason === 'underpayment_or_invalid_amount',
      'C45-F-03: ledger records the specific underpayment reason, not a silent no-op');

    // A later legitimate-amount duplicate for the SAME checkout must still
    // be blocked once terminal — underpayment is a terminal ('ignored')
    // status, so a second delivery claiming the correct amount cannot
    // retroactively grant entitlement for a checkout already resolved as
    // an underpayment.
    const result2 = await handleWebhookEvent(succeededEvent(checkoutId, 9900));
    const teacherAfter = getTeacher(phoneHash);
    check(result2.upgraded === false, 'C45-F-04: a later full-amount delivery for an already-ignored checkout is treated as a duplicate, not re-processed');
    check(teacherAfter.is_pro === 0, 'C45-F-05: no entitlement is granted retroactively');
  }

  console.log('\n── Cycle 45 Test G: overpayment is accepted (documented floor, not exact-match) ──');
  {
    const phone = '+27821110012';
    const checkoutId = 'co-cycle45-g';
    const phoneHash = seedPendingCheckout({ checkoutId, phone });

    const result = await handleWebhookEvent(succeededEvent(checkoutId, 20000)); // R200, above the R99 floor
    const teacher = getTeacher(phoneHash);

    check(result.upgraded === true, 'C45-G-01: an amount at/above the required floor is accepted (intentional floor semantics, not a defect)');
    check(teacher.is_pro === 1, 'C45-G-02: entitlement is granted exactly once for the overpayment');
  }

  console.log('\n── Cycle 45 Test H: unknown checkout ID grants no entitlement ──────────');
  {
    // A validly-shaped payment.succeeded event whose checkoutId does not
    // correspond to any locally-created pending subscription — e.g. a
    // stale/expired checkout, a checkout for a different merchant
    // integration sharing the same Yoco account, or an attacker-guessed
    // checkout ID. No teacher/phoneHash can be resolved, so no entitlement
    // must be granted to anyone.
    const result = await handleWebhookEvent(succeededEvent('co-cycle45-does-not-exist'));

    check(result.phoneHash === null, 'C45-H-01: unknown checkout resolves to no phoneHash');
    check(result.upgraded === false, 'C45-H-02: unknown checkout grants no entitlement to any teacher');
    const ledgerRow = db.prepare(`SELECT status, reason FROM payment_ledger WHERE checkout_id = ?`).get('co-cycle45-does-not-exist');
    check(ledgerRow.status === 'failed' && ledgerRow.reason === 'no_pending_subscription_found',
      'C45-H-03: ledger records why no entitlement was applied, rather than silently dropping the event');
  }

  console.log('\n── Cycle 45 Test I: entitlement/user binding is server-controlled, not webhook-controlled ──');
  {
    // The webhook payload never carries phoneHash (confirmed against
    // Yoco's own official payment.succeeded example payload, which only
    // echoes back metadata.checkoutId) — handleWebhookEvent must resolve
    // the beneficiary from the LOCALLY created subscriptions row, not from
    // any field an attacker could place in a crafted metadata object. This
    // test proves that even if a payload carries an unrelated/attacker-
    // supplied phoneHash-shaped field, it has no effect on who is upgraded.
    const phone = '+27821110013';
    const checkoutId = 'co-cycle45-i';
    const phoneHash = seedPendingCheckout({ checkoutId, phone });

    const event = succeededEvent(checkoutId);
    event.payload.metadata.phoneHash = 'attacker-controlled-value-should-be-ignored';

    const result = await handleWebhookEvent(event);
    const teacher = getTeacher(phoneHash);

    check(result.phoneHash === phoneHash, 'C45-I-01: the beneficiary is resolved from the local subscriptions row, matching the real checkout owner');
    check(teacher.is_pro === 1, 'C45-I-02: entitlement is correctly granted to the real checkout owner despite a forged metadata.phoneHash field being present');
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
