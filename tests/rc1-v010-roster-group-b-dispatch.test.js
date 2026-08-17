'use strict';
// RC1-V-010 — Group B (ROSTER / ADD LEARNER / REMOVE LEARNER / CLEAR
// ROSTER) real-dispatch harness.
//
// Scope note (important for the RC1 evidence trail): this file does NOT
// re-prove roster state-machine correctness (PASTE validation, PREVIEW/
// SAVE/EDIT, MERGE vs REPLACE, soft-removal/un-removal, per-class
// isolation) — that is already genuinely covered, against real SQLite,
// by tests/roster-flow.test.js. What that file cannot prove is the
// dispatch/onboarding boundary, because it calls handleRosterFlow()
// directly rather than going through processMessage() -> commandHandler
// -> the onboarding gate -> rosterFlow (same blind spot RC1-H-006's
// header comment documents for the SAVE collision). This file exists to
// close exactly that gap, plus strengthen the REMOVE LEARNER "not found"
// assertion, which previously checked only response text and made no
// database assertion at all.
//
// Covers:
//   1. Brand-new teacher: ROSTER / ADD LEARNER / REMOVE LEARNER / CLEAR
//      ROSTER are all intercepted by onboarding; rosterState never set.
//   2. Mid-onboarding teacher: same four commands blocked; rosterState
//      never set.
//   3. Fully onboarded teacher: each command family genuinely reaches
//      rosterFlow through the real dispatch chain (gate doesn't
//      false-positive block legitimate users).
//   4. REMOVE LEARNER "not found": before/after DB invariants (total
//      learner rows, active roster count, classes.learner_count,
//      removed_at values, no new row) in addition to response text.
//
// This test deliberately exercises the REAL dispatch chain
// (processMessage -> commandHandler -> onboarding gate -> rosterFlow),
// following the pattern established by
// tests/rc1-h-006-save-roster-collision.test.js.
//
// Run: node tests/rc1-v010-roster-group-b-dispatch.test.js

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

function insertTeacherRowOnly(phoneHash) {
  // Brand-new: teachers row exists (as it would after any first inbound
  // message triggers profile bookkeeping) but NO onboarding row at all.
  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject) VALUES (?, ?, ?, ?)`)
    .run(phoneHash, null, null, null);
}

function insertMidOnboarding(phoneHash, step) {
  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject) VALUES (?, ?, ?, ?)`)
    .run(phoneHash, null, null, null);
  db.prepare(`
    INSERT INTO onboarding (phone_hash, step, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(phone_hash) DO UPDATE SET step = excluded.step
  `).run(phoneHash, step);
}

function insertFullyOnboarded(phoneHash) {
  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject) VALUES (?, ?, ?, ?)`)
    .run(phoneHash, 'Test Teacher', '7', 'Mathematics');
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
  return Number(result.lastInsertRowid);
}

function countTotalLearnerRows(classId) {
  return db.prepare(`SELECT COUNT(*) as c FROM learners WHERE class_id = ?`).get(classId).c;
}

function getClassLearnerCount(classId) {
  return db.prepare(`SELECT learner_count FROM classes WHERE id = ?`).get(classId).learner_count;
}

function getRemovedAtSnapshot(classId) {
  return db.prepare(`SELECT id, removed_at FROM learners WHERE class_id = ? ORDER BY id`).all(classId);
}

function makeMessage(from, body, id) {
  return { from, id, type: 'text', text: { body } };
}

(async () => {
  const {
    hashPhone,
    rosterState,
    processMessage,
    buildProcessMessageDeps,
  } = require('../routes/webhook').__testExports;
  const { getRoster, addLearner } = require('../services/learnerRosterService');

  // Seed a learner directly via the real service (not raw SQL) so seed
  // rows go through the same canonical_name/normalized_name resolution
  // as production, rather than hand-guessing schema columns.
  function seedLearner(phoneHash, classId, name) {
    addLearner(phoneHash, classId, name);
  }

  let msgCounter = 0;
  async function send(phone, body) {
    msgCounter += 1;
    await processMessage(makeMessage(phone, body, `msg-${msgCounter}`), buildProcessMessageDeps());
  }
  function lastMessage() {
    return sentMessages[sentMessages.length - 1]?.text || '';
  }

  const rosterCommands = [
    'ROSTER',
    'ADD LEARNER Test Learner',
    'REMOVE LEARNER Test Learner',
    'CLEAR ROSTER',
  ];

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── 1. Brand-new teacher: all four roster commands blocked by onboarding ──');
  {
    let n = 0;
    for (const cmd of rosterCommands) {
      n += 1;
      const phone = `+2782120${n.toString().padStart(2, '0')}01`;
      const phoneHash = hashPhone(phone);
      insertTeacherRowOnly(phoneHash);

      sentMessages.length = 0;
      await send(phone, cmd);

      check(
        !/paste your list|added \*|couldn't find|roster \(|no roster yet/i.test(lastMessage()),
        `1-${n}: "${cmd}" from a brand-new teacher does NOT produce a roster-flow response`
      );
      check(
        rosterState.get(phoneHash) === undefined,
        `1-${n}: "${cmd}" from a brand-new teacher leaves rosterState unset`
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── 2. Mid-onboarding teacher: all four roster commands blocked ──');
  {
    let n = 0;
    for (const cmd of rosterCommands) {
      n += 1;
      const phone = `+2782120${n.toString().padStart(2, '0')}02`;
      const phoneHash = hashPhone(phone);
      insertMidOnboarding(phoneHash, 'ask_grade');

      sentMessages.length = 0;
      await send(phone, cmd);

      check(
        !/paste your list|added \*|couldn't find|roster \(|no roster yet/i.test(lastMessage()),
        `2-${n}: "${cmd}" from a mid-onboarding teacher does NOT produce a roster-flow response`
      );
      check(
        rosterState.get(phoneHash) === undefined,
        `2-${n}: "${cmd}" from a mid-onboarding teacher leaves rosterState unset`
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── 3. Fully onboarded teacher: each command family genuinely reaches rosterFlow ──');
  {
    // 3a. ROSTER — single class, empty roster -> straight to PASTE prompt
    const phoneA = '+27821170301';
    const phoneHashA = hashPhone(phoneA);
    insertFullyOnboarded(phoneHashA);
    const classA = insertClass(phoneHashA, 'RC1-V-010 Class A');

    sentMessages.length = 0;
    await send(phoneA, 'ROSTER');
    check(/paste your list/i.test(lastMessage()), '3a: ROSTER from a fully onboarded teacher reaches rosterFlow (PASTE prompt)');
    check(rosterState.get(phoneHashA)?.step === 'paste', '3a: rosterState session created at PASTE step');

    // 3b. ADD LEARNER — single-turn command, no session required
    const phoneB = '+27821170302';
    const phoneHashB = hashPhone(phoneB);
    insertFullyOnboarded(phoneHashB);
    const classB = insertClass(phoneHashB, 'RC1-V-010 Class B');

    sentMessages.length = 0;
    await send(phoneB, 'ADD LEARNER Dispatch Test Learner');
    check(/Added \*Dispatch Test Learner\*/.test(lastMessage()), '3b: ADD LEARNER reaches rosterFlow and adds the learner');
    check(getRoster(phoneHashB, classB).some((l) => l.name === 'Dispatch Test Learner'), '3b: learner is actually persisted via real dispatch');

    // 3c. REMOVE LEARNER — remove the learner just added via real dispatch
    sentMessages.length = 0;
    await send(phoneB, 'REMOVE LEARNER Dispatch Test Learner');
    check(/Removed \*Dispatch Test Learner\*/.test(lastMessage()), '3c: REMOVE LEARNER reaches rosterFlow and removes the learner');
    check(!getRoster(phoneHashB, classB).some((l) => l.name === 'Dispatch Test Learner'), '3c: learner no longer on active roster after real dispatch');

    // 3d. CLEAR ROSTER — reaches confirmation step (does not clear immediately)
    const phoneC = '+27821170303';
    const phoneHashC = hashPhone(phoneC);
    insertFullyOnboarded(phoneHashC);
    const classC = insertClass(phoneHashC, 'RC1-V-010 Class C');
    seedLearner(phoneHashC, classC, 'Seed Learner');

    sentMessages.length = 0;
    await send(phoneC, 'CLEAR ROSTER');
    check(rosterState.get(phoneHashC)?.step === 'confirmClear', '3d: CLEAR ROSTER reaches rosterFlow and requires confirmation');
    check(getRoster(phoneHashC, classC).length === 1, '3d: roster untouched before confirmation, via real dispatch');
  }

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── 4. REMOVE LEARNER "not found" — DB invariants, not just response text ──');
  {
    const phone = '+27821170401';
    const phoneHash = hashPhone(phone);
    insertFullyOnboarded(phoneHash);
    const classId = insertClass(phoneHash, 'RC1-V-010 Class D');
    seedLearner(phoneHash, classId, 'Existing Learner One');
    seedLearner(phoneHash, classId, 'Existing Learner Two');

    const before = {
      totalRows: countTotalLearnerRows(classId),
      activeCount: getRoster(phoneHash, classId).length,
      learnerCount: getClassLearnerCount(classId),
      removedAts: getRemovedAtSnapshot(classId),
    };
    check(before.totalRows === 2, 'setup: 2 learner rows exist before the not-found attempt');
    check(before.activeCount === 2, 'setup: 2 active roster entries before the not-found attempt');

    sentMessages.length = 0;
    await send(phone, 'REMOVE LEARNER Someone Nonexistent');

    check(/Couldn't find/i.test(lastMessage()), '4-A: response text confirms the "not found" message');

    const after = {
      totalRows: countTotalLearnerRows(classId),
      activeCount: getRoster(phoneHash, classId).length,
      learnerCount: getClassLearnerCount(classId),
      removedAts: getRemovedAtSnapshot(classId),
    };

    check(after.totalRows === before.totalRows, '4-B: total learner row count unchanged');
    check(after.activeCount === before.activeCount, '4-C: active roster count unchanged');
    check(after.learnerCount === before.learnerCount, '4-D: classes.learner_count unchanged');
    check(
      JSON.stringify(after.removedAts) === JSON.stringify(before.removedAts),
      '4-E: existing learners\' removed_at values unchanged (identical ids and values)'
    );
    check(after.totalRows === 2, '4-F: no new learner row was created (still exactly 2 rows)');
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
