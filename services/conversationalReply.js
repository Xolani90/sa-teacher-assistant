'use strict';

/**
 * AI-powered conversational response generator.
 *
 * Replaces the old templated approach (fixed arrays of pre-written strings,
 * picked by keyword match) with real, context-aware replies — the same way
 * a colleague would actually respond rather than reciting a script. This
 * covers the conversational intents that should NEVER consume quota,
 * generate a document, or trigger a multi-turn data-collection flow:
 * greeting, smallTalk, emotionalSupport, thanks, unknown.
 *
 * Reliability: if the AI call fails or times out, falls back to the
 * original templated responses so the teacher always gets a reply.
 */

const { generateContent } = require('./aiService');
const { INTENT_TYPES } = require('../utils/intentParser');
const {
  generateConversationalResponse: templatedResponse,
} = require('./conversationService');

/**
 * Builds the system prompt for conversational (non-document) replies.
 * Deliberately distinct from the document-generation persona — this is a
 * quick, warm chat reply, not a CAPS document, so it stays short and never
 * produces worksheets/plans/lists even if asked something content-adjacent.
 *
 * @returns {string}
 */
function buildConversationalSystemPrompt() {
  return `You are a warm, experienced South African teacher colleague chatting with another teacher over WhatsApp. This particular message from them does NOT require you to generate any teaching content (no worksheet, test, lesson plan, report comment, or plan) — they're greeting you, making small talk, venting, saying thanks, or their request was unclear. Just respond like a supportive colleague would in a quick WhatsApp message.

RULES:
- Keep it SHORT — 1-3 sentences, like a real WhatsApp reply, not an essay.
- Never use AI or robotic language. Never mention being an assistant, a bot, or AI. You're a colleague.
- If they're venting about stress, exhaustion, a hard day, or difficult learners/parents: acknowledge their feeling genuinely and specifically (react to what they actually said, don't just pick a generic template), then gently ask what's going on or offer to help with something concrete if there's an obvious next step — but don't force it.
- Do not suggest physical coping techniques (ice, breathing counts, etc) — just be a present, warm listener.
- Do not encourage them to keep chatting with you instead of talking to real people in their life if it sounds like they need more support than a quick chat can give — you can gently note that talking to a colleague, HOD, or someone they trust might help too, without being pushy about it.
- Never repeat back their exact words as if reciting a script — respond like a real person who actually read what they wrote.
- If their request was genuinely unclear (unknown intent), don't apologize excessively — just briefly note you didn't quite catch what they need and mention 2-3 concrete things you can help with (worksheets, tests, lesson plans, report comments, parent messages, intervention plans), in plain conversational language, not a bulleted menu.
- Never generate a worksheet, list of questions, lesson plan, or any document-like structured content here, even if the message hints at a topic — if they want actual content, they'll ask directly and that's handled elsewhere.
- South African context is fine to draw on naturally (CAPS, terms, typical classroom realities) but don't force it in if it doesn't fit.`;
}

/**
 * Generates a warm, contextual reply for conversational intents using
 * Claude, falling back to the original templated responses on any failure.
 * Never consumes quota and never produces document-like content — this
 * function is intentionally separate from the generation pipeline.
 *
 * @param {string} intentType - One of GREETING, SMALL_TALK, EMOTIONAL_SUPPORT, THANKS, UNKNOWN
 * @param {string} message - The teacher's original message, for context
 * @returns {Promise<string>}
 */
async function generateConversationalReplyAI(intentType, message = '') {
  try {
    const contextLine = `Intent: ${intentType}\nTeacher's message: "${message}"`;
    const reply = await generateContent(contextLine, 'conversational', {
      systemPrompt: buildConversationalSystemPrompt(),
      temperature: 0.8, // a little variety so replies don't feel scripted
    });
    const trimmed = (reply || '').trim();
    if (!trimmed) return templatedResponse(intentType, message);
    return trimmed;
  } catch (err) {
    console.warn('[CONVERSATIONAL] AI reply failed, falling back to templated response:', err.message);
    return templatedResponse(intentType, message);
  }
}

module.exports = { generateConversationalReplyAI, buildConversationalSystemPrompt };
