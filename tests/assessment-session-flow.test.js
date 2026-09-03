'use strict';
/**
 * Assessment Session Flow Tests (ADR-006 PR1 — Session Engine).
 *
 * Covers:
 *   1. NEW TEST with no published blueprints / no classes -> clear guidance,
 *      no session created.
 *   2. Happy path: NEW TEST -> pick blueprint -> pick class -> ACTIVE_SESSION,
 *      with the confirmation message reporting the right blueprint/class/
 *      learner count.
 *   3. Invalid numeric replies (out of range, non-numeric) are rejected
 *      without advancing the state.
 *   4. STATUS and CANCEL work at every step.
 *   5. NEW TEST while a session is already active does not clobber it.
 *   6. RESUME re-renders the current prompt without altering state
 *      (session persistence itself is SessionStore's job, exercised here
 *      via a real SQLite `sessions` table, not mocked away).
 *   7. STOP is deliberately NOT handled by this flow (see the comment in
 *      assessmentSessionFlow.js) — confirmed here so a future edit can't
 *      accidentally reintroduce the STOP/opt-out collision.
 *
 * Run individually: node tests/assessment-session-flow.test.js
 * Run via npm:       npm test
 */

// ── Shared real-migrations test DB helper (see docs/TSE_SCHOOL_CALENDAR_TEST_GAP.md) ──
const { createTestDb } = require('./helpers/createTestDb');

// Required lazily inside run(), after createTestDb() installs the
// better-sqlite3 shim — navigationService.js doesn't itself touch the
// DB, but requiring it up top would risk a future transitive require
// resolving the real (unbuilt) native module before the shim is live.
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

// ── Helpers ───────────────────────────────────────────────────────────────
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

  const assessmentSessionState = new SessionStore('assessmentSession', 24 * 60 * 60 * 1000);

  // Registration fix (ADR-019 Recommendation 2, Strict registration):
  // without this, NavigationService's registry is empty under test and
  // assessmentSessionFlow.js's now-unguarded
  // `getFlowDefinition('assessmentSession').hooks.*` calls throw the
  // same "Cannot read properties of null (reading 'hooks')" error that
  // growthPlan hit before Recommendation 1's fix.
  registerAssessmentSessionFlow(assessmentSessionState, describeAssessmentSessionStatus);

  const PHONE = '+27831234567';
  const hashPhone = (p) => `hash_${p}`;
  const phoneHash = hashPhone(PHONE);

  // In-memory fixtures standing in for blueprintRepository.listBlueprints
  // and teacherWorkspaceService.getTeacherClasses — this test is about the
  // state machine's own logic, not those services (which have their own
  // test files).
  let blueprintsFixture = [];
  let classesFixture = [];
  const sentMessages = [];

  // archivedBlueprintsFixture stands in for blueprints that exist (so
  // getBlueprintById can still find them, matching real getBlueprintById's
  // any-status lookup) but have been archived since being listed —
  // exercising the SELECT_CLASS-step re-check independently of
  // blueprintsFixture/listBlueprints, which only ever returns published
  // blueprints (matching the real status:'published' filter).
  let archivedBlueprintsFixture = [];

  const getBlueprintById = (id) => {
    const summary = archivedBlueprintsFixture.find((b) => b.id === id) || blueprintsFixture.find((b) => b.id === id);
    if (!summary) return null;
    return {
      id: summary.id,
      title: summary.title,
      grade: summary.grade,
      subject: summary.subject,
      term: summary.term ?? 3,
      totalMarks: summary.total_marks,
      version: summary.version ?? 1,
      status: summary.status ?? 'published',
      questions: [{ questionNumber: 1, topic: 'General', maxMarks: summary.total_marks }],
    };
  };

  const processAssessmentData = async () => ({
    assessmentId: 999,
    teacherSummary: 'stub summary',
  });

  const deps = {
    hashPhone,
    safeSendMessage: async (to, msg) => { sentMessages.push({ to, msg }); },
    assessmentSessionState,
    listBlueprints: () => blueprintsFixture,
    getTeacherClasses: () => classesFixture,
    getBlueprintById,
    processAssessmentData,
  };

  function lastMessage() {
    return sentMessages[sentMessages.length - 1]?.msg || '';
  }

  async function send(text) {
    sentMessages.length = 0;
    return handleAssessmentSessionFlow(PHONE, text, null, null, deps);
  }

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 1: NEW TEST with no published blueprints ─────────────────');
  blueprintsFixture = [];
  let handled = await send('NEW TEST');
  assert(handled === true, 'NEW TEST is handled even with no blueprints');
  assert(/published.*Blueprint/i.test(lastMessage()), 'guidance message mentions publishing a blueprint first');
  assert(assessmentSessionState.get(phoneHash) === undefined, 'no session was created');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 2: NEW TEST with blueprints but no classes ────────────────');
  blueprintsFixture = [
    { id: 1, title: 'Term 3 Fractions Test', grade: 5, subject: 'Mathematics', total_marks: 30, question_count: 4 },
  ];
  classesFixture = [];
  await send('NEW TEST');
  await send('1');
  assert(/don't have any classes/i.test(lastMessage()), 'guidance message when no classes exist');
  assert(assessmentSessionState.get(phoneHash) === undefined, 'session cleaned up after no-classes dead end');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 3: Happy path — blueprint -> class -> ACTIVE_SESSION ─────');
  classesFixture = [
    { id: 9, name: 'Grade 5B', grade: 5, subject: 'Mathematics', learner_count: 38 },
    { id: 10, name: 'Grade 5A', grade: 5, subject: 'Mathematics', learner_count: 34 },
  ];

  handled = await send('NEW TEST');
  assert(handled === true, 'NEW TEST starts a session');
  let state = assessmentSessionState.get(phoneHash);
  assert(state && state.step === 'selectBlueprint', 'state advances to selectBlueprint');
  assert(/Choose a Blueprint/i.test(lastMessage()), 'prompt asks to choose a blueprint');

  // Invalid replies at SELECT_BLUEPRINT
  await send('abc');
  assert(/reply with a number/i.test(lastMessage()), 'non-numeric reply rejected at blueprint step');
  await send('99');
  assert(/reply with a number/i.test(lastMessage()), 'out-of-range reply rejected at blueprint step');
  state = assessmentSessionState.get(phoneHash);
  assert(state.step === 'selectBlueprint', 'state unchanged after invalid blueprint replies');

  await send('1');
  state = assessmentSessionState.get(phoneHash);
  assert(state.step === 'selectClass', 'state advances to selectClass after valid blueprint pick');
  assert(state.blueprintId === 1, 'blueprintId recorded on state');
  assert(/Choose a Class/i.test(lastMessage()), 'prompt asks to choose a class');

  // Invalid replies at SELECT_CLASS
  await send('0');
  assert(/reply with a number/i.test(lastMessage()), 'out-of-range (0) reply rejected at class step');
  state = assessmentSessionState.get(phoneHash);
  assert(state.step === 'selectClass', 'state unchanged after invalid class reply');

  await send('1'); // Grade 5B
  state = assessmentSessionState.get(phoneHash);
  assert(state.step === 'active', 'state advances to ACTIVE after valid class pick');
  assert(state.classId === 9, 'classId recorded on state');
  assert(state.learnerCount === 38, 'learnerCount pulled from the class record');
  assert(/Assessment created/i.test(lastMessage()), 'confirmation message sent');
  assert(lastMessage().includes('Term 3 Fractions Test'), 'confirmation includes blueprint title');
  assert(lastMessage().includes('Grade 5B'), 'confirmation includes class name');
  assert(lastMessage().includes('38'), 'confirmation includes learner count');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 4: STATUS / CANCEL / re-NEW-TEST while active ────────────');
  await send('STATUS');
  assert(/Assessment Progress/.test(lastMessage()), 'STATUS reports Assessment Progress (ADR-006 PR2 capture status)');
  assert(/38/.test(lastMessage()), 'STATUS reports learner count');

  await send('NEW TEST');
  assert(/already have an assessment session in progress/i.test(lastMessage()), 'NEW TEST does not clobber an active session');
  state = assessmentSessionState.get(phoneHash);
  assert(state.step === 'active', 'state still active after blocked NEW TEST');

  await send('RESUME');
  assert(/Assessment Progress/.test(lastMessage()), 'RESUME re-renders capture status for an active session');
  state = assessmentSessionState.get(phoneHash);
  assert(state.step === 'active', 'RESUME does not alter state');

  await send('CANCEL');
  assert(/cancelled/i.test(lastMessage()), 'CANCEL confirms cancellation');
  assert(assessmentSessionState.get(phoneHash) === undefined, 'session removed after CANCEL');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 5: RESUME / STATUS with no session ────────────────────────');
  await send('RESUME');
  assert(/No active assessment session/i.test(lastMessage()), 'RESUME with no session gives clear guidance');
  await send('STATUS');
  assert(/No active assessment session/i.test(lastMessage()), 'STATUS with no session gives clear guidance');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 6: Blueprint archived between selection and class-pick ────');
  // Cycle 8 regression: SessionStore persists this session across turns
  // (and potentially days, per RESUME), so a blueprint picked at
  // SELECT_BLUEPRINT can legitimately be archived (e.g. via the
  // Dashboard) before SELECT_CLASS is reached. getBlueprintById() itself
  // returns blueprints in any status by design, so the flow must re-check
  // status itself rather than trusting SELECT_BLUEPRINT's earlier filter.
  archivedBlueprintsFixture = [
    { id: 2, title: 'Term 3 Geometry Test', grade: 5, subject: 'Mathematics', total_marks: 20, status: 'archived' },
  ];
  blueprintsFixture = [
    { id: 2, title: 'Term 3 Geometry Test', grade: 5, subject: 'Mathematics', total_marks: 20, question_count: 3 },
  ];
  classesFixture = [
    { id: 9, name: 'Grade 5B', grade: 5, subject: 'Mathematics', learner_count: 38 },
  ];

  await send('NEW TEST');
  await send('1'); // picks blueprint id 2 — published at this point (listBlueprints fixture)
  state = assessmentSessionState.get(phoneHash);
  assert(state.step === 'selectClass', 'state advances to selectClass on a still-published blueprint');

  // Blueprint gets archived out-of-band (Dashboard) while the WhatsApp
  // session sits at SELECT_CLASS — getBlueprintById now resolves it as
  // 'archived', matching the archivedBlueprintsFixture entry.
  await send('1'); // picks the class
  assert(/no longer available.*archived/is.test(lastMessage()), 'archived-blueprint re-check blocks capture with a clear message');
  assert(assessmentSessionState.get(phoneHash) === undefined, 'session cleaned up after archived-blueprint block');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 7: STOP is not handled here (reserved for global opt-out) ─');
  handled = await send('STOP');
  assert(handled === false, 'STOP falls through unhandled — no collision with the global opt-out command');

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Assessment Session Flow Results: ${passed} passed, ${failed} failed`);

  testDb.cleanup();

  // sessionStore.js registers an un-ref'd-free setInterval housekeeping
  // sweep on require, which otherwise keeps the process alive indefinitely
  // when this file is run standalone (node tests/assessment-session-flow.test.js).
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test run threw:', err);
  process.exit(1);
});
