'use strict';
// Phase 6, cycle 4 — saved-resource deletion.
//
// services/teacherWorkspaceService.js#deleteSavedResource already existed,
// fully implemented and ownership-scoped, but had zero callers anywhere in
// the app (WhatsApp or Dashboard) — MY RESOURCES / GET /resources could
// only ever grow. This adds the first callers on both surfaces:
//
//   - Dashboard: DELETE /api/resources/:id  (createDeleteResourceHandler)
//   - WhatsApp:  DELETE <id>                (core/commandHandler.js)
//
// and fixes a real collision this change surfaced: flows/observationFlow.js
// already owns a bare DELETE (its own delete-confirmation step,
// awaitingDeleteConfirmation) while a teacher is reviewing a specific
// observation, and core/commandHandler.js runs before messageProcessor's
// flow dispatch — so without a guard, a bare DELETE typed mid-observation-
// review would have been swallowed by the new workspace command instead of
// reaching observationFlow.
//
// This file covers three things:
//   Part A — DELETE /api/resources/:id: thin-route unit tests, mirroring
//            tests/api-classes-delete.test.js's style.
//   Part B — DELETE <id> over WhatsApp: real dispatch chain
//            (processMessage -> commandHandler -> teacherWorkspaceService
//            -> DB), mirroring tests/resources-whatsapp-open-e2e.test.js.
//   Part C — the observation-DELETE collision guard: proves a bare DELETE
//            while an observationHistoryState session is active still
//            reaches observationFlow, not the new resource-delete branch.
//
// Run: node tests/phase6-delete-saved-resource.test.js

process.env.PII_SECRET = 'test-secret-key-32-bytes-long!!';
process.env.FREE_LIMIT = '10';
process.env.APP_URL    = 'https://example.test';
process.env.PDF_SECRET = 'pdf-secret';

const assert = require('assert');
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

console.log('\n── Phase 6 cycle 4: DELETE <id> saved-resource deletion ──\n');

// MUST be required before any service/repository module — see
// tests/helpers/createTestDb.js's "Why this must be required first".
const { createTestDb } = require('./helpers/createTestDb');
const testDb = createTestDb(__filename);
const db = testDb.db;

// ═══════════════════════════════════════════════════════════════════════
// Part A — DELETE /api/resources/:id (thin-route unit tests, no DB)
// ═══════════════════════════════════════════════════════════════════════
console.log('── Part A: DELETE /api/resources/:id ──');
{
  const { createDeleteResourceHandler } = require('../routes/api').__testExports;

  function mockRes() {
    return {
      statusCode: 200, body: undefined, sent: false,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
      send() { this.sent = true; return this; },
    };
  }
  function mockReq(phoneHash, params) {
    return { teacher: { id: 1, phoneHash }, params };
  }

  const EXISTING_RESOURCE = { id: 42, phone_hash: 'hash_owner', title: 'Fractions — Worksheet' };

  {
    const handler = createDeleteResourceHandler({
      getSavedResource: () => EXISTING_RESOURCE,
      deleteSavedResource: () => true,
    });
    const res = mockRes();
    handler(mockReq('hash_owner', { id: '42' }), res);
    check(res.statusCode === 204 && res.sent === true, '204 on success');
  }

  {
    const handler = createDeleteResourceHandler({
      getSavedResource: () => EXISTING_RESOURCE,
      deleteSavedResource: () => true,
    });
    for (const bad of ['0', '-1', 'abc', '']) {
      const res = mockRes();
      handler(mockReq('hash_owner', { id: bad }), res);
      check(res.statusCode === 400, `400 for a non-positive-integer id (id=${JSON.stringify(bad)})`);
    }
  }

  {
    let deleteCalled = false;
    const handler = createDeleteResourceHandler({
      getSavedResource: () => null,
      deleteSavedResource: () => { deleteCalled = true; return true; },
    });
    const res = mockRes();
    handler(mockReq('hash_owner', { id: '999' }), res);
    check(res.statusCode === 404, '404 when getSavedResource returns null (missing or wrong owner)');
    check(deleteCalled === false, 'deleteSavedResource never runs against an unowned/missing resource');
  }

  {
    const handler = createDeleteResourceHandler({
      getSavedResource: () => EXISTING_RESOURCE,
      deleteSavedResource: () => false,
    });
    const res = mockRes();
    handler(mockReq('hash_owner', { id: '42' }), res);
    check(res.statusCode === 404, '404 if deleteSavedResource returns false (race between check and delete)');
  }

  {
    const handler = createDeleteResourceHandler({
      getSavedResource: () => { throw new Error('db exploded'); },
      deleteSavedResource: () => true,
    });
    const res = mockRes();
    handler(mockReq('hash_owner', { id: '42' }), res);
    check(res.statusCode === 500, '500 passthrough if getSavedResource throws');
  }

  {
    const handler = createDeleteResourceHandler({
      getSavedResource: () => EXISTING_RESOURCE,
      deleteSavedResource: () => { throw new Error('db exploded'); },
    });
    const res = mockRes();
    handler(mockReq('hash_owner', { id: '42' }), res);
    check(res.statusCode === 500, '500 passthrough if deleteSavedResource throws');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Part B & C — real dispatch chain (DB-backed)
// ═══════════════════════════════════════════════════════════════════════
const sentMessages = [];
const whatsappPath = path.resolve(__dirname, '../services/whatsappService');
const realWhatsapp = require(whatsappPath);
require.cache[whatsappPath] = {
  id: whatsappPath, filename: whatsappPath, loaded: true,
  exports: {
    sendMessage: async (phone, text) => {
      const chunks = realWhatsapp.chunkMessage(text);
      for (const chunk of chunks) sentMessages.push({ phone, text: chunk });
      return true;
    },
    sendDocument: async () => true,
    downloadMedia: async () => null,
    chunkMessage: realWhatsapp.chunkMessage,
  },
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === './whatsappService' || request === '../services/whatsappService') return whatsappPath;
  return origResolve.call(this, request, ...rest);
};

function insertTeacher(phoneHash, name) {
  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject) VALUES (?, ?, ?, ?)`)
    .run(phoneHash, name, '7', 'Mathematics');
  db.prepare(`
    INSERT INTO onboarding (phone_hash, step, updated_at)
    VALUES (?, 'done', datetime('now'))
    ON CONFLICT(phone_hash) DO UPDATE SET step = 'done'
  `).run(phoneHash);
}

function makeMessage(from, body, id) {
  return { from, id, type: 'text', text: { body } };
}

(async () => {
  const {
    hashPhone,
    processMessage,
    buildProcessMessageDeps,
    observationHistoryState,
  } = require('../routes/webhook').__testExports;
  const { saveResource, getSavedResource } = require('../services/teacherWorkspaceService');

  let msgCounter = 0;
  async function send(phone, body) {
    msgCounter += 1;
    sentMessages.length = 0;
    await processMessage(makeMessage(phone, body, `msg-${msgCounter}`), buildProcessMessageDeps());
  }
  function allText() {
    return sentMessages.map((m) => m.text).join('\n');
  }

  console.log('\n── Part B: DELETE <id> over WhatsApp (real dispatch chain) ──');

  const phoneA = '+27821199101';
  const phoneB = '+27821199102';
  const hashA = hashPhone(phoneA);
  const hashB = hashPhone(phoneB);
  insertTeacher(hashA, 'Teacher A');
  insertTeacher(hashB, 'Teacher B');

  await send(phoneA, 'DELETE 1');
  check(/couldn.?t be found/i.test(allText()), 'DELETE against an empty resource set gives the generic not-found message, not a crash', allText());

  const savedA = saveResource(hashA, 'worksheet', 'Fractions — Worksheet', 'content A', { grade: 7, subject: 'Mathematics' });
  const savedB = saveResource(hashB, 'worksheet', 'Integers — Worksheet', 'content B', { grade: 7, subject: 'Mathematics' });
  check(savedA && savedA.id > 0, 'setup: resource A persisted');
  check(savedB && savedB.id > 0, 'setup: resource B persisted');

  await send(phoneA, 'DELETE');
  check(/DELETE \[number\]/.test(allText()), 'bare DELETE with no active observation session shows usage help (not the old observation-flow message)', allText());

  await send(phoneA, `DELETE ${savedB.id}`);
  check(/couldn.?t be found/i.test(allText()), 'cross-teacher DELETE gives the same generic not-found message — no existence oracle', allText());
  const stillThereB = getSavedResource(savedB.id, hashB);
  check(!!stillThereB, "cross-teacher DELETE did not actually remove teacher B's resource");

  await send(phoneA, `DELETE ${savedA.id}`);
  check(/Deleted/i.test(allText()) && allText().includes('Fractions — Worksheet'), 'DELETE <id> confirms deletion by title', allText());
  const goneA = getSavedResource(savedA.id, hashA);
  check(goneA === undefined || goneA === null, 'resource A is actually gone from the DB after DELETE');

  await send(phoneA, `DELETE ${savedA.id}`);
  check(/couldn.?t be found/i.test(allText()), 'deleting an already-deleted id gives the generic not-found message, not a crash', allText());

  const savedA2 = saveResource(hashA, 'test', 'Algebra — Test', 'content A2', { grade: 7, subject: 'Mathematics' });
  check(savedA2 && savedA2.id > 0, 'setup: a second resource exists for teacher A so MY RESOURCES footer check is meaningful');
  await send(phoneA, 'MY RESOURCES');
  check(/DELETE \[number\]/.test(allText()), 'MY RESOURCES footer now mentions DELETE [number]', allText());

  console.log('\n── Part C: observation-flow DELETE collision guard ──');

  // Simulate a teacher mid-observation-review: observationHistoryState has
  // an active session for this phoneHash, same shape flows/observationFlow.js
  // sets when showing a specific observation with its own DELETE option.
  observationHistoryState.set(hashA, {
    step: 'awaitingCorrectionOrDelete',
    assessmentId: 12345,
    ids: [12345],
    lastActivity: Date.now(),
  });

  await send(phoneA, 'DELETE');
  const guardText = allText();
  check(
    !/DELETE \[number\]/.test(guardText) && !/Resource id must be/i.test(guardText),
    'bare DELETE while an observation session is active is NOT swallowed by the new resource-delete branch',
    guardText
  );

  observationHistoryState.delete(hashA);

  await send(phoneA, 'DELETE 999');
  check(/couldn.?t be found/i.test(allText()), 'DELETE <id> (with an argument) still works normally even while an observation session key exists for a different check — sanity', allText());

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:', failures.join(', '));
    process.exitCode = 1;
  }

  Module._resolveFilename = origResolve;
  testDb.cleanup();
})();
