'use strict';
// Mental Maths — resilience regression coverage for two specific defects.
//
// T1: an AI wording/generation failure must NOT discard an already-computed
//     deterministic session. Mental Maths questions and canonicalAnswers are
//     produced in code before the AI is ever called; the AI only supplies
//     wording. Before the fix, core/generationPipeline.js's
//     `if (!content) return` bailed out on any AI error, so an AI outage sent
//     the teacher "Something went wrong on my end" while a complete, correct
//     session sat in memory one line away.
//
// T2: the Mental Maths wizard must not consume one AI-burst rate-limit slot
//     per menu step. isAiRateLimited() is check-AND-record
//     (utils/webhookHelpers.js: 5 slots / 60s), and the wizard re-enters
//     triggerGeneration() four times (Create->Mental Maths, grade, topic,
//     delivery) while making exactly ONE AI call. Before the fix a single
//     session burned 4 of 5 slots, so a teacher was throttled — and told they
//     were "sending requests too quickly" — for tapping menu options.
//
// Both are verified through the real chain (processMessage -> mainMenuFlow ->
// generationPipeline -> mentalMathsSessionService -> the real generators ->
// delivery). Only the AI boundary and WhatsApp send are stubbed. Control
// cases assert that NON-Mental-Maths types keep their original behaviour
// exactly, since both fixes are deliberately scoped to Mental Maths only.
//
// Run: node tests/rc1-mentalmaths-resilience.test.js

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

// ── Stub the AI boundary, with per-scenario control ─────────────────────
// intentType === 'classifier' ALWAYS throws, forcing the real classifier to
// fall back to intentParser's regex path (the established pattern in every
// rc1-*-dispatch test). `aiBehaviour` controls only the CONTENT call, which
// is what T1 needs to fail on demand.
let aiBehaviour = 'ok';   // 'ok' | 'throw'
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
      if (aiBehaviour === 'throw') throw new Error('simulated AI provider outage');
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

// Counts real limiter/quota rows, so these tests assert against the same
// tables production reads — not against a reimplementation.
function aiSlotsUsed(phoneHash) {
  return db.prepare(
    `SELECT COUNT(*) AS c FROM rate_limit_events WHERE phone_hash = ? AND limiter_type = 'ai'`
  ).get(phoneHash).c;
}
function usageRows(phoneHash) {
  return db.prepare(`SELECT COUNT(*) AS c FROM usage_events WHERE phone_hash = ?`).get(phoneHash).c;
}
function fillAiSlots(phoneHash, n) {
  for (let i = 0; i < n; i++) {
    db.prepare(`INSERT INTO rate_limit_events (phone_hash, limiter_type) VALUES (?, 'ai')`).run(phoneHash);
  }
}

const APOLOGY = /Something went wrong on my end/i;
const THROTTLE = /sending requests too quickly/i;
const C12_SHAPE = /□\s*=\s*\d+\s*[-+]\s*\d+/;

(async () => {
  const {
    hashPhone,
    processMessage,
    buildProcessMessageDeps,
  } = require('../routes/webhook').__testExports;

  async function send(from, text) {
    sentMessages.length = 0;
    aiCallCount = 0;
    lastPrompt = null;
    await processMessage(
      { from, id: `msg-${Date.now()}-${Math.random()}`, type: 'text', text: { body: text } },
      buildProcessMessageDeps()
    );
  }
  const allText = () => sentMessages.map(m => m.text).join('\n');

  console.log('\n── Mental Maths resilience: T1 (AI-failure fallback) + T2 (rate limiter) ──\n');

  // ════════════════════════════════════════════════════════════════════
  // T1
  // ════════════════════════════════════════════════════════════════════
  console.log('── T1-A: AI outage still delivers the full deterministic session ──');
  {
    const from = '27821110071';
    const hash = hashPhone(from);
    insertTeacher(hash, { grade: 5 });

    aiBehaviour = 'ok';
    // "written" in the message answers the delivery step, so the topic reply
    // is the last step before generation.
    await send(from, 'grade 5 mental maths, 8 questions, written');
    check(aiCallCount === 0, 'T1-A: setup — topic menu opens without an AI call', `got ${aiCallCount}`);

    aiBehaviour = 'throw';
    await send(from, '3'); // topic: Mixed — both

    const out = allText();
    check(aiCallCount === 1, 'T1-A: the AI wording call was attempted (and failed)', `got ${aiCallCount}`);
    check(!APOLOGY.test(out), 'T1-A: the teacher is NOT told "Something went wrong"', out.slice(0, 200));
    check(/Mental Maths — Grade 5/.test(out), 'T1-A: a real Mental Maths session was delivered', out.slice(0, 200));
    check(/\*Answers\*/.test(out), 'T1-A: the deterministic answer key was delivered', out.slice(0, 200));
    check(C12_SHAPE.test(out), 'T1-A: delivered content carries real generated questions', out.slice(0, 300));

    // The answer key is numbered 1..count, so this proves the FULL session
    // survived the outage, not a truncated fragment.
    check(/\n8\. /.test(out), 'T1-A: all 8 answers are present', out.slice(-160));
    check(!/\n9\. /.test(out), 'T1-A: exactly 8 answers, no more', out.slice(-160));

    // Quota must stay consumed: the teacher received complete content, so
    // there is nothing to roll back.
    check(usageRows(hash) === 1, 'T1-A: quota stays consumed (content was delivered)', `usage rows: ${usageRows(hash)}`);
  }

  console.log('\n── T1-B: control — a non-Mental-Maths type still apologises and refunds ──');
  {
    const from = '27821110072';
    const hash = hashPhone(from);
    insertTeacher(hash, { grade: 5 });

    aiBehaviour = 'throw';
    await send(from, 'worksheet on fractions for grade 5');

    const out = allText();
    check(aiCallCount === 1, 'T1-B: the AI call was attempted', `got ${aiCallCount}`);
    check(APOLOGY.test(out), 'T1-B: worksheet AI failure still sends the apology (unchanged)', out.slice(0, 200));
    check(usageRows(hash) === 0, 'T1-B: worksheet quota is still rolled back (unchanged)', `usage rows: ${usageRows(hash)}`);
    check(!/\*Answers\*/.test(out), 'T1-B: no Mental Maths fallback leaks into other types', out.slice(0, 200));
  }

  console.log('\n── T1-C: AI outage on a Senior Phase grade behaves identically ──');
  {
    const from = '27821110073';
    const hash = hashPhone(from);
    insertTeacher(hash, { grade: 7 });

    aiBehaviour = 'ok';
    await send(from, 'grade 7 mental maths, oral');
    check(aiCallCount === 0, 'T1-C: setup — topic menu opens', `got ${aiCallCount}`);

    aiBehaviour = 'throw';
    await send(from, '1'); // first authorized G7 topic

    const out = allText();
    check(!APOLOGY.test(out), 'T1-C: no apology for Grade 7 either', out.slice(0, 200));
    check(/Mental Maths — Grade 7/.test(out), 'T1-C: Grade 7 session delivered despite the outage', out.slice(0, 200));
    check(/\*Answers\*/.test(out), 'T1-C: Grade 7 answer key delivered', out.slice(0, 200));
    check(usageRows(hash) === 1, 'T1-C: quota stays consumed', `usage rows: ${usageRows(hash)}`);
  }

  // ════════════════════════════════════════════════════════════════════
  // T2
  // ════════════════════════════════════════════════════════════════════
  console.log('\n── T2-A: the full four-step wizard consumes exactly ONE ai slot ──');
  {
    const from = '27821110074';
    const hash = hashPhone(from);
    insertTeacher(hash, { grade: 6 }); // no generator -> grade menu, the longest path
    aiBehaviour = 'ok';

    await send(from, 'MENU');
    await send(from, '1'); // Create a resource
    await send(from, '6'); // Mental Maths -> grade menu
    check(aiSlotsUsed(hash) === 0, 'T2-A: opening the grade menu consumes no ai slot', `slots: ${aiSlotsUsed(hash)}`);

    await send(from, '1'); // grade: Grade 5 -> topic menu
    check(aiSlotsUsed(hash) === 0, 'T2-A: choosing a grade consumes no ai slot', `slots: ${aiSlotsUsed(hash)}`);

    await send(from, '1'); // topic: Addition & Subtraction -> delivery menu
    check(aiSlotsUsed(hash) === 0, 'T2-A: choosing a topic consumes no ai slot', `slots: ${aiSlotsUsed(hash)}`);

    await send(from, '1'); // delivery: Oral -> generate
    check(aiCallCount === 1, 'T2-A: exactly one AI call for the session', `got ${aiCallCount}`);
    check(aiSlotsUsed(hash) === 1, 'T2-A: exactly ONE ai slot consumed for the whole wizard (was 4)', `slots: ${aiSlotsUsed(hash)}`);
    check(!THROTTLE.test(allText()), 'T2-A: the teacher is never throttled while navigating', allText().slice(0, 200));
  }

  console.log('\n── T2-B: two full wizards in one window both complete (was impossible) ──');
  {
    const from = '27821110075';
    const hash = hashPhone(from);
    insertTeacher(hash, { grade: 5 });
    aiBehaviour = 'ok';

    let generations = 0;
    for (let round = 1; round <= 2; round++) {
      await send(from, 'MENU');
      await send(from, '1');
      await send(from, '6'); // Mental Maths -> grade menu (profile grade is not used here)
      await send(from, '5'); // grade: Grade 5
      await send(from, '1'); // topic
      await send(from, '1'); // delivery: Oral -> generate
      generations += aiCallCount;
      check(!THROTTLE.test(allText()), `T2-B: wizard ${round} completes without a throttle message`, allText().slice(0, 160));
    }
    check(generations === 2, 'T2-B: both sessions generated', `got ${generations}`);
    check(aiSlotsUsed(hash) === 2, 'T2-B: 2 ai slots for 2 sessions (8 steps would have exceeded the limit of 5)', `slots: ${aiSlotsUsed(hash)}`);
  }

  console.log('\n── T2-C: the limiter still fires for Mental Maths at generation ──');
  {
    const from = '27821110076';
    const hash = hashPhone(from);
    insertTeacher(hash, { grade: 5 });
    aiBehaviour = 'ok';

    await send(from, 'grade 5 mental maths, written'); // -> topic menu, no ai slot
    check(aiSlotsUsed(hash) === 0, 'T2-C: setup — no slot used yet', `slots: ${aiSlotsUsed(hash)}`);

    fillAiSlots(hash, 5); // teacher is now at the limit
    await send(from, '3'); // topic: Mixed -> would generate

    const out = allText();
    check(THROTTLE.test(out), 'T2-C: a genuinely over-limit teacher IS throttled', out.slice(0, 200));
    check(aiCallCount === 0, 'T2-C: no AI call is made when throttled', `got ${aiCallCount}`);
    check(usageRows(hash) === 0, 'T2-C: a throttled request costs no quota', `usage rows: ${usageRows(hash)}`);
    check(!/\*Answers\*/.test(out), 'T2-C: no session is delivered when throttled', out.slice(0, 200));
  }

  console.log('\n── T2-D: control — non-Mental-Maths throttling is unchanged ──');
  {
    const from = '27821110077';
    const hash = hashPhone(from);
    insertTeacher(hash, { grade: 5 });
    aiBehaviour = 'ok';

    fillAiSlots(hash, 5);
    await send(from, 'worksheet on fractions for grade 5');

    const out = allText();
    check(THROTTLE.test(out), 'T2-D: worksheet is still throttled at the top of the pipeline', out.slice(0, 200));
    check(aiCallCount === 0, 'T2-D: no AI call for a throttled worksheet', `got ${aiCallCount}`);
    check(usageRows(hash) === 0, 'T2-D: throttled worksheet costs no quota', `usage rows: ${usageRows(hash)}`);
  }

  console.log('\n─────────────────────────────────');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('─────────────────────────────────\n');

  // process.exit(), not process.exitCode: utils/sessionStore.js and
  // utils/deduplication.js both install a module-load setInterval that is
  // never unref'd, so a process.exitCode-only ending hangs this file forever
  // (and with it tests/run-all.js, whose spawnSync has no timeout). Every
  // other rc1-*-dispatch test ends with an explicit process.exit() for the
  // same reason.
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error('UNCAUGHT ERROR IN TEST:', err);
  process.exit(1);
});
