'use strict';
/**
 * learnerRosterService tests (ADR-006 PR2.5 — Class Roster Management,
 * extended by PR3 — ADD/REMOVE/CLEAR + REPLACE/MERGE modes).
 *
 * Exercises getRoster/setRoster/addLearner/removeLearner/clearRoster/
 * parseRosterPaste/validateRosterNames/formatRosterList against a real
 * (throwaway, file-backed) SQLite DB via runMigrations() — same
 * node:sqlite shim convention as tests/adr003-learners-migration.test.js —
 * so this fails if the real `learners`/`classes` schema (including
 * Migration 031's removed_at) ever drifts from what this module assumes.
 *
 * Run individually: node tests/learner-roster-service.test.js
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

process.env.DB_PATH = path.join(__dirname, '..', 'learner-roster-service-test.db');
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

  const PHONE_HASH = 'test-phone-hash';
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO teachers (phone_hash, created_at, updated_at) VALUES (?, ?, ?)`)
    .run(PHONE_HASH, now, now);
  const classResult = db.prepare(`
    INSERT INTO classes (phone_hash, name, grade, subject, learner_count)
    VALUES (?, 'Grade 5B', 5, 'Mathematics', 0)
  `).run(PHONE_HASH);
  const classId = Number(classResult.lastInsertRowid);

  const {
    getRoster,
    setRoster,
    addLearner,
    removeLearner,
    clearRoster,
    parseRosterPaste,
    validateRosterNames,
    formatRosterList,
  } = require('../services/learnerRosterService');

  console.log('\n── Section 1: parseRosterPaste ─────────────────────────────────────');
  {
    const parsed = parseRosterPaste('1. Sipho Dlamini\n2) Ayanda Nkosi\n\nLebo Molefe\r\n   \n');
    assert(parsed.length === 3, 'blank lines dropped, three names parsed');
    assert(parsed[0] === 'Sipho Dlamini', 'leading "1. " numbering stripped');
    assert(parsed[1] === 'Ayanda Nkosi', 'leading "2) " numbering stripped');
    assert(parsed[2] === 'Lebo Molefe', 'plain unnumbered line and CRLF handled');
  }

  console.log('\n── Section 2: setRoster on an empty class ──────────────────────────');
  {
    const { roster, added, matched } = setRoster(PHONE_HASH, classId, ['Sipho Dlamini', 'Ayanda Nkosi']);
    assert(roster.length === 2, 'roster has two learners');
    assert(added === 2, 'both names were newly added');
    assert(matched === 0, 'nothing matched on first insert');
    assert(roster[0].name === 'Sipho Dlamini', 'roster preserves insertion order (learner 1 first)');
    assert(roster[1].name === 'Ayanda Nkosi', 'roster preserves insertion order (learner 2 second)');

    const cls = db.prepare(`SELECT learner_count FROM classes WHERE id = ?`).get(classId);
    assert(cls.learner_count === 2, 'classes.learner_count kept in sync with roster size');
  }

  console.log('\n── Section 3: getRoster matches setRoster ──────────────────────────');
  {
    const roster = getRoster(PHONE_HASH, classId);
    assert(roster.length === 2, 'getRoster returns the same two learners');
    assert(roster.map((l) => l.name).join(',') === 'Sipho Dlamini,Ayanda Nkosi', 'order is stable across calls');
  }

  console.log('\n── Section 4: re-running setRoster is idempotent (identity match) ──');
  {
    const { roster, added, matched } = setRoster(PHONE_HASH, classId, ['Sipho Dlamini', 'Ayanda Nkosi', 'Lebo Molefe']);
    assert(roster.length === 3, 'roster grows to three, not duplicated to five');
    assert(matched === 2, 'the two existing names matched, not duplicated');
    assert(added === 1, 'only the genuinely new name was added');
  }

  console.log('\n── Section 5: formatRosterList ─────────────────────────────────────');
  {
    const roster = getRoster(PHONE_HASH, classId);
    const text = formatRosterList(roster);
    assert(text === '1. Sipho Dlamini\n2. Ayanda Nkosi\n3. Lebo Molefe', 'formats as a numbered list in roster order');
  }

  console.log('\n── Section 6: rosters are scoped per class ─────────────────────────');
  {
    const otherClass = db.prepare(`
      INSERT INTO classes (phone_hash, name, grade, subject, learner_count)
      VALUES (?, 'Grade 6A', 6, 'Mathematics', 0)
    `).run(PHONE_HASH);
    const otherClassId = Number(otherClass.lastInsertRowid);

    assert(getRoster(PHONE_HASH, otherClassId).length === 0, 'a different class starts with an empty roster');
    setRoster(PHONE_HASH, otherClassId, ['Naledi Mokoena']);
    assert(getRoster(PHONE_HASH, classId).length === 3, 'original class roster is unaffected');
    assert(getRoster(PHONE_HASH, otherClassId).length === 1, 'new class has its own roster');
  }

  console.log('\n── Section 7: blank/too-short names are ignored ────────────────────');
  {
    const { roster, added } = setRoster(PHONE_HASH, classId, ['', '  ', 'A', 'Naledi Mokoena']);
    assert(added === 1, 'only the one valid name (>=2 chars) was added');
    assert(roster.length === 4, 'roster grows by exactly one');
  }

  console.log('\n── Section 8: validateRosterNames — strict paste validation ────────');
  {
    const blank = validateRosterNames('Sipho Dlamini\n\nAyanda Nkosi');
    assert(blank.valid === false, 'a blank line makes the paste invalid');
    assert(blank.errors.length === 1 && blank.errors[0].line === 2, 'blank line reported at its correct 1-indexed line number');

    const dup = validateRosterNames('Sipho Dlamini\nAyanda Nkosi\nSipho Dlamini');
    assert(dup.valid === false, 'a duplicate name makes the paste invalid');
    assert(dup.errors[0].line === 3, 'duplicate reported at the line it recurs on');
    assert(/Duplicate of line 1/.test(dup.errors[0].message), 'duplicate message points back at the first occurrence');

    const tooShort = validateRosterNames('A\nAyanda Nkosi');
    assert(tooShort.valid === false, 'a single-character name is rejected');

    const clean = validateRosterNames('1. Sipho Dlamini\n2) Ayanda Nkosi\nLebo Molefe\n');
    assert(clean.valid === true, 'a clean paste (with a trailing newline) validates');
    assert(clean.errors.length === 0, 'no errors on a clean paste');
    assert(clean.names.length === 3, 'three names extracted');
    assert(clean.names[0] === 'Sipho Dlamini', 'numbering stripped same as parseRosterPaste');
  }

  console.log('\n── Section 9: setRoster REPLACE mode ────────────────────────────────');
  {
    const replaceClass = db.prepare(`
      INSERT INTO classes (phone_hash, name, grade, subject, learner_count)
      VALUES (?, 'Grade 7C', 7, 'Mathematics', 0)
    `).run(PHONE_HASH);
    const replaceClassId = Number(replaceClass.lastInsertRowid);

    setRoster(PHONE_HASH, replaceClassId, ['Learner A', 'Learner B', 'Learner C']);
    assert(getRoster(PHONE_HASH, replaceClassId).length === 3, 'starting roster of three set up via default (merge) mode');

    const result = setRoster(PHONE_HASH, replaceClassId, ['Learner B', 'Learner C', 'Learner D'], { mode: 'replace' });
    assert(result.added === 1, 'one genuinely new name (Learner D) added');
    assert(result.matched === 2, 'two names (B, C) matched existing learners');
    assert(result.removed === 1, 'one name (Learner A, omitted from the new list) soft-removed');
    assert(result.roster.length === 3, 'active roster is back to three, not four');
    assert(!result.roster.some((l) => l.name === 'Learner A'), 'Learner A is off the active roster after REPLACE');

    const cls = db.prepare(`SELECT learner_count FROM classes WHERE id = ?`).get(replaceClassId);
    assert(cls.learner_count === 3, 'classes.learner_count reflects only the active (post-replace) roster');

    // Re-pasting the removed name un-removes the same identity instead of duplicating it
    const rerun = setRoster(PHONE_HASH, replaceClassId, ['Learner A', 'Learner B', 'Learner C', 'Learner D'], { mode: 'merge' });
    assert(rerun.roster.length === 4, 'Learner A is back on the roster after being re-pasted');
    assert(rerun.roster.filter((l) => l.name === 'Learner A').length === 1, 'exactly one Learner A row — un-removed, not duplicated');
  }

  console.log('\n── Section 10: addLearner / removeLearner ───────────────────────────');
  {
    const soloClass = db.prepare(`
      INSERT INTO classes (phone_hash, name, grade, subject, learner_count)
      VALUES (?, 'Grade 4A', 4, 'Mathematics', 0)
    `).run(PHONE_HASH);
    const soloClassId = Number(soloClass.lastInsertRowid);

    const add1 = addLearner(PHONE_HASH, soloClassId, 'Thandeka Mahlangu');
    assert(add1.alreadyOnRoster === false, 'first add is genuinely new');
    assert(add1.rosterSize === 1, 'roster size is 1 after the first add');

    const add2 = addLearner(PHONE_HASH, soloClassId, 'Thandeka Mahlangu');
    assert(add2.alreadyOnRoster === true, 'adding the same name again is recognised as already-on-roster');
    assert(add2.rosterSize === 1, 'roster size unchanged — no duplicate row');

    const remove1 = removeLearner(PHONE_HASH, soloClassId, 'Thandeka Mahlangu');
    assert(remove1.removed === true, 'removeLearner reports success for an existing active learner');
    assert(remove1.rosterSize === 0, 'roster size drops to 0 after removal');
    assert(getRoster(PHONE_HASH, soloClassId).length === 0, 'getRoster confirms the learner is off the active roster');

    const remove2 = removeLearner(PHONE_HASH, soloClassId, 'Thandeka Mahlangu');
    assert(remove2.removed === false, 'removing an already-removed (or never-present) name reports false, does not throw');

    // Re-adding un-removes the same identity rather than creating a new row
    const add3 = addLearner(PHONE_HASH, soloClassId, 'Thandeka Mahlangu');
    assert(add3.alreadyOnRoster === false, 're-adding after removal is treated as a fresh add to the active roster');
    assert(getRoster(PHONE_HASH, soloClassId).length === 1, 'exactly one active learner after the re-add — identity was reused, not duplicated');

    const db_ = getDb();
    const totalRows = db_.prepare(`SELECT COUNT(*) AS n FROM learners WHERE phone_hash = ? AND class_id = ?`).get(PHONE_HASH, soloClassId).n;
    assert(totalRows === 1, 'only one physical learners row exists for this identity across add/remove/re-add');
  }

  console.log('\n── Section 11: clearRoster ───────────────────────────────────────────');
  {
    const clearClass = db.prepare(`
      INSERT INTO classes (phone_hash, name, grade, subject, learner_count)
      VALUES (?, 'Grade 3B', 3, 'Mathematics', 0)
    `).run(PHONE_HASH);
    const clearClassId = Number(clearClass.lastInsertRowid);

    setRoster(PHONE_HASH, clearClassId, ['Learner X', 'Learner Y']);
    const result = clearRoster(PHONE_HASH, clearClassId);
    assert(result.clearedCount === 2, 'clearRoster reports the number of learners it soft-removed');
    assert(getRoster(PHONE_HASH, clearClassId).length === 0, 'active roster is empty after clearRoster');

    const cls = db.prepare(`SELECT learner_count FROM classes WHERE id = ?`).get(clearClassId);
    assert(cls.learner_count === 0, 'classes.learner_count synced to 0 after clearRoster');

    const emptyResult = clearRoster(PHONE_HASH, clearClassId);
    assert(emptyResult.clearedCount === 0, 'clearing an already-empty roster is a safe no-op');

    // History preserved: re-adding brings the same identity back, not a duplicate
    addLearner(PHONE_HASH, clearClassId, 'Learner X');
    assert(getRoster(PHONE_HASH, clearClassId).length === 1, 'Learner X is back on the roster after clearRoster + addLearner');
  }

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
