'use strict';

/**
 * Validates that an Annual Teaching Plan's week ranges are sequential and
 * non-overlapping within each term.
 *
 * This is a deterministic safety net for the AI-generated ATP content —
 * the prompt (prompts/atp.js) instructs the model not to repeat week
 * numbers across rows, but LLM output is probabilistic, so this check
 * catches it when the instruction isn't followed.
 *
 * Parses markdown pipe-table rows of the form:
 *   | 1-2 | Whole Numbers: ... | |
 *   | 4-5 | Exponents: ... | |
 * Header rows, separator rows (|---|---|), and non-table lines are ignored.
 * Only the first column (assumed to be the Week column) is inspected.
 *
 * @param {string} content - Raw AI-generated ATP text (WhatsApp/markdown formatted)
 * @returns {{ valid: boolean, issues: string[] }}
 */
function validateAtpWeeks(content) {
  const issues = [];
  if (!content || typeof content !== 'string') {
    return { valid: true, issues };
  }

  const lines = content.split('\n');

  // Track current term context so we can report which term an issue is in,
  // and so week-number tracking resets per term (Term 2 starting at week 11
  // is expected, not an overlap with Term 1).
  let currentTerm = null;
  let seenWeeks = new Set(); // week numbers already claimed in the current term
  let lastWeekEnd = null;    // last row's end-week, for sequential-ordering check

  const termHeaderRe = /TERM\s*(\d)/i;
  const weekCellRe = /^(\d{1,2})(?:\s*[-–—]\s*(\d{1,2}))?$/; // "5" or "4-5" or "4–5"

  for (const raw of lines) {
    const line = raw.trim();

    const termMatch = line.match(termHeaderRe);
    if (termMatch) {
      currentTerm = termMatch[1];
      seenWeeks = new Set();
      lastWeekEnd = null;
      continue;
    }

    if (!line.startsWith('|') || !line.endsWith('|')) continue;
    // Skip separator rows like |---|---|---|
    if (/^\|[\s\-:]+(\|[\s\-:]+)+\|$/.test(line)) continue;

    const cells = line.split('|').slice(1, -1).map(c => c.trim().replace(/\*/g, ''));
    if (cells.length === 0) continue;

    const weekCell = cells[0];
    // Skip the header row itself (e.g. "| Week | Topic / Content | Assessment |")
    if (/^week$/i.test(weekCell)) continue;

    const m = weekCell.match(weekCellRe);
    if (!m) continue; // not a recognisable week cell — ignore rather than false-flag

    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : start;

    if (end < start) {
      issues.push(`Term ${currentTerm || '?'}: row "${weekCell}" has end week before start week.`);
      continue;
    }

    for (let w = start; w <= end; w++) {
      if (seenWeeks.has(w)) {
        issues.push(`Term ${currentTerm || '?'}: Week ${w} appears in more than one row (row "${weekCell}" repeats a week already claimed).`);
      }
      seenWeeks.add(w);
    }

    if (lastWeekEnd !== null && start < lastWeekEnd) {
      issues.push(`Term ${currentTerm || '?'}: row "${weekCell}" starts before the previous row ended (week ${lastWeekEnd}) — out of order.`);
    }

    lastWeekEnd = end;
  }

  return { valid: issues.length === 0, issues };
}

module.exports = { validateAtpWeeks };
