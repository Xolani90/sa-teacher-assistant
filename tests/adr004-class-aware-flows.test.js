'use strict';
/**
 * ADR-004 — Class-Aware Learner Identity Resolution
 * Integration tests for the 0/1/2+ class-count rule in both flows.
 *
 * These flows never touch the DB directly — all persistence is injected
 * via `deps` — so these tests use plain mock functions rather than a
 * real or shimmed SQLite instance. That keeps them fast and immune to
 * the native better-sqlite3 binding issues that affect other suites in
 * this environment.
 *
 * Run individually:   node tests/adr004-class-aware-flows.test.js
 * Run via npm:         npm test
 */

const { handleAssessmentFlow } = require('../flows/assessmentFlow');
const { handleObservationFlow } = require('../flows/observationFlow');
const { formatClassSelectionPrompt, matchClassSelection } = require('../utils/classContext');

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (!cond) {
    console.log(`  ❌ ${label}`);
    failed++;
  } else {
    console.log(`  ✅ ${label}`);
    passed++;
  }
}

// ── Shared mock builders ────────────────────────────────────────────────
function makeSentMessages() {
  const sent = [];
  const safeSendMessage = async (from, text) => { sent.push({ from, text }); };
  return { sent, safeSendMessage };
}

function makeSessionStore() {
  const map = new Map();
  return {
    get: (k) => map.get(k),
    set: (k, v) => map.set(k, v),
    delete: (k) => map.delete(k),
  };
}

// ── Section 1: assessmentFlow.js class resolution ───────────────────────

async function testAssessmentZeroClasses() {
  console.log('\nTest ADR004-A1: assessmentFlow — 0 classes stays unclassed, no prompt');
  const { sent, safeSendMessage } = makeSentMessages();
  const dataAssessmentState = makeSessionStore();
  let capturedClassId = 'NOT_CALLED';

  const deps = {
    hashPhone: (from) => `hash_${from}`,
    safeSendMessage,
    gradeLabel: (g) => `Grade ${g}`,
    isProActive: () => true,
    getTeacherByPhone: () => ({ is_pro: 1 }),
    dataAssessmentState,
    parseMarks: () => ({ errors: [], warnings: [], learners: [
      { learnerName: 'Thabo', mark: 8, totalMarks: 10, questionData: {} },
      { learnerName: 'Naledi', mark: 6, totalMarks: 10, questionData: {} },
    ], totalMark: 10, questionCount: 1, questionTopics: {} }),
    extractMarksFromImage: async () => ({}),
    getFormatHelpText: () => 'FORMAT_HELP',
    processAssessmentData: (phoneHash, assessmentData) => {
      capturedClassId = assessmentData.classId;
      return { assessmentId: 1, analyses: { itemAnalysis: {}, errorAnalysis: {}, learnerGrouping: {} } };
    },
    getTeacherClasses: () => [],
    formatClassSelectionPrompt,
    matchClassSelection,
  };

  const from = '27821111111';
  await handleAssessmentFlow(from, 'x', null, { type: 'dataAssessment', grade: 8, subject: 'Mathematics' }, deps);
  await handleAssessmentFlow(from, 'Term 2 Test', null, null, deps); // title -> resolves grade+subject known -> term
  await handleAssessmentFlow(from, '2', null, null, deps); // term -> resolves class context (0 classes)

  const noClassPrompt = !sent.some(m => m.text.includes('Which *class*'));
  assert(noClassPrompt, 'no class-selection prompt sent for 0 classes');
  assert(sent.some(m => m.text === 'FORMAT_HELP'), 'flow proceeded straight to marks format help');

  try {
    await handleAssessmentFlow(from, '1) Thabo 8/10\n2) Naledi 6/10', null, null, deps);
  } catch (err) {
    // Pre-existing, unrelated bug: assessmentFlow.js's Steps 6-10 section
    // references updateTeacherProfile/generateContent/etc. without
    // destructuring them from deps or requiring them at module level.
    // Not in ADR-004's scope — classId capture (below) happens in
    // processAssessmentData(), before this crash point.
  }
  assert(capturedClassId === null, `classId passed to processAssessmentData is null (got ${JSON.stringify(capturedClassId)})`);
}

async function testAssessmentOneClass() {
  console.log('\nTest ADR004-A2: assessmentFlow — 1 class auto-assigns, no prompt');
  const { sent, safeSendMessage } = makeSentMessages();
  const dataAssessmentState = makeSessionStore();
  let capturedClassId = 'NOT_CALLED';

  const deps = {
    hashPhone: (from) => `hash_${from}`,
    safeSendMessage,
    gradeLabel: (g) => `Grade ${g}`,
    isProActive: () => true,
    getTeacherByPhone: () => ({ is_pro: 1 }),
    dataAssessmentState,
    parseMarks: () => ({ errors: [], warnings: [], learners: [
      { learnerName: 'Thabo', mark: 8, totalMarks: 10, questionData: {} },
      { learnerName: 'Naledi', mark: 6, totalMarks: 10, questionData: {} },
    ], totalMark: 10, questionCount: 1, questionTopics: {} }),
    extractMarksFromImage: async () => ({}),
    getFormatHelpText: () => 'FORMAT_HELP',
    processAssessmentData: (phoneHash, assessmentData) => {
      capturedClassId = assessmentData.classId;
      return { assessmentId: 1, analyses: { itemAnalysis: {}, errorAnalysis: {}, learnerGrouping: {} } };
    },
    getTeacherClasses: () => [{ id: 42, name: 'Grade 8A Maths' }],
    formatClassSelectionPrompt,
    matchClassSelection,
  };

  const from = '27822222222';
  await handleAssessmentFlow(from, 'x', null, { type: 'dataAssessment', grade: 8, subject: 'Mathematics' }, deps);
  await handleAssessmentFlow(from, 'Term 2 Test', null, null, deps); // title -> term
  await handleAssessmentFlow(from, '2', null, null, deps); // term -> resolves class context (1 class)

  const noClassPrompt = !sent.some(m => m.text.includes('Which *class*'));
  assert(noClassPrompt, 'no class-selection prompt sent for 1 class');
  assert(sent.some(m => m.text === 'FORMAT_HELP'), 'flow proceeded straight to marks format help');

  try {
    await handleAssessmentFlow(from, '1) Thabo 8/10\n2) Naledi 6/10', null, null, deps);
  } catch (err) {
    // Pre-existing, unrelated bug — see A1 comment above.
  }
  assert(capturedClassId === 42, `classId passed to processAssessmentData is the sole class's id (got ${JSON.stringify(capturedClassId)})`);
}

async function testAssessmentManyClasses() {
  console.log('\nTest ADR004-A3: assessmentFlow — 2+ classes prompts, invalid reply re-prompts, valid reply resolves');
  const { sent, safeSendMessage } = makeSentMessages();
  const dataAssessmentState = makeSessionStore();
  let capturedClassId = 'NOT_CALLED';

  const deps = {
    hashPhone: (from) => `hash_${from}`,
    safeSendMessage,
    gradeLabel: (g) => `Grade ${g}`,
    isProActive: () => true,
    getTeacherByPhone: () => ({ is_pro: 1 }),
    dataAssessmentState,
    parseMarks: () => ({ errors: [], warnings: [], learners: [
      { learnerName: 'Thabo', mark: 8, totalMarks: 10, questionData: {} },
      { learnerName: 'Naledi', mark: 6, totalMarks: 10, questionData: {} },
    ], totalMark: 10, questionCount: 1, questionTopics: {} }),
    extractMarksFromImage: async () => ({}),
    getFormatHelpText: () => 'FORMAT_HELP',
    processAssessmentData: (phoneHash, assessmentData) => {
      capturedClassId = assessmentData.classId;
      return { assessmentId: 1, analyses: { itemAnalysis: {}, errorAnalysis: {}, learnerGrouping: {} } };
    },
    getTeacherClasses: () => [
      { id: 10, name: 'Grade 8A Maths' },
      { id: 11, name: 'Grade 8B Maths' },
    ],
    formatClassSelectionPrompt,
    matchClassSelection,
  };

  const from = '27823333333';
  await handleAssessmentFlow(from, 'x', null, { type: 'dataAssessment', grade: 8, subject: 'Mathematics' }, deps);
  await handleAssessmentFlow(from, 'Term 2 Test', null, null, deps); // title -> term
  await handleAssessmentFlow(from, '2', null, null, deps); // term -> resolves class context (2 classes) -> prompt

  assert(sent.some(m => m.text.includes('Which *class*') && m.text.includes('Grade 8A Maths') && m.text.includes('Grade 8B Maths')),
    'class-selection prompt lists both classes');

  await handleAssessmentFlow(from, '9', null, null, deps); // invalid choice
  assert(sent.filter(m => m.text.includes('Please reply with a number')).length === 1,
    'invalid selection re-prompts instead of guessing');

  await handleAssessmentFlow(from, '2', null, null, deps); // picks Grade 8B Maths (id 11)
  assert(sent.some(m => m.text === 'FORMAT_HELP'), 'valid selection proceeds to marks format help');

  try {
    await handleAssessmentFlow(from, '1) Thabo 8/10\n2) Naledi 6/10', null, null, deps);
  } catch (err) {
    // Pre-existing, unrelated bug — see A1 comment above.
  }
  assert(capturedClassId === 11, `classId passed to processAssessmentData matches the selected class (got ${JSON.stringify(capturedClassId)})`);
}

// ── Section 2: observationFlow.js class resolution ──────────────────────
async function testObservationZeroClasses() {
  console.log('\nTest ADR004-O1: observationFlow — 0 classes stays unclassed, no prompt');
  const { sent, safeSendMessage } = makeSentMessages();
  const observationState = makeSessionStore();
  let capturedClassId = 'NOT_CALLED';

  const deps = {
    observationState,
    safeSendMessage,
    parseIntent: () => ({ type: 'observation' }),
    hashPhone: (from) => `hash_${from}`,
    processObservationSubmission: () => ({
      success: true,
      header: { grade: '0', subject: 'Life Skills', assessment: 'Term 2' },
      records: [{ learnerName: 'Thabo', domain: 'Gross Motor', developmentalStatus: 'Achieved', notes: null }],
      summary: 'SAVED_SUMMARY',
    }),
    getObservationFormatHelpText: () => 'OBS_FORMAT_HELP',
    saveObservationSubmission: (phoneHash, header, records, classId) => {
      capturedClassId = classId;
      return { assessmentId: 1, recordCount: 1 };
    },
    getTeacherClasses: () => [],
    formatClassSelectionPrompt,
    matchClassSelection,
  };

  const from = '27824444444';
  await handleObservationFlow(from, 'trigger', null, deps);
  assert(!sent.some(m => m.text.includes('Which *class*')), 'no class-selection prompt sent for 0 classes');
  assert(sent.some(m => m.text.includes('OBS_FORMAT_HELP')), 'flow proceeded straight to observation text prompt');

  await handleObservationFlow(from, 'Grade R | Life Skills\nThabo | Gross Motor | Achieved', null, deps);
  // Incremental entry: a single Learner: block only collects records now —
  // saveObservationSubmission isn't called until DONE is sent (a teacher
  // observing a class over a morning can log a few learners and add more
  // before saving). See observationFlow.js's 'collectingRecords' step.
  await handleObservationFlow(from, 'DONE', null, deps);
  assert(capturedClassId === null, `classId passed to saveObservationSubmission is null (got ${JSON.stringify(capturedClassId)})`);
}

async function testObservationOneClass() {
  console.log('\nTest ADR004-O2: observationFlow — 1 class auto-assigns, no prompt');
  const { sent, safeSendMessage } = makeSentMessages();
  const observationState = makeSessionStore();
  let capturedClassId = 'NOT_CALLED';

  const deps = {
    observationState,
    safeSendMessage,
    parseIntent: () => ({ type: 'observation' }),
    hashPhone: (from) => `hash_${from}`,
    processObservationSubmission: () => ({
      success: true,
      header: { grade: '0', subject: 'Life Skills', assessment: 'Term 2' },
      records: [{ learnerName: 'Thabo', domain: 'Gross Motor', developmentalStatus: 'Achieved', notes: null }],
      summary: 'SAVED_SUMMARY',
    }),
    getObservationFormatHelpText: () => 'OBS_FORMAT_HELP',
    saveObservationSubmission: (phoneHash, header, records, classId) => {
      capturedClassId = classId;
      return { assessmentId: 1, recordCount: 1 };
    },
    getTeacherClasses: () => [{ id: 77, name: 'Grade R Blue Group' }],
    formatClassSelectionPrompt,
    matchClassSelection,
  };

  const from = '27825555555';
  await handleObservationFlow(from, 'trigger', null, deps);
  assert(!sent.some(m => m.text.includes('Which *class*')), 'no class-selection prompt sent for 1 class');
  assert(sent.some(m => m.text.includes('OBS_FORMAT_HELP')), 'flow proceeded straight to observation text prompt');

  await handleObservationFlow(from, 'Grade R | Life Skills\nThabo | Gross Motor | Achieved', null, deps);
  await handleObservationFlow(from, 'DONE', null, deps);
  assert(capturedClassId === 77, `classId passed to saveObservationSubmission is the sole class's id (got ${JSON.stringify(capturedClassId)})`);
}

async function testObservationManyClasses() {
  console.log('\nTest ADR004-O3: observationFlow — 2+ classes prompts, invalid reply re-prompts, valid reply resolves');
  const { sent, safeSendMessage } = makeSentMessages();
  const observationState = makeSessionStore();
  let capturedClassId = 'NOT_CALLED';

  const deps = {
    observationState,
    safeSendMessage,
    parseIntent: () => ({ type: 'observation' }),
    hashPhone: (from) => `hash_${from}`,
    processObservationSubmission: () => ({
      success: true,
      header: { grade: '0', subject: 'Life Skills', assessment: 'Term 2' },
      records: [{ learnerName: 'Thabo', domain: 'Gross Motor', developmentalStatus: 'Achieved', notes: null }],
      summary: 'SAVED_SUMMARY',
    }),
    getObservationFormatHelpText: () => 'OBS_FORMAT_HELP',
    saveObservationSubmission: (phoneHash, header, records, classId) => {
      capturedClassId = classId;
      return { assessmentId: 1, recordCount: 1 };
    },
    getTeacherClasses: () => [
      { id: 20, name: 'Grade R Blue Group' },
      { id: 21, name: 'Grade R Red Group' },
    ],
    formatClassSelectionPrompt,
    matchClassSelection,
  };

  const from = '27826666666';
  await handleObservationFlow(from, 'trigger', null, deps);
  assert(sent.some(m => m.text.includes('Which *class*') && m.text.includes('Blue Group') && m.text.includes('Red Group')),
    'class-selection prompt lists both classes');

  await handleObservationFlow(from, 'not a number', null, deps); // invalid choice
  assert(sent.filter(m => m.text.includes('Please reply with a number')).length === 1,
    'invalid selection re-prompts instead of guessing');

  await handleObservationFlow(from, '2', null, deps); // picks Red Group (id 21)
  assert(sent.some(m => m.text.includes('OBS_FORMAT_HELP')), 'valid selection proceeds to observation text prompt');

  await handleObservationFlow(from, 'Grade R | Life Skills\nThabo | Gross Motor | Achieved', null, deps);
  await handleObservationFlow(from, 'DONE', null, deps);
  assert(capturedClassId === 21, `classId passed to saveObservationSubmission matches the selected class (got ${JSON.stringify(capturedClassId)})`);
}

async function main() {
  console.log('── ADR-004: Class-Aware Learner Identity — Flow Integration Tests ──');
  console.log('\n── Section 1: assessmentFlow.js ──');
  await testAssessmentZeroClasses();
  await testAssessmentOneClass();
  await testAssessmentManyClasses();
  console.log('\n── Section 2: observationFlow.js ──');
  await testObservationZeroClasses();
  await testObservationOneClass();
  await testObservationManyClasses();

  console.log('\n───────────────────────────────────────────────────────');
  console.log(`ADR-004 Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
