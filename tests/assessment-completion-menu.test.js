'use strict';
/**
 * Assessment Session — post-completion menu tests (ADR-019 Step 3,
 * Commit 5 part 2).
 *
 * Once marks capture finishes, the session no longer deletes itself
 * outright — it moves to STEP.COMPLETE_MENU and opens a NavigationService
 * menu (assessmentSession.complete: 1 = NEW_ASSESSMENT, 2 = PRINT) folded
 * into the same completion message. This file covers that menu's own
 * behaviour in isolation from the marks-capture mechanics already covered
 * by tests/assessment-session-bulk-dispatch.test.js.
 *
 * Scope note: this menu deliberately only offers actions assessmentSession
 * itself owns (NEW_ASSESSMENT / PRINT). CLASS_INTERVENTION /
 * LEARNER_PROGRESS belong to workspaceFlow.js and are out of scope until a
 * future commit designs real cross-flow menu dispatch.
 *
 * Run individually: node tests/assessment-completion-menu.test.js
 * Run via npm:       npm test
 */

// ── Shared real-migrations test DB helper (see docs/TSE_SCHOOL_CALENDAR_TEST_GAP.md) ──
const { createTestDb } = require('./helpers/createTestDb');

let navigationService;

// Mirrors the assessmentSession FlowDefinition registered in
// routes/webhook.js (id, capabilities, menus, hooks). Kept byte-for-byte
// in sync with that registration per ADR-019's "Known technical debt"
// section — until registration is extracted into shared infrastructure,
// this duplication is intentional and any change to one side must be
// mirrored in the other.
//
// registerFlow() is idempotent (re-registering an id overwrites the
// previous definition), so calling this once per run — with this run's
// own fresh assessmentSessionState — safely rebinds hooks.cleanup/
// describeStatus to that state instance without leaking between runs.
function registerAssessmentSessionFlow(assessmentSessionState, describeAssessmentSessionStatus) {
  navigationService.registerFlow({
    id: 'assessmentSession',
    commands: ['NEW TEST', 'PRINT', 'RESUME'],
    capabilities: { status: true, cancel: true, back: false, menus: true },
    menus: {
      complete: ['Start a new assessment', 'Print a blueprint question paper'],
    },
    hooks: {
      cleanup: (phoneHash) => assessmentSessionState.delete(phoneHash),
      describeStatus: (phoneHash) => {
        const state = assessmentSessionState.get(phoneHash);
        return state ? describeAssessmentSessionStatus(state) : null;
      },
    },
  });
}

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

async function run() {
  const testDb = createTestDb(__filename);

  const { SessionStore } = require('../utils/sessionStore');
  navigationService = require('../services/navigationService');
  const { handleAssessmentSessionFlow, STEP, describeStatus: describeAssessmentSessionStatus } = require('../flows/assessmentSessionFlow');

  const PHONE = '+27831234567';
  const hashPhone = (p) => `hash_${p}`;
  const phoneHash = hashPhone(PHONE);

  const blueprintsFixture = [
    { id: 1, title: 'Term 3 Fractions Test', grade: 5, subject: 'Mathematics', total_marks: 15, question_count: 2 },
  ];
  const classesFixture = [
    { id: 9, name: 'Grade 5B', grade: 5, subject: 'Mathematics', learner_count: 2 },
  ];

  const getBlueprintById = (id) => {
    const summary = blueprintsFixture.find((b) => b.id === id);
    if (!summary) return null;
    return {
      id: summary.id,
      title: summary.title,
      grade: summary.grade,
      subject: summary.subject,
      term: 3,
      totalMarks: summary.total_marks,
      version: 1,
      questions: [
        { questionNumber: 1, topic: 'Fractions', maxMarks: 5 },
        { questionNumber: 2, topic: 'Decimals', maxMarks: 10 },
      ],
    };
  };

  let lastDiagnosticCall = null;
  const processAssessmentData = async (phHash, payload) => {
    lastDiagnosticCall = { phoneHash: phHash, payload };
    return { assessmentId: 999, teacherSummary: 'stub summary' };
  };

  let pdfCalls = [];
  let sendDocumentCalls = [];
  const generateBlueprintAssessmentPdf = async (assessmentId) => {
    pdfCalls.push(assessmentId);
    return { fileId: 'file-abc', filename: 'Blueprint_Report_Test.pdf' };
  };
  const generateBlueprintPaperPdf = async (blueprintId) => ({ fileId: 'paper-abc', filename: 'Paper.pdf' });
  const buildPdfUrl = (fileId) => `https://example.test/pdf/${fileId}`;
  const sendDocument = async (to, url, filename, caption) => {
    sendDocumentCalls.push({ to, url, filename, caption });
  };

  const parseMarks = () => ({
    learners: [
      { learnerName: 'Sipho Dlamini', questionData: { 1: { mark: 4, maxMark: 5 }, 2: { mark: 8, maxMark: 10 } } },
      { learnerName: 'Lebo Molefe', questionData: { 1: { mark: 5, maxMark: 5 }, 2: { mark: 9, maxMark: 10 } } },
    ],
    totalMark: 0,
    questionCount: 2,
    questionMaxMarks: {},
    questionTopics: {},
    warnings: [],
    errors: [],
  });

  const sentMessages = [];
  let assessmentSessionState = new SessionStore('assessmentCompletionMenu', 24 * 60 * 60 * 1000);

  // Registration fix (ADR-019 Recommendation 2, Strict registration):
  // without this, NavigationService's registry is empty under test and
  // assessmentSessionFlow.js's now-unguarded
  // `getFlowDefinition('assessmentSession').hooks.*` calls throw the
  // same "Cannot read properties of null (reading 'hooks')" error that
  // growthPlan hit before Recommendation 1's fix.
  registerAssessmentSessionFlow(assessmentSessionState, describeAssessmentSessionStatus);

  function buildDeps() {
    return {
      hashPhone,
      safeSendMessage: async (to, msg) => { sentMessages.push({ to, msg }); },
      assessmentSessionState,
      listBlueprints: () => blueprintsFixture,
      getTeacherClasses: () => classesFixture,
      getBlueprintById,
      processAssessmentData,
      parseMarks,
      generateBlueprintAssessmentPdf,
      generateBlueprintPaperPdf,
      buildPdfUrl,
      sendDocument,
    };
  }

  function lastMessage() {
    return sentMessages[sentMessages.length - 1]?.msg || '';
  }

  async function send(text) {
    sentMessages.length = 0;
    return handleAssessmentSessionFlow(PHONE, text, null, null, buildDeps());
  }

  // Drives a session all the way to STEP.COMPLETE_MENU via a single bulk
  // paste that exactly fills the fixture's 2-learner class.
  async function completeASession() {
    assessmentSessionState = new SessionStore('assessmentCompletionMenu', 24 * 60 * 60 * 1000);
    registerAssessmentSessionFlow(assessmentSessionState, describeAssessmentSessionStatus);
    // A prior section may have left behind a non-terminal session (e.g.
    // still sitting in SELECT_BLUEPRINT/SELECT_PRINT_BLUEPRINT) — a fresh
    // SessionStore *instance* doesn't mean a fresh underlying row, since
    // all sections share the same phoneHash/store name. Clear explicitly
    // rather than relying on NEW TEST to do it (NEW TEST intentionally
    // refuses to clobber a genuinely in-progress session).
    assessmentSessionState.delete(phoneHash);
    navigationService.closeMenu(phoneHash);
    pdfCalls = [];
    sendDocumentCalls = [];
    await send('NEW TEST');
    await send('1'); // blueprint
    await send('1'); // class -> ACTIVE
    await send('Sipho Dlamini 4 8\nLebo Molefe 5 9'); // completes capture
  }

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 1: completion opens the menu, folded into the completion message ─');
  await completeASession();
  let state = assessmentSessionState.get(phoneHash);
  assert(state?.step === STEP.COMPLETE_MENU, 'session moves to COMPLETE_MENU on capture completion, not deleted');
  assert(navigationService.getOpenMenu(phoneHash)?.id === 'assessmentSession.complete', 'the assessmentSession.complete menu is open in NavigationService');
  assert(/Capture complete/i.test(sentMessages[0]?.msg || ''), 'completion message sent');
  assert(/what would you like to do next/i.test(sentMessages[0]?.msg || ''), 'menu prompt is folded into the same completion message, not a separate send');
  assert(/1\. Start a new assessment/i.test(sentMessages[0]?.msg || ''), 'menu option 1 (new assessment) is listed');
  assert(/2\. Print a blueprint/i.test(sentMessages[0]?.msg || ''), 'menu option 2 (print) is listed');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 2: digit 1 (NEW_ASSESSMENT) starts a fresh session ─');
  await completeASession();
  await send('1');
  state = assessmentSessionState.get(phoneHash);
  assert(state?.step === STEP.SELECT_BLUEPRINT, 'digit 1 restarts NEW TEST — state advances to SELECT_BLUEPRINT');
  assert(navigationService.getOpenMenu(phoneHash) === null, 'the completion menu is closed once consumed');
  assert(/Choose a Blueprint/i.test(lastMessage()), 'blueprint list is (re)prompted, same as a literal NEW TEST');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 3: digit 2 (PRINT) starts the print sub-flow ─────────');
  await completeASession();
  await send('2');
  state = assessmentSessionState.get(phoneHash);
  assert(state?.step === STEP.SELECT_PRINT_BLUEPRINT, 'digit 2 starts PRINT — state advances to SELECT_PRINT_BLUEPRINT');
  assert(navigationService.getOpenMenu(phoneHash) === null, 'the completion menu is closed once consumed');
  assert(/Choose a Blueprint/i.test(lastMessage()), 'print blueprint list is prompted, same as a literal PRINT');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 4: invalid digit re-renders the menu, stays open ─────');
  await completeASession();
  const handledBadDigit = await send('9');
  state = assessmentSessionState.get(phoneHash);
  assert(handledBadDigit === true, 'an out-of-range digit is still handled here (not passed through)');
  assert(state?.step === STEP.COMPLETE_MENU, 'state stays at COMPLETE_MENU after an invalid digit');
  assert(navigationService.getOpenMenu(phoneHash)?.id === 'assessmentSession.complete', 'the menu is still (re-)open after an invalid digit');
  assert(/what would you like to do next/i.test(lastMessage()), 'the menu is re-rendered for an invalid digit');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 5: non-numeric free text re-renders the menu, stays open ─');
  await completeASession();
  const handledFreeText = await send('hello');
  state = assessmentSessionState.get(phoneHash);
  assert(handledFreeText === true, 'free text at COMPLETE_MENU is still handled here (not passed through)');
  assert(state?.step === STEP.COMPLETE_MENU, 'state stays at COMPLETE_MENU after free text');
  assert(/what would you like to do next/i.test(lastMessage()), 'the menu is re-rendered for free text');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 6: typing NEW TEST/PRINT directly works exactly like the matching digit ─');
  await completeASession();
  await send('NEW TEST');
  state = assessmentSessionState.get(phoneHash);
  assert(state?.step === STEP.SELECT_BLUEPRINT, 'typing NEW TEST directly at COMPLETE_MENU is NOT blocked as "already in progress" — it restarts, like digit 1');

  await completeASession();
  await send('PRINT');
  state = assessmentSessionState.get(phoneHash);
  assert(state?.step === STEP.SELECT_PRINT_BLUEPRINT, 'typing PRINT directly at COMPLETE_MENU starts the print sub-flow, like digit 2');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 7: CANCEL and STATUS still work at COMPLETE_MENU ─────');
  await completeASession();
  await send('STATUS');
  assert(/assessment complete/i.test(lastMessage()), 'STATUS at COMPLETE_MENU reports the completion state');

  await completeASession();
  await send('CANCEL');
  state = assessmentSessionState.get(phoneHash);
  assert(state === undefined, 'CANCEL clears a COMPLETE_MENU session like any other step');
  assert(/cancelled/i.test(lastMessage()), 'CANCEL confirms cancellation');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 8: RESUME re-renders the completion menu without consuming it ─');
  await completeASession();
  await send('RESUME');
  state = assessmentSessionState.get(phoneHash);
  assert(state?.step === STEP.COMPLETE_MENU, 'RESUME does not alter state');
  assert(navigationService.getOpenMenu(phoneHash)?.id === 'assessmentSession.complete', 'RESUME does not consume/close the open menu');
  assert(/what would you like to do next/i.test(lastMessage()), 'RESUME re-renders the completion menu');

  // ── Summary ───────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(62));
  console.log(`Assessment Completion Menu Results: ${passed} passed, ${failed} failed`);

  testDb.cleanup();

  // sessionStore.js registers an un-ref'd-free setInterval housekeeping
  // sweep on require, which otherwise keeps the process alive indefinitely
  // when this file is run standalone.
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test run threw:', err);
  process.exit(1);
});
