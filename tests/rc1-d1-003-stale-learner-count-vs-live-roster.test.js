'use strict';
/**
 * RC1-D1-003 — stale learner_count vs live roster.
 *
 * Defect: SELECT_CLASS used chosenClass.learner_count (a cache, see
 * services/learnerRosterService.js's syncLearnerCount()/
 * getActiveRosterCounts()) as the sole learnerCount passed to
 * initCapture(). initCapture() slices the roster to learnerCount
 * (services/assessmentCaptureService.js), so when the cached count drifted
 * behind a larger live roster, capture silently truncated to the stale
 * count and never asked for the remaining learners.
 *
 * Fix: effectiveLearnerCount = Math.max(chosenClass.learner_count,
 * roster.length), used both for initCapture() and the confirmation
 * message. Math.max, not a straight substitution, because
 * initCapture()'s own contract allows learnerCount to legitimately exceed
 * the roster (roster prefills some learners, the rest are asked for by
 * name) — roster.length alone would break that case.
 *
 * Scenarios (all driven through the real handleAssessmentSessionFlow(),
 * no direct calls to Math.max/initCapture):
 *   1. learner_count=10, roster=17 (stale cache, defect case)
 *   2. learner_count=32, roster=0   (legacy class, no roster — unaffected)
 *   3. learner_count=10, roster=5   (partial roster by design — protected)
 *   4. learner_count=17, roster=17  (in sync — no-op)
 *   5. learner_count=0,  roster=0   (edge case — throw behaviour pinned, unfixed, as scoped)
 *
 * Run individually: node tests/rc1-d1-003-stale-learner-count-vs-live-roster.test.js
 * Run via npm:       npm test
 */

const { createTestDb } = require('./helpers/createTestDb');

let navigationService;

// Mirrors the assessmentSession FlowDefinition registered in
// routes/webhook.js — see assessment-session-flow.test.js for rationale.
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
  const { handleAssessmentSessionFlow, describeStatus: describeAssessmentSessionStatus } = require('../flows/assessmentSessionFlow');
  navigationService = require('../services/navigationService');

  const PHONE = '+27831234567';
  const hashPhone = (p) => `hash_${p}`;
  const phoneHash = hashPhone(PHONE);

  const getBlueprintById = (id) => ({
    id,
    title: 'Term 3 Fractions Test',
    grade: 5,
    subject: 'Mathematics',
    term: 3,
    totalMarks: 10,
    version: 1,
    questions: [{ questionNumber: 1, topic: 'Common Fractions', maxMarks: 10 }],
  });

  const processAssessmentData = async () => ({ assessmentId: 999, teacherSummary: 'stub summary' });

  // Configurable per-scenario fixtures, rebuilt/reassigned before each run.
  let blueprintsFixture;
  let classesFixture;
  let rosterFixture;
  let assessmentSessionState;
  let sentMessages;
  let deps;

  function setupScenario({ learnerCount, rosterNames }) {
    assessmentSessionState = new SessionStore('assessmentSession', 24 * 60 * 60 * 1000);
    // Guard against "NEW TEST while a session is already active" carrying
    // state across scenarios if SessionStore is DB-backed rather than
    // purely in-memory per instance.
    assessmentSessionState.delete(phoneHash);
    registerAssessmentSessionFlow(assessmentSessionState, describeAssessmentSessionStatus);

    sentMessages = [];
    blueprintsFixture = [
      { id: 1, title: 'Term 3 Fractions Test', grade: 5, subject: 'Mathematics', total_marks: 10, question_count: 1 },
    ];
    classesFixture = [
      { id: 9, name: 'Grade 5B', grade: 5, subject: 'Mathematics', learner_count: learnerCount },
    ];
    rosterFixture = rosterNames.map((name, i) => ({ id: i + 1, name }));

    deps = {
      hashPhone,
      safeSendMessage: async (to, msg) => { sentMessages.push({ to, msg }); },
      assessmentSessionState,
      listBlueprints: () => blueprintsFixture,
      getTeacherClasses: () => classesFixture,
      getBlueprintById,
      processAssessmentData,
      getClassRoster: () => rosterFixture,
    };
  }

  function lastMessage() {
    return sentMessages[sentMessages.length - 1]?.msg || '';
  }

  async function send(text) {
    sentMessages.length = 0;
    return handleAssessmentSessionFlow(PHONE, text, null, null, deps);
  }

  function names(n, prefix) {
    return Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 1: learner_count=10 (stale), roster=17 (live) — defect case ──');
  setupScenario({ learnerCount: 10, rosterNames: names(17, 'Learner') });
  await send('NEW TEST');
  await send('1'); // blueprint
  await send('1'); // class
  let state = assessmentSessionState.get(phoneHash);
  assert(state.learnerCount === 17, 'capture population uses live roster size (17), not stale cache (10)');
  assert(/Learners: \*17\*/.test(lastMessage()), 'confirmation message shows *17*, not *10*');
  assert(!/Learners: \*10\*/.test(lastMessage()), 'confirmation message does not show the stale *10*');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 2: learner_count=32, roster=0 (legacy, no roster) — unaffected ──');
  setupScenario({ learnerCount: 32, rosterNames: [] });
  await send('NEW TEST');
  await send('1');
  await send('1');
  state = assessmentSessionState.get(phoneHash);
  assert(state.learnerCount === 32, 'no-roster legacy class still captures the full cached count (32)');
  assert(/Learners: \*32\*/.test(lastMessage()), 'confirmation message shows *32*');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 3: learner_count=10, roster=5 (partial by design) — protected ──');
  setupScenario({ learnerCount: 10, rosterNames: names(5, 'Learner') });
  await send('NEW TEST');
  await send('1');
  await send('1');
  state = assessmentSessionState.get(phoneHash);
  assert(state.learnerCount === 10, 'Math.max(10,5)=10 preserves the partial-roster capture size');
  assert(state.learners.length === 5, '5 learners prefilled from roster (the other 5 of the 10 are asked for by name during capture)');
  assert(/Learners: \*10\*/.test(lastMessage()), 'confirmation message shows *10*');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 4: learner_count=17, roster=17 (in sync) — no-op ──');
  setupScenario({ learnerCount: 17, rosterNames: names(17, 'Learner') });
  await send('NEW TEST');
  await send('1');
  await send('1');
  state = assessmentSessionState.get(phoneHash);
  assert(state.learnerCount === 17, 'in-sync count is unaffected by the fix');
  assert(/Learners: \*17\*/.test(lastMessage()), 'confirmation message shows *17*');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 5: learner_count=0, roster=0 — edge case, throw behaviour pinned ──');
  setupScenario({ learnerCount: 0, rosterNames: [] });
  await send('NEW TEST');
  await send('1');
  let threw = false;
  try {
    await send('1');
  } catch (e) {
    threw = true;
  }
  // initCapture() throws synchronously for learnerCount < 1; the flow does
  // not currently catch this (out of scope for RC1-D1-003 — logged
  // separately, not fixed here). This assertion pins today's behaviour so
  // a future change to that contract is a deliberate, visible decision.
  assert(threw, 'learner_count=0 with no roster still throws (unfixed, out of scope, behaviour pinned)');

  // ═══════════════════════════════════════════════════════════════════
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Unhandled error in test run:', err);
  process.exit(1);
});
