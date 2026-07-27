'use strict';
/**
 * CLASS INTERVENTION PDF command tests (ADR-009, PR14).
 *
 * flows/workspaceFlow.js's "CLASS INTERVENTION PDF [selector]" branch reuses
 * the exact same class-resolution path already covered by
 * tests/workspaceFlow-classIntervention.test.js (0/1/2+ classes, numeric
 * and name selectors, unmatched selectors) — this file does not re-test
 * that resolution logic. It covers only what's new in PR14: detecting the
 * leading "PDF" token, routing to generateClassInterventionPdf() +
 * buildPdfUrl() + sendDocument() instead of the text summary, and error
 * handling for that PDF path specifically.
 *
 * Run individually:   node tests/workspaceFlow-classInterventionPdf.test.js
 * Run via npm:         npm test
 */

const { handleWorkspaceFlow } = require('../flows/workspaceFlow');

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

const PHONE = '+27831234567';

function makeBaseDeps(overrides = {}) {
  let sent = [];
  let docsSent = [];
  const deps = {
    hashPhone: (p) => `hash_${p}`,
    getTeacherByPhone: () => ({ grade: 7, subject: 'Mathematics' }),
    safeSendMessage: async (from, text) => { sent.push({ from, text }); },
    gradeLabel: (g) => `Grade ${g}`,
    getTeacherClasses: () => ([]),
    createClass: () => ({}),
    getAssessmentHistory: () => ([]),
    validateNewClassInput: () => ({ valid: true }),
    getTeacherProgressReport: () => ({ dataAvailable: false }),
    calendarQuery: async () => '',
    searchLearnersByName: () => ([]),
    getLearnerInterventionPlan: () => ([]),
    getClassInterventionPlan: () => { throw new Error('getClassInterventionPlan should not be called on the PDF path'); },
    generateClassInterventionPdf: () => { throw new Error('generateClassInterventionPdf should not be called in this test'); },
    buildPdfUrl: (fileId) => `https://example.test/pdfs/${fileId}`,
    sendDocument: async (from, url, filename, caption) => { docsSent.push({ from, url, filename, caption }); },
    ...overrides,
  };
  return { deps, getSent: () => sent, getDocsSent: () => docsSent };
}

async function run() {
  console.log('CLASS INTERVENTION PDF command tests');
  console.log('='.repeat(75));

  // ── Section 1: one class — PDF generated and sent ──
  console.log('\n── Section 1: one class, happy path ──');
  {
    let capturedArgs = null;
    const { deps, getSent, getDocsSent } = makeBaseDeps({
      getTeacherClasses: () => ([{ id: 42, name: 'Grade 8B Mathematics' }]),
      generateClassInterventionPdf: async (hash, classId) => {
        capturedArgs = { hash, classId };
        return { fileId: 'file-abc', filename: 'Class_Intervention_Report_Grade_8B.pdf' };
      },
    });

    const handled = await handleWorkspaceFlow(PHONE, 'CLASS INTERVENTION PDF', deps);
    assert(handled === true, '"CLASS INTERVENTION PDF" is handled');
    assert(!!capturedArgs, 'generateClassInterventionPdf was called');
    assert(capturedArgs && capturedArgs.classId === 42, 'auto-resolved sole class id is passed through');
    assert(capturedArgs && capturedArgs.hash === `hash_${PHONE}`, 'hashed phone is passed through');

    const docs = getDocsSent();
    assert(docs.length === 1, 'exactly one document sent');
    assert(docs[0] && docs[0].url === 'https://example.test/pdfs/file-abc', 'document URL built via buildPdfUrl(fileId)');
    assert(docs[0] && docs[0].filename === 'Class_Intervention_Report_Grade_8B.pdf', 'filename passed through unchanged');
    assert(docs[0] && /Grade 8B Mathematics/.test(docs[0].caption), 'caption names the class');

    const sent = getSent();
    assert(sent.length === 0, 'no plain-text summary message sent on the PDF path');
  }

  // ── Section 2: zero classes — same guidance as the text command ──
  console.log('\n── Section 2: zero classes ──');
  {
    const { deps, getSent, getDocsSent } = makeBaseDeps({ getTeacherClasses: () => ([]) });
    const handled = await handleWorkspaceFlow(PHONE, 'CLASS INTERVENTION PDF', deps);
    assert(handled === true, '"CLASS INTERVENTION PDF" with zero classes is handled');
    assert(getDocsSent().length === 0, 'no document generated with zero classes');
    const sent = getSent();
    assert(sent.length > 0 && /No classes yet/.test(sent[0].text), 'zero-class guidance shown, same as the text command');
  }

  // ── Section 3: 2+ classes, no selector — re-prompt uses the PDF form ──
  console.log('\n── Section 3: 2+ classes, no selector ──');
  {
    const { deps, getSent, getDocsSent } = makeBaseDeps({
      getTeacherClasses: () => ([{ id: 1, name: 'Grade 7A' }, { id: 2, name: 'Grade 8B' }]),
    });
    const handled = await handleWorkspaceFlow(PHONE, 'CLASS INTERVENTION PDF', deps);
    assert(handled === true, '"CLASS INTERVENTION PDF" with 2+ classes and no selector is handled');
    assert(getDocsSent().length === 0, 'no document generated while the class is still ambiguous');
    const sent = getSent();
    assert(sent.length > 0 && /Which class/.test(sent[0].text), 'prompts the teacher to choose a class');
    assert(sent.length > 0 && /CLASS INTERVENTION PDF \[number\]/.test(sent[0].text), 're-prompt uses the PDF form of the command, not the plain one');
  }

  // ── Section 4: 2+ classes, numeric selector ──
  console.log('\n── Section 4: 2+ classes, numeric selector ──');
  {
    let capturedClassId = null;
    const { deps, getDocsSent } = makeBaseDeps({
      getTeacherClasses: () => ([{ id: 1, name: 'Grade 7A' }, { id: 2, name: 'Grade 8B' }]),
      generateClassInterventionPdf: async (hash, classId) => {
        capturedClassId = classId;
        return { fileId: 'file-2', filename: 'report-2.pdf' };
      },
    });
    const handled = await handleWorkspaceFlow(PHONE, 'CLASS INTERVENTION PDF 2', deps);
    assert(handled === true, '"CLASS INTERVENTION PDF 2" is handled');
    assert(capturedClassId === 2, 'numeric selector resolves to the correct class by position');
    assert(getDocsSent().length === 1, 'document sent for the numerically selected class');
  }

  // ── Section 5: 2+ classes, name selector ──
  console.log('\n── Section 5: 2+ classes, name selector ──');
  {
    let capturedClassId = null;
    const { deps, getDocsSent } = makeBaseDeps({
      getTeacherClasses: () => ([{ id: 1, name: 'Grade 7A' }, { id: 2, name: 'Grade 8B' }]),
      generateClassInterventionPdf: async (hash, classId) => {
        capturedClassId = classId;
        return { fileId: 'file-8b', filename: 'report-8b.pdf' };
      },
    });
    const handled = await handleWorkspaceFlow(PHONE, 'CLASS INTERVENTION PDF 8B', deps);
    assert(handled === true, '"CLASS INTERVENTION PDF 8B" is handled');
    assert(capturedClassId === 2, 'substring name selector resolves to the correct class');
    assert(getDocsSent().length === 1, 'document sent for the name-selected class');
  }

  // ── Section 6: 2+ classes, unmatched selector ──
  console.log('\n── Section 6: 2+ classes, unmatched selector ──');
  {
    const { deps, getSent, getDocsSent } = makeBaseDeps({
      getTeacherClasses: () => ([{ id: 1, name: 'Grade 7A' }, { id: 2, name: 'Grade 8B' }]),
    });
    const handled = await handleWorkspaceFlow(PHONE, 'CLASS INTERVENTION PDF 9C', deps);
    assert(handled === true, 'unmatched selector on the PDF path is still handled, not a crash');
    assert(getDocsSent().length === 0, 'no document generated for an unmatched selector');
    const sent = getSent();
    assert(sent.length > 0 && /couldn't match/i.test(sent[0].text), 'tells the teacher the selector did not match');
    assert(sent.length > 0 && /CLASS INTERVENTION PDF \[number\]/.test(sent[0].text), 're-lists candidates using the PDF form');
  }

  // ── Section 7: generateClassInterventionPdf returns a structured error ──
  console.log('\n── Section 7: structured error from the PDF generator ──');
  {
    const { deps, getSent, getDocsSent } = makeBaseDeps({
      getTeacherClasses: () => ([{ id: 5, name: 'Empty Class' }]),
      generateClassInterventionPdf: async () => ({ error: 'This class has no learners yet.' }),
    });
    const handled = await handleWorkspaceFlow(PHONE, 'CLASS INTERVENTION PDF', deps);
    assert(handled === true, 'a structured PDF-generator error is still handled');
    assert(getDocsSent().length === 0, 'no document sent when the generator reports an error');
    const sent = getSent();
    assert(sent.length > 0 && /no learners yet/.test(sent[0].text), 'the generator error message is surfaced to the teacher');
  }

  // ── Section 8: generateClassInterventionPdf throws ──
  console.log('\n── Section 8: thrown error from the PDF generator ──');
  {
    const { deps, getSent, getDocsSent } = makeBaseDeps({
      getTeacherClasses: () => ([{ id: 6, name: 'Grade 9C' }]),
      generateClassInterventionPdf: async () => { throw new Error('disk full'); },
    });
    const handled = await handleWorkspaceFlow(PHONE, 'CLASS INTERVENTION PDF', deps);
    assert(handled === true, 'a thrown generator error does not propagate out of the flow');
    assert(getDocsSent().length === 0, 'no document sent when generation throws');
    const sent = getSent();
    assert(sent.length > 0 && /couldn't generate/i.test(sent[0].text), 'a friendly failure message is sent, not the raw error');
  }

  // ── Section 9: plain "CLASS INTERVENTION" (no PDF) is unaffected ──
  console.log('\n── Section 9: no regression to the plain text command ──');
  {
    const { deps, getSent, getDocsSent } = makeBaseDeps({
      getTeacherClasses: () => ([{ id: 7, name: 'Grade 6A' }]),
      getClassInterventionPlan: () => ({
        classId: 7,
        summary: { totalLearners: 2, evaluatedLearners: 2, insufficientData: 0, erroredLearners: 0 },
        priorityCounts: { high: 0, medium: 2, low: 0 },
        commonFocusTopics: [],
        priorityLearners: { high: [], medium: [], low: [] },
        errors: [],
      }),
    });
    const handled = await handleWorkspaceFlow(PHONE, 'CLASS INTERVENTION', deps);
    assert(handled === true, 'plain "CLASS INTERVENTION" (no PDF token) is still handled');
    assert(getDocsSent().length === 0, 'no document sent for the plain text command');
    assert(getSent().length === 1, 'exactly one text summary sent, same as before PR14');
  }

  console.log(`\n${'─'.repeat(76)}`);
  console.log(`CLASS INTERVENTION PDF Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
