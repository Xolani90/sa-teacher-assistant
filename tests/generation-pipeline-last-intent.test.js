'use strict';
// Generation Pipeline — centralized last_intent persistence regression test.
//
// Context: updateTeacherProfile(from, { last_intent }) used to be called
// independently at every triggerGeneration() call site in webhook.js /
// messageProcessor.js (main classification path, disambiguation follow-up,
// clarified-topic reply) — three copies of the same write, each one a spot
// where a future call site could forget it. It has since been centralized
// into a single call inside triggerGeneration() itself
// (core/generationPipeline.js), so the pipeline is responsible for its own
// side effect instead of relying on every caller to remember it.
//
// This test locks that in:
//   1. A single triggerGeneration() call persists last_intent exactly once,
//      with the correct JSON-serialized intent.
//   2. Two independent calls (standing in for two different entry paths —
//      main classification vs. a disambiguation/clarified-topic follow-up,
//      both of which now route through this same centralized call) each
//      update last_intent correctly, with the second overwriting the first.
//   3. last_intent is persisted even when the downstream AI generation call
//      itself fails — the write happens before generation, so a RETRY of a
//      failed generation still has something to retry.
//   4. last_intent is NOT persisted when the request is short-circuited by
//      the AI burst rate limiter, which returns before the persistence line
//      runs.
//
// This test loads the REAL routes/webhook.js (via its __testExports seam)
// against a real in-memory better-sqlite3 database, and stubs only the
// outbound AI and WhatsApp network calls — everything else (including the
// real utils/usageTracker.updateTeacherProfile and the real AI rate
// limiter) is the actual production code path. Follows the same
// Module._resolveFilename + require.cache convention as
// tests/phase1-delivery-rollback.test.js and tests/phase-d-payment-renewal.test.js.
//
// Run: node tests/generation-pipeline-last-intent.test.js

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
      grade TEXT,
      subject TEXT,
      language TEXT,
      is_pro INTEGER NOT NULL DEFAULT 0,
      pro_expires TEXT,
      phone_enc TEXT,
      opted_out INTEGER NOT NULL DEFAULT 0,
      last_intent TEXT,
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

// ── Stub services/whatsappService — always succeeds, just records calls ────
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

// ── Stub services/aiService — controllable generation success/failure ──────
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

// ── Install the module-resolution override BEFORE requiring usageTracker,
// so usageTracker's own internal `require('./database')` resolves to our
// in-memory test DB rather than the real on-disk one. (Requiring
// usageTracker first and patching resolution second — the natural-seeming
// order — silently binds it to the real database.js instead, since Node
// resolves and caches a module's own internal requires at require-time.)
const usageTrackerPath = path.resolve(__dirname, '../utils/usageTracker');

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === '../utils/database' || request === './database') return dbPath;
  if (request === './whatsappService' || request === '../services/whatsappService') return whatsappPath;
  if (request === './aiService' || request === '../services/aiService') return aiServicePath;
  if (request === './usageTracker' || request === '../utils/usageTracker') return usageTrackerPath;
  return origResolve.call(this, request, ...rest);
};

// Require the real module by its actual file path (with extension) so this
// specific require bypasses the request-string override above and loads
// for real — its internal `require('./database')` still resolves through
// the override to our in-memory test DB, since that's a different request.
const realUsageTracker = require(usageTrackerPath + '.js');
let lastIntentCallCount = 0;
const usageTrackerStub = {
  id: usageTrackerPath, filename: usageTrackerPath, loaded: true,
  exports: {
    ...realUsageTracker,
    updateTeacherProfile: (phoneNumber, fields) => {
      if (fields && Object.prototype.hasOwnProperty.call(fields, 'last_intent')) {
        lastIntentCallCount += 1;
      }
      return realUsageTracker.updateTeacherProfile(phoneNumber, fields);
    },
  },
};
// Register under both the extension-less path (what the override above
// hands back to other modules' `require('../utils/usageTracker')` calls)
// and the real file path, so either lookup hits the stub.
require.cache[usageTrackerPath] = usageTrackerStub;
require.cache[usageTrackerPath + '.js'] = usageTrackerStub;

function hashPhoneForTest(phone) {
  const crypto = require('crypto');
  const normalized = phone.trim().replace(/^\+/, '');
  return crypto.createHmac('sha256', process.env.PII_SECRET).update(normalized).digest('hex');
}

function getLastIntent(phoneHash) {
  const row = db.prepare(`SELECT last_intent FROM teachers WHERE phone_hash = ?`).get(phoneHash);
  return row ? row.last_intent : null;
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
  const { triggerGeneration, buildGenerationDeps } = require('../routes/webhook').__testExports;

  console.log('\n── Section 1: a single generation call persists last_intent exactly once ──');
  {
    const phone = '+27821150001';
    const phoneHash = hashPhoneForTest(phone);
    lastIntentCallCount = 0;
    generationShouldFail = false;

    const intent = makeIntent({ topic: 'Fractions' });
    await triggerGeneration({ from: phone, intent, deps: buildGenerationDeps() });

    check(lastIntentCallCount === 1, 'G-01: updateTeacherProfile called exactly once with last_intent');
    check(getLastIntent(phoneHash) === JSON.stringify(intent), 'G-02: persisted last_intent matches the exact intent passed in');
  }

  console.log('\n── Section 2: two calls simulate two different entry paths (main classification + follow-up) ──');
  {
    const phone = '+27821150002';
    const phoneHash = hashPhoneForTest(phone);
    generationShouldFail = false;

    // "Main classification path"
    lastIntentCallCount = 0;
    const firstIntent = makeIntent({ type: 'worksheet', topic: 'Algebra' });
    await triggerGeneration({ from: phone, intent: firstIntent, deps: buildGenerationDeps() });
    check(lastIntentCallCount === 1, 'G-03: first call (main classification path) persists last_intent exactly once');
    check(getLastIntent(phoneHash) === JSON.stringify(firstIntent), 'G-04: last_intent reflects the first call\'s intent');

    // "Disambiguation / clarified-topic follow-up" — a second, independent
    // call through the same centralized triggerGeneration() entry point.
    lastIntentCallCount = 0;
    const secondIntent = makeIntent({ type: 'test', topic: 'Quadratic equations', marks: 20 });
    await triggerGeneration({ from: phone, intent: secondIntent, deps: buildGenerationDeps() });
    check(lastIntentCallCount === 1, 'G-05: second call (follow-up path) also persists last_intent exactly once');
    check(getLastIntent(phoneHash) === JSON.stringify(secondIntent), 'G-06: last_intent overwritten with the second call\'s intent, not stale');
  }

  console.log('\n── Section 3: last_intent is persisted even when generation itself later fails ──');
  {
    const phone = '+27821150003';
    const phoneHash = hashPhoneForTest(phone);
    lastIntentCallCount = 0;
    generationShouldFail = true;

    const intent = makeIntent({ topic: 'Geometry' });
    await triggerGeneration({ from: phone, intent, deps: buildGenerationDeps() });

    check(lastIntentCallCount === 1, 'G-07: last_intent still persisted once even though AI generation failed');
    check(getLastIntent(phoneHash) === JSON.stringify(intent), 'G-08: persisted last_intent matches the intent, ready for a RETRY');
    generationShouldFail = false;
  }

  console.log('\n── Section 4: rate-limited requests never reach the persistence line ──');
  {
    const phone = '+27821150004';
    const phoneHash = hashPhoneForTest(phone);
    generationShouldFail = false;

    // Exhaust the AI burst rate limit (5 calls / 60s window — see
    // utils/webhookHelpers.js AI_RATE_LIMIT) with real generation calls,
    // each persisting its own intent.
    let lastAllowedIntent = null;
    for (let i = 0; i < 5; i++) {
      lastAllowedIntent = makeIntent({ topic: `Topic ${i}` });
      await triggerGeneration({ from: phone, intent: lastAllowedIntent, deps: buildGenerationDeps() });
    }
    check(getLastIntent(phoneHash) === JSON.stringify(lastAllowedIntent), 'G-09: setup — last_intent reflects the 5th (final allowed) call');

    // The 6th call within the same window must be rate-limited and must
    // NOT reach (or execute) the updateTeacherProfile persistence line.
    lastIntentCallCount = 0;
    const rateLimitedIntent = makeIntent({ topic: 'Should never persist' });
    await triggerGeneration({ from: phone, intent: rateLimitedIntent, deps: buildGenerationDeps() });

    check(lastIntentCallCount === 0, 'G-10: rate-limited 6th call never calls updateTeacherProfile with last_intent');
    check(getLastIntent(phoneHash) === JSON.stringify(lastAllowedIntent), 'G-11: last_intent still reflects the 5th call, unchanged by the rate-limited 6th');
    check(sentMessages.some(m => m.phone === phone && m.text.includes('sending requests too quickly')), 'G-12: teacher was told to slow down (sanity check this really was the rate-limit path)');
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
