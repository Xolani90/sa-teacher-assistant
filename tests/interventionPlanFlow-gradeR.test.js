'use strict';
/**
 * Regression test — flows/interventionPlanFlow.js treated a Grade R
 * ("grade: 0") teacher profile as if grade were unknown.
 *
 * Root cause: handleInterventionPlanFlow() decided whether to skip the
 * "what grade and subject is this for?" question using
 *   const knownGrade = teacher?.grade;
 *   if (knownGrade && knownSubject) { ... skip straight to focus/context ... }
 * Grade R is represented as the number 0, which is falsy in JavaScript.
 * For a Grade R teacher with a fully-populated profile (grade: 0,
 * subject: <known>), `knownGrade` evaluates to `0` (falsy), so the
 * `knownGrade && knownSubject` check is false even though both fields are
 * genuinely known. The flow incorrectly falls through to asking the
 * teacher to re-type their grade and subject on every single Intervention
 * Plan / SBA Support request, despite the profile already having that
 * information — the exact case the "already known" shortcut exists to
 * handle. Every other grade (1-12) is truthy and does not trip this bug,
 * which is why it went unnoticed: it only affects Foundation Phase
 * Reception Year (Grade R) teachers.
 *
 * Fix: check `knownGrade != null` instead of relying on truthiness, so
 * grade 0 is correctly recognised as "known".
 *
 * This test exercises the real, unmodified handleInterventionPlanFlow()
 * exported by flows/interventionPlanFlow.js — it is expected to FAIL
 * against the pre-fix implementation (bot re-asks for grade/subject) and
 * PASS against the corrected implementation (bot skips straight to the
 * focus-area / SBA-context question, using the profile's Grade R and
 * subject).
 *
 * Run individually: node tests/interventionPlanFlow-gradeR.test.js
 * Run via npm:       npm test
 */

const { handleInterventionPlanFlow } = require('../flows/interventionPlanFlow');

// Lightweight in-memory stand-in for the real (SQLite-backed) SessionStore.
// handleInterventionPlanFlow only relies on the .get()/.set()/.delete()
// Map-like interface documented at the top of interventionPlanFlow.js —
// it never touches SQLite directly — so a plain Map-backed fake exercises
// the exact same production code path without depending on the real
// database (which isn't necessary to reproduce this bug and keeps this
// test independent of the environment's native-module availability).
class FakeSessionStore {
  constructor() {
    this.map = new Map();
  }
  get(key) {
    return this.map.get(key);
  }
  set(key, value) {
    this.map.set(key, value);
    return value;
  }
  delete(key) {
    this.map.delete(key);
  }
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
  const PHONE = '+27831112222';

  const sentMessages = [];
  async function safeSendMessage(to, msg) {
    sentMessages.push({ to, msg });
  }
  function lastMessage() {
    return sentMessages[sentMessages.length - 1]?.msg || '';
  }

  // --- Scenario: intervention-mode trigger from a Grade R teacher whose
  // profile already has BOTH grade (0) and subject set. ---
  const interventionPlanState = new FakeSessionStore();

  const teacher = { grade: 0, subject: 'english', language: 'english' };

  const deps = {
    interventionPlanState,
    hashPhone: (p) => `hash_${p}`,
    parseIntent: () => ({ type: 'interventionPlan' }),
    getTeacherByPhone: () => teacher,
    isProActive: () => true,
    safeSendMessage,
    parseGrade: () => null,
    gradeLabel: (g) => (g === 0 ? 'Grade R' : `Grade ${g}`),
  };

  const preClassifiedIntent = { type: 'interventionPlan' };

  const handled = await handleInterventionPlanFlow(PHONE, 'My class is struggling to keep up', preClassifiedIntent, deps);
  assert(handled === true, "Scenario: Grade R trigger message is handled by the intervention flow");

  const phoneHash = deps.hashPhone(PHONE);
  const state = interventionPlanState.get(phoneHash);

  assert(!!state, 'Scenario: session state was created');
  assert(state && state.step === 'ask_focus_area', `Scenario: known Grade R + known subject skips straight to ask_focus_area (got step="${state && state.step}")`);
  assert(state && state.grade === 0, 'Scenario: state.grade correctly preserved as 0 (Grade R)');
  assert(
    !/what grade and subject/i.test(lastMessage()),
    'Scenario: teacher is NOT re-asked for grade/subject despite profile already having both'
  );
  assert(
    /from your profile/i.test(lastMessage()),
    `Scenario: response acknowledges the known profile instead of asking again (got: "${lastMessage()}")`
  );

  interventionPlanState.delete(phoneHash);

  // --- Control: same scenario but with a non-zero known grade (Grade 8)
  // must ALSO skip straight to ask_focus_area, proving the fix didn't
  // change behaviour for the already-working case. ---
  const controlState = new FakeSessionStore();
  const controlTeacher = { grade: 8, subject: 'mathematics', language: 'english' };
  const controlSent = [];
  const controlDeps = {
    interventionPlanState: controlState,
    hashPhone: (p) => `hash_${p}`,
    parseIntent: () => ({ type: 'interventionPlan' }),
    getTeacherByPhone: () => controlTeacher,
    isProActive: () => true,
    safeSendMessage: async (to, msg) => controlSent.push(msg),
    parseGrade: () => null,
    gradeLabel: (g) => `Grade ${g}`,
  };
  await handleInterventionPlanFlow(PHONE, 'My class is struggling to keep up', preClassifiedIntent, controlDeps);
  const controlPhoneHash = controlDeps.hashPhone(PHONE);
  const controlResultState = controlState.get(controlPhoneHash);
  assert(
    controlResultState && controlResultState.step === 'ask_focus_area',
    'Control: known Grade 8 + known subject still skips straight to ask_focus_area (unaffected by the fix)'
  );
  controlState.delete(controlPhoneHash);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Unexpected test runner error:', err);
  process.exit(1);
});
