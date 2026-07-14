'use strict';

const { gradeLabel } = require('../utils/capsPhase');

/**
 * Builds a CAPS-aligned School-Based Assessment (SBA) task prompt.
 * SBA tasks include projects, investigations, practical tasks, oral tasks,
 * assignments, and tests that form part of the formal programme of assessment.
 *
 * CAPS has no formal SBA/Programme-of-Assessment instrument at Foundation
 * Phase (Grade R-3). For those grades this builds a developmentally
 * appropriate learning-activity prompt instead (see foundationPhaseLearningActivity).
 *
 * @param {{ grade: number|null, subject: string, topic: string, marks: number, language: string }} intent
 * @returns {string}
 */
function sbaTaskPrompt({ grade, subject, topic, marks, language }) {
  // grade is 0 for Grade R, 1-12 otherwise, null/undefined if unset.
  // NOTE: grade === 0 is not currently reachable via the intent/profile
  // pipeline (see audit report), but is handled defensively since it is a
  // valid value per this function's own documented type contract.
  const isFoundationPhase = grade === 0 || (typeof grade === 'number' && grade >= 1 && grade <= 3);
  if (isFoundationPhase) {
    return foundationPhaseLearningActivity({ grade, subject, topic, language });
  }

  const gradeStr = grade != null ? gradeLabel(grade) : 'Grade 8';
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

NUMBER LINES: If any activity needs a number line (integers, inequalities, rounding, ordering, etc.), do NOT draw one with dashes/pipes/spaced characters — that never renders aligned. Instead output a single line using this exact bracket syntax, which is rendered as a real number-line graphic:
[NUMBERLINE from=<start> to=<end> step=<interval> mark=<comma-separated values, solid dots> open=<comma-separated values, open circles> ray=<value>,<left|right> label="<optional caption>"]
from, to, and step are required; mark, open, ray, and label are optional — include only the ones the activity needs. Never write the number line as plain numbers separated by spaces either (e.g. "-2 -1 0 1 2 3 4 5") — that has no line, ticks, or marked point and is exactly the mistake this format exists to prevent. The line must contain nothing but the bracket syntax. Examples:
[NUMBERLINE from=-10 to=10 step=1 mark=-3,4]
[NUMBERLINE from=0 to=10 step=1 open=3 ray=3,right label="x > 3"]
[NUMBERLINE from=-2 to=8 step=1 open=4 ray=4,left label="x < 4"]
This format is required in BOTH directions: when a question asks the learner to draw/represent a solution on a number line, AND when a question shows the learner an already-marked number line and asks them to read off the inequality it represents (e.g. "Write down the inequality shown on this number line"). In the second case you are the one choosing what point and direction to mark — pick a specific inequality yourself (e.g. x >= 2) and emit the marked spec for it, exactly as if it were the answer. Never emit a bare, unmarked NUMBERLINE (no mark/open/ray) for this question type — an unmarked line gives the learner nothing to read off and makes the question unanswerable.
[NUMBERLINE from=-3 to=5 step=1 mark=2 ray=2,right label="Given number line for 2.3"]
This format is ALSO required whenever a number line depicts specific points, values, or positions the learner needs to identify or reference — not just inequality-reading questions. This includes: named points at given values (e.g. "Point A is at -3, point B is at 2, point C is at 5"), plotted/labeled points the learner must compare or use (e.g. "P, Q, and R are shown below"), and word-problem positions on a scale (e.g. temperatures recorded, taxi stops along a route, distances traveled). In every one of these cases you must emit mark=<values> (or ray=<value>,<direction> where appropriate) for each specific point mentioned — never emit a bare from/to/step-only NUMBERLINE with just a label when the question text names or implies specific positions. A caption alone is not a substitute for the actual marks. Example:
[NUMBERLINE from=-5 to=5 step=1 mark=-3,2,5 label="Points A, B and C"]

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

/**
 * Builds a Foundation Phase (Grade R-3) learning-activity prompt.
 * CAPS has no formal SBA task at this phase, so this replaces the formal
 * SBA structure with play-based, oral, and hands-on activities plus an
 * observation checklist — no marks, memorandum, or cognitive-level language.
 *
 * @param {{ grade: number|null, subject: string, topic: string, language: string }} params
 * @returns {string}
 */
function foundationPhaseLearningActivity({ grade, subject, topic, language }) {
  const gradeStr = grade === 0 ? 'Grade R' : `Grade ${grade}`;
  const subjectStr = subject && subject !== 'general'
    ? subject.charAt(0).toUpperCase() + subject.slice(1)
    : 'General';

  const languageInstruction = language && language !== 'english'
    ? `\n\nGenerate this entire learning activity in ${language.charAt(0).toUpperCase() + language.slice(1)}.`
    : '';

  return `You are a qualified South African Foundation Phase teacher producing a CAPS-aligned learning activity for young learners.

TASK: Generate a complete, developmentally appropriate learning activity — NOT a formal written assessment. Foundation Phase learners are assessed through observation of play-based, oral, and hands-on activities, not through formal SBA tasks, memoranda, or marked papers.

DETAILS:
- Grade: ${gradeStr}
- Subject: ${subjectStr}
- Topic/Focus: ${topic}

REQUIREMENTS:
- Age-appropriate for ${gradeStr} learners, aligned to CAPS ${gradeStr} ${subjectStr}
- Concrete, playful, and hands-on rather than abstract or written
- References South African context where appropriate
- No marks, no memorandum, no cognitive-level percentages, no formal examination or SBA wording

${gradeStr} LEARNING ACTIVITY: ${topic}

*TEACHER GUIDANCE:*
[Explain in 3-5 sentences what this activity teaches, how to introduce it to the class, and what to watch for while learners take part]

*MATERIALS NEEDED:*
[List simple, easily available materials — everyday objects, drawn pictures, counters, etc.]

*PLAY-BASED ACTIVITY:*
[Describe a game or play-based activity that lets learners explore ${topic} through movement, manipulation of objects, or role play]

*ORAL ACTIVITY:*
[Describe a activity built around discussion, storytelling, singing, or questions and answers that lets learners demonstrate understanding of ${topic} out loud]

*HANDS-ON ACTIVITY:*
[Describe a hands-on activity — drawing, sorting, building, matching, or similar — that lets learners show what they understand about ${topic} by doing]

*OBSERVATION CHECKLIST:*
[Generate 3-5 simple, observable indicators for ${topic} that a teacher can tick off per learner, each rated: Not Yet / Developing / Achieved]

*EXTENSION ACTIVITY (OPTIONAL):*
[Describe one simple way to extend or vary the activity for learners who grasp ${topic} quickly]

Generate the ENTIRE activity. No placeholders. Keep language simple and instructions concrete, as this will be read and used directly by the teacher.${languageInstruction}`;
}

module.exports = sbaTaskPrompt;
