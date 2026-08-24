'use strict';
// Mental Maths — real-dispatch coverage audit (Commit 3 replacement).
//
// PURPOSE: proves the real chain (WhatsApp input -> processMessage() ->
// menu/classification dispatch -> generationPipeline family-gate ->
// mentalMathsFamilyPendingState round-trip -> mentalMathsService
// generateFamilySession() -> AI wording call -> delivery -> SAVE)
// behaves correctly end to end, under Senior Generation Policy v1.0
// (frozen) and the Commit 2 menu/pending-state architecture.
//
// This file REPLACES the pre-Commit-2 version of this test. The prior
// version's S1/S4/S5 asserted immediate generation for G7/G8/G9 without
// a family selection — that assumption is now contrary to the approved
// design (single-family session focus; deliberately no NL family
// parsing) and has been retired, not patched around. See the reviewer
// decision on Commit 2 (2026-08-24) for the classification of those
// failures as stale expectations, not regressions.
//
// Evidence level: full webhook/message-processing path throughout,
// including the primary family-selection round-trip scenarios. A
// stray-numeric-reply-with-no-open-menu case is used for "no pending
// context" rather than direct SessionStore manipulation or fake-clock
// TTL expiry, per reviewer guidance — genuine TTL-expiry coverage
// belongs at the SessionStore unit level, not here.
//
// IMPORTANT — verify against the real committed files before relying on
// this file: the exact menu label strings for the family sub-menu
// (e.g. what "1"/"2"/"3" map to in FAMILY_MENU_LABEL_TO_FAMILY) were not
// available in the sandbox this draft was written against, since
// Commit 2 was applied directly to your local checkout via patch and
// this sandbox only ever saw the pre-Commit-2 zip. Family identity is
// therefore verified INDIRECTLY here, via the mathematical signature of
// the real questions embedded in the AI wording prompt (lastPrompt) —
// this is robust to label wording changes but still assumes:
//   (a) numeric replies "1"/"2"/"3" against the open family menu select
//       families in the same left-to-right order given in your approved
//       structure (G7: 1=mulDiv, 2=powers/roots, 3=ratio; G8: 1=mulDiv,
//       2=powers/roots, ratio absent), and
//   (b) "0" remains the universal "Back to main menu" reply, consistent
//       with every other sub-menu in flows/mainMenuFlow.js.
// If either assumption is wrong, the affected checks will fail loudly
// (wrong signature detected) rather than silently pass — adjust the
// numeric replies below to match your real FAMILY_MENU_LABEL_TO_FAMILY
// ordering if that happens, nothing else should need to change.
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
// the frozen policy's actual authorization matrix rather than duplicated
// magic numbers.
const {
  AUTHORIZED_FAMILIES,
  FAMILY_GRADE_AUTHORIZATION,
} = require('../services/mentalMathsService');

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
// (see prompts/mentalMaths.js — numberedQuestions/numberedAnswers are
// interpolated verbatim from the already-computed, already-correct set).
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

  // Navigates a fresh teacher to the point of having just opened the
  // Mental Maths family menu via the main menu (MENU -> Create a
  // resource -> Mental Maths). Returns nothing; caller sends the next
  // numeric reply to pick a family.
  async function openFamilyMenuViaMainMenu(from) {
    await send(from, 'MENU');
    await send(from, '1');   // "Create a resource"
    await send(from, '6');   // "Mental Maths (Grade 5, 7-9)"
  }

  console.log('\n── Mental Maths: family-menu dispatch audit (Commit 3) ──\n');

  // ══════════════════════════════════════════════════════════════════════
  // GRADE 7 — full family menu, all three authorized families
  // ══════════════════════════════════════════════════════════════════════
  console.log('── Grade 7: family menu shows all 3 authorized families ──');
  {
    const expectedFamilies = FAMILY_GRADE_AUTHORIZATION
      ? AUTHORIZED_FAMILIES.filter(f => FAMILY_GRADE_AUTHORIZATION[f].includes(7))
      : [];
    check(expectedFamilies.length === 3, 'G7: policy authorizes exactly 3 families', JSON.stringify(expectedFamilies));

    // ── 1: mulDivFluency ──
    {
      const from = '27822220001';
      insertTeacher(hashPhone(from), { grade: 7 });
      await openFamilyMenuViaMainMenu(from);
      check(aiCallCount === 0, 'G7 pre-selection: no generation before family chosen', `got ${aiCallCount}`);

      await send(from, '1');
      check(aiCallCount === 1, 'G7 family 1: exactly one generation call', `got ${aiCallCount}`);
      const sig = detectFamilySignature(lastPrompt || '');
      check(sig === 'mulDivFluency', 'G7 family 1: generates mulDivFluency content', sig);
      check(/Grade 7/.test(lastPrompt || ''), 'G7 family 1: original grade (7) preserved into generation', lastPrompt ? lastPrompt.slice(0, 200) : null);
    }

    // ── 2: powersRootsFluency ──
    {
      const from = '27822220002';
      insertTeacher(hashPhone(from), { grade: 7 });
      await openFamilyMenuViaMainMenu(from);

      await send(from, '2');
      check(aiCallCount === 1, 'G7 family 2: exactly one generation call', `got ${aiCallCount}`);
      const sig = detectFamilySignature(lastPrompt || '');
      check(sig === 'powersRootsFluency', 'G7 family 2: generates powersRootsFluency content', sig);
      check(/Grade 7/.test(lastPrompt || ''), 'G7 family 2: original grade (7) preserved into generation');
    }

    // ── 3: ratioSharing (G7-only) ──
    {
      const from = '27822220003';
      insertTeacher(hashPhone(from), { grade: 7 });
      await openFamilyMenuViaMainMenu(from);

      await send(from, '3');
      check(aiCallCount === 1, 'G7 family 3: exactly one generation call', `got ${aiCallCount}`);
      const sig = detectFamilySignature(lastPrompt || '');
      check(sig === 'ratioSharing', 'G7 family 3: generates ratioSharing content', sig);
      check(/Grade 7/.test(lastPrompt || ''), 'G7 family 3: original grade (7) preserved into generation');
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // GRADE 8 — family menu with Ratio Sharing absent (not authorized)
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n── Grade 8: family menu, Ratio Sharing not authorized ──');
  {
    const expectedFamilies = AUTHORIZED_FAMILIES.filter(f => FAMILY_GRADE_AUTHORIZATION[f].includes(8));
    check(expectedFamilies.length === 2 && !expectedFamilies.includes('ratioSharing'),
      'G8: policy authorizes exactly 2 families and excludes ratioSharing', JSON.stringify(expectedFamilies));

    // ── 1: mulDivFluency ──
    {
      const from = '27822220004';
      insertTeacher(hashPhone(from), { grade: 8 });
      await openFamilyMenuViaMainMenu(from);

      await send(from, '1');
      check(aiCallCount === 1, 'G8 family 1: exactly one generation call', `got ${aiCallCount}`);
      const sig = detectFamilySignature(lastPrompt || '');
      check(sig === 'mulDivFluency', 'G8 family 1: generates mulDivFluency content', sig);
      check(/Grade 8/.test(lastPrompt || ''), 'G8 family 1: original grade (8) preserved into generation');
    }

    // ── 2: powersRootsFluency ──
    {
      const from = '27822220005';
      insertTeacher(hashPhone(from), { grade: 8 });
      await openFamilyMenuViaMainMenu(from);

      await send(from, '2');
      check(aiCallCount === 1, 'G8 family 2: exactly one generation call', `got ${aiCallCount}`);
      const sig = detectFamilySignature(lastPrompt || '');
      check(sig === 'powersRootsFluency', 'G8 family 2: generates powersRootsFluency content', sig);
      check(/Grade 8/.test(lastPrompt || ''), 'G8 family 2: original grade (8) preserved into generation');
    }

    // ── Ratio Sharing genuinely absent from the G8 menu ──
    // Verified two ways: (a) the menu text sent when the family menu
    // opens does not advertise a ratio-sharing option, and (b) even if a
    // teacher guesses reply "3" anyway, no generation happens for it
    // (the menu genuinely has no 3rd option to consume).
    {
      const from = '27822220006';
      insertTeacher(hashPhone(from), { grade: 8 });
      await openFamilyMenuViaMainMenu(from);
      const menuText = sentMessages.map(m => m.text).join('\n');
      check(!/ratio/i.test(menuText), 'G8: family menu text does not mention Ratio Sharing', menuText);

      await send(from, '3');
      check(!isMentalMathsGeneration(lastPrompt), 'G8: guessing option 3 (nonexistent) generates no Mental Maths content', `aiCallCount=${aiCallCount}, prompt=${(lastPrompt || '').slice(0, 120)}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // GRADE 9 — unavailable under the frozen taxonomy, no fallback
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n── Grade 9: unavailable, zero generation, no legacy fallback ──');
  {
    const from = '27822220007';
    insertTeacher(hashPhone(from), { grade: 9 });

    await send(from, 'MENU');
    await send(from, '1');
    await send(from, '6');

    check(aiCallCount === 0, 'G9: zero generation calls on menu dispatch', `got ${aiCallCount}`);
    check(sentMessages.some(m => /9/.test(m.text)), 'G9: response references the unsupported grade', JSON.stringify(sentMessages.map(m => m.text)));
    // No numeric family menu should have been opened for G9 — sending a
    // plausible family digit afterwards must not retroactively generate
    // Mental Maths content (it may still hit the unrelated 'unknown'
    // fallback-wording AI call, which is not what this checks).
    await send(from, '1');
    check(!isMentalMathsGeneration(lastPrompt), 'G9: no family menu was left open to answer', `aiCallCount=${aiCallCount}, prompt=${(lastPrompt || '').slice(0, 120)}`);

    // Natural-language entry must be gated identically — no NL bypass.
    const from2 = '27822220008';
    insertTeacher(hashPhone(from2), { grade: null });
    await send(from2, 'mental maths grade 9');
    check(!isMentalMathsGeneration(lastPrompt), 'G9: natural-language entry also generates nothing', `aiCallCount=${aiCallCount}, prompt=${(lastPrompt || '').slice(0, 120)}`);
  }

  // ══════════════════════════════════════════════════════════════════════
  // GRADE 5 — unchanged legacy direct path (no family menu at all)
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n── Grade 5: existing direct-generation path unchanged ──');
  {
    const from = '27822220009';
    insertTeacher(hashPhone(from), { grade: 5 });

    await send(from, 'MENU');
    await send(from, '1');
    await send(from, '6');

    check(aiCallCount === 1, 'Grade 5: generates directly with no family menu', `got ${aiCallCount}`);
    check(!sentMessages.some(m => /family|mulDiv|powers|ratio sharing/i.test(m.text)),
      'Grade 5: no family-menu language ever surfaced', JSON.stringify(sentMessages.map(m => m.text)));

    // Natural-language entry for Grade 5 also unaffected.
    const from2 = '27822220010';
    insertTeacher(hashPhone(from2), { grade: null });
    await send(from2, 'grade 5 mental maths');
    check(aiCallCount === 1, 'Grade 5 (natural-language): generates directly, no family step', `got ${aiCallCount}`);
  }

  // ══════════════════════════════════════════════════════════════════════
  // STATE SAFETY
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n── State safety: Back, missing pending state, single-use ──');

  // "Back to main menu" from the family menu must clear pending state and
  // must not generate anything.
  {
    const from = '27822220011';
    insertTeacher(hashPhone(from), { grade: 7 });
    await openFamilyMenuViaMainMenu(from);

    await send(from, '0'); // "Back to main menu" — universal convention
    check(aiCallCount === 0, 'Back: returning to main menu generates nothing', `got ${aiCallCount}`);
    check(sentMessages.some(m => /create a resource|submit|classroom|manage my classes/i.test(m.text)),
      'Back: main menu is actually shown', JSON.stringify(sentMessages.map(m => m.text)));

    // Pending state must be genuinely cleared, not just visually
    // reset — proven externally by confirming a stale family digit no
    // longer produces generation once we're back at the main menu.
    await send(from, '1'); // now reinterpreted as "Create a resource", not a family
    check(!isMentalMathsGeneration(lastPrompt), 'Back: a leftover family digit does not resurrect the old request', `aiCallCount=${aiCallCount}, prompt=${(lastPrompt || '').slice(0, 120)}`);
  }

  // A numeric reply with no Mental Maths family menu ever opened for
  // this phone must be treated as having no valid pending context, and
  // must never generate. This is the "missing pending state" case,
  // exercised directly rather than via TTL expiry/fake clocks.
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

  // Pending state must be consumed exactly once: answering the family
  // menu, then immediately repeating the same numeric reply, must not
  // generate a second time (the menu is no longer open to answer).
  {
    const from = '27822220013';
    insertTeacher(hashPhone(from), { grade: 7 });
    await openFamilyMenuViaMainMenu(from);

    await send(from, '1');
    check(aiCallCount === 1, 'Single-use: first family reply generates once', `got ${aiCallCount}`);

    await send(from, '1');
    check(aiCallCount === 0, 'Single-use: repeating the same reply does not generate again', `got ${aiCallCount}`);
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
