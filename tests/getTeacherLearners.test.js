'use strict';
/**
 * getTeacherLearners() (ADR-003, PR19) — real DB
 *
 * Loads the REAL services/learnerRepository.js and runs it against a REAL
 * in-memory SQLite database (via the node:sqlite shim), same convention as
 * tests/learnerRepository.test.js, so it exercises the actual SQL rather
 * than a mocked repository.
 *
 * Run individually:   node tests/getTeacherLearners.test.js
 * Run via npm:         npm test
 */

// ── Real-migrations test DB (see tests/helpers/createTestDb.js) ──────────
const { createTestDb } = require('./helpers/createTestDb');
const testDb = createTestDb(__filename);
let _db = testDb.db;

// ── Helpers ──────────────────────────────────────────────────────────────
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

function assertEq(a, b, label) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    console.error(`     expected: ${JSON.stringify(b)}`);
    console.error(`     got:      ${JSON.stringify(a)}`);
    failed++;
  }
}

function assertThrows(fn, expectedMsg, label) {
  try {
    fn();
    console.error(`  ❌ FAIL: ${label} — expected throw, got no error`);
    failed++;
  } catch (err) {
    if (expectedMsg && !err.message.includes(expectedMsg)) {
      console.error(`  ❌ FAIL: ${label}`);
      console.error(`     expected message to include: "${expectedMsg}"`);
      console.error(`     got: "${err.message}"`);
      failed++;
    } else {
      console.log(`  ✅ ${label}`);
      passed++;
    }
  }
}

// ── Fixture helper ──────────────────────────────────────────────────────
function insertLearner(db, { phoneHash, classId = null, name, removedAt = null }) {
  const info = db.prepare(`
    INSERT INTO learners (phone_hash, class_id, canonical_name, normalized_name, removed_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(phoneHash, classId, name, name.toLowerCase(), removedAt);
  return info.lastInsertRowid;
}

async function run() {
  const { getTeacherLearners } = require('../services/learnerRepository');

  const TEACHER_A = 'gtl_teacher_a';
  const TEACHER_B = 'gtl_teacher_b';
  const TEACHER_C = 'gtl_teacher_c';
  _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(TEACHER_A);
  _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(TEACHER_B);
  _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(TEACHER_C);

  const classA = _db.prepare(`INSERT INTO classes (phone_hash, name, grade, subject) VALUES (?, ?, ?, ?)`)
    .run(TEACHER_A, '6A', 6, 'Mathematics').lastInsertRowid;

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 1: returns only the teacher's own learners
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 1: returns only the teacher\'s own learners ──────────────────');

  insertLearner(_db, { phoneHash: TEACHER_A, classId: classA, name: 'Zanele Mkhize' });
  insertLearner(_db, { phoneHash: TEACHER_A, classId: classA, name: 'Ayanda Nkosi' });
  const bongani = insertLearner(_db, { phoneHash: TEACHER_A, classId: null, name: 'Bongani Dube' });
  insertLearner(_db, { phoneHash: TEACHER_B, classId: null, name: 'Should Not Appear' });

  const learnersA = getTeacherLearners(TEACHER_A);
  assert(learnersA.length === 3, 'three learners returned for teacher A');
  assert(!learnersA.some(l => l.canonicalName === 'Should Not Appear'), "none of teacher B's learners appear");

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 2: ordering is alphabetical by canonical name
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 2: ordering is alphabetical ──────────────────────────────────');

  assertEq(
    learnersA.map(l => l.canonicalName),
    ['Ayanda Nkosi', 'Bongani Dube', 'Zanele Mkhize'],
    'results ordered alphabetically by canonicalName'
  );

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 3: excludes soft-removed learners
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 3: excludes removed learners ─────────────────────────────────');

  _db.prepare(`UPDATE learners SET removed_at = datetime('now') WHERE id = ?`).run(bongani);
  const learnersAfterRemoval = getTeacherLearners(TEACHER_A);
  assert(!learnersAfterRemoval.some(l => l.canonicalName === 'Bongani Dube'), 'removed learner excluded');
  assertEq(learnersAfterRemoval.length, 2, 'remaining count is 2 after removal');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 4: empty array when teacher has no learners
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 4: empty array when teacher has no learners ──────────────────');

  assertEq(getTeacherLearners(TEACHER_C), [], 'teacher with no learners gets []');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 5: input guard
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 5: input guard ────────────────────────────────────────────────');

  assertThrows(() => getTeacherLearners(null), 'must not be null or empty', 'null phoneHash throws');
  assertThrows(() => getTeacherLearners(''), 'must not be null or empty', 'empty phoneHash throws');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 6: response shape
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 6: response shape ─────────────────────────────────────────────');

  const [sample] = learnersAfterRemoval;
  assert(typeof sample.id === 'number', 'row has numeric id');
  assert('classId' in sample, 'row has classId (nullable)');
  assert(typeof sample.canonicalName === 'string', 'row has canonicalName');
  assert(typeof sample.normalizedName === 'string', 'row has normalizedName');
  assert(typeof sample.createdAt === 'string', 'row has createdAt');
  assert(typeof sample.updatedAt === 'string', 'row has updatedAt');
  assert(!('phoneHash' in sample), 'row does NOT include phoneHash');
  assert(!('removedAt' in sample), 'row does NOT include removedAt');

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`getTeacherLearners Results: ${passed} passed, ${failed} failed`);
  testDb.cleanup();
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
