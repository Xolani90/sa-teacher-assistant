'use strict';

/**
 * Builds a parent message prompt.
 *
 * @param {{ situation: string, learnerName: string, grade: number|null, subject: string, language: string, teacherName: string, school: string }} intent
 * @returns {string}
 */
function parentMessagePrompt({ situation, learnerName, grade, subject, language, teacherName, school }) {
  const gradeStr = grade ? `Grade ${grade}` : 'the appropriate grade level';
  const subjectStr = subject && subject !== 'general' ? subject.charAt(0).toUpperCase() + subject.slice(1) : 'General';

  const languageInstruction = language && language !== 'english'
    ? `\n\nGenerate this entire response in ${language.charAt(0).toUpperCase() + language.slice(1)}. Use natural, warm ${language} appropriate for South African parent communication.`
    : '';

  return `You are a qualified South African teacher writing a WhatsApp message to a parent.

TASK: Write a professional but warm WhatsApp message from a teacher to a parent.

CONTEXT REQUIREMENTS:
- South African context — respectful, direct, solution-focused
- Professional tone but warm and approachable
- Keep it under 200 words — must fit in a WhatsApp message
- End with teacher's name and school

MESSAGE DETAILS:
- Learner Name: ${learnerName}
- Grade: ${gradeStr}
- Subject: ${subjectStr}
- Situation: ${situation}
- Teacher Name: ${teacherName || 'The teacher'}
- School: ${school || 'the school'}

SITUATION GUIDANCE:
- absence: Mention the learner has been absent, express concern, ask for reason, offer support
- failing: Express concern about marks, offer help, suggest meeting, focus on solutions
- behaviour: Describe the behaviour calmly, explain impact on learning, request parent support
- meeting: Request a meeting, state purpose, suggest times, emphasize partnership
- outstanding_work: Mention missing work, explain impact, offer extension or support
- improvement: Celebrate progress, acknowledge effort, encourage continued success
- general: General communication, be clear and direct

OUTPUT — use this EXACT format for WhatsApp:

*Parent Message*

Dear [Parent/Guardian],

[1-2 sentences greeting and stating the situation clearly]

[1-2 sentences explaining the impact on the learner and what support is needed]

[1 sentence offering teacher availability and next steps]

Best regards,
${teacherName || 'The teacher'}
${school || 'the school'}

Write in a way that builds partnership between home and school. Focus on solutions and the learner's success.${languageInstruction}`;
}

module.exports = parentMessagePrompt;
