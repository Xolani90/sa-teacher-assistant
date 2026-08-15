'use strict';
// Regression test — RC1-QMS-001: MY STATS / MY STATS ALL / MY GOALS /
// MY REFLECTIONS / MY COACHING must not short-circuit past onboarding, and
// must not hijack the turn from an active multi-turn flow.
//
// Bug: core/commandHandler.js's QMS block had no getOnboardingStep() guard
// and no active-flow guard, while core/messageProcessor.js calls
// deps.handleCommand() unconditionally before both the onboarding check and
// the alreadyMidFlow dispatch. QMS is not on onboardingService.js's own
// escape-hatch list (only PRO/STATUS/HELP/PROFILE are), so:
//   - brand-new teacher (step === null): QMS commands answered instead of
//     starting onboarding.
//   - mid-onboarding (step set, not DONE): same — onboarding step never
//     advanced.
//   - mid-flow (e.g. REFLECT awaiting input): QMS hijacked the turn,
//     abandoning the in-progress flow — same collision family as
//     RC1-H-004/H-005/H-006, not limited to onboarding.
//
// Fix: core/commandHandler.js's QMS block now checks deps.getOnboardingStep()
// (mirrors the HELP/MENU/HI/HELLO shape — blocked for both step === null and
// mid-onboarding, no exceptions) and yields to an active flow using the same
// state-list check STATUS already uses (assessmentSessionState,
// blueprintAuthoringState, reflectionState, growthPlanState).
//
// This test calls the real core/commandHandler.js::handleCommand() via
// routes/webhook.js's __testExports seam (same deps object commandHandler
// receives in production), against a real, fully-migrated SQLite test
// database (see tests/helpers/createTestDb.js), with services/whatsappService
// stubbed out so no actual message-send calls are made.
//
// Run: node tests/rc1-qms-onboarding-dispatch.test.js

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

const QMS_COMMANDS = ['MY STATS', 'MY STATS ALL', 'MY GOALS', 'MY REFLECTIONS', 'MY COACHING'];

(async () => {
  const {
    handleCommand,
    hashPhone,
    getOnboardingStep,
    setOnboardingStep,
    ONBOARDING_STEPS,
    assessmentSessionState,
  } = require('../routes/webhook').__testExports;

  console.log('\n── Brand-new teacher (step === null): no QMS command escapes onboarding ──');
  {
    let i = 0;
    for (const word of QMS_COMMANDS) {
      const phone = `+2782250${i++}001`;
      const phoneHash = hashPhone(phone);
      insertTeacher(phoneHash);
      check(getOnboardingStep(phoneHash) === null, `setup: "${word}" — fresh phone has no onboarding record`);

      sentMessages.length = 0;
      const handled = await handleCommand(phone, word);
      check(handled === false, `NEW-"${word}": NOT intercepted for a brand-new teacher — falls through to onboarding`);
      check(sentMessages.length === 0, `NEW-"${word}": commandHandler sent nothing`);
    }
  }

  console.log('\n── Mid-onboarding teacher: no QMS command escapes, step untouched ──');
  {
    const phone = '+27822510001';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    setOnboardingStep(phoneHash, ONBOARDING_STEPS.ASK_GRADE);

    for (const word of QMS_COMMANDS) {
      sentMessages.length = 0;
      const handled = await handleCommand(phone, word);
      check(handled === false, `MID-"${word}": does NOT escape mid-onboarding`);
      check(getOnboardingStep(phoneHash) === ONBOARDING_STEPS.ASK_GRADE, `MID-"${word}": onboarding step is untouched`);
      check(sentMessages.length === 0, `MID-"${word}": commandHandler sent nothing`);
    }
  }

  console.log('\n── Fully onboarded, active flow (assessmentSessionState set): QMS yields ──');
  {
    const phone = '+27822520001';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    setOnboardingStep(phoneHash, ONBOARDING_STEPS.DONE);
    assessmentSessionState.set(phoneHash, { step: 'AWAITING_MARKS' });

    for (const word of QMS_COMMANDS) {
      sentMessages.length = 0;
      const handled = await handleCommand(phone, word);
      check(handled === false, `FLOW-"${word}": yields to the active flow instead of hijacking the turn`);
      check(sentMessages.length === 0, `FLOW-"${word}": commandHandler sent nothing`);
    }
    assessmentSessionState.delete(phoneHash);
  }

  console.log('\n── Fully onboarded, no active flow: QMS commands are handled normally ──');
  {
    const phone = '+27822530001';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    setOnboardingStep(phoneHash, ONBOARDING_STEPS.DONE);

    for (const word of QMS_COMMANDS) {
      sentMessages.length = 0;
      const handled = await handleCommand(phone, word);
      check(handled === true, `DONE-"${word}": handled normally once onboarded with no active flow`);
      check(sentMessages.length === 1, `DONE-"${word}": sends exactly one reply`);
    }
  }

  console.log('\n─────────────────────────────────');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  testDb.cleanup?.();
  process.exit(failed > 0 ? 1 : 0);
})();
