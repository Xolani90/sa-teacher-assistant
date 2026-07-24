'use strict';
/**
 * ADR-005B: PRINT command — printable blank blueprint question paper.
 *
 * Covers:
 *   1. PRINT with no published blueprints -> clear guidance, no session.
 *   2. PRINT lists published blueprints; invalid replies re-prompt.
 *   3. Valid selection generates the paper via generateBlueprintPaperPdf()
 *      and sends it via sendDocument(), then clears the session (single-turn
 *      action — no capture state to keep around).
 *   4. Generation failure (error return, or thrown) is reported to the
 *      teacher without crashing the flow.
 *   5. PRINT does not collide with an active NEW TEST capture session, and
 *      CANCEL still works mid-PRINT.
 *
 * Run individually: node tests/assessment-session-print.test.js
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

async function run() {
  _db = new DatabaseSync(':memory:');
  buildSchema(_db);

  const { SessionStore } = require('../utils/sessionStore');
  const { handleAssessmentSessionFlow } = require('../flows/assessmentSessionFlow');

  const assessmentSessionState = new SessionStore('assessmentSession', 24 * 60 * 60 * 1000);

  const PHONE = '+27831234567';
  const hashPhone = (p) => `hash_${p}`;
  const phoneHash = hashPhone(PHONE);

  let blueprintsFixture = [];
  const sentMessages = [];
  const sentDocuments = [];
  let paperResult = null; // set per-section to control generateBlueprintPaperPdf()'s return
  let paperCalls = [];

  const deps = {
    hashPhone,
    safeSendMessage: async (to, msg) => { sentMessages.push({ to, msg }); },
    assessmentSessionState,
    listBlueprints: () => blueprintsFixture,
    getTeacherClasses: () => [],
    getBlueprintById: () => null,
    processAssessmentData: async () => ({ assessmentId: 1, teacherSummary: '' }),
    generateBlueprintPaperPdf: async (blueprintId) => {
      paperCalls.push(blueprintId);
      if (typeof paperResult === 'function') return paperResult(blueprintId);
      return paperResult;
    },
    buildPdfUrl: (fileId) => `https://example.test/pdf/${fileId}`,
    sendDocument: async (to, url, filename, caption) => { sentDocuments.push({ to, url, filename, caption }); },
  };

  function lastMessage() {
    return sentMessages[sentMessages.length - 1]?.msg || '';
  }

  async function send(text) {
    sentMessages.length = 0;
    return handleAssessmentSessionFlow(PHONE, text, null, null, deps);
  }

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 1: PRINT with no published blueprints ─────────────────');
  blueprintsFixture = [];
  let handled = await send('PRINT');
  assert(handled === true, 'PRINT is handled even with no blueprints');
  assert(/published.*Blueprint/i.test(lastMessage()), 'guidance message mentions publishing a blueprint first');
  assert(assessmentSessionState.get(phoneHash) === undefined, 'no session was created');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 2: PRINT lists blueprints; invalid replies re-prompt ──');
  blueprintsFixture = [
    { id: 1, title: 'Term 3 Fractions Test', grade: 5, subject: 'Mathematics', total_marks: 30, question_count: 4 },
    { id: 2, title: 'Term 3 Algebra Test', grade: 7, subject: 'Mathematics', total_marks: 20, question_count: 3 },
  ];

  handled = await send('PRINT');
  assert(handled === true, 'PRINT starts a print sub-session');
  let state = assessmentSessionState.get(phoneHash);
  assert(state && state.step === 'selectPrintBlueprint', 'state advances to selectPrintBlueprint');
  assert(/Choose a Blueprint/i.test(lastMessage()), 'prompt asks to choose a blueprint');
  assert(lastMessage().includes('Term 3 Fractions Test') && lastMessage().includes('Term 3 Algebra Test'), 'both blueprints listed');

  await send('abc');
  assert(/reply with a number/i.test(lastMessage()), 'non-numeric reply rejected');
  await send('99');
  assert(/reply with a number/i.test(lastMessage()), 'out-of-range reply rejected');
  state = assessmentSessionState.get(phoneHash);
  assert(state && state.step === 'selectPrintBlueprint', 'state unchanged after invalid replies');

  // STATUS/RESUME should still work mid-PRINT since they're handled
  // generically for any active session.
  assert(/choosing a Blueprint to print/i.test((await (async () => { await send('STATUS'); return lastMessage(); })())), 'STATUS reports the print sub-session');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 3: valid selection generates and sends the paper, then clears session ──');
  paperCalls = [];
  paperResult = { fileId: 'file-abc', filename: 'Blueprint_Paper_Term_3_Fractions_Test.pdf' };

  handled = await send('2');
  assert(handled === true, 'numeric selection handled');
  assert(paperCalls.length === 1 && paperCalls[0] === 2, 'generateBlueprintPaperPdf called once with the chosen blueprint id');
  assert(sentDocuments.length === 1, 'sendDocument called once');
  assert(sentDocuments[0].url === 'https://example.test/pdf/file-abc', 'document URL built via buildPdfUrl(fileId)');
  assert(sentDocuments[0].filename === 'Blueprint_Paper_Term_3_Fractions_Test.pdf', 'filename passed through');
  assert(assessmentSessionState.get(phoneHash) === undefined, 'session cleared after a single-turn print action');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 4: generation failure is reported, not thrown ─────────');
  sentDocuments.length = 0;
  paperCalls = [];
  paperResult = { error: 'Blueprint has no questions to print.' };

  await send('PRINT');
  await send('1');
  assert(sentDocuments.length === 0, 'no document sent on a generation error');
  assert(/couldn't generate the printable paper/i.test(lastMessage()), 'error message surfaced to the teacher');
  assert(/no questions to print/i.test(lastMessage()), 'underlying error detail included');
  assert(assessmentSessionState.get(phoneHash) === undefined, 'session still cleared even on failure');

  console.log('\n── Section 4b: a thrown error is caught, not propagated ──────────');
  sentDocuments.length = 0;
  paperResult = async () => { throw new Error('disk full'); };

  await send('PRINT');
  let threw = false;
  try {
    await send('1');
  } catch (e) {
    threw = true;
  }
  assert(threw === false, 'a thrown generation error does not propagate out of the flow');
  assert(/couldn't generate the printable paper/i.test(lastMessage()), 'generic failure message sent to the teacher');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 5: CANCEL works mid-PRINT ──────────────────────────────');
  paperResult = { fileId: 'x', filename: 'x.pdf' };
  await send('PRINT');
  handled = await send('CANCEL');
  assert(handled === true, 'CANCEL handled during PRINT selection');
  assert(/cancelled/i.test(lastMessage()), 'cancellation confirmed');
  assert(assessmentSessionState.get(phoneHash) === undefined, 'session removed after CANCEL');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 6: PRINT does not collide with an active NEW TEST session ──');
  // Manually seed an ACTIVE capture session, then confirm PRINT is not
  // reachable mid-session (the "no session" branch owns PRINT, exactly
  // like NEW TEST) — it should fall through to the ACTIVE step's own
  // dispatch instead of being silently swallowed or misrouted.
  assessmentSessionState.set(phoneHash, {
    step: 'active',
    blueprintId: 1,
    blueprintTitle: 'Term 3 Fractions Test',
    blueprintTotalMarks: 30,
    classId: 9,
    className: 'Grade 5B',
    learnerCount: 2,
    questions: [{ questionNumber: 1, topic: 'General', maxMarks: 30 }],
    learners: [],
    learnerIndex: 0,
    questionIndex: 0,
    captureStep: 'name',
    history: [],
  });
  await send('PRINT');
  assert(assessmentSessionState.get(phoneHash) !== undefined, 'active capture session is not clobbered by PRINT');
  assessmentSessionState.delete(phoneHash);

  console.log(`\n────────────────────────────────────────────────────────────`);
  console.log(`ADR-005B PRINT Flow Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
