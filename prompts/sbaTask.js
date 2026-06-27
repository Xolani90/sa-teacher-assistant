'use strict';

/**
 * Builds a CAPS-aligned School-Based Assessment (SBA) task prompt.
 * SBA tasks include projects, investigations, practical tasks, oral tasks,
 * assignments, and tests that form part of the formal programme of assessment.
 *
 * @param {{ grade: number|null, subject: string, topic: string, marks: number, language: string }} intent
 * @returns {string}
 */
function sbaTaskPrompt({ grade, subject, topic, marks, language }) {
  const gradeStr = grade ? `Grade ${grade}` : 'Grade 8';
  const subjectStr = subject && subject !== 'general'
    ? subject.charAt(0).toUpperCase() + subject.slice(1)
    : 'General';
  const totalMarks = marks || 30;

  // SBA tasks are typically 20–50 marks and may span multiple lessons
  const daysToComplete = totalMarks <= 20 ? 1 : totalMarks <= 40 ? 3 : 7;

  const languageInstruction = language && language !== 'english'
    ? `\n\nGenerate this entire SBA task in ${language.charAt(0).toUpperCase() + language.slice(1)}.`
    : '';

  return `You are a qualified South African teacher producing formal SBA (School-Based Assessment) tasks aligned to the CAPS curriculum and DBE assessment policy.

TASK: Generate a complete SBA task document including instructions, marking guidelines, and rubric.

DETAILS:
- Grade: ${gradeStr}
- Subject: ${subjectStr}
- Topic/Focus: ${topic}
- Total Marks: ${totalMarks}
- Estimated Time: ${daysToComplete === 1 ? '1 lesson (1 hour)' : `${daysToComplete} days`}

SBA REQUIREMENTS:
- Formally aligned to CAPS ${gradeStr} ${subjectStr} programme of assessment
- Clearly states cognitive levels (Knowledge, Application, Analysis, Evaluation)
- Includes instructions appropriate for ${gradeStr} learners
- Has a complete analytical rubric or detailed marking guideline
- References South African context where appropriate
- Meets DBE SBA formatting standards

═══════════════════════════════
*SCHOOL-BASED ASSESSMENT TASK*
*${subjectStr} | ${gradeStr}*
═══════════════════════════════

*School:* ______________________________________
*Teacher:* ___________________________________
*Learner Name:* ______________________________
*Class:* _______________ *Date Issued:* __________
*Date Due:* ___________________________________

*TOPIC:* ${topic}
*TOTAL MARKS:* ${totalMarks}
*TIME ALLOWED:* ${daysToComplete === 1 ? '1 lesson' : `${daysToComplete} days`}

*CAPS REFERENCE:*
[Generate the specific CAPS topic/section reference for ${gradeStr} ${subjectStr} and the topic: ${topic}]

*LEARNING OUTCOMES ASSESSED:*
[List 2–4 specific CAPS learning outcomes this task assesses, aligned to ${gradeStr} ${subjectStr}]

---

*SECTION A: CONTEXT AND INSTRUCTIONS*

[Provide a clear context/scenario for the task that is relevant to South African learners and aligned to ${topic}. The context must make the purpose of the task clear.]

*INSTRUCTIONS TO LEARNERS:*
1. Read all instructions carefully before beginning.
2. [Generate 4–8 clear, numbered instructions specific to this task type and ${topic}]
3. Show all working / reasoning where applicable.
4. Submit by the due date. Late submissions will be penalised as per school policy.

*RESOURCES NEEDED:*
[List required resources: textbook, calculator, equipment, materials, etc.]

---

*SECTION B: TASK ACTIVITIES*

[Generate the full task with clear activity sections. Each activity must:
- State the marks in brackets
- Target a specific cognitive level
- Be directly aligned to CAPS ${gradeStr} ${subjectStr} content on ${topic}
- Include enough detail for learners to complete it independently
Minimum 3 activities; marks must total ${totalMarks}]

*Activity 1* — Knowledge & Understanding (_____ marks)
[Generate activity]

*Activity 2* — Application & Analysis (_____ marks)
[Generate activity]

*Activity 3* — Synthesis & Evaluation (_____ marks)
[Generate activity]

---

*MARKING GUIDELINE / RUBRIC*

[For structured tasks: generate a full memorandum with mark allocations per activity and sub-activity.
For open-ended tasks: generate an analytical rubric with 3–5 criteria, 4 performance levels, and mark descriptors.
All marks must total exactly ${totalMarks}.]

---

*COGNITIVE LEVEL DISTRIBUTION:*
| Level | Marks | % |
|-------|-------|---|
| Knowledge/Recall | | |
| Application | | |
| Analysis | | |
| Evaluation | | |
| *TOTAL* | *${totalMarks}* | *100%* |

---

*ATP ALIGNMENT:*
[State which term and week in the ATP this task should be administered, based on CAPS ${gradeStr} ${subjectStr}]

Generate the ENTIRE document. No placeholders. All activities must be fully written, all marks must total exactly ${totalMarks}. Rubric/memorandum must be complete and teacher-ready.${languageInstruction}`;
}

module.exports = sbaTaskPrompt;
