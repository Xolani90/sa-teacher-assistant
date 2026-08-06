'use strict';

/**
 * Intervention Plan Generator Service
 * Creates structured intervention plans based on assessment analysis.
 * Includes problem area identification, target learners, goals, strategies, resources, and monitoring.
 */

const { getDb } = require('../utils/database');
const { groupLearners } = require('./learnerGroupingService');
const { performErrorAnalysis } = require('./errorAnalysisService');

/**
 * Generates an intervention plan based on assessment data.
 *
 * @param {string} phoneHash - Teacher's phone hash
 * @param {number} assessmentId - Assessment ID
 * @param {Object} options - Optional parameters
 * @returns {Object} Intervention plan
 */
function generateInterventionPlan(phoneHash, assessmentId, options = {}) {
  const db = getDb();

  // Get assessment details
  const assessment = db.prepare(`
    SELECT * FROM assessments WHERE id = ?
  `).get(assessmentId);

  if (!assessment) {
    return { error: 'Assessment not found' };
  }

  // Get learner grouping
  const grouping = groupLearners(assessmentId);

  // Get error analysis
  const errorAnalysis = performErrorAnalysis(assessmentId, assessment.subject);

  // Identify target groups (Groups C and D need intervention)
  const targetGroups = [];
  if (grouping.groups && grouping.groups.C && grouping.groups.C.count > 0) {
    targetGroups.push({
      group: 'C',
      learners: grouping.groups.C.learners.map(l => l.name),
      count: grouping.groups.C.count,
    });
  }
  if (grouping.groups && grouping.groups.D && grouping.groups.D.count > 0) {
    targetGroups.push({
      group: 'D',
      learners: grouping.groups.D.learners.map(l => l.name),
      count: grouping.groups.D.count,
    });
  }

  // Identify problem areas from error analysis
  const problemAreas = errorAnalysis.errorPatterns ? 
    errorAnalysis.errorPatterns.slice(0, 3).map(e => e.topic) : [];

  // Generate goals
  const goals = generateInterventionGoals(targetGroups, problemAreas, grouping.classAverage);

  // Generate teaching strategies
  const strategies = generateTeachingStrategies(problemAreas, targetGroups);

  // Generate monitoring plan
  const monitoringPlan = generateMonitoringPlan(options.durationDays || 14);

  // Generate success indicators
  const successIndicators = generateSuccessIndicators(grouping.classAverage, targetGroups);

  const plan = {
    phoneHash,
    assessmentId,
    problemArea: problemAreas.join(', ') || 'General performance improvement',
    // RC1-H-003 fix: interventionReportsService.js reads the array form
    // (problemAreas, plural) to build teacher/HOD summaries; problemArea
    // (singular) remains for the pre-formatted display string other
    // consumers (e.g. formatInterventionPlanSummary) already rely on.
    problemAreas,
    // RC1-H-002 fix: interventionReportsService.js reads the array form
    // (targetGroups, plural) to compute a target group size; targetGroup
    // (singular) remains for the pre-formatted display string other
    // consumers (e.g. formatInterventionPlanSummary) already rely on.
    targetGroups,
    targetGroup: targetGroups.map(g => `Group ${g.group} (${g.count} learners)`).join(', ') || 'Whole class',
    goals: goals.join('\n'),
    durationDays: options.durationDays || 14,
    strategies: JSON.stringify(strategies),
    resources: generateResources(problemAreas),
    monitoringPlan: monitoringPlan,
    successIndicators: successIndicators,
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Save to database
  saveInterventionPlan(plan);

  return {
    ...plan,
    strategies: strategies, // Return as array, not JSON string
    summary: generateInterventionSummary(plan),
  };
}

/**
 * Generates intervention goals based on target groups and problem areas.
 *
 * @param {Array} targetGroups - Target learner groups
 * @param {Array} problemAreas - Problem areas identified
 * @param {number} currentAverage - Current class average
 * @returns {Array} Array of goal strings
 */
function generateInterventionGoals(targetGroups, problemAreas, currentAverage) {
  const goals = [];

  // Performance improvement goal
  const targetImprovement = Math.min(15, 100 - currentAverage);
  goals.push(`Improve overall class average by ${targetImprovement}% to ${Math.round(currentAverage + targetImprovement)}%`);

  // Group-specific goals
  for (const group of targetGroups) {
    if (group.group === 'D') {
      goals.push(`Move at least 30% of Group D learners to Group C through intensive support`);
    } else if (group.group === 'C') {
      goals.push(`Move at least 40% of Group C learners to Group B through targeted intervention`);
    }
  }

  // Problem area goals
  for (const area of problemAreas) {
    goals.push(`Achieve 70% mastery in ${area} through focused reteaching`);
  }

  return goals;
}

/**
 * Generates teaching strategies for intervention.
 *
 * @param {Array} problemAreas - Problem areas
 * @param {Array} targetGroups - Target groups
 * @returns {Array} Array of strategy objects
 */
function generateTeachingStrategies(problemAreas, targetGroups) {
  const strategies = [];

  // Differentiated instruction
  strategies.push({
    name: 'Differentiated Instruction',
    description: 'Tailor instruction to different learner needs and ability levels',
    actions: [
      'Create tiered activities for different ability groups',
      'Use flexible grouping based on specific skills',
      'Provide multiple ways for learners to demonstrate understanding',
    ],
  });

  // Integrated classroom intervention — folded into normal lesson time rather
  // than relying on extra pull-out sessions a teacher rarely has time for.
  if (targetGroups.length > 0) {
    strategies.push({
      name: 'Integrated Classroom Intervention (I Do -> We Do -> You Do)',
      description: 'Intervention built into normal lesson time, not a separate pull-out session',
      actions: [
        'I Do: Teach the concept to the whole class as normal',
        'We Do: Guided practice with the whole class, checking for understanding before releasing learners',
        'You Do: During independent practice, the teacher moves directly to the intervention group for targeted, in-the-moment support while the rest of the class works independently',
        'Repeat this structure across normal lessons rather than scheduling separate sessions — intervention becomes part of how the topic is taught, not an add-on',
      ],
    });
  }

  // Peer tutoring, with an explicit briefing so tutors know how to support
  // without doing the work for their peer.
  strategies.push({
    name: 'Peer Tutoring',
    description: 'Utilize high-achieving learners to support peers, with a short briefing so tutoring is guided rather than answer-giving',
    actions: [
      'Pair Group A learners with Group C/D learners',
      'Peer Tutor Briefing (5 minutes before first session): tutors ask guiding questions, they do not give answers. Practice phrases: "What is the first step?", "Show me how you started.", "Why did you choose that method?", "Does your answer make sense?"',
      'Give tutors a short checklist of the guiding questions to refer to during the session',
      'Monitor and support peer tutoring sessions; step in if a tutor starts answering instead of guiding',
    ],
  });

  // What the rest of the class does while the teacher is focused on the
  // intervention group during the "You Do" phase — without this, the
  // integrated model above isn't actually workable in a real classroom.
  if (targetGroups.length > 0) {
    strategies.push({
      name: 'Independent Learning and Fast Finishers',
      description: 'Keeps the rest of the class meaningfully occupied for 20-25 minutes while the teacher works with the intervention group',
      actions: [
        'Consolidation tasks: practice questions on the current topic at grade level',
        'Correction stations: learners mark and correct their own recent work against a model answer',
        'Extension activities and challenge questions for learners who finish early',
        'Self-check activities (answer sheets or QR-linked memos) so learners can verify their own progress without the teacher',
      ],
    });
  }

  // Reteaching strategies for problem areas
  for (const area of problemAreas) {
    strategies.push({
      name: `Reteaching: ${area}`,
      description: `Targeted reteaching of ${area} using alternative approaches`,
      actions: [
        'Use concrete examples and real-world connections',
        'Employ visual aids and diagrams',
        'Break down complex concepts into smaller steps',
        'Provide guided practice before independent work',
        'Use formative assessment to check understanding',
      ],
    });
  }

  return strategies;
}

/**
 * Generates a monitoring plan for the intervention.
 *
 * @param {number} durationDays - Duration in days
 * @returns {string} Monitoring plan text
 */
function generateMonitoringPlan(durationDays) {
  let plan = `*Monitoring Plan (${durationDays} days)*\n\n`;
  
  plan += `**Daily:**\n`;
  plan += `• Exit tickets to check understanding\n`;
  plan += `• Observation of learner engagement\n`;
  plan += `• Quick formative assessments\n\n`;

  plan += `**Weekly:**\n`;
  plan += `• Review learner progress and adjust strategies\n`;
  plan += `• Check completion of intervention activities\n`;
  plan += `• Gather learner feedback\n`;
  plan += `• Update progress records\n\n`;

  plan += `**Mid-point (Day ${Math.round(durationDays / 2)}):**\n`;
  plan += `• Comprehensive progress check\n`;
  plan += `• Adjust intervention strategies if needed\n`;
  plan += `• Communicate progress to stakeholders\n\n`;

  plan += `**End of Intervention:**\n`;
  plan += `• Post-intervention assessment\n`;
  plan += `• Compare pre- and post-intervention results\n`;
  plan += `• Evaluate intervention effectiveness\n`;
  plan += `• Plan next steps based on outcomes\n`;

  return plan;
}

/**
 * Generates success indicators for the intervention.
 *
 * @param {number} currentAverage - Current class average
 * @param {Array} targetGroups - Target groups
 * @returns {string} Success indicators text
 */
function generateSuccessIndicators(currentAverage, targetGroups) {
  let indicators = `*Success Indicators*\n\n`;

  const targetAverage = Math.min(currentAverage + 10, 100);
  indicators += `• Class average improves from ${Math.round(currentAverage)}% to at least ${targetAverage}%\n`;

  for (const group of targetGroups) {
    if (group.group === 'D') {
      indicators += `• At least 30% of Group D learners improve to Group C\n`;
    } else if (group.group === 'C') {
      indicators += `• At least 40% of Group C learners improve to Group B\n`;
    }
  }

  indicators += `• Learner engagement and participation increases\n`;
  indicators += `• Formative assessments show improved understanding\n`;
  indicators += `• Learner confidence in subject area improves\n`;

  return indicators;
}

/**
 * Generates resource recommendations for intervention.
 *
 * @param {Array} problemAreas - Problem areas
 * @returns {string} Resources text
 */
function generateResources(problemAreas) {
  let resources = `*Recommended Resources*\n\n`;

  resources += `**General:**\n`;
  resources += `• Manipulatives and concrete materials\n`;
  resources += `• Visual aids and diagrams\n`;
  resources += `• Digital learning tools and apps\n`;
  resources += `• Practice worksheets and exercises\n\n`;

  if (problemAreas.length > 0) {
    resources += `**For Problem Areas:**\n`;
    for (const area of problemAreas) {
      resources += `• ${area}: Additional practice materials and examples\n`;
    }
  }

  resources += `\n**Time:**\n`;
  resources += `• No extra timetable slots needed — intervention runs inside normal lessons during independent practice ("You Do" time)\n`;
  resources += `• Independent/self-check materials ready for the rest of the class so the teacher is genuinely free to work with the intervention group\n`;
  resources += `• Additional practice time outside class as needed for learners who need more than in-lesson support\n`;

  return resources;
}

/**
 * Generates a summary of the intervention plan.
 *
 * @param {Object} plan - Intervention plan object
 * @returns {string} Summary text
 */
function generateInterventionSummary(plan) {
  let summary = `*Intervention Plan*\n\n`;
  summary += `**Problem Area:** ${plan.problemArea}\n\n`;
  summary += `**Target Group:** ${plan.targetGroup}\n\n`;
  summary += `**Duration:** ${plan.durationDays} days\n\n`;
  summary += `**Goals:**\n${plan.goals}\n\n`;
  summary += `**Strategies:**\n`;

  let strategies;
  if (typeof plan.strategies === 'string') {
    try {
      strategies = JSON.parse(plan.strategies);
    } catch (e) {
      console.error('Failed to parse strategies in generateInterventionSummary:', e.message);
      strategies = [];
    }
  } else {
    strategies = plan.strategies || [];
  }

  for (const strategy of strategies) {
    summary += `• ${strategy.name}: ${strategy.description}\n`;
  }

  summary += `\n**Monitoring:**\n${plan.monitoringPlan}\n\n`;
  summary += `**Success Indicators:**\n${plan.successIndicators}`;

  return summary;
}

/**
 * Saves an intervention plan to the database.
 *
 * @param {Object} plan - Intervention plan object
 */
function saveInterventionPlan(plan) {
  const db = getDb();

  const result = db.prepare(`
    INSERT INTO intervention_plans (
      phone_hash, assessment_id, problem_area, target_group, goals, duration_days,
      strategies, resources, monitoring_plan, success_indicators, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    plan.phoneHash,
    plan.assessmentId,
    plan.problemArea,
    plan.targetGroup,
    plan.goals,
    plan.durationDays,
    plan.strategies,
    plan.resources,
    plan.monitoringPlan,
    plan.successIndicators,
    plan.status
  );

  const planId = result.lastInsertRowid;

  // TSE Evidence Engine (Migration 034): tag as 'intervention' evidence.
  // Non-fatal. Return value added here (previously void) — no existing
  // caller uses saveInterventionPlan()'s return value, so this is safe.
  try {
    require('./tseEvidenceService').tagEvidence(
      plan.phoneHash,
      'intervention',
      'intervention_plans',
      planId
    );
  } catch (evidenceErr) {
    console.error('[TSE] saveInterventionPlan evidence tagging failed:', evidenceErr.message);
  }

  return planId;
}

/**
 * Gets active intervention plans for a teacher.
 *
 * @param {string} phoneHash - Teacher's phone hash
 * @returns {Array} Array of intervention plans
 */
function getActiveInterventionPlans(phoneHash) {
  const db = getDb();

  return db.prepare(`
    SELECT * FROM intervention_plans
    WHERE phone_hash = ? AND status = 'active'
    ORDER BY created_at DESC
  `).all(phoneHash);
}

/**
 * Updates the status of an intervention plan.
 *
 * @param {number} planId - Plan ID
 * @param {string} status - New status
 */
function updateInterventionPlanStatus(planId, status) {
  const db = getDb();

  db.prepare(`
    UPDATE intervention_plans
    SET status = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(status, planId);
}

module.exports = {
  generateInterventionPlan,
  saveInterventionPlan,
  getActiveInterventionPlans,
  updateInterventionPlanStatus,
  generateInterventionSummary,
};
