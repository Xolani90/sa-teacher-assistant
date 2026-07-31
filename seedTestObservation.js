/**
 * seedTestObservation.js
 *
 * Seeds a test observation session (observation_assessments + observation_records)
 * against the real dev DB so PR27's GET /api/observations/:assessmentId endpoint
 * and the ObservationDetail.jsx page can be verified with real data.
 *
 * Usage:
 *   node seedTestObservation.js
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'teacher_assistant.db');
const db = new Database(DB_PATH);

const PHONE_HASH = 'c303876569ab3c93a48e245f2415b2a052d82847b7d4d6e40f788adb1d7a6ec1'; // Thabo Mokoena
const CLASS_ID = 2; // Grade 6A Mathematics (already has 5 learners seeded)
const GRADE = '6';
const SUBJECT = 'Mathematics';
const ASSESSMENT_NAME = 'Term 2 Classroom Observation (Seed)';

// Learner IDs from the existing seed: 1=Thabo, 2=Lerato, 3=Sipho, 4=Naledi, 5=Kagisho
const LEARNERS = [
  { id: 1, name: 'Thabo Mokoena' },
  { id: 2, name: 'Lerato Dlamini' },
  { id: 3, name: 'Sipho Nkosi' },
  { id: 4, name: 'Naledi Khumalo' },
  { id: 5, name: 'Kagisho Van Wyk' },
];

const DOMAINS = ['Cognitive', 'Social', 'Emotional', 'Physical'];
const STATUSES = ['exceeding', 'meeting', 'developing', 'not yet meeting'];

function seed() {
  const insertAssessment = db.prepare(`
    INSERT INTO observation_assessments
      (phone_hash, grade, subject, assessment_name, class_id)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertRecord = db.prepare(`
    INSERT INTO observation_records
      (assessment_id, learner_name, domain, developmental_status, notes, learner_id, resolved)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const seedTxn = db.transaction(() => {
    const { lastInsertRowid: assessmentId } = insertAssessment.run(
      PHONE_HASH,
      GRADE,
      SUBJECT,
      ASSESSMENT_NAME,
      CLASS_ID
    );

    LEARNERS.forEach((learner, i) => {
      // Give each learner 1-2 domain records with varied statuses/notes
      const domain = DOMAINS[i % DOMAINS.length];
      const status = STATUSES[i % STATUSES.length];

      insertRecord.run(
        assessmentId,
        learner.name,
        domain,
        status,
        `Observed during group activity — ${status.replace('_', ' ')} expectations in ${domain.toLowerCase()} domain.`,
        learner.id,
        0
      );

      // Add a second domain for the first two learners to test multi-domain rendering
      if (i < 2) {
        const domain2 = DOMAINS[(i + 1) % DOMAINS.length];
        const status2 = STATUSES[(i + 1) % STATUSES.length];
        insertRecord.run(
          assessmentId,
          learner.name,
          domain2,
          status2,
          `Follow-up note on ${domain2.toLowerCase()} — ${status2}.`,
          learner.id,
          0
        );
      }
    });

    // Add one resolved record so the UI's "resolved" state gets visual coverage too
    // (all records above are unresolved / "Follow-up required").
    insertRecord.run(
      assessmentId,
      'Kagisho Van Wyk',
      'Physical',
      'meeting',
      'Follow-up complete — now meeting physical domain expectations.',
      5,
      1
    );

    return assessmentId;
  });

  const assessmentId = seedTxn();

  console.log(`✅ Seeded observation_assessments.id = ${assessmentId}`);
  console.log(`   Test it with:`);
  console.log(`   curl http://localhost:3000/api/observations/${assessmentId} \\`);
  console.log(`     -H "Authorization: Bearer <fresh accessToken>"`);
}

seed();
db.close();
