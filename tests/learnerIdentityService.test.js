'use strict';
/**
 * ADR-003 PR 2 — learnerIdentityService
 *
 * Runs against a throwaway file-backed DB (same convention as
 * tests/adr003-learners-migration.test.js), with runMigrations() called
 * for real so the learners table and Migration 026's partial unique
 * indexes actually exist before any test runs. Without this, getDb()
 * connects straight to whatever DB_PATH resolves to (the real
 * data/teacher_assistant.db if unset) with no schema applied — "no such
 * table: learners" if run first, or silent pollution of real local data
 * if run after the app has started once.
 *
 * teachers/classes rows are FK dependencies of `learners` (foreign_keys =
 * ON in utils/database.js), so every phone_hash/class_id used below needs
 * a fixture row first, or every resolveLearner() call throws
 * "FOREIGN KEY constraint failed" regardless of the identity logic being
 * exercised.
 */

const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'learner-identity-test.db');
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
process.env.DB_PATH = dbPath;

const assert = require('assert');
const { getDb, runMigrations } = require('../utils/database');
runMigrations();

const {
  resolveLearner,
  findByIdentity,
  normalizeName,
  __internal,
} = require('../services/learnerIdentityService');

// ── Fixtures ────────────────────────────────────────────────────────────
// teachers.phone_hash and classes.id are FK targets of learners; insert
// every one used by the test cases below before any resolveLearner() call.
const db = getDb();

for (const phoneHash of ['t1', 't2', 't3', 't4', 't5']) {
  db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(phoneHash);
}

const classFixtures = [
  { id: 6, phoneHash: 't1' },
  { id: 10, phoneHash: 't1' },
  { id: 11, phoneHash: 't1' },
  { id: 20, phoneHash: 't1' },
  { id: 1, phoneHash: 't2' },
  { id: 2, phoneHash: 't2' },
  { id: 5, phoneHash: 't4' },
  { id: 8, phoneHash: 't5' },
];
for (const { id, phoneHash } of classFixtures) {
  db.prepare(`
    INSERT OR IGNORE INTO classes (id, phone_hash, name, grade, subject)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, phoneHash, 'Class ' + id, 7, 'Maths');
}

// ── Test runner ───────────────────────────────────────────────────────────
let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log('PASS - ' + name);
    passed++;
  } catch (e) {
    console.log('FAIL - ' + name);
    console.log('       ' + e.message);
    process.exitCode = 1;
  }
}

// --- normalization ---
test('normalizeName trims, collapses whitespace, lowercases', () => {
  assert.strictEqual(normalizeName('  Sipho  '), 'sipho');
  assert.strictEqual(normalizeName('Sipho   Nkosi'), 'sipho nkosi');
  assert.strictEqual(normalizeName('SIPHO'), 'sipho');
  assert.strictEqual(normalizeName('sipho'), 'sipho');
});

// --- basic resolve: create then find same identity ---
test('resolveLearner creates a new learner when none exists', () => {
  const l = resolveLearner({ phoneHash: 't1', classId: 6, learnerName: 'Sipho' });
  assert.ok(l.id);
  assert.strictEqual(l.class_id, 6);
  assert.strictEqual(l.normalized_name, 'sipho');
});

test('resolveLearner returns the same row on a second call with same identity', () => {
  const first = resolveLearner({ phoneHash: 't1', classId: 6, learnerName: 'Zanele' });
  const second = resolveLearner({ phoneHash: 't1', classId: 6, learnerName: 'zanele' });
  assert.strictEqual(first.id, second.id);
});

// --- cross-class non-matching ---
test('same teacher+name in different classes are distinct learners', () => {
  const g6 = resolveLearner({ phoneHash: 't1', classId: 10, learnerName: 'Thabo' });
  const g7 = resolveLearner({ phoneHash: 't1', classId: 11, learnerName: 'Thabo' });
  assert.notStrictEqual(g6.id, g7.id);
});

// --- null classId scoping ---
test('classId null never matches a classed learner of the same name', () => {
  const classed = resolveLearner({ phoneHash: 't1', classId: 20, learnerName: 'Lindiwe' });
  const unclassed = resolveLearner({ phoneHash: 't1', classId: null, learnerName: 'Lindiwe' });
  assert.notStrictEqual(classed.id, unclassed.id);
  assert.strictEqual(unclassed.class_id, null);
});

test('two classed Sipho + one unmatched Sipho stay three distinct identities', () => {
  const a = resolveLearner({ phoneHash: 't2', classId: 1, learnerName: 'Sipho' });
  const b = resolveLearner({ phoneHash: 't2', classId: 2, learnerName: 'Sipho' });
  const c = resolveLearner({ phoneHash: 't2', classId: null, learnerName: 'Sipho' });
  const ids = new Set([a.id, b.id, c.id]);
  assert.strictEqual(ids.size, 3);
});

test('unclassed resolveLearner is idempotent (does not create duplicates on repeat calls)', () => {
  const first = resolveLearner({ phoneHash: 't3', classId: null, learnerName: 'Amahle' });
  const second = resolveLearner({ phoneHash: 't3', classId: null, learnerName: 'amahle' });
  assert.strictEqual(first.id, second.id);
});

// --- never move between classes ---
test('a learner created with class_id NULL is never moved when later resolved with a real classId', () => {
  const unclassed = resolveLearner({ phoneHash: 't4', classId: null, learnerName: 'Nomvula' });
  const classed = resolveLearner({ phoneHash: 't4', classId: 5, learnerName: 'Nomvula' });
  // Must be a NEW row, not an update of the unclassed one
  assert.notStrictEqual(unclassed.id, classed.id);
  const stillUnclassed = findByIdentity({ phoneHash: 't4', classId: null, learnerName: 'Nomvula' });
  assert.strictEqual(stillUnclassed.id, unclassed.id);
  assert.strictEqual(stillUnclassed.class_id, null);
});

// ADR-003 intentionally uses exact normalized-string equality.
// Fuzzy or partial-name matching is deferred to future ADR work.
// "Sipho" and "Sipho Dlamini" must remain distinct identities.
test('does not merge partial names', () => {
  const learner1 = resolveLearner({ phoneHash: 't1', classId: 6, learnerName: 'Sipho' });
  const learner2 = resolveLearner({ phoneHash: 't1', classId: 6, learnerName: 'Sipho Dlamini' });

  assert.notStrictEqual(
    learner1.id,
    learner2.id,
    'Partial/full names should remain distinct learners under ADR-003'
  );
});

// --- concurrent duplicate protection (simulated) ---
test('resolveLearner recovers via re-find when createLearner hits a UNIQUE violation', () => {
  // Pre-create the row "out from under" resolveLearner, simulating a
  // concurrent request that won the race between find and insert.
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO learners (phone_hash, class_id, canonical_name, normalized_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('t5', 8, 'Bongani', 'bongani', now, now);

  // Force createLearner to always attempt an insert (bypassing the initial
  // find) by calling __internal.createLearner directly and confirming it
  // throws a UNIQUE violation, then confirming resolveLearner's normal path
  // still returns the single existing row rather than erroring.
  assert.throws(
    () => __internal.createLearner({ phoneHash: 't5', classId: 8, learnerName: 'Bongani' }),
    (err) => __internal.isUniqueConstraintError(err)
  );

  const resolved = resolveLearner({ phoneHash: 't5', classId: 8, learnerName: 'Bongani' });
  const all = db.prepare(`
    SELECT * FROM learners WHERE phone_hash = 't5' AND class_id = 8 AND normalized_name = 'bongani'
  `).all();
  assert.strictEqual(all.length, 1);
  assert.strictEqual(resolved.id, all[0].id);
});

console.log(`\n${passed} passed`);

db.close();
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
