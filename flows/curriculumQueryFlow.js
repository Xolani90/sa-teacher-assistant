'use strict';

/**
 * Curriculum Query Flow
 * ─────────────────────
 * Handles teacher questions about curriculum position, ATP topics, coverage,
 * pacing. Uses curriculumIntelligenceService for local (instant) responses.
 * Returns true if handled.
 *
 * Extracted verbatim from routes/webhook.js as part of the webhook
 * modularization effort. No behavior changes.
 */

/**
 * @param {string} from
 * @param {string} text
 * @param {Object} intent
 * @param {Object} deps - see buildCurriculumQueryDeps() in routes/webhook.js
 * @returns {Promise<boolean>}
 */
async function handleCurriculumQueryFlow(from, text, intent, deps) {
  const { getTeacherByPhone, handleCurriculumQuery, safeSendMessage } = deps;

  if (!intent || intent.type !== 'curriculumQuery') return false;

  const profile = getTeacherByPhone(from) || {};
  const response = handleCurriculumQuery(text, profile);

  await safeSendMessage(from, response);
  return true;
}

module.exports = { handleCurriculumQueryFlow };
