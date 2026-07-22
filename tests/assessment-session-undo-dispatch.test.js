'use strict';
/**
 * Assessment Session Flow — UNDO/BACK dispatch tests (ADR-006 PR5 Phase 1a).
 *
 * Covers the ACTIVE-step dispatch branch added in Phase 1a:
 *   1. UNDO reverts the most recent interactive reply and re-renders the
 *      prompt for the reverted step (prefixed with an "Undone." notice).
 *   2. BACK is a working alias for UNDO.
 *   3. UNDO reverts a whole bulk paste as one unit, same as the
 *      service-level guarantee, end-to-end through the flow.
 *   4. UNDO with nothing to undo yet reports the error and does not
 *      touch the session state.
 *   5. UNDO is a no-op on other session steps (SELECT_BLUEPRINT /
 *      SELECT_CLASS) — it isn't a global command, only ACTIVE-step
 *      capture has a history to walk back.
 *   6. "UNDO"/"BACK" are never mistaken for a bulk paste or misrouted
 *      into submitReply()/submitBulkReply() as a name or mark value.
 *
 * Run individually: node tests/assessment-session-undo-dispatch.test.js
 * Run via npm:       npm test
 */

const Module = require('module');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

let _db = null;
const dbPath = path.resolve(__dirname, '../utils/database');

const _origResolve = Module._resolveFilename.bind(Module);
Module._resolveFilename = function (request, parent, isMain, opts) {
  if (request === 'better-sqlite3') return request;
  if (request === '../utils/database' || request === './database') return dbPath;
  return _origResolve(request, parent, isMain, opts);
};

require.cache['better-sqlite3'] = {
  id: 'better-sqlite3',
  filename: 'better-sqlite3',
  loaded: true,
  exports: function Database() {
    if (!_db.pragma) _db.pragma = () => {};
    return _db;
  },
};

require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { getDb: () => _db },
};

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

function buildSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      phone_hash    TEXT    NOT NULL,
      session_type  TEXT    NOT NULL,
      state         TEXT    NOT NULL,
      updated_at    REAL    NOT NULL,
      PRIMARY KEY (phone_hash, session_type)
    );
  `);
}

function fakeParseMarks({ learners = [], warnings = [], errors = [] } = {}) {
  return () => ({ learners, totalMark: 0, questionCount: 2, questionMaxMarks: {}, questionTopics: {}, warnings, errors });
}

function learnerRecord(name, q1, q2) {
  return { learnerName: name, questionData: { 1: { mark: q1, maxMark: 5 }, 2: { mark: q2, maxMark: 10 } } };
}

async function run() {
  _db = new DatabaseSync(':memory:');
  buildSchema(_db);

  const { SessionStore } = require('../utils/sessionStore');
  const { handleAssessmentSessionFlow } = require('../flows/assessmentSessionFlow');

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

  const processAssessmentData = async () => ({ assessmentId: 999, teacherSummary: 'stub summary' });

  let parseMarksImpl = fakeParseMarks();
  const sentMessages = [];

  function makeState() {
    return new SessionStore('assessmentSessionUndoDispatch', 24 * 60 * 60 * 1000);
  }

  let assessmentSessionState = makeState();

  function buildDeps() {
    return {
      hashPhone,
      safeSendMessage: async (to, msg) => { sentMessages.push({ to, msg }); },
      assessmentSessionState,
      listBlueprints: () => blueprintsFixture,
      getTeacherClasses: () => classesFixture,
      getBlueprintById,
      processAssessmentData,
      parseMarks: (...args) => parseMarksImpl(...args),
    };
  }

  function lastMessage() {
    return sentMessages[sentMessages.length - 1]?.msg || '';
  }

  async function send(text) {
    sentMessages.length = 0;
    return handleAssessmentSessionFlow(PHONE, text, null, null, buildDeps());
  }

  async function enterActiveSession() {
    assessmentSessionState = makeState();
    // Sessions are rows in a shared SQLite table keyed by (phone_hash,
    // session_type) — a "new" SessionStore instance does NOT give a blank
    // slate on its own. A prior section can leave a session open (most
    // sections here don't run it to completion/CANCEL), and NEW TEST
    // refuses to clobber an in-progress session — so explicitly clear
    // any leftover row first to guarantee each section starts fresh.
    assessmentSessionState.delete(phoneHash);
    await send('NEW TEST');
    await send('1'); // blueprint
    await send('1'); // class -> ACTIVE
  }

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 1: UNDO reverts the last interactive reply ──────────────');
  await enterActiveSession();
  await send('Sipho Dlamini'); // name
  await send('4'); // Q1 = 4 (typo, should be 9)

  let state = assessmentSessionState.get(phoneHash);
  assert(state.learners[0].marks[1] === 4, 'mistaken mark recorded before undo');

  let handled = await send('UNDO');
  assert(handled === true, 'UNDO is handled by the ACTIVE dispatch');
  assert(/Undone/i.test(lastMessage()), 'reply confirms the undo');
  assert(/Question 1/.test(lastMessage()), 'reply re-renders the prompt for the reverted step (back on Q1)');

  state = assessmentSessionState.get(phoneHash);
  assert(state.learners[0].marks[1] === undefined, 'the mistaken mark is gone from persisted session state');

  await send('5'); // correct entry (Q1's max is 5)
  state = assessmentSessionState.get(phoneHash);
  assert(state.learners[0].marks[1] === 5, 'corrected mark saved and capture continues normally after undo');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 2: BACK is a working alias for UNDO ─────────────────────');
  await enterActiveSession();
  await send('Sipho Dlamini');
  await send('4');

  handled = await send('BACK');
  assert(handled === true, 'BACK is handled by the ACTIVE dispatch');
  assert(/Undone/i.test(lastMessage()), 'BACK produces the same undo confirmation as UNDO');
  state = assessmentSessionState.get(phoneHash);
  assert(state.learners[0].marks[1] === undefined, 'BACK reverted the mistaken mark exactly like UNDO');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 3: UNDO reverts an entire bulk paste as one unit ───────');
  // A 2-learner bulk paste would complete the session outright (learnerCount
  // is 2), leaving nothing for UNDO to act on — use a 3-learner class so the
  // paste fills 2 of 3 slots and the session stays open.
  classesFixture[0].learner_count = 3;
  await enterActiveSession();
  parseMarksImpl = fakeParseMarks({
    learners: [learnerRecord('Sipho Dlamini', 4, 8), learnerRecord('Lebo Molefe', 5, 9)],
  });
  await send('Sipho Dlamini 4 8\nLebo Molefe 5 9');
  state = assessmentSessionState.get(phoneHash);
  assert(state.learnerIndex === 2, 'bulk paste applied to 2 of 3 learner slots, session still open');

  handled = await send('UNDO');
  assert(handled === true, 'UNDO handled after a bulk paste');
  state = assessmentSessionState.get(phoneHash);
  assert(state.learnerIndex === 0, 'UNDO reverted the whole paste at once — back to learner 1, not learner 2');
  assert(!state.learners[0] || !state.learners[0].name, 'both pasted learners are gone after a single undo');
  classesFixture[0].learner_count = 2; // restore fixture for subsequent sections

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 4: UNDO with nothing to undo reports the error ─────────');
  await enterActiveSession();
  const before = assessmentSessionState.get(phoneHash);

  handled = await send('UNDO');
  assert(handled === true, 'UNDO is still handled even when there is nothing to revert');
  assert(/Nothing to undo/i.test(lastMessage()), 'correct "nothing to undo" message on a fresh session');
  const after = assessmentSessionState.get(phoneHash);
  assert(JSON.stringify(after) === JSON.stringify(before), 'session state is completely untouched by a no-op UNDO');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 5: UNDO is not a global command outside ACTIVE ─────────');
  assessmentSessionState = makeState();
  assessmentSessionState.delete(phoneHash);
  await send('NEW TEST'); // -> SELECT_BLUEPRINT step, no capture history yet
  state = assessmentSessionState.get(phoneHash);
  assert(state.step === 'selectBlueprint', 'session is in SELECT_BLUEPRINT, not yet ACTIVE');

  handled = await send('UNDO');
  assert(handled === true, 'UNDO on a non-ACTIVE step still returns true (falls through to list-selection parsing)');
  assert(/Please reply with a number/i.test(lastMessage()), 'UNDO is treated as an invalid blueprint selection, not a global undo, outside ACTIVE');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 6: UNDO/BACK are never misrouted as a name or mark ─────');
  await enterActiveSession();
  // Learner 1's name step: sending "UNDO" here must trigger the undo
  // handler (a no-op, since there's no history yet), never be recorded
  // as a literal learner name.
  handled = await send('UNDO');
  assert(handled === true, 'UNDO handled during the NAME step');
  assert(/Nothing to undo/i.test(lastMessage()), 'UNDO during NAME step is treated as the undo command, not a name');
  state = assessmentSessionState.get(phoneHash);
  assert(!state.learners[0] || state.learners[0].name !== 'UNDO', '"UNDO" was never recorded as a literal learner name');

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Assessment Session Undo Dispatch Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test run threw:', err);
  process.exit(1);
});
