'use strict';
// Regression test — RC1-H-005: HELP/MENU/HI/HELLO must not short-circuit
// past onboarding for a teacher who hasn't completed it.
//
// Bug: core/messageProcessor.js calls deps.handleCommand() unconditionally,
// before deps.needsOnboarding() is ever checked. core/commandHandler.js's
// HELP/MENU/HI/HELLO branch exact-matched those four strings and returned
// `true` (handled) with no awareness of onboarding state at all — so a
// brand-new teacher's first "hi" or "hello" (or HELP/MENU) never reached
// onboarding; it got the full command menu instead. "hey" happened to work
// only because it isn't one of the four aliased strings.
//
// services/onboardingService.js already encodes the intended rule, just
// unreachable because commandHandler.js ran first:
//   - a brand-new teacher (onboarding step === null) gets NO escape at all,
//     not even via HELP/PRO/STATUS/PROFILE.
//   - mid-onboarding (step set, not DONE), only PRO/STATUS/HELP/PROFILE are
//     valid escape hatches — MENU/HI/HELLO are not in that list.
//
// Fix: core/commandHandler.js's HELP/MENU/HI/HELLO branch now checks
// deps.getOnboardingStep() before intercepting. step === null returns false
// (not handled) unconditionally. Mid-onboarding, only HELP falls through to
// the normal menu (and marks onboarding DONE, mirroring
// onboardingService.js's own escape-hatch behavior) — MENU/HI/HELLO return
// false so the flow's own step handler processes them instead.
//
// This test loads the REAL routes/webhook.js (via its __testExports seam)
// against a real, fully-migrated SQLite test database (see
// tests/helpers/createTestDb.js), with services/whatsappService stubbed out
// so no actual message-send calls are made.
//
// Run: node tests/onboarding-command-precedence.test.js

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

(async () => {
  const {
    handleCommand,
    hashPhone,
    getOnboardingStep,
    setOnboardingStep,
    ONBOARDING_STEPS,
  } = require('../routes/webhook').__testExports;

  console.log('\n── Brand-new teacher (step === null): no escape via any alias ──');
  for (const word of ['HI', 'HELLO', 'MENU', 'HELP']) {
    const phone = `+2782200${['HI','HELLO','MENU','HELP'].indexOf(word)}001`;
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    check(getOnboardingStep(phoneHash) === null, `setup: ${word} — fresh phone has no onboarding record`);

    sentMessages.length = 0;
    const handled = await handleCommand(phone, word);
    check(handled === false, `NEW-${word}: "${word}" is NOT intercepted for a brand-new teacher — falls through to onboarding`);
    check(sentMessages.length === 0, `NEW-${word}: commandHandler sent nothing (messageProcessor's onboarding branch owns the reply)`);
  }

  console.log('\n── Mid-onboarding teacher: only HELP escapes, MENU/HI/HELLO do not ──');
  {
    const phone = '+27822010001';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    setOnboardingStep(phoneHash, ONBOARDING_STEPS.ASK_GRADE);

    for (const word of ['MENU', 'HI', 'HELLO']) {
      sentMessages.length = 0;
      const handled = await handleCommand(phone, word);
      check(handled === false, `MID-${word}: "${word}" does NOT escape mid-onboarding (not in the escape-hatch list)`);
      check(getOnboardingStep(phoneHash) === ONBOARDING_STEPS.ASK_GRADE, `MID-${word}: onboarding step is untouched`);
    }

    sentMessages.length = 0;
    const handled = await handleCommand(phone, 'HELP');
    check(handled === true, 'MID-HELP: HELP is handled (valid escape hatch)');
    check(sentMessages.length === 1, 'MID-HELP: sends the command menu');
    check(getOnboardingStep(phoneHash) === ONBOARDING_STEPS.DONE, 'MID-HELP: exiting via HELP marks onboarding DONE');
  }

  console.log('\n── Fully onboarded teacher: HELP/MENU/HI/HELLO all work normally ──');
  {
    const phone = '+27822020001';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    setOnboardingStep(phoneHash, ONBOARDING_STEPS.DONE);

    for (const word of ['HELP', 'MENU', 'HI', 'HELLO']) {
      sentMessages.length = 0;
      const handled = await handleCommand(phone, word);
      check(handled === true, `DONE-${word}: "${word}" is handled normally once onboarding is complete`);
      check(sentMessages.length === 1, `DONE-${word}: sends the command menu`);
    }
  }

  console.log('\n── Anchor case: "hey" (not an aliased word) always falls through ──');
  {
    const phone = '+27822030001';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);

    const handled = await handleCommand(phone, 'hey');
    check(handled === false, 'HEY-01: "hey" was never intercepted (kept as a regression anchor)');
  }

  console.log('\n── Brand-new teacher: PRO/STATUS/PROFILE also get no escape (proactive audit) ──');
  for (const word of ['PRO', 'STATUS', 'PROFILE']) {
    const phone = `+2782204${word.length}001`;
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    check(getOnboardingStep(phoneHash) === null, `setup: ${word} — fresh phone has no onboarding record`);

    sentMessages.length = 0;
    const handled = await handleCommand(phone, word);
    check(handled === false, `NEW-${word}: "${word}" is NOT intercepted for a brand-new teacher — falls through to onboarding`);
  }

  console.log('\n─────────────────────────────────');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  testDb.cleanup?.();
  process.exit(failed > 0 ? 1 : 0);
})();
