'use strict';
// Phase D-hardening — Replay & concurrency stress test (Task 6).
//
// Exercises the REAL handleWebhookEvent against a real in-memory
// better-sqlite3 database, with genuinely concurrent JS execution via
// Promise.all (not just sequential awaits) — this is the strongest test
// available in this single-process environment: it proves the function's
// OWN logic is safe against concurrent callers within one process (the
// realistic case given the documented single-instance Render deployment),
// though it cannot prove cross-process safety since that would require a
// second real OS process sharing the same SQLite file, which is outside
// what a unit test in this sandbox can exercise. That limitation is
// disclosed explicitly rather than implied away.
//
// Run: node tests/phase-d-replay-stress.test.js

process.env.PII_SECRET     = 'test-secret-key-32-bytes-long!!';
process.env.PRO_PRICE_ZAR  = '99';
process.env.YOCO_SECRET_KEY = 'test-yoco-secret';
process.env.APP_URL = 'https://example.test';

const Database = require('better-sqlite3');
const Module = require('module');
const path = require('path');
const { parseSqliteUtc } = require('../utils/dateUtils');

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
      name TEXT,
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
    // Real network call is replaced with a small artificial delay (instead
    // of resolving instantly) specifically so concurrent calls have a
    // realistic async window to interleave in — a same-tick stub would
    // understate how much genuine interleaving opportunity exists.
    sendMessage: async (phone, text) => {
      await new Promise(r => setTimeout(r, 5 + Math.random() * 15));
      sentMessages.push({ phone, text });
      return true;
    },
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

  console.log('\n── Task 6, Case A: 5 concurrent webhooks for the SAME checkout_id ──────');
  {
    const phone = '+27821120001';
    const checkoutId = 'co-stress-a';
    const phoneHash = seedPendingCheckout({ checkoutId, phone });

    sentMessages.length = 0;
    const event = succeededEvent(checkoutId);
    // 5 genuinely concurrent calls — Promise.all fires all 5 before any
    // of them resolves, so their internal awaits (the sendMessage delay)
    // genuinely interleave at the JS level.
    const results = await Promise.all([
      handleWebhookEvent(event),
      handleWebhookEvent(event),
      handleWebhookEvent(event),
      handleWebhookEvent(event),
      handleWebhookEvent(event),
    ]);

    const upgradedCount = results.filter(r => r.upgraded).length;
    check(upgradedCount === 1, `Task6-A-01: exactly ONE of 5 concurrent identical webhooks reports upgraded=true (got ${upgradedCount})`);

    const ledgerRows = db.prepare(`SELECT * FROM payment_ledger WHERE checkout_id = ?`).all(checkoutId);
    check(ledgerRows.length === 1, `Task6-A-02: exactly ONE ledger row exists for this checkout_id (got ${ledgerRows.length})`);
    check(ledgerRows[0].status === 'applied', 'Task6-A-03: that single ledger row has status=applied');

    const teacher = getTeacher(phoneHash);
    const expiry = parseSqliteUtc(teacher.pro_expires);
    const expected = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    check(Math.abs(expiry.getTime() - expected.getTime()) < 5000, 'Task6-A-04: pro_expires extended by exactly +31 days, NOT +155 (5x31)');

    check(sentMessages.length === 1, `Task6-A-05: exactly ONE WhatsApp confirmation sent, not 5 (got ${sentMessages.length})`);
  }

  console.log('\n── Task 6, Case B: 3 sequential payments for the same teacher ─────────');
  {
    const phone = '+27821120002';
    const checkoutIds = ['co-stress-b1', 'co-stress-b2', 'co-stress-b3'];
    let phoneHash;

    for (const cid of checkoutIds) {
      phoneHash = seedPendingCheckout({ checkoutId: cid, phone });
      const result = await handleWebhookEvent(succeededEvent(cid));
      check(result.upgraded === true, `Task6-B: payment ${cid} applied (no silent failure in the stacking sequence)`);
    }

    const teacher = getTeacher(phoneHash);
    const expiry = parseSqliteUtc(teacher.pro_expires);
    const expected = new Date(Date.now() + 93 * 24 * 60 * 60 * 1000); // 3 x 31
    check(Math.abs(expiry.getTime() - expected.getTime()) < 5000, 'Task6-B-final: three sequential payments stack to ~93 days total');

    const appliedCount = db.prepare(`
      SELECT COUNT(*) AS n FROM payment_ledger WHERE phone_hash = ? AND status = 'applied'
    `).get(phoneHash).n;
    check(appliedCount === 3, 'Task6-B-ledger: exactly 3 applied ledger rows for this teacher, one per payment');
  }

  console.log('\n── Task 6, Case C: 2 out-of-order delayed webhook deliveries ───────────');
  {
    // Simulate Yoco delivering checkout #2's webhook BEFORE checkout #1's,
    // even though #1 was created first (e.g. network reordering, retry
    // queues). Both must still apply correctly and stack, since ledger
    // idempotency is keyed on checkout_id, not arrival order.
    const phone = '+27821120003';
    const checkoutId1 = 'co-stress-c1';
    const checkoutId2 = 'co-stress-c2';
    let phoneHash = seedPendingCheckout({ checkoutId: checkoutId1, phone });
    seedPendingCheckout({ checkoutId: checkoutId2, phone });

    sentMessages.length = 0;
    // Deliver checkout #2's webhook FIRST, then checkout #1's, with a real
    // delay simulating out-of-order network delivery.
    const result2 = await handleWebhookEvent(succeededEvent(checkoutId2));
    await new Promise(r => setTimeout(r, 10));
    const result1 = await handleWebhookEvent(succeededEvent(checkoutId1));

    check(result2.upgraded === true, 'Task6-C-01: out-of-order delivery #2 (arrives first) applies correctly');
    check(result1.upgraded === true, 'Task6-C-02: delayed delivery #1 (arrives second) still applies correctly');

    const teacher = getTeacher(phoneHash);
    const expiry = parseSqliteUtc(teacher.pro_expires);
    const expected = new Date(Date.now() + 62 * 24 * 60 * 60 * 1000); // 2 x 31, regardless of arrival order
    check(Math.abs(expiry.getTime() - expected.getTime()) < 5000, 'Task6-C-03: both out-of-order payments stack correctly regardless of arrival order (~62 days)');

    check(sentMessages.length === 2, 'Task6-C-04: exactly 2 confirmation messages sent, one per genuinely distinct checkout');

    const ledgerRows = db.prepare(`SELECT checkout_id, status FROM payment_ledger WHERE phone_hash = ?`).all(phoneHash);
    check(ledgerRows.length === 2 && ledgerRows.every(r => r.status === 'applied'), 'Task6-C-05: both ledger rows present and applied, no overwrite or regression between them');
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
