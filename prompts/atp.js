'use strict';

const { gradeLabel } = require('../utils/capsPhase');

/**
 * Builds a CAPS-aligned Annual Teaching Plan prompt.
 *
 * @param {{ grade: number|null, subject: string, language: string }} intent
 * @returns {string}
 */
function atpPrompt({ grade, subject, language }) {
  const gradeStr = gradeLabel(grade);
  const subjectStr = subject && subject !== 'general'
    ? subject.charAt(0).toUpperCase() + subject.slice(1)
    : 'General';

  const currentYear = new Date().getFullYear();

  const languageInstruction = language && language !== 'english'
    ? `\n\nGenerate this entire response in ${language.charAt(0).toUpperCase() + language.slice(1)}. Use natural, teacher-appropriate ${language} for South African schools.`
    : '';

  const isFoundationPhase = grade !== null && grade !== undefined && grade >= 0 && grade <= 3;
  if (isFoundationPhase) {
    const fpGradeStr = grade === 0 ? 'Grade R' : `Grade ${grade}`;
    return foundationPhaseAnnualTeachingPlan({ grade, gradeStr: fpGradeStr, subjectStr, currentYear, languageInstruction });
  }

  return `You are a qualified South African teacher producing a complete Annual Teaching Plan (ATP) strictly aligned to the CAPS curriculum.

TASK: Generate a full CAPS Annual Teaching Plan for ${gradeStr} ${subjectStr} for the ${currentYear} academic year.

CAPS ALIGNMENT REQUIREMENTS:
- Follow the official CAPS curriculum sequence for ${gradeStr} ${subjectStr}
- Cover all 4 terms of ${currentYear} with correct CAPS topic sequencing and weighting
- Include formal assessment tasks per CAPS assessment guidelines (tests, assignments, projects, exams)
- Show approximate week numbers per topic (40 school weeks per year, ~10 per term)
- CRITICAL: Week ranges must be strictly sequential and non-overlapping within each term. Each week number (e.g. Week 5) may appear in ONE topic row only — never repeat a week number across two different topic rows, even by one week. Before finalizing, check that each term's row-by-row week ranges are strictly increasing (e.g. 1–2, 3–4, 4–5 is INVALID because week 4 repeats; use 1–2, 3–4, 5–6 instead) and that the final row in each term ends exactly on that term's last week (10, 20, 30, or 40)
- Use correct CAPS terminology throughout
- Reference CAPS document page numbers or unit names where commonly known
- Include South African public holidays/school terms context for ${currentYear} (Term 1: ~Jan–Mar, Term 2: ~Apr–Jun, Term 3: ~Jul–Sep, Term 4: ~Oct–Nov)

OUTPUT FORMAT — produce in this exact structure using *bold headers*:

*ANNUAL TEACHING PLAN ${currentYear}*
*${gradeStr} ${subjectStr}*

*TERM 1 (Weeks 1–10)*
| Week | Topic / Content | Assessment |
List each topic block with week range, topic name, and any formal assessment due

*TERM 2 (Weeks 11–20)*
(same format)

*TERM 3 (Weeks 21–30)*
(same format)

*TERM 4 (Weeks 31–40)*
(same format)

*ASSESSMENT OVERVIEW*
List all formal CAPS assessment tasks for ${currentYear}: type, term, approximate date, marks weighting
CRITICAL — this section must be internally consistent with the task list you just wrote, not restated from general CAPS knowledge:
- Do NOT state a fixed number of formal assessment tasks (e.g. "CAPS requires 7 tasks") unless that number exactly equals the count of tasks you listed in this same section. If you are unsure of the exact CAPS-mandated count for ${gradeStr} ${subjectStr}, omit the sentence entirely rather than stating a number that might not match your own list.
- PROMOTION MARK RULE (strict): Do NOT generate any promotion-mark calculations, term-weighting percentages, converted marks, SBA percentages, or final promotion summaries of any kind. Only include a promotion-mark section if every single value in it can be calculated directly, with simple addition, from the exact marks shown in the assessment task table you generated above. Never estimate, infer, assume, or apply generic CAPS weighting rules (e.g. do not assume a 25/75 or 60/40 split unless that split and those exact marks are both verifiably derived from the table). If the assessment table does not give you enough information to calculate a promotion mark with certainty, omit the entire Promotion Mark section — do not include a partial, approximate, or "converted" version of it. When in doubt, omit it; a missing promotion-mark section is far less harmful to a teacher than a wrong one.

*NOTES*
Any important CAPS requirements, resource suggestions, or cross-curriculum links specific to ${gradeStr} ${subjectStr}

Keep each term section concise but complete — this is a planning document, not lesson-level detail. A teacher should be able to use this as their official ATP submission for ${currentYear}.${languageInstruction}`;
}

/**
 * Foundation Phase (Grade R-3) Annual Teaching Plans follow official CAPS
 * Foundation Phase structure, which differs from Intermediate/Senior/FET:
 * content is organised around integrated themes rather than isolated
 * topic lists, assessment is continuous and observation/task-based (no
 * formal written exams for this phase), and planning must reflect the
 * concrete, play-based nature of Foundation Phase teaching.
 */
function foundationPhaseAnnualTeachingPlan({ grade, gradeStr, subjectStr, currentYear, languageInstruction }) {
  return `You are a qualified South African Foundation Phase teacher producing a complete Annual Teaching Plan (ATP) strictly aligned to CAPS Foundation Phase requirements.

TASK: Generate a full CAPS Foundation Phase Annual Teaching Plan for ${gradeStr} ${subjectStr} for the ${currentYear} academic year.

CAPS FOUNDATION PHASE ALIGNMENT REQUIREMENTS:
- Follow the official CAPS Foundation Phase curriculum sequence for ${gradeStr} ${subjectStr}
- Organise content around integrated themes appropriate to ${gradeStr} (e.g. My Body, My Family, Weather, Transport, Water) rather than isolated abstract topics — Foundation Phase teaching is theme-integrated across Home Language, First Additional Language, Mathematics and Life Skills
- Cover all 4 terms of ${currentYear} with correct CAPS Foundation Phase topic sequencing and weighting
- Show approximate week numbers per theme/topic (40 school weeks per year, ~10 per term)
- CRITICAL: Week ranges must be strictly sequential and non-overlapping within each term. Each week number (e.g. Week 5) may appear in ONE topic row only — never repeat a week number across two different topic rows, even by one week. Before finalizing, check that each term's row-by-row week ranges are strictly increasing (e.g. 1–2, 3–4, 4–5 is INVALID because week 4 repeats; use 1–2, 3–4, 5–6 instead) and that the final row in each term ends exactly on that term's last week (10, 20, 30, or 40)
- Use correct CAPS Foundation Phase terminology throughout
- Assessment must reflect the CAPS Foundation Phase Programme of Assessment: continuous, informal, and observation/task-based (checklists, practical tasks, oral responses, portfolios) — NOT formal written tests or examinations, which are not part of CAPS Foundation Phase practice
- Include South African public holidays/school terms context for ${currentYear} (Term 1: ~Jan–Mar, Term 2: ~Apr–Jun, Term 3: ~Jul–Sep, Term 4: ~Oct–Nov)

OUTPUT FORMAT — produce in this exact structure using *bold headers*:

*ANNUAL TEACHING PLAN ${currentYear}*
*${gradeStr} ${subjectStr}*

*TERM 1 (Weeks 1–10)*
| Week | Theme / Content | Assessment Activity |
List each theme block with week range, theme/topic name, and any continuous assessment activity (observation, task, oral response — never a written test)

*TERM 2 (Weeks 11–20)*
(same format)

*TERM 3 (Weeks 21–30)*
(same format)

*TERM 4 (Weeks 31–40)*
(same format)

*ASSESSMENT OVERVIEW*
List all continuous assessment activities for ${currentYear}: type (observation checklist, practical task, oral activity, portfolio item), term, approximate timing. Do not include marks, formal exams, or written tests.

*NOTES*
Any important CAPS Foundation Phase requirements, concrete resource suggestions, or theme integration links across Home Language, First Additional Language, Mathematics and Life Skills specific to ${gradeStr} ${subjectStr}

Keep each term section concise but complete — this is a planning document, not lesson-level detail. A teacher should be able to use this as their official ${gradeStr} ATP submission for ${currentYear}.${languageInstruction}`;
}

module.exports = atpPrompt;
