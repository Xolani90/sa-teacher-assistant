'use strict';

process.env.DB_PATH = require('path').join(__dirname, `migration-036-test-${Date.now()}.db`);
const { getDb, runMigrations } = require('../utils/database');
const { saveLearnerInterventionPlan } = require('../services/interventionService');

runMigrations();
const db = getDb();

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('── Migration 036: saveLearnerInterventionPlan() ──');

db.prepare(`INSERT INTO teachers (phone_hash, name) VALUES (?, ?)`).run('m036_hash', 'Test Teacher');

const learnerId = db.prepare(`
  INSERT INTO learners (phone_hash, canonical_name, normalized_name)
  VALUES (?, ?, ?)
`).run('m036_hash', 'Thabo M', 'thabo m').lastInsertRowid;

const assessmentId = db.prepare(`
  INSERT INTO assessments (phone_hash, title, grade, subject, term, assessment_type, total_marks)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`).run('m036_hash', 'Test Assessment', 5, 'mathematics', 1, 'formal', 50).lastInsertRowid;

const secondAssessmentId = db.prepare(`
  INSERT INTO assessments (phone_hash, title, grade, subject, term, assessment_type, total_marks)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`).run('m036_hash', 'Second Assessment', 5, 'mathematics', 1, 'formal', 50).lastInsertRowid;

const basePlan = {
  learnerId,
  subject: 'mathematics',
  priority: 'high',
  focusTopics: ['Fractions', 'Ratio'],
  recommendedActions: ['Small-group intervention.'],
  evidence: {},
};

const id1 = saveLearnerInterventionPlan(basePlan, { assessmentId });
const row1 = db.prepare(`SELECT * FROM intervention_plans WHERE id = ?`).get(id1);
assert(!!row1, 'creates a row');
assert(row1.learner_id === learnerId, 'row has correct learner_id');
assert(row1.subject === 'mathematics', 'row has correct subject');
assert(row1.status === 'active', 'row defaults to active');
assert(row1.assessment_id === assessmentId, 'row carries assessment_id');

const updatedPlan = { ...basePlan, recommendedActions: ['Updated action.'] };
const id2 = saveLearnerInterventionPlan(updatedPlan, { assessmentId: secondAssessmentId });
assert(id2 === id1, 'second call for same learner+subject updates the same row');
const countRows = db.prepare(`
  SELECT COUNT(*) as c FROM intervention_plans WHERE learner_id = ? AND subject = ?
`).get(learnerId, 'mathematics').c;
assert(countRows === 1, 'still exactly one row after the duplicate call');
const row2 = db.prepare(`SELECT * FROM intervention_plans WHERE id = ?`).get(id1);
assert(row2.goals.includes('Updated action.'), 'goals refreshed on update');
assert(row2.assessment_id === assessmentId, 'assessment_id kept via COALESCE, not overwritten');

const groupPlanId = db.prepare(`
  INSERT INTO intervention_plans (
    phone_hash, assessment_id, problem_area, target_group, goals,
    duration_days, strategies, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
`).run('m036_hash', assessmentId, 'Group problem', 'Group C', 'Group goals', 14, '[]').lastInsertRowid;
saveLearnerInterventionPlan(basePlan, { assessmentId });
const groupRow = db.prepare(`SELECT * FROM intervention_plans WHERE id = ?`).get(groupPlanId);
assert(groupRow.learner_id === null, 'group-level row (no learner_id) untouched by learner writer');
assert(groupRow.subject === null, 'group-level row has no subject, unaffected');

assert(row2.outcome_status === null, 'outcome_status left null — this writer never sets it');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
