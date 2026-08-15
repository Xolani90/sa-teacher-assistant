'use strict';
// RC1 recon harness — EXPLANATION: real-dispatch coverage audit.
//
// PURPOSE: tests/test.js "TEST 2" only exercises parseIntent()/buildPrompt()
// in isolation — it proves parseIntent() classifies 'explanation' correctly
// and that the prompt text contains the word "Explanation", but never proves
// a generated explanation actually reaches the user, that the disambiguation
// follow-up (WORKSHEET/TEST/LESSONPLAN nudge) fires, or that EXPLANATION is
// genuinely excluded from PDF/SAVE/ATP-grounding at the real dispatch
// boundary. Same class of untested-dispatch-chain gap as WORKSHEET (RC1-H-009),
// QMS (RC1-H-010), and TEST (rc1-test-with-memo-dispatch.test.js).
//
// This harness exercises the REAL production path:
//   routes/webhook.js::processMessage() -> core/messageProcessor.js
//   -> core/generationPipeline.js::triggerGeneration()
// Only two external boundaries are stubbed: services/aiService.js (no real
// Anthropic call) and services/whatsappService.js (no real send). The AI
// stub returns realistic explanation-shaped prose (not a placeholder), so
// delivery is exercised against realistic content.
//
// Negative behavior (no PDF, no SAVE, no ATP warning) is verified at the
// appropriate boundary — by asserting the real generatePdf() implementation
// is never invoked and no document is sent — rather than merely grepping
// delivered text for absent strings.
//
// This is diagnostic only. No production code is touched. If a defect is
// found, it is reported, not fixed, pending scope approval.
//
// Run: node tests/rc1-explanation-dispatch.test.js

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

// ── Stub the AI boundary only — realistic explanation prose, no PDF shape ──
let genCounter = 0;
let pdfCalls = 0;
const aiServicePath = path.resolve(__dirname, '../services/aiService');
require.cache[aiServicePath] = {
  id: aiServicePath, filename: aiServicePath, loaded: true,
  exports: {
    generateContent: async (prompt, intentType) => {
      if (intentType === 'classifier') throw new Error('force regex fallback for deterministic test classification');
      genCounter += 1;
      return (
        `*Explanation: Photosynthesis*\n\n` +
        `Photosynthesis is the process plants use to turn sunlight, water, ` +
        `and carbon dioxide into glucose (food) and oxygen. It happens mainly ` +
        `in the leaves, inside structures called chloroplasts, which contain ` +
        `a green pigment called chlorophyll.\n\n` +
        `*Simple way to remember it:*\n` +
        `Sunlight + Water + CO2 -> Glucose + Oxygen\n\n` +
        `This is important for Grade 8 learners because it explains where ` +
        `plants get their energy and why they release oxygen into the air. ` +
        `(Generation #${genCounter})`
      );
    },
  },
};

// generatePdf is NOT stubbed away — instead we wrap the real module's export
// to count invocations, so "no PDF" is verified at the boundary (was the
// real render function ever called), not just by scanning delivered text.
const pdfServicePath = path.resolve(__dirname, '../services/pdfService');
const realPdfService = require(pdfServicePath);
const wrappedPdfService = Object.create(realPdfService);
if (typeof realPdfService.generatePdf === 'function') {
  wrappedPdfService.generatePdf = async (...args) => {
    pdfCalls += 1;
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

function insertTeacher(phoneHash, { isPro = 0 } = {}) {
  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject, is_pro) VALUES (?, ?, ?, ?, ?)`)
    .run(phoneHash, 'Test Teacher', '8', 'Natural Sciences', isPro);
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

  console.log('\n── RC1 recon: EXPLANATION real-dispatch audit ──\n');

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 1 — Explicit "explain X" natural-language request (Pro tier)
  // ═══════════════════════════════════════════════════════════════════
  console.log('── Scenario 1: explicit "Explain photosynthesis Grade 8" request ──');
  {
    const phone = '+27821199001';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash, { isPro: 1 }); // Pro tier — worst case for a PDF/SAVE leak

    const startIdxMsgs = sentMessages.length;
    const startIdxDocs = sentDocuments.length;
    const pdfCallsBefore = pdfCalls;
    let threw = false;
    let thrownErr = null;
    try {
      await send(phone, 'Explain photosynthesis Grade 8');
    } catch (err) {
      threw = true;
      thrownErr = err;
    }
    check(!threw, 'S1: no crash in the real dispatch chain', thrownErr?.stack);

    const msgs = messagesSince(startIdxMsgs);
    const ackMsg = msgs.find(m => /Generating your/.test(m.text));
    check(!!ackMsg, 'S1: acknowledgment message sent');

    const contentMsg = msgs.find(m => /Explanation: Photosynthesis/.test(m.text));
    check(!!contentMsg, 'S1: generated explanation actually reached WhatsApp send (not silently dropped)');
    check(!!contentMsg && /chlorophyll/.test(contentMsg.text), 'S1: delivered content contains real generated prose, not a placeholder');

    // Negative behavior, verified at the boundary.
    check(pdfCalls === pdfCallsBefore, 'S1: real generatePdf() implementation never invoked (Pro tier)', `calls delta=${pdfCalls - pdfCallsBefore}`);
    check(documentsSince(startIdxDocs).length === 0, 'S1: no PDF document sent, even though teacher is Pro');
    const pdfUpsell = msgs.find(m => /Pro.*PDF|PDF.*Pro/i.test(m.text));
    check(!pdfUpsell, 'S1: no PDF upsell nudge either (type is simply not PDF-eligible, not "PDF withheld")');

    // last_intent / SAVE exclusion
    const saved = lastGeneratedState.get(phoneHash);
    check(!saved, 'S1: explanation NOT recorded in lastGeneratedState (excluded from SAVE follow-up)', JSON.stringify(saved));

    // Explicit keyword present -> disambiguation nudge should NOT fire.
    await wait(1300);
    const laterMsgs = messagesSince(startIdxMsgs);
    const nudge = laterMsgs.find(m => /Would you also like/.test(m.text));
    check(!nudge, 'S1: no disambiguation nudge for an explicit "explain" request');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 2 — Ambiguous request (no explicit explanation keyword):
  // classified as explanation, triggers delayed disambiguation nudge.
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 2: ambiguous request classified as explanation ──');
  {
    const phone = '+27821199002';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash, { isPro: 0 });

    const startIdx = sentMessages.length;
    let threw = false;
    let thrownErr = null;
    try {
      // Afrikaans classification branch ("verduidelik"/"wat is") sets
      // type=explanation via a DIFFERENT regex than the English explicit-
      // keyword list hasExplicitExplanationKeyword() checks against — so
      // this is genuinely ambiguous from the disambiguation gate's point
      // of view, even though the classifier is confident.
      await send(phone, 'Wat is fotosintese Graad 8');
    } catch (err) {
      threw = true;
      thrownErr = err;
    }
    check(!threw, 'S2: no crash in the real dispatch chain', thrownErr?.stack);

    const immediateMsgs = messagesSince(startIdx);
    const contentMsg = immediateMsgs.find(m => /Explanation: Photosynthesis/.test(m.text));
    check(!!contentMsg, 'S2: content still generated and delivered for the ambiguous request');

    const nudgeBefore = immediateMsgs.find(m => /Would you also like/.test(m.text));
    check(!nudgeBefore, 'S2: disambiguation nudge has NOT fired yet (still within the 1s delay)');

    await wait(1300);
    const laterMsgs = messagesSince(startIdx);
    const nudge = laterMsgs.find(m => /Would you also like/.test(m.text));
    check(!!nudge, 'S2: delayed disambiguation nudge fires after ~1s');
    check(!!nudge && /Reply WORKSHEET/.test(nudge.text), 'S2: nudge offers WORKSHEET');
    check(!!nudge && /Reply TEST/.test(nudge.text), 'S2: nudge offers TEST');
    check(!!nudge && /Reply LESSONPLAN/.test(nudge.text), 'S2: nudge offers LESSONPLAN');

    const pending = pendingIntentState.get(phoneHash);
    check(!!pending && !!pending.intent, 'S2: pendingIntentState seeded with intent for the follow-up bridge', JSON.stringify(pending));
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
