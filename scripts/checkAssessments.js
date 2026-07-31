'use strict';

require('dotenv').config();
const { getDb } = require('./utils/database');

const db = getDb();

const assessments = db.prepare(`
  SELECT id, title, grade, subject, total_marks, blueprint_id, created_at
  FROM assessments
  ORDER BY id DESC
  LIMIT 5
`).all();

console.log('[check] Recent assessments:');
console.log(JSON.stringify(assessments, null, 2));

if (assessments.length > 0) {
  const latest = assessments[0];
  const learnerResults = db.prepare(`
    SELECT learner_name, mark, total_marks, percentage
    FROM learner_results
    WHERE assessment_id = ?
  `).all(latest.id);
  console.log(`\n[check] Learner results for assessment ${latest.id}:`);
  console.log(JSON.stringify(learnerResults, null, 2));
}
