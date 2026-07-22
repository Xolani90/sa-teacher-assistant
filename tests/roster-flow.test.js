'use strict';
/**
 * Roster Flow Tests (ADR-006 PR3 — WhatsApp roster management).
 *
 * Exercises handleRosterFlow() end-to-end against a real (throwaway,
 * file-backed) SQLite DB via runMigrations() — same node:sqlite shim
 * convention as tests/learner-roster-service.test.js — so this fails if
 * the real `learners`/`classes` schema (including Migration 031's
 * removed_at) ever drifts from what rosterFlow.js/learnerRosterService.js
 * assume. getTeacherClasses is a plain fixture function (not
 * teacherWorkspaceService), matching tests/assessment-session-flow.test.js's
 * convention of isolating the flow's own state-machine logic from
 * unrelated services.
 *
 * Covers:
 *   1. Zero classes -> guidance, no session.
 *   2. Single class -> action runs immediately, no class-selection prompt.
 *   3. 2+ classes -> SELECT_CLASS prompt, invalid replies rejected in place.
 *   4. ROSTER on an empty roster -> straight to PASTE (no mode prompt).
 *   5. ROSTER on an existing roster -> CHOOSE_MODE (REPLACE/MERGE) required.
 *   6. PASTE rejects invalid pastes (blank line, duplicate) in place with
 *      per-line errors and no state change.
 *   7. PREVIEW requires an explicit SAVE; EDIT loops back to PASTE.
 *   8. REPLACE mode soft-removes learners missing from the new paste;
 *      MERGE mode does not.
 *   9. ADD LEARNER / REMOVE LEARNER single-turn commands.
 *  10. CLEAR ROSTER requires YES/NO confirmation.
 *  11. CANCEL works from every step.
 *  12. Rosters and removals are isolated per class.
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
  const { formatClassSelectionPrompt, matchClassSelection } = require('../utils/classContext');
  const { handleRosterFlow } = require('../flows/rosterFlow');
  const { getRoster } = require('../services/learnerRosterService');

  const rosterState = new SessionStore('roster', 30 * 60 * 1000);

  const PHONE = '+27831234567';
  const hashPhone = (p) => `hash_${p}`;
  const phoneHash = hashPhone(PHONE);

  const now = new Date().toISOString();
  db.prepare(`INSERT INTO teachers (phone_hash, created_at, updated_at) VALUES (?, ?, ?)`)
    .run(phoneHash, now, now);

  function makeClass(name, grade = 5, subject = 'Mathematics') {
    const result = db.prepare(`
      INSERT INTO classes (phone_hash, name, grade, subject, learner_count)
      VALUES (?, ?, ?, ?, 0)
    `).run(phoneHash, name, grade, subject);
    return Number(result.lastInsertRowid);
  }

  let classesFixture = [];
  const sentMessages = [];

  const deps = {
    hashPhone,
    safeSendMessage: async (to, msg) => { sentMessages.push({ to, msg }); },
    rosterState,
    getTeacherClasses: () => classesFixture,
    formatClassSelectionPrompt,
    matchClassSelection,
  };

  function lastMessage() {
    return sentMessages[sentMessages.length - 1]?.msg || '';
  }

  async function send(text) {
    sentMessages.length = 0;
    return handleRosterFlow(PHONE, text, null, null, deps);
  }

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 1: zero classes ─────────────────────────────────────────');
  classesFixture = [];
  let handled = await send('ROSTER');
  assert(handled === true, 'ROSTER is handled even with no classes');
  assert(/don't have any classes/i.test(lastMessage()), 'guidance message when no classes exist');
  assert(rosterState.get(phoneHash) === undefined, 'no session was created');

  handled = await send('hello there');
  assert(handled === false, 'non-command text falls through unhandled');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 2: single class — ROSTER on an empty roster ─────────────');
  const classA = makeClass('Grade 5B');
  classesFixture = [{ id: classA, name: 'Grade 5B', grade: 5, subject: 'Mathematics', learner_count: 0 }];

  handled = await send('ROSTER');
  assert(handled === true, 'ROSTER handled with a single class');
  let state = rosterState.get(phoneHash);
  assert(state && state.step === 'paste', 'single class + empty roster skips straight to PASTE (no mode prompt)');
  assert(/Paste your list/i.test(lastMessage()), 'prompt asks for a pasted list');

  // Invalid paste: blank line + duplicate
  await send('Sipho Dlamini\n\nAyanda Nkosi\nSipho Dlamini');
  assert(/Line 2: Blank line/i.test(lastMessage()), 'blank line reported with correct line number');
  assert(/Line 4: Duplicate of line 1/i.test(lastMessage()), 'duplicate reported against its first occurrence');
  state = rosterState.get(phoneHash);
  assert(state.step === 'paste', 'state unchanged after invalid paste — no partial save');
  assert(getRoster(phoneHash, classA).length === 0, 'nothing written to the DB after invalid paste');

  // Valid paste
  await send('1. Sipho Dlamini\n2) Ayanda Nkosi\nLebo Molefe');
  state = rosterState.get(phoneHash);
  assert(state.step === 'preview', 'valid paste advances to PREVIEW');
  assert(state.names.length === 3, 'three names parsed onto state');
  assert(/3 learners parsed/i.test(lastMessage()), 'preview message reports the count');
  assert(/Sipho Dlamini/.test(lastMessage()) && /Ayanda Nkosi/.test(lastMessage()), 'preview lists the parsed names');
  assert(/Reply \*SAVE\*/.test(lastMessage()), 'preview asks for SAVE');

  // Garbage reply at PREVIEW doesn't save
  await send('whatever');
  assert(/Reply \*SAVE\*/.test(lastMessage()), 'unrecognized reply at PREVIEW re-prompts');
  assert(getRoster(phoneHash, classA).length === 0, 'still nothing written before SAVE');

  // EDIT loops back to PASTE
  await send('EDIT');
  state = rosterState.get(phoneHash);
  assert(state.step === 'paste', 'EDIT loops back to PASTE');
  await send('Sipho Dlamini\nAyanda Nkosi\nLebo Molefe');
  state = rosterState.get(phoneHash);
  assert(state.step === 'preview', 'back at PREVIEW after re-pasting');

  await send('SAVE');
  assert(rosterState.get(phoneHash) === undefined, 'session cleared after SAVE');
  assert(/Roster saved/i.test(lastMessage()), 'SAVE confirms the roster was saved');
  assert(/3 added, 0 matched/.test(lastMessage()), 'SAVE reports added/matched counts');
  let roster = getRoster(phoneHash, classA);
  assert(roster.length === 3, 'roster now has three learners');
  assert(roster.map((l) => l.name).join(',') === 'Sipho Dlamini,Ayanda Nkosi,Lebo Molefe', 'roster preserves paste order');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 3: ROSTER on an existing roster — CHOOSE_MODE gate ──────');
  handled = await send('ROSTER');
  state = rosterState.get(phoneHash);
  assert(state.step === 'chooseMode', 'ROSTER on a non-empty roster requires REPLACE/MERGE first');
  assert(/already has a roster/i.test(lastMessage()), 'mode prompt mentions the existing roster');

  await send('nonsense');
  assert(/REPLACE.*MERGE/i.test(lastMessage()), 'unrecognized reply at CHOOSE_MODE re-prompts');
  state = rosterState.get(phoneHash);
  assert(state.step === 'chooseMode', 'state unchanged after invalid mode reply');

  await send('MERGE');
  state = rosterState.get(phoneHash);
  assert(state.step === 'paste' && state.mode === 'merge', 'MERGE selected, advances to PASTE');

  // MERGE: pasting a subset + one new name should not remove the missing one
  await send('Sipho Dlamini\nZanele Khumalo');
  await send('SAVE');
  roster = getRoster(phoneHash, classA);
  assert(roster.length === 4, 'MERGE adds the new name without removing the omitted ones');
  assert(roster.some((l) => l.name === 'Ayanda Nkosi'), 'Ayanda Nkosi (omitted from the merge paste) is still on the roster');
  assert(roster.some((l) => l.name === 'Zanele Khumalo'), 'newly merged name is on the roster');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 4: REPLACE mode soft-removes omitted learners ───────────');
  await send('ROSTER');
  await send('REPLACE');
  state = rosterState.get(phoneHash);
  assert(state.mode === 'replace', 'REPLACE selected');

  await send('Sipho Dlamini\nAyanda Nkosi');
  await send('SAVE');
  assert(/2 added, 2 matched, 2 removed|0 added, 2 matched, 2 removed/.test(lastMessage()), 'SAVE reports a removed count in REPLACE mode');
  roster = getRoster(phoneHash, classA);
  assert(roster.length === 2, 'REPLACE leaves only the re-pasted names on the active roster');
  assert(roster.map((l) => l.name).sort().join(',') === 'Ayanda Nkosi,Sipho Dlamini', 'only the re-pasted names remain');

  // Re-adding a name that was just soft-removed un-removes the same identity
  await send('ROSTER');
  await send('MERGE');
  await send('Sipho Dlamini\nAyanda Nkosi\nLebo Molefe');
  await send('SAVE');
  roster = getRoster(phoneHash, classA);
  assert(roster.length === 3, 'previously soft-removed learner (Lebo Molefe) is un-removed, not duplicated');
  const leboCount = roster.filter((l) => l.name === 'Lebo Molefe').length;
  assert(leboCount === 1, 'Lebo Molefe appears exactly once (identity match, not a duplicate row)');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 5: ADD LEARNER / REMOVE LEARNER single-turn commands ────');
  handled = await send('ADD LEARNER Nomvula Zulu');
  assert(handled === true, 'ADD LEARNER handled');
  assert(rosterState.get(phoneHash) === undefined, 'ADD LEARNER with a single class needs no session');
  assert(/Added \*Nomvula Zulu\*/.test(lastMessage()), 'confirms the learner was added');
  roster = getRoster(phoneHash, classA);
  assert(roster.some((l) => l.name === 'Nomvula Zulu'), 'Nomvula Zulu is now on the roster');

  await send('ADD LEARNER Nomvula Zulu');
  assert(/already on/i.test(lastMessage()), 'adding an already-present name is a safe no-op, not a duplicate');
  assert(getRoster(phoneHash, classA).filter((l) => l.name === 'Nomvula Zulu').length === 1, 'still exactly one Nomvula Zulu');

  handled = await send('REMOVE LEARNER Nomvula Zulu');
  assert(handled === true, 'REMOVE LEARNER handled');
  assert(/Removed \*Nomvula Zulu\*/.test(lastMessage()), 'confirms the learner was removed');
  assert(!getRoster(phoneHash, classA).some((l) => l.name === 'Nomvula Zulu'), 'Nomvula Zulu no longer on the active roster');

  await send('REMOVE LEARNER Someone Nonexistent');
  assert(/Couldn't find/i.test(lastMessage()), "removing a name that isn't on the roster gives clear feedback, doesn't throw");

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 6: CLEAR ROSTER requires YES/NO confirmation ────────────');
  handled = await send('CLEAR ROSTER');
  assert(handled === true, 'CLEAR ROSTER handled');
  state = rosterState.get(phoneHash);
  assert(state.step === 'confirmClear', 'CLEAR ROSTER requires confirmation, does not clear immediately');
  assert(getRoster(phoneHash, classA).length > 0, 'roster untouched before confirmation');

  await send('NO');
  assert(/left unchanged/i.test(lastMessage()), 'NO cancels the clear');
  assert(rosterState.get(phoneHash) === undefined, 'session cleared after NO');
  assert(getRoster(phoneHash, classA).length > 0, 'roster still intact after declining');

  const sizeBeforeClear = getRoster(phoneHash, classA).length;
  await send('CLEAR ROSTER');
  await send('YES');
  assert(/Cleared/.test(lastMessage()), 'YES confirms the clear');
  assert(lastMessage().includes(String(sizeBeforeClear)), 'confirmation reports how many were cleared');
  assert(getRoster(phoneHash, classA).length === 0, 'active roster is now empty');
  assert(rosterState.get(phoneHash) === undefined, 'session cleared after YES');

  handled = await send('CLEAR ROSTER');
  assert(/no roster to clear/i.test(lastMessage()), 'CLEAR ROSTER on an already-empty roster short-circuits with no confirmation step');
  assert(rosterState.get(phoneHash) === undefined, 'no session created for an already-empty roster');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 7: CANCEL works from every step ──────────────────────────');
  await send('ROSTER'); // empty roster -> straight to PASTE
  await send('CANCEL');
  assert(/cancelled/i.test(lastMessage()), 'CANCEL confirms cancellation at PASTE');
  assert(rosterState.get(phoneHash) === undefined, 'session removed after CANCEL at PASTE');

  await send('ROSTER'); // empty roster -> straight to PASTE again
  await send('Rebuild One\nRebuild Two');
  await send('SAVE'); // roster now non-empty again
  await send('ROSTER'); // -> CHOOSE_MODE
  await send('CANCEL');
  assert(rosterState.get(phoneHash) === undefined, 'CANCEL works at CHOOSE_MODE');

  await send('ROSTER');
  await send('MERGE');
  await send('CANCEL'); // at PASTE
  assert(rosterState.get(phoneHash) === undefined, 'CANCEL works at PASTE after choosing a mode');

  await send('ROSTER');
  await send('MERGE');
  await send('Rebuild One\nRebuild Two\nRebuild Three');
  await send('CANCEL'); // at PREVIEW
  assert(rosterState.get(phoneHash) === undefined, 'CANCEL works at PREVIEW');
  assert(getRoster(phoneHash, classA).length === 2, 'nothing was saved after cancelling at PREVIEW');

  await send('CLEAR ROSTER');
  await send('CANCEL'); // at CONFIRM_CLEAR — CANCEL, not just NO, also works
  assert(rosterState.get(phoneHash) === undefined, 'CANCEL works at CONFIRM_CLEAR');
  assert(getRoster(phoneHash, classA).length === 2, 'roster untouched after CANCEL at CONFIRM_CLEAR');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 8: 2+ classes — SELECT_CLASS prompt ──────────────────────');
  const classB = makeClass('Grade 6A', 6, 'Mathematics');
  classesFixture = [
    { id: classA, name: 'Grade 5B', grade: 5, subject: 'Mathematics', learner_count: 2 },
    { id: classB, name: 'Grade 6A', grade: 6, subject: 'Mathematics', learner_count: 0 },
  ];

  handled = await send('LIST ROSTER');
  assert(handled === true, 'LIST ROSTER handled with 2 classes');
  state = rosterState.get(phoneHash);
  assert(state && state.step === 'selectClass', '2+ classes requires a SELECT_CLASS prompt');
  assert(state.action === 'list', 'pending action recorded as list');
  assert(/Which \*class\*/i.test(lastMessage()), 'class selection prompt shown');

  await send('99');
  assert(/reply with a number/i.test(lastMessage()), 'out-of-range class reply rejected');
  state = rosterState.get(phoneHash);
  assert(state.step === 'selectClass', 'state unchanged after invalid class reply');

  await send('2'); // Grade 6A, empty roster
  assert(rosterState.get(phoneHash) === undefined, 'LIST ROSTER completes in a single turn once class is chosen');
  assert(/no roster yet/i.test(lastMessage()), 'LIST ROSTER on the empty class 6A roster gives clear guidance');

  await send('LIST ROSTER');
  await send('1'); // Grade 5B, populated roster
  assert(/Grade 5B\* roster \(2 learners\)/.test(lastMessage()), 'LIST ROSTER on class 5B reports the right roster');
  assert(/Rebuild One/.test(lastMessage()) && /Rebuild Two/.test(lastMessage()), 'LIST ROSTER lists the actual names');

  // ADD LEARNER with 2 classes routes to the chosen class only
  await send('ADD LEARNER Thabo Sithole');
  state = rosterState.get(phoneHash);
  assert(state.step === 'selectClass' && state.action === 'add', 'ADD LEARNER also requires class selection with 2+ classes');
  assert(state.payload.name === 'Thabo Sithole', 'pending name carried through the class-selection prompt');
  await send('2'); // Grade 6A
  assert(/Added \*Thabo Sithole\*/.test(lastMessage()), 'learner added after class selection');
  assert(getRoster(phoneHash, classB).some((l) => l.name === 'Thabo Sithole'), 'Thabo Sithole added to class 6A specifically');
  assert(!getRoster(phoneHash, classA).some((l) => l.name === 'Thabo Sithole'), 'class 5B roster is unaffected — rosters are isolated per class');

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60));

  try { db.close(); } catch (_) {}
  try {
    if (fs.existsSync(process.env.DB_PATH)) fs.unlinkSync(process.env.DB_PATH);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[test cleanup] could not remove ${process.env.DB_PATH}: ${err.code}`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
