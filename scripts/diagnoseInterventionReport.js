'use strict';

/**
 * scripts/diagnoseInterventionReport.js
 *
 * One-assessment, end-to-end diagnostic for the intervention-report
 * zeroing bug (averageFacilityValue / averageDiscrimination / Target
 * group size). Traces a single assessmentId through the REAL pipeline
 * functions (not a re-implementation) and prints the value at each
 * checkpoint, so the first checkpoint that goes wrong pinpoints the
 * defect's location.
 *
 * Usage:
 *   node scripts/diagnoseInterventionReport.js <assessmentId>
 *
 * Uses the same DB_PATH env var as the rest of the app — run it with
 * the same environment you'd use to start the server, e.g.:
 *   DB_PATH=/var/data/teacher_assistant.db node scripts/diagnoseInterventionReport.js 123
 */

const assessmentId = Number(process.argv[2]);

if (!Number.isInteger(assessmentId) || assessmentId <= 0) {
  console.error('Usage: node scripts/diagnoseInterventionReport.js <assessmentId>');
  process.exit(1);
}

const { getDb } = require('../utils/database');
const { performItemAnalysis } = require('../services/itemAnalysisService');
const { generateInterventionReport, generateTeacherSummary } = require('../services/interventionReportsService');

function section(title) {
  console.log('\n' + '='.repeat(70));
  console.log(title);
  console.log('='.repeat(70));
}

function main() {
  const db = getDb();

  section(`CONTEXT — assessment ${assessmentId}`);
  const assessment = db.prepare(`SELECT * FROM assessments WHERE id = ?`).get(assessmentId);
  if (!assessment) {
    console.error(`No assessment found with id ${assessmentId}. Stopping.`);
    process.exit(1);
  }
  console.log('assessments row:', assessment);

  const isBlueprintBacked = !!assessment.blueprint_id;
  console.log('isBlueprintBacked:', isBlueprintBacked);

  if (isBlueprintBacked) {
    const blueprint = db.prepare(`SELECT * FROM assessment_blueprints WHERE id = ?`).get(assessment.blueprint_id);
    console.log('assessment_blueprints row:', blueprint);
    const questions = db.prepare(`SELECT * FROM blueprint_questions WHERE blueprint_id = ?`).all(assessment.blueprint_id);
    console.log(`blueprint_questions (${questions.length} rows):`, questions);
  }

  section('CHECKPOINT 1 — learner_results.question_data (raw, as stored)');
  const learnerRows = db
    .prepare(`SELECT id, learner_id, learner_name, mark, total_marks, percentage, question_data FROM learner_results WHERE assessment_id = ?`)
    .all(assessmentId);

  if (learnerRows.length === 0) {
    console.error('No learner_results rows for this assessment. Bug is upstream of analytics entirely — nothing was ever stored for this assessmentId.');
    process.exit(1);
  }

  for (const row of learnerRows.slice(0, 5)) {
    console.log(`  learner_id=${row.learner_id} name=${row.learner_name} mark=${row.mark}/${row.total_marks} question_data=${row.question_data}`);
    if (!row.question_data) {
      console.warn(`  ⚠️  question_data is NULL/empty for learner_id=${row.learner_id} — this row contributes nothing to item analysis.`);
      continue;
    }
    try {
      const parsed = JSON.parse(row.question_data);
      console.log('    parsed:', parsed);
      if (Object.keys(parsed).length === 0) {
        console.warn(`  ⚠️  question_data parses to an empty object for learner_id=${row.learner_id}.`);
      }
    } catch (e) {
      console.error(`  ❌ question_data is not valid JSON for learner_id=${row.learner_id}: ${e.message}`);
    }
  }
  if (learnerRows.length > 5) {
    console.log(`  ...and ${learnerRows.length - 5} more row(s) not printed.`);
  }

  section('CHECKPOINT 2 — performItemAnalysis(assessmentId) output');
  const itemAnalysis = performItemAnalysis(assessmentId);
  console.log(JSON.stringify(itemAnalysis, null, 2));
  if (itemAnalysis.error) {
    console.error(`❌ performItemAnalysis returned an error: "${itemAnalysis.error}". Bug is at or before this checkpoint — Checkpoint 1 data is not reaching analysis correctly, or there genuinely is none.`);
  } else {
    console.log(`averageFacilityValue = ${itemAnalysis.averageFacilityValue}`);
    console.log(`averageDiscrimination = ${itemAnalysis.averageDiscrimination}`);
    if (itemAnalysis.averageFacilityValue === 0 || Number.isNaN(itemAnalysis.averageFacilityValue)) {
      console.warn('⚠️  averageFacilityValue is already 0/NaN at Checkpoint 2 — bug is inside performItemAnalysis() or its Checkpoint-1 inputs, NOT in report generation.');
    } else {
      console.log('✅ Checkpoint 2 values look non-zero — bug (if it reproduces here) is downstream, in report generation.');
    }
  }

  section('CHECKPOINT 3 — generateInterventionReport(assessmentId) → report.itemAnalysis');
  const report = generateInterventionReport(assessmentId);
  if (report.error) {
    console.error(`❌ generateInterventionReport returned an error: "${report.error}"`);
  } else {
    console.log('report.itemAnalysis.averageFacilityValue =', report.itemAnalysis && report.itemAnalysis.averageFacilityValue);
    console.log('report.itemAnalysis.averageDiscrimination =', report.itemAnalysis && report.itemAnalysis.averageDiscrimination);
    console.log('report.interventionPlan.targetGroups =', report.interventionPlan && report.interventionPlan.targetGroups);
    const targetGroupSize = ((report.interventionPlan && report.interventionPlan.targetGroups) || []).reduce((s, g) => s + g.count, 0);
    console.log('Computed "Target group size" =', targetGroupSize);
    if (!report.interventionPlan) {
      console.warn('⚠️  report.interventionPlan is null — check whether a saved AI plan exists (getSavedAiInterventionText) or computeInterventionPlan() failed/returned an error.');
    } else if (targetGroupSize === 0) {
      console.warn('⚠️  Target group size is 0. Confirm via report.learnerGrouping whether this is CORRECT (no learners in groups C/D — i.e. no one needs intervention) or WRONG (groups miscalculated). Print report.learnerGrouping below to check.');
      console.log('report.learnerGrouping =', JSON.stringify(report.learnerGrouping, null, 2));
    }
  }

  section('CHECKPOINT 4 — generateTeacherSummary(report) text output');
  const summary = generateTeacherSummary(report);
  console.log(summary);

  section('DIAGNOSIS GUIDE');
  console.log([
    '- If Checkpoint 1 shows question_data NULL/empty/malformed for most rows:',
    '    → bug is in the WRITE path for this assessment (capture/import), or this',
    '      assessment predates the current question_data convention. Not a code bug',
    '      in the read path — there is nothing to read.',
    '- If Checkpoint 1 looks populated/correct but Checkpoint 2 is already 0/NaN:',
    '    → bug is inside performItemAnalysis() itself, or blueprintQuestionMeta',
    '      resolution (check whether question_number keys actually matched).',
    '- If Checkpoint 2 is correct but Checkpoint 3 shows 0:',
    '    → bug is inside generateInterventionReport() — check whether it is calling',
    '      performItemAnalysis() with the right assessmentId, or overwriting the result.',
    '- If Checkpoint 3 is correct but Checkpoint 4 (or the actual UI/PDF) shows 0:',
    '    → bug is in generateTeacherSummary()/PDF formatting, or in a DIFFERENT',
    '      code path than the one this script calls (e.g. a cached/stale report,',
    '      or the dashboard calling a different service than the WhatsApp flow).',
  ].join('\n'));
}

main();
