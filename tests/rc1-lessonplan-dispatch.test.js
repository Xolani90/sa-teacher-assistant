'use strict';
// RC1 recon harness — LESSON PLAN: real-dispatch coverage audit.
//
// PURPOSE: tests/test.js "TEST 4" only exercises parseIntent()/buildPrompt()
// in isolation — it proves LESSON PLAN classifies correctly and that the
// prompt text contains "LESSON PLAN"/"LEARNING OBJECTIVES"/"60 min", but
// never proves a generated plan actually reaches the user, that PDF
// delivery works, that SAVE state is recorded, that ATP topic auto-fill or
// mismatch-warning behavior fires, or that the dedicated LESSONPLAN
// follow-up command works. Same class of gap as WORKSHEET (RC1-H-009),
// QMS (RC1-H-010), TEST (RC1-V-002), and EXPLANATION (RC1-V-003) — but
// broader scope than EXPLANATION, since LESSON PLAN is ATP-grounded,
// PDF-eligible, and saveable (EXPLANATION is none of these).
//
// This harness exercises the REAL production path:
//   routes/webhook.js::processMessage() -> core/messageProcessor.js
//   -> core/commandHandler.js (LESSONPLAN follow-up command)
//   -> core/generationPipeline.js::triggerGeneration()
//   -> services/pdfService.js::generatePdf() (REAL — not stubbed; wrapped
//      only to count invocations, so PDF eligibility/exclusion is verified
//      at the boundary, not by scanning delivered text)
// Only the AI boundary (services/aiService.js) and WhatsApp send
// (services/whatsappService.js) are stubbed.
//
// This is diagnostic only. No production code is touched. If a defect is
// found, it is reported and classified, not fixed, pending scope approval.
//
// Run: node tests/rc1-lessonplan-dispatch.test.js

process.env.PII_SECRET = 'test-secret-key-32-bytes-long!!';
process.env.FREE_LIMIT = '10';
process.env.APP_URL    = 'https://example.test';
process.env.PDF_SECRET = 'pdf-secret';
process.env.PRO_PRICE_ZAR = '99';

const Module = require('module');
const path = require('path');

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

// ── Stub the AI boundary only — return realistic LESSON PLAN content ──
let genCounter = 0;
const aiServicePath = path.resolve(__dirname, '../services/aiService');
require.cache[aiServicePath] = {
  id: aiServicePath, filename: aiServicePath, loaded: true,
  exports: {
    generateContent: async (prompt, intentType) => {
      if (intentType === 'classifier') throw new Error('force regex fallback for deterministic test classification');
      genCounter += 1;
      return (
        `*LESSON PLAN: Topic ${genCounter}*\n` +
        `*Duration: 60 min*\n\n` +
        `*LEARNING OBJECTIVES*\n` +
        `By the end of this lesson, learners will be able to explain the key concept and apply it to a worked example.\n\n` +
        `*INTRODUCTION (10 min)*\n` +
        `Recap prior knowledge and introduce today's topic with a relatable example.\n\n` +
        `*MAIN ACTIVITY (35 min)*\n` +
        `Guided practice with worked examples, followed by independent practice questions.\n\n` +
        `*CONCLUSION (10 min)*\n` +
        `Exit-ticket question to check understanding.\n\n` +
        `*HOMEWORK*\n` +
        `Complete practice questions 1-10 on today's topic from the textbook and bring corrections tomorrow.\n\n` +
        `*RESOURCES NEEDED*\n` +
        `Chalkboard, worksheets, textbook.\n` +
        `(Generation #${genCounter})`
      );
    },
  },
};

// generatePdf is NOT stubbed away — wrap the real module's export to count
// invocations and capture the args passed, so PDF eligibility/exclusion and
// lesson-plan-specific filename/title handling are verified at the real
// boundary, not by scanning delivered text.
const pdfServicePath = path.resolve(__dirname, '../services/pdfService');
const realPdfService = require(pdfServicePath);
const pdfCallArgs = [];
let pdfCalls = 0;
const wrappedPdfService = Object.create(realPdfService);
if (typeof realPdfService.generatePdf === 'function') {
  wrappedPdfService.generatePdf = async (...args) => {
    pdfCalls += 1;
    pdfCallArgs.push(args[0]);
    return realPdfService.generatePdf(...args);
  };
}
require.cache[pdfServicePath] = {
  id: pdfServicePath, filename: pdfServicePath, loaded: true, exports: wrappedPdfService,
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === './whatsappService' || request === '../services/whatsappService') return whatsappPath;
  if (request === './aiService' || request === '../services/aiService') return aiServicePath;
  if (request === './pdfService' || request === '../services/pdfService') return pdfServicePath;
  return origResolve.call(this, request, ...rest);
};

function insertTeacher(phoneHash, { isPro = 0, grade = '9', subject = 'English' } = {}) {
  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject, is_pro) VALUES (?, ?, ?, ?, ?)`)
    .run(phoneHash, 'Test Teacher', grade, subject, isPro);
  db.prepare(`
    INSERT INTO onboarding (phone_hash, step, updated_at)
    VALUES (?, 'done', datetime('now'))
    ON CONFLICT(phone_hash) DO UPDATE SET step = 'done'
  `).run(phoneHash);
}

function makeMessage(from, body, id) { return { from, id, type: 'text', text: { body } }; }
function wait(ms) { return new Promise((res) => setTimeout(res, ms)); }

(async () => {
  const {
    hashPhone,
    lastGeneratedState,
    processMessage,
    buildProcessMessageDeps,
  } = require('../routes/webhook').__testExports;
  const pendingIntentState = require('../routes/webhook').__testExports.buildProcessMessageDeps().pendingIntentState;

  let msgCounter = 0;
  async function send(phone, body) {
    msgCounter += 1;
    await processMessage(makeMessage(phone, body, `msg-${msgCounter}`), buildProcessMessageDeps());
  }
  function messagesSince(idx) { return sentMessages.slice(idx); }
  function documentsSince(idx) { return sentDocuments.slice(idx); }

  console.log('\n── RC1 recon: LESSON PLAN real-dispatch audit ──\n');

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 1 — Natural-language lesson plan request, free-tier (no PDF)
  // ═══════════════════════════════════════════════════════════════════
  console.log('── Scenario 1: natural-language lesson plan (free tier) ──');
  {
    const phone = '+27821177001';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash, { isPro: 0, grade: '9', subject: 'English' });

    const startIdxMsgs = sentMessages.length;
    const startIdxDocs = sentDocuments.length;
    const pdfCallsBefore = pdfCalls;
    let threw = false, thrownErr = null;
    try {
      await send(phone, 'Lesson plan Grade 9 English poetry');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S1: no crash in the real dispatch chain', thrownErr?.stack);

    const msgs = messagesSince(startIdxMsgs);
    const ackMsg = msgs.find(m => /Generating your/.test(m.text));
    check(!!ackMsg, 'S1: acknowledgment message sent');

    const contentMsg = msgs.find(m => /LESSON PLAN/.test(m.text));
    check(!!contentMsg, 'S1: generated lesson plan actually reached WhatsApp send');
    check(!!contentMsg && /LEARNING OBJECTIVES/.test(contentMsg.text), 'S1: delivered content includes learning objectives section');

    // Free tier — no PDF; upsell nudge instead.
    check(pdfCalls === pdfCallsBefore, 'S1: real generatePdf() not invoked for free-tier teacher');
    check(documentsSince(startIdxDocs).length === 0, 'S1: no PDF document sent (free tier)');
    const upsell = msgs.find(m => /Pro.*PDF|PDF.*Pro/i.test(m.text));
    check(!!upsell, 'S1: free-tier teacher — PDF upsell message sent instead');

    // SAVE eligibility — lastGeneratedState SHOULD be populated (opposite of EXPLANATION).
    const saved = lastGeneratedState.get(phoneHash);
    check(!!saved && saved.intent.type === 'lessonPlan', 'S1: lastGeneratedState records intent.type === lessonPlan for SAVE follow-up', JSON.stringify(saved));

    // No disambiguation nudge should follow a lessonPlan generation (that's an
    // explanation-only follow-up feature) — sanity negative check.
    await wait(1300);
    const laterMsgs = messagesSince(startIdxMsgs);
    const nudge = laterMsgs.find(m => /Would you also like/.test(m.text));
    check(!nudge, 'S1: no explanation-style disambiguation nudge follows a lessonPlan generation');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 2 — Same request, Pro teacher (real PDF path)
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 2: natural-language lesson plan (Pro tier, PDF path) ──');
  {
    const phone = '+27821177002';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash, { isPro: 1, grade: '9', subject: 'English' });

    const startIdxMsgs = sentMessages.length;
    const startIdxDocs = sentDocuments.length;
    const pdfCallsBefore = pdfCalls;
    let threw = false, thrownErr = null;
    try {
      await send(phone, 'Lesson plan Grade 9 English poetry');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S2: no crash in the real dispatch chain (including real generatePdf())', thrownErr?.stack);

    const msgs = messagesSince(startIdxMsgs);
    const contentMsg = msgs.find(m => /LESSON PLAN/.test(m.text));
    check(!!contentMsg, 'S2: WhatsApp text delivery contains the lesson plan');

    check(pdfCalls === pdfCallsBefore + 1, 'S2: real generatePdf() invoked exactly once for a Pro teacher', `calls delta=${pdfCalls - pdfCallsBefore}`);
    const lastArgs = pdfCallArgs[pdfCallArgs.length - 1];
    check(!!lastArgs && lastArgs.type === 'lessonPlan', 'S2: generatePdf() called with type=lessonPlan', JSON.stringify(lastArgs && lastArgs.type));
    check(!!lastArgs && /poetry/i.test(lastArgs.topic || ''), 'S2: generatePdf() called with the correct topic', JSON.stringify(lastArgs && lastArgs.topic));
    check(!!lastArgs && /LESSON PLAN/.test(lastArgs.content || ''), 'S2: generatePdf() received the real, undamaged generated content (not a placeholder)');

    const docs = documentsSince(startIdxDocs);
    check(docs.length === 1, 'S2: exactly one PDF document sent to a Pro teacher', `got ${docs.length}`);
    check(!!docs[0] && /Lesson_Plan/i.test(docs[0].filename || ''), 'S2: sent document has a lesson-plan-specific filename', docs[0]?.filename);
    check(!!docs[0] && /\.pdf$/i.test(docs[0].filename || ''), 'S2: sent document has a .pdf filename', docs[0]?.filename);
    check(!!docs[0] && /PDF Download/.test(docs[0].caption || ''), 'S2: PDF caption sent as expected');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 3 — Topic genuinely omitted: ATP auto-fill
  // ═══════════════════════════════════════════════════════════════════
  // NOTE ON HARNESS DESIGN: natural-language phrasing cannot exercise this
  // branch. utils/intentParser.js::parseIntent() has a fallback rule — if
  // the cleaned topic comes out empty, it substitutes the SUBJECT NAME as
  // the topic (`if (!topic) topic = subject`). So a message like "Lesson
  // plan Grade 7 Mathematics" never actually produces intent.topic === null
  // — it produces topic: 'mathematics', which correctly routes into the
  // ATP MISMATCH branch instead (verified: fires correctly, see below),
  // not the auto-fill branch. A truly null intent.topic for lessonPlan is
  // therefore only reachable via a programmatically-constructed intent
  // (e.g. a seeded pendingIntentState, as an upstream flow might produce),
  // not via any natural-language phrasing — this harness exercises it that
  // way, through the real LESSONPLAN follow-up command dispatch.
  console.log('\n── Scenario 3: lesson plan with topic genuinely omitted (ATP auto-fill) ──');
  {
    const phone = '+27821177003';
    const phoneHash = hashPhone(phone);
    // Grade 7 Mathematics — confirmed real ATP data exists and resolves to
    // "Geometric constructions" for the current term/week.
    insertTeacher(phoneHash, { isPro: 0, grade: '7', subject: 'Mathematics' });

    pendingIntentState.set(phoneHash, {
      intent: { topic: null, grade: 7, subject: 'mathematics' },
      lastActivity: Date.now(),
    });

    const startIdx = sentMessages.length;
    let threw = false, thrownErr = null;
    try {
      await send(phone, 'LESSONPLAN');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S3: no crash in the real dispatch chain', thrownErr?.stack);

    const msgs = messagesSince(startIdx);
    const contentMsg = msgs.find(m => /LESSON PLAN/.test(m.text));
    check(!!contentMsg, 'S3: lesson plan generated despite no topic given');

    // Topic was genuinely null -> should have been auto-filled from the
    // ATP itself, so there should be nothing to mismatch against.
    const mismatchWarning = msgs.find(m => /isn't in this term's ATP/.test(m.text));
    check(!mismatchWarning, 'S3: no ATP mismatch warning when the topic was auto-filled FROM the ATP itself');

    const saved = lastGeneratedState.get(phoneHash);
    check(!!saved && !!saved.intent && !!saved.intent.topic, 'S3: generated/saved intent carries an auto-filled topic (not empty)', JSON.stringify(saved && saved.intent));
    check(!!saved && saved.intent.topic === 'Geometric constructions', 'S3: auto-filled topic matches the real current-term ATP topic for Grade 7 Mathematics', JSON.stringify(saved && saved.intent));
    check(!!saved && saved.intent.atpTopic === true, 'S3: intent.atpTopic flag set true, confirming this went through the ATP auto-fill branch, not a coincidental AI guess', JSON.stringify(saved && saved.intent));
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 3b — Confirms the natural-language fallback path (subject
  // name used as topic) correctly routes into the MISMATCH branch, not a
  // silent no-op — this is the counterpart finding to the note above.
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 3b: natural-language "no topic" phrasing (subject-as-topic fallback) ──');
  {
    const phone = '+27821177031';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash, { isPro: 0, grade: '7', subject: 'Mathematics' });

    const startIdx = sentMessages.length;
    let threw = false, thrownErr = null;
    try {
      await send(phone, 'Lesson plan Grade 7 Mathematics');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S3b: no crash in the real dispatch chain', thrownErr?.stack);

    const msgs = messagesSince(startIdx);
    const contentMsg = msgs.find(m => /LESSON PLAN/.test(m.text));
    check(!!contentMsg, 'S3b: lesson plan still generated');
    const mismatchWarning = msgs.find(m => /isn't in this term's ATP/.test(m.text));
    check(!!mismatchWarning, 'S3b: parser\'s subject-as-topic fallback ("mathematics") correctly triggers the ATP mismatch warning rather than silently passing through unchecked');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 4 — Off-term topic: ATP mismatch warning (non-blocking)
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 4: lesson plan with an off-term topic (ATP mismatch warning) ──');
  {
    const phone = '+27821177004';
    const phoneHash = hashPhone(phone);
    // "fractions" confirmed NOT in Grade 7 Mathematics' current-term ATP
    // (current term topics are geometry-related).
    insertTeacher(phoneHash, { isPro: 0, grade: '7', subject: 'Mathematics' });

    const startIdx = sentMessages.length;
    let threw = false, thrownErr = null;
    try {
      await send(phone, 'Lesson plan Grade 7 Mathematics fractions');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S4: no crash in the real dispatch chain', thrownErr?.stack);

    const msgs = messagesSince(startIdx);
    const contentMsg = msgs.find(m => /LESSON PLAN/.test(m.text));
    check(!!contentMsg, 'S4: lesson plan STILL generated despite the off-term topic (warning is non-blocking)');

    const mismatchWarning = msgs.find(m => /isn't in this term's ATP/.test(m.text));
    check(!!mismatchWarning, 'S4: ATP mismatch warning sent for an off-term topic');
    check(!!mismatchWarning && /Grade 7/.test(mismatchWarning.text), 'S4: mismatch warning correctly names the grade');

    // Ordering: warning must follow the actual content, not replace/precede it,
    // and must not block delivery.
    const contentIdx = msgs.indexOf(contentMsg);
    const warningIdx = msgs.indexOf(mismatchWarning);
    check(contentIdx !== -1 && warningIdx !== -1 && warningIdx > contentIdx, 'S4: mismatch warning delivered AFTER the lesson plan content, not blocking it');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 5 — LESSONPLAN follow-up command WITH pending intent
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 5: LESSONPLAN follow-up command with pending intent ──');
  {
    const phone = '+27821177005';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash, { isPro: 0 });

    // Seed a pendingIntentState the way an ambiguous-explanation nudge does.
    pendingIntentState.set(phoneHash, {
      intent: { topic: 'poetry', grade: 9, subject: 'english' },
      lastActivity: Date.now(),
    });

    const startIdx = sentMessages.length;
    let threw = false, thrownErr = null;
    try {
      await send(phone, 'LESSONPLAN');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S5: LESSONPLAN follow-up does not crash', thrownErr?.stack);

    const msgs = messagesSince(startIdx);
    const contentMsg = msgs.find(m => /LESSON PLAN/.test(m.text));
    check(!!contentMsg, 'S5: LESSONPLAN follow-up actually triggers real generation (not just an ack)');
    check(!pendingIntentState.get(phoneHash), 'S5: pendingIntentState cleared after being consumed');

    const saved = lastGeneratedState.get(phoneHash);
    check(!!saved && saved.intent.type === 'lessonPlan' && saved.intent.topic === 'poetry', 'S5: follow-up-generated lesson plan correctly recorded for SAVE, with the pending topic carried through', JSON.stringify(saved && saved.intent));
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 6 — Bare LESSONPLAN command with NO pending intent
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 6: bare LESSONPLAN command with no pending intent ──');
  {
    const phone = '+27821177006';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash, { isPro: 0 });

    const startIdx = sentMessages.length;
    let threw = false;
    try {
      await send(phone, 'LESSONPLAN');
    } catch (err) { threw = true; }
    check(!threw, 'S6: bare LESSONPLAN with no pending intent does not crash');
    const msgs = messagesSince(startIdx);
    const prompt = msgs.find(m => /What topic should the lesson plan cover/.test(m.text));
    check(!!prompt, 'S6: correctly asks what topic, does not attempt to generate blind');
    const contentMsg = msgs.find(m => /LESSON PLAN/.test(m.text));
    check(!contentMsg, 'S6: no generation actually occurred (no blind generation)');
  }

  console.log('\n─────────────────────────────────');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  if (failures.length) {
    console.log('\nFailed checks:');
    failures.forEach(f => console.log(`  - ${f}`));
  }
  testDb.cleanup?.();
  process.exit(failed > 0 ? 1 : 0);
})();
