'use strict';

/**
 * Builds a CAPS-aligned analytical rubric prompt.
 *
 * @param {{ grade: number|null, subject: string, topic: string, marks: number, language: string }} intent
 * @returns {string}
 */
function rubricPrompt({ grade, subject, topic, marks, language }) {
  const gradeStr = grade ? `Grade ${grade}` : 'Grade 8';
  const subjectStr = subject && subject !== 'general'
    ? subject.charAt(0).toUpperCase() + subject.slice(1)
    : 'General';
  const totalMarks = marks || 20;

  const languageInstruction = language && language !== 'english'
    ? `\n\nGenerate this entire rubric in ${language.charAt(0).toUpperCase() + language.slice(1)}.`
    : '';

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
