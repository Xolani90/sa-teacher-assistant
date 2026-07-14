'use strict';

const { getPhase, gradeLabel, PHASES } = require('../utils/capsPhase');

/**
 * Foundation Phase (Grade R-3) worksheets must not be a shortened written
 * exam. CAPS Foundation Phase practice for independent/guided seatwork is
 * picture-based, tactile, and low-reading-load: matching, tracing, colouring,
 * sorting, and simple drawing/counting tasks, with an oral component the
 * teacher reads aloud or leads. There is no Section A/B/C, no marking grid
 * in the Senior-Phase sense, and mark allocation is replaced with a simple
 * completion/observation check.
 */
function foundationPhaseWorksheet({ gradeStr, subjectStr, topic, languageInstruction }) {
  return `You are a qualified South African Foundation Phase teacher producing classroom-ready material strictly aligned to CAPS Foundation Phase methodology.

TASK: Generate a complete, print-ready Foundation Phase worksheet.

CAPS FOUNDATION PHASE WORKSHEET REQUIREMENTS:
- Align to ${gradeStr} ${subjectStr} CAPS curriculum
- This is NOT a written exam — it is picture-based, low-reading, hands-on seatwork a young learner completes with a pencil/crayon, mostly independent of reading ability
- Use activity types such as: matching (draw a line), colouring, tracing (letters/numbers/shapes/patterns), circling the correct picture, sorting/grouping pictures, simple counting with pictures, drawing, and completing a pattern
- Include at least one oral component the teacher reads aloud or leads verbally before or during the worksheet (the learner should never need to silently read multi-word instructions alone)
- Instructions for each activity must be a single short, simple sentence a teacher would say aloud, e.g. "Draw a line to match each animal to its home" or "Colour the shapes that are triangles"
- Do NOT use multiple-choice letter options (A/B/C/D), formal question numbering styled like a test, mark allocations in brackets like (2), or a marking grid
- Do NOT include a "Working" / "Answer: ___" written-response format
- Use real South African context — local animals, foods, places, everyday objects young children recognise
- Describe visual/picture elements in words in square brackets (e.g. [3 simple pictures: a dog, a ball, a tree]) since this becomes a printed worksheet — be specific enough that whoever lays out the page knows exactly what to draw or place

WORKSHEET DETAILS:
- Topic: ${topic}
- Grade: ${gradeStr}
- Subject: ${subjectStr}

OUTPUT — produce a complete worksheet in this EXACT format for WhatsApp:

*WORKSHEET: ${topic.charAt(0).toUpperCase() + topic.slice(1)}*
*${subjectStr} | ${gradeStr}*

[School Logo]                    [SA Teacher Assistant Logo]

Name: ________________________________
Class: ________________ Date: __________

---

*BEFORE YOU START (teacher reads aloud)*
[One short sentence the teacher says to introduce the topic/activity — simple, warm, spoken language]

---

*ACTIVITY 1*
[Short spoken instruction, e.g. "Draw a line to match..."]
[Describe the picture/tracing/matching/colouring content in square brackets, specific enough to lay out on the page]

---

*ACTIVITY 2*
[Short spoken instruction for a second activity type — vary from Activity 1, e.g. tracing if Activity 1 was matching]
[Describe the picture/tracing/matching/colouring content in square brackets]

---

*ACTIVITY 3*
[Short spoken instruction for a third, different activity type]
[Describe the picture/tracing/matching/colouring content in square brackets]

---

*TEACHER CHECK (not for the learner)*
[2-3 simple things the teacher looks for while learners work — observable signs of understanding, not a mark count]

Generate all activities with complete, specific content — no placeholder text left for the teacher to fill in themselves. Keep every spoken instruction to one short sentence.${languageInstruction}`;
}

/**
 * Builds a CAPS-aligned worksheet prompt.
 *
 * @param {{ grade: number|null, subject: string, topic: string, language: string, differentiation?: string }} intent
 * @returns {string}
 */
function worksheetPrompt({ grade, subject, topic, language, differentiation }) {
  const gradeStr = grade != null ? gradeLabel(grade) : 'the appropriate grade level';
  const subjectStr = subject && subject !== 'general' ? subject.charAt(0).toUpperCase() + subject.slice(1) : 'General';

  const languageInstruction = language && language !== 'english'
    ? `\n\nGenerate this entire response in ${language.charAt(0).toUpperCase() + language.slice(1)}. Use natural, teacher-appropriate ${language} for South African school documents.`
    : '';

  const phase = getPhase(grade);
  if (phase === PHASES.FOUNDATION) {
    return foundationPhaseWorksheet({ gradeStr, subjectStr, topic, languageInstruction });
  }

  // Calculate question distribution based on grade level (Intermediate/Senior/FET only —
  // Foundation Phase is handled above and never reaches this branch).
  const isIntermediatePhase = phase === PHASES.INTERMEDIATE;
  const isSeniorPhase = phase === PHASES.SENIOR;
  const isFETPhase = phase === PHASES.FET;

  let totalMarks = 20;
  if (isIntermediatePhase) totalMarks = 15;
  else if (isSeniorPhase) totalMarks = 20;
  else if (isFETPhase) totalMarks = 25;

  // CAPS cognitive level distribution varies by phase
  const cognitiveLevels = 'Knowledge/Recall (30%), Routine Application (35%), Complex Application (25%), Problem Solving (10%)';
  const sectionAMarks = 3;
  const sectionBMarks = 7;
  const sectionCMarks = totalMarks - sectionAMarks - sectionBMarks;

  // Differentiation instructions
  let differentiationInstruction = '';
  if (differentiation === 'easier') {
    differentiationInstruction = '\n\nDIFFERENTIATION: Generate a SUPPORT version: simpler language, more examples, step-by-step scaffolding, reduce cognitive demand by one level, add a word bank where appropriate.';
  } else if (differentiation === 'harder') {
    differentiationInstruction = '\n\nDIFFERENTIATION: Generate an EXTENSION version: higher cognitive demand, multi-step problems, real-world application, challenge questions that require analysis and synthesis.';
  } else if (differentiation === 'visual') {
    differentiationInstruction = '\n\nDIFFERENTIATION: Generate a VISUAL version: replace text-heavy questions with diagram-based questions, include labelling activities, matching exercises with visual elements, and graph/table interpretation questions.';
  } else if (differentiation === 'oral') {
    differentiationInstruction = '\n\nDIFFERENTIATION: Generate an ORAL ASSESSMENT version: convert all questions to spoken-word format, include discussion prompts, think-pair-share activities, and questions that assess verbal reasoning. Format as a teacher script.';
  }

  // CRITICAL: applies to every differentiation type, not just 'easier' — a
  // teacher requesting a differentiated version wants ONE ready-to-print
  // document, not the original plus the differentiated version stapled
  // together, and never wants the AI's own commentary about the document
  // appearing inside the document itself (e.g. "Both worksheets are now
  // ready to print... Let me know if you'd like any adjustments!" — this
  // is a real production example of the failure this guards against).
  // ORAL's own format (teacher script) legitimately continues past the marking
  // grid into differentiation notes / accessibility notes — that's real
  // document content, not AI commentary, so the "ends with the marking grid"
  // anchor is loosened for oral only. EASIER/HARDER/VISUAL keep the stricter
  // marking-grid boundary, which matched their actual output in testing.
  const guardEndAnchor = differentiation === 'oral'
    ? 'ending with the final teacher note, accessibility note, or differentiation note included in the script (if the format includes one), or the marking grid if it does not'
    : 'ending with the marking grid';
  const singleVersionGuard = differentiation
    ? '\n\nCRITICAL OUTPUT RULE: Produce EXACTLY ONE worksheet — the differentiated version described above — and nothing else. ' +
      'Do NOT include the original/standard-difficulty version before or after it. Do NOT generate both versions. ' +
      `Do NOT add any conversational text, summary, sign-off, or note addressed to the teacher (e.g. "Let me know if you would like any adjustments") anywhere in the output — the ENTIRE response must be the worksheet content itself, starting with the title line and ${guardEndAnchor}, with nothing before or after it.`
    : '';

  return `You are a qualified South African teacher producing classroom-ready material strictly aligned to the CAPS curriculum.

TASK: Generate a complete, print-ready worksheet.

CAPS ALIGNMENT REQUIREMENTS:
- Align to ${gradeStr} ${subjectStr} CAPS curriculum
- Use CAPS cognitive levels: ${cognitiveLevels}
- Language and difficulty must be appropriate for ${gradeStr}
- Mark allocations must be clearly shown per question
- Total marks: ${totalMarks}
- Include real South African context where possible (SA place names, rand currency, local examples)
- Any prices, quantities, or measurements used in word problems must be realistic for South Africa (e.g. paint is priced per tin/litre in the R80-R350 per litre range depending on type, not arbitrary round numbers) — sense-check numbers against real-world SA retail pricing before including them

WORKSHEET DETAILS:
- Topic: ${topic}
- Grade: ${gradeStr}
- Subject: ${subjectStr}
- Total Marks: ${totalMarks}

NUMBER LINES: If any question needs a number line (integers, inequalities, rounding, ordering, temperature, etc.), do NOT draw one out of dashes, pipes, or spaced-out characters — that never renders aligned. Instead output a single line using this exact bracket syntax, which is rendered as a real number-line graphic:
[NUMBERLINE from=<start> to=<end> step=<interval> mark=<comma-separated values, solid dots> open=<comma-separated values, open circles> ray=<value>,<left|right> label="<optional caption>"]
from, to, and step are required; mark, open, ray, and label are optional — include only the ones the question needs. Never write the number line as plain numbers separated by spaces either (e.g. "-2 -1 0 1 2 3 4 5") — that has no line, ticks, or marked point and is exactly the mistake this format exists to prevent. The line must contain nothing but the bracket syntax. Examples:
[NUMBERLINE from=-10 to=10 step=1 mark=-3,4]
[NUMBERLINE from=0 to=10 step=1 open=3 ray=3,right label="x > 3"]
[NUMBERLINE from=-2 to=8 step=1 open=4 ray=4,left label="x < 4"]
This format is required in BOTH directions: when a question asks the learner to draw/represent a solution on a number line, AND when a question shows the learner an already-marked number line and asks them to read off the inequality it represents (e.g. "Write down the inequality shown on this number line"). In the second case you are the one choosing what point and direction to mark — pick a specific inequality yourself (e.g. x >= 2) and emit the marked spec for it, exactly as if it were the answer. Never emit a bare, unmarked NUMBERLINE (no mark/open/ray) for this question type — an unmarked line gives the learner nothing to read off and makes the question unanswerable.
[NUMBERLINE from=-3 to=5 step=1 mark=2 ray=2,right label="Given number line for 2.3"]
This format is ALSO required whenever a number line depicts specific points, values, or positions the learner needs to identify or reference — not just inequality-reading questions. This includes: named points at given values (e.g. "Point A is at -3, point B is at 2, point C is at 5"), plotted/labeled points the learner must compare or use (e.g. "P, Q, and R are shown below"), and word-problem positions on a scale (e.g. temperatures recorded, taxi stops along a route, distances traveled). In every one of these cases you must emit mark=<values> (or ray=<value>,<direction> where appropriate) for each specific point mentioned — never emit a bare from/to/step-only NUMBERLINE with just a label when the question text names or implies specific positions. A caption alone is not a substitute for the actual marks. Example:
[NUMBERLINE from=-5 to=5 step=1 mark=-3,2,5 label="Points A, B and C"]

OUTPUT — produce a complete worksheet in this EXACT format for WhatsApp:

*WORKSHEET: ${topic.charAt(0).toUpperCase() + topic.slice(1)}*
*${subjectStr} | ${gradeStr} | Total: ____/${totalMarks}*

[School Logo]                    [SA Teacher Assistant Logo]

Name: ________________________________
Class: ________________ Date: __________


---

*SECTION A: Multiple Choice* (Circle the correct answer)

1. [Question at recall/knowledge level]
   A) [option]  B) [option]  C) [option]  D) [option]    (1)

2. [Question at recall/knowledge level]
   A) [option]  B) [option]  C) [option]  D) [option]    (1)

3. [Question at routine application level]
   A) [option]  B) [option]  C) [option]  D) [option]    (1)

---

*SECTION B: Short Answer*

4. [Question — routine application level]

   Answer: ________________________________    (2)

5. [Question — routine application level with show-working instruction]

   Working:



   Answer: ________________________________    (2)

6. [Question — complex application level]

   Working:



   Answer: ________________________________    (3)

---

*SECTION C: Problem Solving / Extended Response*

7. [Real-world problem applying the topic — South African context]

   Working:




   Answer: ________________________________    (${sectionCMarks})

---

*MARKING GRID (Teacher use only)*
A: ___/${sectionAMarks}  B: ___/${sectionBMarks}  C: ___/${sectionCMarks}  TOTAL: ___/${totalMarks}

Generate all questions with complete text. Do not use placeholders. All questions must be answerable based on the topic. Mark allocation must add up to exactly ${totalMarks}.${languageInstruction}${differentiationInstruction}${singleVersionGuard}

IMPORTANT: Never output placeholder text in square brackets. Replace every bracketed instruction with actual content. All questions must be fully written out.`;
}

module.exports = worksheetPrompt;
