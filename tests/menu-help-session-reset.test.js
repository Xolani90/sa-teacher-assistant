'use strict';
// Regression test — MENU/HELP must clear stale session state.
//
// Bug (fixed 2026-07-23): the HELP/MENU/HI/HELLO branch in handleCommand()
// returned early without ever touching session state, unlike STOP (which
// calls clearAllSessions()). An abandoned flow (e.g. mid data-assessment,
// mid assessment-session capture) stayed alive in the sessions table, so
// the next unrelated message could be fed into that stale flow instead of
// starting fresh — this is what produced the "Upload marks" -> wrong PDF
// misrouting bug.
//
// Fix: MENU/HELP now call clearAllSessions(from) first, exactly like STOP.
// clearAllSessionsForHash() deletes every row for that phone_hash regardless
// of session_type, so this test also stands in for the broader session-store
// audit: any current or future SessionStore is covered by the same DELETE,
// not by a per-store allowlist that could drift out of sync.
//
// This test loads the REAL routes/webhook.js (via its __testExports seam)
// against a real, fully-migrated SQLite test database (see
// tests/helpers/createTestDb.js), with services/whatsappService stubbed out
// so no actual message-send calls are made.
//
// Run: node tests/menu-help-session-reset.test.js

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

function countSessions(phoneHash) {
  return db.prepare(`SELECT COUNT(*) as c FROM sessions WHERE phone_hash = ?`).get(phoneHash).c;
}

// MENU/HELP intentionally open a fresh 'navigationMenu' session (the newly
// shown guided menu) immediately after clearAllSessions() wipes the old
// (stale) session — so "0 sessions remain" is no longer the right
// post-MENU/HELP invariant. What must actually be true is that no STALE
// session type survives; a fresh navigationMenu row for the menu that MENU
// itself just opened is expected and correct.
function countNonMenuSessions(phoneHash) {
  return db.prepare(`SELECT COUNT(*) as c FROM sessions WHERE phone_hash = ? AND session_type != 'navigationMenu'`).get(phoneHash).c;
}

(async () => {
  const {
    handleCommand,
    hashPhone,
    assessmentSessionState,
    dataAssessmentState,
    setOnboardingStep,
    ONBOARDING_STEPS,
  } = require('../routes/webhook').__testExports;

  console.log('\n── MENU clears an active assessment-session capture ──');
  {
    const phone = '+27821150001';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    setOnboardingStep(phoneHash, ONBOARDING_STEPS.DONE); // these scenarios assume an already-onboarded teacher

    // Simulate a teacher mid-way through ADR-006 assessment capture.
    assessmentSessionState.set(phoneHash, {
      step: 'ACTIVE',
      blueprintId: 1,
      classId: 1,
      learnerIndex: 17,
      questionIndex: 0,
      lastActivity: Date.now(),
    });
    check(countSessions(phoneHash) === 1, 'setup: session row exists before MENU');
    check(assessmentSessionState.get(phoneHash) != null, 'setup: assessmentSessionState reads back the active capture');

    sentMessages.length = 0;
    const handled = await handleCommand(phone, 'MENU');

    check(handled === true, 'M-01: MENU is recognized and handled by handleCommand');
    check(countNonMenuSessions(phoneHash) === 0, 'M-02: stale session rows cleared after MENU (only the freshly-opened navigationMenu row may remain)');
    check(assessmentSessionState.get(phoneHash) === undefined, 'M-03: assessmentSessionState specifically reads back empty after MENU');
    check(sentMessages.length === 1, 'M-04: MENU sends exactly one reply (the help menu)');
    check(sentMessages[0].text.includes('What would you like to do?'), 'M-05: reply is the guided main-menu content');
  }

  console.log('\n── A fresh trigger right after MENU starts clean, not fed into the old flow ──');
  {
    const phone = '+27821150001'; // same phone — session should already be gone from the block above
    const phoneHash = hashPhone(phone);

    check(assessmentSessionState.get(phoneHash) === undefined, 'M-06: no stale assessment-session state carries over after MENU');
    check(dataAssessmentState.get(phoneHash) === undefined, 'M-07: no stale data-assessment state carries over after MENU either');
  }

  console.log('\n── HELP clears an active data-assessment ("Upload marks") flow ──');
  {
    const phone = '+27821150002';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    setOnboardingStep(phoneHash, ONBOARDING_STEPS.DONE); // these scenarios assume an already-onboarded teacher

    // Simulate a teacher mid-way through the Data-Driven Assessment Analysis
    // flow (this is the exact scenario from the original bug report: title
    // collected, waiting on grade, then the teacher sends a menu command
    // instead of answering).
    dataAssessmentState.set(phoneHash, {
      step: 'awaitingGrade',
      grade: null,
      subject: null,
      title: 'Term 2 test',
      term: null,
      classId: null,
      lastActivity: Date.now(),
    });
    check(countSessions(phoneHash) === 1, 'setup: data-assessment session row exists before HELP');

    sentMessages.length = 0;
    const handled = await handleCommand(phone, 'HELP');

    check(handled === true, 'H-01: HELP is recognized and handled by handleCommand');
    check(countNonMenuSessions(phoneHash) === 0, 'H-02: stale session rows cleared after HELP (only the freshly-opened navigationMenu row may remain)');
    check(dataAssessmentState.get(phoneHash) === undefined, 'H-03: dataAssessmentState specifically reads back empty after HELP');
  }

  console.log('\n── Re-triggering "Upload marks" after HELP starts a genuinely fresh flow ──');
  {
    const phone = '+27821150002';
    const phoneHash = hashPhone(phone);

    // If the bug were still present, dataAssessmentState would still hold
    // { step: 'awaitingGrade', title: 'Term 2 test' } here, and a fresh
    // "Upload marks" trigger would be misrouted through the stale flow
    // instead of starting over. Confirming the state is gone is the
    // regression guard for that misrouting bug.
    check(dataAssessmentState.get(phoneHash) === undefined, 'R-01: dataAssessmentState is empty — next "Upload marks" will start a genuinely fresh flow, not resume the abandoned one');
  }

  console.log('\n── HI and HELLO (aliases of the same branch) also clear sessions ──');
  {
    const phone = '+27821150003';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    setOnboardingStep(phoneHash, ONBOARDING_STEPS.DONE); // these scenarios assume an already-onboarded teacher

    assessmentSessionState.set(phoneHash, { step: 'ACTIVE', learnerIndex: 3, lastActivity: Date.now() });
    await handleCommand(phone, 'HI');
    check(countNonMenuSessions(phoneHash) === 0, 'A-01: HI clears stale session state (only the freshly-opened navigationMenu row may remain)');

    assessmentSessionState.set(phoneHash, { step: 'ACTIVE', learnerIndex: 3, lastActivity: Date.now() });
    await handleCommand(phone, 'HELLO');
    check(countNonMenuSessions(phoneHash) === 0, 'A-02: HELLO clears stale session state (only the freshly-opened navigationMenu row may remain)');
  }

  console.log('\n── STOP still behaves identically (no regression from the MENU/HELP fix) ──');
  {
    const phone = '+27821150004';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    setOnboardingStep(phoneHash, ONBOARDING_STEPS.DONE); // these scenarios assume an already-onboarded teacher

    assessmentSessionState.set(phoneHash, { step: 'ACTIVE', learnerIndex: 3, lastActivity: Date.now() });
    sentMessages.length = 0;
    const handled = await handleCommand(phone, 'STOP');

    check(handled === true, 'S-01: STOP is still handled');
    check(countSessions(phoneHash) === 0, 'S-02: STOP still clears all session state');
    const teacherRow = db.prepare(`SELECT opted_out FROM teachers WHERE phone_hash = ?`).get(phoneHash);
    check(teacherRow.opted_out === 1, 'S-03: STOP still marks the teacher opted_out (unaffected by the MENU/HELP change)');
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
