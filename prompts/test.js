'use strict';

/**
 * Builds a CAPS-aligned test + memorandum prompt.
 *
 * @param {{ grade: number|null, subject: string, topic: string, marks: number, language: string }} intent
 * @returns {string}
 */
function testPrompt({ grade, subject, topic, marks, language }) {
  const gradeStr = grade ? `Grade ${grade}` : 'Grade 8';
  const subjectStr = subject && subject !== 'general' ? subject.charAt(0).toUpperCase() + subject.slice(1) : 'General';
  const totalMarks = marks || 20;

  // Time allocation: roughly 1 mark per minute
  const duration = Math.max(30, Math.min(90, totalMarks));

  // Distribute marks across cognitive levels (CAPS requirement)
  const knowledgeMarks = Math.round(totalMarks * 0.30);
  const routineMarks = Math.round(totalMarks * 0.35);
  const complexMarks = Math.round(totalMarks * 0.25);
  let problemMarks = totalMarks - knowledgeMarks - routineMarks - complexMarks;
  problemMarks = Math.max(problemMarks, 0);

  const languageInstruction = language && language !== 'english'
    ? `\n\nGenerate this entire response in ${language.charAt(0).toUpperCase() + language.slice(1)}. Use natural, teacher-appropriate ${language} for South African school documents.`
    : '';

  return `You are a qualified South African teacher producing classroom-ready material strictly aligned to the CAPS curriculum.

TASK: Generate a complete test paper AND a full memorandum.

CAPS ALIGNMENT REQUIREMENTS:
- Align to ${gradeStr} ${subjectStr} CAPS curriculum
- MANDATORY cognitive level distribution:
  • Knowledge/Recall: ${knowledgeMarks} marks (30%)
  • Routine Application: ${routineMarks} marks (35%)
  • Complex Application: ${complexMarks} marks (25%)${problemMarks > 0 ? `\n  • Problem Solving: ${problemMarks} marks (10%)` : ''}
- Total marks must be EXACTLY ${totalMarks}
- Duration: ${duration} minutes
- Language appropriate for ${gradeStr}
- Use South African context in word problems

TEST DETAILS:
- Topic: ${topic}
- Grade: ${gradeStr}
- Subject: ${subjectStr}
- Total Marks: ${totalMarks}

NUMBER LINES: If any question needs a number line (integers, inequalities, rounding, ordering, etc.), do NOT draw one with dashes/pipes/spaced characters — that never renders aligned. Instead output a single line using this exact bracket syntax, which is rendered as a real number-line graphic:
[NUMBERLINE from=<start> to=<end> step=<interval> mark=<comma-separated values, solid dots> open=<comma-separated values, open circles> ray=<value>,<left|right> label="<optional caption>"]
from, to, and step are required; mark, open, ray, and label are optional — include only the ones the question needs. Never write the number line as plain numbers separated by spaces either (e.g. "-2 -1 0 1 2 3 4 5") — that has no line, ticks, or marked point and is exactly the mistake this format exists to prevent. The line must contain nothing but the bracket syntax. Examples:
[NUMBERLINE from=-10 to=10 step=1 mark=-3,4]
[NUMBERLINE from=0 to=10 step=1 open=3 ray=3,right label="x > 3"]
[NUMBERLINE from=-2 to=8 step=1 open=4 ray=4,left label="x < 4"]

OUTPUT — produce BOTH sections in full:

═══════════════════════════════
*TEST PAPER — ${topic}*
*${subjectStr} | ${gradeStr}*
═══════════════════════════════

*Instructions:*
• Answer ALL questions
• Show ALL working where applicable
• Write neatly
• Time allowed: ${duration} minutes

*Name:* _____________________________
*Class:* ________________ *Date:* _______
*Total: ____/${totalMarks}*

---

*QUESTION 1* (Knowledge/Recall — ${knowledgeMarks} marks)

[Generate ${knowledgeMarks} marks worth of recall/knowledge questions with clear sub-questions and mark allocations in brackets]

---

*QUESTION 2* (Routine Application — ${routineMarks} marks)

[Generate ${routineMarks} marks worth of routine application questions with clear sub-questions and mark allocations]

---

*QUESTION 3* (Complex Application — ${complexMarks} marks)

[Generate ${complexMarks} marks worth of complex application questions requiring multi-step reasoning]

---
${problemMarks > 0 ? `
*QUESTION 4* (Problem Solving — ${problemMarks} marks)

[Generate ${problemMarks} marks worth of real-world problem-solving question in South African context]

---
` : ''}

═══════════════════════════════
*MEMORANDUM — ${topic}*
*${gradeStr} ${subjectStr} | Total: ${totalMarks} marks*
═══════════════════════════════

*MARKING GUIDELINES:*
• Award marks as indicated
• Accept mathematically equivalent answers
• Method marks may be awarded even if final answer is wrong
• ✓ = 1 mark unless stated otherwise

*QUESTION 1 ANSWERS:*
[Full worked answers with mark allocation breakdown for every sub-question]
[Mark each answer line clearly e.g.: "answer ✓✓ (2)" or "answer ✓ (1)"]

*QUESTION 2 ANSWERS:*
[Full worked answers with all steps shown]
[Include alternative acceptable answers where applicable]

*QUESTION 3 ANSWERS:*
[Full worked answers showing complete reasoning process]
${problemMarks > 0 ? `
*QUESTION 4 ANSWERS:*
[Full worked solution with SA context]

` : ''}
*MARK BREAKDOWN:*
Q1: ___/${knowledgeMarks} | Q2: ___/${routineMarks} | Q3: ___/${complexMarks}${problemMarks > 0 ? ` | Q4: ___/${problemMarks}` : ''}
TOTAL: ___/${totalMarks}

---

*COGNITIVE LEVEL / BLOOM'S TAXONOMY DISTRIBUTION TABLE*

| Question | Topic Covered | Bloom's Level | CAPS Level | Marks | % |
|----------|---------------|---------------|------------|-------|---|
| Q1 | [topic for Q1] | Remember / Understand | Knowledge/Recall | ${knowledgeMarks} | ${Math.round(knowledgeMarks/totalMarks*100)}% |
| Q2 | [topic for Q2] | Apply / Analyse | Routine Application | ${routineMarks} | ${Math.round(routineMarks/totalMarks*100)}% |
| Q3 | [topic for Q3] | Analyse / Evaluate | Complex Application | ${complexMarks} | ${Math.round(complexMarks/totalMarks*100)}% |${problemMarks > 0 ? `
| Q4 | [topic for Q4] | Evaluate / Create | Problem Solving | ${problemMarks} | ${Math.round(problemMarks/totalMarks*100)}% |` : ''}
| **TOTAL** | | | | **${totalMarks}** | **100%** |

*Fill in actual topics from the generated questions above. Bloom's levels map to CAPS cognitive levels as shown.*

Generate ALL questions and ALL answers completely. No placeholders. Every question must be answerable. Marks must total exactly ${totalMarks}. The Bloom's table above must have the actual topic from each generated question filled in — not placeholder text.${languageInstruction}

IMPORTANT: Never output placeholder text in square brackets. Replace every bracketed instruction with actual content. All questions must be fully written out.`;
}

module.exports = testPrompt;
