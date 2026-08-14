'use strict';
// RC1 — SAVE: WhatsApp confirmation failure after DB commit → RECOVERABLE → retry.
//
// Recon gap this closes: tests/phase-b3-resilience.test.js, phase-b4-state-machine.test.js,
// phase-b5-concurrency.test.js, and phase-c2-recoverable-lock.test.js all prove the
// GENERATED -> SAVING -> RECOVERABLE -> SAVED state machine via `simulateSave*`
// helper functions that REIMPLEMENT commandHandler.js's branching logic inside the
// test file itself. That proves internal consistency of the simulated model, not
// that core/commandHandler.js's actual SAVE branch behaves this way.
//
// This test exercises the REAL dispatch chain (processMessage -> commandHandler ->
// teacherWorkspaceService -> DB) against a real-migration SQLite DB, with the stubbed
// whatsappService.sendMessage throwing on the first SAVE confirmation attempt only
// (simulating WhatsApp delivery failure, not a code-level simulation of the state
// machine). This directly validates the RECOVERABLE-branch architectural claim.
//
// Scenario:
//   1. Generation completes -> GENERATED state (mirrors generationPipeline.js output).
//   2. Teacher sends SAVE. DB commit succeeds (saveResource() persists the row).
//      The WhatsApp confirmation send throws.
//   3. Assert: exactly one row exists in saved_resources; in-memory state is RECOVERABLE.
//   4. Teacher retries SAVE. This time the send succeeds.
//   5. Assert: retry re-sends the "Saved!" confirmation referencing the SAME resource id;
//      no second INSERT occurred (row count still 1); in-memory state is cleared.
//   6. MY RESOURCES (real dispatch chain) shows exactly one saved resource.
//
// Run: node tests/rc1-save-whatsapp-failure-recovery.test.js

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

// ── Stub services/whatsappService — controllable failure on demand ─────────
// Unlike other regression tests in this suite, this stub can be told to
// throw on the NEXT sendMessage call only, so we can fail exactly the SAVE
// confirmation send and nothing else (e.g. the "Reply SAVE" nudge from
// generation, which this test bypasses by seeding GENERATED state directly,
// same pattern as rc1-h-006-save-roster-collision.test.js scenario 4).
const sentMessages = [];
let failNextSend = false;
const whatsappPath = path.resolve(__dirname, '../services/whatsappService');
require.cache[whatsappPath] = {
  id: whatsappPath, filename: whatsappPath, loaded: true,
  exports: {
    sendMessage: async (phone, text) => {
      if (failNextSend) {
        failNextSend = false;
        throw new Error('simulated WhatsApp delivery failure');
      }
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

function countSavedResources(phoneHash) {
  return db.prepare(`SELECT COUNT(*) as c FROM saved_resources WHERE phone_hash = ?`).get(phoneHash).c;
}

function makeMessage(from, body, id) {
  return { from, id, type: 'text', text: { body } };
}

(async () => {
  const {
    hashPhone,
    lastGeneratedState,
    processMessage,
    buildProcessMessageDeps,
  } = require('../routes/webhook').__testExports;

  let msgCounter = 0;
  async function send(phone, body) {
    msgCounter += 1;
    await processMessage(makeMessage(phone, body, `msg-${msgCounter}`), buildProcessMessageDeps());
  }
  function lastMessage() {
    return sentMessages[sentMessages.length - 1]?.text || '';
  }

  console.log('\n── RC1 SAVE: WhatsApp failure after DB commit -> RECOVERABLE -> retry (real dispatch chain) ──\n');

  const phone = '+27821188001';
  const phoneHash = hashPhone(phone);
  insertTeacher(phoneHash);

  // Seed GENERATED state exactly as generationPipeline.js constructs it
  // (already directly inspected via code recon in the prior step).
  const { randomUUID } = require('crypto');
  const generationId = randomUUID();
  lastGeneratedState.set(phoneHash, {
    generationId,
    saveState: 'GENERATED',
    intent: {
      type: 'worksheet',
      topic: 'Fractions',
      grade: 7,
      subject: 'mathematics',
      term: 2,
      atpTopic: null,
      differentiation: null,
    },
    content: 'Full worksheet content for WhatsApp-failure-recovery scenario.',
    lastActivity: Date.now(),
  });

  console.log('── Step 1: first SAVE — DB commit succeeds, WhatsApp send fails ──');
  failNextSend = true;
  sentMessages.length = 0;
  await send(phone, 'SAVE');

  // commandHandler.js's catch block correctly attempts a fallback notice to
  // the teacher when the confirmation send itself throws — so this failure
  // produces ONE message (the fallback "couldn't save" notice), not zero.
  // The "Saved!" confirmation itself was never delivered; that's the
  // failure being simulated. The fallback message is a distinct, deliberate
  // safety behavior in the real handler, not the DB-persisted confirmation.
  check(sentMessages.length === 1, 'exactly one message was delivered: the fallback failure notice (not the Saved! confirmation)', JSON.stringify(sentMessages));
  check(sentMessages.length === 1 && /couldn.?t save/i.test(sentMessages[0].text),
    'the delivered message is the fallback "couldn\'t save" notice, not a false Saved! confirmation',
    sentMessages[0] && sentMessages[0].text);
  check(countSavedResources(phoneHash) === 1, 'exactly one row was committed to saved_resources despite the send failure');

  const stateAfterFailure = lastGeneratedState.get(phoneHash);
  check(!!stateAfterFailure, 'in-memory state still present after failed send (not cleared)');
  check(stateAfterFailure && stateAfterFailure.saveState === 'RECOVERABLE',
    'state is tagged RECOVERABLE after DB commit + failed send',
    stateAfterFailure && stateAfterFailure.saveState);
  check(stateAfterFailure && stateAfterFailure.generationId === generationId,
    'RECOVERABLE state retains the original generationId');

  const row1 = db.prepare(`SELECT * FROM saved_resources WHERE phone_hash = ?`).get(phoneHash);
  check(!!row1, 'the committed row is directly queryable in the DB');
  check(stateAfterFailure && stateAfterFailure.lastSavedId === (row1 && row1.id),
    'RECOVERABLE state.lastSavedId matches the actual DB row id', JSON.stringify({ state: stateAfterFailure && stateAfterFailure.lastSavedId, row: row1 && row1.id }));

  console.log('\n── Step 2: retry SAVE — WhatsApp send now succeeds ──');
  sentMessages.length = 0;
  await send(phone, 'SAVE');

  check(sentMessages.length === 1, 'retry sends exactly one confirmation message');
  check(/Saved!/i.test(lastMessage()), 'retry confirmation message says Saved!', lastMessage());
  check(row1 && lastMessage().includes(`#${row1.id}`),
    'retry confirmation references the SAME resource id as the original commit (no new resource implied)',
    lastMessage());

  console.log('\n── Step 3: no duplicate row; state cleared ──');
  check(countSavedResources(phoneHash) === 1, 'row count is still exactly 1 after retry — no duplicate INSERT occurred');
  check(lastGeneratedState.get(phoneHash) === undefined, 'in-memory state is cleared after the retry succeeds');

  console.log('\n── Step 4: MY RESOURCES (real dispatch chain) reflects exactly one saved resource ──');
  sentMessages.length = 0;
  await send(phone, 'MY RESOURCES');
  const myResourcesMsg = lastMessage();
  check(/\(1 saved\)/.test(myResourcesMsg), 'MY RESOURCES reports exactly 1 saved resource', myResourcesMsg);
  check(myResourcesMsg.includes('Fractions'), 'MY RESOURCES lists the correct resource title', myResourcesMsg);
  check(row1 && myResourcesMsg.includes(`[${row1.id}]`), 'MY RESOURCES shows the same id as the DB row');

  console.log(`\n─────────────────────────────────`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`─────────────────────────────────\n`);

  testDb.cleanup();
  if (failed > 0) process.exit(1);
  process.exit(0);
})().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
