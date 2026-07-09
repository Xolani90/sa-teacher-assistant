'use strict';

/**
 * Conversation Intelligence Service
 * Handles conversational intents (GREETING, SMALL_TALK, EMOTIONAL_SUPPORT, THANKS, UNKNOWN)
 * These responses should never consume quota, generate PDFs, or invoke content-generation workflows.
 * Responses are warm, professional, and South African in tone.
 */

const { INTENT_TYPES } = require('../utils/intentParser');

// Greeting responses - rotate to avoid repetition
const GREETING_RESPONSES = [
  "Good morning. I hope your day is off to a good start. How can I help make teaching a little easier today?",
  "Hello. It's great to hear from you. What can I help you with today?",
  "Hi there. I'm here to help with whatever you need. What's on your mind?",
  "Good afternoon. Hope you're having a productive day. How can I assist you?",
  "Hey. Good to see you. What can I help you with?",
];

// Thank you responses
const THANKS_RESPONSES = [
  "You're very welcome. I'm glad I could help.",
  "My pleasure. If you need anything else, just send a message.",
  "Any time. That's what I'm here for.",
  "You're welcome. Happy to help anytime.",
  "Glad I could assist. Don't hesitate to ask if you need anything else.",
];

// Small talk responses
const SMALL_TALK_RESPONSES = [
  "I'm doing well, thanks for asking. More importantly, how are you doing? How can I help you today?",
  "I'm here and ready to help. What can I do for you?",
  "All good on my end. What do you need help with?",
  "I'm doing great. Let me know what you need and I'll do my best to assist.",
];

// Emotional support responses - acknowledge emotion before offering help
const EMOTIONAL_SUPPORT_RESPONSES = {
  exhausted: [
    "Teaching can be incredibly demanding, especially when you're carrying so much responsibility every day. Be kind to yourself. What's been weighing on you most today?",
    "I hear you. Teaching takes a lot out of you, and it's completely normal to feel drained. Have you been able to take any breaks today?",
  ],
  stressed: [
    "That sounds really stressful. Teaching comes with so many pressures, and it's okay to feel overwhelmed sometimes. What's causing the most stress right now?",
    "I understand. Teaching can be incredibly stressful, especially when there's so much to juggle. Is there something specific I can help you with to lighten the load?",
  ],
  overwhelmed: [
    "It sounds like you're carrying a lot right now. That's a tough place to be. Let's take this one step at a time. What feels most urgent?",
    "I can hear that you're overwhelmed. That's completely understandable given everything teachers manage. What would help you feel a bit more in control?",
  ],
  difficult_class: [
    "Some classes can be really challenging. It's not a reflection on your teaching — every teacher faces this. What's been happening with this class?",
    "Dealing with a difficult class is exhausting. You're not alone in this. What specific challenges are you facing?",
  ],
  rough_day: [
    "That sounds like a really tough day. Some days in the classroom can take everything out of you. Hopefully you've had a chance to breathe. If you'd like to talk through what happened, I'm here.",
    "I'm sorry to hear today was rough. Teaching has its really hard days. What made today so difficult?",
  ],
  parent_problems: [
    "Parent issues can be incredibly draining and stressful. You're doing important work, even when it doesn't feel like it. What's going on with the parents?",
    "Dealing with difficult parents is one of the hardest parts of teaching. It's not just you — many teachers struggle with this. What happened?",
  ],
  tired_of_marking: [
    "Marking can feel endless, I know. It's one of those parts of teaching that just keeps coming. How much do you have left to get through?",
    "I completely understand. Marking piles up so quickly. Is there anything I can help you with to make the process easier?",
  ],
  general: [
    "That sounds really difficult. Teaching comes with so many challenges, and it's okay to feel this way. What's been going on?",
    "I hear you. Teaching is hard work, and it's completely normal to feel this way sometimes. What would be most helpful for you right now?",
  ],
};

// Practical teaching support responses
const PRACTICAL_SUPPORT_RESPONSES = {
  discipline: [
    "Discipline is one of the toughest aspects of teaching. A few things that often help: be consistent with consequences, build positive relationships with learners, and address behaviour privately when possible. What specific situation are you dealing with?",
    "Managing behaviour is challenging. The key is often prevention — clear expectations, routines, and building rapport. What's the behaviour issue you're facing?",
  ],
  behaviour: [
    "Behaviour management takes time and patience. Focus on the positive behaviour you want to see, not just the negative. Catch them doing right and acknowledge it. What behaviour are you struggling with?",
    "Behaviour issues can be so draining. Remember that behaviour is communication — learners are trying to tell us something. What's happening in your class?",
  ],
  motivation: [
    "Motivating learners is tricky but possible. Try connecting content to their lives, giving them choices where you can, and celebrating small wins. What subject or grade are you working with?",
    "Learner motivation is a common challenge. Sometimes it helps to understand what they care about and connect learning to that. What's the situation?",
  ],
  workload: [
    "Teaching workload can feel overwhelming. Prioritise what must be done, what should be done, and what can wait. Don't be afraid to say no to non-essentials. What's feeling most overwhelming?",
    "The workload is real. Try to focus on high-impact tasks and let go of perfectionism where you can. What's taking up most of your time?",
  ],
};

// Unknown intent response
const UNKNOWN_RESPONSES = [
  "I'm not completely sure what you're looking for, but I'll do my best to help. I can assist with lesson planning, assessments, curriculum coverage, intervention planning, classroom challenges, learner support, and more. Tell me a little more about what you need.",
  "I want to help, but I'm not entirely sure what you need. I'm here for lesson plans, worksheets, tests, explanations, report comments, parent messages, and more. What would be most useful for you right now?",
  "Could you tell me a bit more about what you're looking for? I can help with CAPS-aligned content, assessments, intervention planning, and general teaching support. What's on your mind?",
];

/**
 * Generates a conversational response based on intent type.
 * Never consumes quota, never generates PDFs/documents.
 *
 * @param {string} intentType - The intent type (GREETING, SMALL_TALK, EMOTIONAL_SUPPORT, THANKS, UNKNOWN)
 * @param {string} message - The original message (for context)
 * @returns {string} A warm, conversational response
 */
function generateConversationalResponse(intentType, message = '') {
  const lower = message.toLowerCase();

  switch (intentType) {
    case INTENT_TYPES.GREETING:
      return getRandomResponse(GREETING_RESPONSES);

    case INTENT_TYPES.THANKS:
      return getRandomResponse(THANKS_RESPONSES);

    case INTENT_TYPES.SMALL_TALK:
      return getRandomResponse(SMALL_TALK_RESPONSES);

    case INTENT_TYPES.EMOTIONAL_SUPPORT:
      return getEmotionalSupportResponse(lower);

    case INTENT_TYPES.UNKNOWN:
    default:
      return getRandomResponse(UNKNOWN_RESPONSES);
  }
}

/**
 * Returns a random response from an array, with simple rotation to avoid immediate repetition.
 */
function getRandomResponse(responses) {
  const index = Math.floor(Math.random() * responses.length);
  return responses[index];
}

/**
 * Determines the appropriate emotional support response based on keywords in the message.
 */
function getEmotionalSupportResponse(message) {
  const responses = EMOTIONAL_SUPPORT_RESPONSES;

  if (/\b(exhausted|tired|drained|burnout|burning out)\b/.test(message)) {
    return getRandomResponse(responses.exhausted);
  }
  if (/\b(stressed|stressful|anxiety|anxious)\b/.test(message)) {
    return getRandomResponse(responses.stressed);
  }
  if (/\b(overwhelmed|too much|can't cope)\b/.test(message)) {
    return getRandomResponse(responses.overwhelmed);
  }
  if (/\b(difficult class|bad class|challenging class|behaviour|disruptive)\b/.test(message)) {
    return getRandomResponse(responses.difficult_class);
  }
  if (/\b(rough day|terrible day|bad day|hard day|awful day)\b/.test(message)) {
    return getRandomResponse(responses.rough_day);
  }
  if (/\b(parent|parents|parent problems|parent issues)\b/.test(message)) {
    return getRandomResponse(responses.parent_problems);
  }
  if (/\b(marking|mark|grading|grade)\b/.test(message)) {
    return getRandomResponse(responses.tired_of_marking);
  }

  return getRandomResponse(responses.general);
}

/**
 * Checks if an intent is conversational (should not trigger generation or consume quota).
 *
 * @param {string} intentType
 * @returns {boolean}
 */
function isConversationalIntent(intentType) {
  return [
    INTENT_TYPES.GREETING,
    INTENT_TYPES.SMALL_TALK,
    INTENT_TYPES.EMOTIONAL_SUPPORT,
    INTENT_TYPES.THANKS,
    INTENT_TYPES.UNKNOWN,
  ].includes(intentType);
}

module.exports = {
  generateConversationalResponse,
  isConversationalIntent,
};
