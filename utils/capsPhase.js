'use strict';

/**
 * Central CAPS phase classification.
 *
 * Grade is represented as: 0 = Grade R, 1-12 = Grade 1-12, null = unknown.
 * Every other module should go through this file rather than re-deriving
 * phase boundaries locally, so phase logic only needs to change in one place.
 */

const PHASES = {
  FOUNDATION: 'foundation',   // Grade R - 3
  INTERMEDIATE: 'intermediate', // Grade 4 - 6
  SENIOR: 'senior',           // Grade 7 - 9
  FET: 'fet',                 // Grade 10 - 12
};

/**
 * @param {number|null} grade - 0 for Grade R, 1-12 otherwise, null if unknown
 * @returns {string|null} one of PHASES, or null if grade is null
 */
function getPhase(grade) {
  if (grade === null || grade === undefined) return null;
  if (grade === 0) return PHASES.FOUNDATION;
  if (grade >= 1 && grade <= 3) return PHASES.FOUNDATION;
  if (grade >= 4 && grade <= 6) return PHASES.INTERMEDIATE;
  if (grade >= 7 && grade <= 9) return PHASES.SENIOR;
  if (grade >= 10 && grade <= 12) return PHASES.FET;
  return null;
}

/**
 * Human-readable grade label, handling Grade R specially.
 * @param {number|null} grade
 * @returns {string}
 */
function gradeLabel(grade) {
  if (grade === null || grade === undefined) return 'the appropriate grade level';
  if (grade === 0) return 'Grade R';
  return `Grade ${grade}`;
}

/**
 * Parses a grade out of free text, including "Grade R" / "Gr R" / "R".
 * Returns 0 for Grade R, 1-12 for numeric grades, or null if not found.
 * @param {string} text
 * @returns {number|null}
 */
function parseGrade(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  // Grade R must be checked first — "r" alone is too ambiguous to search for
  // outside a grade-word context, so it must follow grade/gr/graad.
  if (/\b(?:grade|gr|graad)[.\s]?r\b/i.test(lower)) return 0;

  const numMatch = lower.match(/\b(?:grade?|gr|g|graad)[.\s]?(\d{1,2})\b/i);
  if (numMatch) {
    return Math.min(12, Math.max(1, parseInt(numMatch[1], 10)));
  }

  return null;
}

module.exports = { PHASES, getPhase, gradeLabel, parseGrade };
