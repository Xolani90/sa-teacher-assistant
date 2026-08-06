'use strict';

// scripts/debugItemAnalysis.js
// Ad-hoc evidence-gathering script — NOT a permanent tool. Run against the
// live local dev DB to see exactly what performItemAnalysis() and
// generateInterventionReport() produce for a real assessment, and to dump
// the raw question_data + blueprint_questions rows they read from.
//
// Usage: node scripts/debugItemAnalysis.js <assessmentId>

const assessmentId = Number(process.argv[2] || 1);

const { getDb } = require('../utils/database');
const { performItemAnalysis } = require('../services/itemAnalysisService');

const db = getDb();

console.log(`\n=== assessments row (id=${assessmentId}) ===`);
console.log(db.prepare('SELECT * FROM assessments WHERE id = ?').get(assessmentId));

console.log(`\n=== learner_results rows (assessment_id=${assessmentId}) ===`);
const learnerRows = db.prepare('SELECT id, learner_name, mark, total_marks, question_data FROM learner_results WHERE assessment_id = ?').all(assessmentId);
for (const row of learnerRows) {
  console.log({ ...row, question_data_parsed: safeParse(row.question_data) });
}

const assessment = db.prepare('SELECT * FROM assessments WHERE id = ?').get(assessmentId);
if (assessment && assessment.blueprint_id) {
  console.log(`\n=== blueprint_questions rows (blueprint_id=${assessment.blueprint_id}) ===`);
  console.log(db.prepare('SELECT question_number, topic, max_marks FROM blueprint_questions WHERE blueprint_id = ?').all(assessment.blueprint_id));
}

console.log(`\n=== performItemAnalysis(${assessmentId}) result ===`);
console.log(JSON.stringify(performItemAnalysis(assessmentId), null, 2));

function safeParse(s) {
  try { return JSON.parse(s); } catch (_) { return s; }
}
