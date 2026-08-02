'use strict';
// Regression test for the updateTeacherProfile whitelist fix (last_assessment_id).
// Run via: npm test, or directly: node tests/update-teacher-profile.test.js

// ── Shared real-migrations test DB helper (see docs/TSE_SCHOOL_CALENDAR_TEST_GAP.md) ──
const { createTestDb } = require('./helpers/createTestDb');
const assert = require('assert');

process.env.PII_SECRET = 'test-secret-key-32-bytes-long!';

const testDb = createTestDb(__filename);

try {
  const { updateTeacherProfile, getTeacherByPhone } = require('../utils/usageTracker.js');

  updateTeacherProfile('27821234567', { last_assessment_id: 42 });
  const teacher = getTeacherByPhone('27821234567');
  assert.strictEqual(teacher.last_assessment_id, 42);
  console.log('✅ Test 1 passed: updateTeacherProfile now persists last_assessment_id (previously silently dropped by the whitelist)');

  updateTeacherProfile('27821234567', { name: 'Mrs Dlamini', grade: 7, subject: 'mathematics' });
  const teacher2 = getTeacherByPhone('27821234567');
  assert.strictEqual(teacher2.name, 'Mrs Dlamini');
  // teachers.grade is a TEXT column in the real schema (not INTEGER, as the
  // old hand-rolled schema assumed) — updateTeacherProfile() deliberately
  // stringifies integer grades before writing, to avoid a documented "7.0"
  // bug from better-sqlite3's TEXT-column coercion. See utils/usageTracker.js.
  assert.strictEqual(teacher2.grade, '7');
  assert.strictEqual(teacher2.last_assessment_id, 42); // unaffected by the unrelated update
  console.log('✅ Test 2 passed: pre-existing allowed fields still update correctly (no regression from the fix)');

  console.log('\n🎉 updateTeacherProfile fix verified end-to-end.');
} finally {
  testDb.cleanup();
}
