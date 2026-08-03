'use strict';

/**
 * Shared stateless QMS topic-selection helper (PR32, ADR-013 §4.2).
 *
 * Both reflectionFlow.js and growthPlanFlow.js need identical topic
 * selection UX: render a numbered list, validate a teacher's numeric
 * reply, map it to a topicId. Rather than duplicate that logic in each
 * flow, this module owns it exclusively.
 *
 * This helper is stateless — it takes input, returns output, and holds
 * no session data of its own. Conversation state (which step a teacher
 * is on, what they've entered so far) remains owned entirely by each
 * flow's own state map (reflectionState / growthPlanState), exactly as
 * before. This module must never be extended to own any part of session
 * state — if a future change seems to need that, it belongs in the flow,
 * not here (ADR-013 §4.2).
 */

const { listTopicsOrdered, getTopicById } = require('./qmsTopics');

/**
 * Renders the numbered topic list a teacher picks from. Topics are
 * always sorted by ascending `order` (ADR-013 §3.2/§4.2) — never by
 * module declaration order, which is an implementation detail of
 * utils/qmsTopics.js and not a guaranteed ordering.
 *
 * @returns {string}
 */
function renderTopicListMessage() {
  const topics = listTopicsOrdered();
  const lines = topics.map((topic, index) => `${index + 1}. ${topic.label}`);
  return `Which coaching area does this relate to?\n\n${lines.join('\n')}`;
}

/**
 * Validates a teacher's raw reply against the current ordered topic
 * list and resolves it to a topicId.
 *
 * @param {string} rawReply
 * @returns {{ ok: true, topicId: string, label: string } | { ok: false }}
 */
function resolveTopicSelection(rawReply) {
  const trimmed = typeof rawReply === 'string' ? rawReply.trim() : '';

  // Must be a bare positive integer — no leading zeros/whitespace
  // tricks, no partial matches like "1a".
  if (!/^[1-9][0-9]*$/.test(trimmed)) {
    return { ok: false };
  }

  const index = parseInt(trimmed, 10) - 1;
  const topics = listTopicsOrdered();

  if (index < 0 || index >= topics.length) {
    return { ok: false };
  }

  const topic = topics[index];
  return { ok: true, topicId: topic.id, label: topic.label };
}

/**
 * Resolves a persisted topicId back to its display label, resilient to
 * a stale/unknown topicId (ADR-013 §6.1) — returns null rather than
 * throwing so callers can decide how to render an unknown value.
 *
 * @param {string} topicId
 * @returns {string|null}
 */
function labelForTopicId(topicId) {
  const topic = getTopicById(topicId);
  return topic ? topic.label : null;
}

module.exports = {
  renderTopicListMessage,
  resolveTopicSelection,
  labelForTopicId,
};
