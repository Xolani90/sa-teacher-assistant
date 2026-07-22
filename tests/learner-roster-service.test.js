'use strict';
/**
 * learnerRosterService tests (ADR-006 PR2.5 — Class Roster Management).
 *
 * Exercises getRoster/setRoster/parseRosterPaste/formatRosterList against
 * a real (throwaway, file-backed) SQLite DB via runMigrations() — same
 * node:sqlite shim convention as tests/adr003-learners-migration.test.js —
 * so this fails if the real `learners`/`classes` schema ever drifts from
 * what this module assumes.
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
    splitRosterLines,
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

  console.log('\n── Section 8: splitRosterLines preserves blanks (unlike parseRosterPaste) ──');
  {
    // Trailing '\n' produces a final empty element too (plain String.split
    // behaviour) — that's fine, validateRosterNames would report it as a
    // trailing blank line same as any other, which is correct: a teacher
    // pasting a trailing newline gets told about it rather than having it
    // silently swallowed.
    const lines = splitRosterLines('1. Sipho Dlamini\n\n2) Ayanda Nkosi\r\n');
    assert(lines.length === 4, 'blank lines (including trailing) kept as empty entries, not dropped');
    assert(lines[0] === 'Sipho Dlamini', 'numbering stripped on first line');
    assert(lines[1] === '', 'blank line preserved as empty string');
    assert(lines[2] === 'Ayanda Nkosi', 'CRLF handled on last line');
    assert(lines[3] === '', 'trailing newline produces a trailing blank entry');
  }

  console.log('\n── Section 9: validateRosterNames rejects blank lines as errors ────');
  {
    const { valid, errors } = validateRosterNames(splitRosterLines('Sipho Dlamini\n\nAyanda Nkosi'));
    assert(valid === false, 'a blank line makes the paste invalid');
    assert(errors.length === 1, 'exactly one error reported');
    assert(/Line 2/.test(errors[0]), 'error identifies the correct line number');
    assert(/blank/.test(errors[0]), 'error message names the problem as a blank line');
  }

  console.log('\n── Section 10: validateRosterNames rejects duplicates as errors ────');
  {
    const { valid, errors } = validateRosterNames(splitRosterLines('Sipho Dlamini\nAyanda Nkosi\nsipho   dlamini'));
    assert(valid === false, 'a case/whitespace-insensitive duplicate makes the paste invalid');
    assert(errors.length === 1, 'exactly one error reported');
    assert(/Line 3/.test(errors[0]), 'error identifies the duplicate line, not the original');
    assert(/duplicate/i.test(errors[0]), 'error message names the problem as a duplicate');
  }

  console.log('\n── Section 11: validateRosterNames accepts a clean paste ───────────');
  {
    const { valid, errors } = validateRosterNames(splitRosterLines('Sipho Dlamini\nAyanda Nkosi\nLebo Molefe'));
    assert(valid === true, 'a clean, duplicate-free, blank-free paste is valid');
    assert(errors.length === 0, 'no errors reported for a clean paste');
  }

  console.log('\n── Section 12: addLearner adds one name without touching the rest ──');
  {
    const before = getRoster(PHONE_HASH, classId).length;
    const { roster, learner, wasNew } = addLearner(PHONE_HASH, classId, 'Thabo Sithole');
    assert(wasNew === true, 'addLearner reports a genuinely new learner as new');
    assert(roster.length === before + 1, 'roster grew by exactly one');
    assert(learner.name === 'Thabo Sithole', 'returned learner has the added name');

    const { wasNew: wasNew2 } = addLearner(PHONE_HASH, classId, 'Thabo Sithole');
    assert(wasNew2 === false, 're-adding the same identity is a no-op, not a duplicate');
    assert(getRoster(PHONE_HASH, classId).length === before + 1, 'roster size unchanged on re-add');

    const cls = db.prepare(`SELECT learner_count FROM classes WHERE id = ?`).get(classId);
    assert(cls.learner_count === before + 1, 'classes.learner_count kept in sync after addLearner');
  }

  console.log('\n── Section 13: removeLearner soft-removes (row and history kept) ───');
  {
    const rosterBefore = getRoster(PHONE_HASH, classId);
    const target = rosterBefore.find((l) => l.name === 'Thabo Sithole');

    const { roster, removed } = removeLearner(PHONE_HASH, classId, target.id);
    assert(removed === true, 'removeLearner reports success for a learner actually on the roster');
    assert(roster.length === rosterBefore.length - 1, 'roster shrinks by exactly one');
    assert(!roster.some((l) => l.id === target.id), 'removed learner no longer appears in getRoster()');

    const row = db.prepare(`SELECT id, class_id, removed_at FROM learners WHERE id = ?`).get(target.id);
    assert(row !== undefined, 'the learners row itself still exists (not deleted)');
    assert(row.class_id === classId, 'class_id is left untouched by removal (not repurposed as an unclassed marker)');
    assert(row.removed_at !== null, 'removed_at is set, marking the soft removal');

    const cls = db.prepare(`SELECT learner_count FROM classes WHERE id = ?`).get(classId);
    assert(cls.learner_count === roster.length, 'classes.learner_count kept in sync after removal');

    const { removed: removedAgain } = removeLearner(PHONE_HASH, classId, target.id);
    assert(removedAgain === false, 'removing an already-removed learner is a safe no-op');
  }

  console.log('\n── Section 14: re-adding a removed name revives the same row ───────');
  {
    const before = getRoster(PHONE_HASH, classId).length;
    const { learner, wasNew } = addLearner(PHONE_HASH, classId, 'Thabo Sithole');
    assert(wasNew === true, 'a revived (previously removed) learner counts as newly-added to the active roster');
    assert(getRoster(PHONE_HASH, classId).length === before + 1, 'roster grows back by one');

    const row = db.prepare(`SELECT removed_at FROM learners WHERE id = ?`).get(learner.id);
    assert(row.removed_at === null, 'removed_at cleared on revival');
  }

  console.log('\n── Section 15: setRoster REPLACE mode removes names not re-pasted ──');
  {
    const rosterId = classId;
    setRoster(PHONE_HASH, rosterId, ['Sipho Dlamini', 'Ayanda Nkosi', 'Lebo Molefe', 'Naledi Mokoena', 'Thabo Sithole']);
    const before = getRoster(PHONE_HASH, rosterId);
    assert(before.length === 5, 'sanity check: five learners on the roster before REPLACE');

    const { roster, added, matched, removed } = setRoster(
      PHONE_HASH, rosterId, ['Sipho Dlamini', 'Ayanda Nkosi', 'Zanele Khumalo'],
      { mode: 'replace' }
    );
    assert(roster.length === 3, 'REPLACE leaves exactly the three re-pasted names');
    assert(added === 1, 'one genuinely new name (Zanele) was added');
    assert(matched === 2, 'two names matched existing identities (Sipho, Ayanda)');
    assert(removed === 3, 'the three names left off the new paste were soft-removed');
    assert(roster.map((l) => l.name).sort().join(',') === 'Ayanda Nkosi,Sipho Dlamini,Zanele Khumalo', 'REPLACE roster contains exactly the re-pasted names');

    const stillThere = before.filter((l) => l.name === 'Lebo Molefe')[0];
    const row = db.prepare(`SELECT removed_at FROM learners WHERE id = ?`).get(stillThere.id);
    assert(row.removed_at !== null, 'a name dropped by REPLACE is soft-removed, not deleted');
  }

  console.log('\n── Section 16: setRoster MERGE mode never removes existing names ───');
  {
    const rosterId = classId;
    const before = getRoster(PHONE_HASH, rosterId).length;
    const { roster, added, removed } = setRoster(PHONE_HASH, rosterId, ['Palesa Dube'], { mode: 'merge' });
    assert(roster.length === before + 1, 'MERGE only adds, never shrinks the roster');
    assert(added === 1, 'the new name was added');
    assert(removed === 0, 'MERGE reports zero removals by definition');
  }

  console.log('\n── Section 17: clearRoster soft-removes every current member ───────');
  {
    const otherClass = db.prepare(`
      INSERT INTO classes (phone_hash, name, grade, subject, learner_count)
      VALUES (?, 'Grade 7C', 7, 'Mathematics', 0)
    `).run(PHONE_HASH);
    const otherClassId = Number(otherClass.lastInsertRowid);
    setRoster(PHONE_HASH, otherClassId, ['Kagiso Molefe', 'Bongani Zulu']);

    const { roster, removed } = clearRoster(PHONE_HASH, otherClassId);
    assert(roster.length === 0, 'roster is empty immediately after clearRoster');
    assert(removed === 2, 'clearRoster reports how many learners it removed');

    const cls = db.prepare(`SELECT learner_count FROM classes WHERE id = ?`).get(otherClassId);
    assert(cls.learner_count === 0, 'classes.learner_count reset to zero after clearRoster');
  }

  console.log('\n── Section 18: cross-class removal never collides (Migration 031) ──');
  {
    // Regression guard for the exact edge case that motivated soft-removal
    // via removed_at instead of nulling class_id (see Migration 031's
    // comment): two DIFFERENT classes each have a learner named "Same
    // Name", and BOTH get removed. If removal ever nulled class_id, the
    // second UPDATE would collide with idx_learners_identity_unclassed
    // (phone_hash, normalized_name) WHERE class_id IS NULL and throw.
    const classA = db.prepare(`
      INSERT INTO classes (phone_hash, name, grade, subject, learner_count)
      VALUES (?, 'Grade 8A', 8, 'Mathematics', 0)
    `).run(PHONE_HASH);
    const classAId = Number(classA.lastInsertRowid);
    const classB = db.prepare(`
      INSERT INTO classes (phone_hash, name, grade, subject, learner_count)
      VALUES (?, 'Grade 8B', 8, 'Mathematics', 0)
    `).run(PHONE_HASH);
    const classBId = Number(classB.lastInsertRowid);

    const { learner: learnerA } = addLearner(PHONE_HASH, classAId, 'Same Name');
    const { learner: learnerB } = addLearner(PHONE_HASH, classBId, 'Same Name');
    assert(learnerA.id !== learnerB.id, 'same name in two different classes resolves to two distinct identities');

    let threw = false;
    try {
      removeLearner(PHONE_HASH, classAId, learnerA.id);
      removeLearner(PHONE_HASH, classBId, learnerB.id);
    } catch (err) {
      threw = true;
    }
    assert(threw === false, 'removing the same-named learner from both classes never throws a UNIQUE constraint error');

    const rowA = db.prepare(`SELECT class_id, removed_at FROM learners WHERE id = ?`).get(learnerA.id);
    const rowB = db.prepare(`SELECT class_id, removed_at FROM learners WHERE id = ?`).get(learnerB.id);
    assert(rowA.class_id === classAId && rowB.class_id === classBId, 'each removed learner keeps its own original class_id');
    assert(rowA.removed_at !== null && rowB.removed_at !== null, 'both are marked removed independently');
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
