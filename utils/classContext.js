'use strict';

/**
 * Shared class-context resolution helpers (ADR-004).
 *
 * Both assessmentFlow.js and observationFlow.js need the same 0/1/2+
 * class behavior: auto-use the sole class, ask when ambiguous, and stay
 * unclassed when the teacher has none yet (zero-class policy). This
 * module holds that shared logic so the two flows can't drift apart.
 *
 * Deliberately does NOT call getTeacherClasses() itself — callers pass
 * the already-fetched array in, since each flow decides when in its own
 * state machine to fetch it.
 */

/**
 * Builds the "Which class is this for?" prompt text for a teacher with
 * 2+ classes. Classes are numbered in the order given (callers should
 * pass the same order getTeacherClasses() returned, and store that same
 * order when interpreting the reply).
 *
 * @param {Array<{id: number, name: string, grade?: number, subject?: string}>} classes
 * @returns {string}
 */
function formatClassSelectionPrompt(classes) {
  let msg = 'Which *class* is this for?\n\n';
  classes.forEach((c, i) => {
    msg += `${i + 1}. ${c.name}\n`;
  });
  msg += '\nReply with the number.';
  return msg;
}

/**
 * Matches a teacher's numeric reply against the same-ordered class list
 * used to build the prompt. Returns the matched class, or null if the
 * reply isn't a valid selection (caller should re-prompt, not guess).
 *
 * @param {string} text
 * @param {Array<{id: number, name: string}>} classes
 * @returns {{id: number, name: string}|null}
 */
function matchClassSelection(text, classes) {
  const choice = parseInt(String(text).trim(), 10);
  if (!Number.isInteger(choice) || choice < 1 || choice > classes.length) {
    return null;
  }
  return classes[choice - 1];
}

module.exports = { formatClassSelectionPrompt, matchClassSelection };
