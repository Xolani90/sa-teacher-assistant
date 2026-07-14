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
  // grade is 0 for Grade R, 1-12 otherwise, null/undefined if unset.
  // NOTE: grade === 0 is not currently reachable via the intent/profile
  // pipeline (see audit report), but is handled defensively since it is a
  // valid value per this function's own documented type contract.
  const isFoundationPhase = grade === 0 || (typeof grade === 'number' && grade >= 1 && grade <= 3);
  if (isFoundationPhase) {
    return foundationPhaseAssessment({ grade, subject, topic, language });
  }

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
This format is required in BOTH directions: when a question asks the learner to draw/represent a solution on a number line, AND when a question shows the learner an already-marked number line and asks them to read off the inequality it represents (e.g. "Write down the inequality shown on this number line"). In the second case you are the one choosing what point and direction to mark — pick a specific inequality yourself (e.g. x >= 2) and emit the marked spec for it, exactly as if it were the answer. Never emit a bare, unmarked NUMBERLINE (no mark/open/ray) for this question type — an unmarked line gives the learner nothing to read off and makes the question unanswerable.
[NUMBERLINE from=-3 to=5 step=1 mark=2 ray=2,right label="Given number line for 2.3"]
This format is ALSO required whenever a number line depicts specific points, values, or positions the learner needs to identify or reference — not just inequality-reading questions. This includes: named points at given values (e.g. "Point A is at -3, point B is at 2, point C is at 5"), plotted/labeled points the learner must compare or use (e.g. "P, Q, and R are shown below"), and word-problem positions on a scale (e.g. temperatures recorded, taxi stops along a route, distances traveled). In every one of these cases you must emit mark=<values> (or ray=<value>,<direction> where appropriate) for each specific point mentioned — never emit a bare from/to/step-only NUMBERLINE with just a label when the question text names or implies specific positions. A caption alone is not a substitute for the actual marks. Example:
[NUMBERLINE from=-5 to=5 step=1 mark=-3,2,5 label="Points A, B and C"]

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

/**
 * Builds a Foundation Phase (Grade R-3) learning assessment prompt.
 * CAPS has no formal written examination or memorandum at this phase, so
 * this replaces the formal exam with play-based, oral, and hands-on
 * activities plus an observation checklist — no marks, memorandum, cover
 * page, cognitive-level grid, or exam wording.
 *
 * @param {{ grade: number|null, subject: string, topic: string, language: string }} params
 * @returns {string}
 */
function foundationPhaseAssessment({ grade, subject, topic, language }) {
  const gradeStr = grade === 0 ? 'Grade R' : `Grade ${grade}`;
  const subjectStr = subject && subject !== 'general'
    ? subject.charAt(0).toUpperCase() + subject.slice(1)
    : 'General';

  const languageInstruction = language && language !== 'english'
    ? `\n\nGenerate this entire response in ${language.charAt(0).toUpperCase() + language.slice(1)}.`
    : '';

  return `You are a qualified South African Foundation Phase teacher producing a CAPS-aligned learning assessment for young learners.

TASK: Generate a complete, developmentally appropriate learning assessment — NOT a formal written examination. Foundation Phase learners are assessed through observation of play-based, oral, and hands-on activities, not through formal exams, memoranda, or marked papers.

CAPS ALIGNMENT REQUIREMENTS:
- Align to ${gradeStr} ${subjectStr} CAPS curriculum
- Concrete, playful, and hands-on rather than abstract or written
- Age-appropriate language and pacing for ${gradeStr} learners
- Use South African context throughout

ASSESSMENT DETAILS:
- Focus Area / Scope: ${topic}
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

module.exports = examPaperPrompt;
