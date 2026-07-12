'use strict';

/**
 * Builds a CAPS-aligned Annual Teaching Plan prompt.
 *
 * @param {{ grade: number|null, subject: string, language: string }} intent
 * @returns {string}
 */
function atpPrompt({ grade, subject, language }) {
  const gradeStr = grade ? `Grade ${grade}` : 'the appropriate grade level';
  const subjectStr = subject && subject !== 'general'
    ? subject.charAt(0).toUpperCase() + subject.slice(1)
    : 'General';

  const currentYear = new Date().getFullYear();

  const languageInstruction = language && language !== 'english'
    ? `\n\nGenerate this entire response in ${language.charAt(0).toUpperCase() + language.slice(1)}. Use natural, teacher-appropriate ${language} for South African schools.`
    : '';

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

*NOTES*
Any important CAPS requirements, resource suggestions, or cross-curriculum links specific to ${gradeStr} ${subjectStr}

Keep each term section concise but complete — this is a planning document, not lesson-level detail. A teacher should be able to use this as their official ATP submission for ${currentYear}.${languageInstruction}`;
}

module.exports = atpPrompt;
