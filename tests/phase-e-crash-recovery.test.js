'use strict';
// Phase E — Crash-window recovery regression test.
//
// Confirmed defect (Phase E audit): a process crash landing between the
// payment_ledger INSERT (status='received') and the renewal transaction —
// both fully synchronous, zero await in between, so only reachable via an
// abrupt process kill, not a race — permanently stranded that checkout_id.
// INSERT OR IGNORE would silently reject every future delivery of the same
// checkout_id forever, with no reconciliation path anywhere in the
// codebase (confirmed: nothing else queries payment_ledger).
//
// Fix: a 'received' row older than 2 minutes is treated as abandoned and
// reclaimed for retry on the next delivery of that checkout_id. A
// genuinely in-flight row (created moments ago) is correctly left alone.
//
// Run: node tests/phase-e-crash-recovery.test.js

process.env.PII_SECRET      = 'test-secret-key-32-bytes-long!!';
process.env.PRO_PRICE_ZAR   = '99';
process.env.YOCO_SECRET_KEY = 'test-yoco-secret';
process.env.APP_URL = 'https://example.test';

const Database = require('better-sqlite3');
const Module = require('module');
const path = require('path');

let passed = 0;
let failed = 0;
function check(condition, label) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ FAIL: ${label}`); failed++; }
}

function buildDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash TEXT NOT NULL UNIQUE,
      is_pro INTEGER NOT NULL DEFAULT 0,
      pro_expires TEXT,
      phone_enc TEXT,
      renewal_reminder_sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash TEXT NOT NULL,
      yoco_checkout_id TEXT,
      amount_zar REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      phone_enc TEXT,
      payment_failed_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE payment_ledger (
      id TEXT PRIMARY KEY,
      checkout_id TEXT UNIQUE,
      phone_hash TEXT,
      amount INTEGER,
      status TEXT NOT NULL DEFAULT 'received',
      reason TEXT,
      pro_expires_before TEXT,
      pro_expires_after TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

const db = buildDb();

const dbPath = path.resolve(__dirname, '../utils/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getDb: () => db } };

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
  if (request === '../utils/database' || request === './database') return dbPath;
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
    payload: { id: `p_${checkoutId}`, amount: amountCents, metadata: { checkoutId } },
  };
}

(async () => {
  const { handleWebhookEvent } = require('../services/yocoService');

  console.log('\n── Phase E Case 1: stuck "received" row (simulated crash) is reclaimed ─');
  {
    const phone = '+27821130001';
    const checkoutId = 'co-crash-1';
    const phoneHash = seedPendingCheckout({ checkoutId, phone });

    // Simulate a process crash that happened right after the ledger
    // anchor was written but before the renewal transaction ran — insert
    // the row directly, backdated past the 2-minute staleness threshold.
    db.prepare(`
      INSERT INTO payment_ledger (id, checkout_id, amount, status, created_at, updated_at)
      VALUES ('stuck-id-1', ?, 9900, 'received', datetime('now', '-10 minutes'), datetime('now', '-10 minutes'))
    `).run(checkoutId);

    const before = getTeacher(phoneHash);
    check(before.is_pro === 0, 'E-01: teacher is NOT Pro before retry (the crashed attempt never applied)');

    // The SAME webhook is redelivered (Yoco retry, or a manual replay from
    // the Yoco dashboard) after the process restarted.
    const result = await handleWebhookEvent(succeededEvent(checkoutId));

    check(result.upgraded === true, 'E-02: redelivery after a stuck "received" row is reclaimed and DOES apply (not silently dropped forever)');

    const after = getTeacher(phoneHash);
    check(after.is_pro === 1, 'E-03: teacher is now correctly Pro after the reclaimed retry');

    const ledgerRow = db.prepare(`SELECT status FROM payment_ledger WHERE checkout_id = ?`).get(checkoutId);
    check(ledgerRow.status === 'applied', 'E-04: ledger row transitions from stuck "received" to "applied", not left dangling');
  }

  console.log('\n── Phase E Case 2: genuinely in-flight "received" row is NOT reclaimed ─');
  {
    const phone = '+27821130002';
    const checkoutId = 'co-crash-2';
    seedPendingCheckout({ checkoutId, phone });

    // A row created moments ago (simulating a real concurrent call that is
    // genuinely still processing, not crashed) must NOT be reclaimed.
    db.prepare(`
      INSERT INTO payment_ledger (id, checkout_id, amount, status, created_at, updated_at)
      VALUES ('inflight-id-1', ?, 9900, 'received', datetime('now'), datetime('now'))
    `).run(checkoutId);

    const result = await handleWebhookEvent(succeededEvent(checkoutId));

    check(result.upgraded === false, 'E-05: a fresh (non-stale) "received" row correctly blocks a second concurrent call as a duplicate');

    const ledgerRows = db.prepare(`SELECT id, status FROM payment_ledger WHERE checkout_id = ?`).all(checkoutId);
    check(ledgerRows.length === 1, 'E-06: still exactly one ledger row — the second call did not insert or reclaim a duplicate');
    check(ledgerRows[0].status === 'received', 'E-07: the original in-flight row is untouched, still "received" (correctly left for its own caller to finish)');
  }

  console.log('\n── Phase E Case 3: a terminal "applied" row is never reclaimed ────────');
  {
    const phone = '+27821130003';
    const checkoutId = 'co-crash-3';
    seedPendingCheckout({ checkoutId, phone });

    db.prepare(`
      INSERT INTO payment_ledger (id, checkout_id, amount, status, created_at, updated_at, pro_expires_after)
      VALUES ('applied-id-1', ?, 9900, 'applied', datetime('now', '-1 hour'), datetime('now', '-1 hour'), datetime('now','+31 days'))
    `).run(checkoutId);

    sentMessages.length = 0;
    const result = await handleWebhookEvent(succeededEvent(checkoutId));

    check(result.upgraded === false, 'E-08: a redelivered webhook for an already-"applied" checkout is correctly rejected, regardless of age');
    check(sentMessages.length === 0, 'E-09: no duplicate confirmation message sent for a long-since-applied payment');
  }

  console.log('\n─────────────────────────────────');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total:  ${passed + failed}`);
  console.log('─────────────────────────────────\n');

  Module._resolveFilename = origResolve;
  process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
  console.error('UNCAUGHT ERROR IN TEST:', err);
  Module._resolveFilename = origResolve;
  process.exit(1);
});
