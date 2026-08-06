'use strict';

// scripts/debugInterventionReport.js
// Ad-hoc evidence-gathering script — NOT a permanent tool. Investigates
// the "Target group size" symptom independently of the (disproven) item
// analysis hypothesis. Dumps the raw intervention_plans + reports rows
// for an assessment, then the live generateInterventionReport() output,
// so we can see exactly which branch (source: 'ai' vs 'rules') fires and
// what report.interventionPlan actually contains.
//
// Usage: node scripts/debugInterventionReport.js [assessmentId]
// With no argument, lists every assessment_id that has intervention_plans
// and/or ai_intervention_plan report rows, so you can pick one to test.

const { getDb } = require('../utils/database');
const { generateInterventionReport } = require('../services/interventionReportsService');

const db = getDb();
const arg = process.argv[2];

if (!arg) {
  console.log('\n=== assessment_ids with intervention_plans rows ===');
  console.log(db.prepare(`
    SELECT assessment_id, COUNT(*) AS plan_count
    FROM intervention_plans GROUP BY assessment_id
  `).all());

  console.log('\n=== assessment_ids with saved AI intervention plan reports ===');
  console.log(db.prepare(`
    SELECT assessment_id, COUNT(*) AS report_count
    FROM reports WHERE report_type = 'ai_intervention_plan' GROUP BY assessment_id
  `).all());

  console.log('\nRe-run with one of the assessment_ids above, e.g.:');
  console.log('  node scripts/debugInterventionReport.js 1');
  process.exit(0);
}

const assessmentId = Number(arg);

console.log(`\n=== intervention_plans rows (assessment_id=${assessmentId}) ===`);
console.log(db.prepare('SELECT * FROM intervention_plans WHERE assessment_id = ?').all(assessmentId));

console.log(`\n=== reports rows, type='ai_intervention_plan' (assessment_id=${assessmentId}) ===`);
console.log(db.prepare(`
  SELECT id, assessment_id, report_type, created_at, LENGTH(content) AS content_length
  FROM reports WHERE assessment_id = ? AND report_type = 'ai_intervention_plan'
`).all(assessmentId));

console.log(`\n=== generateInterventionReport(${assessmentId}).interventionPlan ===`);
const report = generateInterventionReport(assessmentId);
console.log(JSON.stringify(report.interventionPlan, null, 2));

console.log(`\n=== HOD summary excerpt (section 4 — where "Target group size" is printed) ===`);
const { generateHodSummary } = require('../services/interventionReportsService');
const hodSummary = generateHodSummary(report);
const section4 = hodSummary.split('*4.')[1];
console.log(section4 ? '*4.' + section4.split('*5.')[0] : '(section 4 not found in summary — dumping full summary below)\n' + hodSummary);
