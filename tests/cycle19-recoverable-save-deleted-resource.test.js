'use strict';
// Cycle 19 — SAVE RECOVERABLE retry must not falsely confirm a resource that
// was deleted (via the dashboard) in the window between DB commit and the
// teacher's next WhatsApp retry.
//
// Recon gap this closes: tests/rc1-save-whatsapp-failure-recovery.test.js
// proves the RECOVERABLE -> retry -> "Saved!" path when the resource still
// exists. It never covers the case where, in the window between the DB
// commit and the retry, the row is deleted out from under it — which is
// reachable because the row is genuinely live in the DB (and therefore
// visible/deletable via the dashboard) from the moment SAVE commits, even
// though the teacher has not yet received any WhatsApp confirmation that it
// happened. Before this fix, core/commandHandler.js's RECOVERABLE branch
// blindly re-sent "✅ *Saved!* ... Resource #<id>" from cached session state
// without re-checking the row still exists — a false positive that leaves
// the teacher told something is saved when it is not.
//
// Scenario:
//   1. Generation completes -> GENERATED state.
//   2. Teacher sends SAVE. DB commit succeeds. WhatsApp confirmation send
//      throws -> RECOVERABLE state, row exists.
//   3. Simulate the dashboard: deleteSavedResource() removes the row
//      directly (the same service function routes/api.js's DELETE handler
//      calls), while WhatsApp state is still RECOVERABLE.
//   4. Teacher retries SAVE. WhatsApp send would succeed this time.
//   5. Assert: NO "Saved!" confirmation is sent for the now-deleted
//      resource; an honest not-found notice is sent instead; in-memory
//      state is cleared (not left retrying forever); no new row is
//      recreated.
//
// Run: node tests/cycle19-recoverable-save-deleted-resource.test.js

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

  const { deleteSavedResource } = require('../services/teacherWorkspaceService');

  let msgCounter = 0;
  async function send(phone, body) {
    msgCounter += 1;
    await processMessage(makeMessage(phone, body, `msg-${msgCounter}`), buildProcessMessageDeps());
  }
  function lastMessage() {
    return sentMessages[sentMessages.length - 1]?.text || '';
  }

  console.log('\n── Cycle 19: RECOVERABLE SAVE retry after dashboard deletes the committed row ──\n');

  const phone = '+27821188002';
  const phoneHash = hashPhone(phone);
  insertTeacher(phoneHash);

  const { randomUUID } = require('crypto');
  const generationId = randomUUID();
  lastGeneratedState.set(phoneHash, {
    generationId,
    saveState: 'GENERATED',
    intent: {
      type: 'worksheet',
      topic: 'Decimals',
      grade: 7,
      subject: 'mathematics',
      term: 2,
      atpTopic: null,
      differentiation: null,
    },
    content: 'Full worksheet content for the deleted-during-recovery scenario.',
    lastActivity: Date.now(),
  });

  console.log('── Step 1: first SAVE — DB commit succeeds, WhatsApp send fails ──');
  failNextSend = true;
  sentMessages.length = 0;
  await send(phone, 'SAVE');

  check(countSavedResources(phoneHash) === 1, 'exactly one row was committed to saved_resources despite the send failure');
  const row1 = db.prepare(`SELECT * FROM saved_resources WHERE phone_hash = ?`).get(phoneHash);
  check(!!row1, 'the committed row is directly queryable in the DB');

  const stateAfterFailure = lastGeneratedState.get(phoneHash);
  check(stateAfterFailure && stateAfterFailure.saveState === 'RECOVERABLE',
    'state is tagged RECOVERABLE after DB commit + failed send',
    stateAfterFailure && stateAfterFailure.saveState);

  console.log('\n── Step 2: the dashboard deletes the row (same service call routes/api.js DELETE uses) ──');
  const deleted = deleteSavedResource(row1.id, phoneHash);
  check(deleted === true, 'dashboard-equivalent delete reports success');
  check(countSavedResources(phoneHash) === 0, 'row is genuinely gone from the DB before the WhatsApp retry');

  console.log('\n── Step 3: teacher retries SAVE — WhatsApp send would now succeed ──');
  sentMessages.length = 0;
  await send(phone, 'SAVE');

  check(sentMessages.length === 1, 'exactly one message sent on retry', JSON.stringify(sentMessages));
  check(!/✅ \*Saved!\*/.test(lastMessage()),
    'the retry does NOT send a false "Saved!" confirmation for the deleted resource',
    lastMessage());
  check(/removed before we could confirm|nothing to save|nothing to do here/i.test(lastMessage()),
    'the retry sends an honest notice that the resource is gone',
    lastMessage());

  console.log('\n── Step 4: no resurrection, no duplicate, state cleared ──');
  check(countSavedResources(phoneHash) === 0, 'no new row was recreated by the retry');
  check(lastGeneratedState.get(phoneHash) === undefined,
    'in-memory state is cleared, not left stuck retrying forever');

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
