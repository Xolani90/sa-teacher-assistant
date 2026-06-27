'use strict';

/**
 * Builds a quick quiz prompt.
 *
 * @param {{ topic: string, grade: number|null, subject: string, language: string }} intent
 * @returns {string}
 */
function quickQuizPrompt({ topic, grade, subject, language }) {
  const gradeStr = grade ? `Grade ${grade}` : 'the appropriate grade level';
  const subjectStr = subject && subject !== 'general' ? subject.charAt(0).toUpperCase() + subject.slice(1) : 'General';

  const languageInstruction = language && language !== 'english'
    ? `\n\nGenerate this entire response in ${language.charAt(0).toUpperCase() + language.slice(1)}. Use natural, teacher-appropriate ${language} for South African school documents.`
    : '';

  return `You are a qualified South African teacher creating a quick quiz for the start of a lesson.

TASK: Generate a 5-question quick quiz to check prior knowledge at the START of a lesson.

CAPS ALIGNMENT REQUIREMENTS:
- Align to ${gradeStr} ${subjectStr} CAPS curriculum
- Appropriate for the START of a lesson (recap/prior knowledge check)
- Cognitive level: Knowledge and routine procedure only (no complex problem solving)
- South African context where possible
- Keep total length under 300 words — must fit in 1-2 WhatsApp messages

QUIZ DETAILS:
- Topic: ${topic}
- Grade: ${gradeStr}
- Subject: ${subjectStr}

OUTPUT — use this EXACT format for WhatsApp:

*Quick Quiz: ${topic}*
_${subjectStr} | ${gradeStr}_

1. [Multiple choice question at knowledge level - 4 options]
   A) [option]  B) [option]  C) [option]  D) [option]

2. [Multiple choice question at knowledge level - 4 options]
   A) [option]  B) [option]  C) [option]  D) [option]

3. [Short answer question - 1-2 sentences]
   ________________________________________________

4. [Short answer question - 1-2 sentences]
   ________________________________________________

5. [Explain in your own words - 2-3 sentences]
   ________________________________________________
   ________________________________________________

---
*Answers*

1. [correct option] - [brief explanation]

2. [correct option] - [brief explanation]

3. [answer]

4. [answer]

5. [sample explanation]

Generate all questions with complete text. Do not use placeholders. All questions must be answerable based on the topic. This is a warm-up quiz, not a formal assessment.${languageInstruction}`;
}

module.exports = quickQuizPrompt;
