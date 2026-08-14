'use strict';
// RC1 — WORKSHEET differentiation: real-handler regression test.
//
// Closes the confirmed defect found during live WORKSHEET verification:
// handleWorksheetFlow() (flows/worksheetFlow.js) was passing its own narrow
// buildWorksheetDeps() object straight into triggerGeneration(), which
// expects the full buildGenerationDeps() contract. Any of
// EASIER/HARDER/VISUAL/ORAL crashed the real handler with
// "TypeError: isAiRateLimited is not a function" before this fix.
//
// Fix: buildWorksheetDeps() now also exposes a `buildGenerationDeps`
// builder reference (not a flattened contract — same pattern already used
// by buildBlueprintAuthoringDeps() for buildAssessmentSessionDeps), and
// handleWorksheetFlow() calls triggerGeneration({ ..., deps:
// buildGenerationDeps() }), matching every other call site of
// triggerGeneration in the codebase.
//
// This test exercises the REAL dispatch chain (processMessage ->
// commandHandler -> handleWorksheetFlow -> triggerGeneration) against a
// real-migration SQLite DB, stubbing only the outbound AI and WhatsApp
// network calls.
//
// Run: node tests/rc1-worksheet-differentiation.test.js

process.env.PII_SECRET = 'test-secret-key-32-bytes-long!!';
process.env.FREE_LIMIT = '10';
process.env.APP_URL    = 'https://example.test';
process.env.PDF_SECRET = 'pdf-secret';
process.env.PRO_PRICE_ZAR = '99';

const Module = require('module');
const path = require('path');

let passed = 0;
let failed = 0;
function check(condition, label, extra) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ FAIL: ${label}${extra !== undefined ? ' -- ' + extra : ''}`); failed++; }
}

const { createTestDb } = require('./helpers/createTestDb');
const testDb = createTestDb(__filename);
const db = testDb.db;

const sentMessages = [];
const whatsappPath = path.resolve(__dirname, '../services/whatsappService');
require.cache[whatsappPath] = {
  id: whatsappPath, filename: whatsappPath, loaded: true,
  exports: {
    sendMessage: async (phone, text) => { sentMessages.push({ phone, text }); return true; },
    sendDocument: async () => true,
    downloadMedia: async () => null,
    chunkMessage: (t) => [t],
  },
};

let genCounter = 0;
const aiServicePath = path.resolve(__dirname, '../services/aiService');
require.cache[aiServicePath] = {
  id: aiServicePath, filename: aiServicePath, loaded: true,
  exports: {
    generateContent: async (prompt, intentType) => {
      if (intentType === 'classifier') throw new Error('force regex fallback for deterministic test classification');
      genCounter += 1;
      return `Worksheet content #${genCounter} — prompt length ${prompt.length}`;
    },
  },
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === './whatsappService' || request === '../services/whatsappService') return whatsappPath;
  if (request === './aiService' || request === '../services/aiService') return aiServicePath;
  return origResolve.call(this, request, ...rest);
};

function insertTeacher(phoneHash) {
  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject, is_pro) VALUES (?, ?, ?, ?, 0)`)
    .run(phoneHash, 'Test Teacher', '7', 'Mathematics');
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
    lastWorksheetState,
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

  console.log('\n── RC1 WORKSHEET differentiation: real-handler regression ──\n');

  const phone = '+27821177001';
  const phoneHash = hashPhone(phone);
  insertTeacher(phoneHash);

  // Seed with a plain generation first (real chain), exactly as a teacher would.
  await send(phone, 'worksheet on fractions grade 7');
  await wait(1800); // let both delayed nudges settle before differentiation

  const genIdOriginal = lastGeneratedState.get(phoneHash).generationId;
  const contentOriginal = lastGeneratedState.get(phoneHash).content;
  const wsContentOriginal = lastWorksheetState.get(phoneHash).content;

  // ── EASIER ──────────────────────────────────────────────────────────
  console.log('── EASIER ──');
  const startIdxEasier = sentMessages.length;
  let threw = false;
  try {
    await send(phone, 'EASIER');
  } catch (err) {
    threw = true;
    console.error('  Unexpected throw:', err.message);
  }
  check(!threw, 'EASIER: no TypeError / crash in the real handler');

  const msgsEasier = messagesSince(startIdxEasier);
  check(msgsEasier.some(m => /Worksheet content #/.test(m.text)), 'EASIER: genuinely new content delivered to the teacher', JSON.stringify(msgsEasier.map(m => m.text)));

  // By design (generationPipeline.js: `if (intent.type === 'worksheet' &&
  // !intent.differentiation)`), lastWorksheetState is only written by PLAIN
  // generations — it's the "what to regenerate on the next differentiation
  // command" pointer, not a running log, so a differentiated regeneration
  // intentionally leaves it untouched. The actual regenerated content lives
  // in lastGeneratedState (SAVE state), asserted separately below.
  const wsAfterEasier = lastWorksheetState.get(phoneHash);
  check(!!wsAfterEasier && wsAfterEasier.content === wsContentOriginal, 'EASIER: lastWorksheetState correctly left untouched by a differentiated regeneration (by design)');
  check(wsAfterEasier && wsAfterEasier.intent.topic === 'fractions', 'EASIER: lastWorksheetState retains the correct topic across differentiation');

  const genAfterEasier = lastGeneratedState.get(phoneHash);
  check(!!genAfterEasier && genAfterEasier.saveState === 'GENERATED', 'EASIER: SAVE state correctly re-enters GENERATED');
  check(genAfterEasier && genAfterEasier.generationId !== genIdOriginal, 'EASIER: new generationId minted (does not reuse the pre-differentiation id)');
  check(genAfterEasier && genAfterEasier.intent.differentiation === 'easier', 'EASIER: SAVE state carries the differentiation tag', genAfterEasier && genAfterEasier.intent.differentiation);
  check(genAfterEasier && genAfterEasier.content !== contentOriginal, 'EASIER: SAVE-state content differs from the original pre-differentiation content');

  await wait(1800);
  const msgsEasierFull = messagesSince(startIdxEasier);
  check(!msgsEasierFull.some(m => /Need different versions/i.test(m.text)), 'EASIER: "Need different versions?" nudge correctly does NOT re-fire on a differentiated regeneration');
  check(msgsEasierFull.some(m => /Reply \*SAVE\*/i.test(m.text)), 'EASIER: SAVE nudge still fires after differentiation');

  // ── HARDER (second differentiation command, chained on top of EASIER) ──
  console.log('\n── HARDER ──');
  const genIdAfterEasier = lastGeneratedState.get(phoneHash).generationId;
  const contentAfterEasier = lastGeneratedState.get(phoneHash).content;
  const startIdxHarder = sentMessages.length;
  let threwHarder = false;
  try {
    await send(phone, 'HARDER');
  } catch (err) {
    threwHarder = true;
    console.error('  Unexpected throw:', err.message);
  }
  check(!threwHarder, 'HARDER: no TypeError / crash in the real handler');

  const msgsHarder = messagesSince(startIdxHarder);
  check(msgsHarder.some(m => /Worksheet content #/.test(m.text)), 'HARDER: genuinely new content delivered to the teacher');

  const genAfterHarder = lastGeneratedState.get(phoneHash);
  check(!!genAfterHarder && genAfterHarder.saveState === 'GENERATED', 'HARDER: SAVE state correctly re-enters GENERATED');
  check(genAfterHarder && genAfterHarder.generationId !== genIdAfterEasier, 'HARDER: new generationId minted, distinct from the EASIER generation');
  check(genAfterHarder && genAfterHarder.content !== contentAfterEasier, 'HARDER: content differs from the EASIER-generation content — no stale/duplicated state');
  check(genAfterHarder && genAfterHarder.intent.differentiation === 'harder', 'HARDER: SAVE state carries the correct (harder, not easier) differentiation tag', genAfterHarder && genAfterHarder.intent.differentiation);

  const wsAfterHarder = lastWorksheetState.get(phoneHash);
  check(wsAfterHarder && wsAfterHarder.content === wsAfterEasier.content, 'HARDER: lastWorksheetState still correctly untouched (design), unchanged from before EASIER');

  // ── SAVE the HARDER version and confirm no corruption from the chain ──
  console.log('\n── SAVE after EASIER→HARDER chain ──');
  const savedBefore = db.prepare(`SELECT COUNT(*) as c FROM saved_resources WHERE phone_hash = ?`).get(phoneHash).c;
  await send(phone, 'SAVE');
  const savedAfter = db.prepare(`SELECT COUNT(*) as c FROM saved_resources WHERE phone_hash = ?`).get(phoneHash).c;
  const savedRow = db.prepare(`SELECT * FROM saved_resources WHERE phone_hash = ? ORDER BY id DESC LIMIT 1`).get(phoneHash);
  check(savedAfter === savedBefore + 1, 'SAVE: exactly one new row persisted (no duplicates from the differentiation chain)');
  check(!!savedRow && savedRow.content === genAfterHarder.content, 'SAVE: persisted content is the HARDER version — the most recent generation, not an earlier one');
  check(lastGeneratedState.get(phoneHash) === undefined, 'SAVE: state cleared after save, no leftover from the differentiation chain');

  console.log(`\n─────────────────────────────────`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`─────────────────────────────────\n`);

  Module._resolveFilename = origResolve;
  testDb.cleanup();
  process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
  console.error('UNCAUGHT ERROR IN TEST:', err);
  Module._resolveFilename = origResolve;
  testDb.cleanup();
  process.exit(1);
});
