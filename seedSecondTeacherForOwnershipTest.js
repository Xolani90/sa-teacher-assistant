'use strict';

require('dotenv').config();

/**
 * seedSecondTeacherForOwnershipTest.js
 *
 * Seeds a second teacher ("Teacher B") with one class, purely so RC-1
 * W2 sign-off can exercise the cross-teacher ownership checks (S1/S2)
 * without going through the real OTP/WhatsApp login flow.
 *
 * Does NOT touch the existing teacher/class rows — inserts new ones only.
 * Safe to re-run: uses INSERT OR IGNORE for the teacher row (same as
 * ensureTeacher() in utils/usageTracker.js), and always creates a fresh
 * class row on each run.
 *
 * Usage:
 *   node seedSecondTeacherForOwnershipTest.js
 *
 * Prints Teacher B's id, phone_hash, seeded classId, and a ready-to-use
 * Bearer token (signed with TEACHER_JWT_SECRET, same shape as the real
 * login flow issues per utils/teacherAuth.js — sub = teachers.id).
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'teacher_assistant.db');
const db = new Database(DB_PATH);

// Any raw number not already used by an existing teacher works — this one
// is a placeholder SA-format number reserved for test purposes only.
const RAW_PHONE_B = '0821110002';

function hashPhone(phone) {
  let normalized = phone.trim().replace(/^\+/, '');
  if (/^0\d{9}$/.test(normalized)) {
    normalized = `27${normalized.slice(1)}`;
  }
  return crypto.createHmac('sha256', process.env.PII_SECRET).update(normalized).digest('hex');
}

function main() {
  if (!process.env.PII_SECRET) {
    console.error('PII_SECRET not set in .env — cannot derive phone_hash.');
    process.exit(1);
  }
  if (!process.env.TEACHER_JWT_SECRET) {
    console.error('TEACHER_JWT_SECRET not set in .env — cannot sign a token.');
    process.exit(1);
  }

  const phoneHash = hashPhone(RAW_PHONE_B);

  db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(phoneHash);
  const teacher = db.prepare(`SELECT id, phone_hash FROM teachers WHERE phone_hash = ?`).get(phoneHash);

  const insertClass = db.prepare(`
    INSERT INTO classes (phone_hash, name, grade, subject, learner_count)
    VALUES (?, ?, ?, ?, 0)
  `);
  const result = insertClass.run(phoneHash, 'Teacher B Ownership Test Class', 5, 'English');
  const classId = result.lastInsertRowid;

  const insertLearner = db.prepare(`
    INSERT INTO learners (phone_hash, class_id, canonical_name, normalized_name)
    VALUES (?, ?, ?, ?)
  `);
  const learnerResult = insertLearner.run(phoneHash, classId, 'Teacher B Test Learner', 'teacher b test learner');
  const learnerId = learnerResult.lastInsertRowid;

  const token = jwt.sign({ sub: teacher.id }, process.env.TEACHER_JWT_SECRET, { expiresIn: '1h' });

  console.log('--- Teacher B seeded ---');
  console.log('teacherId:', teacher.id);
  console.log('phoneHash:', teacher.phone_hash);
  console.log('classId:  ', classId);
  console.log('learnerId:', learnerId);
  console.log('token:    ', token, '(this is Teacher B\'s own token, for the reverse check if you want it)');
  console.log('');
  console.log('For W2 S1/S2: use YOUR (Teacher A) token against classId above.');
  console.log('For W3 S1/S2: use YOUR (Teacher A) token against learnerId above.');
  console.log('You should get 404 in both cases, not the data and not 403.');
}

main();
