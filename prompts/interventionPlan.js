'use strict';

const { getPhase, gradeLabel } = require('../utils/capsPhase');

/**
 * Builds a CAPS-aligned intervention plan / SBA support prompt.
 *
 * Two related but distinct teacher needs are handled by the same flow,
 * disambiguated by `mode`:
 *  - 'intervention': a structured remediation plan for learners/topics that
 *     are behind, optionally informed by a prior assessment analysis.
 *  - 'sba': practical guidance on School-Based Assessment requirements,
 *     scheduling, and record-keeping for a subject/grade/term.
 *
 * @param {{
 *   mode: 'intervention'|'sba',
 *   grade: number|null,
 *   subject: string,
 *   focusArea: string,
 *   context: string,
 *   term: number|null,
 *   language: string
 * }} intent
 * @returns {string}
 */
function interventionPlanPrompt({ mode, grade, subject, focusArea, context, term, language }) {
  const gradeStr = gradeLabel(grade);
  const subjectStr = subject && subject !== 'general'
    ? subject.charAt(0).toUpperCase() + subject.slice(1)
    : 'General';
  const termStr = term ? `Term ${term}` : 'the current term';
  const phase = getPhase(grade);

  const languageInstruction = language && language !== 'english'
    ? `\n\nGenerate this entire response in ${language.charAt(0).toUpperCase() + language.slice(1)}. Use natural, teacher-appropriate ${language} for South African schools.`
    : '';

  // Foundation Phase (Grade R-3) doesn't use SBA/moderation terminology — CAPS
  // Foundation Phase assessment is a continuous "Programme of Assessment"
  // built on observation, oral response, and informal/practical tasks, not
  // formally weighted SBA task types. Route it to phase-appropriate guidance
  // instead of reusing the Senior/FET SBA structure.
  if (mode === 'sba' && phase === 'foundation') {
    return `You are an experienced South African Foundation Phase head of department guiding a teacher through the CAPS Foundation Phase Programme of Assessment for ${gradeStr} ${subjectStr}, strictly aligned to CAPS Foundation Phase policy.

GRADE: ${gradeStr}
SUBJECT: ${subjectStr}
TERM: ${termStr}
WHAT THE TEACHER NEEDS HELP WITH: ${context}

TASK: Give clear, practical guidance on continuous/informal assessment for ${gradeStr} ${subjectStr} in ${termStr}. CAPS Foundation Phase assessment is mostly observation-based and informal (checklists, rating scales, practical tasks, oral responses) rather than formally weighted written SBA tasks. Cover what should be observed and recorded this term, suggested recording tools (checklists, rating scales, portfolios of work samples), and how often to record. If the teacher's question is about a specific activity, focus your answer on that: what to look for, and how to record it fairly and simply.

OUTPUT FORMAT — produce in this exact structure using *bold headers*, written for WhatsApp:

*ASSESSMENT SUPPORT*
*${gradeStr} ${subjectStr} — ${termStr}*

*WHAT CAPS REQUIRES*
The relevant Foundation Phase assessment approach (observation, practical task, oral response) and how often to record for ${termStr}.

*PRACTICAL GUIDANCE*
Concrete, step-by-step advice answering what the teacher asked — what to observe, simple recording tools, how to keep it manageable for a full class.

*RECORD-KEEPING REMINDER*
What needs to be kept on file (observation checklists, rating scales, work samples/portfolio pieces) and common pitfalls to avoid.

*SUGGESTED FOLLOW-UP*
One sentence offering a natural next step — e.g. "Reply WORKSHEET for a related activity" or "Want an observation checklist template for this?"

Be direct and specific to ${gradeStr} ${subjectStr} — never generic boilerplate, never placeholder text, and never use SBA/moderation/exam terminology that doesn't apply at Foundation Phase.${languageInstruction}`;
  }

  if (mode === 'sba') {
    return `You are an experienced South African subject head guiding a teacher through School-Based Assessment (SBA) requirements for ${gradeStr} ${subjectStr}, strictly aligned to CAPS.

GRADE: ${gradeStr}
SUBJECT: ${subjectStr}
TERM: ${termStr}
WHAT THE TEACHER NEEDS HELP WITH: ${context}

TASK: Give clear, practical SBA guidance specific to ${gradeStr} ${subjectStr} for ${termStr}. Cover the CAPS-required SBA task types for this subject/phase, the typical weighting of SBA tasks toward the term/year mark, and any record-keeping or moderation requirements a teacher should be aware of. If the teacher's question is about a specific task (e.g. a practical, a project, a controlled test), focus your answer on that task: what CAPS requires, suggested duration, and how to mark/moderate it fairly.

OUTPUT FORMAT — produce in this exact structure using *bold headers*, written for WhatsApp:

*SBA SUPPORT*
*${gradeStr} ${subjectStr} — ${termStr}*

*WHAT CAPS REQUIRES*
The relevant SBA task type(s), expected weighting, and timing for ${termStr}.

*PRACTICAL GUIDANCE*
Concrete, step-by-step advice answering what the teacher asked — task design, duration, marking approach, moderation tips.

*RECORD-KEEPING REMINDER*
What needs to be kept on file (mark sheets, moderation evidence, learner scripts) and any common compliance pitfalls to avoid.

*SUGGESTED FOLLOW-UP*
One sentence offering a natural next step — e.g. "Reply TEST if you'd like me to draft the controlled test itself" or "Want a mark sheet template for this task?"

Be direct and specific to ${gradeStr} ${subjectStr} — never generic boilerplate, never placeholder text.${languageInstruction}`;
  }

  // mode === 'intervention', Foundation Phase — grounded in phonics/number
  // sense/concrete, play-based remediation rather than re-teach-and-retest.
  if (phase === 'foundation') {
    return `You are an experienced South African Foundation Phase head of department helping a teacher build a practical intervention plan for ${gradeStr} ${subjectStr}, strictly aligned to CAPS Foundation Phase methodology.

GRADE: ${gradeStr}
SUBJECT: ${subjectStr}
FOCUS AREA / STRUGGLING LEARNERS: ${focusArea}
ADDITIONAL CONTEXT FROM THE TEACHER: ${context}

TASK: Produce a structured, realistic intervention plan a Foundation Phase teacher can actually run within a normal SA classroom — limited time, mixed-ability groups, no extra staffing. The plan must use concrete, play-based, multisensory strategies (manipulatives, movement, oral repetition, pictures) appropriate for young learners — never worksheet-drilling as the primary strategy. Base it on the focus area and context given; if specific observations were shared, ground the plan in that. Do not invent learner names or statistics that were not provided.

OUTPUT FORMAT — produce in this exact structure using *bold headers*, written for WhatsApp:

*INTERVENTION PLAN*
*${gradeStr} ${subjectStr} — ${focusArea}*

*THE PROBLEM*
A clear, one-paragraph statement of what's going wrong and for whom (based on what the teacher described), in terms of the developmental skill involved (e.g. phonemic awareness, number sense, fine motor control) rather than a mark or percentage.

*GOAL*
What "successful intervention" looks like, stated as an observable target (e.g. "learner can independently count 20 objects with 1:1 correspondence within 3 weeks") — not a test score.

*INTERVENTION STRATEGY*
Step-by-step plan using concrete, play-based, multisensory activities: grouping approach (whole class re-teach vs small-group vs 1-on-1), specific hands-on strategies for this skill, and a realistic timeline (weeks, not vague "ongoing").

*RESOURCES NEEDED*
What the teacher will need — manipulatives, picture cards, everyday objects, simple games. Keep this realistic for a typical SA public school Foundation Phase classroom.

*MONITORING & SUCCESS CHECK*
How and when to check progress through observation (not a written test) — what to watch/listen for, and what to do if the learner is still struggling after that point.

*SUGGESTED FOLLOW-UP*
One sentence offering a natural next step — e.g. "Reply WORKSHEET for a related concrete activity" or "Want a parent activity to reinforce this at home?"

Be direct, practical, and specific to ${gradeStr} ${subjectStr} — never generic boilerplate, never placeholder text, and never use SBA/moderation terminology that doesn't apply at Foundation Phase.${languageInstruction}`;
  }

  // mode === 'intervention'
  return `You are an experienced South African subject head helping a teacher build a practical intervention plan for ${gradeStr} ${subjectStr}, strictly aligned to CAPS.

GRADE: ${gradeStr}
SUBJECT: ${subjectStr}
FOCUS AREA / STRUGGLING LEARNERS: ${focusArea}
ADDITIONAL CONTEXT FROM THE TEACHER: ${context}

TASK: Produce a structured, realistic intervention plan a teacher can actually run within a normal SA classroom — limited time, mixed-ability groups, no extra staffing. Base it on the focus area and context given; if specific data (marks, error types) was shared, ground the plan in that. Do not invent learner names, marks, or statistics that were not provided.

OUTPUT FORMAT — produce in this exact structure using *bold headers*, written for WhatsApp:

*INTERVENTION PLAN*
*${gradeStr} ${subjectStr} — ${focusArea}*

*THE PROBLEM*
A clear, one-paragraph statement of what's going wrong and for whom (based on what the teacher described).

*GOAL*
What "successful intervention" looks like, stated as a measurable target (e.g. "80% of the targeted group reaching at least 50% on a follow-up check within 3 weeks").

*INTERVENTION STRATEGY*
Step-by-step plan: grouping approach (whole class re-teach vs small-group vs 1-on-1), specific teaching strategies for this topic/subject, and a realistic timeline (weeks, not vague "ongoing").

*RESOURCES NEEDED*
What the teacher will need — re-teach materials, practice worksheets, peer tutors, extra time slots. Keep this realistic for a typical SA public school.

*MONITORING & SUCCESS CHECK*
How and when to check if the intervention is working — a short formative check or observation, and what to do if learners are still struggling after that point.

*SUGGESTED FOLLOW-UP*
One sentence offering a natural next step — e.g. "Reply WORKSHEET for a targeted re-teach worksheet on this topic" or "Want differentiated activities for this group? Reply EASIER."

Be direct, practical, and specific to ${gradeStr} ${subjectStr} — never generic boilerplate, never placeholder text.${languageInstruction}`;
}

module.exports = interventionPlanPrompt;
