'use strict';
// Regression test for the updateTeacherProfile whitelist fix (last_assessment_id).
// Uses better-sqlite3 directly (same lib production uses) against an in-memory DB.
// Run via: npm test, or directly: node tests/update-teacher-profile.test.js
const Database = require('better-sqlite3');
const Module = require('module');
const path = require('path');
const assert = require('assert');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone_hash TEXT UNIQUE NOT NULL,
    name TEXT, grade INTEGER, subject TEXT, language TEXT, school TEXT,
    is_pro INTEGER DEFAULT 0, pro_expires TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
    phone_enc TEXT, opted_out INTEGER DEFAULT 0, last_intent TEXT, last_assessment_id INTEGER
  );
`);

process.env.PII_SECRET = 'test-secret-key-32-bytes-long!';

const holderPath = path.join(__dirname, '__test_db_holder3.js');
require('fs').writeFileSync(holderPath, '// placeholder, populated via require.cache below');
require.cache[holderPath] = { exports: { db }, id: holderPath, filename: holderPath, loaded: true };

const stubPath = path.join(__dirname, '__stub_database3.js');
require('fs').writeFileSync(stubPath, `module.exports = { getDb: () => require(${JSON.stringify(holderPath)}).db };`);

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === '../utils/database' || request === './database') return stubPath;
  return origResolve.call(this, request, ...rest);
};

try {
  const { updateTeacherProfile, getTeacherByPhone } = require('../utils/usageTracker.js');

  updateTeacherProfile('27821234567', { last_assessment_id: 42 });
  const teacher = getTeacherByPhone('27821234567');
  assert.strictEqual(teacher.last_assessment_id, 42);
  console.log('✅ Test 1 passed: updateTeacherProfile now persists last_assessment_id (previously silently dropped by the whitelist)');

  updateTeacherProfile('27821234567', { name: 'Mrs Dlamini', grade: 7, subject: 'mathematics' });
  const teacher2 = getTeacherByPhone('27821234567');
  assert.strictEqual(teacher2.name, 'Mrs Dlamini');
  assert.strictEqual(teacher2.grade, 7);
  assert.strictEqual(teacher2.last_assessment_id, 42); // unaffected by the unrelated update
  console.log('✅ Test 2 passed: pre-existing allowed fields still update correctly (no regression from the fix)');

  console.log('\n🎉 updateTeacherProfile fix verified end-to-end.');
} finally {
  Module._resolveFilename = origResolve;
  require('fs').unlinkSync(stubPath);
  require('fs').unlinkSync(holderPath);
}
