'use strict';
/**
 * Assessment Session Flow — bulk-paste dispatch tests (ADR-006 PR4 Phase 3).
 *
 * Covers the ACTIVE-step dispatch branch added in Phase 3:
 *   1. A single-line reply (a name, or one mark) still routes through
 *      submitReply() exactly as before — no regression.
 *   2. A multi-line reply routes through submitBulkReply() instead.
 *   3. A clean bulk paste (nothing skipped) proceeds silently to the next
 *      prompt / completion message — no extra noise.
 *   4. A bulk paste with skipped/overflow learners surfaces a skip notice
 *      before the next prompt.
 *   5. A bulk paste that completes the session surfaces the skip notice
 *      before the completion message, and still reaches
 *      processAssessmentData() via toLearnerResults() same as the
 *      interactive path.
 *   6. A rejected bulk paste (parser fatal error) reports the error and
 *      does not advance state.
 *   7. (ADR-005A) On completion, the blueprint analytics PDF is generated
 *      and delivered via sendDocument(); a PDF failure is reported as a
 *      follow-up message but never loses the already-committed marks or
 *      throws out of the flow.
 *
 * utils/marksParser.js's parseMarks() is faked via dependency injection
 * (the same pattern as tests/assessment-bulk-capture.test.js) so this file
 * only exercises the flow's dispatch/notice-formatting logic, not the real
 * text-format grammar.
 *
 * Run individually: node tests/assessment-session-bulk-dispatch.test.js
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

// Builds a fake parseMarks() implementation (marksParser.js's return shape),
// same convention as tests/assessment-bulk-capture.test.js.
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

  let lastDiagnosticCall = null;
  const processAssessmentData = async (phHash, payload) => {
    lastDiagnosticCall = { phoneHash: phHash, payload };
    return { assessmentId: 999, teacherSummary: 'stub summary' };
  };

  // ADR-005A: PDF generation/delivery mocks for the completion path.
  let pdfCalls = [];
  let sendDocumentCalls = [];
  let generateBlueprintAssessmentPdfImpl = async (assessmentId) => {
    pdfCalls.push(assessmentId);
    return { fileId: 'file-abc', filename: 'Blueprint_Report_Test.pdf' };
  };
  const buildPdfUrl = (fileId) => `https://example.test/pdf/${fileId}`;
  const sendDocument = async (to, url, filename, caption) => {
    sendDocumentCalls.push({ to, url, filename, caption });
  };

  let parseMarksImpl = fakeParseMarks(); // overridden per section
  const sentMessages = [];

  function makeState() {
    const assessmentSessionState = new SessionStore('assessmentSessionBulkDispatch', 24 * 60 * 60 * 1000);
    return assessmentSessionState;
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
      generateBlueprintAssessmentPdf: (...args) => generateBlueprintAssessmentPdfImpl(...args),
      buildPdfUrl,
      sendDocument,
    };
  }

  function lastMessage() {
    return sentMessages[sentMessages.length - 1]?.msg || '';
  }

  // On bulk-completion turns, safeSendMessage is called twice: once with
  // the "Capture complete... Generating assessment..." (+ any bulk notice)
  // message, then once with the diagnostic's teacherSummary. This grabs
  // the first (pre-summary) message so notice/completion assertions check
  // the right one regardless of how many sends happened this turn.
  function firstMessage() {
    return sentMessages[0]?.msg || '';
  }

  async function send(text) {
    sentMessages.length = 0;
    return handleAssessmentSessionFlow(PHONE, text, null, null, buildDeps());
  }

  async function enterActiveSession() {
    assessmentSessionState = makeState();
    pdfCalls = [];
    sendDocumentCalls = [];
    await send('NEW TEST');
    await send('1'); // blueprint
    await send('1'); // class -> ACTIVE, learnerCount 2
  }

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 1: single-line replies still use submitReply() (no regression) ─');
  await enterActiveSession();
  let state = assessmentSessionState.get(phoneHash);
  assert(state.step === 'active', 'session is active with 2 learners');

  await send('Sipho Dlamini'); // single-line name reply
  state = assessmentSessionState.get(phoneHash);
  assert(state.learners[0] && state.learners[0].name === 'Sipho Dlamini', 'name captured via interactive submitReply path');
  assert(state.captureStep === 'marks', 'advanced to marks capture for learner 1');
  assert(!/skipped|Applied marks for/i.test(lastMessage()), 'no bulk notice leaks into the interactive prompt');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 2: multi-line reply routes to submitBulkReply(), clean paste is silent ─');
  await enterActiveSession();
  parseMarksImpl = fakeParseMarks({
    learners: [learnerRecord('Sipho Dlamini', 4, 8), learnerRecord('Lebo Molefe', 5, 9)],
  });

  const handled = await send('Sipho Dlamini 4 8\nLebo Molefe 5 9');
  assert(handled === true, 'multi-line paste is handled by the ACTIVE dispatch');
  assert(!/skipped|Applied marks for/i.test(lastMessage()), 'clean bulk paste (nothing skipped) produces no extra notice');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 3: bulk paste that completes the session ─────────────────');
  await enterActiveSession();
  parseMarksImpl = fakeParseMarks({
    learners: [learnerRecord('Sipho Dlamini', 4, 8), learnerRecord('Lebo Molefe', 5, 9)],
  });

  await send('Sipho Dlamini 4 8\nLebo Molefe 5 9');
  assert(assessmentSessionState.get(phoneHash) === undefined, 'session cleared after bulk paste completes capture');
  assert(/Capture complete/i.test(firstMessage()), 'completion message sent after bulk paste finishes the session');
  assert(lastDiagnosticCall !== null, 'processAssessmentData() was called on bulk completion');
  assert(
    lastDiagnosticCall.payload.learnerResults.length === 2 &&
    lastDiagnosticCall.payload.learnerResults[0].learnerName === 'Sipho Dlamini',
    'learnerResults built via toLearnerResults() reach processAssessmentData() same as the interactive path'
  );
  assert(pdfCalls.length === 1 && pdfCalls[0] === 999, 'ADR-005A: generateBlueprintAssessmentPdf() called once with the completed assessmentId');
  assert(sendDocumentCalls.length === 1 && sendDocumentCalls[0].filename === 'Blueprint_Report_Test.pdf', 'ADR-005A: the analytics PDF is sent to the teacher via sendDocument()');
  assert(/pdf\/file-abc/.test(sendDocumentCalls[0].url), 'ADR-005A: sendDocument() receives a URL built via buildPdfUrl(fileId)');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 3b: PDF generation failure does not lose the marks or crash the flow ─');
  await enterActiveSession();
  parseMarksImpl = fakeParseMarks({
    learners: [learnerRecord('Sipho Dlamini', 4, 8), learnerRecord('Lebo Molefe', 5, 9)],
  });
  generateBlueprintAssessmentPdfImpl = async () => { throw new Error('disk full'); };

  const handledDespitePdfFailure = await send('Sipho Dlamini 4 8\nLebo Molefe 5 9');
  assert(handledDespitePdfFailure === true, 'ADR-005A: a PDF generation failure does not throw out of the flow');
  assert(assessmentSessionState.get(phoneHash) === undefined, 'ADR-005A: marks capture still completed and session still cleared despite the PDF failure');
  assert(lastDiagnosticCall !== null && lastDiagnosticCall.payload.learnerResults.length === 2, 'ADR-005A: marks were still committed via processAssessmentData() despite the PDF failure');
  assert(/couldn.t generate the analytics PDF/i.test(lastMessage()), 'ADR-005A: teacher is told the PDF failed, as a follow-up, not silently dropped');
  generateBlueprintAssessmentPdfImpl = async (assessmentId) => {
    pdfCalls.push(assessmentId);
    return { fileId: 'file-abc', filename: 'Blueprint_Report_Test.pdf' };
  };

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 4: bulk paste with a skipped/overflow learner surfaces a notice ─');
  await enterActiveSession();
  parseMarksImpl = fakeParseMarks({
    learners: [
      learnerRecord('Sipho Dlamini', 4, 8),
      learnerRecord('Lebo Molefe', 5, 9),
      learnerRecord('Extra Learner', 3, 3), // overflow — class only has 2 slots
    ],
  });

  await send('Sipho Dlamini 4 8\nLebo Molefe 5 9\nExtra Learner 3 3');
  assert(/skipped/i.test(firstMessage()), 'overflow learner triggers a visible skip notice');
  assert(/Extra Learner/.test(firstMessage()), 'skip notice names the skipped learner');
  assert(/Applied marks for 2 learner/i.test(firstMessage()), 'skip notice states how many were actually applied');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 5: bulk paste rejected outright (parser fatal error) ─────');
  await enterActiveSession();
  parseMarksImpl = fakeParseMarks({ errors: ['No learner data could be found in that paste.'] });

  const before = assessmentSessionState.get(phoneHash);
  await send('garbage\npaste\nhere');
  assert(/No learner data could be found/i.test(lastMessage()), 'parser fatal error is surfaced to the teacher');
  const after = assessmentSessionState.get(phoneHash);
  assert(after.learnerIndex === before.learnerIndex, 'state does not advance on a rejected bulk paste');

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Assessment Session Bulk Dispatch Results: ${passed} passed, ${failed} failed`);
  // sessionStore.js registers an un-ref'd-free setInterval housekeeping
  // sweep on require, which otherwise keeps the process alive indefinitely
  // when this file is run standalone.
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test run threw:', err);
  process.exit(1);
});
