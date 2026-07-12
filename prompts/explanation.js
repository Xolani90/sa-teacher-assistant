'use strict';

/**
 * Builds a CAPS-aligned learner explanation prompt.
 *
 * @param {{ grade: number|null, subject: string, topic: string, language: string }} intent
 * @returns {string}
 */
function explanationPrompt({ grade, subject, topic, language }) {
  const gradeStr = grade ? `Grade ${grade}` : 'the appropriate grade level';
  const subjectStr = subject && subject !== 'general' ? subject.charAt(0).toUpperCase() + subject.slice(1) : 'General';

  // Determine reading level guidance
  const isJunior = !grade || grade <= 3;
  const isIntermediate = grade && grade >= 4 && grade <= 6;
  const isSenior = grade && grade >= 7 && grade <= 9;
  const isFET = grade && grade >= 10;

  let languageGuidance;
  if (isJunior) {
    languageGuidance = 'Use very simple words. Short sentences. No terminology without immediate explanation. Like talking to an 8-year-old.';
  } else if (isIntermediate) {
    languageGuidance = 'Use simple, everyday language. Introduce subject-specific terms with clear explanations. Sentences should be easy to follow for a 10–12 year old.';
  } else if (isSenior) {
    languageGuidance = 'Use clear, accessible language. Introduce and define CAPS terminology. Suitable for a 13–15 year old South African learner.';
  } else {
    languageGuidance = 'Use academic language appropriate for Grade 10–12. Include proper subject terminology. Explain concepts at FET level depth.';
  }

  const languageInstruction = language && language !== 'english'
    ? `\n\nGenerate this entire response in ${language.charAt(0).toUpperCase() + language.slice(1)}. Use natural, teacher-appropriate ${language} for South African schools.`
    : '';

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
