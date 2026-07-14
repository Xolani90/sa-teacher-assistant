'use strict';

const { getPhase } = require('../utils/capsPhase');

/**
 * Builds a CAPS-aligned moderation pack prompt.
 *
 * Two modes, both producing a complete, ready-to-submit moderation pack:
 *
 *  - Wrap mode (existingAssessment provided): the teacher already has an
 *    assessment (generated via this bot or written themselves) — this mode
 *    produces the moderation paperwork around it: cover sheet, moderation
 *    checklist, cognitive-level/Bloom's review template, teacher declaration,
 *    HOD sign-off section. It does NOT regenerate the question paper or
 *    memorandum — those already exist.
 *
 *  - Full-build mode (no existingAssessment): the teacher wants the whole
 *    package from scratch — generates the question paper, memorandum, AND
 *    the moderation paperwork in one document.
 *
 * @param {{
 *   grade: number|null,
 *   subject: string,
 *   topic: string,
 *   marks: number,
 *   language: string,
 *   existingAssessment: { title: string, totalMarks: number, assessmentType: string }|null
 * }} intent
 * @returns {string}
 */
function moderationPackPrompt({ grade, subject, topic, marks, language, existingAssessment = null }) {
  // Grade R (0) is a genuine grade, not an unset one — must not fall through
  // to the null/undefined fallback below. Grades 1-12 and unset grade (null/
  // undefined) keep their exact prior behaviour.
  const gradeStr = grade === 0 ? 'Grade R' : (grade ? `Grade ${grade}` : 'Grade 8');
  const subjectStr = subject && subject !== 'general'
    ? subject.charAt(0).toUpperCase() + subject.slice(1)
    : 'General';

  const languageInstruction = language && language !== 'english'
    ? `\n\nGenerate this entire moderation pack in ${language.charAt(0).toUpperCase() + language.slice(1)}.`
    : '';

  // ── Foundation Phase (Grade R-3): CAPS has no formal SBA/moderation/
  // Bloom's-taxonomy concept at this phase. Both wrap and full-build modes
  // would otherwise hand a Grade R-3 teacher formal exam/moderation
  // paperwork that doesn't apply, so both route here instead.
  if (getPhase(grade) === 'foundation') {
    const topicStr = topic || (existingAssessment && (existingAssessment.title || existingAssessment.assessmentType)) || 'this focus area';

    return `You are an experienced South African Foundation Phase teacher producing a CAPS Foundation Phase Support & Observation Pack for ${gradeStr} ${subjectStr}.

TASK: Foundation Phase (Grade R-3) assessment under CAPS is observation-based and developmental, not formally moderated exam paperwork. Do NOT produce a question paper, memorandum, marks, cognitive-level/Bloom's taxonomy table, or moderator/HOD sign-off — none of that applies at this phase. Instead, produce a practical support and observation document for ${topicStr}.

DETAILS:
- Grade: ${gradeStr}
- Subject: ${subjectStr}
- Focus: ${topicStr}

Generate the following sections in full, ready to print:

═══════════════════════════════
*FOUNDATION PHASE SUPPORT & OBSERVATION PACK*
═══════════════════════════════

*School:* ______________________________________
*Subject:* ${subjectStr}    *Grade:* ${gradeStr}
*Focus Area:* ${topicStr}
*Teacher:* ___________________________________    *Date:* ___________

---

*1. WHAT TO LOOK FOR*
[Generate a short observation-based checklist of developmental descriptors for ${topicStr} appropriate to ${gradeStr} — what a teacher should watch for in learners during normal classroom activities, not a formal marking rubric.]

---

*2. TEACHER GUIDANCE NOTES*
[Generate practical, concrete notes on supporting learners developmentally with ${topicStr} — play-based, oral, and hands-on strategies suited to a typical SA Foundation Phase classroom.]

---

*3. REFLECTION SPACE*
_________________________________________________
_________________________________________________
_________________________________________________

Generate every section completely — no placeholders left as literal text like "[Generate...]" in the final output. Never use SBA, moderation, exam, marks, percentage, or Bloom's-taxonomy terminology anywhere in this document, since none of it applies at Foundation Phase.${languageInstruction}`;
  }

  // ── Wrap mode: moderation paperwork only, around an assessment that already exists ──
  if (existingAssessment) {
    const totalMarks = existingAssessment.totalMarks || marks || 50;
    const title = existingAssessment.title || topic || 'Assessment';
    const assessmentTypeLabel = existingAssessment.assessmentType || 'test';

    return `You are an experienced South African Head of Department preparing a moderation pack for a CAPS-aligned ${subjectStr} ${assessmentTypeLabel} that a teacher has already written.

TASK: Generate ONLY the moderation paperwork that wraps around this existing assessment — do NOT write a new question paper or memorandum, the teacher already has those.

ASSESSMENT BEING MODERATED:
- Title: ${title}
- Grade: ${gradeStr}
- Subject: ${subjectStr}
- Type: ${assessmentTypeLabel}
- Total Marks: ${totalMarks}

Generate the following sections in full, CAPS/DBE-aligned, ready to print and attach to the assessment:

═══════════════════════════════
*MODERATION PACK COVER SHEET*
═══════════════════════════════

*School:* ______________________________________
*Subject:* ${subjectStr}    *Grade:* ${grade === 0 ? 'R' : (grade || '____')}
*Assessment:* ${title}
*Type:* ${assessmentTypeLabel}    *Total Marks:* ${totalMarks}
*Teacher:* ___________________________________
*Date Submitted for Moderation:* ___________________

---

*1. TEACHER DECLARATION*

[Generate a short formal declaration statement for the teacher to sign, confirming the assessment is CAPS-aligned, original or properly sourced, and ready for moderation. Include a signature line.]

---

*2. COGNITIVE LEVEL / BLOOM'S TAXONOMY REVIEW*

[Generate a review template with a table the moderator fills in to record the ACTUAL cognitive level distribution found in the paper, compared against the CAPS-recommended target distribution for ${gradeStr} ${subjectStr}. Use this structure:]

| Cognitive Level | CAPS Target % | Actual Marks | Actual % | Moderator Notes |
|---|---|---|---|---|
| Knowledge/Recall | | | | |
| Application | | | | |
| Analysis | | | | |
| Evaluation/Synthesis | | | | |
| *TOTAL* | *100%* | | | |

[Fill in the CAPS Target % column with the correct recommended percentages for ${gradeStr} ${subjectStr} specifically — these vary by subject and phase, so use real CAPS guidance, not generic defaults. Do NOT reuse the Senior Phase (Grades 7-9) cognitive-level split for an FET (Grades 10-12) paper, or vice versa — confirm which CAPS phase document ${gradeStr} actually falls under before filling in the targets, since this has previously been a source of grade-band mix-ups.]

---

*3. MODERATION CHECKLIST*

[Generate a thorough checklist a moderator works through, grouped into these categories: CAPS Alignment, Technical Accuracy (mark totals, time allocation, layout), Memorandum Quality (completeness, fairness, alternative answers considered), Language & Accessibility, Bias & Fairness. Each item should be a clear yes/no checkable statement specific to a ${assessmentTypeLabel} in ${subjectStr}.]

---

*4. MODERATOR FEEDBACK*

*Strengths Identified:*
_________________________________________________

*Areas Requiring Revision:*
_________________________________________________

*Overall Recommendation:* ☐ Approved as is  ☐ Approved with minor changes  ☐ Requires resubmission

---

*5. SIGN-OFF*

*Moderated by:* _________________________ *Date:* _____________
*HOD Comments:* _________________________________________________
*HOD Signature:* _________________________ *Date:* _____________

Generate every section completely — no placeholders left as literal text like "[Generate...]" in the final output; replace every bracketed instruction with real, usable content. The checklist and Bloom's table must be specific to ${gradeStr} ${subjectStr}, not generic.${languageInstruction}`;
  }

  // ── Full-build mode: question paper + memo + moderation paperwork, all from scratch ──
  const totalMarks = marks || 50;
  const durationMinutes = totalMarks <= 20 ? 30 : totalMarks <= 40 ? 45 : totalMarks <= 60 ? 60 : totalMarks <= 80 ? 90 : 120;

  return `You are an experienced South African teacher and Head of Department producing a complete, moderation-ready assessment package aligned to the CAPS curriculum and DBE assessment policy.

TASK: Generate a complete question paper, full memorandum, AND the moderation paperwork to accompany it — all in one document, ready for departmental moderation.

DETAILS:
- Grade: ${gradeStr}
- Subject: ${subjectStr}
- Topic/Focus: ${topic}
- Total Marks: ${totalMarks}
- Duration: ${durationMinutes} minutes

═══════════════════════════════
*${subjectStr.toUpperCase()} ${gradeStr.toUpperCase()} — QUESTION PAPER*
═══════════════════════════════

*TOTAL MARKS:* ${totalMarks}    *TIME:* ${durationMinutes} minutes

*INSTRUCTIONS TO LEARNERS:*
[Generate 4–6 clear formal instructions appropriate for ${gradeStr}]

*SECTION A* (${Math.round(totalMarks * 0.3)} marks) — Knowledge & Understanding
[Generate questions covering ${topic}]

*SECTION B* (${Math.round(totalMarks * 0.4)} marks) — Application
[Generate questions covering ${topic}]

*SECTION C* (${Math.round(totalMarks * 0.3)} marks) — Analysis & Evaluation
[Generate questions covering ${topic}]

---

═══════════════════════════════
*MEMORANDUM*
═══════════════════════════════

[Generate complete worked answers and mark allocations for every question in Sections A, B, and C above. All marks must total exactly ${totalMarks}.]

---

═══════════════════════════════
*MODERATION PACK*
═══════════════════════════════

*1. TEACHER DECLARATION*
[Generate a short formal declaration for the teacher to sign confirming CAPS alignment and originality.]

*2. COGNITIVE LEVEL / BLOOM'S TAXONOMY DISTRIBUTION*
[Generate a completed table — since this paper was written to spec, fill in the ACTUAL marks per cognitive level based on the questions you generated above, compared to the CAPS target for ${gradeStr} ${subjectStr}:]

| Cognitive Level | CAPS Target % | Marks in This Paper | % |
|---|---|---|---|
| Knowledge/Recall | | | |
| Application | | | |
| Analysis | | | |
| Evaluation/Synthesis | | | |
| *TOTAL* | *100%* | *${totalMarks}* | *100%* |

*3. MODERATION CHECKLIST*
[Generate a thorough yes/no checklist covering CAPS alignment, technical accuracy, memorandum quality, language accessibility, and fairness — specific to this paper.]

*4. SIGN-OFF*
*Moderated by:* _________________________ *Date:* _____________
*HOD Comments:* _________________________________________________
*HOD Signature:* _________________________ *Date:* _____________

Generate the ENTIRE document — question paper, memorandum, and moderation pack. No placeholders. All marks must total exactly ${totalMarks}. Every bracketed instruction above must be replaced with real, complete, CAPS-aligned content.${languageInstruction}`;
}

module.exports = moderationPackPrompt;
