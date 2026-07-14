'use strict';

const { getPhase, gradeLabel } = require('../utils/capsPhase');

/**
 * Builds a CAPS-aligned lesson plan prompt.
 *
 * @param {{ grade: number|null, subject: string, topic: string, language: string }} intent
 * @returns {string}
 */
function lessonPlanPrompt({ grade, subject, topic, language }) {
  const gradeStr = gradeLabel(grade);
  const subjectStr = subject && subject !== 'general' ? subject.charAt(0).toUpperCase() + subject.slice(1) : 'General';
  const phase = getPhase(grade);

  const languageInstruction = language && language !== 'english'
    ? `\n\nGenerate this entire response in ${language.charAt(0).toUpperCase() + language.slice(1)}. Use natural, teacher-appropriate ${language} for South African schools.`
    : '';

  if (phase === 'foundation') {
    return foundationPhaseLessonPlan({ gradeStr, subjectStr, topic, languageInstruction });
  }

  return intermediateAndUpLessonPlan({ gradeStr, subjectStr, topic, languageInstruction });
}

/**
 * Foundation Phase (Grade R-3) lesson plans follow a fundamentally different
 * shape from Intermediate/Senior/FET: shorter integrated time blocks built
 * around concrete/play-based activity rather than a single 60-minute
 * subject period, observation-based assessment instead of written checks,
 * and no formal homework (not CAPS practice at this phase).
 */
function foundationPhaseLessonPlan({ gradeStr, subjectStr, topic, languageInstruction }) {
  return `You are a qualified South African Foundation Phase teacher producing classroom-ready material strictly aligned to CAPS Foundation Phase methodology.

TASK: Generate a complete, structured Foundation Phase lesson plan.

CAPS FOUNDATION PHASE REQUIREMENTS:
- Follow official CAPS Foundation Phase practice for ${gradeStr} ${subjectStr}
- Learning must happen through concrete, hands-on, play-based activity — not abstract explanation
- Use short activity blocks (10-20 minutes), not one long single-format period; young learners cannot sustain one activity type for 60 minutes
- Assessment must be observation-based (what the teacher watches/listens for), not a written test or worksheet the learner completes alone
- Use simple, warm, encouraging language throughout — this may be read aloud by the teacher, not by the learner
- Include oral language, listening, and speaking components even in non-language subjects
- Reference concrete manipulatives (counters, objects, pictures, real items) rather than abstract representations
- Use South African context — local objects, foods, names, everyday items learners recognise
- Do NOT include formal homework — Foundation Phase CAPS practice does not require written homework; suggest an optional simple home activity instead if relevant

LESSON DETAILS:
- Topic: ${topic}
- Grade: ${gradeStr}
- Subject: ${subjectStr}
- Total time: 30-45 minutes, broken into short activity blocks

OUTPUT — use these EXACT headings in this EXACT order, formatted for WhatsApp:

*LESSON PLAN: ${topic} — ${gradeStr}*
Subject: ${subjectStr} | Grade: ${gradeStr}

*LEARNING OUTCOMES*
By the end of this lesson, learners will be able to:
• [2–3 simple, observable outcomes appropriate for ${gradeStr} — things a teacher can SEE or HEAR a learner do]

*CONCRETE RESOURCES NEEDED*
• [Real objects, manipulatives, pictures, or simple materials — nothing requiring independent reading]

*CIRCLE TIME / INTRODUCTION (5-10 min)*
[A song, rhyme, story, or hands-on hook that gets learners talking and moving — describe exactly what the teacher says and does]

*MAIN ACTIVITY (15-20 min)*
[Concrete, hands-on activity broken into 2-3 short steps. Describe exactly what the teacher demonstrates and what learners physically do — manipulate objects, move, draw, sort, build. Include oral questioning throughout.]

*GROUP / PAIR ACTIVITY (10 min)*
[A simple, guided small-group or pair task with clear, short instructions the teacher gives orally]

*OBSERVATION-BASED ASSESSMENT*
[What the teacher watches and listens for during the activities — a short checklist of 2-3 observable signs of understanding. No written test.]

*CLOSING / REFLECTION (5 min)*
[A simple song, question-and-answer recap, or show-and-tell to close the lesson]

*DIFFERENTIATION*
• Support: [Simplify — fewer objects, more teacher modelling, paired with a stronger peer]
• Extension: [Add complexity — more objects, a small independent challenge]

*OPTIONAL HOME ACTIVITY*
[One simple, playful activity a parent/caregiver could do at home — not written homework]

Write in warm, simple, encouraging South African English suitable for reading aloud to young children. This must be ready for a Foundation Phase teacher or substitute to use with no further editing.${languageInstruction}`;
}

function intermediateAndUpLessonPlan({ gradeStr, subjectStr, topic, languageInstruction }) {
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
