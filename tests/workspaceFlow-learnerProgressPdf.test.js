'use strict';
/**
 * LEARNER PROGRESS PDF command tests (ADR-009, PR15).
 *
 * flows/workspaceFlow.js's "LEARNER PROGRESS PDF <name>" branch reuses the
 * exact same learner-resolution path already covered by the plain
 * LEARNER PROGRESS tests (searchLearnersByName's 0/1/2+ match handling) —
 * this file does not re-test that resolution logic. It covers only what's
 * new in PR15: detecting the leading "PDF" token, routing to
 * generateLearnerInterventionPdf() + buildPdfUrl() + sendDocument() instead
 * of the text mastery overview, and error handling for that PDF path
 * specifically.
 *
 * Run individually:   node tests/workspaceFlow-learnerProgressPdf.test.js
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
    getLearnerInterventionPlan: () => { throw new Error('getLearnerInterventionPlan should not be called on the PDF path'); },
    getClassInterventionPlan: () => ([]),
    generateClassInterventionPdf: () => { throw new Error('generateClassInterventionPdf should not be called in this test'); },
    generateLearnerInterventionPdf: () => { throw new Error('generateLearnerInterventionPdf should not be called in this test'); },
    buildPdfUrl: (fileId) => `https://example.test/pdfs/${fileId}`,
    sendDocument: async (from, url, filename, caption) => { docsSent.push({ from, url, filename, caption }); },
    ...overrides,
  };
  return { deps, getSent: () => sent, getDocsSent: () => docsSent };
}

async function run() {
  console.log('LEARNER PROGRESS PDF command tests');
  console.log('='.repeat(75));

  // ── Section 1: single match — PDF generated and sent ──
  console.log('\n── Section 1: single match, happy path ──');
  {
    let capturedLearnerId = null;
    const { deps, getSent, getDocsSent } = makeBaseDeps({
      searchLearnersByName: (name, opts) => {
        assert(name === 'Sipho', 'name passed through to searchLearnersByName unchanged');
        assert(opts && opts.phoneHash === `hash_${PHONE}`, 'phoneHash scoping unchanged');
        assert(opts && opts.limit === 6, 'limit unchanged (still 6, matches text path)');
        return [{ id: 99, canonicalName: 'Sipho Dlamini' }];
      },
      generateLearnerInterventionPdf: async (learnerId) => {
        capturedLearnerId = learnerId;
        return { fileId: 'file-xyz', filename: 'Mastery_Report_Sipho_Dlamini.pdf' };
      },
    });

    const handled = await handleWorkspaceFlow(PHONE, 'LEARNER PROGRESS PDF Sipho', deps);
    assert(handled === true, '"LEARNER PROGRESS PDF Sipho" is handled');
    assert(capturedLearnerId === 99, 'resolved learner id is passed to generateLearnerInterventionPdf');

    const docs = getDocsSent();
    assert(docs.length === 1, 'exactly one document sent');
    assert(docs[0] && docs[0].url === 'https://example.test/pdfs/file-xyz', 'document URL built via buildPdfUrl(fileId)');
    assert(docs[0] && docs[0].filename === 'Mastery_Report_Sipho_Dlamini.pdf', 'filename passed through unchanged');
    assert(docs[0] && /Sipho Dlamini/.test(docs[0].caption), 'caption names the learner');

    const sent = getSent();
    assert(sent.length === 0, 'no plain-text mastery overview sent on the PDF path');
  }

  // ── Section 2: no name given — PDF-specific format guidance ──
  console.log('\n── Section 2: no name given ──');
  {
    const { deps, getSent, getDocsSent } = makeBaseDeps();
    const handled = await handleWorkspaceFlow(PHONE, 'LEARNER PROGRESS PDF', deps);
    assert(handled === true, '"LEARNER PROGRESS PDF" with no name is handled');
    assert(getDocsSent().length === 0, 'no document generated with no name given');
    const sent = getSent();
    assert(sent.length > 0 && /LEARNER PROGRESS PDF \[name\]/.test(sent[0].text), 'format guidance uses the PDF form of the command');
  }

  // ── Section 3: zero matches — same guidance as the text command ──
  console.log('\n── Section 3: zero matches ──');
  {
    const { deps, getSent, getDocsSent } = makeBaseDeps({
      searchLearnersByName: () => ([]),
    });
    const handled = await handleWorkspaceFlow(PHONE, 'LEARNER PROGRESS PDF Zanele', deps);
    assert(handled === true, 'zero-match case is handled');
    assert(getDocsSent().length === 0, 'no document generated when no learner matches');
    const sent = getSent();
    assert(sent.length > 0 && /No learner matching "Zanele"/.test(sent[0].text), 'zero-match guidance shown, same as the text command');
  }

  // ── Section 4: 2+ matches — same disambiguation as the text command ──
  console.log('\n── Section 4: multiple matches ──');
  {
    const { deps, getSent, getDocsSent } = makeBaseDeps({
      searchLearnersByName: () => ([
        { id: 1, canonicalName: 'Thabo Nkosi' },
        { id: 2, canonicalName: 'Thabo Mokoena' },
      ]),
    });
    const handled = await handleWorkspaceFlow(PHONE, 'LEARNER PROGRESS PDF Thabo', deps);
    assert(handled === true, 'multiple-match case is handled');
    assert(getDocsSent().length === 0, 'no document generated while the learner is still ambiguous');
    const sent = getSent();
    assert(sent.length > 0 && /Multiple learners match "Thabo"/.test(sent[0].text), 'disambiguation prompt shown, same as the text command');
    assert(sent.length > 0 && /Thabo Nkosi/.test(sent[0].text) && /Thabo Mokoena/.test(sent[0].text), 'both candidate names listed');
  }

  // ── Section 5: generateLearnerInterventionPdf returns a structured error ──
  console.log('\n── Section 5: structured error from the PDF generator ──');
  {
    const { deps, getSent, getDocsSent } = makeBaseDeps({
      searchLearnersByName: () => ([{ id: 5, canonicalName: 'Lindiwe Khumalo' }]),
      generateLearnerInterventionPdf: async () => ({ error: 'No assessment or observation data recorded for this learner yet.' }),
    });
    const handled = await handleWorkspaceFlow(PHONE, 'LEARNER PROGRESS PDF Lindiwe', deps);
    assert(handled === true, 'a structured PDF-generator error is still handled');
    assert(getDocsSent().length === 0, 'no document sent when the generator reports an error');
    const sent = getSent();
    assert(sent.length > 0 && /No assessment or observation data recorded/.test(sent[0].text), 'the generator error message is surfaced to the teacher');
    assert(sent.length > 0 && /Lindiwe Khumalo/.test(sent[0].text), 'the learner is named in the error message');
  }

  // ── Section 6: generateLearnerInterventionPdf throws ──
  console.log('\n── Section 6: thrown error from the PDF generator ──');
  {
    const { deps, getSent, getDocsSent } = makeBaseDeps({
      searchLearnersByName: () => ([{ id: 6, canonicalName: 'Nomvula Zulu' }]),
      generateLearnerInterventionPdf: async () => { throw new Error('disk full'); },
    });
    const handled = await handleWorkspaceFlow(PHONE, 'LEARNER PROGRESS PDF Nomvula', deps);
    assert(handled === true, 'a thrown generator error does not propagate out of the flow');
    assert(getDocsSent().length === 0, 'no document sent when generation throws');
    const sent = getSent();
    assert(sent.length > 0 && /couldn't generate/i.test(sent[0].text), 'a friendly failure message is sent, not the raw error');
  }

  // ── Section 7: plain "LEARNER PROGRESS" (no PDF) is unaffected ──
  console.log('\n── Section 7: no regression to the plain text command ──');
  {
    const { deps, getSent, getDocsSent } = makeBaseDeps({
      searchLearnersByName: () => ([{ id: 7, canonicalName: 'Kagiso Mahlangu' }]),
      getLearnerInterventionPlan: () => ([
        {
          subject: 'Mathematics',
          evidence: { mastery: { masteryLevel: 'developing', subject: 'Mathematics' } },
          recommendedActions: [],
          focusTopics: [],
        },
      ]),
    });
    const handled = await handleWorkspaceFlow(PHONE, 'LEARNER PROGRESS Kagiso', deps);
    assert(handled === true, '"LEARNER PROGRESS Kagiso" (no PDF) is handled');
    assert(getDocsSent().length === 0, 'no document generated for the plain text command');
    const sent = getSent();
    assert(sent.length > 0 && /Kagiso Mahlangu/.test(sent[0].text), 'text mastery overview still sent as before');
  }

  console.log('\n' + '='.repeat(75));
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
