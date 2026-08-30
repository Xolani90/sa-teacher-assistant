'use strict';
// Mental Maths — real-dispatch coverage audit (Senior Phase focus).
//
// PURPOSE: proves the real chain (WhatsApp input -> processMessage() ->
// menu/classification dispatch -> generationPipeline session wizard ->
// mentalMathsFamilyPendingState round-trip -> mentalMathsSessionService ->
// mentalMathsService generateFamilySession() -> AI wording call ->
// deterministic answer key -> delivery -> SAVE) behaves correctly end to
// end for the Senior Phase authorized families.
//
// UPDATED for the all-grades session wizard. The prior version of this file
// asserted that a single family reply generated immediately. Mental Maths
// now asks one further question — oral or written delivery — for every
// supported grade, so the round-trip is:
//
//     MENU -> 1 (Create) -> 6 (Mental Maths)
//          -> topic menu   (grade-dependent option set)
//          -> delivery menu (oral / written)
//          -> generate
//
// That is a deliberate product change (delivery mode is a required
// capability and a teacher must be able to choose it without knowing a
// magic word), not a regression. Everything the previous version proved
// about the authorization matrix is preserved and extended below:
//   - the topic option set is still derived from AUTHORIZED_FAMILIES x
//     FAMILY_GRADE_AUTHORIZATION, so Ratio & Sharing is still absent at G8
//   - Grade 9 still has no generation path whatsoever
//   - pending state is still consumed exactly once, and Back still clears it
//
// Evidence level: full webhook/message-processing path throughout. A
// stray-numeric-reply-with-no-open-menu case is used for "no pending
// context" rather than direct SessionStore manipulation or fake-clock TTL
// expiry, per reviewer guidance — genuine TTL-expiry coverage belongs at
// the SessionStore unit level, not here.
//
// Family identity is verified INDIRECTLY, via the mathematical signature of
// the real questions embedded in the AI wording prompt (lastPrompt) rather
// than by asserting menu label text — robust to label wording changes. It
// still assumes numeric replies select topics in the left-to-right order
// topicsForGrade() returns (G7: 1=mulDiv, 2=powers/roots, 3=ratio; G8:
// 1=mulDiv, 2=powers/roots, ratio absent) and that "0" remains the
// universal "Back to main menu" reply. If either changes, the affected
// checks fail loudly (wrong signature detected) rather than silently pass.
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

// Real service constants — used to keep this test's expectations tied to
// the actual authorization matrix rather than duplicated magic numbers.
const {
  AUTHORIZED_FAMILIES,
  FAMILY_GRADE_AUTHORIZATION,
} = require('../services/mentalMathsService');
const mentalMathsSession = require('../services/mentalMathsSessionService');

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
// every other rc1-*-dispatch test).
//
// lastPrompt is the load-bearing instrumentation for this file: because
// the AI stub's WhatsApp output is a fixed generic string regardless of
// input, family identity can only be verified by inspecting the actual
// prompt handed to the AI, which embeds the real generated questions
// (see prompts/mentalMaths.js — the numbered question list is interpolated
// verbatim from the already-computed, already-correct set).
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

// ── Family signature detection ──────────────────────────────────────────
// Detects which authorized family's questions are present in a prompt
// string, based on the real, distinctive shapes each generator produces
// (services/mentalMathsService.js: genMulDivFlat / genPowersRootsUniform
// / genRatioSharing). Deliberately does NOT assume any particular menu
// label text.
function detectFamilySignature(text) {
  const hasRatio = /in the ratio/i.test(text);
  const hasPowersRoots = /[²³√∛]/.test(text);
  const hasMulDiv = /\d\s*[×÷]\s*\d/.test(text);
  if (hasRatio && !hasPowersRoots) return 'ratioSharing';
  if (hasPowersRoots && !hasRatio) return 'powersRootsFluency';
  if (hasMulDiv && !hasPowersRoots && !hasRatio) return 'mulDivFluency';
  return `ambiguous(ratio=${hasRatio},powersRoots=${hasPowersRoots},mulDiv=${hasMulDiv})`;
}

// aiCallCount alone is NOT sufficient proof that Mental Maths generation
// happened: generationPipeline.js also calls generateContent() for other
// intent types (e.g. the classifier's regex-fallback 'unknown' intent,
// which still gets a worded clarifying reply). A stray digit that falls
// through to natural-language parsing legitimately triggers one such
// unrelated AI call — that must not be mistaken for a Mental Maths
// generation. This checks specifically for the Mental Maths prompt's own
// fingerprint (see prompts/mentalMaths.js's fixed instruction wording).
function isMentalMathsGeneration(prompt) {
  return !!prompt && /ALREADY-CORRECT/i.test(prompt) && /mental maths/i.test(prompt);
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
    lastPrompt = null;
    await processMessage(
      { from, id: `msg-${Date.now()}-${Math.random()}`, type: 'text', text: { body: text } },
      buildProcessMessageDeps()
    );
  }

  const allText = () => sentMessages.map(m => m.text).join('\n');

  // Navigates a fresh teacher to the point of having just opened the
  // Mental Maths topic menu via the main menu (MENU -> Create a resource ->
  // Mental Maths). Returns nothing; caller sends the next numeric reply to
  // pick a topic.
  async function openTopicMenuViaMainMenu(from) {
    await send(from, 'MENU');
    await send(from, '1');   // "Create a resource"
    await send(from, '6');   // "Mental Maths"
  }

  console.log('\n── Mental Maths: session-wizard dispatch audit ──\n');

  // ══════════════════════════════════════════════════════════════════════
  // GRADE 7 — full topic menu, all three authorized families
  // ══════════════════════════════════════════════════════════════════════
  console.log('── Grade 7: topic menu shows all 3 authorized families ──');
  {
    const expectedFamilies = FAMILY_GRADE_AUTHORIZATION
      ? AUTHORIZED_FAMILIES.filter(f => FAMILY_GRADE_AUTHORIZATION[f].includes(7))
      : [];
    check(expectedFamilies.length === 3, 'G7: policy authorizes exactly 3 families', JSON.stringify(expectedFamilies));
    check(
      mentalMathsSession.topicsForGrade(7).map(t => t.key).join(',') === expectedFamilies.join(','),
      'G7: the session layer offers exactly the authorized families, in matrix order',
      JSON.stringify(mentalMathsSession.topicsForGrade(7))
    );

    // ── 1: mulDivFluency ──
    {
      const from = '27822220001';
      insertTeacher(hashPhone(from), { grade: 7 });
      await openTopicMenuViaMainMenu(from);
      check(aiCallCount === 0, 'G7 pre-selection: no generation before topic chosen', `got ${aiCallCount}`);

      await send(from, '1');
      check(aiCallCount === 0, 'G7 family 1: no generation before delivery chosen', `got ${aiCallCount}`);

      await send(from, '1'); // delivery: Oral
      check(aiCallCount === 1, 'G7 family 1: exactly one generation call', `got ${aiCallCount}`);
      const sig = detectFamilySignature(lastPrompt || '');
      check(sig === 'mulDivFluency', 'G7 family 1: generates mulDivFluency content', sig);
      check(/Grade 7/.test(lastPrompt || ''), 'G7 family 1: original grade (7) preserved into generation', lastPrompt ? lastPrompt.slice(0, 200) : null);
    }

    // ── 2: powersRootsFluency ──
    {
      const from = '27822220002';
      insertTeacher(hashPhone(from), { grade: 7 });
      await openTopicMenuViaMainMenu(from);

      await send(from, '2');
      await send(from, '1'); // delivery: Oral
      check(aiCallCount === 1, 'G7 family 2: exactly one generation call', `got ${aiCallCount}`);
      const sig = detectFamilySignature(lastPrompt || '');
      check(sig === 'powersRootsFluency', 'G7 family 2: generates powersRootsFluency content', sig);
      check(/Grade 7/.test(lastPrompt || ''), 'G7 family 2: original grade (7) preserved into generation');
    }

    // ── 3: ratioSharing (G7-only) ──
    {
      const from = '27822220003';
      insertTeacher(hashPhone(from), { grade: 7 });
      await openTopicMenuViaMainMenu(from);

      await send(from, '3');
      await send(from, '2'); // delivery: Written
      check(aiCallCount === 1, 'G7 family 3: exactly one generation call', `got ${aiCallCount}`);
      const sig = detectFamilySignature(lastPrompt || '');
      check(sig === 'ratioSharing', 'G7 family 3: generates ratioSharing content', sig);
      check(/Grade 7/.test(lastPrompt || ''), 'G7 family 3: original grade (7) preserved into generation');
      check(/Written/i.test(lastPrompt || ''), 'G7 family 3: written delivery reaches the wording call', lastPrompt ? lastPrompt.slice(0, 300) : null);
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // GRADE 8 — topic menu with Ratio Sharing absent (not authorized)
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n── Grade 8: topic menu, Ratio Sharing not authorized ──');
  {
    const expectedFamilies = AUTHORIZED_FAMILIES.filter(f => FAMILY_GRADE_AUTHORIZATION[f].includes(8));
    check(expectedFamilies.length === 2 && !expectedFamilies.includes('ratioSharing'),
      'G8: policy authorizes exactly 2 families and excludes ratioSharing', JSON.stringify(expectedFamilies));

    // ── 1: mulDivFluency ──
    {
      const from = '27822220004';
      insertTeacher(hashPhone(from), { grade: 8 });
      await openTopicMenuViaMainMenu(from);

      await send(from, '1');
      await send(from, '1'); // delivery: Oral
      check(aiCallCount === 1, 'G8 family 1: exactly one generation call', `got ${aiCallCount}`);
      const sig = detectFamilySignature(lastPrompt || '');
      check(sig === 'mulDivFluency', 'G8 family 1: generates mulDivFluency content', sig);
      check(/Grade 8/.test(lastPrompt || ''), 'G8 family 1: original grade (8) preserved into generation');
    }

    // ── 2: powersRootsFluency ──
    {
      const from = '27822220005';
      insertTeacher(hashPhone(from), { grade: 8 });
      await openTopicMenuViaMainMenu(from);

      await send(from, '2');
      await send(from, '1'); // delivery: Oral
      check(aiCallCount === 1, 'G8 family 2: exactly one generation call', `got ${aiCallCount}`);
      const sig = detectFamilySignature(lastPrompt || '');
      check(sig === 'powersRootsFluency', 'G8 family 2: generates powersRootsFluency content', sig);
      check(/Grade 8/.test(lastPrompt || ''), 'G8 family 2: original grade (8) preserved into generation');
    }

    // ── Ratio Sharing genuinely absent from the G8 topic menu ──
    // Verified two ways: (a) the menu text sent when the topic menu opens
    // does not advertise a ratio-sharing option, and (b) even if a teacher
    // guesses reply "3" anyway, no generation happens for it (the menu
    // genuinely has no 3rd option to consume).
    {
      const from = '27822220006';
      insertTeacher(hashPhone(from), { grade: 8 });
      await openTopicMenuViaMainMenu(from);
      const menuText = allText();
      check(!/ratio/i.test(menuText), 'G8: topic menu text does not mention Ratio Sharing', menuText);

      await send(from, '3');
      check(!isMentalMathsGeneration(lastPrompt), 'G8: guessing option 3 (nonexistent) generates no Mental Maths content', `aiCallCount=${aiCallCount}, prompt=${(lastPrompt || '').slice(0, 120)}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // GRADE 9 — no authorized family, no generation path, no fallback
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n── Grade 9: unavailable, zero generation, no legacy fallback ──');
  {
    const from = '27822220007';
    insertTeacher(hashPhone(from), { grade: 9 });

    await send(from, 'MENU');
    await send(from, '1');
    await send(from, '6');

    check(aiCallCount === 0, 'G9: zero generation calls on menu dispatch', `got ${aiCallCount}`);
    check(/Grade 9/.test(allText()), 'G9: response references the unsupported grade', allText());
    check(!mentalMathsSession.SUPPORTED_GRADES.includes(9), 'G9: never appears in SUPPORTED_GRADES', JSON.stringify(mentalMathsSession.SUPPORTED_GRADES));
    check(mentalMathsSession.topicsForGrade(9).length === 0, 'G9: has no authorized topics at all', JSON.stringify(mentalMathsSession.topicsForGrade(9)));

    // The grade menu opened for G9 offers only authorized grades — answering
    // it must switch the teacher to one of those, never generate for 9.
    await send(from, '1'); // "Grade 5" — the first authorized grade
    check(!isMentalMathsGeneration(lastPrompt), 'G9: answering the grade menu does not generate immediately (topic still needed)', `aiCallCount=${aiCallCount}, prompt=${(lastPrompt || '').slice(0, 120)}`);
    check(/Grade 5 Mental Maths/.test(allText()), 'G9: grade menu redirects to an authorized grade', allText());

    // Natural-language entry must be gated identically — no NL bypass.
    const from2 = '27822220008';
    insertTeacher(hashPhone(from2), { grade: null });
    await send(from2, 'mental maths grade 9');
    check(!isMentalMathsGeneration(lastPrompt), 'G9: natural-language entry also generates nothing', `aiCallCount=${aiCallCount}, prompt=${(lastPrompt || '').slice(0, 120)}`);
    check(/Grade 9/.test(allText()), 'G9: natural-language entry names the unsupported grade', allText());
  }

  // ══════════════════════════════════════════════════════════════════════
  // GRADE 5 — same wizard, its own frozen candidates
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n── Grade 5: same wizard, Grade 5 candidates only ──');
  {
    const from = '27822220009';
    insertTeacher(hashPhone(from), { grade: 5 });

    await openTopicMenuViaMainMenu(from);
    check(aiCallCount === 0, 'Grade 5: topic menu opens without generating', `got ${aiCallCount}`);
    check(!/Powers & Roots|Ratio & Sharing/i.test(allText()),
      'Grade 5: no Senior Phase family offered', allText());

    await send(from, '3'); // Mixed — both
    await send(from, '1'); // Oral
    check(aiCallCount === 1, 'Grade 5: generates after the wizard', `got ${aiCallCount}`);
    check(/□/.test(lastPrompt || ''), 'Grade 5: content is the Block B paired form, not a Senior Phase strand', (lastPrompt || '').slice(0, 200));
  }

  // ══════════════════════════════════════════════════════════════════════
  // STATE SAFETY
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n── State safety: Back, missing pending state, single-use ──');

  // "Back to main menu" from any wizard step must clear pending state and
  // must not generate anything.
  {
    const from = '27822220011';
    insertTeacher(hashPhone(from), { grade: 7 });
    await openTopicMenuViaMainMenu(from);

    await send(from, '0'); // "Back to main menu" — universal convention
    check(aiCallCount === 0, 'Back: returning to main menu generates nothing', `got ${aiCallCount}`);
    check(/create a resource|submit|classroom|manage my classes/i.test(allText()),
      'Back: main menu is actually shown', allText());

    // Pending state must be genuinely cleared, not just visually
    // reset — proven externally by confirming a stale topic digit no
    // longer produces generation once we're back at the main menu.
    await send(from, '1'); // now reinterpreted as "Create a resource", not a topic
    check(!isMentalMathsGeneration(lastPrompt), 'Back: a leftover topic digit does not resurrect the old request', `aiCallCount=${aiCallCount}, prompt=${(lastPrompt || '').slice(0, 120)}`);
  }

  // Back from the LAST wizard step (delivery) must also abandon the whole
  // request, not silently generate with a default.
  {
    const from = '27822220014';
    insertTeacher(hashPhone(from), { grade: 7 });
    await openTopicMenuViaMainMenu(from);
    await send(from, '1'); // topic chosen, delivery menu now open

    await send(from, '0'); // Back
    check(aiCallCount === 0, 'Back from delivery step: generates nothing', `got ${aiCallCount}`);
    check(/create a resource|submit|classroom|manage my classes/i.test(allText()),
      'Back from delivery step: main menu is shown', allText());
  }

  // A numeric reply with no Mental Maths menu ever opened for this phone
  // must be treated as having no valid pending context, and must never
  // generate. This is the "missing pending state" case, exercised directly
  // rather than via TTL expiry/fake clocks.
  {
    const from = '27822220012';
    insertTeacher(hashPhone(from), { grade: 7 });

    // No MENU/6 navigation at all — straight to a bare digit reply. This
    // legitimately falls through to natural-language parsing and may
    // still trigger an unrelated 'unknown'-intent AI wording call — the
    // thing being proven here is that it does not produce Mental Maths
    // content, not that the AI is never touched at all.
    await send(from, '2');
    check(!isMentalMathsGeneration(lastPrompt), 'Missing pending state: a bare numeric reply generates no Mental Maths content', `aiCallCount=${aiCallCount}, prompt=${(lastPrompt || '').slice(0, 120)}`);
  }

  // Pending state must be consumed exactly once: completing the wizard,
  // then immediately repeating the final numeric reply, must not generate
  // a second time (no menu is left open to answer).
  {
    const from = '27822220013';
    insertTeacher(hashPhone(from), { grade: 7 });
    await openTopicMenuViaMainMenu(from);

    await send(from, '1'); // topic
    await send(from, '1'); // delivery -> generates
    check(aiCallCount === 1, 'Single-use: completing the wizard generates once', `got ${aiCallCount}`);

    await send(from, '1');
    check(!isMentalMathsGeneration(lastPrompt), 'Single-use: repeating the final reply does not generate again', `aiCallCount=${aiCallCount}, prompt=${(lastPrompt || '').slice(0, 120)}`);
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
