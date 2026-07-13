'use strict';

/**
 * Builds a CAPS-aligned worksheet prompt.
 *
 * @param {{ grade: number|null, subject: string, topic: string, language: string, differentiation?: string }} intent
 * @returns {string}
 */
function worksheetPrompt({ grade, subject, topic, language, differentiation }) {
  const gradeStr = grade ? `Grade ${grade}` : 'the appropriate grade level';
  const subjectStr = subject && subject !== 'general' ? subject.charAt(0).toUpperCase() + subject.slice(1) : 'General';

  // Calculate question distribution based on grade level
  const isJuniorPhase = !grade || grade <= 3;
  const isIntermediatePhase = grade && grade >= 4 && grade <= 6;
  const isSeniorPhase = grade && grade >= 7 && grade <= 9;
  const isFETPhase = grade && grade >= 10;

  let totalMarks = 20;
  if (isJuniorPhase) totalMarks = 10;
  else if (isIntermediatePhase) totalMarks = 15;
  else if (isSeniorPhase) totalMarks = 20;
  else if (isFETPhase) totalMarks = 25;

  // CAPS cognitive level distribution varies by phase
  let cognitiveLevels;
  let sectionAMarks, sectionBMarks, sectionCMarks;
  if (isJuniorPhase) {
    cognitiveLevels = 'Knowledge/Recall (50%), Routine Application (35%), Complex Application (15%), Problem Solving (0%)';
    sectionAMarks = 3;
    sectionBMarks = 4;
    sectionCMarks = totalMarks - sectionAMarks - sectionBMarks;
  } else {
    cognitiveLevels = 'Knowledge/Recall (30%), Routine Application (35%), Complex Application (25%), Problem Solving (10%)';
    sectionAMarks = 3;
    sectionBMarks = 7;
    sectionCMarks = totalMarks - sectionAMarks - sectionBMarks;
  }

  const languageInstruction = language && language !== 'english'
    ? `\n\nGenerate this entire response in ${language.charAt(0).toUpperCase() + language.slice(1)}. Use natural, teacher-appropriate ${language} for South African school documents.`
    : '';

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
