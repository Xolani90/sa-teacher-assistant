'use strict';

/**
 * Builds a CAPS-aligned report comment prompt.
 *
 * @param {{ learnerName: string, grade: string|null, subject: string, mark: number|null, outOf: number|null, behaviourNotes: string|null, language: string }} params
 * @returns {string}
 */
function reportCommentPrompt({ learnerName, grade, subject, mark, outOf, behaviourNotes, language }) {
  const gradeStr = grade || 'the appropriate grade';
  const subjectStr = subject && subject !== 'general' ? subject.charAt(0).toUpperCase() + subject.slice(1) : 'General';
  const percentage = mark && outOf ? Math.round((mark / outOf) * 100) : null;
  const performanceLevel = percentage !== null
    ? percentage >= 80 ? 'excellent'
    : percentage >= 70 ? 'very good'
    : percentage >= 60 ? 'good'
    : percentage >= 50 ? 'satisfactory'
    : percentage >= 40 ? 'adequate'
    : 'needs improvement'
    : 'satisfactory';

  const behaviourText = behaviourNotes
    ? `\n\nBehavioural notes to consider: ${behaviourNotes}`
    : '';

  const languageInstruction = language && language !== 'english'
    ? `\n\nGenerate this entire response in ${language.charAt(0).toUpperCase() + language.slice(1)}. Use natural, teacher-appropriate ${language} for South African school documents.`
    : '';

  return `You are a qualified South African teacher writing professional school report comments.

TASK: Write a professional, empathetic, CAPS-aligned report comment for a learner.

CAPS ALIGNMENT REQUIREMENTS:
- Align to ${gradeStr} ${subjectStr} CAPS curriculum standards
- Use formal, professional language appropriate for school reports
- Comment should be 3–5 sentences long
- Be constructive and empathetic while maintaining professional tone
- Reference specific performance level: ${performanceLevel}
- Include encouragement for future improvement

LEARNER DETAILS:
- Name: ${learnerName}
- Grade: ${gradeStr}
- Subject: ${subjectStr}
- Mark: ${mark !== null ? mark : 'N/A'}${outOf !== null ? ` / ${outOf}` : ''}${percentage !== null ? ` (${percentage}%)` : ''}
- Performance Level: ${performanceLevel}${behaviourText}

OUTPUT — produce a single report comment in this format:

*REPORT COMMENT*

[3–5 sentence professional comment that:
1. Acknowledges the learner's achievement/performance
2. References specific skills or concepts demonstrated
3. Provides constructive feedback on areas for growth
4. Offers encouragement for continued development
5. Maintains a supportive but professional tone]${languageInstruction}

The comment should be ready to copy directly into a report card. No placeholders or generic phrases — make it specific to the performance level and subject.`;
}

module.exports = reportCommentPrompt;
