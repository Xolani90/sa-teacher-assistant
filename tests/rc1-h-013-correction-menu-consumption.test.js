'use strict';
/**
 * RC1-H-013 regression test — reflection/growthPlan correction-menu
 * numeric-reply consumption.
 *
 * Root cause: core/messageProcessor.js's activeFlowId gate (introduced
 * for RC1-H-007) only recognized assessmentSessionState and
 * blueprintAuthoringState. reflectionState and growthPlanState are
 * active-flow state stores of exactly the same kind (they already
 * participate in the alreadyMidFlow computation a few lines above), but
 * were absent from this gate. Both flows open a bare numeric correction
 * menu (CORRECTION_MENU_ID in reflectionFlow.js / growthPlanFlow.js) via
 * navigationService.openMenu(), which defaults expiresAfterReply to true.
 *
 * Because activeFlowId stayed null for these two flows, the discarded
 * "dry run" call to navigationService.evaluateMessage() ran anyway and
 * — exactly as RC1-H-007 found for assessmentSession's COMPLETE_MENU —
 * its internal consumeNumericReply() call closed the correction menu
 * BEFORE the real flow handler's own consumeNumericReply() call got a
 * chance to. The real handler then found no_menu_open, fell through to
 * its "invalid reply" branch, and re-opened the same menu — so every
 * correction choice (e.g. "2" for "What went well") was rejected and the
 * teacher was stuck re-answering the same menu.
 *
 * Fix: core/messageProcessor.js's activeFlowId ternary now also
 * recognizes reflectionState -> 'reflection' and
 * growthPlanState -> 'growthPlan'.
 *
 * This test drives everything through core/messageProcessor.js's
 * processMessage() — the real entry point every inbound webhook message
 * goes through — using the REAL handleReflectionFlow/handleGrowthPlanFlow
 * handlers and the REAL navigationService, same pattern as
 * tests/rc1-h007-complete-menu-double-consumption.test.js. It asserts
 * only on observable reply text (lastMessage()) and state transitions
 * already exposed through the real SessionStore instances — no
 * production test-only exports are added anywhere.
 *
 * Run individually: node tests/rc1-h-013-correction-menu-consumption.test.js
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

function registerReflectionFlow(navigationService, reflectionState) {
  navigationService.registerFlow({
    id: 'reflection',
    commands: ['REFLECT'],
    capabilities: { status: true, cancel: true, back: false, menus: true },
    menus: { correctionChoice: ['Lesson', 'What went well', 'What I would improve', 'Topic', 'Cancel'] },
    hooks: {
      cleanup: (phoneHash) => reflectionState.delete(phoneHash),
      describeStatus: () => 'Reflection in progress.',
    },
  });
}

function registerGrowthPlanFlow(navigationService, growthPlanState) {
  navigationService.registerFlow({
    id: 'growthPlan',
    commands: ['NEW GOAL'],
    capabilities: { status: true, cancel: true, back: false, menus: true },
    menus: { correctionChoice: ['Goal', 'Topic', 'Cancel'] },
    hooks: {
      cleanup: (phoneHash) => growthPlanState.delete(phoneHash),
      describeStatus: () => 'Growth plan in progress.',
    },
  });
}

async function run() {
  const testDb = createTestDb(__filename);

  const { SessionStore } = require('../utils/sessionStore');
  const navigationService = require('../services/navigationService');
  const { handleReflectionFlow } = require('../flows/reflectionFlow');
  const { handleGrowthPlanFlow } = require('../flows/growthPlanFlow');
  const { processMessage } = require('../core/messageProcessor');

  const PHONE = '+27831234567';
  const hashPhone = (p) => `hash_${p}`;
  const phoneHash = hashPhone(PHONE);

  const reflectionState = new SessionStore('rc1h013Reflection', 24 * 60 * 60 * 1000);
  const growthPlanState = new SessionStore('rc1h013GrowthPlan', 24 * 60 * 60 * 1000);

  registerReflectionFlow(navigationService, reflectionState);
  registerGrowthPlanFlow(navigationService, growthPlanState);

  const savedReflections = [];
  const savedGrowthPlans = [];

  function buildReflectionDeps() {
    return {
      reflectionState,
      safeSendMessage: async (to, msg) => { sentMessages.push({ to, msg }); },
      parseIntent: () => ({ type: 'unknown' }),
      hashPhone,
      createReflection: (phHash, payload) => { savedReflections.push({ phHash, payload }); return { id: 1 }; },
      getCurrentTerm: () => 3,
    };
  }

  function buildGrowthPlanDeps() {
    return {
      growthPlanState,
      safeSendMessage: async (to, msg) => { sentMessages.push({ to, msg }); },
      parseIntent: () => ({ type: 'unknown' }),
      hashPhone,
      createGrowthPlan: (phHash, payload) => { savedGrowthPlans.push({ phHash, payload }); return { id: 1 }; },
      getCurrentTerm: () => 3,
    };
  }

  const emptyState = (type) => new SessionStore(type, 24 * 60 * 60 * 1000);
  const noopFlow = async () => false;
  const sentMessages = [];

  let messageCounter = 0;
  function buildDeps() {
    return Object.freeze({
      isDuplicate: () => false,
      getTeacherByPhone: () => undefined,
      updateTeacherProfile: () => {},
      hashPhone,
      safeSendMessage: async (to, msg) => { sentMessages.push({ to, msg }); },
      encryptPhone: () => 'enc',
      dataAssessmentState: emptyState('rc1h013DataAssessment'),
      handleAssessmentFlow: noopFlow,
      buildAssessmentDeps: () => ({}),
      handleCommand: async () => false,
      needsOnboarding: () => false,
      handleOnboarding: () => ({ handled: false }),
      pendingIntentState: emptyState('rc1h013PendingIntent'),
      triggerGeneration: async () => {},
      buildGenerationDeps: () => ({}),
      reportCommentState: emptyState('rc1h013ReportComment'),
      parentMessageState: emptyState('rc1h013ParentMessage'),
      assessmentAnalysisState: emptyState('rc1h013AssessmentAnalysis'),
      interventionPlanState: emptyState('rc1h013InterventionPlan'),
      profileUpdateState: emptyState('rc1h013ProfileUpdate'),
      observationState: emptyState('rc1h013Observation'),
      observationHistoryState: emptyState('rc1h013ObservationHistory'),
      assessmentSessionState: emptyState('rc1h013AssessmentSession'),
      blueprintAuthoringState: emptyState('rc1h013BlueprintAuthoring'),
      rosterState: emptyState('rc1h013Roster'),
      reflectionState,
      growthPlanState,
      handleObservationFlow: noopFlow,
      buildObservationDeps: () => ({}),
      handleObservationHistoryFlow: noopFlow,
      handleReflectionFlow, // REAL — subject under test
      buildReflectionDeps,
      handleGrowthPlanFlow, // REAL — subject under test
      buildGrowthPlanDeps,
      handleAssessmentSessionFlow: noopFlow,
      buildAssessmentSessionDeps: () => ({}),
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

  async function send(text) {
    sentMessages.length = 0;
    messageCounter += 1;
    await processMessage(
      { from: PHONE, id: `rc1h013-msg-${messageCounter}`, type: 'text', text: { body: text } },
      buildDeps()
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── RC1-H-013: reflection correction menu numeric reply reaches the real handler ──');

  reflectionState.set(phoneHash, {
    step: 'reviewSummary',
    lesson: 'Fractions intro',
    wentWell: 'Learners engaged well',
    improvement: 'More worked examples',
    lastActivity: Date.now(),
  });
  navigationService.closeMenu(phoneHash);

  await send('NO'); // -> awaitingCorrectionChoice, opens correction menu
  let rState = reflectionState.get(phoneHash);
  assert(rState?.step === 'awaitingCorrectionChoice', 'precondition: reflection session is at awaitingCorrectionChoice');
  assert(navigationService.getOpenMenu(phoneHash)?.id === 'reflection.correctionChoice', 'precondition: reflection correction menu is open');

  await send('2'); // WENT_WELL
  rState = reflectionState.get(phoneHash);
  assert(rState?.step === 'awaitingWentWell', 'reflection: "2" at correction menu routes to awaitingWentWell (not rejected as invalid)');
  assert(!/Please reply with a number/i.test(lastMessage()), 'reflection: reply is NOT the generic "invalid reply" re-render');
  assert(/What went well/i.test(lastMessage()), 'reflection: reply is the WENT_WELL re-prompt');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── RC1-H-013: growthPlan correction menu numeric reply reaches the real handler ──');

  reflectionState.delete(phoneHash);
  navigationService.closeMenu(phoneHash);

  growthPlanState.set(phoneHash, {
    step: 'reviewSummary',
    goal: 'Improve pacing in fractions unit',
    topicId: null,
    lastActivity: Date.now(),
  });

  await send('NO'); // -> awaitingCorrectionChoice, opens correction menu
  let gState = growthPlanState.get(phoneHash);
  assert(gState?.step === 'awaitingCorrectionChoice', 'precondition: growthPlan session is at awaitingCorrectionChoice');
  assert(navigationService.getOpenMenu(phoneHash)?.id === 'growthPlan.correctionChoice', 'precondition: growthPlan correction menu is open');

  await send('1'); // GOAL
  gState = growthPlanState.get(phoneHash);
  assert(gState?.step === 'awaitingGoal', 'growthPlan: "1" at correction menu routes to awaitingGoal (not rejected as invalid)');
  assert(!/Please reply with a number/i.test(lastMessage()), 'growthPlan: reply is NOT the generic "invalid reply" re-render');

  growthPlanState.delete(phoneHash);
  navigationService.closeMenu(phoneHash);

  // ═══════════════════════════════════════════════════════════════════
  console.log(`\n${passed} passed, ${failed} failed`);
  testDb.cleanup();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
