'use strict';

/**
 * Conversation Context Service
 * Manages conversation memory and context for natural, contextual conversations.
 * Stores and retrieves conversation history to maintain flow across messages.
 */

const { getDb } = require('../utils/database');

/**
 * Maximum number of conversation turns to store per teacher
 */
const MAX_CONTEXT_TURNS = 10;

/**
 * Adds a conversation turn to the context.
 *
 * @param {string} phoneHash - Teacher's phone hash
 * @param {string} userMessage - User's message
 * @param {string} assistantResponse - Assistant's response
 * @param {string} intent - Intent type
 */
function addConversationTurn(phoneHash, userMessage, assistantResponse, intent) {
  const db = getDb();

  // Get existing context
  const teacher = db.prepare(`
    SELECT conversation_context FROM teachers WHERE phone_hash = ?
  `).get(phoneHash);

  let context = [];
  if (teacher && teacher.conversation_context) {
    try {
      context = JSON.parse(teacher.conversation_context);
    } catch (e) {
      context = [];
    }
  }

  // Add new turn
  context.push({
    timestamp: new Date().toISOString(),
    userMessage,
    assistantResponse,
    intent,
  });

  // Keep only the most recent turns
  if (context.length > MAX_CONTEXT_TURNS) {
    context = context.slice(-MAX_CONTEXT_TURNS);
  }

  // Save back to database
  db.prepare(`
    UPDATE teachers SET conversation_context = ? WHERE phone_hash = ?
  `).run(JSON.stringify(context), phoneHash);
}

/**
 * Gets the conversation context for a teacher.
 *
 * @param {string} phoneHash - Teacher's phone hash
 * @returns {Array} Conversation context array
 */
function getConversationContext(phoneHash) {
  const db = getDb();

  const teacher = db.prepare(`
    SELECT conversation_context FROM teachers WHERE phone_hash = ?
  `).get(phoneHash);

  if (!teacher || !teacher.conversation_context) {
    return [];
  }

  try {
    return JSON.parse(teacher.conversation_context);
  } catch (e) {
    return [];
  }
}

/**
 * Clears the conversation context for a teacher.
 *
 * @param {string} phoneHash - Teacher's phone hash
 */
function clearConversationContext(phoneHash) {
  const db = getDb();

  db.prepare(`
    UPDATE teachers SET conversation_context = NULL WHERE phone_hash = ?
  `).run(phoneHash);
}

/**
 * Gets a summary of recent conversation context.
 *
 * @param {string} phoneHash - Teacher's phone hash
 * @param {number} lastTurns - Number of recent turns to include
 * @returns {string} Context summary
 */
function getContextSummary(phoneHash, lastTurns = 3) {
  const context = getConversationContext(phoneHash);

  if (context.length === 0) {
    return null;
  }

  const recentContext = context.slice(-lastTurns);
  let summary = 'Recent conversation:\n';

  for (const turn of recentContext) {
    summary += `User: ${turn.userMessage}\n`;
    summary += `Assistant: ${turn.assistantResponse.substring(0, 100)}...\n`;
  }

  return summary;
}

/**
 * Checks if a topic was recently discussed.
 *
 * @param {string} phoneHash - Teacher's phone hash
 * @param {string} topic - Topic to check
 * @returns {boolean} True if topic was recently discussed
 */
function wasTopicRecentlyDiscussed(phoneHash, topic) {
  const context = getConversationContext(phoneHash);

  if (context.length === 0) {
    return false;
  }

  const recentTurns = context.slice(-5); // Check last 5 turns
  const topicLower = topic.toLowerCase();

  for (const turn of recentTurns) {
    if (turn.userMessage.toLowerCase().includes(topicLower) ||
        turn.assistantResponse.toLowerCase().includes(topicLower)) {
      return true;
    }
  }

  return false;
}

/**
 * Gets the last intent from conversation context.
 *
 * @param {string} phoneHash - Teacher's phone hash
 * @returns {string|null} Last intent type
 */
function getLastIntent(phoneHash) {
  const context = getConversationContext(phoneHash);

  if (context.length === 0) {
    return null;
  }

  return context[context.length - 1].intent;
}

/**
 * Updates conversation context with a new response.
 * This should be called after generating a response.
 *
 * @param {string} phoneHash - Teacher's phone hash
 * @param {string} userMessage - User's message
 * @param {string} assistantResponse - Assistant's response
 * @param {string} intent - Intent type
 */
function updateContext(phoneHash, userMessage, assistantResponse, intent) {
  addConversationTurn(phoneHash, userMessage, assistantResponse, intent);
}

module.exports = {
  addConversationTurn,
  getConversationContext,
  clearConversationContext,
  getContextSummary,
  wasTopicRecentlyDiscussed,
  getLastIntent,
  updateContext,
};
