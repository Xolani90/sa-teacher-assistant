'use strict';
// RC1 recon harness — TEST (with memo): real-dispatch coverage audit.
//
// PURPOSE: tests/test.js only exercises parseIntent()/buildPrompt() in
// isolation — it proves the AI *prompt* asks for a memorandum, but never
// proves a generated TEST reply actually contains one, that the real
// dispatch chain reaches the TEST generation path without error, or that
// the PDF-rendering boundary can handle test+memo content. This is the
// same class of gap that produced RC1-H-009 (WORKSHEET) and RC1-H-010
// (QMS) — untested dispatch chain, not a known defect.
//
// This harness exercises the REAL production path:
//   routes/webhook.js::processMessage() -> core/messageProcessor.js
//   -> core/generationPipeline.js::triggerGeneration()
//   -> services/pdfService.js::generatePdf() (REAL — not stubbed, so a
//      genuine crash or malformed test+memo render would surface here)
// Only two external network boundaries are stubbed: services/aiService.js
// (no real Anthropic call) and services/whatsappService.js (no real send).
// The AI stub returns realistic TEST+MEMORANDUM-shaped content, mirroring
// the AI's actual instructed output shape (per prompts/test.js), so the
// PDF renderer is exercised against realistic input, not a placeholder.
//
// This is diagnostic only. No production code is touched. If a defect is
// found, it is reported, not fixed, pending scope approval.
//
// Run: node tests/rc1-test-with-memo-dispatch.test.js

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

// ── Stub the AI boundary only — return realistic TEST+MEMORANDUM content ──
// Shape mirrors what prompts/test.js instructs the AI to produce: a
// *TEST PAPER* section (questions, mark allocations) followed by a
// *MEMORANDUM* section (answers). This is what actually needs to survive
// intact through triggerGeneration() -> generatePdf() for "TEST (with
// memo)" to be a genuine end-to-end capability, not just a prompt claim.
let genCounter = 0;
const aiServicePath = path.resolve(__dirname, '../services/aiService');
require.cache[aiServicePath] = {
  id: aiServicePath, filename: aiServicePath, loaded: true,
  exports: {
    generateContent: async (prompt, intentType) => {
      if (intentType === 'classifier') throw new Error('force regex fallback for deterministic test classification');
      genCounter += 1;
      return (
        `*TEST PAPER: Fractions Test #${genCounter}*\n` +
        `*Mathematics | Grade 7 | Total: ____/20*\n\n` +
        `SECTION A: Multiple Choice\n` +
        `1. What is 1/2 + 1/4? (2)\n` +
        `   A) 1/6  B) 3/4  C) 2/6  D) 1/8\n\n` +
        `SECTION B: Short Answer\n` +
        `2. Simplify 6/8 to its lowest terms. (3)\n` +
        `3. A pizza is cut into 8 slices. Thabo eats 3 slices. What fraction remains? (5)\n\n` +
        `SECTION C: Problem Solving\n` +
        `4. Explain, using a diagram, why 2/4 and 1/2 are equivalent fractions. (10)\n\n` +
        `*MEMORANDUM*\n` +
        `1. B) 3/4 (2)\n` +
        `2. 3/4 (3)\n` +
        `3. 5/8 remains (5)\n` +
        `4. Any correct diagram (e.g. a divided circle/rectangle) showing 2/4 shaded ` +
        `sections occupying the same area as 1/2 shaded, with a brief written ` +
        `explanation that dividing numerator and denominator by 2 gives an ` +
        `equivalent fraction. (10)\n`
      );
    },
  },
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === './whatsappService' || request === '../services/whatsappService') return whatsappPath;
  if (request === './aiService' || request === '../services/aiService') return aiServicePath;
  return origResolve.call(this, request, ...rest);
};

function insertTeacher(phoneHash, { isPro = 0 } = {}) {
  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject, is_pro) VALUES (?, ?, ?, ?, ?)`)
    .run(phoneHash, 'Test Teacher', '7', 'Mathematics', isPro);
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
  // pendingIntentState is not exported via __testExports (harness gap, not
  // a production defect) — reach it via buildProcessMessageDeps(), which
  // returns the same live module-level SessionStore instance used by the
  // real dispatch chain (buildCommandDeps()/buildGenerationDeps() both
  // wire the identical reference in, per routes/webhook.js).
  const pendingIntentState = require('../routes/webhook').__testExports.buildProcessMessageDeps().pendingIntentState;

  let msgCounter = 0;
  async function send(phone, body) {
    msgCounter += 1;
    await processMessage(makeMessage(phone, body, `msg-${msgCounter}`), buildProcessMessageDeps());
  }
  function messagesSince(idx) { return sentMessages.slice(idx); }
  function documentsSince(idx) { return sentDocuments.slice(idx); }

  console.log('\n── RC1 recon: TEST (with memo) real-dispatch audit ──\n');

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 1 — Natural-language TEST request, free-tier teacher (no PDF)
  // ═══════════════════════════════════════════════════════════════════
  console.log('── Scenario 1: natural-language TEST request (free tier) ──');
  {
    const phone = '+27821188001';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash, { isPro: 0 });

    const startIdx = sentMessages.length;
    let threw = false;
    let thrownErr = null;
    try {
      await send(phone, '20-mark test on fractions grade 7');
    } catch (err) {
      threw = true;
      thrownErr = err;
    }
    check(!threw, 'S1: no crash in the real dispatch chain', thrownErr?.stack);

    const msgs = messagesSince(startIdx);
    const ackMsg = msgs.find(m => /Generating your/.test(m.text));
    check(!!ackMsg, 'S1: acknowledgment message sent');

    const contentMsg = msgs.find(m => /TEST PAPER/.test(m.text));
    check(!!contentMsg, 'S1: generated content reached WhatsApp send (not silently dropped)');
    check(!!contentMsg && /MEMORANDUM/.test(contentMsg.text), 'S1: delivered content actually contains a MEMORANDUM section (not just present in the prompt)');
    check(!!contentMsg && /SECTION [AB]/.test(contentMsg.text), 'S1: delivered content contains the actual test questions');

    // Free tier — no PDF should be generated; an upsell nudge is expected instead.
    check(sentDocuments.length === 0, 'S1: free-tier teacher — no PDF document sent');
    const upsell = msgs.find(m => /Pro.*PDF|PDF.*Pro/i.test(m.text));
    check(!!upsell, 'S1: free-tier teacher — PDF upsell message sent instead');

    // last_intent / lastGeneratedState persistence for RETRY/SAVE
    const saved = lastGeneratedState.get(phoneHash);
    check(!!saved && saved.intent.type === 'test', 'S1: lastGeneratedState records intent.type === test for SAVE follow-up');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 2 — Same request, Pro teacher (PDF-eligible path)
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 2: natural-language TEST request (Pro tier, PDF path) ──');
  {
    const phone = '+27821188002';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash, { isPro: 1 });

    const startIdxMsgs = sentMessages.length;
    const startIdxDocs = sentDocuments.length;
    let threw = false;
    let thrownErr = null;
    try {
      await send(phone, '20-mark test on fractions grade 7');
    } catch (err) {
      threw = true;
      thrownErr = err;
    }
    check(!threw, 'S2: no crash in the real dispatch chain (including real generatePdf())', thrownErr?.stack);

    const msgs = messagesSince(startIdxMsgs);
    const contentMsg = msgs.find(m => /TEST PAPER/.test(m.text));
    check(!!contentMsg && /MEMORANDUM/.test(contentMsg.text), 'S2: WhatsApp text delivery contains both test and memorandum');

    const docs = documentsSince(startIdxDocs);
    check(docs.length === 1, 'S2: exactly one PDF document sent to a Pro teacher', `got ${docs.length}`);
    check(!!docs[0] && /\.pdf$/i.test(docs[0].filename || ''), 'S2: sent document has a .pdf filename', docs[0]?.filename);
    check(!!docs[0] && /PDF Download/.test(docs[0].caption || ''), 'S2: PDF caption sent as expected');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 3 — TEST disambiguation follow-up command (commandHandler.js ~L802)
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 3: TEST disambiguation follow-up command ──');
  {
    const phone = '+27821188003';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash, { isPro: 0 });

    // Seed a pendingIntentState the way an "explain X" reply's follow-up nudge does.
    pendingIntentState.set(phoneHash, {
      intent: { topic: 'fractions', grade: 7, subject: 'mathematics' },
      lastActivity: Date.now(),
    });

    const startIdx = sentMessages.length;
    let threw = false;
    let thrownErr = null;
    try {
      await send(phone, 'TEST');
    } catch (err) {
      threw = true;
      thrownErr = err;
    }
    check(!threw, 'S3: TEST disambiguation follow-up does not crash', thrownErr?.stack);

    const msgs = messagesSince(startIdx);
    const contentMsg = msgs.find(m => /TEST PAPER/.test(m.text));
    check(!!contentMsg, 'S3: TEST follow-up actually triggers real generation (not just an ack)');
    check(!!contentMsg && /MEMORANDUM/.test(contentMsg.text), 'S3: TEST follow-up generated content includes a memorandum');
    check(!pendingIntentState.get(phoneHash), 'S3: pendingIntentState cleared after being consumed');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 4 — TEST disambiguation follow-up with NO pending intent
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 4: bare TEST command with no pending intent ──');
  {
    const phone = '+27821188004';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash, { isPro: 0 });

    const startIdx = sentMessages.length;
    let threw = false;
    try {
      await send(phone, 'TEST');
    } catch (err) {
      threw = true;
    }
    check(!threw, 'S4: bare TEST with no pending intent does not crash');
    const msgs = messagesSince(startIdx);
    const prompt = msgs.find(m => /What topic should the test cover/.test(m.text));
    check(!!prompt, 'S4: correctly asks what topic, does not attempt to generate blind');
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
