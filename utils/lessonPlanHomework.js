// utils/lessonPlanHomework.js
//
// Feature 2 — deterministic homework extraction/validation for lesson
// plans.
//
// Lesson plans (prompts/lessonPlan.js) are single free-text AI
// generations, not structured objects — there is no separate "homework"
// field coming out of the AI call. This module is the deterministic
// backstop that:
//   1. locates the homework section inside that text (by heading, exactly
//      like core/generationPipeline.js already locates ATP week ranges
//      and Mental Maths answer sections deterministically rather than
//      trusting the AI's structure blindly);
//   2. rejects placeholder/filler output (an un-filled "[...]" bracket, or
//      a suspiciously short line) so "homework is always included" means
//      *usable* homework, not just a heading with nothing under it;
//   3. never invents, rewrites, or grounds homework content itself — the
//      actual grounding (same topic, grade, CAPS term) is the prompt's
//      job (prompts/lessonPlan.js); this module only verifies the prompt
//      was honoured.
//
// Two headings are recognised because Foundation Phase (Grade R-3) CAPS
// practice deliberately does not set formal written homework — see the
// comment in prompts/lessonPlan.js — so its lesson plans use
// "OPTIONAL HOME ACTIVITY" instead of "HOMEWORK". Both are treated as the
// homework-equivalent section for persistence/delivery purposes; which
// one a given plan uses is itself CAPS-correct phase behaviour and is not
// altered here.

'use strict';

// WhatsApp markup is literal *bold* — the heading in the generated text
// looks like "*HOMEWORK*" or "*OPTIONAL HOME ACTIVITY*" on its own line.
const HOMEWORK_HEADINGS = ['HOMEWORK', 'OPTIONAL HOME ACTIVITY'];

// Matches a WhatsApp-bold heading line: optional leading whitespace, a
// literal *, the heading text, a literal *, end of that line.
function headingPattern(heading) {
  return new RegExp(`^\\s*\\*${heading}\\*\\s*$`, 'im');
}

// Any *HEADING* line at all — used to find where the NEXT section starts
// so extraction stops at the right boundary regardless of which headings
// a given lesson-plan shape uses.
const ANY_HEADING_LINE = /^\s*\*[^*\n]+\*\s*$/m;

/**
 * Finds which homework-equivalent heading (if any) is present, and
 * returns the raw text between it and the next *HEADING* line (or end of
 * content).
 *
 * @param {string} content - full generated lesson-plan text
 * @returns {{ heading: string, text: string } | null}
 */
function extractHomeworkSection(content) {
  if (!content || typeof content !== 'string') return null;

  for (const heading of HOMEWORK_HEADINGS) {
    const match = headingPattern(heading).exec(content);
    if (!match) continue;

    const afterHeading = content.slice(match.index + match[0].length);
    const nextHeadingMatch = ANY_HEADING_LINE.exec(afterHeading);
    const sectionText = nextHeadingMatch
      ? afterHeading.slice(0, nextHeadingMatch.index)
      : afterHeading;

    return { heading, text: sectionText.trim() };
  }

  return null;
}

// Placeholder patterns that indicate the AI echoed the prompt's own
// bracketed instruction back verbatim instead of writing real content
// (e.g. left "[One practical homework task...]" untouched).
const PLACEHOLDER_PATTERN = /^\s*\[.*\]\s*$/s;
const MIN_USABLE_LENGTH = 12; // shorter than any real task description in practice

/**
 * @param {string} content - full generated lesson-plan text
 * @returns {boolean} true if a homework/home-activity section exists and
 *   contains real (non-placeholder, non-trivial) content.
 */
function hasUsableHomework(content) {
  const section = extractHomeworkSection(content);
  if (!section || !section.text) return false;
  if (PLACEHOLDER_PATTERN.test(section.text)) return false;
  return section.text.length >= MIN_USABLE_LENGTH;
}

module.exports = {
  HOMEWORK_HEADINGS,
  extractHomeworkSection,
  hasUsableHomework,
};
