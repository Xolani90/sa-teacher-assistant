'use strict';
/**
 * Class editing — end-to-end test against the REAL database (no mocks).
 * Phase 6: services/teacherWorkspaceService.js#updateClass existed and
 * was fully implemented, but nothing ever called it. This proves the
 * PATCH /api/classes/:classId route wired up in routes/api.js actually
 * updates the real row and can't be used to edit another teacher's class.
 *
 * Run individually: node tests/classes-edit-e2e.test.js
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
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

function mockReq(phoneHash, params, body) {
  return { teacher: { phoneHash }, params, body };
}

function run() {
  const testDb = createTestDb(__filename);
  const db = testDb.db;

  const { createClass, getClass, updateClass } = require('../services/teacherWorkspaceService');
  const { createPatchClassHandler } = require('../routes/api').__testExports;

  const TEACHER_A_HASH = 'testhash_classedit_teacherA';
  const TEACHER_B_HASH = 'testhash_classedit_teacherB';

  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject) VALUES (?, 'Teacher A', 7, 'Mathematics')`).run(TEACHER_A_HASH);
  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject) VALUES (?, 'Teacher B', 7, 'Mathematics')`).run(TEACHER_B_HASH);

  console.log('\n── Step 1: Teacher A creates a class with a typo ──');
  const cls = createClass(TEACHER_A_HASH, 'Grade 7 Mathmatics A', 7, 'Mathematics');
  assert(cls && cls.id > 0, 'class persisted');

  const handler = createPatchClassHandler({ updateClass, getClass });

  console.log('\n── Step 2: Teacher B cannot edit Teacher A\'s class ──');
  const wrongOwnerRes = mockRes();
  handler(mockReq(TEACHER_B_HASH, { classId: String(cls.id) }, { name: 'Hijacked Name' }), wrongOwnerRes);
  assert(wrongOwnerRes.statusCode === 404, 'cross-teacher edit attempt returns 404');
  const stillOriginal = getClass(cls.id, TEACHER_A_HASH);
  assert(stillOriginal.name === 'Grade 7 Mathmatics A', 'the class name is unchanged after Teacher B\'s failed attempt');

  console.log('\n── Step 3: Teacher A fixes the typo ──');
  const fixRes = mockRes();
  handler(mockReq(TEACHER_A_HASH, { classId: String(cls.id) }, { name: 'Grade 7 Mathematics A' }), fixRes);
  assert(fixRes.statusCode === 200, 'owner edit returns 200');
  assert(fixRes.body.class.name === 'Grade 7 Mathematics A', 'response reflects the corrected name');

  const reread = getClass(cls.id, TEACHER_A_HASH);
  assert(reread.name === 'Grade 7 Mathematics A', 'the corrected name is actually persisted in the database');
  assert(reread.grade === 7 && reread.subject === 'Mathematics', 'grade/subject untouched by a name-only edit');

  console.log('\n── Step 4: partial update of just grade leaves name/subject alone ──');
  const gradeRes = mockRes();
  handler(mockReq(TEACHER_A_HASH, { classId: String(cls.id) }, { grade: 8 }), gradeRes);
  assert(gradeRes.statusCode === 200, 'grade-only update returns 200');
  const afterGrade = getClass(cls.id, TEACHER_A_HASH);
  assert(afterGrade.grade === 8, 'grade updated');
  assert(afterGrade.name === 'Grade 7 Mathematics A', 'name untouched by a grade-only edit');

  console.log('\n── Step 5: editing a nonexistent class is a clean 404 ──');
  const bogusRes = mockRes();
  handler(mockReq(TEACHER_A_HASH, { classId: '999999' }, { name: 'x' }), bogusRes);
  assert(bogusRes.statusCode === 404, 'nonexistent classId returns 404');

  testDb.cleanup();

  console.log(`\n📊 Total:  ${passed + failed}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

run();