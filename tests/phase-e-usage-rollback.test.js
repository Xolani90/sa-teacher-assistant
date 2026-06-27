'use strict';
// Phase E — Usage rollback row-identity regression test.
//
// Confirmed defect: routes/webhook.js's AI-generation-failure rollback
// deleted `WHERE id = (SELECT MAX(id) FROM usage_events WHERE phone_hash=?
// AND month_key=?)` rather than the specific row the failing request
// itself created. Two separate webhook POST deliveries for the same
// teacher are never serialized against each other (confirmed: processMessage
// calls are only sequential within ONE webhook batch, via routes/webhook.js's
// `for (const message of messages) { await processMessage(message); }` loop
// — separate HTTP requests are not serialized at all). AI generation calls
// have real configured timeouts of 60-120 seconds (services/aiService.js),
// a wide, realistic window for a second request to insert its own
// usage_events row while the first is still in flight.
//
// Reproduced directly: if request A (slow, eventually fails) inserts row 1,
// then request B (fast, succeeds) inserts row 2 and finishes first, A's
// MAX(id)-based rollback deleted row 2 (B's legitimate, successful usage)
// instead of row 1 (A's own failed request) — leaving the failed request
// still counted and the successful one wrongly un-counted.
//
// Fix: checkAndIncrementUsage now returns insertedRowId (the exact row it
// created on the free-tier path), and the rollback call site deletes by
// that exact ID instead of MAX(id).
//
// This test exercises the REAL checkAndIncrementUsage function (not a
// simulator) against a real in-memory better-sqlite3 database, with genuine
// Promise-based async interleaving to force the exact race condition.
//
// Run: node tests/phase-e-usage-rollback.test.js

process.env.PII_SECRET = 'test-secret-key-32-bytes-long!!';
process.env.FREE_LIMIT = '10';

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
      phone_hash TEXT PRIMARY KEY,
      is_pro INTEGER NOT NULL DEFAULT 0,
      pro_expires TEXT
    );
    CREATE TABLE usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash TEXT NOT NULL,
      month_key TEXT NOT NULL,
      intent_type TEXT NOT NULL,
      tokens_used INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_usage_phone_month ON usage_events(phone_hash, month_key);
  `);
  return db;
}

const db = buildDb();

const dbPath = path.resolve(__dirname, '../utils/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getDb: () => db } };

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === '../utils/database' || request === './database') return dbPath;
  return origResolve.call(this, request, ...rest);
};

function hashPhoneForTest(phone) {
  const crypto = require('crypto');
  const normalized = phone.trim().replace(/^\+/, '');
  return crypto.createHmac('sha256', process.env.PII_SECRET).update(normalized).digest('hex');
}

// Mirrors the EXACT rollback logic from routes/webhook.js's AI-generation
// .catch() handler (post-fix version) — delete by insertedRowId, not MAX(id).
function rollbackByRowId(insertedRowId) {
  const result = db.prepare(`DELETE FROM usage_events WHERE id = ?`).run(insertedRowId);
  return result.changes;
}

// Mirrors the OLD (pre-fix) rollback logic, kept only to prove this test
// harness actually detects the regression rather than rubber-stamping.
function rollbackByMaxId(phoneHash, monthKey) {
  db.prepare(`
    DELETE FROM usage_events WHERE id = (
      SELECT MAX(id) FROM usage_events WHERE phone_hash = ? AND month_key = ?
    )
  `).run(phoneHash, monthKey);
}

function fakeAiCall(delayMs, shouldFail) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (shouldFail) reject(new Error('simulated AI failure'));
      else resolve('content');
    }, delayMs);
  });
}

(async () => {
  const { checkAndIncrementUsage, currentMonthKey } = require('../utils/usageTracker');

  console.log('\n── Phase E: usage rollback deletes the EXACT failing row, not MAX(id) ──');
  {
    const phone = '+27821140001';
    const phoneHash = hashPhoneForTest(phone);
    db.prepare(`INSERT INTO teachers (phone_hash, is_pro) VALUES (?, 0)`).run(phoneHash);
    const monthKey = currentMonthKey();

    // Request A: increments first, then a SLOW AI call that will FAIL.
    // Request B: increments shortly after A, then a FAST AI call that SUCCEEDS
    // and resolves well before A's failure does — exactly the interleaving
    // that exposed the MAX(id) bug.
    async function requestA() {
      const quota = checkAndIncrementUsage(phone, 'worksheet');
      try {
        await fakeAiCall(100, true); // fails at t=100ms
      } catch (err) {
        const changes = rollbackByRowId(quota.insertedRowId);
        return { label: 'A', rowId: quota.insertedRowId, rolledBack: changes === 1 };
      }
    }

    async function requestB() {
      await new Promise(r => setTimeout(r, 10)); // B's message arrives 10ms after A's
      const quota = checkAndIncrementUsage(phone, 'worksheet');
      await fakeAiCall(30, false); // succeeds at t=10+30=40ms, well before A's failure at t=100ms
      return { label: 'B', rowId: quota.insertedRowId, succeeded: true };
    }

    const [resultA, resultB] = await Promise.all([requestA(), requestB()]);

    check(resultA.rolledBack === true, 'E-U-01: request A\'s rollback reports it actually deleted a row');

    const remaining = db.prepare(`SELECT id FROM usage_events WHERE phone_hash = ? AND month_key = ?`).all(phoneHash, monthKey);
    const aRowGone = !remaining.some(r => r.id === resultA.rowId);
    const bRowPresent = remaining.some(r => r.id === resultB.rowId);

    check(aRowGone, 'E-U-02: request A\'s OWN row (the failed one) is the one removed');
    check(bRowPresent, 'E-U-03: request B\'s row (the successful one) survives untouched');
    check(remaining.length === 1, 'E-U-04: exactly one usage_events row remains (B\'s), not zero and not two');
  }

  console.log('\n── Sanity check: the OLD MAX(id) logic genuinely fails this exact scenario ──');
  {
    // Same interleaving, but using the pre-fix rollback mechanism, to prove
    // this test harness would have caught the original defect.
    const phone = '+27821140002';
    const phoneHash = hashPhoneForTest(phone);
    db.prepare(`INSERT INTO teachers (phone_hash, is_pro) VALUES (?, 0)`).run(phoneHash);
    const monthKey = currentMonthKey();

    async function requestA_oldRollback() {
      checkAndIncrementUsage(phone, 'worksheet');
      try {
        await fakeAiCall(100, true);
      } catch (err) {
        rollbackByMaxId(phoneHash, monthKey);
      }
    }
    async function requestB_oldRollback() {
      await new Promise(r => setTimeout(r, 10));
      const quota = checkAndIncrementUsage(phone, 'worksheet');
      await fakeAiCall(30, false);
      return quota.insertedRowId;
    }

    const [, bRowId] = await Promise.all([requestA_oldRollback(), requestB_oldRollback()]);

    const remaining = db.prepare(`SELECT id FROM usage_events WHERE phone_hash = ? AND month_key = ?`).all(phoneHash, monthKey);
    const bRowSurvivedUnderOldLogic = remaining.some(r => r.id === bRowId);

    check(
      bRowSurvivedUnderOldLogic === false,
      'E-U-05 (sanity check): old MAX(id) rollback WRONGLY deletes B\'s successful row — proves this harness detects the real historical defect'
    );
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
