'use strict';

/**
 * Builds a formal CAPS-aligned exam paper prompt.
 * More structured than a test — includes cover page, multiple sections,
 * formal instructions, and a complete memorandum.
 *
 * @param {{ grade: number|null, subject: string, topic: string, marks: number, language: string }} intent
 * @returns {string}
 */
function examPaperPrompt({ grade, subject, topic, marks, language }) {
  const gradeStr = grade ? `Grade ${grade}` : 'Grade 8';
  const subjectStr = subject && subject !== 'general'
    ? subject.charAt(0).toUpperCase() + subject.slice(1)
    : 'General';
  const totalMarks = marks || 100;

  // Time allocation: 1 minute per mark, min 1h, max 3h
  const durationMinutes = Math.max(60, Math.min(180, totalMarks));
  const hours = Math.floor(durationMinutes / 60);
  const mins = durationMinutes % 60;
  const durationStr = mins > 0 ? `${hours} hour${hours > 1 ? 's' : ''} ${mins} minutes` : `${hours} hour${hours > 1 ? 's' : ''}`;

  // CAPS cognitive level distribution for exams
  const knowledgeMarks  = Math.round(totalMarks * 0.20); // 20%
  const routineMarks    = Math.round(totalMarks * 0.35); // 35%
  const complexMarks    = Math.round(totalMarks * 0.30); // 30%
  const problemMarks    = totalMarks - knowledgeMarks - routineMarks - complexMarks; // ~15%

  const languageInstruction = language && language !== 'english'
    ? `\n\nGenerate this entire exam paper in ${language.charAt(0).toUpperCase() + language.slice(1)}.`
    : '';

  return `You are a qualified South African teacher producing a formal examination paper aligned to the CAPS curriculum and DBE examination standards.

TASK: Generate a complete formal examination paper AND full memorandum.

DETAILS:
- Grade: ${gradeStr}
- Subject: ${subjectStr}
- Focus Area / Scope: ${topic}
- Total Marks: ${totalMarks}
- Duration: ${durationStr}

EXAM REQUIREMENTS:
- Formal DBE examination format with cover page and section structure
- MANDATORY CAPS cognitive level distribution:
  • Knowledge/Recall: ${knowledgeMarks} marks (20%)
  • Routine Application: ${routineMarks} marks (35%)
  • Complex Application: ${complexMarks} marks (30%)
  • Problem Solving: ${problemMarks} marks (15%)
- Sections should group questions by type (multiple choice, short answer, extended response)
- Instructions must be clear and formal (DBE standard)
- Mark allocations shown for each question and sub-question
- Complete memorandum with full worked solutions
- South African context throughout

NUMBER LINES: If any question needs a number line (integers, inequalities, rounding, ordering, etc.), do NOT draw one with dashes/pipes/spaced characters — that never renders aligned. Instead output a single line using this exact bracket syntax, which is rendered as a real number-line graphic:
[NUMBERLINE from=<start> to=<end> step=<interval> mark=<comma-separated values, solid dots> open=<comma-separated values, open circles> ray=<value>,<left|right> label="<optional caption>"]
from, to, and step are required; mark, open, ray, and label are optional — include only the ones the question needs. Never write the number line as plain numbers separated by spaces either (e.g. "-2 -1 0 1 2 3 4 5") — that has no line, ticks, or marked point and is exactly the mistake this format exists to prevent. The line must contain nothing but the bracket syntax. Examples:
[NUMBERLINE from=-10 to=10 step=1 mark=-3,4]
[NUMBERLINE from=0 to=10 step=1 open=3 ray=3,right label="x > 3"]
[NUMBERLINE from=-2 to=8 step=1 open=4 ray=4,left label="x < 4"]

═══════════════════════════════════════════════
${subjectStr.toUpperCase()}
${gradeStr.toUpperCase()} — FORMAL EXAMINATION
═══════════════════════════════════════════════

*MARKS: ${totalMarks}*     *TIME: ${durationStr}*

---

*INSTRUCTIONS AND INFORMATION TO LEARNERS*

READ THESE INSTRUCTIONS CAREFULLY.
1. This question paper consists of [N] questions. Answer ALL questions.
2. Clearly show ALL calculations, diagrams, graphs, etc., that you have used in determining your answers.
3. Answers only will NOT necessarily be awarded full marks.
4. You may use an approved scientific calculator (non-programmable and non-graphical), unless stated otherwise.
5. If necessary, round off answers to TWO decimal places, unless stated otherwise.
6. Number the answers correctly according to the numbering system used in this question paper.
7. Write neatly and legibly.

*LEARNER NAME:* ________________________________
*ADMISSION NUMBER:* __________ *CLASS:* _________
*DATE:* _____________ *TEACHER:* _________________

---

*SECTION A — MULTIPLE CHOICE / OBJECTIVE QUESTIONS* (${Math.round(totalMarks * 0.20)} marks)
*(Knowledge/Recall level)*

[Generate 10–20 multiple choice or true/false/match questions covering key facts and recall content from ${topic}. Each worth equal marks. Clear options A/B/C/D. Marks in brackets.]

---

*SECTION B — SHORT QUESTIONS* (${Math.round(totalMarks * 0.40)} marks)
*(Routine Application and Complex Application)*

[Generate 3–4 structured questions with multiple sub-parts. Each question covers a different aspect of ${topic}. Questions progress from routine to complex within each question. Mark allocations in brackets for every sub-question.]

---

*SECTION C — EXTENDED RESPONSE* (${Math.round(totalMarks * 0.25)} marks)
*(Complex Application and Problem Solving)*

[Generate 2 extended questions requiring multi-step reasoning and integration of knowledge. Include at least one word problem in South African context. Clear mark allocations.]

---

*SECTION D — PROBLEM SOLVING / OPEN-ENDED* (${problemMarks} marks)
*(Problem Solving — highest cognitive level)*

[Generate 1–2 challenging questions requiring synthesis, critical thinking, or real-world application. South African context essential. Full mark allocation shown.]

---

*COGNITIVE LEVEL DISTRIBUTION (EXAM GRID):*
| Section | Type | Marks | Cognitive Level | % |
|---------|------|-------|-----------------|---|
| A | Objective | ${knowledgeMarks} | Knowledge/Recall | 20% |
| B | Short Answer | ${routineMarks} | Routine Application | 35% |
| C | Extended | ${complexMarks} | Complex Application | 30% |
| D | Problem Solving | ${problemMarks} | Problem Solving | 15% |
| **TOTAL** | | **${totalMarks}** | | **100%** |

---

*TOPIC COVERAGE TABLE:*
[Generate a table showing which questions cover which CAPS topics from ${topic} for ${gradeStr} ${subjectStr}]

---

═══════════════════════════════════════════════
*MEMORANDUM — ${subjectStr.toUpperCase()} ${gradeStr.toUpperCase()} EXAMINATION*
*Total: ${totalMarks} marks*
═══════════════════════════════════════════════

*MARKING GUIDELINES:*
• Award marks as indicated in brackets [ ]
• Accept any mathematically/scientifically equivalent correct answer
• Where method marks apply: award method mark (M) even if final answer is wrong, provided method is correct
• ✓ = 1 mark; ✓✓ = 2 marks, etc., unless stated otherwise
• CA = Carried Answer (award mark for correct use of previous incorrect answer)

*SECTION A — ANSWERS:*
[Complete answers with explanations for all multiple choice/objective questions]

*SECTION B — FULL WORKED SOLUTIONS:*
[Complete worked solutions with every step, method marks shown, and mark ticks for each mark-earning step]

*SECTION C — FULL WORKED SOLUTIONS:*
[Complete worked solutions showing all reasoning]

*SECTION D — FULL WORKED SOLUTIONS:*
[Complete solutions with South African context explained]

*MARK ALLOCATION SUMMARY:*
| Section | Marks | Subtotal |
|---------|-------|----------|
| A | ${knowledgeMarks} | ___/${knowledgeMarks} |
| B | ${routineMarks} | ___/${routineMarks} |
| C | ${complexMarks} | ___/${complexMarks} |
| D | ${problemMarks} | ___/${problemMarks} |
| **TOTAL** | **${totalMarks}** | ___/${totalMarks} |

Generate ALL questions and ALL memorandum answers completely. No placeholders whatsoever. Every question must be fully written and answerable. Total marks must be EXACTLY ${totalMarks}. This is a formal examination — quality, accuracy, and CAPS alignment are non-negotiable.${languageInstruction}`;
}

module.exports = examPaperPrompt;
