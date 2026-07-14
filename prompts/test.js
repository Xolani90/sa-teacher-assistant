'use strict';

/**
 * Builds a CAPS-aligned test + memorandum prompt.
 *
 * @param {{ grade: number|null, subject: string, topic: string, marks: number, language: string }} intent
 * @returns {string}
 */
function testPrompt({ grade, subject, topic, marks, language }) {
  // grade is 0 for Grade R, 1-12 otherwise, null/undefined if unset.
  // NOTE: grade === 0 is not currently reachable via the intent/profile
  // pipeline (see audit report), but is handled defensively since it is a
  // valid value per this function's own documented type contract.
  const isFoundationPhase = grade === 0 || (typeof grade === 'number' && grade >= 1 && grade <= 3);
  if (isFoundationPhase) {
    return foundationPhaseLearningAssessment({ grade, subject, topic, language });
  }

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
This format is required in BOTH directions: when a question asks the learner to draw/represent a solution on a number line, AND when a question shows the learner an already-marked number line and asks them to read off the inequality it represents (e.g. "Write down the inequality shown on this number line"). In the second case you are the one choosing what point and direction to mark — pick a specific inequality yourself (e.g. x >= 2) and emit the marked spec for it, exactly as if it were the answer. Never emit a bare, unmarked NUMBERLINE (no mark/open/ray) for this question type — an unmarked line gives the learner nothing to read off and makes the question unanswerable.
[NUMBERLINE from=-3 to=5 step=1 mark=2 ray=2,right label="Given number line for 2.3"]
This format is ALSO required whenever a number line depicts specific points, values, or positions the learner needs to identify or reference — not just inequality-reading questions. This includes: named points at given values (e.g. "Point A is at -3, point B is at 2, point C is at 5"), plotted/labeled points the learner must compare or use (e.g. "P, Q, and R are shown below"), and word-problem positions on a scale (e.g. temperatures recorded, taxi stops along a route, distances traveled). In every one of these cases you must emit mark=<values> (or ray=<value>,<direction> where appropriate) for each specific point mentioned — never emit a bare from/to/step-only NUMBERLINE with just a label when the question text names or implies specific positions. A caption alone is not a substitute for the actual marks. Example:
[NUMBERLINE from=-5 to=5 step=1 mark=-3,2,5 label="Points A, B and C"]

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

/**
 * Builds a Foundation Phase (Grade R-3) learning assessment prompt.
 * CAPS has no formal written test or memorandum at this phase, so this
 * replaces the formal test with play-based, oral, and hands-on activities
 * plus an observation checklist — no marks, memorandum, or Bloom's table.
 *
 * @param {{ grade: number|null, subject: string, topic: string, language: string }} params
 * @returns {string}
 */
function foundationPhaseLearningAssessment({ grade, subject, topic, language }) {
  const gradeStr = grade === 0 ? 'Grade R' : `Grade ${grade}`;
  const subjectStr = subject && subject !== 'general'
    ? subject.charAt(0).toUpperCase() + subject.slice(1)
    : 'General';

  const languageInstruction = language && language !== 'english'
    ? `\n\nGenerate this entire response in ${language.charAt(0).toUpperCase() + language.slice(1)}. Use natural, teacher-appropriate ${language} for South African school documents.`
    : '';

  return `You are a qualified South African Foundation Phase teacher producing a CAPS-aligned learning assessment for young learners.

TASK: Generate a complete, developmentally appropriate learning assessment — NOT a formal written test. Foundation Phase learners are assessed through observation of play-based, oral, and hands-on activities, not through formal tests, memoranda, or marked papers.

CAPS ALIGNMENT REQUIREMENTS:
- Align to ${gradeStr} ${subjectStr} CAPS curriculum
- Concrete, playful, and hands-on rather than abstract or written
- Age-appropriate language and pacing for ${gradeStr} learners
- Use South African context throughout

ASSESSMENT DETAILS:
- Topic: ${topic}
- Grade: ${gradeStr}
- Subject: ${subjectStr}

${gradeStr} LEARNING ASSESSMENT: ${topic}

*TEACHER GUIDANCE:*
[Explain in 3-5 sentences what this assessment observes, how to introduce it to the class, and what to watch for while learners take part]

*MATERIALS NEEDED:*
[List simple, easily available materials — everyday objects, drawn pictures, counters, etc.]

*PLAY-BASED ACTIVITY:*
[Describe a game or play-based activity that lets learners demonstrate understanding of ${topic} through movement, manipulation of objects, or role play]

*ORAL ACTIVITY:*
[Describe an activity built around discussion, storytelling, singing, or questions and answers that lets learners demonstrate understanding of ${topic} out loud]

*HANDS-ON ACTIVITY:*
[Describe a hands-on activity — drawing, sorting, building, matching, or similar — that lets learners show what they understand about ${topic} by doing]

*OBSERVATION CHECKLIST:*
[Generate 3-5 simple, observable indicators for ${topic} that a teacher can tick off per learner, each rated: Not Yet / Developing / Achieved]

*EXTENSION ACTIVITY (OPTIONAL):*
[Describe one simple way to extend or vary the activity for learners who grasp ${topic} quickly]

Generate the ENTIRE assessment. No placeholders. Keep language simple and instructions concrete, as this will be read and used directly by the teacher.${languageInstruction}

IMPORTANT: Never output placeholder text in square brackets. Replace every bracketed instruction with actual content.`;
}

module.exports = testPrompt;
