'use strict';
/**
 * rosterFlow tests (ADR-006 PR3 — WhatsApp Roster Management).
 *
 * Exercises handleRosterFlow end-to-end against a real (throwaway,
 * file-backed) SQLite DB via runMigrations() — same node:sqlite shim
 * convention as tests/learner-roster-service.test.js — with a fake
 * safeSendMessage that just records what was sent, so assertions can
 * check the actual teacher-facing copy.
 *
 * Run individually: node tests/roster-flow.test.js
 * Run via npm:       npm test
 */

const path = require('path');
const fs = require('fs');

const Module = require('module');
const { DatabaseSync } = require('node:sqlite');

let _db = null;

const _origResolve = Module._resolveFilename.bind(Module);
Module._resolveFilename = function (request, parent, isMain, opts) {
  if (request === 'better-sqlite3') return request;
  return _origResolve(request, parent, isMain, opts);
};
require.cache['better-sqlite3'] = {
  id: 'better-sqlite3',
  filename: 'better-sqlite3',
  loaded: true,
  exports: function Database() {
    if (!_db.pragma) _db.pragma = () => {};
    return _db;
  },
};

process.env.DB_PATH = path.join(__dirname, '..', 'roster-flow-test.db');
if (fs.existsSync(process.env.DB_PATH)) fs.unlinkSync(process.env.DB_PATH);
_db = new DatabaseSync(process.env.DB_PATH);

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

async function run() {
  const { getDb, runMigrations } = require('../utils/database');
  runMigrations();
  const db = getDb();

  const { SessionStore } = require('../utils/sessionStore');
  const { handleRosterFlow } = require('../flows/rosterFlow');
  const { getTeacherClasses } = require('../services/teacherWorkspaceService');
  const { getRoster } = require('../services/learnerRosterService');

  const rosterState = new SessionStore('roster', 20 * 60 * 1000);

  const PHONE_A = 'roster-flow-teacher-a';
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO teachers (phone_hash, created_at, updated_at) VALUES (?, ?, ?)`).run(PHONE_A, now, now);

  function makeClass(phoneHash, name, grade, subject) {
    const r = db.prepare(`
      INSERT INTO classes (phone_hash, name, grade, subject, learner_count)
      VALUES (?, ?, ?, ?, 0)
    `).run(phoneHash, name, grade, subject);
    return Number(r.lastInsertRowid);
  }

  let sent;
  function resetSent() { sent = []; }
  async function safeSendMessage(from, text) { sent.push({ from, text }); }
  function lastMessage() { return sent.length ? sent[sent.length - 1].text : ''; }

  const deps = {
    hashPhone: (from) => from, // identity — tests pass phone hashes directly as "from"
    safeSendMessage,
    rosterState,
    getTeacherClasses,
  };

  console.log('\n── Section 1: unrelated text with no session is not handled ────────');
  {
    resetSent();
    const handled = await handleRosterFlow(PHONE_A, 'hello there', null, null, deps);
    assert(handled === false, 'handleRosterFlow returns false for non-command text with no session');
    assert(sent.length === 0, 'nothing sent');
  }

  console.log('\n── Section 2: ROSTER with a single class skips CHOOSE_CLASS ────────');
  const classId1 = makeClass(PHONE_A, 'Grade 4A', 4, 'Mathematics');
  {
    resetSent();
    const handled = await handleRosterFlow(PHONE_A, 'ROSTER', null, null, deps);
    assert(handled === true, 'ROSTER is handled');
    assert(/Paste the learner names/.test(lastMessage()), 'goes straight to paste instructions (only one class)');
    assert(rosterState.get(PHONE_A).step === 'paste', 'session step is PASTE');
  }

  console.log('\n── Section 3: PASTE rejects a blank line without saving ─────────────');
  {
    resetSent();
    const handled = await handleRosterFlow(PHONE_A, 'Sipho Dlamini\n\nAyanda Nkosi', null, null, deps);
    assert(handled === true, 'invalid paste still handled (re-prompts, does not fall through)');
    assert(/blank line/.test(lastMessage()), 'blank line error surfaced to the teacher');
    assert(getRoster(PHONE_A, classId1).length === 0, 'nothing was saved');
    assert(rosterState.get(PHONE_A).step === 'paste', 'still in PASTE step after a rejected paste');
  }

  console.log('\n── Section 4: PASTE rejects a duplicate name ────────────────────────');
  {
    resetSent();
    await handleRosterFlow(PHONE_A, 'Sipho Dlamini\nAyanda Nkosi\nsipho dlamini', null, null, deps);
    assert(/duplicate/i.test(lastMessage()), 'duplicate error surfaced to the teacher');
    assert(getRoster(PHONE_A, classId1).length === 0, 'nothing was saved');
  }

  console.log('\n── Section 5: valid paste moves to PREVIEW, SAVE commits it ────────');
  {
    resetSent();
    const handled = await handleRosterFlow(PHONE_A, 'Sipho Dlamini\nAyanda Nkosi\nLebo Molefe', null, null, deps);
    assert(handled === true, 'valid paste handled');
    assert(/Reply \*SAVE\*/.test(lastMessage()), 'moves to preview, asking for SAVE');
    assert(rosterState.get(PHONE_A).step === 'preview', 'session step is PREVIEW');

    resetSent();
    await handleRosterFlow(PHONE_A, 'save', null, null, deps);
    assert(/Roster saved/.test(lastMessage()), 'confirms the roster was saved');
    assert(rosterState.get(PHONE_A) === undefined, 'session cleared after save');

    const roster = getRoster(PHONE_A, classId1);
    assert(roster.length === 3, 'three learners now on the roster');
    assert(roster.map((l) => l.name).join(',') === 'Sipho Dlamini,Ayanda Nkosi,Lebo Molefe', 'names saved in paste order');
  }

  console.log('\n── Section 6: CANCEL mid-flow discards without saving ───────────────');
  {
    resetSent();
    await handleRosterFlow(PHONE_A, 'ADD LEARNER', null, null, deps);
    assert(rosterState.get(PHONE_A).step === 'enterName', 'ADD LEARNER enters the name-entry step');

    resetSent();
    await handleRosterFlow(PHONE_A, 'CANCEL', null, null, deps);
    assert(/cancelled/i.test(lastMessage()), 'cancellation confirmed to the teacher');
    assert(rosterState.get(PHONE_A) === undefined, 'session cleared on cancel');
    assert(getRoster(PHONE_A, classId1).length === 3, 'roster unchanged by the cancelled ADD LEARNER');
  }

  console.log('\n── Section 7: ADD LEARNER happy path ────────────────────────────────');
  {
    resetSent();
    await handleRosterFlow(PHONE_A, 'ADD LEARNER', null, null, deps);
    resetSent();
    await handleRosterFlow(PHONE_A, 'Naledi Mokoena', null, null, deps);
    assert(/Added:/.test(lastMessage()), 'confirms the learner was added');
    assert(getRoster(PHONE_A, classId1).length === 4, 'roster grew by one');
  }

  console.log('\n── Section 8: REMOVE LEARNER happy path ─────────────────────────────');
  {
    resetSent();
    await handleRosterFlow(PHONE_A, 'REMOVE LEARNER', null, null, deps);
    assert(rosterState.get(PHONE_A).step === 'chooseLearner', 'REMOVE LEARNER lists the roster for selection');

    const roster = getRoster(PHONE_A, classId1);
    const targetIdx = roster.findIndex((l) => l.name === 'Naledi Mokoena') + 1;

    resetSent();
    await handleRosterFlow(PHONE_A, String(targetIdx), null, null, deps);
    assert(/Remove Naledi Mokoena/.test(lastMessage()), 'asks for confirmation naming the right learner');
    assert(rosterState.get(PHONE_A).step === 'confirmRemove', 'session step is CONFIRM_REMOVE');

    resetSent();
    await handleRosterFlow(PHONE_A, 'YES', null, null, deps);
    assert(/Removed Naledi Mokoena/.test(lastMessage()), 'confirms the removal');
    assert(getRoster(PHONE_A, classId1).length === 3, 'roster shrank by one');
    assert(rosterState.get(PHONE_A) === undefined, 'session cleared after removal');
  }

  console.log('\n── Section 9: LIST ROSTER shows the roster and offers follow-ups ──');
  {
    resetSent();
    await handleRosterFlow(PHONE_A, 'LIST ROSTER', null, null, deps);
    assert(/Sipho Dlamini/.test(lastMessage()), 'roster contents shown');
    assert(/\*ADD\*/.test(lastMessage()) && /\*REMOVE\*/.test(lastMessage()) && /\*REPLACE\*/.test(lastMessage()), 'offers ADD/REMOVE/REPLACE follow-ups');
    assert(rosterState.get(PHONE_A).step === 'list', 'session step is LIST');

    resetSent();
    await handleRosterFlow(PHONE_A, 'ADD', null, null, deps);
    assert(rosterState.get(PHONE_A).step === 'enterName', 'LIST ROSTER -> ADD reaches the same name-entry step ADD LEARNER uses');

    resetSent();
    await handleRosterFlow(PHONE_A, 'CANCEL', null, null, deps);
  }

  console.log('\n── Section 10: ROSTER on a class with an existing roster asks REPLACE/MERGE ──');
  {
    resetSent();
    await handleRosterFlow(PHONE_A, 'ROSTER', null, null, deps);
    assert(/REPLACE/.test(lastMessage()) && /MERGE/.test(lastMessage()), 'offers REPLACE/MERGE/CANCEL, not straight to paste');
    assert(rosterState.get(PHONE_A).step === 'chooseMode', 'session step is CHOOSE_MODE');

    resetSent();
    await handleRosterFlow(PHONE_A, 'REPLACE', null, null, deps);
    assert(rosterState.get(PHONE_A).mode === 'replace', 'mode recorded as replace');
    assert(rosterState.get(PHONE_A).step === 'paste', 'moves on to PASTE');

    resetSent();
    await handleRosterFlow(PHONE_A, 'Zanele Khumalo\nBongani Zulu', null, null, deps);
    resetSent();
    await handleRosterFlow(PHONE_A, 'SAVE', null, null, deps);
    assert(/removed/.test(lastMessage()), 'REPLACE save reports removals of names left off the new list');

    const roster = getRoster(PHONE_A, classId1);
    assert(roster.length === 2, 'REPLACE left exactly the two re-pasted learners');
    assert(roster.map((l) => l.name).sort().join(',') === 'Bongani Zulu,Zanele Khumalo', 'roster now matches the replacement list exactly');
  }

  console.log('\n── Section 11: CLEAR ROSTER happy path ──────────────────────────────');
  {
    resetSent();
    await handleRosterFlow(PHONE_A, 'CLEAR ROSTER', null, null, deps);
    assert(/can't be undone/.test(lastMessage()), 'warns before clearing');
    assert(rosterState.get(PHONE_A).step === 'confirmClear', 'session step is CONFIRM_CLEAR');

    resetSent();
    await handleRosterFlow(PHONE_A, 'YES', null, null, deps);
    assert(/Cleared 2 learner/.test(lastMessage()), 'confirms how many were cleared');
    assert(getRoster(PHONE_A, classId1).length === 0, 'roster is empty');
  }

  console.log('\n── Section 12: multiple classes -> CHOOSE_CLASS step ────────────────');
  const classId2 = makeClass(PHONE_A, 'Grade 5B', 5, 'Mathematics');
  {
    resetSent();
    await handleRosterFlow(PHONE_A, 'ROSTER', null, null, deps);
    assert(/Choose a Class/.test(lastMessage()), 'two classes now exist, so CHOOSE_CLASS is shown');
    assert(rosterState.get(PHONE_A).step === 'chooseClass', 'session step is CHOOSE_CLASS');

    resetSent();
    await handleRosterFlow(PHONE_A, '99', null, null, deps);
    assert(/Please reply with a number/.test(lastMessage()), 'out-of-range selection rejected');

    resetSent();
    await handleRosterFlow(PHONE_A, '2', null, null, deps);
    assert(/Paste the learner names for \*Grade 5B\*/.test(lastMessage()), 'second class selected correctly by number');

    resetSent();
    await handleRosterFlow(PHONE_A, 'CANCEL', null, null, deps);
  }

  console.log('\n── Section 13: a second teacher\'s roster is completely separate ────');
  const PHONE_B = 'roster-flow-teacher-b';
  db.prepare(`INSERT INTO teachers (phone_hash, created_at, updated_at) VALUES (?, ?, ?)`).run(PHONE_B, now, now);
  makeClass(PHONE_B, 'Grade 6A', 6, 'Mathematics');
  {
    resetSent();
    await handleRosterFlow(PHONE_B, 'ROSTER', null, null, deps);
    await handleRosterFlow(PHONE_B, 'Kagiso Molefe', null, null, deps);
    await handleRosterFlow(PHONE_B, 'SAVE', null, null, deps);
    assert(getRoster(PHONE_B, 1).length === 0 || true, 'sanity no-op'); // classId lookups differ per teacher; real check below
  }
  {
    const classesB = getTeacherClasses(PHONE_B);
    assert(getRoster(PHONE_B, classesB[0].id).length === 1, "teacher B's roster has their own learner");
    assert(getRoster(PHONE_A, classId2).length === 0, "teacher A's other class is untouched by teacher B's session");
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60));

  if (fs.existsSync(process.env.DB_PATH)) fs.unlinkSync(process.env.DB_PATH);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
