'use strict';
// Mental Maths — real-dispatch coverage audit.
//
// PURPOSE: proves the real chain (WhatsApp input -> processMessage() ->
// classification/menu dispatch -> generationPipeline grade-gate ->
// mentalMathsService -> AI wording call -> delivery -> SAVE) behaves
// correctly end to end, for both the main-menu entry point
// (flows/mainMenuFlow.js "Mental Maths (Grades 7-9)") and natural-language
// entry (utils/intentParser.js). Mirrors the scaffolding proven in
// tests/rc1-atp-dispatch.test.js exactly (module-cache stubbing,
// classifier-forces-regex-fallback pattern, onboarding table seeding) —
// deviating from that would risk exactly the class of dispatch-order bug
// this repo's RC1-H notes warn about.
//
// Scope:
//   1. Menu dispatch, teacher profile grade 8 (supported) -> full delivery
//   2. Menu dispatch, no profile grade set -> grade-gate fires, no AI call
//   3. Menu dispatch, unsupported profile grade (4) -> grade-gate fires
//   4. Natural-language "mental maths grade 9" (no menu) -> same result
//   5. SAVE persists resource_type = mentalMaths
//
// Only the AI boundary (services/aiService.js) and WhatsApp send
// (services/whatsappService.js) are stubbed. Everything else — DB,
// classifier regex fallback, mainMenuFlow, generationPipeline,
// mentalMathsService, teacherWorkspaceService — is real.
//
// Run: node tests/rc1-mentalmaths-dispatch.test.js

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

// ── Stub WhatsApp send only ─────────────────────────────────────────────
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

// ── Stub the AI boundary ────────────────────────────────────────────────
// intentType === 'classifier' MUST throw — this is what forces the real
// classifier to fall back to intentParser's regex path (same pattern as
// every other rc1-*-dispatch test), which is what actually exercises the
// new "mental maths" regex branch for Scenario 4's natural-language input.
// Without this, the classifier stub would return nonsense to the AI
// classifier and scenario 4 would test nothing real.
let aiCallCount = 0;
let lastPrompt = null;
const aiServicePath = path.resolve(__dirname, '../services/aiService');
require.cache[aiServicePath] = {
  id: aiServicePath, filename: aiServicePath, loaded: true,
  exports: {
    generateContent: async (prompt, intentType) => {
      if (intentType === 'classifier') throw new Error('force regex fallback for deterministic test classification');
      aiCallCount++;
      lastPrompt = prompt;
      return `*Mental Maths Session*\n\n(stubbed AI wording wrapper around already-correct content)`;
    },
  },
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === './whatsappService' || request === '../services/whatsappService') return whatsappPath;
  if (request === './aiService' || request === '../services/aiService') return aiServicePath;
  return origResolve.call(this, request, ...rest);
};

function insertTeacher(phoneHash, { grade = null, subject = 'mathematics' } = {}) {
  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject, is_pro) VALUES (?, ?, ?, ?, ?)`)
    .run(phoneHash, 'Test Teacher', grade != null ? String(grade) : null, subject, 0);
  db.prepare(`
    INSERT INTO onboarding (phone_hash, step, updated_at)
    VALUES (?, 'done', datetime('now'))
    ON CONFLICT(phone_hash) DO UPDATE SET step = 'done'
  `).run(phoneHash);
}

(async () => {
  const {
    hashPhone,
    processMessage,
    buildProcessMessageDeps,
  } = require('../routes/webhook').__testExports;

  async function send(from, text) {
    sentMessages.length = 0;
    aiCallCount = 0;
    await processMessage(
      { from, id: `msg-${Date.now()}-${Math.random()}`, type: 'text', text: { body: text } },
      buildProcessMessageDeps()
    );
  }

  console.log('\n── Mental Maths: main-menu + natural-language dispatch audit ──\n');

  // ── Scenario 1: supported profile grade (8), via the Create menu ──────
  console.log('── Scenario 1: menu dispatch, profile grade 8 (supported) ──');
  {
    const from = '27821110001';
    insertTeacher(hashPhone(from), { grade: 8 });

    await send(from, 'MENU');
    check(sentMessages.length === 1, 'S1: main menu sent');

    await send(from, '1'); // "Create a resource"
    check(sentMessages[0]?.text.includes('create'), 'S1: create sub-menu opened');

    await send(from, '6'); // "Mental Maths (Grades 7-9)"
    check(aiCallCount === 1, 'S1: exactly one AI wording call made', `got ${aiCallCount}`);
    check(sentMessages.some(m => /mental maths/i.test(m.text)), 'S1: content mentions Mental Maths', JSON.stringify(sentMessages.map(m => m.text)));
    check(!sentMessages.some(m => /CAPS-aligned/i.test(m.text)), 'S1: no "CAPS-aligned" wording used for Mental Maths');
    check(!!lastPrompt && lastPrompt.includes('ALREADY-CORRECT'), 'S1: prompt asserts content is already-correct (presentation-only contract)');
  }

  // ── Scenario 2: no profile grade set ───────────────────────────────────
  console.log('\n── Scenario 2: menu dispatch, no profile grade ──');
  {
    const from = '27821110002';
    insertTeacher(hashPhone(from), { grade: null });

    await send(from, 'MENU');
    await send(from, '1');
    await send(from, '6');

    check(aiCallCount === 0, 'S2: AI never invoked when grade is missing', `got ${aiCallCount}`);
    check(sentMessages.some(m => /Grades? 7-9/.test(m.text)), 'S2: gate message names the supported grade range', JSON.stringify(sentMessages.map(m => m.text)));
    check(sentMessages.some(m => /\n\n/.test(m.text)), 'S2: gate message contains a real line break, not a literal backslash-n');
  }

  // ── Scenario 3: unsupported profile grade (4) ──────────────────────────
  console.log('\n── Scenario 3: menu dispatch, unsupported profile grade (4) ──');
  {
    const from = '27821110003';
    insertTeacher(hashPhone(from), { grade: 4 });

    await send(from, 'MENU');
    await send(from, '1');
    await send(from, '6');

    check(aiCallCount === 0, 'S3: AI never invoked for an out-of-range grade', `got ${aiCallCount}`);
    check(sentMessages.some(m => /Grade 4/.test(m.text)), 'S3: gate message names the actual unsupported grade', JSON.stringify(sentMessages.map(m => m.text)));
  }

  // ── Scenario 4: natural-language entry, bypassing the menu entirely ────
  console.log('\n── Scenario 4: natural-language "mental maths grade 9" (no menu) ──');
  {
    const from = '27821110004';
    insertTeacher(hashPhone(from), { grade: null }); // profile grade irrelevant — message specifies it

    await send(from, 'mental maths grade 9');

    check(aiCallCount === 1, 'S4: natural-language request reaches generation directly', `got ${aiCallCount}`);
    check(sentMessages.some(m => /mental maths/i.test(m.text)), 'S4: Mental Maths content delivered');
  }

  // ── Scenario 5: SAVE follow-up works for mentalMaths like other types ──
  console.log('\n── Scenario 5: SAVE persists a Mental Maths session ──');
  {
    const from = '27821110005';
    insertTeacher(hashPhone(from), { grade: 7 });
    await send(from, 'mental maths grade 7');
    check(aiCallCount === 1, 'S5: generation happened before SAVE', `got ${aiCallCount}`);

    await send(from, 'SAVE');
    const row = db.prepare(`SELECT resource_type FROM saved_resources ORDER BY id DESC LIMIT 1`).get();
    check(!!row && row.resource_type === 'mentalMaths', 'S5: SAVE persisted resource_type=mentalMaths', JSON.stringify(row));
  }

  console.log('\n─────────────────────────────────');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('─────────────────────────────────\n');

  if (failed > 0) process.exitCode = 1;
})().catch((err) => {
  console.error('UNCAUGHT ERROR IN TEST:', err);
  process.exitCode = 1;
});
