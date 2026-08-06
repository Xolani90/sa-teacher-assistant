'use strict';

// scripts/debugAiInterventionPlan.js
// Ad-hoc evidence-gathering script — NOT a permanent tool. Checks whether
// any real AI-generated intervention plan text has ever been saved (type
// 'ai_intervention_plan' in the reports table), across ALL assessments,
// and prints it alongside the computed learner-group counts for the same
// assessment so a human can directly compare "what the model said" against
// "what was actually computed" — no live API call needed.
//
// This exists because the "AI restates group counts incorrectly" claim in
// ACTIVE_WORK.md / NEXT_SESSION.md / PROJECT_ROADMAP.md / VERIFIED.md /
// PROJECT_STATUS.md / PROJECT_INVENTORY.md is currently an unconfirmed
// hypothesis — none of those docs cite an actual captured example. Before
// touching the prompt, we need to see whether one exists already.
//
// Usage: node scripts/debugAiInterventionPlan.js

const { getDb } = require('../utils/database');
const { groupLearners } = require('../services/learnerGroupingService');

const db = getDb();

const savedPlans = db.prepare(`
  SELECT id, assessment_id, content, created_at
  FROM reports
  WHERE report_type = 'ai_intervention_plan'
  ORDER BY created_at DESC
`).all();

console.log(`\n=== ai_intervention_plan rows across ALL assessments: ${savedPlans.length} found ===`);

if (savedPlans.length === 0) {
  console.log('\nNone exist in this database. No captured evidence of the AI misstating');
  console.log('group counts is available locally — the claim in ACTIVE_WORK.md etc. has');
  console.log('never actually been observed against real output, only hypothesized.');
  console.log('\nTo get real evidence, this needs a live generation (requires ANTHROPIC_API_KEY');
  console.log('or OPENAI_API_KEY configured) run through the actual data-driven assessment flow,');
  console.log('then compare the "Target Learners" / "groups identified" text against the real');
  console.log('groupLearners() counts for that same assessment.');
  process.exit(0);
}

for (const plan of savedPlans) {
  console.log(`\n--- report id=${plan.id}, assessment_id=${plan.assessment_id}, saved ${plan.created_at} ---`);

  const grouping = groupLearners(plan.assessment_id);
  console.log('Computed groupLearners() for this assessment:');
  console.log(JSON.stringify(grouping.groups, null, 2));

  console.log('\nSaved AI plan text:');
  console.log(plan.content);
  console.log('\n--- compare the counts above by hand ---');
}
