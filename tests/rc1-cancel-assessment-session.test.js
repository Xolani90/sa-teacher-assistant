'use strict';
// Regression test — RC1-CANCEL, assessment-session-specific case.
//
// Note on scope: the general CANCEL/hasActiveFlow collision (observation,
// roster, etc. as stand-ins) was covered by an earlier
// tests/rc1-cancel-routing-collision.test.js in a prior session, but that
// file is not present in this checkout — only this assessment-session-
// specific test exists here. This file stands on its own: it exercises the
// same hasActiveFlow() fix, using the actual flow the original bug report
// was about, with the exact shape of the live journey — a genuinely active
// session, a stale lastGeneratedState sitting alongside it, CANCEL sent,
// and a follow-up message afterward to prove the abandoned flow doesn't
// still own the conversation.
//
// Bug (recap): core/commandHandler.js's CANCEL branch ran unconditionally
// before messageProcessor's alreadyMidFlow dispatch and had zero awareness
// of any of the 13 multi-turn flow stores. A teacher who was mid marks-
// capture, with a still-pending "reply SAVE to keep this" resource from
// something generated earlier, got the wrong response: CANCEL discarded the
// generated resource ("👍 No problem — not saved") instead of abandoning
// the assessment session — and, more seriously, assessmentSessionState was
// left untouched, so the abandoned session kept absorbing the teacher's
// next messages as if capture were still in progress.
//
// Fix under test: core/commandHandler.js's CANCEL branch now returns false
// (not handled) when hasActiveFlow(phoneHash) is true, letting
// messageProcessor's alreadyMidFlow dispatch route CANCEL to
// assessmentSessionFlow's own CANCEL handling instead. routes/webhook.js's
// buildCommandDeps() passes hasActiveFlow() through additively.
//
// This test deliberately exercises the REAL dispatch chain
// (processMessage -> commandHandler -> assessmentSessionFlow), not
// handleAssessmentSessionFlow() directly, for the same reason
// rc1-h-006/rc1-cancel-routing-collision do: calling the flow handler
// directly would miss this exact class of collision.
//
// Run: node tests/rc1-cancel-assessment-session.test.js

process.env.PII_SECRET = 'test-secret-key-32-bytes-long!!';
process.env.FREE_LIMIT = '10';
process.env.APP_URL    = 'https://example.test';
process.env.PDF_SECRET = 'pdf-secret';

const Module = require('module');
const path = require('path');

let passed = 0;
let failed = 0;
function check(condition, label) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ FAIL: ${label}`); failed++; }
}

// MUST be required before any service/repository module — see
// tests/helpers/createTestDb.js's "Why this must be required first".
const { createTestDb } = require('./helpers/createTestDb');
const testDb = createTestDb(__filename);
const db = testDb.db;

// ── Stub services/whatsappService — just record sends, never actually send ──
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

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === './whatsappService' || request === '../services/whatsappService') return whatsappPath;
  return origResolve.call(this, request, ...rest);
};

function insertTeacher(phoneHash) {
  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject) VALUES (?, ?, ?, ?)`)
    .run(phoneHash, 'Test Teacher', '7', 'Mathematics');
  // Onboarding must be marked 'done' or every message gets intercepted by
  // the onboarding flow instead of reaching command/flow routing.
  db.prepare(`
    INSERT INTO onboarding (phone_hash, step, updated_at)
    VALUES (?, 'done', datetime('now'))
    ON CONFLICT(phone_hash) DO UPDATE SET step = 'done'
  `).run(phoneHash);
}

function insertClass(phoneHash, name, learnerCount) {
  const result = db.prepare(
    `INSERT INTO classes (phone_hash, name, grade, subject, learner_count) VALUES (?, ?, 7, 'Mathematics', ?)`
  ).run(phoneHash, name, learnerCount);
  return result.lastInsertRowid;
}

// Inserted directly via SQL, same approach rc1-h-006/rc1-cancel-routing-
// collision take for classes — bypasses publishBlueprint()'s curriculum
// topic-validation, which is irrelevant to what this test is checking
// (CANCEL routing, not blueprint authoring).
function insertPublishedBlueprint(phoneHash, title) {
  const bp = db.prepare(`
    INSERT INTO assessment_blueprints (phone_hash, title, subject, grade, term, total_marks, version, status)
    VALUES (?, ?, 'Mathematics', 7, 2, 10, 1, 'published')
  `).run(phoneHash, title);
  const blueprintId = bp.lastInsertRowid;
  db.prepare(`
    INSERT INTO blueprint_questions (blueprint_id, question_number, topic, max_marks)
    VALUES (?, 1, 'Fractions', 10)
  `).run(blueprintId);
  return blueprintId;
}

function makeMessage(from, body, id) {
  return { from, id, type: 'text', text: { body } };
}

(async () => {
  const {
    hashPhone,
    lastGeneratedState,
    assessmentSessionState,
    processMessage,
    buildProcessMessageDeps,
  } = require('../routes/webhook').__testExports;

  let msgCounter = 0;
  async function send(phone, body) {
    msgCounter += 1;
    await processMessage(makeMessage(phone, body, `msg-${msgCounter}`), buildProcessMessageDeps());
  }
  function lastMessage() {
    return sentMessages[sentMessages.length - 1]?.text || '';
  }

  console.log('\n── 1. Active assessment session + stale GENERATED resource + CANCEL → assessment session (not the resource prompt) is cancelled ──');
  {
    const phone = '+27821180001';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    insertClass(phoneHash, 'RC1-CANCEL Test Class A', 1);
    insertPublishedBlueprint(phoneHash, 'RC1-CANCEL Fractions Test');

    // Step 1: NEW TEST -> SELECT_BLUEPRINT
    sentMessages.length = 0;
    await send(phone, 'NEW TEST');
    check(/Choose a Blueprint/i.test(lastMessage()), '1-A: NEW TEST prompts blueprint selection');
    check(assessmentSessionState.get(phoneHash)?.step === 'selectBlueprint', '1-B: session at SELECT_BLUEPRINT');

    // Step 2: pick blueprint #1 -> SELECT_CLASS
    sentMessages.length = 0;
    await send(phone, '1');
    check(/Choose a Class/i.test(lastMessage()), '1-C: blueprint pick prompts class selection');
    check(assessmentSessionState.get(phoneHash)?.step === 'selectClass', '1-D: session at SELECT_CLASS');

    // Step 3: pick class #1 -> ACTIVE (marks capture genuinely in progress)
    sentMessages.length = 0;
    await send(phone, '1');
    check(assessmentSessionState.get(phoneHash)?.step === 'active', '1-E: session is genuinely ACTIVE — marks capture in progress');

    // A stale "reply SAVE to keep this" prompt from an earlier, unrelated
    // generation, sitting alongside the active session — exactly the
    // collision shape the original bug report described.
    lastGeneratedState.set(phoneHash, {
      saveState: 'GENERATED',
      generationId: 'gen-cancel-assess-001',
      resourceType: 'worksheet',
      title: 'Unrelated worksheet',
      content: 'Some earlier generated content',
      intent: { type: 'worksheet', grade: 7, subject: 'mathematics', topic: 'Algebra' },
    });

    // Step 4: CANCEL — must be claimed by assessmentSessionFlow, not by
    // commandHandler's global "discard the pending SAVE prompt" branch.
    sentMessages.length = 0;
    await send(phone, 'CANCEL');

    check(/Assessment session cancelled\. No marks were saved\./i.test(lastMessage()),
      '1-F: CANCEL returns the assessment-specific cancellation message');
    check(!/👍 No problem — not saved/.test(lastMessage()),
      '1-G: the wrong global "resource not saved" message is NOT shown');
    check(assessmentSessionState.get(phoneHash) === undefined,
      '1-H: the assessment session itself is cleaned up (deleted) after CANCEL');

    // The stale generated-resource prompt is a separate concern from the
    // assessment session and is untouched by this CANCEL — assessmentSessionFlow's
    // cleanup only clears its own state, same as roster/observation CANCEL do
    // for their own state elsewhere in this codebase.
    check(lastGeneratedState.get(phoneHash)?.saveState === 'GENERATED',
      '1-I: the unrelated stale lastGeneratedState prompt is left untouched by this CANCEL (a separate concern)');

    // Step 5 — the critical invariant: the NEXT message must not be
    // absorbed into the abandoned assessment session. If the bug were
    // still present, assessmentSessionState would still exist and
    // messageProcessor's alreadyMidFlow would route this straight back
    // into assessmentSessionFlow's ACTIVE-step capture logic (which would
    // re-set assessmentSessionState as it processed the "reply"). Since
    // the session was actually deleted in step 4, a plain follow-up
    // message here has nothing left to be captured into.
    sentMessages.length = 0;
    await send(phone, 'Thabo Nkosi');
    check(assessmentSessionState.get(phoneHash) === undefined,
      '1-J: post-CANCEL message is NOT absorbed into the abandoned assessment flow — no session was recreated');
    // Match the ACTUAL capture-prompt shape used in step 1-E ("Learner
    // 1/8: ...", "Question 1/2 (Max: ...)", "Reply with marks."), not a
    // bare mention of the words "learner"/"question"/"mark" anywhere in a
    // reply — the conversational fallback's generic "not sure what you
    // need" templates legitimately mention capabilities like "learner
    // support" in prose, which isn't the failure mode this check is for.
    check(!/Learner\s+\d+\/\d+|Question\s+\d+\/\d+|Reply with marks/i.test(lastMessage()),
      '1-K: the reply to the post-CANCEL message is not a marks-capture prompt');
  }

  console.log('\n── 2. Control case: no active flow + stale GENERATED resource + CANCEL → existing "not saved" behaviour is unchanged ──');
  {
    const phone = '+27821180002';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);

    check(assessmentSessionState.get(phoneHash) === undefined, 'setup: no active assessment session');

    lastGeneratedState.set(phoneHash, {
      saveState: 'GENERATED',
      generationId: 'gen-cancel-assess-002',
      resourceType: 'worksheet',
      title: 'Control-case worksheet',
      content: 'Some generated content',
      intent: { type: 'worksheet', grade: 7, subject: 'mathematics', topic: 'Fractions' },
    });

    sentMessages.length = 0;
    await send(phone, 'CANCEL');

    check(/👍 No problem — not saved/.test(lastMessage()),
      '2-A: with no active flow, CANCEL still discards the pending generated resource as before');
    check(lastGeneratedState.get(phoneHash) === undefined,
      '2-B: lastGeneratedState is cleared, exactly as pre-fix behaviour for this case');
  }

  console.log('\n─────────────────────────────────');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total:  ${passed + failed}`);
  console.log('─────────────────────────────────\n');

  Module._resolveFilename = origResolve;
  testDb.cleanup();
  process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
  console.error('UNCAUGHT ERROR IN TEST:', err);
  Module._resolveFilename = origResolve;
  testDb.cleanup();
  process.exit(1);
});
