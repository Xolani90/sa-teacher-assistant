'use strict';

/**
 * Builds a CAPS-aligned lesson plan prompt.
 *
 * @param {{ grade: number|null, subject: string, topic: string, language: string }} intent
 * @returns {string}
 */
function lessonPlanPrompt({ grade, subject, topic, language }) {
  const gradeStr = grade ? `Grade ${grade}` : 'the appropriate grade level';
  const subjectStr = subject && subject !== 'general' ? subject.charAt(0).toUpperCase() + subject.slice(1) : 'General';

  const languageInstruction = language && language !== 'english'
    ? `\n\nGenerate this entire response in ${language.charAt(0).toUpperCase() + language.slice(1)}. Use natural, teacher-appropriate ${language} for South African schools.`
    : '';

  return `You are a qualified South African teacher producing classroom-ready material strictly aligned to the CAPS (Curriculum and Assessment Policy Statement) curriculum.

TASK: Generate a complete, structured lesson plan.

CAPS ALIGNMENT REQUIREMENTS:
- Follow the official CAPS curriculum for ${gradeStr} ${subjectStr}
- Use correct CAPS terminology throughout (Learning Objectives, Teaching Methods, Assessment, etc.)
- Match vocabulary and cognitive demand to ${gradeStr} level
- Reference relevant CAPS topic or unit where applicable
- Include formal assessment guidance aligned to CAPS assessment guidelines
- Use South African context, examples, and rand values where applicable

LESSON DETAILS:
- Topic: ${topic}
- Grade: ${gradeStr}
- Subject: ${subjectStr}
- Duration: 60 minutes (standard South African school lesson)

OUTPUT — use these EXACT headings in this EXACT order, formatted for WhatsApp:

*LESSON PLAN: ${topic} — ${gradeStr}*
Subject: ${subjectStr} | Grade: ${gradeStr} | Duration: 60 min

*LEARNING OBJECTIVES*
By the end of this lesson, learners will be able to:
• [3–4 specific, measurable objectives using action verbs from Bloom's Taxonomy]

*CAPS TOPIC LINK*
[State the official CAPS topic/section this lesson falls under]

*RESOURCES NEEDED*
• [List textbooks, worksheets, manipulatives, or digital tools needed]

*PRIOR KNOWLEDGE*
[1–2 sentences: what learners should already know before this lesson]

*INTRODUCTION (10 min)*
[Describe a specific hook activity or prior knowledge activation strategy]

*TEACHING STEPS (30 min)*
1. [Specific teacher action]
2. [Specific teacher action]
3. [Specific teacher action]
4. [Specific teacher action]
5. [Specific teacher action]

*LEARNER ACTIVITY (15 min)*
[Describe exactly what learners do — individual, pair, or group work, with instructions]

*ASSESSMENT (5 min)*
[Specify the assessment method: question-and-answer, exit ticket, observation checklist, etc. State what you are looking for]

*HOMEWORK*
[One practical homework task that reinforces the lesson objective]

*DIFFERENTIATION*
• Support: [How to assist struggling learners]
• Extension: [How to challenge advanced learners]

Write in clear, professional South African English. Use bullet points and numbered lists throughout. This must be ready to hand to a substitute teacher with no further editing.${languageInstruction}`;
}

module.exports = lessonPlanPrompt;
