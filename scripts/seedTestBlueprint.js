'use strict';

require('dotenv').config();

/**
 * One-off local script to seed a published Assessment Blueprint for
 * smoke-testing the NEW TEST -> capture -> PDF flow end-to-end, since
 * there is currently no WhatsApp command to create a blueprint
 * (createBlueprint/publishBlueprint only exist in
 * services/blueprintRepository.js — see conversation history).
 *
 * Usage:
 *   node seedTestBlueprint.js "+27821234567"
 *
 * Replace the phone number with the exact WhatsApp number you test
 * with (same format your webhook receives it in — check a recent
 * [WEBHOOK] log line for the exact "from" format if unsure).
 *
 * This is a THROWAWAY dev script — not part of the app's runtime,
 * not wired into any route, and safe to delete after you're done
 * smoke-testing. Run it once, then run NEW TEST in WhatsApp.
 */

const { hashPhone } = require('./utils/usageTracker');
const { createBlueprint, publishBlueprint } = require('./services/blueprintRepository');

const rawPhone = process.argv[2];
if (!rawPhone) {
  console.error('Usage: node seedTestBlueprint.js "<phone number exactly as your webhook receives it>"');
  process.exit(1);
}

const phoneHash = hashPhone(rawPhone);
console.log(`[seed] phoneHash for ${rawPhone}: ${phoneHash}`);

const header = {
  title: 'Fractions Test (Seed)',
  subject: 'Mathematics',
  grade: 6,
  term: 2,
  totalMarks: 20,
};

// Topics below are deliberately simple, common Intermediate Phase
// Maths topics — if publishBlueprint's CAPS topic validation rejects
// any of these for your configured grade/subject/term, swap in
// whatever topic strings validateBlueprintTopics accepts for Grade 6
// Term 2 Mathematics in your CAPS_TOPICS data.
const questions = [
  { questionNumber: 1, topic: 'Common Fractions', maxMarks: 5 },
  { questionNumber: 2, topic: 'Common Fractions', maxMarks: 5 },
  { questionNumber: 3, topic: 'Whole Numbers', maxMarks: 5 },
  { questionNumber: 4, topic: 'Whole Numbers', maxMarks: 5 },
];

try {
  const { blueprintId, questionCount } = createBlueprint(phoneHash, header, questions);
  console.log(`[seed] Created blueprint ${blueprintId} with ${questionCount} questions (status: draft)`);

  const published = publishBlueprint(blueprintId, phoneHash);
  console.log(`[seed] Published blueprint ${published.blueprintId} (status: ${published.status})`);

  console.log('\n[seed] Done. In WhatsApp, send: NEW TEST');
  console.log('[seed] You should see "Fractions Test (Seed)" in the blueprint list.');
} catch (err) {
  console.error('[seed] Failed:', err.message);
  if (err.unresolvedTopics) {
    console.error('[seed] Unresolved topics:', JSON.stringify(err.unresolvedTopics, null, 2));
    console.error('[seed] Fix: check curriculumIntelligenceService.js\'s CAPS_TOPICS for valid Grade 6 Term 2 Mathematics topic names, and update the `questions` array above to match exactly.');
  }
  process.exit(1);
}
