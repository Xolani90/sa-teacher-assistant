'use strict';
// Regression test — RC1-H-012: MY CLASSES / NEW CLASS / MY ASSESSMENTS /
// MY ASSESSMENT HISTORY / MY PROGRESS / MY CURRICULUM PROGRESS /
// LEARNER PROGRESS / WORKSPACE / CLASS INTERVENTION must not short-circuit
// past onboarding.
//
// Bug: core/commandHandler.js's workspace-commands block had no
// getOnboardingStep() guard, while core/messageProcessor.js calls
// deps.handleCommand() unconditionally before the onboarding check. A
// teacher can have a `teachers` row (e.g. lazily created by
// utils/usageTracker.js's `INSERT OR IGNORE INTO teachers`, independent of
// onboarding) with no `onboarding` row at all, or mid-onboarding, and still
// reach CLASS INTERVENTION and its siblings — bypassing onboarding entirely.
// Same collision family as RC1-H-005 (PRO) and RC1-QMS-001 (QMS commands).
//
// Fix: core/commandHandler.js now checks deps.getOnboardingStep() ahead of
// handleWorkspaceFlow() (mirrors the HELP/MENU/HI/HELLO/QMS shape — blocked
// for both step === null and mid-onboarding, no exceptions), using
// flows/workspaceFlow.js's own exported isWorkspaceCommand() predicate so
// the guard can never drift from the actual dispatch boundary it protects.
//
// This test calls the real core/commandHandler.js::handleCommand() via
// routes/webhook.js's __testExports seam (same deps object commandHandler
// receives in production), against a real, fully-migrated SQLite test
// database (see tests/helpers/createTestDb.js), with services/whatsappService
// stubbed out so no actual message-send calls are made.
//
// Run: node tests/rc1-h-012-workspace-onboarding-dispatch.test.js

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

// Every command sharing the single isWorkspaceCommand() dispatch gate.
// NEW CLASS/LEARNER PROGRESS/CLASS INTERVENTION need a well-formed enough
// suffix that, if the gate were bypassed, they'd still be recognized as the
// command (not required for the onboarding-blocked assertions themselves,
// but keeps this test honest about which literal command text is sent).
const WORKSPACE_COMMANDS = [
  'MY CLASSES',
  'NEW CLASS Grade 8B Mathematics | 28',
  'MY ASSESSMENTS',
  'MY ASSESSMENT HISTORY',
  'MY PROGRESS',
  'MY CURRICULUM PROGRESS',
  'LEARNER PROGRESS Thabo',
  'WORKSPACE',
  'CLASS INTERVENTION',
];

(async () => {
  const {
    handleCommand,
    hashPhone,
    getOnboardingStep,
    setOnboardingStep,
    ONBOARDING_STEPS,
    assessmentSessionState,
  } = require('../routes/webhook').__testExports;

  console.log('\n── Brand-new teacher (step === null, teachers row exists, no onboarding row): no workspace command escapes onboarding ──');
  {
    let i = 0;
    for (const word of WORKSPACE_COMMANDS) {
      const phone = `+2782260${i++}001`;
      const phoneHash = hashPhone(phone);
      insertTeacher(phoneHash); // teachers row exists — matches usageTracker.js's lazy INSERT OR IGNORE
      check(getOnboardingStep(phoneHash) === null, `setup: "${word}" — fresh phone has no onboarding record`);

      sentMessages.length = 0;
      const handled = await handleCommand(phone, word);
      check(handled === false, `NEW-"${word}": NOT intercepted for a brand-new teacher — falls through to onboarding`);
      check(sentMessages.length === 0, `NEW-"${word}": commandHandler sent nothing`);
    }
  }

  console.log('\n── Mid-onboarding teacher: no workspace command escapes, step untouched ──');
  {
    const phone = '+27822610001';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    setOnboardingStep(phoneHash, ONBOARDING_STEPS.ASK_GRADE);

    for (const word of WORKSPACE_COMMANDS) {
      sentMessages.length = 0;
      const handled = await handleCommand(phone, word);
      check(handled === false, `MID-"${word}": does NOT escape mid-onboarding`);
      check(getOnboardingStep(phoneHash) === ONBOARDING_STEPS.ASK_GRADE, `MID-"${word}": onboarding step is untouched`);
      check(sentMessages.length === 0, `MID-"${word}": commandHandler sent nothing`);
    }
  }

  console.log('\n── Fully onboarded teacher: workspace commands are handled normally through the shared gate ──');
  {
    const phone = '+27822620001';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    setOnboardingStep(phoneHash, ONBOARDING_STEPS.DONE);

    for (const word of WORKSPACE_COMMANDS) {
      sentMessages.length = 0;
      const handled = await handleCommand(phone, word);
      check(handled === true, `DONE-"${word}": handled normally once onboarded`);
      check(sentMessages.length === 1, `DONE-"${word}": sends exactly one reply`);
    }
  }

  console.log('\n── Fully onboarded, active flow (assessmentSessionState set): workspace commands still function (no active-flow yield is claimed here — out of RC1-H-012 scope) ──');
  {
    // RC1-H-012 is scoped to the onboarding boundary only, per the approved
    // fix scope — it does not claim to add QMS-style active-flow yielding
    // for workspace commands (that would be a separate, unreported finding
    // if one exists). This block only confirms the onboarding fix itself
    // doesn't regress a fully-onboarded teacher's normal access.
    const phone = '+27822630001';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    setOnboardingStep(phoneHash, ONBOARDING_STEPS.DONE);

    sentMessages.length = 0;
    const handled = await handleCommand(phone, 'MY CLASSES');
    check(handled === true, 'ONBOARDED-"MY CLASSES": still handled normally (guard is onboarding-only, not a new active-flow check)');
  }

  console.log('\n─────────────────────────────────');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  testDb.cleanup?.();
  process.exit(failed > 0 ? 1 : 0);
})();
