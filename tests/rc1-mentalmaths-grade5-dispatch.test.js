'use strict';
// Mental Maths Grade 5 — real-dispatch integration coverage (Stage 2).
//
// PURPOSE: proves the Grade 5 (C12/C13) integration wired into
// core/generationPipeline.js + flows/mainMenuFlow.js actually works
// through the real chain (WhatsApp input -> processMessage() ->
// classification/menu dispatch -> generationPipeline grade-gate ->
// mentalMathsGrade5Service -> AI wording call -> delivery -> SAVE),
// and that the existing Senior Phase path (Grades 7-9,
// mentalMathsService.js) is completely unaffected by the new branch.
// Deliberately structured as a sibling file to
// tests/rc1-mentalmaths-dispatch.test.js rather than an edit to it —
// that file is Stage-1-adjacent frozen evidence for the Senior Phase
// path; this file is new evidence for the new Grade 5 branch only.
//
// Scope:
//   1. Menu dispatch, profile grade 5 (new, supported) -> full delivery,
//      via mentalMathsGrade5Service (prompt contains a C13-shaped
//      "× ... therefore ... ÷" paired sentence)
//   2. Natural-language "mental maths grade 5" (no menu) -> same result
//   3. Menu dispatch, profile grade 8 (Senior Phase, unaffected) ->
//      full delivery, via mentalMathsService (no C12/C13-shaped
//      sentence appears)
//   4. Menu dispatch, unsupported profile grade (6) -> grade-gate
//      fires, no AI call, message names BOTH ranges (Grade 5 and
//      Grades 7-9), not just the old 7-9 range
//   5. SAVE persists resource_type = mentalMaths after a Grade 5 session
//
// Only the AI boundary (services/aiService.js) and WhatsApp send
// (services/whatsappService.js) are stubbed. Everything else — DB,
// classifier regex fallback, mainMenuFlow, generationPipeline,
// mentalMathsGrade5Service, mentalMathsService, teacherWorkspaceService
// — is real.
//
// Run: node tests/rc1-mentalmaths-grade5-dispatch.test.js
// (requires `npm install` in the repo root — same environment
// dependency as tests/rc1-mentalmaths-dispatch.test.js; this file does
// not introduce any new one)

process.env.PII_SECRET = 'test-secret-key-32-bytes-long!!';
process.env.FREE_LIMIT = '10';
process.env.APP_URL    = 'https://example.test';
process.env.PDF_SECRET = 'pdf-secret';
process.env.PRO_PRICE_ZAR = '99';

const path = require('path');

let passed = 0;
let failed = 0;
function check(condition, label, extra) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else {
    console.error(`  ❌ FAIL: ${label}${extra !== undefined ? ' -- ' + extra : ''}`);
    failed++;
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
// intentType === 'classifier' MUST throw, forcing the real classifier to
// fall back to intentParser's regex path — same pattern as every other
// rc1-*-dispatch test (see tests/rc1-mentalmaths-dispatch.test.js).
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

const Module = require('module');
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

  console.log('\n── Mental Maths Grade 5: dispatch integration audit (Stage 2) ──\n');

  // ── Scenario 1: menu dispatch, profile grade 5 (new, supported) ──
  console.log('── Scenario 1: menu dispatch, profile grade 5 (new, supported) ──');
  {
    const from = '27821110051';
    insertTeacher(hashPhone(from), { grade: 5 });

    await send(from, 'MENU');
    await send(from, '1'); // "Create a resource"
    await send(from, '6'); // "Mental Maths (Grade 5, 7-9)"

    check(aiCallCount === 1, 'S1: exactly one AI wording call made', `got ${aiCallCount}`);
    check(!!lastPrompt && lastPrompt.includes('Grade 5'), 'S1: prompt references Grade 5');
    check(!!lastPrompt && /□\s*=\s*\d+\s*÷\s*\d+/.test(lastPrompt), 'S1: prompt contains a C13-shaped paired multiplication/division sentence');
    check(sentMessages.some(m => /mental maths/i.test(m.text)), 'S1: content mentions Mental Maths', JSON.stringify(sentMessages.map(m => m.text)));
  }

  // ── Scenario 2: natural-language "mental maths grade 5" ──
  console.log('\n── Scenario 2: natural-language "mental maths grade 5" (no menu) ──');
  {
    const from = '27821110052';
    insertTeacher(hashPhone(from), { grade: null }); // profile grade irrelevant — message specifies it

    await send(from, 'mental maths grade 5');

    check(aiCallCount === 1, 'S2: natural-language request reaches generation directly', `got ${aiCallCount}`);
    check(!!lastPrompt && lastPrompt.includes('Grade 5'), 'S2: prompt references Grade 5');
  }

  // ── Scenario 3: menu dispatch, profile grade 8 (Senior Phase, unaffected) ──
  console.log('\n── Scenario 3: menu dispatch, profile grade 8 (Senior Phase, unaffected) ──');
  {
    const from = '27821110053';
    insertTeacher(hashPhone(from), { grade: 8 });

    await send(from, 'MENU');
    await send(from, '1');
    await send(from, '6');

    check(aiCallCount === 1, 'S3: exactly one AI wording call made', `got ${aiCallCount}`);
    check(!!lastPrompt && lastPrompt.includes('Grade 8'), 'S3: prompt references Grade 8');
    check(!!lastPrompt && !/□\s*=\s*\d+\s*÷\s*\d+/.test(lastPrompt), 'S3: prompt contains NO C13-shaped sentence (Senior Phase strands only, generator untouched)');
    check(sentMessages.some(m => /mental maths/i.test(m.text)), 'S3: Senior Phase content still delivered', JSON.stringify(sentMessages.map(m => m.text)));
  }

  // ── Scenario 4: unsupported profile grade (6) — grade-gate fires ──
  console.log('\n── Scenario 4: menu dispatch, unsupported profile grade (6) ──');
  {
    const from = '27821110054';
    insertTeacher(hashPhone(from), { grade: 6 });

    await send(from, 'MENU');
    await send(from, '1');
    await send(from, '6');

    check(aiCallCount === 0, 'S4: AI never invoked for an out-of-range grade', `got ${aiCallCount}`);
    check(sentMessages.some(m => /Grade 5/.test(m.text) && /Grades? 7-9/.test(m.text)), 'S4: gate message names BOTH the Grade 5 and 7-9 ranges (not just the old range)', JSON.stringify(sentMessages.map(m => m.text)));
    check(sentMessages.some(m => /Grade 6 isn't in that range/.test(m.text)), 'S4: gate message names the actual unsupported grade', JSON.stringify(sentMessages.map(m => m.text)));
  }

  // ── Scenario 5: SAVE persists resource_type=mentalMaths for Grade 5 ──
  console.log('\n── Scenario 5: SAVE persists a Grade 5 Mental Maths session ──');
  {
    const from = '27821110055';
    insertTeacher(hashPhone(from), { grade: 5 });
    await send(from, 'mental maths grade 5');
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
