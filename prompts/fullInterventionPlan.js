'use strict';

/**
 * Full Intervention Plan Prompt (Steps 6–10)
 *
 * Given item analysis, error analysis, and learner grouping from Steps 1–5,
 * generates an AI-powered intervention package covering:
 *   Step 6  — Intervention Plan
 *   Step 7  — Differentiated Activities (Groups 1–4)
 *   Step 8  — Reteaching Plan
 *   Step 9  — Monitoring Plan
 *   Step 10 — Professional Intervention Summary
 *
 * Returns a prompt string; the AI response is parsed by delimiter and sent
 * as separate WhatsApp messages.
 */

/**
 * @param {Object} opts
 * @param {string} opts.grade
 * @param {string} opts.subject
 * @param {number} opts.term
 * @param {string} opts.assessmentTitle
 * @param {string} opts.classAverage      e.g. "54%"
 * @param {Array}  opts.weakTopics        e.g. ["Fractions","Exponents"]
 * @param {Array}  opts.errorPatterns     e.g. ["Procedural errors on fractions","Conceptual gaps in place value"]
 * @param {Object} opts.groups            { group1: {count, names}, group2: ..., group3: ..., group4: ... }
 * @param {number} opts.totalLearners
 * @returns {string}
 */
function buildFullInterventionPlanPrompt(opts) {
  const {
    grade, subject, term, assessmentTitle,
    classAverage, weakTopics, errorPatterns,
    groups, totalLearners,
  } = opts;

  const g1 = groups.group1 || { count: 0, names: [] };
  const g2 = groups.group2 || { count: 0, names: [] };
  const g3 = groups.group3 || { count: 0, names: [] };
  const g4 = groups.group4 || { count: 0, names: [] };

  const formatNames = (arr) => arr.length
    ? arr.slice(0, 6).join(', ') + (arr.length > 6 ? ` and ${arr.length - 6} more` : '')
    : 'None';

  return `You are an expert South African teacher support system. A Grade ${grade} ${subject} teacher has uploaded assessment results for "${assessmentTitle}" (Term ${term}).

DIAGNOSTIC RESULTS SUMMARY:
- Total learners: ${totalLearners}
- Class average: ${classAverage}
- Topics with low performance: ${weakTopics.length ? weakTopics.join(', ') : 'Not specified'}
- Error patterns identified: ${errorPatterns.length ? errorPatterns.join('; ') : 'Not specified'}

LEARNER GROUPS (CAPS 4-level system):
- Group 1 — Intensive Support (0–39%): ${g1.count} learners — ${formatNames(g1.names)}
- Group 2 — Developing (40–59%): ${g2.count} learners — ${formatNames(g2.names)}
- Group 3 — Proficient (60–79%): ${g3.count} learners — ${formatNames(g3.names)}
- Group 4 — Advanced (80–100%): ${g4.count} learners — ${formatNames(g4.names)}

Generate a complete, practical intervention package for this South African classroom. Format your response using EXACTLY these section delimiters (on their own line):

=== STEP 6: INTERVENTION PLAN ===
Write a concise intervention plan with: Problem Area, Target Learners, Root Cause (explain WHY learners struggled — be specific about the concepts), Learning Goal, Duration (realistic for SA classrooms), Teaching Strategies (at least 3 CAPS-aligned strategies), and Resources needed. Keep it under 300 words.

=== STEP 7: DIFFERENTIATED ACTIVITIES ===
For EACH group, list 2–3 practical activities:
*Group 1 — Intensive Support:* [concrete, scaffolded, teacher-led activities]
*Group 2 — Developing:* [reinforcement with guided support]
*Group 3 — Proficient:* [independent practice with real-life application]
*Group 4 — Advanced:* [extension, peer tutoring, higher-order tasks]

=== STEP 8: RETEACHING PLAN ===
Provide a 3-phase reteaching sequence (Teach → Practice → Check):
1. Identify the specific misconception/gap to address
2. A concrete 30-minute reteaching lesson plan outline (including a hook, explanation approach, and check-for-understanding)
3. A short exit ticket with 2–3 diagnostic questions

=== STEP 9: MONITORING PLAN ===
Provide a 3-week monitoring schedule:
Week 1: [target, evidence, method]
Week 2: [target, evidence, method]
Week 3: [target, evidence, method]
Also include: Success Indicator and Review Date.

=== STEP 10: PROFESSIONAL SUMMARY ===
Write a 4–5 sentence professional intervention report summary that a Head of Department could read. Include: assessment overview, key finding, groups identified, planned intervention, and expected outcome. Use formal but accessible language.

Be specific to Grade ${grade} ${subject} and the CAPS curriculum. Keep each section concise — this will be sent via WhatsApp. No generic placeholders.`;
}

module.exports = { buildFullInterventionPlanPrompt };
