'use strict';
// RC1 recon harness — CLASS INTERVENTION: real-dispatch coverage audit.
//
// PURPOSE: tests/workspaceFlow-classIntervention.test.js and
// tests/workspaceFlow-classInterventionPdf.test.js give solid flow-level
// coverage of handleWorkspaceFlow()'s CLASS INTERVENTION branches, but call
// the flow function directly with fully-mocked deps (getClassInterventionPlan,
// getTeacherClasses stubbed) rather than through processMessage() ->
// commandHandler.js -> real service -> real DB. tests/classInterventionService.test.js
// covers the aggregation logic itself but monkey-patches learnerRosterService
// and interventionService directly rather than exercising the real
// Repository -> Timeline -> Progress/Coverage -> Mastery -> Intervention
// chain. Same class of gap as ATP (RC1-V-005), PRINT (RC1-V-006), WORKSHEET
// (RC1-H-009), QMS (RC1-H-010), TEST (RC1-V-002), EXPLANATION (RC1-V-003),
// LESSON PLAN (RC1-V-004).
//
// Scope, per the approved seven-scenario matrix (RC1 CLASS INTERVENTION recon):
//   1. Zero real classes, real dispatch (incl. lightweight onboarding-gate check)
//   2. One real class + genuine assessment history -> real evaluated,
//      prioritized intervention report (real NEW TEST capture drives this,
//      not seeded/mocked mastery data)
//   3. One real class, learners with no assessment history -> real
//      insufficient-data behavior, not a mocked response
//   4. 2+ real classes, no selector -> real DB-backed class list prompt
//   5. 2+ real classes, numeric + name selector -> real resolution
//   6. CLASS INTERVENTION PDF on an evaluated class -> real
//      generateClassInterventionPdf(), valid PDF bytes, correct filename
//   7. CLASS INTERVENTION PDF on a zero-learner class -> real PDF error path
//
// Explicitly NOT in scope (per recon): Pro/free-tier gating (none exists),
// SAVE (not part of this feature), ATP/CAPS grounding (N/A), AI retry
// (no AI-generation boundary here), LEARNER PROGRESS logic beyond what's
// needed to create genuine underlying data for Scenario 2.
//
// Only WhatsApp send (services/whatsappService) is stubbed.
// getClassInterventionPlan() and generateClassInterventionPdf() are the REAL
// modules — real DB roster, real Repository->Timeline->Progress->Mastery->
// Intervention chain, real PDFKit rendering. Scenario 2's "evaluated" data
// is produced by driving a genuine NEW TEST capture through real dispatch
// (same discipline as PRINT's COMPLETE_MENU scenario), not by seeding
// mastery/progress rows directly.
//
// This is diagnostic only. No production code is touched. If a defect is
// found, it is reported and classified, not fixed, pending scope approval.
//
// Run: node tests/rc1-classintervention-dispatch.test.js

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

function insertTeacher(phoneHash, { grade = '6', subject = 'Mathematics', onboarded = true } = {}) {
  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject, is_pro) VALUES (?, ?, ?, ?, 1)`)
    .run(phoneHash, 'Test Teacher', grade, subject);
  if (onboarded) {
    db.prepare(`
      INSERT INTO onboarding (phone_hash, step, updated_at)
      VALUES (?, 'done', datetime('now'))
      ON CONFLICT(phone_hash) DO UPDATE SET step = 'done'
    `).run(phoneHash);
  }
  // A not-onboarded teacher deliberately gets no onboarding row at all —
  // matches core/commandHandler.js's `onboardingStep === null` ->
  // "brand-new teacher, no escape" real gating path.
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

  // Drives a genuine NEW TEST capture to completion through real dispatch,
  // producing real learner_results rows (and therefore real timeline
  // events) for `learnerName` in `classId`. This is the ONLY way Scenario 2
  // is allowed to acquire "evaluated" data per the approved matrix — no
  // direct mastery/progress row seeding.
  async function captureRealAssessment(phone, { blueprintListPosition, classListPosition, learnerName, marks }) {
    await send(phone, 'NEW TEST');
    await send(phone, String(blueprintListPosition));
    await send(phone, String(classListPosition));
    await send(phone, learnerName);
    for (const mark of marks) {
      await send(phone, String(mark));
    }
  }

  console.log('\n── RC1 recon: CLASS INTERVENTION real-dispatch audit ──\n');

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 1 — Zero real classes, real dispatch + onboarding-gate check
  // ═══════════════════════════════════════════════════════════════════
  console.log('── Scenario 1: zero real classes (real dispatch) + onboarding gate ──');
  {
    // 1a: onboarding gate — a teacher with NO onboarding row (brand-new,
    // never even started onboarding) must not reach CLASS INTERVENTION.
    const gatePhone = '+27821299101';
    const gatePhoneHash = hashPhone(gatePhone);
    insertTeacher(gatePhoneHash, { onboarded: false });

    const gateStartIdx = sentMessages.length;
    let threw = false, thrownErr = null;
    try {
      await send(gatePhone, 'CLASS INTERVENTION');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S1a: no crash sending CLASS INTERVENTION as a not-yet-onboarded teacher', thrownErr?.stack);

    const gateMsgs = messagesSince(gateStartIdx);
    const workspaceGuidance = gateMsgs.find(m => /No classes yet|Which class|couldn't load the class intervention/i.test(m.text));
    if (process.env.RC1_DEBUG) console.log('S1a raw messages:', JSON.stringify(gateMsgs, null, 2));
    check(!workspaceGuidance, 'S1a: not-onboarded teacher does not reach CLASS INTERVENTION\'s own guidance text (onboarding intercepts first)');

    // 1b: a real, onboarded teacher with zero classes.
    const phone = '+27821299102';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);

    const startIdx = sentMessages.length;
    threw = false; thrownErr = null;
    try {
      await send(phone, 'CLASS INTERVENTION');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S1b: no crash in the real dispatch chain', thrownErr?.stack);

    const msgs = messagesSince(startIdx);
    const guidanceMsg = msgs.find(m => /No classes yet/i.test(m.text));
    check(!!guidanceMsg, 'S1b: real "No classes yet" guidance fires through the real chain');
    check(!!guidanceMsg && /NEW CLASS/.test(guidanceMsg.text), 'S1b: zero-class reply points at NEW CLASS');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 2 — One real class + genuine assessment history (real chain)
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 2: one real class + genuine assessment history ──');
  {
    const phone = '+27821299103';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    const classId = insertClass(phoneHash, { name: 'Evaluated Class', learnerCount: 1 });

    const blueprintId = publishedBlueprint(phoneHash, {
      title: 'CI Real Data Source',
      grade: 6,
      subject: 'Mathematics',
      questions: [{ questionNumber: 1, topic: 'Fractions', maxMarks: 10 }],
    });

    let threw = false, thrownErr = null;
    try {
      await captureRealAssessment(phone, {
        blueprintListPosition: 1,
        classListPosition: 1,
        learnerName: 'Realdata Learner',
        marks: [9], // 90% — genuine percentage-bearing learner_results row
      });
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S2-setup: no crash driving a real NEW TEST capture to completion', thrownErr?.stack);

    const stateAtCompletion = assessmentSessionState.get(phoneHash);
    check(!!stateAtCompletion && stateAtCompletion.step === 'completeMenu', 'S2-setup: real capture session reached COMPLETE_MENU (genuine completion, not seeded)', JSON.stringify(stateAtCompletion));

    // Clear the completion menu without touching PRINT — any reply other
    // than "1"/"2" or MENU should be fine; use MENU to get back to a clean
    // top-level state before invoking CLASS INTERVENTION.
    await send(phone, 'MENU');

    const startIdx = sentMessages.length;
    threw = false; thrownErr = null;
    try {
      await send(phone, 'CLASS INTERVENTION');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S2a: no crash through the real Repository->Timeline->Progress->Mastery->Intervention chain', thrownErr?.stack);

    const report = messagesSince(startIdx).find(m => /Evaluated Class/.test(m.text));
    check(!!report, 'S2a: real class name appears in the intervention report');
    check(!!report && /Realdata Learner/.test(report.text), 'S2a: the real learner (from a genuine capture, not a fixture) appears by name');
    check(!!report && /1 evaluated/.test(report.text), 'S2a: real evaluated count is 1 — genuine mastery data was found, not insufficient-data');
    check(!!report && !/0 evaluated/.test(report.text), 'S2a: NOT the mocked/insufficient-data shape — real progress data actually drove an evaluated result');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 3 — One real class, learners with NO assessment history
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 3: real class, learner with no assessment history (real insufficient-data) ──');
  {
    const phone = '+27821299104';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    const classId = insertClass(phoneHash, { name: 'Fresh Class', learnerCount: 0 });

    // Insert a real learner row directly on the roster (no captures, no
    // learner_results) — the genuine "exists but no history yet" case,
    // matching learnerRosterService.getRoster()'s real query shape.
    db.prepare(`
      INSERT INTO learners (phone_hash, class_id, canonical_name, normalized_name)
      VALUES (?, ?, ?, ?)
    `).run(phoneHash, classId, 'No History Learner', 'no history learner');

    const startIdx = sentMessages.length;
    let threw = false, thrownErr = null;
    try {
      await send(phone, 'CLASS INTERVENTION');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S3: no crash through the real chain for a learner with zero history', thrownErr?.stack);

    const report = messagesSince(startIdx).find(m => /Fresh Class/.test(m.text));
    check(!!report, 'S3: real class name appears in the report');
    check(!!report && /1 awaiting data|0 evaluated/.test(report.text), 'S3: genuine insufficient-data outcome from the real chain (no percentage history exists)', report?.text);
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 4 — 2+ real classes, no selector
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 4: 2+ real classes, no selector (real DB-backed prompt) ──');
  {
    const phone = '+27821299105';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    insertClass(phoneHash, { name: 'Grade 6 Alpha' });
    insertClass(phoneHash, { name: 'Grade 6 Beta' });

    const startIdx = sentMessages.length;
    let threw = false, thrownErr = null;
    try {
      await send(phone, 'CLASS INTERVENTION');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S4: no crash listing real classes through dispatch', thrownErr?.stack);

    const prompt = messagesSince(startIdx).find(m => /Which class/i.test(m.text));
    check(!!prompt, 'S4: real "which class" prompt fires');
    check(!!prompt && prompt.text.includes('Grade 6 Alpha') && prompt.text.includes('Grade 6 Beta'), 'S4: both real DB-backed classes are listed');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 5 — 2+ real classes, numeric + name selector
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 5: 2+ real classes, numeric + name selector (real resolution) ──');
  {
    const phone = '+27821299106';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    insertClass(phoneHash, { name: 'Grade 6 Alpha' });
    insertClass(phoneHash, { name: 'Grade 6 Beta' });

    // Numeric selector
    let startIdx = sentMessages.length;
    let threw = false, thrownErr = null;
    try {
      await send(phone, 'CLASS INTERVENTION 2');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S5a: no crash with a real numeric selector', thrownErr?.stack);
    let report = messagesSince(startIdx).find(m => /Grade 6 Beta/.test(m.text));
    check(!!report, 'S5a: numeric selector "2" resolves to the correct real class');

    // Name selector
    startIdx = sentMessages.length;
    threw = false; thrownErr = null;
    try {
      await send(phone, 'CLASS INTERVENTION Alpha');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S5b: no crash with a real name selector', thrownErr?.stack);
    report = messagesSince(startIdx).find(m => /Grade 6 Alpha/.test(m.text));
    check(!!report, 'S5b: name selector "Alpha" resolves to the correct real class');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 6 — CLASS INTERVENTION PDF on an evaluated class (real PDF)
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 6: CLASS INTERVENTION PDF on evaluated class (real generateClassInterventionPdf()) ──');
  {
    const phone = '+27821299107';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    insertClass(phoneHash, { name: 'PDF Evaluated Class', learnerCount: 1 });

    publishedBlueprint(phoneHash, {
      title: 'CI PDF Real Data Source',
      grade: 6,
      subject: 'Mathematics',
      questions: [{ questionNumber: 1, topic: 'Fractions', maxMarks: 10 }],
    });

    let threw = false, thrownErr = null;
    try {
      await captureRealAssessment(phone, {
        blueprintListPosition: 1,
        classListPosition: 1,
        learnerName: 'PDF Realdata Learner',
        marks: [7],
      });
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S6-setup: no crash driving a real capture for the PDF scenario', thrownErr?.stack);
    await send(phone, 'MENU');

    const genStartIdxDocs = sentDocuments.length;
    threw = false; thrownErr = null;
    try {
      await send(phone, 'CLASS INTERVENTION PDF');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S6a: no crash through real generateClassInterventionPdf()', thrownErr?.stack);

    const docs = documentsSince(genStartIdxDocs);
    check(docs.length === 1, 'S6a: exactly one PDF document sent', `got ${docs.length}`);
    check(!!docs[0] && /^Class_Intervention_Report_PDF_Evaluated_Class\.pdf$/.test(docs[0].filename || ''), 'S6a: real filename pattern Class_Intervention_Report_<name>.pdf', docs[0]?.filename);

    const { getPdfPath } = require('../services/pdfService');
    const urlMatch = (docs[0]?.url || '').match(/([0-9a-f-]{36})/i);
    check(!!urlMatch, 'S6a: sent document URL carries a real fileId (uuid)', docs[0]?.url);
    if (urlMatch) {
      const filePath = getPdfPath(urlMatch[1]);
      const exists = fs.existsSync(filePath);
      check(exists, 'S6a: real PDF file was written to disk');
      if (exists) {
        const bytes = fs.readFileSync(filePath);
        check(bytes.slice(0, 5).toString('latin1') === '%PDF-', 'S6a: file starts with a valid PDF header');
        check(bytes.length > 500, `S6a: PDF has substantial real content (${bytes.length} bytes)`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 7 — CLASS INTERVENTION PDF on a zero-learner class (real error path)
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 7: CLASS INTERVENTION PDF on zero-learner class (real error branch) ──');
  {
    const phone = '+27821299108';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    insertClass(phoneHash, { name: 'Empty Roster Class', learnerCount: 0 });

    const startIdx = sentMessages.length;
    const startIdxDocs = sentDocuments.length;
    let threw = false, thrownErr = null;
    try {
      await send(phone, 'CLASS INTERVENTION PDF');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S7: no crash on the real zero-learner PDF error path', thrownErr?.stack);

    check(documentsSince(startIdxDocs).length === 0, 'S7: no PDF document sent for a zero-learner class');
    const errMsg = messagesSince(startIdx).find(m => /no learners recorded|no learners yet/i.test(m.text));
    check(!!errMsg, 'S7: teacher gets the real friendly error message, not a crash or silent failure', JSON.stringify(messagesSince(startIdx)));
  }

  console.log(`\n${'─'.repeat(70)}\nRC1 CLASS INTERVENTION real-dispatch audit: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailed checks:');
    failures.forEach(f => console.log(`  - ${f}`));
  }

  Module._resolveFilename = origResolve;
  testDb.cleanup();
  process.exit(failed > 0 ? 1 : 0);
})();
