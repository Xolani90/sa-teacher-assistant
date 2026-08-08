'use strict';

require('dotenv').config();

/**
 * seedTeacherBAssessment.js
 *
 * Seeds a second teacher (Teacher B) with their own assessment, purely to
 * exercise the ownership-scope checks in assessmentDetailService.js:
 *
 *   GET /api/assessments/:id/detail  -> 404 when requested with a token
 *   GET /api/assessments/:id/pdf     -> belonging to a *different* teacher
 *
 * This is test-data, not product data — legitimate to seed per the W4-S1/S2
 * plan. It does NOT touch Teacher A's existing rows (teacher id=1, or
 * whichever id already owns assessment id=6 from the earlier PDF test).
 *
 * Usage:
 *   node seedTeacherBAssessment.js
 *
 * Prints Teacher B's teacher id and the new assessment id so you can:
 *   1. Run mintTeacherAToken.js with Teacher B's id (or use the token
 *      printed here directly) to get a Teacher-B token.
 *   2. Use *Teacher A's* token (from mintTeacherAToken.js) against Teacher
 *      B's assessment id to confirm 404 on /detail and /pdf (W4-S1/S2).
 *   3. Hit /detail with no Authorization header at all to confirm 401
 *      (W4-S3) — no seed data needed for that one, any assessment id works.
 */

const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, 'data', 'teacher_assistant.db');
const db = new Database(DB_PATH);

// Distinct phone_hash so this doesn't collide with the existing teacher row.
// Doesn't need to correspond to a real number — just needs to be unique.
const phoneHash = crypto.createHash('sha256').update('teacher-b-ownership-test').digest('hex');

function seed() {
  let teacherId;
  const existing = db.prepare(`SELECT id FROM teachers WHERE phone_hash = ?`).get(phoneHash);

  if (existing) {
    teacherId = existing.id;
    console.log(`Teacher B already exists (id=${teacherId}) — reusing.`);
  } else {
    const insertTeacher = db.prepare(`
      INSERT INTO teachers (phone_hash, name, grade, subject)
      VALUES (?, ?, ?, ?)
    `);
    const result = insertTeacher.run(phoneHash, 'Teacher B (Ownership Test)', '6', 'Mathematics');
    teacherId = result.lastInsertRowid;
    console.log(`Created Teacher B (id=${teacherId}).`);
  }

  const existingAssessment = db
    .prepare(`SELECT id FROM assessments WHERE phone_hash = ? AND title = ?`)
    .get(phoneHash, 'Teacher B Ownership Test Assessment');

  let assessmentId;
  if (existingAssessment) {
    assessmentId = existingAssessment.id;
    console.log(`Assessment already exists (id=${assessmentId}) — reusing.`);
  } else {
    const insertAssessment = db.prepare(`
      INSERT INTO assessments (phone_hash, title, grade, subject, term, assessment_type, total_marks)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const assessmentResult = insertAssessment.run(
      phoneHash,
      'Teacher B Ownership Test Assessment',
      6,
      'Mathematics',
      2,
      'test',
      20
    );
    assessmentId = assessmentResult.lastInsertRowid;

    const insertLearnerResult = db.prepare(`
      INSERT INTO learner_results (assessment_id, learner_name, mark, total_marks, percentage)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertLearnerResult.run(assessmentId, 'Test Learner B', 15, 20, 75);
  }

  console.log(`Created assessment id=${assessmentId} owned by Teacher B (phone_hash=${phoneHash.slice(0, 12)}...).`);

  // Mint a Teacher B token too, in case you want to sanity-check that
  // Teacher B *can* see their own assessment (200, not 404) before
  // testing that Teacher A can't.
  const secret = process.env.TEACHER_JWT_SECRET;
  if (secret) {
    const token = jwt.sign({ sub: teacherId }, secret, { expiresIn: '1h' });
    console.log('\n--- Teacher B token (sanity-check only, not needed for S1/S2) ---');
    console.log(token);
  } else {
    console.log('\n(TEACHER_JWT_SECRET not set — skipping Teacher B token mint.)');
  }

  console.log('\n--- Next steps ---');
  console.log(`Use Teacher A's token (from mintTeacherAToken.js) against assessment id=${assessmentId}:`);
  console.log(`  curl -i http://localhost:3000/api/assessments/${assessmentId}/detail -H "Authorization: Bearer <TEACHER_A_TOKEN>"`);
  console.log(`  curl -i http://localhost:3000/api/assessments/${assessmentId}/pdf    -H "Authorization: Bearer <TEACHER_A_TOKEN>"`);
  console.log('Both should return 404.');
  console.log('\nFor W4-S3, no seed data needed — just drop the Authorization header entirely:');
  console.log(`  curl -i http://localhost:3000/api/assessments/${assessmentId}/detail`);
  console.log('Should return 401.');
}

seed();
db.close();
