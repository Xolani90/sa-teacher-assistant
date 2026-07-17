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
// rollbackUsage() deletes the exact usage_events row this request created
// (quota.insertedRowId), and a best-effort apology is sent.
//
// This test loads the REAL routes/webhook.js (via its __testExports seam)
// against a real in-memory better-sqlite3 database and stubs only the
// outbound AI and WhatsApp network calls — everything else is the actual
// production code path. Follows the same Module._resolveFilename +
// require.cache convention as tests/phase-d-payment-renewal.test.js.
//
// Run: node tests/phase1-delivery-rollback.test.js

process.env.PII_SECRET  = 'test-secret-key-32-bytes-long!!';
process.env.FREE_LIMIT  = '10';
process.env.APP_URL     = 'https://example.test';
process.env.PDF_SECRET  = 'pdf-secret';

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
      name TEXT,
      grade INTEGER,
      subject TEXT,
      language TEXT,
      is_pro INTEGER NOT NULL DEFAULT 0,
      pro_expires TEXT,
      phone_enc TEXT,
      opted_out INTEGER NOT NULL DEFAULT 0,
      last_assessment_id INTEGER,
      renewal_reminder_sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash TEXT NOT NULL,
      month_key TEXT NOT NULL,
      intent_type TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE rate_limit_events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash    TEXT    NOT NULL,
      limiter_type  TEXT    NOT NULL,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_rate_limit_events_lookup
      ON rate_limit_events(phone_hash, limiter_type, created_at);
    CREATE TABLE sessions (
      phone_hash    TEXT    NOT NULL,
      session_type  TEXT    NOT NULL,
      state         TEXT    NOT NULL,
      updated_at    REAL    NOT NULL,
      PRIMARY KEY (phone_hash, session_type)
    );
    CREATE INDEX idx_sessions_updated
      ON sessions(updated_at);
  `);
  return db;
}

const db = buildDb();

// ── Patch utils/database to return our in-memory db ─────────────────────────
const dbPath = path.resolve(__dirname, '../utils/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getDb: () => db } };

// ── Stub services/whatsappService — controllable send behavior ─────────────
const sentMessages = [];
let sendShouldFailOnCallNumber = null; // e.g. 2 = the 2nd sendMessage call throws
let sendCallCount = 0;
const whatsappPath = path.resolve(__dirname, '../services/whatsappService');
require.cache[whatsappPath] = {
  id: whatsappPath, filename: whatsappPath, loaded: true,
  exports: {
    sendMessage: async (phone, text) => {
      sendCallCount += 1;
      sentMessages.push({ phone, text, callNumber: sendCallCount });
      if (sendShouldFailOnCallNumber === sendCallCount) {
        throw new Error('Simulated WhatsApp delivery failure');
      }
      return true;
    },
    sendDocument: async () => true,
    downloadMedia: async () => null,
    chunkMessage: (t) => [t],
  },
};

// ── Stub services/aiService — controllable generation behavior ─────────────
let generationShouldFail = false;
const aiServicePath = path.resolve(__dirname, '../services/aiService');
require.cache[aiServicePath] = {
  id: aiServicePath, filename: aiServicePath, loaded: true,
  exports: {
    generateContent: async (prompt, intentType) => {
      if (generationShouldFail) throw new Error('Simulated AI generation failure');
      return `Generated ${intentType} content for prompt of length ${prompt.length}`;
    },
  },
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === '../utils/database' || request === './database') return dbPath;
  if (request === './whatsappService' || request === '../services/whatsappService') return whatsappPath;
  if (request === './aiService' || request === '../services/aiService') return aiServicePath;
  return origResolve.call(this, request, ...rest);
};

function hashPhoneForTest(phone) {
  const crypto = require('crypto');
  const normalized = phone.trim().replace(/^\+/, '');
  return crypto.createHmac('sha256', process.env.PII_SECRET).update(normalized).digest('hex');
}

function countUsageEvents(phoneHash) {
  return db.prepare(`SELECT COUNT(*) as c FROM usage_events WHERE phone_hash = ?`).get(phoneHash).c;
}

function makeIntent(overrides = {}) {
  return {
    type: 'worksheet',
    grade: 7,
    subject: 'mathematics',
    topic: 'Fractions',
    marks: null,
    ...overrides,
  };
}

(async () => {
  const { processGeneration } = require('../routes/webhook').__testExports;

  console.log('\n── Phase 1: generation succeeds, delivery fails → usage must roll back ──');
  {
    const phone = '+27821140001';
    const phoneHash = hashPhoneForTest(phone);

    generationShouldFail = false;
    sendCallCount = 0;
    sentMessages.length = 0;
    // Call sequence for this intent: 1) "Generating..." ack, 2) final content.
    // Fail the 2nd call (final content delivery) — the ack itself must succeed.
    sendShouldFailOnCallNumber = 2;

    await processGeneration(phone, makeIntent());

    check(countUsageEvents(phoneHash) === 0, 'P1-01: usage_events row rolled back after delivery failure (0 rows remain)');
    check(sentMessages.length === 3, 'P1-02: three messages attempted — ack, failed final content (still recorded as attempted), apology');
    const apology = sentMessages[sentMessages.length - 1];
    check(apology.text.includes('Something went wrong'), 'P1-03: best-effort apology message sent after rollback');
  }

  console.log('\n── Phase 1: generation succeeds, delivery succeeds → usage must be committed ──');
  {
    const phone = '+27821140002';
    const phoneHash = hashPhoneForTest(phone);

    generationShouldFail = false;
    sendCallCount = 0;
    sentMessages.length = 0;
    sendShouldFailOnCallNumber = null; // no failures

    await processGeneration(phone, makeIntent());

    check(countUsageEvents(phoneHash) === 1, 'P1-04: usage_events row committed (1 row) when delivery succeeds');
    // The generated content is delivered, but processGeneration continues
    // afterward (e.g. offering a PDF download) — so check the content was
    // sent SOMEWHERE in the sequence, not that it's necessarily the last message.
    const contentWasSent = sentMessages.some(m => m.text.includes('Generated worksheet content'));
    check(contentWasSent, 'P1-05: the generated content was actually sent, not silently dropped');
    const apologyWasSent = sentMessages.some(m => m.text.includes('Something went wrong'));
    check(!apologyWasSent, 'P1-05b: no apology message sent on the successful-delivery path');
  }

  console.log('\n── Phase 1 (existing behavior, unaffected): AI generation itself failing still rolls back ──');
  {
    const phone = '+27821140003';
    const phoneHash = hashPhoneForTest(phone);

    generationShouldFail = true;
    sendCallCount = 0;
    sentMessages.length = 0;
    sendShouldFailOnCallNumber = null;

    await processGeneration(phone, makeIntent());

    check(countUsageEvents(phoneHash) === 0, 'P1-06: usage_events row rolled back when generateContent() itself fails (pre-existing behavior)');
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
