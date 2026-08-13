'use strict';
/**
 * RC1-D1-002 — Completion message showed "1 questions" instead of
 * "1 question" (and the same ungated plural for "learners").
 *
 * Discovered live during Journey D1 production verification: capturing
 * marks for a 1-question blueprint completed with the message
 * "10 learners\n1 questions" — the learner count was correctly plural
 * (10 learners), but the question count was not pluralization-aware at
 * all: flows/assessmentSessionFlow.js's completion message hardcoded the
 * literal words "learners" and "questions" regardless of count, unlike
 * formatBlueprintList() (fixed under RC1-D1-001), which already does
 * `question${count === 1 ? '' : 's'}`.
 *
 * This test exercises the real handleAssessmentSessionFlow() completion
 * branch end-to-end (blueprint -> class -> single-question capture) so it
 * proves the fix against the actual message construction, not an isolated
 * helper.
 *
 * Run individually: node tests/rc1-d1-002-completion-message-pluralization.test.js
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
  const navigationService = require('../services/navigationService');
  const { handleAssessmentSessionFlow } = require('../flows/assessmentSessionFlow');

  navigationService.registerFlow({
    id: 'assessmentSession',
    commands: ['NEW TEST', 'PRINT', 'RESUME'],
    capabilities: { status: true, cancel: true, back: false, menus: true },
    menus: { complete: ['Start a new assessment', 'Print a blueprint question paper'] },
    hooks: { cleanup: () => {}, describeStatus: () => null },
  });

  const hashPhone = (p) => `hash_${p}`;
  const processAssessmentData = async () => ({ assessmentId: 1, teacherSummary: 'stub summary' });
  const generateBlueprintAssessmentPdf = async () => ({ fileId: 'f', filename: 'r.pdf' });
  const buildPdfUrl = () => 'https://example.test/pdf/f';
  const sendDocument = async () => {};

  // Scenario A: 1 learner, 1 question — both counts must be singular.
  async function runScenario({ phone, blueprint, klass, learnerNames, mark }) {
    const phoneHash = hashPhone(phone);
    const sentMessages = [];
    const assessmentSessionState = new SessionStore(`rc1d1002_${phone}`, 24 * 60 * 60 * 1000);

    const getBlueprintById = (id) => (id === blueprint.id ? {
      id: blueprint.id,
      title: blueprint.title,
      grade: blueprint.grade,
      subject: blueprint.subject,
      term: 1,
      totalMarks: blueprint.total_marks,
      version: 1,
      questions: blueprint.questions,
    } : null);

    const deps = {
      hashPhone,
      safeSendMessage: async (to, msg) => { sentMessages.push(msg); },
      assessmentSessionState,
      listBlueprints: () => [blueprint],
      getTeacherClasses: () => [klass],
      getBlueprintById,
      processAssessmentData,
      parseMarks: () => ({ learners: [], totalMark: 0, questionCount: 0, questionMaxMarks: {}, questionTopics: {}, warnings: [], errors: [] }),
      generateBlueprintAssessmentPdf,
      generateBlueprintPaperPdf: async () => ({ fileId: 'p', filename: 'p.pdf' }),
      buildPdfUrl,
      sendDocument,
    };

    await handleAssessmentSessionFlow(phone, 'NEW TEST', null, null, deps);
    await handleAssessmentSessionFlow(phone, '1', null, null, deps); // blueprint
    await handleAssessmentSessionFlow(phone, '1', null, null, deps); // class

    for (const name of learnerNames) {
      await handleAssessmentSessionFlow(phone, name, null, null, deps); // learner name
      for (let q = 0; q < blueprint.questions.length; q++) {
        await handleAssessmentSessionFlow(phone, String(mark), null, null, deps); // mark(s)
      }
    }

    // The completion message ("Capture complete...") is the one sent
    // immediately when isComplete() fires — before the follow-up teacher
    // summary and PDF messages, which are sent afterward. Find it
    // explicitly rather than assuming it's the last message overall.
    return sentMessages.find((m) => m.includes('Capture complete.')) || '';
  }

  console.log('\n── RC1-D1-002: 1 learner + 1 question — both singular ──');
  const msgSingular = await runScenario({
    phone: '+27831110001',
    blueprint: { id: 1, title: 'Empty Test', grade: 9, subject: 'Mathematics', total_marks: 10, questionCount: 1, questions: [{ questionNumber: 1, topic: 'Algebra', maxMarks: 10 }] },
    klass: { id: 1, name: 'Grade 9A', grade: 9, subject: 'Mathematics', learner_count: 1 },
    learnerNames: ['Thabo'],
    mark: 4,
  });
  assert(msgSingular.includes('1 learner\n'), 'exact regression: "1 learner" (not "1 learners")');
  assert(msgSingular.includes('1 question\n'), 'exact regression: "1 question" (not "1 questions")');
  assert(!msgSingular.includes('1 learners'), 'never renders "1 learners"');
  assert(!msgSingular.includes('1 questions'), 'never renders "1 questions"');

  console.log('\n── RC1-D1-002: multiple learners + multiple questions — both plural ──');
  const msgPlural = await runScenario({
    phone: '+27831110002',
    blueprint: { id: 2, title: 'Two Q Test', grade: 6, subject: 'Mathematics', total_marks: 10, questionCount: 2, questions: [{ questionNumber: 1, topic: 'A', maxMarks: 5 }, { questionNumber: 2, topic: 'B', maxMarks: 5 }] },
    klass: { id: 2, name: 'Grade 6B', grade: 6, subject: 'Mathematics', learner_count: 2 },
    learnerNames: ['Naledi', 'Sipho'],
    mark: 3,
  });
  assert(msgPlural.includes('2 learners\n'), 'plural learners count renders "2 learners"');
  assert(msgPlural.includes('2 questions\n'), 'plural questions count renders "2 questions"');

  console.log('\n' + '─'.repeat(64));
  console.log(`RC1-D1-002 Regression Results: ${passed} passed, ${failed} failed`);
  console.log('─'.repeat(64));

  testDb.cleanup?.();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test run crashed:', err);
  process.exit(1);
});
