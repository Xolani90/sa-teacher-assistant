'use strict';

const { getPhase } = require('../utils/capsPhase');

/**
 * Builds a CAPS-aligned analytical rubric prompt.
 *
 * @param {{ grade: number|null, subject: string, topic: string, marks: number, language: string }} intent
 * @returns {string}
 */
function rubricPrompt({ grade, subject, topic, marks, language }) {
  // Grade R (0) is a genuine grade, not an unset one — must not fall through
  // to the null/undefined fallback below. Grades 1-12 and unset grade (null/
  // undefined) keep their exact prior behaviour.
  const gradeStr = grade === 0 ? 'Grade R' : (grade ? `Grade ${grade}` : 'Grade 8');
  const subjectStr = subject && subject !== 'general'
    ? subject.charAt(0).toUpperCase() + subject.slice(1)
    : 'General';
  const totalMarks = marks || 20;

  const languageInstruction = language && language !== 'english'
    ? `\n\nGenerate this entire rubric in ${language.charAt(0).toUpperCase() + language.slice(1)}.`
    : '';

  // ── Foundation Phase (Grade R-3): CAPS has no marks-per-criterion rubric,
  // 7-level rating-code scale, or moderation sign-off at this phase —
  // assessment is observation-based and developmental instead.
  if (getPhase(grade) === 'foundation') {
    return `You are an experienced South African Foundation Phase teacher producing a classroom-ready observation checklist aligned to the CAPS curriculum.

TASK: Generate a developmental observation checklist for assessing: ${topic}

DETAILS:
- Grade: ${gradeStr}
- Subject: ${subjectStr}
- Focus: ${topic}

CHECKLIST REQUIREMENTS:
- Align to CAPS ${gradeStr} ${subjectStr} developmental expectations
- Use 3 observable levels: Achieved, Emerging, Not Yet Achieved — no marks, scores, or percentages
- Include 3–6 observable skills/behaviours appropriate for the focus area and CAPS content
- Each skill must have a clear, concrete, observable description — what the teacher would actually see a learner do
- Use South African school context throughout
- Do NOT use marks, mark totals, percentages, a CAPS rating-code table, or a "moderated by" sign-off — none of that applies at Foundation Phase

OUTPUT FORMAT:

═══════════════════════════════
*DEVELOPMENTAL OBSERVATION CHECKLIST*
*${topic}*
*${subjectStr} | ${gradeStr}*
═══════════════════════════════

*Learner Name:* ___________________________
*Class:* ________________ *Date:* ___________

---

*SKILLS OBSERVED*

For each skill, use this format:

*Skill [N]: [Skill Name]*

| Level | What to Look For |
|-------|-------------------|
| Achieved | [Clear, specific, observable description of the skill being achieved] |
| Emerging | [Clear description of partial/developing performance] |
| Not Yet Achieved | [Clear description of what is not yet showing] |

*Observed level: ___________*

---

[Repeat for all skills]

---

*Teacher Notes / Next Steps:*
______________________________________________
______________________________________________

Generate ALL skills fully. No placeholders. Every description must be specific, observable, and directly aligned to ${gradeStr} ${subjectStr} CAPS developmental content. Never use marks, percentages, CAPS rating codes, or moderation terminology anywhere in this document.${languageInstruction}`;
  }

  return `You are a qualified South African teacher producing classroom-ready assessment tools aligned to the CAPS curriculum.

TASK: Generate a complete analytical rubric for assessing: ${topic}

DETAILS:
- Grade: ${gradeStr}
- Subject: ${subjectStr}
- Topic/Task: ${topic}
- Total Marks: ${totalMarks}

RUBRIC REQUIREMENTS:
- Align to CAPS ${gradeStr} ${subjectStr} assessment standards
- Use 4 performance levels: Outstanding (4), Meritorious (3), Adequate (2), Not Yet Adequate (1)
- Map levels to the 7-level CAPS rating scale where needed
- Include 3–6 criteria appropriate for the task and CAPS content
- Each criterion must have a clear description for all 4 levels
- Marks per criterion must add up to exactly ${totalMarks}
- Use South African school context throughout

OUTPUT FORMAT:

═══════════════════════════════
*ANALYTICAL RUBRIC*
*${topic}*
*${subjectStr} | ${gradeStr} | Total: ${totalMarks} marks*
═══════════════════════════════

*Learner Name:* ___________________________
*Class:* ________________ *Date:* ___________

---

*ASSESSMENT CRITERIA*

For each criterion, use this format:

*Criterion [N]: [Criterion Name]* — [X] marks

| Level | Description | Marks |
|-------|-------------|-------|
| 4 – Outstanding | [Clear, specific description of outstanding performance] | [n] |
| 3 – Meritorious | [Clear description of meritorious performance] | [n] |
| 2 – Adequate | [Clear description of adequate performance] | [n] |
| 1 – Not Yet Adequate | [Clear description — what is missing or incorrect] | [n] |

*Score achieved: ___ / [marks for this criterion]*

---

[Repeat for all criteria]

---

*TOTAL MARKS:* ___/${totalMarks}

*CAPS RATING:*
| Mark Range | Code | Description |
|------------|------|-------------|
| ${Math.round(totalMarks*0.8)}–${totalMarks} | 7 | Outstanding Achievement |
| ${Math.round(totalMarks*0.7)}–${Math.round(totalMarks*0.79)} | 6 | Meritorious Achievement |
| ${Math.round(totalMarks*0.6)}–${Math.round(totalMarks*0.69)} | 5 | Substantial Achievement |
| ${Math.round(totalMarks*0.5)}–${Math.round(totalMarks*0.59)} | 4 | Adequate Achievement |
| ${Math.round(totalMarks*0.4)}–${Math.round(totalMarks*0.49)} | 3 | Moderate Achievement |
| ${Math.round(totalMarks*0.3)}–${Math.round(totalMarks*0.39)} | 2 | Elementary Achievement |
| 0–${Math.round(totalMarks*0.29)} | 1 | Not Achieved |

*Teacher Notes / Feedback:*
______________________________________________
______________________________________________

---

*MARKING TEACHER:* _________________________ *Date:* _________
*MODERATED BY:* _________________________ *Date:* _________

Generate ALL criteria fully. No placeholders. Every level description must be specific, observable, and directly aligned to ${gradeStr} ${subjectStr} CAPS content. Marks per criterion must total exactly ${totalMarks}.${languageInstruction}`;
}

module.exports = rubricPrompt;
