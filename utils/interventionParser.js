'use strict';

/**
 * Parses the AI intervention response into step sections.
 *
 * Extracted verbatim from routes/webhook.js as part of the webhook
 * modularization effort. No behavior changes.
 *
 * @param {string} text
 * @returns {{ step6, step7, step8, step9, step10 }}
 */
function parseInterventionSections(text) {
  const result = {};
  const delimiters = {
    step6:  /===\s*STEP\s*6[^=]*===/i,
    step7:  /===\s*STEP\s*7[^=]*===/i,
    step8:  /===\s*STEP\s*8[^=]*===/i,
    step9:  /===\s*STEP\s*9[^=]*===/i,
    step10: /===\s*STEP\s*10[^=]*===/i,
  };
  const keys = ['step6', 'step7', 'step8', 'step9', 'step10'];

  // Find positions of each delimiter
  const positions = [];
  for (const key of keys) {
    const match = text.match(delimiters[key]);
    if (match) {
      positions.push({ key, index: text.indexOf(match[0]), length: match[0].length });
    }
  }
  positions.sort((a, b) => a.index - b.index);

  for (let i = 0; i < positions.length; i++) {
    const { key, index, length } = positions[i];
    const start = index + length;
    const end = i + 1 < positions.length ? positions[i + 1].index : text.length;
    result[key] = text.slice(start, end).trim();
  }

  return result;
}

module.exports = { parseInterventionSections };
