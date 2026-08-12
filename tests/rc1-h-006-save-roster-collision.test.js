'use strict';
// Regression test — RC1-H-006: SAVE sent while a teacher is mid-flow in
// rosterFlow's PREVIEW step must be routed to rosterFlow, not intercepted
// by core/commandHandler.js's global "save the just-generated resource"
// SAVE branch.
//
// Bug (found 2026-08-12, live RC1 verification, Journey E): a teacher who
// pastes a roster and replies SAVE to confirm it gets
// "Nothing to save yet — generate a resource first..." instead of their
// roster being saved — because handleCommand() runs unconditionally before
// messageProcessor's alreadyMidFlow dispatch, and its SAVE branch had zero
// awareness of rosterState (same collision shape as RC1-H-004's
// STATUS/USAGE/BALANCE vs. flow-owned STATUS).
//
// Fix: core/commandHandler.js's SAVE branch now returns false (not handled)
// when rosterState has an active session for the phone, letting
// messageProcessor's alreadyMidFlow dispatch route SAVE to
// flows/rosterFlow.js's own PREVIEW-step SAVE handling instead.
// routes/webhook.js's buildCommandDeps() passes rosterState through
// additively so commandHandler can see it.
//
// This test deliberately exercises the REAL dispatch chain
// (processMessage -> commandHandler -> rosterFlow), not handleRosterFlow()
// directly, because calling the flow handler directly is exactly what let
// this collision go undetected by tests/roster-flow.test.js in the first
// place (same blind spot RC1-H-004 documented).
//
// Run: node tests/rc1-h-006-save-roster-collision.test.js

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
  // the onboarding flow instead of reaching command/roster routing.
  db.prepare(`
    INSERT INTO onboarding (phone_hash, step, updated_at)
    VALUES (?, 'done', datetime('now'))
    ON CONFLICT(phone_hash) DO UPDATE SET step = 'done'
  `).run(phoneHash);
}

function insertClass(phoneHash, name) {
  const result = db.prepare(
    `INSERT INTO classes (phone_hash, name, grade, subject, learner_count) VALUES (?, ?, 7, 'Mathematics', 0)`
  ).run(phoneHash, name);
  return result.lastInsertRowid;
}

function countRosterRows(classId) {
  return db.prepare(`SELECT COUNT(*) as c FROM learners WHERE class_id = ?`).get(classId).c;
}

function countSavedResources(phoneHash) {
  return db.prepare(`SELECT COUNT(*) as c FROM saved_resources WHERE phone_hash = ?`).get(phoneHash).c;
}

function makeMessage(from, body, id) {
  return { from, id, type: 'text', text: { body } };
}

(async () => {
  const {
    hashPhone,
    lastGeneratedState,
    rosterState,
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

  console.log('\n── 1. Roster PREVIEW + SAVE → roster is actually saved ──');
  {
    const phone = '+27821170001';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    const classId = insertClass(phoneHash, 'RC1-H-006 Test Class A');

    sentMessages.length = 0;
    await send(phone, 'ROSTER');
    check(/paste/i.test(lastMessage()) || /learner/i.test(lastMessage()), 'ROSTER prompts for a paste (single class, no selection needed)');

    sentMessages.length = 0;
    await send(phone, 'Alpha One\nBeta Two\nGamma Three');
    check(/Reply \*SAVE\*/i.test(lastMessage()), 'preview asks for SAVE');
    check(countRosterRows(classId) === 0, 'nothing written to DB yet at preview stage');

    sentMessages.length = 0;
    await send(phone, 'SAVE');

    check(/Roster saved/i.test(lastMessage()), '1-A: SAVE while in roster PREVIEW saves the roster, not "nothing to save"');
    check(!/Nothing to save yet/i.test(lastMessage()), '1-B: the generated-resource "nothing to save" message is NOT shown');
    check(countRosterRows(classId) === 3, '1-C: the 3 pasted learners are actually persisted to the DB');
    check(rosterState.get(phoneHash) === undefined, '1-D: roster session is cleared after SAVE');
  }

  console.log('\n── 2. Roster PREVIEW + EDIT → editing still works (fix does not break EDIT) ──');
  {
    const phone = '+27821170002';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    insertClass(phoneHash, 'RC1-H-006 Test Class B');

    await send(phone, 'ROSTER');
    await send(phone, 'First Learner');

    sentMessages.length = 0;
    await send(phone, 'EDIT');
    check(/paste/i.test(lastMessage().toLowerCase()), '2-A: EDIT loops back to the paste prompt');

    const state = rosterState.get(phoneHash);
    check(state && state.step === 'paste', '2-B: session is back at the PASTE step, not cleared');
  }

  console.log('\n── 3. Roster PREVIEW + CANCEL → roster cancelled, nothing saved ──');
  {
    const phone = '+27821170003';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    const classId = insertClass(phoneHash, 'RC1-H-006 Test Class C');

    await send(phone, 'ROSTER');
    await send(phone, 'Solo Learner');

    sentMessages.length = 0;
    await send(phone, 'CANCEL');
    check(/cancelled/i.test(lastMessage()), '3-A: CANCEL confirms the roster action was cancelled');
    check(countRosterRows(classId) === 0, '3-B: nothing was written to the DB');
    check(rosterState.get(phoneHash) === undefined, '3-C: roster session is cleared after CANCEL');
  }

  console.log('\n── 4. Generated-resource state + SAVE (no roster) → still saves the resource correctly ──');
  {
    const phone = '+27821170004';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);

    check(rosterState.get(phoneHash) === undefined, 'setup: no roster session for this phone');

    lastGeneratedState.set(phoneHash, {
      saveState: 'GENERATED',
      generationId: 'gen-h006-004',
      resourceType: 'worksheet',
      title: 'Fractions — worksheet',
      content: 'Some generated worksheet content',
      intent: { type: 'worksheet', grade: 7, subject: 'mathematics', topic: 'Fractions' },
    });

    sentMessages.length = 0;
    await send(phone, 'SAVE');

    check(/Saved!/i.test(lastMessage()), '4-A: SAVE with no active roster session still saves the generated resource');
    check(countSavedResources(phoneHash) === 1, '4-B: exactly one row written to saved_resources');
    check(lastGeneratedState.get(phoneHash) === undefined, '4-C: lastGeneratedState cleared after successful save');
  }

  console.log('\n── 5. No pending resource, no roster session + SAVE → existing "nothing to save" response is unchanged ──');
  {
    const phone = '+27821170005';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);

    check(rosterState.get(phoneHash) === undefined, 'setup: no roster session');
    check(lastGeneratedState.get(phoneHash) === undefined, 'setup: no pending generated resource');

    sentMessages.length = 0;
    await send(phone, 'SAVE');

    check(/Nothing to save yet/i.test(lastMessage()), '5-A: bare SAVE with nothing pending still gets the original "nothing to save" message');
  }

  console.log('\n── 6. Roster session active but at a non-PREVIEW step + SAVE → falls through to rosterFlow, no false resource-save ──');
  {
    const phone = '+27821170006';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    insertClass(phoneHash, 'RC1-H-006 Test Class D');

    // Roster session is active at the PASTE step (not PREVIEW yet).
    sentMessages.length = 0;
    await send(phone, 'ROSTER');
    const state = rosterState.get(phoneHash);
    check(state && state.step === 'paste', 'setup: roster session is at PASTE step, not PREVIEW');

    sentMessages.length = 0;
    await send(phone, 'SAVE');
    check(!/Nothing to save yet/i.test(lastMessage()), '6-A: SAVE at PASTE step is NOT swallowed by the global resource-save handler');
    check(countSavedResources(phoneHash) === 0, '6-B: no spurious resource save occurred');
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
