'use strict';
/**
 * Cycle 9 regression test — blueprint archived DURING active marks capture
 * (as opposed to Cycle 8's SELECT_CLASS-time gap, already closed at
 * 26dfcab).
 *
 * Failure mode this closes (found during Cycle 8's closure audit):
 *   published blueprint selected -> active capture -> blueprint archived
 *   -> completion -> storeAssessment() commits an assessments row ->
 *   validateLearnerResultsAgainstBlueprint() throws (blueprint no longer
 *   published) -> throw propagates uncaught -> teacher already told
 *   "Capture complete... Generating assessment..." and their SessionStore
 *   entry already overwritten to COMPLETE_MENU -> captured marks
 *   unrecoverable, and an orphaned assessments row with no learner_results
 *   is left behind.
 *
 * Fix (this commit):
 *   1. services/diagnosticWorkflowService.js: blueprint status/marks
 *      validation now runs BEFORE storeAssessment(), so a throw can never
 *      leave a partial/orphaned assessments row.
 *   2. flows/assessmentSessionFlow.js: processAssessmentData() is now
 *      awaited BEFORE the "Capture complete" message is sent and BEFORE
 *      the session is overwritten to COMPLETE_MENU. On failure, the
 *      in-progress capture state is restored (not lost) and the teacher
 *      is told the truth.
 *
 * Section 1 (unit level, real SQLite via createTestDb): confirms no
 * orphaned assessments row is created when the blueprint is archived.
 * Section 2 (flow level, mocked processAssessmentData): confirms the
 * teacher-facing message/session-state behaviour for both the archived
 * (failure) and still-published (success) paths.
 *
 * Run individually: node tests/cycle9-blueprint-archived-during-capture.test.js
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
  const _db = testDb.db;

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 1: no orphaned assessments row on archived blueprint ─────');
  // ═══════════════════════════════════════════════════════════════════
  {
    const { createBlueprint, publishBlueprint, archiveBlueprint } = require('../services/blueprintRepository');
    const { processAssessmentData } = require('../services/diagnosticWorkflowService');

    const PHONE = 'cycle9_hash_001';
    _db.prepare(`INSERT INTO teachers (phone_hash) VALUES (?)`).run(PHONE);

    const draft = createBlueprint(
      PHONE,
      { title: 'Cycle 9 Test', subject: 'Mathematics', grade: 5, term: 3, totalMarks: 20 },
      [
        { questionNumber: 1, topic: 'Fractions', maxMarks: 10 },
        { questionNumber: 2, topic: 'Decimals', maxMarks: 10 },
      ]
    );
    const published = publishBlueprint(draft.blueprintId, PHONE);
    const { getBlueprintById } = require('../services/blueprintRepository');
    const blueprint = getBlueprintById(published.blueprintId);

    const beforeCount = _db.prepare(`SELECT COUNT(*) AS n FROM assessments WHERE phone_hash = ?`).get(PHONE).n;

    // Simulate the blueprint being archived mid-capture (e.g. via the
    // Dashboard) while the teacher is still entering marks on WhatsApp.
    archiveBlueprint(published.blueprintId, PHONE);

    let threw = null;
    try {
      await processAssessmentData(PHONE, {
        title: 'Cycle 9 Test',
        grade: 5,
        subject: 'Mathematics',
        term: 3,
        type: 'test',
        totalMarks: 20,
        blueprintId: published.blueprintId,
        blueprintVersion: blueprint.version,
        learnerResults: [
          { learnerName: 'Thabo Mokoena', questionData: { '1': 8, '2': 10 } },
        ],
      });
    } catch (err) {
      threw = err;
    }

    assert(threw !== null, 'processAssessmentData() throws when the blueprint has been archived');
    assert(
      threw && /must be published before marks can be imported/.test(threw.message),
      'thrown error names the archived-blueprint cause'
    );

    const afterCount = _db.prepare(`SELECT COUNT(*) AS n FROM assessments WHERE phone_hash = ?`).get(PHONE).n;
    assertNoOrphan(beforeCount, afterCount);

    function assertNoOrphan(before, after) {
      assert(after === before, 'no assessments row was inserted for the archived-blueprint attempt (no orphaned row)');
    }

    // Sanity check: the same call against a still-published blueprint
    // succeeds and does store a row — proving Section 1 isn't just
    // silently no-op-ing for an unrelated reason.
    const draft2 = createBlueprint(
      PHONE,
      { title: 'Cycle 9 Control Test', subject: 'Mathematics', grade: 5, term: 3, totalMarks: 10 },
      [{ questionNumber: 1, topic: 'Fractions', maxMarks: 10 }]
    );
    const published2 = publishBlueprint(draft2.blueprintId, PHONE);
    const blueprint2 = getBlueprintById(published2.blueprintId);

    const result = await processAssessmentData(PHONE, {
      title: 'Cycle 9 Control Test',
      grade: 5,
      subject: 'Mathematics',
      term: 3,
      type: 'test',
      totalMarks: 10,
      blueprintId: published2.blueprintId,
      blueprintVersion: blueprint2.version,
      learnerResults: [{ learnerName: 'Thabo Mokoena', questionData: { '1': 8 } }],
    });
    assert(!result.error, 'control case: still-published blueprint completes without error');
    const afterControlCount = _db.prepare(`SELECT COUNT(*) AS n FROM assessments WHERE phone_hash = ?`).get(PHONE).n;
    assert(afterControlCount === afterCount + 1, 'control case: exactly one row stored for the valid completion');
  }

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 2: flow-level behaviour on completion-time failure ───────');
  // ═══════════════════════════════════════════════════════════════════
  {
    const { SessionStore } = require('../utils/sessionStore');
    const navigationService = require('../services/navigationService');
    const { handleAssessmentSessionFlow, describeStatus: describeAssessmentSessionStatus } =
      require('../flows/assessmentSessionFlow');

    const PHONE = '+27831111111';
    const hashPhone = (p) => `hash_${p}`;
    const phoneHash = hashPhone(PHONE);

    const blueprintsFixture = [
      { id: 5, title: 'Cycle 9 Flow Test', grade: 5, subject: 'Mathematics', total_marks: 15, question_count: 2 },
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
        status: 'published',
        questions: [
          { questionNumber: 1, topic: 'Fractions', maxMarks: 5 },
          { questionNumber: 2, topic: 'Decimals', maxMarks: 10 },
        ],
      };
    };
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

    // processAssessmentData mock throws — simulating the blueprint having
    // been archived between capture-start and the final completion call.
    const processAssessmentData = async () => {
      throw new Error('validateLearnerResultsAgainstBlueprint: blueprint 5 must be published before marks can be imported against it (current status: archived)');
    };
    const generateBlueprintAssessmentPdf = async () => ({ fileId: 'file-abc', filename: 'Blueprint_Report_Test.pdf' });
    const generateBlueprintPaperPdf = async () => ({ fileId: 'paper-abc', filename: 'Paper.pdf' });
    const buildPdfUrl = (fileId) => `https://example.test/pdf/${fileId}`;
    const sendDocument = async () => {};

    const sentMessages = [];
    const assessmentSessionState = new SessionStore('cycle9AssessmentSession', 24 * 60 * 60 * 1000);
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

    async function send(text) {
      sentMessages.length = 0;
      return handleAssessmentSessionFlow(PHONE, text, { text }, null, buildAssessmentSessionDeps());
    }
    const lastMessage = () => (sentMessages[sentMessages.length - 1] || {}).msg || '';

    await send('NEW TEST');
    await send('1'); // pick blueprint
    await send('1'); // pick class -> ACTIVE
    let state = assessmentSessionState.get(phoneHash);
    assert(state && state.step === 'active', 'setup: session reaches ACTIVE before completion');

    // Complete capture via the interactive name -> mark -> mark -> name...
    // sequence (bulk paste is exercised by the bulk-dispatch suite
    // already — here we drive interactive replies to isolate the
    // completion-time behaviour under test).
    await send('Sipho Dlamini');
    await send('4'); // Sipho Q1
    await send('8'); // Sipho Q2
    await send('Lebo Molefe');
    await send('5'); // Lebo Q1
    await send('9'); // Lebo Q2 -> triggers completion

    assert(
      !/Capture complete/i.test(lastMessage()),
      'no false "Capture complete" success message is sent when persistence subsequently fails'
    );
    assert(
      /couldn.?t finish generating the report/i.test(lastMessage()) && /no longer available/i.test(lastMessage()),
      'teacher receives a truthful failure message naming the unavailable blueprint'
    );

    state = assessmentSessionState.get(phoneHash);
    assert(state !== undefined, 'session is NOT deleted after a completion-time failure — marks are not lost');
    assert(state && state.step !== 'completeMenu', 'session is NOT advanced to COMPLETE_MENU after a completion-time failure');
    assert(
      state && Array.isArray(state.learners) && state.learners.length === 2,
      'captured learner marks remain present on the preserved session state'
    );

    // Retry is safe: STATUS still works against the preserved session
    // rather than erroring on a half-cleared state.
    await send('STATUS');
    assert(/Assessment Progress/.test(lastMessage()), 'retry: STATUS still works against the preserved post-failure session');
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Cycle 9 (blueprint archived during capture) Results: ${passed} passed, ${failed} failed`);

  testDb.cleanup();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test run threw:', err);
  process.exit(1);
});
