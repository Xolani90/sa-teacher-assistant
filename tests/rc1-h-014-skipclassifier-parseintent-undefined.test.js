'use strict';
/**
 * RC1-H-014 regression test — core/messageProcessor.js's skipClassifier
 * fallback branch calls a bare, unbound `parseIntent(text)`.
 *
 * Root cause (confirmed via recon, see docs/releases/RC1-MILESTONE.md
 * Defect Log once opened): core/messageProcessor.js was extracted from
 * routes/webhook.js (commit 51eb9cd5, "extract processMessage() into
 * core/messageProcessor.js"). Pre-extraction, webhook.js had a
 * module-scope `const { parseIntent } = require('../utils/intentParser')`
 * and the skipClassifier ternary (then at webhook.js's old line ~1375)
 * resolved against that binding. Every OTHER parseIntent use site in the
 * old file was already routed through the deps object and survived the
 * extraction correctly; this one call site was not, and does not exist
 * as a local binding (module-scope, function-scope, or deps-destructured)
 * anywhere in core/messageProcessor.js today.
 *
 * production's real routes/webhook.js::buildProcessMessageDeps() ALREADY
 * supplies `deps.parseIntent` (the real utils/intentParser.js::parseIntent),
 * correctly wired — the bug is purely that the skipClassifier branch
 * doesn't call it.
 *
 * Trigger conditions (either is sufficient, both share the identical
 * broken call):
 *   - deps.isClassifierRateLimited(from) === true
 *   - deps.isCeilingReached() === true
 *
 * This file intentionally does NOT pre-emptively work around the defect
 * — it supplies the REAL utils/intentParser.js::parseIntent via
 * deps.parseIntent (exactly as production's buildProcessMessageDeps()
 * does) and otherwise exercises the real, unmodified
 * core/messageProcessor.js. Run against the current (pre-fix) code, this
 * test is EXPECTED to throw ReferenceError: parseIntent is not defined —
 * that is the point: this test must fail for the right reason before any
 * production line changes, so the eventual green run is real evidence of
 * a fix, not evidence of a test built to already pass.
 *
 * Scope: this file is deliberately separate from
 * tests/rc1-v011-coaching-group-c-dispatch.test.js, which stays scoped to
 * REFLECT/NEW GOAL under normal (non-rate-limited, non-ceiling)
 * classification conditions and does not exercise this branch at all.
 *
 * Run individually: node tests/rc1-h-014-skipclassifier-parseintent-undefined.test.js
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

async function run() {
  const testDb = createTestDb(__filename);

  const { SessionStore } = require('../utils/sessionStore');
  const { processMessage } = require('../core/messageProcessor');
  const { parseIntent } = require('../utils/intentParser'); // REAL — used only for
  // this test's own expected-value assertions (never injected as a fake
  // dependency into deps.parseIntent — deps.parseIntent below IS this
  // same real function, matching production's wiring exactly).

  const PHONE = '+27831234567';
  const hashPhone = (p) => `hash_${p}`;
  const phoneHash = hashPhone(PHONE);

  const sentMessages = [];
  async function safeSendMessage(to, msg) {
    sentMessages.push({ to, msg });
  }
  function lastMessage() {
    return sentMessages[sentMessages.length - 1]?.msg || '';
  }

  const generationCalls = [];
  async function triggerGeneration(args) {
    generationCalls.push(args);
  }

  const emptyState = (type) => new SessionStore(type, 24 * 60 * 60 * 1000);
  const noopFlow = async () => false;

  let messageCounter = 0;
  let classifierRateLimited = false;
  let ceilingReached = false;
  let liveClassifierCallCount = 0; // proves deps.classifyIntent (the "live AI path") is
  // genuinely skipped when skipClassifier is true, not merely that its
  // result happens to be unused.

  function buildDeps() {
    return Object.freeze({
      isDuplicate: () => false,
      getTeacherByPhone: () => undefined,
      updateTeacherProfile: () => {},
      hashPhone,
      safeSendMessage,
      encryptPhone: () => 'enc',
      dataAssessmentState: emptyState('rc1h014DataAssessment'),
      handleAssessmentFlow: noopFlow,
      buildAssessmentDeps: () => ({}),
      handleCommand: async () => false,
      handleMainMenuFlow: noopFlow,
      buildMainMenuDeps: () => ({}),
      needsOnboarding: () => false,
      handleOnboarding: () => ({ handled: false }),
      pendingIntentState: emptyState('rc1h014PendingIntent'),
      triggerGeneration,
      buildGenerationDeps: () => ({}),
      reportCommentState: emptyState('rc1h014ReportComment'),
      parentMessageState: emptyState('rc1h014ParentMessage'),
      assessmentAnalysisState: emptyState('rc1h014AssessmentAnalysis'),
      interventionPlanState: emptyState('rc1h014InterventionPlan'),
      profileUpdateState: emptyState('rc1h014ProfileUpdate'),
      observationState: emptyState('rc1h014Observation'),
      observationHistoryState: emptyState('rc1h014ObservationHistory'),
      assessmentSessionState: emptyState('rc1h014AssessmentSession'),
      blueprintAuthoringState: emptyState('rc1h014BlueprintAuthoring'),
      rosterState: emptyState('rc1h014Roster'),
      reflectionState: emptyState('rc1h014Reflection'),
      growthPlanState: emptyState('rc1h014GrowthPlan'),
      incidentState: emptyState('rc1h014Incident'),
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
      isClassifierRateLimited: () => classifierRateLimited,
      isCeilingReached: () => ceilingReached,
      // deps.parseIntent — the REAL utils/intentParser.js function,
      // exactly as production's routes/webhook.js::buildProcessMessageDeps()
      // supplies it. This is what the fixed production line should call
      // (deps.parseIntent(text)); it is deliberately present and correct
      // here so a passing post-fix run proves the fix routes to it, not
      // that the test merely stopped exercising the buggy branch.
      parseIntent,
      classifyIntent: async (msgText) => {
        liveClassifierCallCount += 1;
        return parseIntent(msgText);
      },
    });
  }

  async function send(text) {
    sentMessages.length = 0;
    messageCounter += 1;
    await processMessage(
      { from: PHONE, id: `rc1h014-msg-${messageCounter}`, type: 'text', text: { body: text } },
      buildDeps()
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario A: isClassifierRateLimited() === true — fallback-rate-limited ──');
  classifierRateLimited = true;
  ceilingReached = false;
  generationCalls.length = 0;
  liveClassifierCallCount = 0;

  let scenarioAError = null;
  try {
    await send('TEST');
  } catch (err) {
    scenarioAError = err;
  }

  if (scenarioAError) {
    console.log(`  ⚠️  Scenario A threw: ${scenarioAError.constructor.name}: ${scenarioAError.message}`);
    assert(
      scenarioAError instanceof ReferenceError && /parseIntent is not defined/.test(scenarioAError.message),
      'Scenario A: PRE-FIX — reproduces the exact known defect (ReferenceError: parseIntent is not defined)'
    );
    assert(false, 'Scenario A: POST-FIX — message does not throw (currently failing — defect still present)');
  } else {
    assert(true, 'Scenario A: message does not throw');
    assert(liveClassifierCallCount === 0, 'Scenario A: deps.classifyIntent (live AI path) was never called — skipClassifier genuinely skipped it');
    assert(generationCalls.length === 1, 'Scenario A: real dispatch reached triggerGeneration exactly once');
    const routedIntent = generationCalls[0]?.intent;
    const expected = parseIntent('TEST');
    assert(routedIntent?.type === expected.type, `Scenario A: routed intent.type is the real parseIntent() result ("${routedIntent?.type}")`);
    assert(routedIntent?.subject === expected.subject, 'Scenario A: routed intent.subject matches the real parseIntent() result');
    assert(routedIntent?.marks === expected.marks, 'Scenario A: routed intent.marks matches the real parseIntent() result');
    assert(routedIntent?.language === expected.language, 'Scenario A: routed intent.language matches the real parseIntent() result');
    assert(routedIntent?._source === 'fallback-rate-limited', `Scenario A: intent._source is "fallback-rate-limited" (got "${routedIntent?._source}")`);
    const shapeKeys = ['type', 'grade', 'subject', 'topic', 'marks', 'language'];
    assert(
      shapeKeys.every((k) => Object.prototype.hasOwnProperty.call(routedIntent || {}, k)),
      'Scenario A: routed intent shape matches the documented classifier contract { type, grade, subject, topic, marks, language }'
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario B: isCeilingReached() === true, rate-limit false — fallback-ceiling ──');
  classifierRateLimited = false;
  ceilingReached = true;
  generationCalls.length = 0;
  liveClassifierCallCount = 0;

  let scenarioBError = null;
  try {
    await send('WORKSHEET');
  } catch (err) {
    scenarioBError = err;
  }

  if (scenarioBError) {
    console.log(`  ⚠️  Scenario B threw: ${scenarioBError.constructor.name}: ${scenarioBError.message}`);
    assert(
      scenarioBError instanceof ReferenceError && /parseIntent is not defined/.test(scenarioBError.message),
      'Scenario B: PRE-FIX — reproduces the exact known defect (ReferenceError: parseIntent is not defined)'
    );
    assert(false, 'Scenario B: POST-FIX — message does not throw (currently failing — defect still present)');
  } else {
    assert(true, 'Scenario B: message does not throw');
    assert(liveClassifierCallCount === 0, 'Scenario B: deps.classifyIntent (live AI path) was never called — skipClassifier genuinely skipped it');
    assert(generationCalls.length === 1, 'Scenario B: real dispatch reached triggerGeneration exactly once');
    const routedIntent = generationCalls[0]?.intent;
    const expected = parseIntent('WORKSHEET');
    assert(routedIntent?.type === expected.type, `Scenario B: routed intent.type is the real parseIntent() result ("${routedIntent?.type}")`);
    assert(routedIntent?._source === 'fallback-ceiling', `Scenario B: intent._source is "fallback-ceiling" (got "${routedIntent?._source}")`);
  }

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario C: command / mid-flow short-circuits above classification remain unaffected ──');
  classifierRateLimited = true; // deliberately still "on" — proves these paths never reach the buggy line at all
  ceilingReached = true;
  generationCalls.length = 0;

  // C1: a global command. handleCommand short-circuits before classification
  // is ever reached, regardless of rate-limit/ceiling state.
  let commandDeps = buildDeps();
  let commandHandledCalled = false;
  commandDeps = { ...commandDeps, handleCommand: async () => { commandHandledCalled = true; return true; } };
  let scenarioC1Error = null;
  try {
    messageCounter += 1;
    await processMessage(
      { from: PHONE, id: `rc1h014-msg-${messageCounter}`, type: 'text', text: { body: 'STATUS' } },
      commandDeps
    );
  } catch (err) {
    scenarioC1Error = err;
  }
  assert(scenarioC1Error === null, 'Scenario C1: a global command (handleCommand=true) does not throw under rate-limit+ceiling conditions');
  assert(commandHandledCalled === true, 'Scenario C1: handleCommand was genuinely invoked and short-circuited before classification');

  // C2: an active mid-flow session (alreadyMidFlow) is routed straight to
  // its handler without ever reaching the classification step.
  const midFlowRosterState = emptyState('rc1h014C2Roster');
  midFlowRosterState.set(phoneHash, { step: 'awaitingPaste', lastActivity: Date.now() });
  let rosterHandlerCalled = false;
  const c2Deps = {
    ...buildDeps(),
    rosterState: midFlowRosterState,
    handleRosterFlow: async () => { rosterHandlerCalled = true; return true; },
  };
  let scenarioC2Error = null;
  try {
    messageCounter += 1;
    await processMessage(
      { from: PHONE, id: `rc1h014-msg-${messageCounter}`, type: 'text', text: { body: 'some pasted roster text' } },
      c2Deps
    );
  } catch (err) {
    scenarioC2Error = err;
  }
  assert(scenarioC2Error === null, 'Scenario C2: an active mid-flow session does not throw under rate-limit+ceiling conditions');
  assert(rosterHandlerCalled === true, 'Scenario C2: the real mid-flow handler was invoked, confirming alreadyMidFlow routing bypassed classification entirely');
  midFlowRosterState.delete(phoneHash);

  // ═══════════════════════════════════════════════════════════════════
  console.log(`\n${passed} passed, ${failed} failed`);
  testDb.cleanup();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Unexpected test runner error:', err);
  process.exit(1);
});
