'use strict';
/**
 * RC1-H-007 regression test — COMPLETE_MENU numeric reply double-consumption.
 *
 * Root cause: core/messageProcessor.js called
 * NavigationService.evaluateMessage() as a supposedly side-effect-free
 * "dry run" once per message (ADR-019 Step 3, Commit 2), discarding its
 * result. But evaluateMessage() internally calls consumeNumericReply(),
 * which DOES have a side effect on match: it closes the open menu
 * (§4, the numeric-collision rule — a consumed menu is destroyed so a
 * retried digit can't double-fire). So when a teacher replied "2" at
 * assessmentSessionFlow's COMPLETE_MENU, the discarded evaluateMessage()
 * call consumed/closed the menu FIRST; the real COMPLETE_MENU handler's
 * own consumeNumericReply() call moments later then found no_menu_open
 * and fell through to the generic "invalid reply" re-render instead of
 * dispatching to PRINT.
 *
 * Fix: core/messageProcessor.js now skips the speculative evaluateMessage()
 * call whenever a flow is already active (activeFlowId is set) — in that
 * case the owning flow's own handler is the sole consumer of the reply.
 * When no flow is active, evaluateMessage() still runs exactly as before.
 *
 * Unlike tests/assessment-completion-menu.test.js (which calls
 * handleAssessmentSessionFlow directly and therefore would NOT have caught
 * this — the bug only exists in the router, not in the flow itself), this
 * test drives everything through core/messageProcessor.js's processMessage(),
 * the actual entry point every inbound webhook message goes through.
 *
 * Run individually: node tests/rc1-h007-complete-menu-double-consumption.test.js
 * Run via npm:       npm test
 */

const { createTestDb } = require('./helpers/createTestDb');

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

// Mirrors the assessmentSession FlowDefinition registered in
// routes/webhook.js, same as tests/assessment-completion-menu.test.js.
function registerAssessmentSessionFlow(navigationService, assessmentSessionState, describeAssessmentSessionStatus) {
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

async function run() {
  const testDb = createTestDb(__filename);

  const { SessionStore } = require('../utils/sessionStore');
  const navigationService = require('../services/navigationService');
  const { handleAssessmentSessionFlow, buildAssessmentSessionDeps: _unused, STEP, describeStatus: describeAssessmentSessionStatus } =
    require('../flows/assessmentSessionFlow');
  const { processMessage } = require('../core/messageProcessor');

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

  const processAssessmentData = async (phHash, payload) => ({ assessmentId: 999, teacherSummary: 'stub summary' });
  const generateBlueprintAssessmentPdf = async (assessmentId) => ({ fileId: 'file-abc', filename: 'Blueprint_Report_Test.pdf' });
  const generateBlueprintPaperPdf = async (blueprintId) => ({ fileId: 'paper-abc', filename: 'Paper.pdf' });
  const buildPdfUrl = (fileId) => `https://example.test/pdf/${fileId}`;
  const sendDocumentCalls = [];
  const sendDocument = async (to, url, filename, caption) => { sendDocumentCalls.push({ to, url, filename, caption }); };

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
  const assessmentSessionState = new SessionStore('rc1h007AssessmentSession', 24 * 60 * 60 * 1000);

  registerAssessmentSessionFlow(navigationService, assessmentSessionState, describeAssessmentSessionStatus);

  function buildAssessmentSessionDeps() {
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

  // ── Minimal empty-state stand-ins for every OTHER session type
  // processMessage() checks. Real SessionStore instances, but never
  // written to, so they always read back undefined/absent — exercising
  // the genuine alreadyMidFlow computation (line 149-163 of
  // messageProcessor.js) rather than a hand-rolled boolean.
  const emptyState = (type) => new SessionStore(type, 24 * 60 * 60 * 1000);
  const noopFlow = async () => false;

  let messageCounter = 0;
  function buildDeps() {
    return Object.freeze({
      isDuplicate: () => false,
      getTeacherByPhone: () => undefined, // no opted-out branch triggered
      updateTeacherProfile: () => {},
      hashPhone,
      safeSendMessage: async (to, msg) => { sentMessages.push({ to, msg }); },
      encryptPhone: () => 'enc',
      dataAssessmentState: emptyState('rc1h007DataAssessment'),
      handleAssessmentFlow: noopFlow,
      buildAssessmentDeps: () => ({}),
      handleCommand: async () => false,
      handleMainMenuFlow: noopFlow,
      buildMainMenuDeps: () => ({}),
      needsOnboarding: () => false,
      handleOnboarding: () => ({ handled: false }),
      pendingIntentState: emptyState('rc1h007PendingIntent'),
      triggerGeneration: async () => {},
      buildGenerationDeps: () => ({}),
      reportCommentState: emptyState('rc1h007ReportComment'),
      parentMessageState: emptyState('rc1h007ParentMessage'),
      assessmentAnalysisState: emptyState('rc1h007AssessmentAnalysis'),
      interventionPlanState: emptyState('rc1h007InterventionPlan'),
      profileUpdateState: emptyState('rc1h007ProfileUpdate'),
      observationState: emptyState('rc1h007Observation'),
      observationHistoryState: emptyState('rc1h007ObservationHistory'),
      assessmentSessionState,
      blueprintAuthoringState: emptyState('rc1h007BlueprintAuthoring'),
      rosterState: emptyState('rc1h007Roster'),
      reflectionState: emptyState('rc1h007Reflection'),
      growthPlanState: emptyState('rc1h007GrowthPlan'),
      incidentState: emptyState('rc1h007Incident'),
      handleObservationFlow: noopFlow,
      buildObservationDeps: () => ({}),
      handleObservationHistoryFlow: noopFlow,
      handleReflectionFlow: noopFlow,
      buildReflectionDeps: () => ({}),
      handleGrowthPlanFlow: noopFlow,
      buildGrowthPlanDeps: () => ({}),
      handleIncidentFlow: noopFlow,
      buildIncidentDeps: () => ({}),
      handleIncidentHistoryFlow: noopFlow,
      buildIncidentHistoryDeps: () => ({}),
      handleAssessmentSessionFlow, // REAL — this is the subject under test
      buildAssessmentSessionDeps,
      handleBlueprintAuthoringFlow: noopFlow,
      buildBlueprintAuthoringDeps: () => ({}),
      handleRosterFlow: noopFlow,
      buildRosterDeps: () => ({}),
      handleReportCommentFlow: noopFlow,
      buildReportCommentDeps: () => ({}),
      handleProfileUpdateFlow: noopFlow,
      buildProfileUpdateDeps: () => ({}),
      handleParentMessageFlow: noopFlow,
      buildParentMessageDeps: () => ({}),
      handleAssessmentAnalysisFlow: noopFlow,
      buildAssessmentAnalysisDeps: () => ({}),
      handleCurriculumQueryFlow: noopFlow,
      buildCurriculumQueryDeps: () => ({}),
      handleInterventionPlanFlow: noopFlow,
      buildInterventionPlanDeps: () => ({}),
      isConversationalIntent: () => false,
      generateConversationalResponse: () => '',
      generateConversationalReplyAI: async () => '',
      isAiRateLimited: () => false,
      isClassifierRateLimited: () => false,
      isCeilingReached: () => false,
      parseIntent: () => ({ intent: 'unknown' }),
      classifyIntent: async () => ({ intent: 'unknown' }),
    });
  }

  function lastMessage() {
    return sentMessages[sentMessages.length - 1]?.msg || '';
  }

  // Sends a message through the REAL router entry point — processMessage()
  // — exactly as routes/webhook.js does for every inbound WhatsApp message.
  async function send(text) {
    sentMessages.length = 0;
    messageCounter += 1;
    await processMessage(
      { from: PHONE, id: `rc1h007-msg-${messageCounter}`, type: 'text', text: { body: text } },
      buildDeps()
    );
  }

  // Drives a session all the way to STEP.COMPLETE_MENU via a single bulk
  // paste that exactly fills the fixture's 2-learner class — same
  // mechanics as tests/assessment-completion-menu.test.js, but every send()
  // now goes through processMessage(), not handleAssessmentSessionFlow()
  // directly.
  async function completeASession() {
    assessmentSessionState.delete(phoneHash);
    navigationService.closeMenu(phoneHash);
    sendDocumentCalls.length = 0;
    await send('NEW TEST');
    await send('1'); // blueprint
    await send('1'); // class -> ACTIVE
    await send('Sipho Dlamini 4 8\nLebo Molefe 5 9'); // completes capture -> COMPLETE_MENU
  }

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── RC1-H-007: "2" at COMPLETE_MENU reaches PRINT through the real router ──');
  await completeASession();

  let state = assessmentSessionState.get(phoneHash);
  assert(state?.step === STEP.COMPLETE_MENU, 'precondition: session is at COMPLETE_MENU before the reply under test');
  assert(navigationService.getOpenMenu(phoneHash)?.id === 'assessmentSession.complete', 'precondition: the completion menu is open before the reply under test');

  await send('2');

  state = assessmentSessionState.get(phoneHash);
  assert(
    state?.step === STEP.SELECT_PRINT_BLUEPRINT,
    'the exact regression: "2" routed through processMessage() reaches PRINT (SELECT_PRINT_BLUEPRINT), not a re-rendered menu'
  );
  assert(
    /Choose a Blueprint/i.test(lastMessage()),
    'the print blueprint list is prompted — proof PRINT actually dispatched, not just state advancing'
  );
  assert(
    !/what would you like to do next/i.test(lastMessage()),
    'the completion menu is NOT re-rendered — "2" was not treated as an invalid/unmatched reply'
  );

  // ── Menu consumed exactly once, by the correct (only) consumer ──────────
  assert(
    navigationService.getOpenMenu(phoneHash) === null,
    'the menu is closed after being consumed by the real handler (single legitimate consumption)'
  );

  // ── Same case for "1" (NEW_ASSESSMENT), the other COMPLETE_MENU option ──
  console.log('\n── RC1-H-007: "1" at COMPLETE_MENU reaches NEW_ASSESSMENT through the real router ──');
  await completeASession();
  await send('1');
  state = assessmentSessionState.get(phoneHash);
  assert(
    state?.step === STEP.SELECT_BLUEPRINT,
    '"1" routed through processMessage() reaches NEW_ASSESSMENT (SELECT_BLUEPRINT), not a re-rendered menu'
  );
  assert(/Choose a Blueprint/i.test(lastMessage()), 'the (new-assessment) blueprint list is prompted');

  // ── Guard scope: with NO active flow, evaluateMessage() must still run,
  // i.e. top-level numeric-menu behavior outside a flow is unchanged. ──────
  console.log('\n── Guard scope: no-active-flow numeric-menu behavior is unchanged ──');
  assessmentSessionState.delete(phoneHash);
  navigationService.closeMenu(phoneHash);
  navigationService.openMenu(phoneHash, { id: 'standalone.test.menu', options: { '1': 'ONLY_OPTION' } });
  await send('1');
  assert(
    navigationService.getOpenMenu(phoneHash) === null,
    'with no active flow, evaluateMessage() still runs and still consumes/closes a standalone open menu (unchanged pre-fix behavior)'
  );

  // ── Summary ───────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(62));
  console.log(`RC1-H-007 Regression Results: ${passed} passed, ${failed} failed`);

  testDb.cleanup();

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test run threw:', err);
  process.exit(1);
});
