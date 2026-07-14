'use strict';

const { getPhase, gradeLabel, PHASES } = require('../utils/capsPhase');

/**
 * Foundation Phase (Grade R-3) explanations must not be a dense, multi-section
 * reading document — most learners at this phase cannot read one
 * independently, and "explaining a topic" in real Foundation Phase practice
 * means giving the TEACHER a short story/analogy/talking script to use
 * out loud with the class, not a learner-facing handout.
 */
function foundationPhaseExplanation({ gradeStr, subjectStr, topic, languageInstruction }) {
  return `You are an experienced South African Foundation Phase teacher preparing a short talking script for another teacher to use with young learners.

TASK: Write a simple, spoken-style explanation of the topic below, for the TEACHER to read aloud or tell to the class — not for the learner to read alone.

CAPS FOUNDATION PHASE REQUIREMENTS:
- Content must align to ${gradeStr} ${subjectStr} CAPS curriculum
- Use very short sentences and everyday words only — nothing a Grade R–3 learner wouldn't hear in normal conversation
- Build the explanation around a short story, a familiar analogy (food, animals, family, play), or a simple real-life example — never start with a dictionary-style definition
- Include a suggested simple action, gesture, song, or picture the teacher can use alongside the words to make it concrete
- Use South African context — local animals, foods, places, everyday objects young children recognise
- No technical/subject jargon at all unless it is one single simple word introduced through the story itself

EXPLANATION DETAILS:
- Topic: ${topic}
- Grade: ${gradeStr}
- Subject: ${subjectStr}

OUTPUT — use these EXACT sections, formatted for WhatsApp:

*${topic} — ${gradeStr} Explanation (for the teacher to use aloud)*
_(${subjectStr})_

---

*Say this to start:*
[1-2 simple spoken sentences that hook the learners' attention — a question, a sound, or "Have you ever seen...?"]

*Tell this little story or example:*
[A short, concrete story or everyday example a Foundation Phase learner would recognise, that naturally introduces the idea. 3-5 simple spoken sentences.]

*Show or do this:*
[One simple action, gesture, picture, object, or short song/rhyme the teacher can use alongside the story to make the idea concrete]

*Ask the class:*
[1-2 simple oral questions the teacher can ask to check understanding — things learners answer by pointing, saying a word, or showing with their hands, not writing]

*If a learner doesn't understand, try this instead:*
[One alternative, even more concrete way to show the same idea — e.g. using real objects instead of pictures]

Keep the whole script short enough to say in 2-3 minutes. Write it exactly as the teacher would say it out loud, not as a textbook paragraph.${languageInstruction}`;
}

/**
 * Builds a CAPS-aligned learner explanation prompt.
 *
 * @param {{ grade: number|null, subject: string, topic: string, language: string }} intent
 * @returns {string}
 */
function explanationPrompt({ grade, subject, topic, language }) {
  const gradeStr = grade != null ? gradeLabel(grade) : 'the appropriate grade level';
  const subjectStr = subject && subject !== 'general' ? subject.charAt(0).toUpperCase() + subject.slice(1) : 'General';

  const languageInstruction = language && language !== 'english'
    ? `\n\nGenerate this entire response in ${language.charAt(0).toUpperCase() + language.slice(1)}. Use natural, teacher-appropriate ${language} for South African schools.`
    : '';

  const phase = getPhase(grade);
  if (phase === PHASES.FOUNDATION) {
    return foundationPhaseExplanation({ gradeStr, subjectStr, topic, languageInstruction });
  }

  // Determine reading level guidance (Intermediate/Senior/FET only — Foundation
  // Phase is handled above and never reaches this branch).
  const isIntermediate = phase === PHASES.INTERMEDIATE;
  const isSenior = phase === PHASES.SENIOR;

  let languageGuidance;
  if (isIntermediate) {
    languageGuidance = 'Use simple, everyday language. Introduce subject-specific terms with clear explanations. Sentences should be easy to follow for a 10–12 year old.';
  } else if (isSenior) {
    languageGuidance = 'Use clear, accessible language. Introduce and define CAPS terminology. Suitable for a 13–15 year old South African learner.';
  } else {
    languageGuidance = 'Use academic language appropriate for Grade 10–12. Include proper subject terminology. Explain concepts at FET level depth.';
  }

  return `You are a qualified South African teacher creating a clear, simple explanation for learners.

TASK: Write a learner-friendly explanation of the topic below.

CAPS ALIGNMENT REQUIREMENTS:
- Content must align to ${gradeStr} ${subjectStr} CAPS curriculum
- ${languageGuidance}
- Use South African examples, context, and rand values where possible
- Use real-world examples relevant to South African learners (local foods, places, everyday SA life)
- Where applicable, link the explanation to the CAPS topic it belongs to

EXPLANATION DETAILS:
- Topic: ${topic}
- Grade: ${gradeStr}
- Subject: ${subjectStr}

OUTPUT — use these EXACT sections, formatted for WhatsApp:

*${topic} — ${gradeStr} Explanation*
_(${subjectStr})_

---

*What is it?*
[1–3 sentences. Define or introduce the topic in the simplest possible terms. No jargon without explanation.]

*Think of it like this:*
[A relatable analogy using something familiar to a South African learner — food, sport, transport, money, family, etc.]

*The full explanation:*
[3–6 short paragraphs explaining the concept step by step. Each paragraph covers one idea. Use simple language. Define any technical terms in brackets when first used.]

*Step-by-step breakdown:*
1. [First step or key point]
2. [Second step or key point]
3. [Third step or key point]
[Continue as needed — max 6 steps]

NUMBER LINES: If the worked example or step-by-step breakdown needs a number line (integers, inequalities, rounding, ordering, etc.), do NOT draw one with dashes/pipes/spaced characters — that never renders aligned. Instead output a single line using this exact bracket syntax, which is rendered as a real number-line graphic:
[NUMBERLINE from=<start> to=<end> step=<interval> mark=<comma-separated values, solid dots> open=<comma-separated values, open circles> ray=<value>,<left|right> label="<optional caption>"]
from, to, and step are required; mark, open, ray, and label are optional — include only the ones the example needs. Never write the number line as plain numbers separated by spaces either (e.g. "-2 -1 0 1 2 3 4 5") — that has no line, ticks, or marked point and is exactly the mistake this format exists to prevent. The line must contain nothing but the bracket syntax. Examples:
[NUMBERLINE from=-10 to=10 step=1 mark=-3,4]
[NUMBERLINE from=-2 to=8 step=1 open=4 ray=4,left label="x < 4"]
This format is required in BOTH directions: when a question asks the learner to draw/represent a solution on a number line, AND when a question shows the learner an already-marked number line and asks them to read off the inequality it represents (e.g. "Write down the inequality shown on this number line"). In the second case you are the one choosing what point and direction to mark — pick a specific inequality yourself (e.g. x >= 2) and emit the marked spec for it, exactly as if it were the answer. Never emit a bare, unmarked NUMBERLINE (no mark/open/ray) for this question type — an unmarked line gives the learner nothing to read off and makes the question unanswerable.
[NUMBERLINE from=-3 to=5 step=1 mark=2 ray=2,right label="Given number line"]
This format is ALSO required whenever a number line depicts specific points, values, or positions the learner needs to identify or reference — not just inequality-reading questions. This includes: named points at given values (e.g. "Point A is at -3, point B is at 2, point C is at 5"), plotted/labeled points the learner must compare or use (e.g. "P, Q, and R are shown below"), and word-problem positions on a scale (e.g. temperatures recorded, taxi stops along a route, distances traveled). In every one of these cases you must emit mark=<values> (or ray=<value>,<direction> where appropriate) for each specific point mentioned — never emit a bare from/to/step-only NUMBERLINE with just a label when the question text names or implies specific positions. A caption alone is not a substitute for the actual marks. Example:
[NUMBERLINE from=-5 to=5 step=1 mark=-3,2,5 label="Points A, B and C"]

*Worked example:*
[A complete, solved example using South African context where possible. Show all working for maths/science. Explain each step.]

*Common mistakes to avoid:*
• [Mistake 1 — what learners get wrong and why]
• [Mistake 2]
[Add a third if relevant]

*Key words to remember:*
• [Term]: [simple definition]
• [Term]: [simple definition]
[3–5 key vocabulary terms]

*Quick summary:*
[2–3 sentences summing up the most important points from the explanation]

Write for the learner, not the teacher. Use "you" language — "You will learn...", "When you see...". Keep it encouraging and clear.${languageInstruction}`;
}

module.exports = explanationPrompt;
