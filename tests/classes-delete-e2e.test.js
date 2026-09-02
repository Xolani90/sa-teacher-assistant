'use strict';
/**
 * Class deletion — end-to-end test against the REAL database (no mocks).
 * Phase 6 continuation: services/teacherWorkspaceService.js#deleteClass
 * existed and was fully implemented, but nothing ever called it. This
 * proves the DELETE /api/classes/:classId route wired up in
 * routes/api.js actually removes the real row, can't be used to delete
 * another teacher's class, correctly reassigns default_class_id when the
 * default class is removed, and — the reason this needed a guard before
 * being wired up at all — refuses to delete a class that still has
 * learners linked to it rather than silently orphaning their records or
 * crashing with a raw foreign-key error.
 *
 * Run individually: node tests/classes-delete-e2e.test.js
 * Run via npm:       npm test
 */

const { createTestDb } = require('./helpers/createTestDb');

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

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    sent: false,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    send() { this.sent = true; return this; },
  };
  return res;
}

function mockReq(phoneHash, params) {
  return { teacher: { phoneHash }, params };
}

function run() {
  const testDb = createTestDb(__filename);
  const db = testDb.db;

  const { createClass, getClass, deleteClass } = require('../services/teacherWorkspaceService');
  const { createDeleteClassHandler } = require('../routes/api').__testExports;

  const TEACHER_A_HASH = 'testhash_classdelete_teacherA';
  const TEACHER_B_HASH = 'testhash_classdelete_teacherB';

  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject) VALUES (?, 'Teacher A', 7, 'Mathematics')`).run(TEACHER_A_HASH);
  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject) VALUES (?, 'Teacher B', 7, 'Mathematics')`).run(TEACHER_B_HASH);

  const handler = createDeleteClassHandler({ deleteClass, getClass });

  console.log('\n── Step 1: Teacher A creates two classes (first becomes default) ──');
  const clsEmpty = createClass(TEACHER_A_HASH, 'Grade 7 Mathematics A', 7, 'Mathematics');
  const clsWithLearner = createClass(TEACHER_A_HASH, 'Grade 7 Mathematics B', 7, 'Mathematics');
  assert(clsEmpty && clsWithLearner, 'both classes persisted');

  const teacherBefore = db.prepare('SELECT default_class_id FROM teachers WHERE phone_hash = ?').get(TEACHER_A_HASH);
  assert(teacherBefore.default_class_id === clsEmpty.id, 'first class became the default');

  console.log('\n── Step 2: Teacher B cannot delete Teacher A\'s class ──');
  const wrongOwnerRes = mockRes();
  handler(mockReq(TEACHER_B_HASH, { classId: String(clsEmpty.id) }), wrongOwnerRes);
  assert(wrongOwnerRes.statusCode === 404, 'cross-teacher delete attempt returns 404');
  assert(getClass(clsEmpty.id, TEACHER_A_HASH) !== null, 'the class still exists after Teacher B\'s failed attempt');

  console.log('\n── Step 3: a class with an enrolled learner cannot be deleted ──');
  db.prepare(`
    INSERT INTO learners (phone_hash, class_id, canonical_name, normalized_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(TEACHER_A_HASH, clsWithLearner.id, 'Thabo N', 'thabo n');
  const blockedRes = mockRes();
  handler(mockReq(TEACHER_A_HASH, { classId: String(clsWithLearner.id) }), blockedRes);
  assert(blockedRes.statusCode === 409, 'delete of a class with a linked learner returns 409');
  assert(/learner/.test(blockedRes.body.error), 'the 409 error explains why (mentions the learner)');
  assert(getClass(clsWithLearner.id, TEACHER_A_HASH) !== null, 'the class with the learner was NOT deleted');
  const learnerStillLinked = db.prepare('SELECT class_id FROM learners WHERE class_id = ?').get(clsWithLearner.id);
  assert(learnerStillLinked && learnerStillLinked.class_id === clsWithLearner.id, 'the learner record is untouched, not orphaned');

  console.log('\n── Step 4: Teacher A deletes the empty (default) class ──');
  const deleteRes = mockRes();
  handler(mockReq(TEACHER_A_HASH, { classId: String(clsEmpty.id) }), deleteRes);
  assert(deleteRes.statusCode === 204, 'owner delete of an empty class returns 204');
  assert(getClass(clsEmpty.id, TEACHER_A_HASH) === null, 'the class row is actually gone from the database');

  const teacherAfter = db.prepare('SELECT default_class_id FROM teachers WHERE phone_hash = ?').get(TEACHER_A_HASH);
  assert(teacherAfter.default_class_id === clsWithLearner.id, 'default_class_id was reassigned to the remaining class');

  console.log('\n── Step 5: deleting a nonexistent class is a clean 404 ──');
  const bogusRes = mockRes();
  handler(mockReq(TEACHER_A_HASH, { classId: '999999' }), bogusRes);
  assert(bogusRes.statusCode === 404, 'nonexistent classId returns 404');

  testDb.cleanup();

  console.log(`\n📊 Total:  ${passed + failed}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

run();
