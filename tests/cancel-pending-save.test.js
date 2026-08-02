'use strict';
// Regression test — CANCEL must dismiss a pending SAVE prompt.
//
// Bug (fixed 2026-07-23): after generating a resource, the teacher is
// invited to reply SAVE to keep it. lastGeneratedState isn't part of the
// `alreadyMidFlow` set (it's a one-shot prompt, not a multi-turn
// conversation), so a bare "Cancel" fell straight through handleCommand()
// to generic AI intent classification, which has no notion of a pending
// save prompt and replied with a confusing "did you mean to cancel
// something?" check-in instead of actually dismissing it.
//
// Fix: handleCommand() now recognizes CANCEL explicitly when
// lastGeneratedState has saveState === 'GENERATED', clears it, and confirms
// nothing was saved.
//
// This test loads the REAL routes/webhook.js (via its __testExports seam)
// against a real, fully-migrated SQLite test database (see
// tests/helpers/createTestDb.js), with services/whatsappService stubbed out
// so no actual message-send calls are made.
//
// Run: node tests/cancel-pending-save.test.js

process.env.PII_SECRET = 'test-secret-key-32-bytes-long!!';
process.env.FREE_LIMIT = '10';
process.env.APP_URL    = 'https://example.test';
process.env.PDF_SECRET = 'pdf-secret';

const Module = require('module');
const path = require('path');

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

// ── Stub services/whatsappService — just record sends, never actually send ──
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

function insertTeacher(phoneHash) {
  db.prepare(`INSERT INTO teachers (phone_hash, name) VALUES (?, ?)`).run(phoneHash, 'Test Teacher');
}

function countSavedResources(phoneHash) {
  return db.prepare(`SELECT COUNT(*) as c FROM saved_resources WHERE phone_hash = ?`).get(phoneHash).c;
}

(async () => {
  const {
    handleCommand,
    hashPhone,
    lastGeneratedState,
  } = require('../routes/webhook').__testExports;

  console.log('\n── CANCEL dismisses a pending SAVE prompt ──');
  {
    const phone = '+27821160001';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);

    // Simulate the state left behind right after a generation completes —
    // the exact shape processGeneration()/triggerGeneration() writes.
    lastGeneratedState.set(phoneHash, {
      saveState: 'GENERATED',
      generationId: 'gen-test-001',
      resourceType: 'worksheet',
      title: 'Fractions — worksheet',
      content: 'Some generated worksheet content',
      intent: { type: 'worksheet', grade: 7, subject: 'mathematics', topic: 'Fractions' },
    });
    check(lastGeneratedState.get(phoneHash) != null, 'setup: pending save state exists before CANCEL');

    sentMessages.length = 0;
    const handled = await handleCommand(phone, 'CANCEL');

    check(handled === true, 'C-01: CANCEL is recognized and handled by handleCommand');
    check(lastGeneratedState.get(phoneHash) === undefined, 'C-02: lastGeneratedState is cleared after CANCEL');
    check(sentMessages.length === 1, 'C-03: CANCEL sends exactly one confirmation reply');
    check(/not saved/i.test(sentMessages[0].text), 'C-04: confirmation reply says the resource was not saved');
  }

  console.log('\n── No resource was actually saved to the database ──');
  {
    const phone = '+27821160001';
    const phoneHash = hashPhone(phone);
    check(countSavedResources(phoneHash) === 0, 'D-01: zero rows in saved_resources — CANCEL never touched the DB');
  }

  console.log('\n── A subsequent SAVE does not act on the cancelled prompt ──');
  {
    const phone = '+27821160001';
    const phoneHash = hashPhone(phone);

    sentMessages.length = 0;
    const handled = await handleCommand(phone, 'SAVE');

    check(handled === true, 'F-01: SAVE is still handled (as a safe no-op)');
    check(/nothing to save/i.test(sentMessages[0].text), 'F-02: SAVE reports nothing to save — it does not resurrect the cancelled generation');
    check(countSavedResources(phoneHash) === 0, 'F-03: still zero rows in saved_resources after the follow-up SAVE');
  }

  console.log('\n── CANCEL with no pending save prompt falls through (not swallowed) ──');
  {
    const phone = '+27821160002';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);

    // No lastGeneratedState set for this phone at all.
    check(lastGeneratedState.get(phoneHash) === undefined, 'setup: no pending save state for this phone');

    const handled = await handleCommand(phone, 'CANCEL');
    check(handled === false, 'N-01: CANCEL with nothing pending is NOT swallowed by this branch — falls through to other handlers (e.g. flow-specific CANCEL logic)');
  }

  console.log('\n── CANCEL does not fire on a RECOVERABLE (mid-retry) save state ──');
  {
    const phone = '+27821160003';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);

    // RECOVERABLE means the DB row already committed but WhatsApp delivery
    // of the confirmation failed — cancelling here must not silently discard
    // a resource that's already safely in the database.
    lastGeneratedState.set(phoneHash, {
      saveState: 'RECOVERABLE',
      generationId: 'gen-test-003',
      lastSavedId: 42,
    });

    const handled = await handleCommand(phone, 'CANCEL');
    check(handled === false, 'RC-01: CANCEL does not intercept a RECOVERABLE state — only GENERATED (unsaved) prompts are cancellable');
    check(lastGeneratedState.get(phoneHash) != null, 'RC-02: RECOVERABLE state is left untouched, so the retry path can still confirm the already-saved resource');
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
