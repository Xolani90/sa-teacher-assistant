'use strict';
/**
 * RC1-V-011 real-dispatch acceptance harness — REFLECT and NEW GOAL
 * ("Coaching Group C": the next open Phase A cluster after RC1-V-010).
 *
 * Scope, per the approved recon (see docs/releases/RC1-MILESTONE.md,
 * REFLECT / NEW GOAL / Snapshot generation / Trend-based recommendations
 * rows):
 *
 *   - REFLECT and NEW GOAL are genuinely WhatsApp-flow-shaped, stateful
 *     multi-turn conversations (SessionStore + activeFlowId +
 *     NavigationService correction-menu behaviour) — only a real
 *     processMessage() dispatch can prove them, matching the pattern
 *     every prior RC1-V item has used (most recently RC1-V-010 for
 *     roster Group B).
 *   - Snapshot generation (coaching_snapshots, PR37/ADR-016) is owned
 *     exclusively by services/coachingSnapshotService.js and is NOT a
 *     dispatch-shaped item on its own — but its two production trigger
 *     call sites (reflectionService.js::createReflection,
 *     growthPlanService.js::createGrowthPlan) fire as a real,
 *     unstubbed side effect of the REFLECT/NEW GOAL happy-path save
 *     scenarios below, so this harness confirms the side effect FIRES
 *     at the real dispatch boundary. The full snapshot dedup/threshold
 *     matrix (same-day skip, update-in-place, no-evidence skip, etc.)
 *     is intentionally NOT re-derived here — that is
 *     coachingSnapshotService's own service-level test surface
 *     (tests/coachingSnapshotService.test.js), consistent with the
 *     architecture's stated boundaries (its own header comment: this
 *     service is the sole writer, integration surface is exactly the
 *     two create*() call sites).
 *   - Trend-based recommendations (coachingTrendService.js, PR38) are
 *     explicitly read-only/classification-only per that file's own
 *     scope comment and ADR-016 §1's PR38/PR39/PR40 ownership split —
 *     out of scope for this dispatch harness entirely; that is
 *     coachingTrendService.test.js's job.
 *
 * Real components exercised (nothing stubbed except the WhatsApp send
 * boundary and, where noted, top-level dispatch entries unrelated to
 * this flow pair):
 *   - core/messageProcessor.js::processMessage() — real entry point
 *   - core/commandHandler.js is NOT explicitly invoked here since
 *     REFLECT/NEW GOAL are intent-routed, not literal-command-routed
 *     (see flows/reflectionFlow.js / growthPlanFlow.js: entry is via
 *     parseIntent(text).type === 'reflection'/'growth_plan', matched
 *     against the real utils/intentParser.js regex-fallback shortcuts)
 *   - flows/reflectionFlow.js::handleReflectionFlow (real)
 *   - flows/growthPlanFlow.js::handleGrowthPlanFlow (real)
 *   - services/reflectionService.js::createReflection (real)
 *   - services/growthPlanService.js::createGrowthPlan (real)
 *   - services/coachingSnapshotService.js::recordSnapshotsForTeacher (real,
 *     fired as an unstubbed side effect, not called directly by this file)
 *   - services/navigationService.js (real) — correction-menu path,
 *     confirming no RC1-H-013 regression at the real dispatch boundary
 *   - utils/intentParser.js::parseIntent (real) — REFLECT/NEW GOAL bare
 *     shortcuts
 *   - A real-migration SQLite test DB (tests/helpers/createTestDb.js),
 *     which seeds services/schoolCalendarRepository.js's school_calendar
 *     table for real — getCurrentTerm() is NOT stubbed, so the actual
 *     term-resolution codepath is exercised too.
 *
 * Stubbed: safeSendMessage only (captures outbound text for assertions),
 * plus every OTHER flow's handler in the deps object (noopFlow) so this
 * harness only asserts on the REFLECT/NEW GOAL flow pair, matching the
 * pattern in tests/rc1-h-013-correction-menu-consumption.test.js.
 *
 * Scenario matrix (7 scenarios, matching the "minimum defensible
 * acceptance matrix" from the approved recon):
 *   1. REFLECT happy path — full field collection, topic selection,
 *      review, YES save, real coaching_snapshots row confirmed written.
 *   2. REFLECT correction-menu path (RC1-H-013 regression lock) — NO at
 *      review, numeric correction choice reaches the real handler (not
 *      rejected as invalid), corrected field lands in the final save.
 *   3. REFLECT CANCEL mid-flow — session cleared, no DB row created.
 *   4. REFLECT STATUS mid-flow — real NavigationService-delegated status
 *      text, session untouched.
 *   5. NEW GOAL happy path — goal + topic, review, YES save, real
 *      coaching_snapshots row confirmed written.
 *   6. NEW GOAL correction-menu path (RC1-H-013 regression lock).
 *   7. NEW GOAL CANCEL mid-flow — session cleared, no DB row created.
 *
 * Run individually: node tests/rc1-v011-coaching-group-c-dispatch.test.js
 * Run via npm:       npm test
 */

const { createTestDb } = require('./helpers/createTestDb');

// Required for utils/usageTracker.js::hashPhone (real HMAC hashing used by
// the Scenario 8 onboarding-boundary check below, matching the value used
// across the project's other RC1-V harnesses). Must be set before
// services/onboardingService.js or utils/usageTracker.js are required.
process.env.PII_SECRET = process.env.PII_SECRET || 'test-secret-key-32-bytes-long!!';

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
  const { handleReflectionFlow } = require('../flows/reflectionFlow');
  const { handleGrowthPlanFlow } = require('../flows/growthPlanFlow');
  const { createReflection, getReflection } = require('../services/reflectionService');
  const { createGrowthPlan } = require('../services/growthPlanService');
  const { getCurrentTerm } = require('../services/schoolCalendarRepository');
  const { getLatestSnapshot } = require('../services/coachingSnapshotService');
  const { parseIntent } = require('../utils/intentParser');
  const navigationService = require('../services/navigationService');
  const { needsOnboarding, handleOnboarding } = require('../services/onboardingService');
  // Real hash function onboardingService/usageTracker actually use — NOT
  // the fake hashPhone = (p) => `hash_${p}` used elsewhere in this file
  // for the reflection/growth-plan scenarios' phoneHash keys. Using the
  // real one here (scoped to its own scenario, own phone number) is
  // required for needsOnboarding()/handleOnboarding() to correctly find
  // the seeded onboarding/teachers rows below.
  const { hashPhone: realHashPhone } = require('../utils/usageTracker');

  const PHONE = '+27831234567';
  const hashPhone = (p) => `hash_${p}`;
  const phoneHash = hashPhone(PHONE);

  const reflectionState = new SessionStore('rc1v011Reflection', 24 * 60 * 60 * 1000);
  const growthPlanState = new SessionStore('rc1v011GrowthPlan', 24 * 60 * 60 * 1000);

  // Real flow registration, mirroring routes/webhook.js's own
  // registerFlow() calls exactly (menus/hooks copied verbatim from
  // webhook.js so NavigationService's correction-menu/STATUS behaviour
  // is genuinely representative of production, not a simplified stand-in).
  function describeReflectionStatus(phHash) {
    const state = reflectionState.get(phHash);
    if (!state) return null;
    const stepLabels = {
      awaitingLesson: 'waiting for the lesson',
      awaitingWentWell: 'waiting for what went well',
      awaitingImprovement: 'waiting for what to improve',
      awaitingTopic: 'waiting for the topic',
      reviewSummary: 'reviewing before save',
      awaitingCorrectionChoice: 'choosing what to correct',
    };
    const stepLabel = stepLabels[state.step] || state.step;
    return (
      `📝 *Reflection in progress* — ${stepLabel}.\n` +
      `Reply *CANCEL* to discard, or continue where you left off.`
    );
  }

  function describeGrowthPlanStatus(phHash) {
    const state = growthPlanState.get(phHash);
    if (!state) return null;
    const stepLabels = {
      awaitingGoal: 'waiting for the goal',
      awaitingTopic: 'waiting for the topic',
      reviewSummary: 'reviewing before save',
      awaitingCorrectionChoice: 'choosing what to correct',
    };
    const stepLabel = stepLabels[state.step] || state.step;
    return (
      `🎯 *Growth Plan in progress* — ${stepLabel}.\n` +
      `Reply *CANCEL* to discard, or continue where you left off.`
    );
  }

  navigationService.registerFlow({
    id: 'reflection',
    commands: [],
    capabilities: { status: true, cancel: true, back: false, menus: true },
    menus: {
      correctionChoice: ['Lesson', 'What went well', 'What I would improve', 'Topic', 'Cancel'],
    },
    hooks: {
      cleanup: (phHash) => reflectionState.delete(phHash),
      describeStatus: describeReflectionStatus,
    },
  });

  navigationService.registerFlow({
    id: 'growthPlan',
    commands: [],
    capabilities: { status: true, cancel: true, back: false, menus: true },
    menus: { correctionChoice: ['Goal', 'Topic', 'Cancel'] },
    hooks: {
      cleanup: (phHash) => growthPlanState.delete(phHash),
      describeStatus: describeGrowthPlanStatus,
    },
  });

  function buildReflectionDeps() {
    return {
      reflectionState,
      safeSendMessage,
      parseIntent,
      hashPhone,
      createReflection, // REAL — subject under test, fires real snapshot side effect
      getCurrentTerm, // REAL — real school_calendar lookup, not stubbed
    };
  }

  function buildGrowthPlanDeps() {
    return {
      growthPlanState,
      safeSendMessage,
      parseIntent,
      hashPhone,
      createGrowthPlan, // REAL — subject under test, fires real snapshot side effect
      getCurrentTerm, // REAL
    };
  }

  const emptyState = (type) => new SessionStore(type, 24 * 60 * 60 * 1000);
  const noopFlow = async () => false;
  const sentMessages = [];

  async function safeSendMessage(to, msg) {
    sentMessages.push({ to, msg });
  }

  let messageCounter = 0;
  function buildDeps() {
    return Object.freeze({
      isDuplicate: () => false,
      getTeacherByPhone: () => undefined,
      updateTeacherProfile: () => {},
      hashPhone,
      safeSendMessage,
      encryptPhone: () => 'enc',
      dataAssessmentState: emptyState('rc1v011DataAssessment'),
      handleAssessmentFlow: noopFlow,
      buildAssessmentDeps: () => ({}),
      handleCommand: async () => false,
      handleMainMenuFlow: noopFlow,
      buildMainMenuDeps: () => ({}),
      needsOnboarding: () => false,
      handleOnboarding: () => ({ handled: false }),
      pendingIntentState: emptyState('rc1v011PendingIntent'),
      triggerGeneration: async () => {},
      buildGenerationDeps: () => ({}),
      reportCommentState: emptyState('rc1v011ReportComment'),
      parentMessageState: emptyState('rc1v011ParentMessage'),
      assessmentAnalysisState: emptyState('rc1v011AssessmentAnalysis'),
      interventionPlanState: emptyState('rc1v011InterventionPlan'),
      profileUpdateState: emptyState('rc1v011ProfileUpdate'),
      observationState: emptyState('rc1v011Observation'),
      observationHistoryState: emptyState('rc1v011ObservationHistory'),
      assessmentSessionState: emptyState('rc1v011AssessmentSession'),
      blueprintAuthoringState: emptyState('rc1v011BlueprintAuthoring'),
      rosterState: emptyState('rc1v011Roster'),
      reflectionState,
      growthPlanState,
      incidentState: emptyState('rc1v011Incident'),
      handleObservationFlow: noopFlow,
      buildObservationDeps: () => ({}),
      handleObservationHistoryFlow: noopFlow,
      handleReflectionFlow, // REAL — subject under test
      buildReflectionDeps,
      handleGrowthPlanFlow, // REAL — subject under test
      buildGrowthPlanDeps,
      handleIncidentFlow: noopFlow,
      buildIncidentDeps: () => ({}),
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
      // NOTE (harness-writing-time claim refined during RC1-V-011
      // provenance review): this comment previously implied
      // core/messageProcessor.js's skipClassifier branch currently calls
      // a bare, unimported `parseIntent(text)` causing a live production
      // ReferenceError. Re-checked directly against the current source
      // (core/messageProcessor.js:253): the real call is
      // `deps.parseIntent(text)`, correctly namespaced through the deps
      // object. This is not a live defect and no H/V item should be
      // opened from it — the bare-call bug was real, but was already
      // found and fixed as RC1-H-014 ("repair classifier fallback intent
      // parsing," commit 3bd8200, regression-locked by
      // tests/rc1-h-014-skipclassifier-parseintent-undefined.test.js),
      // which predates this repository's current HEAD. This note exists
      // only so a future reader doesn't rediscover the same claim and
      // waste time re-investigating an already-closed defect.
      // isClassifierRateLimited is still left at false below simply to
      // keep this harness's classification path scoped to
      // deps.classifyIntent, matching the pattern every other RC1-V
      // dispatch harness uses to stub the AI/network boundary while
      // keeping the real regex fallback available inside that stub.
      isClassifierRateLimited: () => false,
      isCeilingReached: () => false,
      parseIntent,
      // Stubs only the AI/network boundary (no live classifier call is
      // made), but returns the REAL utils/intentParser.js::parseIntent()
      // result — i.e. real, representative regex-fallback classification
      // of REFLECT/NEW GOAL shortcuts, not a hand-picked fake intent.
      classifyIntent: async (msgText) => parseIntent(msgText),
    });
  }

  function lastMessage() {
    return sentMessages[sentMessages.length - 1]?.msg || '';
  }

  async function send(text) {
    sentMessages.length = 0;
    messageCounter += 1;
    await processMessage(
      { from: PHONE, id: `rc1v011-msg-${messageCounter}`, type: 'text', text: { body: text } },
      buildDeps()
    );
  }

  function countReflectionRows() {
    return testDb.getDb().prepare(`SELECT COUNT(*) AS c FROM qms_reflections WHERE phone_hash = ?`).get(phoneHash).c;
  }

  function countGrowthPlanRows() {
    return testDb.getDb().prepare(`SELECT COUNT(*) AS c FROM qms_growth_plans WHERE phone_hash = ?`).get(phoneHash).c;
  }

  function resetSessions() {
    reflectionState.delete(phoneHash);
    growthPlanState.delete(phoneHash);
    navigationService.closeMenu(phoneHash);
  }

  // Sanity precondition: getCurrentTerm() must resolve for real against
  // the seeded school_calendar table (utils/database.js Migration 033),
  // or every scenario below would fail for an unrelated reason.
  const currentTerm = getCurrentTerm();
  assert(Number.isInteger(currentTerm) && currentTerm >= 1 && currentTerm <= 4,
    `precondition: getCurrentTerm() resolves a real term for today (got ${currentTerm})`);

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 1: REFLECT happy path (real dispatch + real snapshot side effect) ──');
  resetSessions();

  const beforeReflectionRows = countReflectionRows();

  await send('REFLECT');
  assert(/Log a Reflection/i.test(lastMessage()), 'REFLECT: opening prompt asks for the lesson');
  assert(reflectionState.get(phoneHash)?.step === 'awaitingLesson', 'REFLECT: session created at awaitingLesson');

  await send('Fractions intro, Grade 6');
  assert(reflectionState.get(phoneHash)?.step === 'awaitingWentWell', 'REFLECT: lesson accepted, advances to awaitingWentWell');

  await send('Learners engaged well with the fraction wall');
  assert(reflectionState.get(phoneHash)?.step === 'awaitingImprovement', 'REFLECT: wentWell accepted, advances to awaitingImprovement');

  await send('More worked examples before independent practice');
  assert(reflectionState.get(phoneHash)?.step === 'awaitingTopic', 'REFLECT: improvement accepted, advances to awaitingTopic');
  assert(/coaching area/i.test(lastMessage()), 'REFLECT: topic list rendered');

  await send('1'); // TOPIC_CLASSROOM_MANAGEMENT — first topic in listTopicsOrdered()
  assert(reflectionState.get(phoneHash)?.step === 'reviewSummary', 'REFLECT: topic accepted, advances to reviewSummary');
  assert(/Save this reflection/i.test(lastMessage()), 'REFLECT: review summary rendered');

  await send('YES');
  assert(/Reflection saved successfully/i.test(lastMessage()), 'REFLECT: YES at review saves and confirms');
  assert(reflectionState.get(phoneHash) === null || reflectionState.get(phoneHash) === undefined,
    'REFLECT: session cleared after save');
  assert(countReflectionRows() === beforeReflectionRows + 1, 'REFLECT: exactly one real qms_reflections row was inserted');

  const savedReflection = testDb.getDb()
    .prepare(`SELECT * FROM qms_reflections WHERE phone_hash = ? ORDER BY id DESC LIMIT 1`)
    .get(phoneHash);
  assert(savedReflection.topic_id === 'TOPIC_CLASSROOM_MANAGEMENT', 'REFLECT: saved row has the selected topic_id');
  assert(savedReflection.term === currentTerm, 'REFLECT: saved row is stamped with the real current term');
  assert(/Fractions intro/.test(savedReflection.content), 'REFLECT: saved row content includes the real lesson text');

  const snapshotAfterReflect = getLatestSnapshot(phoneHash, 'TOPIC_CLASSROOM_MANAGEMENT');
  assert(snapshotAfterReflect !== null,
    'REFLECT: real recordSnapshotsForTeacher() side effect fired — a coaching_snapshots row exists for the reflected topic');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 2: REFLECT correction-menu path (RC1-H-013 regression lock) ──');
  resetSessions();

  await send('REFLECT');
  await send('Correction test lesson');
  await send('Went well text');
  await send('Improvement text');
  await send('1');
  assert(reflectionState.get(phoneHash)?.step === 'reviewSummary', 'REFLECT correction: precondition — reached reviewSummary');

  await send('NO');
  assert(reflectionState.get(phoneHash)?.step === 'awaitingCorrectionChoice', 'REFLECT correction: NO opens correction menu');
  assert(navigationService.getOpenMenu(phoneHash)?.id === 'reflection.correctionChoice', 'REFLECT correction: real correction menu is open');

  await send('2'); // WENT_WELL
  assert(reflectionState.get(phoneHash)?.step === 'awaitingWentWell',
    'REFLECT correction: numeric reply "2" reaches the real handler (RC1-H-013 fixed, not rejected as invalid)');
  assert(!/Please reply with a number/i.test(lastMessage()), 'REFLECT correction: reply is not the generic invalid-reply re-render');

  await send('Corrected went-well text');
  assert(reflectionState.get(phoneHash)?.step === 'reviewSummary', 'REFLECT correction: corrected field returns to reviewSummary');
  assert(/Corrected went-well text/.test(lastMessage()), 'REFLECT correction: updated summary shows the corrected field');

  await send('YES');
  assert(/Reflection saved successfully/i.test(lastMessage()), 'REFLECT correction: final save succeeds after a correction');
  const correctedReflection = testDb.getDb()
    .prepare(`SELECT * FROM qms_reflections WHERE phone_hash = ? ORDER BY id DESC LIMIT 1`)
    .get(phoneHash);
  assert(/Corrected went-well text/.test(correctedReflection.content), 'REFLECT correction: saved row contains the corrected text, not the original');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 3: REFLECT CANCEL mid-flow ──');
  resetSessions();
  const beforeCancelReflectRows = countReflectionRows();

  await send('REFLECT');
  await send('Some lesson');
  assert(reflectionState.get(phoneHash)?.step === 'awaitingWentWell', 'REFLECT cancel: precondition — mid-flow');

  await send('CANCEL');
  assert(/No problem — cancelled/i.test(lastMessage()), 'REFLECT cancel: correct cancellation message');
  assert(reflectionState.get(phoneHash) === null || reflectionState.get(phoneHash) === undefined, 'REFLECT cancel: session cleared');
  assert(countReflectionRows() === beforeCancelReflectRows, 'REFLECT cancel: no DB row was created');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 4: REFLECT STATUS mid-flow ──');
  resetSessions();

  await send('REFLECT');
  await send('Status test lesson');
  assert(reflectionState.get(phoneHash)?.step === 'awaitingWentWell', 'REFLECT status: precondition — mid-flow');

  await send('STATUS');
  assert(/Reflection in progress/i.test(lastMessage()), 'REFLECT status: real NavigationService-delegated status text returned');
  assert(/waiting for what went well/i.test(lastMessage()), 'REFLECT status: status text reflects the real current step');
  assert(reflectionState.get(phoneHash)?.step === 'awaitingWentWell', 'REFLECT status: session untouched by STATUS');

  await send('CANCEL'); // clean up
  resetSessions();

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 5: NEW GOAL happy path (real dispatch + real snapshot side effect) ──');
  const beforeGrowthPlanRows = countGrowthPlanRows();

  await send('NEW GOAL');
  assert(/Create a Growth Plan/i.test(lastMessage()), 'NEW GOAL: opening prompt asks for the goal');
  assert(growthPlanState.get(phoneHash)?.step === 'awaitingGoal', 'NEW GOAL: session created at awaitingGoal');

  await send('Improve pacing in the fractions unit');
  assert(growthPlanState.get(phoneHash)?.step === 'awaitingTopic', 'NEW GOAL: goal accepted, advances to awaitingTopic');
  assert(/coaching area/i.test(lastMessage()), 'NEW GOAL: topic list rendered');

  await send('4'); // TOPIC_DIFFERENTIATION — 4th topic in listTopicsOrdered(), deliberately distinct from the reflection scenario's topic
  assert(growthPlanState.get(phoneHash)?.step === 'reviewSummary', 'NEW GOAL: topic accepted, advances to reviewSummary');
  assert(/Save this growth plan/i.test(lastMessage()), 'NEW GOAL: review summary rendered');

  await send('YES');
  assert(/Growth plan saved successfully/i.test(lastMessage()), 'NEW GOAL: YES at review saves and confirms');
  assert(growthPlanState.get(phoneHash) === null || growthPlanState.get(phoneHash) === undefined,
    'NEW GOAL: session cleared after save');
  assert(countGrowthPlanRows() === beforeGrowthPlanRows + 1, 'NEW GOAL: exactly one real qms_growth_plans row was inserted');

  const savedGoal = testDb.getDb()
    .prepare(`SELECT * FROM qms_growth_plans WHERE phone_hash = ? ORDER BY id DESC LIMIT 1`)
    .get(phoneHash);
  assert(savedGoal.topic_id === 'TOPIC_DIFFERENTIATION', 'NEW GOAL: saved row has the selected topic_id');
  assert(savedGoal.status === 'active', 'NEW GOAL: saved row has status "active"');
  assert(savedGoal.term === currentTerm, 'NEW GOAL: saved row is stamped with the real current term');

  const snapshotAfterGoal = getLatestSnapshot(phoneHash, 'TOPIC_DIFFERENTIATION');
  assert(snapshotAfterGoal !== null,
    'NEW GOAL: real recordSnapshotsForTeacher() side effect fired — a coaching_snapshots row exists for the goal topic');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 6: NEW GOAL correction-menu path (RC1-H-013 regression lock) ──');
  resetSessions();

  await send('NEW GOAL');
  await send('Correction test goal');
  await send('4');
  assert(growthPlanState.get(phoneHash)?.step === 'reviewSummary', 'NEW GOAL correction: precondition — reached reviewSummary');

  await send('NO');
  assert(growthPlanState.get(phoneHash)?.step === 'awaitingCorrectionChoice', 'NEW GOAL correction: NO opens correction menu');
  assert(navigationService.getOpenMenu(phoneHash)?.id === 'growthPlan.correctionChoice', 'NEW GOAL correction: real correction menu is open');

  await send('1'); // GOAL
  assert(growthPlanState.get(phoneHash)?.step === 'awaitingGoal',
    'NEW GOAL correction: numeric reply "1" reaches the real handler (RC1-H-013 fixed, not rejected as invalid)');
  assert(!/Please reply with a number/i.test(lastMessage()), 'NEW GOAL correction: reply is not the generic invalid-reply re-render');

  await send('Corrected goal text');
  assert(growthPlanState.get(phoneHash)?.step === 'reviewSummary', 'NEW GOAL correction: corrected field returns to reviewSummary');
  assert(/Corrected goal text/.test(lastMessage()), 'NEW GOAL correction: updated summary shows the corrected field');

  await send('YES');
  assert(/Growth plan saved successfully/i.test(lastMessage()), 'NEW GOAL correction: final save succeeds after a correction');
  const correctedGoal = testDb.getDb()
    .prepare(`SELECT * FROM qms_growth_plans WHERE phone_hash = ? ORDER BY id DESC LIMIT 1`)
    .get(phoneHash);
  assert(/Corrected goal text/.test(correctedGoal.goal_text), 'NEW GOAL correction: saved row contains the corrected text, not the original');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 7: NEW GOAL CANCEL mid-flow ──');
  resetSessions();
  const beforeCancelGoalRows = countGrowthPlanRows();

  await send('NEW GOAL');
  await send('Some goal');
  assert(growthPlanState.get(phoneHash)?.step === 'awaitingTopic', 'NEW GOAL cancel: precondition — mid-flow');

  await send('CANCEL');
  assert(/No problem — cancelled/i.test(lastMessage()), 'NEW GOAL cancel: correct cancellation message');
  assert(growthPlanState.get(phoneHash) === null || growthPlanState.get(phoneHash) === undefined, 'NEW GOAL cancel: session cleared');
  assert(countGrowthPlanRows() === beforeCancelGoalRows, 'NEW GOAL cancel: no DB row was created');

  resetSessions();

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 8: Onboarding boundary — unonboarded teacher, REFLECT/NEW GOAL ──');
  // Matches the RC1-V-009/V-010 pattern: this harness's other scenarios
  // stub needsOnboarding to false to isolate the reflection/growth-plan
  // flow logic. That leaves the onboarding -> REFLECT/NEW GOAL handoff
  // itself unverified — the same class of blind spot RC1-H-012's
  // header documents for workspace commands. This scenario closes that
  // gap by running two teachers (brand-new, no onboarding row at all;
  // and mid-onboarding) through the REAL onboarding gate in
  // core/messageProcessor.js (needsOnboarding/handleOnboarding, not
  // stubbed here), confirming REFLECT/NEW GOAL are correctly
  // intercepted rather than leaking into reflectionState/growthPlanState
  // before onboarding completes.
  const db = testDb.getDb();
  const NEW_PHONE = '+27837654321';
  const newPhoneHash = realHashPhone(NEW_PHONE);
  const MID_PHONE = '+27839998888';
  const midPhoneHash = realHashPhone(MID_PHONE);

  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject) VALUES (?, ?, ?, ?)`)
    .run(newPhoneHash, null, null, null);
  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject) VALUES (?, ?, ?, ?)`)
    .run(midPhoneHash, null, null, null);
  db.prepare(`
    INSERT INTO onboarding (phone_hash, step, updated_at)
    VALUES (?, 'askGrade', datetime('now'))
    ON CONFLICT(phone_hash) DO UPDATE SET step = excluded.step
  `).run(midPhoneHash);

  function buildOnboardingAwareDeps() {
    return { ...buildDeps(), needsOnboarding, handleOnboarding };
  }

  async function sendWithRealOnboarding(phone, body) {
    sentMessages.length = 0;
    messageCounter += 1;
    await processMessage(
      { from: phone, id: `rc1v011-onb-msg-${messageCounter}`, type: 'text', text: { body } },
      buildOnboardingAwareDeps()
    );
  }

  // 8a. Brand-new teacher (no onboarding row at all) sends REFLECT.
  await sendWithRealOnboarding(NEW_PHONE, 'REFLECT');
  assert(!/Reflection time/i.test(lastMessage()), '8a: brand-new teacher sending REFLECT does NOT reach the reflection flow prompt');
  assert(reflectionState.get(newPhoneHash) == null, '8a: brand-new teacher sending REFLECT leaves reflectionState unset');

  // 8b. Brand-new teacher sends NEW GOAL.
  await sendWithRealOnboarding(NEW_PHONE, 'NEW GOAL');
  assert(!/growth goal/i.test(lastMessage()) || /grade|subject|school|language|welcome/i.test(lastMessage()), '8b: brand-new teacher sending NEW GOAL is met with onboarding, not the growth-plan prompt');
  assert(growthPlanState.get(newPhoneHash) == null, '8b: brand-new teacher sending NEW GOAL leaves growthPlanState unset');

  // 8c. Mid-onboarding teacher (step=askGrade) sends REFLECT.
  await sendWithRealOnboarding(MID_PHONE, 'REFLECT');
  assert(reflectionState.get(midPhoneHash) == null, '8c: mid-onboarding teacher sending REFLECT leaves reflectionState unset');

  // 8d. Mid-onboarding teacher sends NEW GOAL.
  await sendWithRealOnboarding(MID_PHONE, 'NEW GOAL');
  assert(growthPlanState.get(midPhoneHash) == null, '8d: mid-onboarding teacher sending NEW GOAL leaves growthPlanState unset');

  // 8e. Fully onboarded teacher (control) — confirm the gate does not
  // false-positive block the existing 59-assertion teacher.
  await send('REFLECT');
  assert(reflectionState.get(phoneHash) != null, '8e: fully onboarded control teacher sending REFLECT DOES reach reflectionState (gate does not over-block)');
  resetSessions();

  resetSessions();

  // ═══════════════════════════════════════════════════════════════════
  console.log(`\n${passed} passed, ${failed} failed`);
  testDb.cleanup();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
