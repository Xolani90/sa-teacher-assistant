'use strict';
// RC1 recon harness — PRINT (blueprint question paper): real-dispatch
// coverage audit.
//
// PURPOSE: tests/assessment-session-print.test.js gives solid flow-level
// coverage of handleAssessmentSessionFlow()'s PRINT branch in isolation,
// but stubs generateBlueprintPaperPdf() and calls the flow function
// directly rather than through processMessage() -> messageProcessor.js
// -> commandHandler.js dispatch chain. Same class of gap as ATP
// (RC1-V-005), WORKSHEET (RC1-H-009), QMS (RC1-H-010), TEST (RC1-V-002),
// EXPLANATION (RC1-V-003), LESSON PLAN (RC1-V-004).
//
// Scope, per the approved seven-scenario matrix (RC1-PRINT recon):
//   1. PRINT with no published blueprints, real dispatch
//   2. PRINT -> valid selection, real DB blueprint, real generateBlueprintPaperPdf()
//   3. PRINT -> blueprint with zero questions (real error path)
//   4. COMPLETE_MENU numeric "2" after a completed NEW TEST capture session
//   5. blueprintAuthoringFlow's PUBLISHED_MENU numeric "2" after publishing
//   6. PRINT does not collide with an active NEW TEST capture session (real dispatch)
//   7. CANCEL mid-PRINT selection, real dispatch
//
// Explicitly NOT in scope (per recon): CAPS/ATP grounding (N/A — blueprints
// are teacher-authored), Pro/free-tier gating (none exists for PRINT), SAVE
// (PRINT never touches lastGeneratedState/triggerGeneration()).
//
// Only WhatsApp send (services/whatsappService) is stubbed.
// generateBlueprintPaperPdf() is the REAL module — real PDFKit rendering,
// real blueprint/question DB data. sendDocument() args are captured so the
// actual generated file and filename can be inspected.
//
// This is diagnostic only. No production code is touched. If a defect is
// found, it is reported and classified, not fixed, pending scope approval.
//
// Run: node tests/rc1-print-dispatch.test.js

process.env.PII_SECRET = 'test-secret-key-32-bytes-long!!';
process.env.FREE_LIMIT = '10';
process.env.APP_URL    = 'https://example.test';
process.env.PDF_SECRET = 'pdf-secret';
process.env.PRO_PRICE_ZAR = '99';

const Module = require('module');
const path = require('path');
const fs = require('fs');

let passed = 0;
let failed = 0;
const failures = [];
function check(condition, label, extra) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else {
    console.error(`  ❌ FAIL: ${label}${extra !== undefined ? ' -- ' + extra : ''}`);
    failed++;
    failures.push(label);
  }
}

const { createTestDb } = require('./helpers/createTestDb');
const testDb = createTestDb(__filename);
const db = testDb.db;

// ── Stub WhatsApp send only — capture text sends and document (PDF) sends ──
const sentMessages = [];
const sentDocuments = [];
const whatsappPath = path.resolve(__dirname, '../services/whatsappService');
require.cache[whatsappPath] = {
  id: whatsappPath, filename: whatsappPath, loaded: true,
  exports: {
    sendMessage: async (phone, text) => { sentMessages.push({ phone, text }); return true; },
    sendDocument: async (phone, url, filename, caption) => {
      sentDocuments.push({ phone, url, filename, caption });
      return true;
    },
    downloadMedia: async () => null,
    chunkMessage: (t) => [t],
  },
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === './whatsappService' || request === '../services/whatsappService') return whatsappPath;
  return origResolve.call(this, request, ...rest);
};

function insertTeacher(phoneHash, { grade = '6', subject = 'Mathematics' } = {}) {
  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject, is_pro) VALUES (?, ?, ?, ?, 1)`)
    .run(phoneHash, 'Test Teacher', grade, subject);
  db.prepare(`
    INSERT INTO onboarding (phone_hash, step, updated_at)
    VALUES (?, 'done', datetime('now'))
    ON CONFLICT(phone_hash) DO UPDATE SET step = 'done'
  `).run(phoneHash);
}

function insertClass(phoneHash, { name = 'Class A', grade = 6, subject = 'Mathematics', learnerCount = 0 } = {}) {
  return db.prepare(
    `INSERT INTO classes (phone_hash, name, grade, subject, learner_count) VALUES (?, ?, ?, ?, ?)`
  ).run(phoneHash, name, grade, subject, learnerCount).lastInsertRowid;
}

function makeMessage(from, body, id) { return { from, id, type: 'text', text: { body } }; }

(async () => {
  const {
    createBlueprint,
    publishBlueprint,
  } = require('../services/blueprintRepository');

  const {
    hashPhone,
    processMessage,
    buildProcessMessageDeps,
    assessmentSessionState,
  } = require('../routes/webhook').__testExports;

  let msgCounter = 0;
  async function send(phone, body) {
    msgCounter += 1;
    await processMessage(makeMessage(phone, body, `msg-${msgCounter}`), buildProcessMessageDeps());
  }
  function messagesSince(idx) { return sentMessages.slice(idx); }
  function documentsSince(idx) { return sentDocuments.slice(idx); }

  function publishedBlueprint(phoneHash, { title, grade = 6, subject = 'Mathematics', questions } = {}) {
    const result = createBlueprint(
      phoneHash,
      { title, subject, grade, term: 1, totalMarks: questions.reduce((s, q) => s + q.maxMarks, 0) || 1 },
      questions
    );
    publishBlueprint(result.blueprintId, phoneHash);
    return result.blueprintId;
  }

  console.log('\n── RC1 recon: PRINT real-dispatch audit ──\n');

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 1 — PRINT with no published blueprints, real dispatch
  // ═══════════════════════════════════════════════════════════════════
  console.log('── Scenario 1: PRINT with no published blueprints (real dispatch) ──');
  {
    const phone = '+27821299001';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);

    const startIdx = sentMessages.length;
    let threw = false, thrownErr = null;
    try {
      await send(phone, 'PRINT');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S1: no crash in the real dispatch chain', thrownErr?.stack);

    const msgs = messagesSince(startIdx);
    const guidanceMsg = msgs.find(m => /don't have any published Assessment Blueprints/i.test(m.text));
    check(!!guidanceMsg, 'S1: no-blueprints guidance fires through the real chain (onboarding gate did not block it)');

    check(!assessmentSessionState.get(phoneHash), 'S1: no session created when there are no published blueprints');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 2 — Valid selection, real DB blueprint, real PDF generation
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 2: PRINT -> valid selection, real generateBlueprintPaperPdf() ──');
  {
    const phone = '+27821299002';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);

    const blueprintId = publishedBlueprint(phoneHash, {
      title: 'Term 1 Fractions Test',
      grade: 6,
      subject: 'Mathematics',
      questions: [
        { questionNumber: 1, topic: 'Fractions', subtopic: 'Equivalent fractions', maxMarks: 5 },
        { questionNumber: 2, topic: 'Fractions', subtopic: 'Ordering fractions', maxMarks: 5 },
      ],
    });

    const startIdxMsgs = sentMessages.length;
    const startIdxDocs = sentDocuments.length;
    let threw = false, thrownErr = null;
    try {
      await send(phone, 'PRINT');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S2a: no crash listing the blueprint through real dispatch', thrownErr?.stack);

    const listMsg = messagesSince(startIdxMsgs).find(m => /Print a Question Paper/i.test(m.text));
    check(!!listMsg && /Term 1 Fractions Test/.test(listMsg.text), 'S2a: real published blueprint appears in the selection list');
    check(!!listMsg && /2 questions/.test(listMsg.text), 'S2a: real question count (2) shown in the list, not a stubbed fixture value');

    const genStartIdxMsgs = sentMessages.length;
    const genStartIdxDocs = sentDocuments.length;
    threw = false; thrownErr = null;
    try {
      await send(phone, '1');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S2b: no crash through real generateBlueprintPaperPdf() + real PDFKit rendering', thrownErr?.stack);

    const docs = documentsSince(genStartIdxDocs);
    check(docs.length === 1, 'S2b: exactly one PDF document sent', `got ${docs.length}`);
    check(!!docs[0] && /^Blueprint_Paper_Term_1_Fractions_Test\.pdf$/.test(docs[0].filename || ''), 'S2b: real filename pattern Blueprint_Paper_<title>.pdf (no grade, unlike ATP/worksheet)', docs[0]?.filename);

    // Inspect the actual PDF bytes on disk via getPdfPath() + the fileId
    // encoded in the sent document URL — real generation, not a stub.
    const { getPdfPath } = require('../services/pdfService');
    const urlMatch = (docs[0]?.url || '').match(/([0-9a-f-]{36})/i);
    check(!!urlMatch, 'S2b: sent document URL carries a real fileId (uuid)', docs[0]?.url);
    if (urlMatch) {
      const filePath = getPdfPath(urlMatch[1]);
      const exists = fs.existsSync(filePath);
      check(exists, 'S2b: real PDF file was written to disk');
      if (exists) {
        const bytes = fs.readFileSync(filePath);
        check(bytes.slice(0, 5).toString('latin1') === '%PDF-', 'S2b: file starts with a valid PDF header');
        check(bytes.length > 1500, `S2b: PDF has substantial real content (${bytes.length} bytes)`);
      }
    }

    check(!!docs[0] && /Printable question paper ready/i.test(docs[0].caption || ''), 'S2b: "paper ready" confirmation sent as the document caption');

    check(!assessmentSessionState.get(phoneHash), 'S2b: single-turn action — session cleared after generation, nothing left to RESUME');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 3 — Blueprint with zero questions: real error path
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 3: PRINT -> published blueprint with zero questions (real error path) ──');
  {
    const phone = '+27821299003';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);

    const blueprintId = publishedBlueprint(phoneHash, {
      title: 'Empty Blueprint',
      grade: 6,
      subject: 'Mathematics',
      questions: [{ questionNumber: 1, topic: 'Fractions', maxMarks: 5 }],
    });
    // Force a genuinely empty question set on a published blueprint —
    // deleteQuestion() is blocked post-publish by design, so this uses a
    // direct SQL delete to reach the same real-world state (a blueprint
    // whose questions are gone but the header row remains published),
    // and reaches generateBlueprintPaperPdf()'s own zero-question guard
    // rather than a scripted stub error.
    db.prepare(`DELETE FROM blueprint_questions WHERE blueprint_id = ?`).run(blueprintId);

    const startIdxMsgs = sentMessages.length;
    const startIdxDocs = sentDocuments.length;
    let threw = false, thrownErr = null;
    try {
      await send(phone, 'PRINT');
      await send(phone, '1');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S3: no crash on a real zero-question blueprint', thrownErr?.stack);

    const docs = documentsSince(startIdxDocs);
    check(docs.length === 0, 'S3: no PDF document sent for a blueprint with no questions');

    const errMsg = messagesSince(startIdxMsgs).find(m => /Couldn't generate the printable paper/i.test(m.text));
    check(!!errMsg, 'S3: teacher gets the real generateBlueprintPaperPdf() error message, not a crash');

    check(!assessmentSessionState.get(phoneHash), 'S3: session cleared even on generation failure');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 4 — COMPLETE_MENU numeric "2" after a completed NEW TEST session
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 4: COMPLETE_MENU numeric "2" routes into real PRINT generation ──');
  {
    const phone = '+27821299004';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    const classId = insertClass(phoneHash, { name: 'Class M4', learnerCount: 1 });

    const printBlueprintId = publishedBlueprint(phoneHash, {
      title: 'COMPLETE_MENU Print Target',
      grade: 6,
      subject: 'Mathematics',
      questions: [{ questionNumber: 1, topic: 'Fractions', maxMarks: 10 }],
    });
    // Second blueprint is the one actually captured against — drives a
    // real NEW TEST session through to a genuine COMPLETE_MENU, rather
    // than seeding internal flow state (blueprintAuthoringState-style
    // seeding isn't available via __testExports, and driving the real
    // flow is stronger evidence anyway).
    publishedBlueprint(phoneHash, {
      title: 'Capture Source Blueprint',
      grade: 6,
      subject: 'Mathematics',
      questions: [{ questionNumber: 1, topic: 'Fractions', maxMarks: 10 }],
    });

    let threw = false, thrownErr = null;
    try {
      await send(phone, 'NEW TEST');       // -> SELECT_BLUEPRINT
      await send(phone, '1');              // pick a blueprint -> SELECT_CLASS
      await send(phone, '1');              // pick the class -> ACTIVE capture
      await send(phone, 'Thabo');          // learner name
      await send(phone, '8');              // mark for the (only) question -> capture complete -> COMPLETE_MENU
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S4-setup: no crash driving a real NEW TEST session to completion', thrownErr?.stack);

    const stateAtCompletion = assessmentSessionState.get(phoneHash);
    check(!!stateAtCompletion && stateAtCompletion.step === 'completeMenu', 'S4-setup: real capture session reached COMPLETE_MENU (menu genuinely open, not seeded)', JSON.stringify(stateAtCompletion));

    const startIdxMsgs = sentMessages.length;
    threw = false; thrownErr = null;
    try {
      await send(phone, '2');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S4a: no crash routing COMPLETE_MENU "2" through real dispatch', thrownErr?.stack);

    const listMsg = messagesSince(startIdxMsgs).find(m => /Print a Question Paper/i.test(m.text));
    check(!!listMsg, 'S4a: numeric "2" at COMPLETE_MENU routed into the real PRINT blueprint-selection list');
    check(!!listMsg && /COMPLETE_MENU Print Target/.test(listMsg.text), 'S4a: PRINT list still shows all published blueprints for this teacher, not just the just-captured one');

    threw = false; thrownErr = null;
    const genStartIdxDocs = sentDocuments.length;
    try {
      await send(phone, '1');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S4b: no crash completing the routed PRINT generation', thrownErr?.stack);
    const docs = documentsSince(genStartIdxDocs);
    check(docs.length === 1, 'S4b: real PDF generated and sent via the COMPLETE_MENU entry point', `got ${docs.length}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 5 — blueprintAuthoringFlow's PUBLISHED_MENU "2" after publishing
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 5: blueprintAuthoringFlow PUBLISHED_MENU "2" routes into real PRINT ──');
  {
    const phone = '+27821299005';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);

    // Drive the REAL authoring flow through to PUBLISHED_MENU — no
    // internal state seeding available for blueprintAuthoringState via
    // __testExports, and doing it for real is stronger evidence for the
    // "typeof handleAssessmentSessionFlow === 'function'" wiring anyway.
    let threw = false, thrownErr = null;
    try {
      await send(phone, 'NEW BLUEPRINT');
      await send(phone, 'PUBLISHED_MENU Route Test'); // title
      await send(phone, 'Mathematics');                // subject
      await send(phone, '6');                           // grade
      await send(phone, 'SKIP');                        // term
      await send(phone, '10');                          // total marks
      await send(phone, 'Fractions | 10');               // question 1
      await send(phone, 'DONE');
      await send(phone, 'PUBLISH');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S5-setup: no crash driving a real blueprint through authoring + PUBLISH', thrownErr?.stack);

    const publishedMsg = sentMessages[sentMessages.length - 1];
    check(!!publishedMsg && /published/i.test(publishedMsg.text || ''), 'S5-setup: blueprint genuinely reached published status via real PUBLISH', publishedMsg?.text);

    const startIdxMsgs = sentMessages.length;
    threw = false; thrownErr = null;
    try {
      await send(phone, '2');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S5a: no crash routing PUBLISHED_MENU "2" through real dispatch (typeof handleAssessmentSessionFlow wiring actually functions)', thrownErr?.stack);

    const listMsg = messagesSince(startIdxMsgs).find(m => /Print a Question Paper/i.test(m.text));
    check(!!listMsg, 'S5a: numeric "2" at PUBLISHED_MENU routed into the real PRINT blueprint-selection list');
    check(!!listMsg && /PUBLISHED_MENU Route Test/.test(listMsg.text), 'S5a: the just-published blueprint appears in the PRINT list immediately');

    const genStartIdxDocs = sentDocuments.length;
    threw = false; thrownErr = null;
    try {
      await send(phone, '1');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S5b: no crash completing the routed PRINT generation', thrownErr?.stack);
    const docs = documentsSince(genStartIdxDocs);
    check(docs.length === 1, 'S5b: real PDF generated and sent via the PUBLISHED_MENU entry point', `got ${docs.length}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 6 — PRINT does not collide with an active NEW TEST capture
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 6: PRINT does not clobber an active NEW TEST capture session (real dispatch) ──');
  {
    const phone = '+27821299006';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    const classId = insertClass(phoneHash, { learnerCount: 1 });

    publishedBlueprint(phoneHash, {
      title: 'Collision Test Blueprint',
      grade: 6,
      subject: 'Mathematics',
      questions: [{ questionNumber: 1, topic: 'Fractions', maxMarks: 10 }],
    });

    // Seed an active mid-capture NEW TEST session directly (SELECT_CLASS
    // step) — a real in-progress capture, not a COMPLETE_MENU/finished
    // state, so this genuinely exercises the "don't clobber" guard the
    // way RC1-H-004/H-006/H-008 showed flow-level tests can miss.
    assessmentSessionState.set(phoneHash, {
      step: 'selectClass',
      blueprintId: 1,
      blueprintTitle: 'In-progress capture',
      blueprintTotalMarks: 10,
      classes: [{ id: classId, name: 'Class A', grade: 6, subject: 'Mathematics', learner_count: 1 }],
      lastActivity: Date.now(),
    });

    const startIdxMsgs = sentMessages.length;
    let threw = false, thrownErr = null;
    try {
      await send(phone, 'PRINT');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S6: no crash sending PRINT while a capture session is active', thrownErr?.stack);

    const stateAfter = assessmentSessionState.get(phoneHash);
    check(!!stateAfter && stateAfter.step === 'selectClass', 'S6: active NEW TEST capture session (step=selectClass) was NOT clobbered by PRINT', JSON.stringify(stateAfter));

    const printListMsg = messagesSince(startIdxMsgs).find(m => /Print a Question Paper/i.test(m.text));
    check(!printListMsg, 'S6: PRINT did not start a new blueprint-selection flow while capture is active');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 7 — CANCEL mid-PRINT selection, real dispatch
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 7: CANCEL mid-PRINT selection (real dispatch) ──');
  {
    const phone = '+27821299007';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);

    publishedBlueprint(phoneHash, {
      title: 'Cancel Test Blueprint',
      grade: 6,
      subject: 'Mathematics',
      questions: [{ questionNumber: 1, topic: 'Fractions', maxMarks: 10 }],
    });

    let threw = false, thrownErr = null;
    try {
      await send(phone, 'PRINT');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S7a: no crash entering PRINT selection', thrownErr?.stack);
    check(!!assessmentSessionState.get(phoneHash), 'S7a: session is active at SELECT_PRINT_BLUEPRINT before CANCEL');

    const startIdxMsgs = sentMessages.length;
    const startIdxDocs = sentDocuments.length;
    threw = false; thrownErr = null;
    try {
      await send(phone, 'CANCEL');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S7b: no crash cancelling mid-PRINT', thrownErr?.stack);

    const cancelMsg = messagesSince(startIdxMsgs).find(m => /Assessment session cancelled/i.test(m.text));
    check(!!cancelMsg, 'S7b: cancellation confirmation sent through real dispatch');
    check(!assessmentSessionState.get(phoneHash), 'S7b: session cleared after CANCEL');
    check(documentsSince(startIdxDocs).length === 0, 'S7b: no PDF generated after cancelling');
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\nFailed checks:');
    failures.forEach(f => console.log(`  - ${f}`));
  }

  testDb.cleanup();
  Module._resolveFilename = origResolve;

  process.exit(failed > 0 ? 1 : 0);
})();
