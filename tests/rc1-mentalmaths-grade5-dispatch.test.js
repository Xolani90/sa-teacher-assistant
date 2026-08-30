'use strict';
// Mental Maths Grade 5 — real-dispatch integration coverage.
//
// PURPOSE: proves the Grade 5 (C12/C13) integration wired into
// core/generationPipeline.js + flows/mainMenuFlow.js actually works
// through the real chain (WhatsApp input -> processMessage() ->
// classification/menu dispatch -> generationPipeline session wizard ->
// mentalMathsSessionService -> mentalMathsGrade5Service -> AI wording call
// -> deterministic answer key -> delivery -> SAVE), and that the Senior
// Phase path (mentalMathsService.js authorized families) is unaffected by
// the Grade 5 branch.
//
// UPDATED for the all-grades session wizard: Mental Maths now resolves
// grade -> topic -> delivery mode for EVERY supported grade before
// generating, so Grade 5 no longer generates immediately on menu entry.
// The prior version of this file asserted immediate generation for Grade 5
// (S1/S2/S5) and a "Grade 5 and Grades 7-9" gate message (S4). Both were
// expectations about the older single-step flow, not regressions:
//   - Grade 5 now gets the same topic choice every other grade gets (its
//     two frozen candidates C12/C13, plus Mixed = the previous behaviour).
//   - The gate message no longer claims Grade 9 is available. Grade 9 has
//     no authorized family under the Senior Phase policy and never had a
//     generation path, so advertising it was simply wrong.
// The frozen Grade 5 C12/C13 GENERATION POLICY is untouched by all of
// this — see tests/mentalMathsGrade5Service.test.js for that coverage,
// and the C12/C13 item-shape assertions below.
//
// Scope:
//   1. Menu dispatch, profile grade 5 -> topic menu -> delivery menu ->
//      full delivery, with a C12-shaped paired addition/subtraction
//      sentence (topic option 1)
//   2. Natural-language "mental maths grade 5" -> same wizard, C13 topic
//      (option 2) -> C13-shaped paired multiplication/division sentence
//   3. Menu dispatch, profile grade 8 (Senior Phase) -> unaffected; no
//      C12/C13-shaped sentence anywhere
//   4. Unsupported profile grade (6) -> grade menu offering only grades
//      that genuinely have an authorized generator; no AI call
//   5. SAVE persists resource_type = mentalMaths, with a real title
//      (previously every session saved as "Untitled")
//   6. MY RESOURCES retrieves and lists that saved session
//   7. A teacher who states count and delivery in their own wording
//      ("20 questions, written") is not asked again and gets exactly 20
//   8. The full four-step wizard, entered from the grade menu: a profile
//      grade with no generator -> grade -> topic -> delivery -> generate
//   9. Backing out of the grade step abandons the request completely
//  10. A Grade R teacher (grade 0) is told "Grade R", not "Grade 0"
//
// Only the AI boundary (services/aiService.js) and WhatsApp send
// (services/whatsappService.js) are stubbed. Everything else — DB,
// classifier regex fallback, mainMenuFlow, generationPipeline,
// mentalMathsSessionService, mentalMathsGrade5Service, mentalMathsService,
// teacherWorkspaceService — is real.
//
// Run: node tests/rc1-mentalmaths-grade5-dispatch.test.js

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

// C12 = "a ± b = □ therefore □ = c ∓ d"; C13 = "a × b = □ therefore □ = c ÷ d".
// Both are the frozen Block B paired forms — matching on the paired-sentence
// shape is what proves the Grade 5 generator (and not the Senior Phase one)
// produced the content.
const C12_SHAPE = /□\s*=\s*\d+\s*[-+]\s*\d+/;
const C13_SHAPE = /□\s*=\s*\d+\s*÷\s*\d+/;

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

  const allText = () => sentMessages.map(m => m.text).join('\n');

  console.log('\n── Mental Maths Grade 5: dispatch integration audit ──\n');

  // ── Scenario 1: menu dispatch, profile grade 5, C12 topic ──
  console.log('── Scenario 1: menu dispatch, profile grade 5, topic C12 ──');
  {
    const from = '27821110051';
    insertTeacher(hashPhone(from), { grade: 5 });

    await send(from, 'MENU');
    await send(from, '1'); // "Create a resource"
    await send(from, '6'); // "Mental Maths"

    check(aiCallCount === 0, 'S1: topic menu opens without generating', `got ${aiCallCount}`);
    check(/Grade 5 Mental Maths/.test(allText()), 'S1: Grade 5 topic menu is shown', allText());
    check(/Addition & Subtraction/.test(allText()) && /Mixed/.test(allText()),
      'S1: Grade 5 topic menu offers its own frozen candidates, not Senior Phase families', allText());
    check(!/Powers & Roots|Ratio & Sharing/.test(allText()),
      'S1: no Senior Phase family leaks into the Grade 5 topic menu', allText());

    await send(from, '1'); // topic: Addition & Subtraction (C12)
    check(aiCallCount === 0, 'S1: delivery menu opens without generating', `got ${aiCallCount}`);
    check(/Oral/i.test(allText()) && /Written/i.test(allText()), 'S1: delivery menu offers oral and written', allText());
    check(!/Support|Core|Extension/i.test(allText()), 'S1: no difficulty step is offered (unauthorized for every grade)', allText());

    await send(from, '1'); // delivery: Oral
    check(aiCallCount === 1, 'S1: exactly one AI wording call made', `got ${aiCallCount}`);
    check(!!lastPrompt && lastPrompt.includes('Grade 5'), 'S1: prompt references Grade 5');
    check(!!lastPrompt && C12_SHAPE.test(lastPrompt), 'S1: prompt contains a C12-shaped paired addition/subtraction sentence');
    check(!!lastPrompt && !C13_SHAPE.test(lastPrompt), 'S1: C12-only topic contains no C13 division sentence');
    check(/mental maths/i.test(allText()), 'S1: content mentions Mental Maths', allText());
    check(/\*Answers\*/.test(allText()), 'S1: delivered content carries the deterministic answer key', allText());
  }

  // ── Scenario 2: natural-language "mental maths grade 5", C13 topic ──
  console.log('\n── Scenario 2: natural-language "mental maths grade 5", topic C13 ──');
  {
    const from = '27821110052';
    insertTeacher(hashPhone(from), { grade: null }); // profile grade irrelevant — message specifies it

    await send(from, 'mental maths grade 5');
    check(aiCallCount === 0, 'S2: natural-language request reaches the topic step', `got ${aiCallCount}`);
    check(/Grade 5 Mental Maths/.test(allText()), 'S2: grade came from the message, not the (empty) profile', allText());

    await send(from, '2'); // topic: Multiplication & Division (C13)
    await send(from, '1'); // delivery: Oral
    check(aiCallCount === 1, 'S2: natural-language request reaches generation', `got ${aiCallCount}`);
    check(!!lastPrompt && lastPrompt.includes('Grade 5'), 'S2: prompt references Grade 5');
    check(!!lastPrompt && C13_SHAPE.test(lastPrompt), 'S2: prompt contains a C13-shaped paired multiplication/division sentence');
  }

  // ── Scenario 3: menu dispatch, profile grade 8 (Senior Phase, unaffected) ──
  console.log('\n── Scenario 3: menu dispatch, profile grade 8 (Senior Phase, unaffected) ──');
  {
    const from = '27821110053';
    insertTeacher(hashPhone(from), { grade: 8 });

    await send(from, 'MENU');
    await send(from, '1');
    await send(from, '6');

    check(aiCallCount === 0, 'S3: topic menu opens without generating for G8', `got ${aiCallCount}`);
    check(/Grade 8 Mental Maths/i.test(allText()), 'S3: G8 topic menu is shown', allText());

    await send(from, '1'); // topic: first authorized G8 family (mulDivFluency)
    await send(from, '1'); // delivery: Oral
    check(aiCallCount === 1, 'S3: exactly one AI wording call after the wizard', `got ${aiCallCount}`);
    check(!!lastPrompt && lastPrompt.includes('Grade 8'), 'S3: prompt references Grade 8');
    check(!!lastPrompt && !C13_SHAPE.test(lastPrompt) && !C12_SHAPE.test(lastPrompt),
      'S3: prompt contains NO C12/C13-shaped sentence (Grade 5 branch never reached)');
    check(/mental maths/i.test(allText()), 'S3: Senior Phase content still delivered', allText());
  }

  // ── Scenario 4: unsupported profile grade (6) — grade menu, no generation ──
  console.log('\n── Scenario 4: menu dispatch, unsupported profile grade (6) ──');
  {
    const from = '27821110054';
    insertTeacher(hashPhone(from), { grade: 6 });

    await send(from, 'MENU');
    await send(from, '1');
    await send(from, '6');

    check(aiCallCount === 0, 'S4: AI never invoked for an out-of-range grade', `got ${aiCallCount}`);
    check(/Grade 6/.test(allText()), 'S4: message names the actual unsupported grade', allText());
    check(/1\. Grade 5/.test(allText()) && /Grade 7/.test(allText()) && /Grade 8/.test(allText()),
      'S4: grade menu offers every grade that has an authorized generator', allText());
    check(!/Grade 9/.test(allText()),
      'S4: Grade 9 is NOT offered — it has no authorized family and no generation path', allText());
  }

  // ── Scenario 5: SAVE persists a Grade 5 Mental Maths session ──
  console.log('\n── Scenario 5: SAVE persists a Grade 5 Mental Maths session ──');
  {
    const from = '27821110055';
    insertTeacher(hashPhone(from), { grade: 5 });
    await send(from, 'mental maths grade 5');
    await send(from, '3'); // topic: Mixed — both
    await send(from, '2'); // delivery: Written
    check(aiCallCount === 1, 'S5: generation happened before SAVE', `got ${aiCallCount}`);

    await send(from, 'SAVE');
    const row = db.prepare(`SELECT resource_type, title, grade, content FROM saved_resources ORDER BY id DESC LIMIT 1`).get();
    check(!!row && row.resource_type === 'mentalMaths', 'S5: SAVE persisted resource_type=mentalMaths', JSON.stringify(row && row.resource_type));
    check(!!row && !/Untitled/.test(row.title), 'S5: saved session has a real title, not "Untitled"', row && row.title);
    check(!!row && String(row.grade) === '5', 'S5: saved session carries grade 5', row && String(row.grade));
    check(!!row && /\*Answers\*/.test(row.content), 'S5: saved content includes the answer key', row && row.content.slice(0, 120));
  }

  // ── Scenario 6: MY RESOURCES retrieves the saved Mental Maths session ──
  // Saving is proved by S5; this proves the other half of the requirement —
  // that a saved session is actually retrievable and readable afterwards,
  // rather than only present in the table.
  console.log('\n── Scenario 6: MY RESOURCES lists the saved session ──');
  {
    const from = '27821110055'; // same teacher as S5, whose session is saved
    await send(from, 'MY RESOURCES');
    const listing = allText();
    check(/My Resources/i.test(listing), 'S6: the resource listing is returned', listing);
    check(/Mental Maths session/i.test(listing),
      'S6: the Mental Maths session is listed under a readable type label', listing);
    check(/Mixed/.test(listing), 'S6: the listing shows the chosen topic in the title', listing);
    check(/Gr 5/.test(listing), 'S6: the listing shows the grade', listing);
    check(!/Untitled/.test(listing), 'S6: nothing lists as "Untitled"', listing);
  }

  // ── Scenario 7: teacher states count and delivery in the message ──
  // A teacher who already said "20 questions, written" must not be asked
  // the delivery question again, and must get exactly 20 questions.
  console.log('\n── Scenario 7: count and delivery taken from the teacher\'s own wording ──');
  {
    const from = '27821110056';
    insertTeacher(hashPhone(from), { grade: 5 });

    await send(from, 'grade 5 mental maths, 20 questions, written');
    check(aiCallCount === 0, 'S7: still asks which topic (never invented)', `got ${aiCallCount}`);
    check(/Grade 5 Mental Maths/.test(allText()), 'S7: topic menu is shown', allText());

    await send(from, '3'); // topic: Mixed — both
    check(aiCallCount === 1, 'S7: delivery step SKIPPED — generates straight after the topic', `got ${aiCallCount}`);
    check(!/How will learners do it/i.test(allText()),
      'S7: the delivery menu is not shown for a teacher who already said "written"', allText());

    const delivered = allText();
    check(/Written/.test(delivered), 'S7: delivered session is framed as written', delivered);
    check(/20 questions/.test(delivered), 'S7: delivered session states 20 questions', delivered);
    // The answer key is numbered 1..count, so its last line proves the real
    // generated length rather than the header text.
    check(/\n20\. /.test(delivered), 'S7: answer key runs to 20 items', delivered.slice(-200));
    check(!/\n21\. /.test(delivered), 'S7: answer key stops at 20 items', delivered.slice(-200));
    check(C12_SHAPE.test(delivered) && C13_SHAPE.test(delivered),
      'S7: Mixed topic delivered both frozen candidates', delivered);
  }

  // ── Scenario 8: full four-step wizard from the grade menu ──
  // S4 proves the grade menu is SHOWN for a grade with no generator; this
  // proves the reply is actually consumed and carries through the remaining
  // two steps. Without this, a teacher whose profile grade has no Mental
  // Maths could reach a menu they can't get past.
  console.log('\n── Scenario 8: grade menu -> topic -> delivery -> generate ──');
  {
    const from = '27821110057';
    insertTeacher(hashPhone(from), { grade: 6 }); // no generator for Grade 6

    await send(from, 'MENU');
    await send(from, '1');
    await send(from, '6');
    check(aiCallCount === 0, 'S8: grade menu opens without generating', `got ${aiCallCount}`);
    check(/1\. Grade 5/.test(allText()), 'S8: Grade 5 is the first grade offered', allText());

    await send(from, '1'); // grade: Grade 5
    check(aiCallCount === 0, 'S8: picking a grade advances to the topic step, not generation', `got ${aiCallCount}`);
    check(/Grade 5 Mental Maths/.test(allText()),
      'S8: the grade chosen from the menu is the grade carried forward', allText());
    check(/Addition & Subtraction/.test(allText()),
      'S8: topic options are the chosen grade\'s own, not the profile grade\'s', allText());

    await send(from, '1'); // topic: Addition & Subtraction (C12)
    check(aiCallCount === 0, 'S8: advances to the delivery step', `got ${aiCallCount}`);

    await send(from, '1'); // delivery: Oral
    check(aiCallCount === 1, 'S8: the four-step wizard generates exactly once', `got ${aiCallCount}`);
    check(!!lastPrompt && lastPrompt.includes('Grade 5'),
      'S8: generation used the menu-chosen Grade 5, not the profile Grade 6');
    check(!!lastPrompt && C12_SHAPE.test(lastPrompt), 'S8: real C12 content was generated');
    check(/\*Answers\*/.test(allText()), 'S8: delivered content carries the answer key', allText());
  }

  // ── Scenario 9: Back out of the grade menu abandons the request ──
  console.log('\n── Scenario 9: Back from the grade step clears pending state ──');
  {
    const from = '27821110058';
    insertTeacher(hashPhone(from), { grade: 6 });

    await send(from, 'MENU');
    await send(from, '1');
    await send(from, '6'); // grade menu is open
    await send(from, '0'); // Back to main menu
    check(aiCallCount === 0, 'S9: Back from the grade step generates nothing', `got ${aiCallCount}`);

    await send(from, '1'); // a stray digit afterwards must not resume the request
    check(aiCallCount === 0, 'S9: a stray digit does not resurrect the abandoned request', `got ${aiCallCount}`);
  }

  // ── Scenario 10: Grade R is named correctly, not "Grade 0" ──
  // Grade R is represented as 0 (utils/capsPhase.js), and
  // capsPhase.parseGrade maps "grade R" in a message to 0, so a Foundation
  // Phase teacher genuinely reaches the unavailable-grade message. It must
  // name their grade, not print "Grade 0".
  console.log('\n── Scenario 10: Grade R teacher gets a correctly-named message ──');
  {
    const from = '27821110059';
    insertTeacher(hashPhone(from), { grade: 0 });

    await send(from, 'grade R mental maths');
    const out = allText();
    check(aiCallCount === 0, 'S10: no generation for Grade R (no Foundation Phase generator)', `got ${aiCallCount}`);
    check(/Grade R/.test(out), 'S10: the message names Grade R', out);
    check(!/Grade 0/.test(out), 'S10: the message never says "Grade 0"', out);
    check(/1\. Grade 5/.test(out), 'S10: the grades that do work are offered instead', out);
  }

  console.log('\n─────────────────────────────────');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('─────────────────────────────────\n');

  // process.exit(), not process.exitCode: utils/sessionStore.js and
  // utils/deduplication.js both install a module-load setInterval that is
  // never unref'd, so the event loop never drains and a process.exitCode-only
  // ending hangs this file forever — which in turn hangs tests/run-all.js
  // (spawnSync has no timeout). Every other rc1-*-dispatch test already ends
  // with an explicit process.exit() for exactly this reason.
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error('UNCAUGHT ERROR IN TEST:', err);
  process.exit(1);
});
