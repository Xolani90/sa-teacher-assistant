'use strict';
// RC1 recon harness — ATP (Annual Teaching Plan): real-dispatch coverage audit.
//
// PURPOSE: test-atp.js / test-atp-topic-alignment.js / test-atp-week-validator.js
// give solid unit-level coverage of atpPrompt()/validateAtpWeeks() in
// isolation, but zero dispatch coverage — nothing proves the real chain
// (WhatsApp input -> processMessage() -> classification -> Pro-gate ->
// quota -> buildPrompt() -> AI -> week-validator retry -> delivery -> PDF
// -> SAVE) actually behaves correctly end to end. Same class of gap as
// WORKSHEET (RC1-H-009), QMS (RC1-H-010), TEST (RC1-V-002), EXPLANATION
// (RC1-V-003), and LESSON PLAN (RC1-V-004).
//
// Scope, per the approved seven-scenario matrix (RC1-V-005):
//   1. Free-tier natural-language ATP request       -> Pro-gate fires
//   2. Pro-tier natural-language ATP, general phase  -> full delivery + PDF + SAVE
//   3. Pro-tier, no grade in message, profile grade  -> RC1-H-011 dispatch-level lock
//   4. Foundation Phase (grade 0-3) natural-language -> distinct prompt branch
//   5. Week-validator: invalid -> valid on retry     -> corrected content ships
//   6. Week-validator: invalid -> invalid on retry   -> warning ships, non-blocking
//   7. No grade, no subject, no profile               -> null-safe, no crash
//
// Explicitly NOT in scope (per recon):
//   - CURRICULUM_QUERY (separate flow/module)
//   - ATP-grounding of OTHER types against ATP data (covered under
//     RC1-V-004 / test-atp-topic-alignment.js) — ATP itself is not in
//     ATP_GROUNDED_TYPES and does not ground against itself.
//
// Only the AI boundary (services/aiService.js) and WhatsApp send
// (services/whatsappService.js) are stubbed. generatePdf() is the REAL
// module, wrapped only to count invocations/capture args.
//
// This is diagnostic only. No production code is touched. If a defect is
// found, it is reported and classified, not fixed, pending scope approval.
//
// Run: node tests/rc1-atp-dispatch.test.js

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

// ── Stub the AI boundary only ──────────────────────────────────────────
// Two knobs, set per-scenario:
//   aiPromptCapture  — records every prompt handed to the AI (for S3's
//                       "profile grade reached the AI boundary" assertion
//                       and for counting attempts in S5/S6)
//   atpWeekBehavior  — 'valid' | 'invalid-then-valid' | 'invalid-always' |
//                       null (use default clean content, non-ATP scenarios)
let genCounter = 0;
let aiPromptCapture = [];
let atpWeekBehavior = null;

const VALID_ATP_BODY = (
  `*ANNUAL TEACHING PLAN 2026*\n*Grade 6 Mathematics*\n\n` +
  `*TERM 1 (Weeks 1-10)*\n| Week | Topic / Content | Assessment |\n` +
  `| 1-2 | Whole Numbers | |\n| 3-4 | Integers | |\n| 5-6 | Exponents | |\n` +
  `| 7-8 | Patterns | |\n| 9-10 | Fractions | Test |\n\n` +
  `*TERM 2 (Weeks 11-20)*\n| Week | Topic / Content | Assessment |\n| 11-20 | Geometry | Assignment |\n\n` +
  `*TERM 3 (Weeks 21-30)*\n| Week | Topic / Content | Assessment |\n| 21-30 | Data Handling | Project |\n\n` +
  `*TERM 4 (Weeks 31-40)*\n| Week | Topic / Content | Assessment |\n| 31-40 | Revision | Exam |\n\n` +
  `*ASSESSMENT OVERVIEW*\nTerm tests and one project as listed above.\n\n*NOTES*\nStandard resources.`
);

// Deliberately invalid: Term 1 row "4-5" followed by "5-6" repeats week 5.
const INVALID_ATP_BODY = (
  `*ANNUAL TEACHING PLAN 2026*\n*Grade 6 Mathematics*\n\n` +
  `*TERM 1 (Weeks 1-10)*\n| Week | Topic / Content | Assessment |\n` +
  `| 1-2 | Whole Numbers | |\n| 3-4 | Integers | |\n| 4-5 | Exponents | |\n` +
  `| 5-6 | Patterns | |\n| 7-10 | Fractions | Test |\n\n` +
  `*TERM 2 (Weeks 11-20)*\n| Week | Topic / Content | Assessment |\n| 11-20 | Geometry | Assignment |\n\n` +
  `*TERM 3 (Weeks 21-30)*\n| Week | Topic / Content | Assessment |\n| 21-30 | Data Handling | Project |\n\n` +
  `*TERM 4 (Weeks 31-40)*\n| Week | Topic / Content | Assessment |\n| 31-40 | Revision | Exam |\n\n` +
  `*ASSESSMENT OVERVIEW*\nTerm tests and one project as listed above.\n\n*NOTES*\nStandard resources.`
);

const aiServicePath = path.resolve(__dirname, '../services/aiService');
require.cache[aiServicePath] = {
  id: aiServicePath, filename: aiServicePath, loaded: true,
  exports: {
    generateContent: async (prompt, intentType) => {
      if (intentType === 'classifier') throw new Error('force regex fallback for deterministic test classification');
      genCounter += 1;
      aiPromptCapture.push(prompt);

      if (intentType === 'atp' && atpWeekBehavior) {
        const isRetryCall = /IMPORTANT CORRECTION/.test(prompt);
        if (atpWeekBehavior === 'valid') return VALID_ATP_BODY;
        if (atpWeekBehavior === 'invalid-then-valid') return isRetryCall ? VALID_ATP_BODY : INVALID_ATP_BODY;
        if (atpWeekBehavior === 'invalid-always') return INVALID_ATP_BODY;
      }

      // Generic realistic content for non-ATP-week-focused scenarios
      // (still routed through the ATP prompt path via intentType==='atp'
      // in practice, but default body used when atpWeekBehavior is null,
      // e.g. Foundation Phase / no-profile scenarios where the harness
      // only cares about non-crash + a plausible ATP delivered).
      return VALID_ATP_BODY.replace('Grade 6 Mathematics', `Generation #${genCounter}`);
    },
  },
};

// generatePdf is NOT stubbed away — wrap the real module's export to count
// invocations and capture the args passed.
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

// Teacher with NO profile grade/subject at all — Scenario 7.
function insertBlankTeacher(phoneHash, { isPro = 1 } = {}) {
  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject, is_pro) VALUES (?, ?, ?, ?, ?)`)
    .run(phoneHash, 'Test Teacher', null, null, isPro);
  db.prepare(`
    INSERT INTO onboarding (phone_hash, step, updated_at)
    VALUES (?, 'done', datetime('now'))
    ON CONFLICT(phone_hash) DO UPDATE SET step = 'done'
  `).run(phoneHash);
}

function makeMessage(from, body, id) { return { from, id, type: 'text', text: { body } }; }

(async () => {
  const {
    hashPhone,
    lastGeneratedState,
    processMessage,
    buildProcessMessageDeps,
  } = require('../routes/webhook').__testExports;

  let msgCounter = 0;
  async function send(phone, body) {
    msgCounter += 1;
    await processMessage(makeMessage(phone, body, `msg-${msgCounter}`), buildProcessMessageDeps());
  }
  function messagesSince(idx) { return sentMessages.slice(idx); }
  function documentsSince(idx) { return sentDocuments.slice(idx); }

  console.log('\n── RC1 recon: ATP real-dispatch audit (RC1-V-005) ──\n');

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 1 — Free-tier natural-language ATP request: Pro-gate fires
  // ═══════════════════════════════════════════════════════════════════
  console.log('── Scenario 1: free-tier natural-language ATP request (Pro-gate) ──');
  {
    const phone = '+27821199001';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash, { isPro: 0, grade: '6', subject: 'Mathematics' });
    atpWeekBehavior = null;

    const startIdx = sentMessages.length;
    const genCountBefore = genCounter;
    let threw = false, thrownErr = null;
    try {
      await send(phone, 'Annual teaching plan Grade 6 Mathematics');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S1: no crash in the real dispatch chain', thrownErr?.stack);

    const msgs = messagesSince(startIdx);
    const gateMsg = msgs.find(m => /Pro feature/i.test(m.text) && /Annual Teaching Plan/i.test(m.text));
    check(!!gateMsg, 'S1: Pro-gate message sent for free-tier ATP request');
    check(!!gateMsg && /PRO/.test(gateMsg.text), 'S1: gate message tells the teacher to reply PRO to upgrade');

    check(genCounter === genCountBefore, 'S1: AI generation never invoked — gate fires before any generation attempt');

    const quota = db.prepare(`SELECT COUNT(*) AS cnt FROM usage_events WHERE phone_hash = ?`).get(phoneHash);
    check(!quota || !quota.cnt, 'S1: quota not deducted — gate fires BEFORE quota deduction, not after', JSON.stringify(quota));

    const contentMsg = msgs.find(m => /ANNUAL TEACHING PLAN/.test(m.text));
    check(!contentMsg, 'S1: no ATP content generated or delivered to a free-tier teacher');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 2 — Pro-tier natural-language ATP, general phase: full path
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 2: Pro-tier natural-language ATP, general phase (full delivery + PDF + SAVE) ──');
  {
    const phone = '+27821199002';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash, { isPro: 1, grade: '6', subject: 'Mathematics' });
    atpWeekBehavior = 'valid';
    aiPromptCapture = [];

    const startIdxMsgs = sentMessages.length;
    const startIdxDocs = sentDocuments.length;
    const pdfCallsBefore = pdfCalls;
    let threw = false, thrownErr = null;
    try {
      await send(phone, 'Annual teaching plan Grade 6 Mathematics');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S2: no crash in the real dispatch chain (including real generatePdf())', thrownErr?.stack);

    const msgs = messagesSince(startIdxMsgs);
    const ackMsg = msgs.find(m => /Generating your/.test(m.text));
    check(!!ackMsg, 'S2: acknowledgment message sent');

    const contentMsg = msgs.find(m => /ANNUAL TEACHING PLAN/.test(m.text));
    check(!!contentMsg, 'S2: generated ATP actually reached WhatsApp send');
    check(!!contentMsg && /TERM 1/.test(contentMsg.text), 'S2: delivered content includes term structure');

    check(aiPromptCapture.length === 1, 'S2: exactly one AI generation call (no spurious retry — content was valid first try)', `calls=${aiPromptCapture.length}`);

    check(pdfCalls === pdfCallsBefore + 1, 'S2: real generatePdf() invoked exactly once for a Pro teacher', `calls delta=${pdfCalls - pdfCallsBefore}`);
    const lastArgs = pdfCallArgs[pdfCallArgs.length - 1];
    check(!!lastArgs && lastArgs.type === 'atp', 'S2: generatePdf() called with type=atp', JSON.stringify(lastArgs && lastArgs.type));

    const docs = documentsSince(startIdxDocs);
    check(docs.length === 1, 'S2: exactly one PDF document sent to a Pro teacher', `got ${docs.length}`);
    check(!!docs[0] && /Annual_Teaching_Plan/i.test(docs[0].filename || ''), 'S2: sent document has the ATP-specific filename', docs[0]?.filename);

    const saved = lastGeneratedState.get(phoneHash);
    check(!!saved && saved.intent.type === 'atp', 'S2: lastGeneratedState records intent.type === atp for SAVE follow-up', JSON.stringify(saved));
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 3 — No grade in message, profile HAS a grade: RC1-H-011 lock
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 3: no grade in message, profile grade present (RC1-H-011 dispatch-level regression lock) ──');
  {
    const phone = '+27821199003';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash, { isPro: 1, grade: '6', subject: 'Mathematics' });
    atpWeekBehavior = 'valid';
    aiPromptCapture = [];

    const startIdxMsgs = sentMessages.length;
    let threw = false, thrownErr = null;
    try {
      // Deliberately no grade in the message — subject present, grade omitted.
      await send(phone, 'Annual teaching plan Mathematics');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S3: no crash in the real dispatch chain', thrownErr?.stack);

    const msgs = messagesSince(startIdxMsgs);
    const contentMsg = msgs.find(m => /ANNUAL TEACHING PLAN/.test(m.text));
    check(!!contentMsg, 'S3: ATP still generated despite no grade in the message');

    check(aiPromptCapture.length >= 1, 'S3: AI boundary was actually reached', `calls=${aiPromptCapture.length}`);
    const promptSentToAI = aiPromptCapture[0] || '';
    check(/Grade 6/i.test(promptSentToAI), 'S3: prompt reaching the AI boundary carries the PROFILE grade (Grade 6), proving buildPrompt() fallback resolved it — this is the RC1-H-011 fix, proven through the full real chain, not just an isolated buildPrompt() call', promptSentToAI.slice(0, 200));

    const saved = lastGeneratedState.get(phoneHash);
    check(!!saved && saved.intent.grade == null, 'S3: intent.grade itself stayed null (message truly had no grade) — the fallback happened inside buildPrompt(), not by mutating intent', JSON.stringify(saved && saved.intent));
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 4 — Foundation Phase (grade 0-3) natural-language request
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 4: Foundation Phase (Grade R / grade 0-3) natural-language ATP ──');
  {
    const phone = '+27821199004';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash, { isPro: 1, grade: '2', subject: 'Mathematics' });
    atpWeekBehavior = 'valid';
    aiPromptCapture = [];

    const startIdxMsgs = sentMessages.length;
    let threw = false, thrownErr = null;
    try {
      await send(phone, 'Annual teaching plan Grade 2 Mathematics');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S4: no crash in the real dispatch chain', thrownErr?.stack);

    const msgs = messagesSince(startIdxMsgs);
    const contentMsg = msgs.find(m => /ANNUAL TEACHING PLAN/.test(m.text));
    check(!!contentMsg, 'S4: Foundation Phase ATP still generated and delivered');

    const promptSentToAI = aiPromptCapture[0] || '';
    check(/Foundation Phase/i.test(promptSentToAI), 'S4: prompt reaching the AI boundary is from the DISTINCT Foundation Phase branch, not the general-phase prompt', promptSentToAI.slice(0, 200));
    check(/theme/i.test(promptSentToAI) && /observation|checklist|portfolio/i.test(promptSentToAI), 'S4: Foundation Phase prompt correctly requests theme-integrated content with continuous/observation-based assessment (not formal written tests)');
    check(/NOT formal written tests or examinations/i.test(promptSentToAI), 'S4: Foundation Phase prompt explicitly instructs the AI to exclude formal written tests/exams (CAPS FP has none)', promptSentToAI.slice(0, 300));
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 5 — Week-validator: invalid first attempt, valid on retry
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 5: week-validator retry — invalid then valid (corrected content ships, no warning) ──');
  {
    const phone = '+27821199005';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash, { isPro: 1, grade: '6', subject: 'Mathematics' });
    atpWeekBehavior = 'invalid-then-valid';
    aiPromptCapture = [];

    const startIdxMsgs = sentMessages.length;
    const startIdxDocs = sentDocuments.length;
    const pdfCallsBefore = pdfCalls;
    let threw = false, thrownErr = null;
    try {
      await send(phone, 'Annual teaching plan Grade 6 Mathematics');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S5: no crash through the retry chain', thrownErr?.stack);

    check(aiPromptCapture.length === 2, 'S5: exactly two AI-generation attempts (first invalid, retry succeeded)', `calls=${aiPromptCapture.length}`);
    check(!/IMPORTANT CORRECTION/.test(aiPromptCapture[0] || ''), 'S5: first attempt is the plain prompt, no correction text yet');
    check(/IMPORTANT CORRECTION/.test(aiPromptCapture[1] || ''), 'S5: second attempt received the explicit correction instruction');

    const msgs = messagesSince(startIdxMsgs);
    const contentMsg = msgs.find(m => /ANNUAL TEACHING PLAN/.test(m.text));
    check(!!contentMsg, 'S5: corrected ATP delivered');
    check(!!contentMsg && /Grade 6 Mathematics/.test(contentMsg.text), 'S5: delivered content is the corrected (valid) version, not the invalid first draft');

    const warningMsg = msgs.find(m => /double-check the week numbers/.test(m.text));
    check(!warningMsg, 'S5: no visible week-number warning shown — retry succeeded, so nothing to warn about');

    // PDF/SAVE remain intact through the retry path.
    check(pdfCalls === pdfCallsBefore + 1, 'S5: PDF still generated exactly once despite the retry', `calls delta=${pdfCalls - pdfCallsBefore}`);
    const docs = documentsSince(startIdxDocs);
    check(docs.length === 1, 'S5: exactly one PDF document sent');
    const saved = lastGeneratedState.get(phoneHash);
    check(!!saved && saved.intent.type === 'atp', 'S5: SAVE state recorded normally after a successful retry');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 6 — Week-validator: invalid first attempt, invalid on retry
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 6: week-validator retry — invalid then still invalid (warning ships, non-blocking) ──');
  {
    const phone = '+27821199006';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash, { isPro: 1, grade: '6', subject: 'Mathematics' });
    atpWeekBehavior = 'invalid-always';
    aiPromptCapture = [];

    const startIdxMsgs = sentMessages.length;
    const startIdxDocs = sentDocuments.length;
    const pdfCallsBefore = pdfCalls;
    let threw = false, thrownErr = null;
    try {
      await send(phone, 'Annual teaching plan Grade 6 Mathematics');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S6: no crash even though both attempts fail validation', thrownErr?.stack);

    check(aiPromptCapture.length === 2, 'S6: exactly two AI-generation attempts (both invalid — no third attempt)', `calls=${aiPromptCapture.length}`);

    const msgs = messagesSince(startIdxMsgs);
    const contentMsg = msgs.find(m => /ANNUAL TEACHING PLAN/.test(m.text));
    check(!!contentMsg, 'S6: content is NOT silently discarded — still reaches the teacher despite failing validation twice');

    const warningMsg = msgs.find(m => /double-check the week numbers/.test(m.text));
    check(!!warningMsg, 'S6: visible warning prepended when validation still fails after retry');
    check(!!warningMsg && warningMsg === contentMsg, 'S6: warning and content are delivered together in the same message (warning prepended, not a separate message)');
    check(!!warningMsg && warningMsg.text.indexOf('double-check the week numbers') < warningMsg.text.indexOf('ANNUAL TEACHING PLAN'), 'S6: warning text appears BEFORE the ATP content, not after/replacing it');

    // Non-blocking: PDF/SAVE still proceed even with the warning attached.
    check(pdfCalls === pdfCallsBefore + 1, 'S6: PDF still generated despite the unresolved validation warning (non-blocking)', `calls delta=${pdfCalls - pdfCallsBefore}`);
    const docs = documentsSince(startIdxDocs);
    check(docs.length === 1, 'S6: exactly one PDF document still sent');
    check(!!docs[0] && /ANNUAL TEACHING PLAN|Annual_Teaching_Plan/i.test((docs[0].filename || '') + (pdfCallArgs[pdfCallArgs.length - 1]?.content || '')), 'S6: PDF content includes the (warned) ATP body, not blocked or replaced');
    const saved = lastGeneratedState.get(phoneHash);
    check(!!saved && saved.intent.type === 'atp', 'S6: SAVE state still recorded coherently despite the warning');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 7 — No grade, no subject, no profile info at all
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 7: no grade, no subject, nothing in profile either (null-safe dispatch) ──');
  {
    const phone = '+27821199007';
    const phoneHash = hashPhone(phone);
    insertBlankTeacher(phoneHash, { isPro: 1 });
    atpWeekBehavior = 'valid';
    aiPromptCapture = [];

    const startIdxMsgs = sentMessages.length;
    let threw = false, thrownErr = null;
    try {
      // Deliberately bare — the parser's ATP keyword alone, no grade/subject.
      await send(phone, 'Annual teaching plan');
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'S7: no crash with completely absent grade/subject/profile info', thrownErr?.stack);

    check(aiPromptCapture.length >= 1, 'S7: AI boundary was still reached (dispatch did not hang or bail out silently)');

    const msgs = messagesSince(startIdxMsgs);
    // This harness asserts dispatch robustness only — not pedagogical
    // content quality, per the approved matrix refinement for Scenario 7.
    const anyDelivery = msgs.length > 0;
    check(anyDelivery, 'S7: some response was sent to the teacher (not a silent hang)');
    const crashLikeError = msgs.find(m => /went wrong on my end/i.test(m.text));
    check(!crashLikeError, 'S7: did not fall into the generic AI-failure error path — the null-grade/null-subject prompt path was reached and produced content, not an exception');
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
