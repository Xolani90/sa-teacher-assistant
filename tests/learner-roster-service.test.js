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
    parseRosterPaste,
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
