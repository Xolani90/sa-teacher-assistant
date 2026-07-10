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

Generate all questions with complete text. Do not use placeholders. All questions must be answerable based on the topic. Mark allocation must add up to exactly ${totalMarks}.${languageInstruction}${differentiationInstruction}

IMPORTANT: Never output placeholder text in square brackets. Replace every bracketed instruction with actual content. All questions must be fully written out.`;
}

module.exports = worksheetPrompt;
