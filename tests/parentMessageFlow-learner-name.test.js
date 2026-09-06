'use strict';

/**
 * Regression test for the parentMessage learner-name extraction defect.
 *
 * flows/parentMessageFlow.js used to pick the FIRST capitalized word in
 * the teacher's message as the learner's name:
 *
 *   const nameMatch = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g);
 *   const learnerName = nameMatch ? nameMatch[0] : null;
 *
 * English sentences are capitalized at the start regardless of content,
 * so any natural request that opens with a capitalized verb — "Write a
 * message to Thabo's parent...", "Draft a note about Sipho...", "Send
 * home a message regarding Lindiwe..." — had its own opening word ("Write"
 * / "Draft" / "Send") extracted as the "learner's name" instead of the
 * real name later in the sentence. That name is then used verbatim to
 * generate and send a real AI-authored message to a parent, and consumes
 * the teacher's quota, entirely silently — no error, just a wrong result.
 *
 * The fix (extractLearnerName in flows/parentMessageFlow.js) prefers
 * contextual signals — a possessive tied to a parent-related noun, or a
 * name introduced by a preposition — before falling back to "first
 * capitalized word", and the fallback itself skips known leading command
 * words so it no longer misfires on the most common real phrasings.
 */

const { extractLearnerName, handleParentMessageFlow } = require('../flows/parentMessageFlow');

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, message) {
  const ok = actual === expected;
  if (ok) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ ${message}`);
    console.error(`     expected: ${JSON.stringify(expected)}`);
    console.error(`     actual:   ${JSON.stringify(actual)}`);
  }
}

async function test(name, fn) {
  console.log(`\n── ${name} ─────────────────────────────────`);
  await fn();
}

(async () => {

// ─────────────────────────────────────────────────────────────
// Section 1: extractLearnerName — the exact regression
// ─────────────────────────────────────────────────────────────

await test('the exact regression: a leading command verb is no longer mistaken for the learner name', () => {
  assertEqual(
    extractLearnerName("Write a message to Thabo's parent, he's been absent a lot"),
    'Thabo',
    'possessive "Thabo\'s parent" wins over the leading "Write"'
  );
  assertEqual(
    extractLearnerName('Draft a note for Sipho about his failing grades'),
    'Sipho',
    'prepositional "for Sipho" wins over the leading "Draft"'
  );
  assertEqual(
    extractLearnerName("Send home a message about Lindiwe's improvement"),
    'Lindiwe',
    'possessive "Lindiwe\'s improvement" wins over the leading "Send"'
  );
  assertEqual(
    extractLearnerName('Compose a parent message regarding Thandeka being disruptive'),
    'Thandeka',
    'prepositional "regarding Thandeka" wins over the leading "Compose"'
  );
  assertEqual(
    extractLearnerName('Please write to the parent about attendance for my class'),
    null,
    'no plausible name anywhere -> null, not a wrong guess ("Please")'
  );
});

await test('unchanged correct behaviour: a message that genuinely opens with the name', () => {
  assertEqual(
    extractLearnerName('Sipho was absent yesterday, can you help me message his parent'),
    'Sipho',
    'sentence-initial name is still picked up correctly'
  );
  assertEqual(
    extractLearnerName('Thabo Nkosi has been struggling with maths this term'),
    'Thabo Nkosi',
    'a two-word sentence-initial name is still picked up correctly'
  );
});

await test('possessive extraction (highest-confidence signal)', () => {
  assertEqual(extractLearnerName("Thabo's mom needs an update"), 'Thabo', "'s mom");
  assertEqual(extractLearnerName("Need to reach Sipho's father today"), 'Sipho', "'s father");
  assertEqual(extractLearnerName("Nomvula's guardian asked about her progress"), 'Nomvula', "'s guardian");
});

await test('prepositional extraction (second signal)', () => {
  assertEqual(extractLearnerName('Write something about Kagiso missing homework'), 'Kagiso', 'about <name>');
  assertEqual(extractLearnerName('I need a message for Zanele please'), 'Zanele', 'for <name>');
  assertEqual(extractLearnerName('A note to Ayanda regarding behaviour'), 'Ayanda', 'to <name>');
});

await test('no capitalized word at all -> null, does not throw', () => {
  assertEqual(extractLearnerName('please write a message about a learner who is absent'), null, 'lowercase-only message');
  assertEqual(extractLearnerName(''), null, 'empty string');
});

// ─────────────────────────────────────────────────────────────
// Section 2: end-to-end through handleParentMessageFlow with mocked deps
// ─────────────────────────────────────────────────────────────

function buildDeps(overrides = {}) {
  const sent = [];
  const store = new Map();
  return {
    parentMessageState: {
      get: (k) => store.get(k),
      set: (k, v) => store.set(k, v),
      delete: (k) => store.delete(k),
    },
    hashPhone: (from) => `hash:${from}`,
    parseIntent: () => ({ type: 'unknown' }),
    getTeacherByPhone: () => ({ grade: 7, subject: 'mathematics', language: 'english', name: 'Ms Dlamini', school: 'Test Primary' }),
    safeSendMessage: async (from, text) => { sent.push({ from, text }); },
    checkAndIncrementUsage: () => ({ allowed: true }),
    rollbackUsage: () => {},
    buildPrompt: (spec) => `PROMPT[${spec.type}:${spec.learnerName}]`,
    generateContent: async (prompt) => `GENERATED for ${prompt}`,
    FREE_LIMIT_DISPLAY: () => '10',
    _sent: sent,
    ...overrides,
  };
}

await test('a leading-verb request generates content addressed to the REAL learner, not the verb', async () => {
  const deps = buildDeps();
  const handled = await handleParentMessageFlow(
    '+27821234567',
    "Write a message to Thabo's parent about his attendance",
    { type: 'parentMessage' },
    deps
  );
  assertEqual(handled, true, 'message was handled by the flow');
  const generated = deps._sent.find(m => m.text.includes('GENERATED'));
  assertEqual(!!generated, true, 'content was generated immediately (name was extracted, no ask_learner_name step)');
  assertEqual(generated && generated.text.includes('Thabo'), true, 'generated content is addressed to Thabo, the real learner');
  assertEqual(generated && generated.text.includes('Write'), false, 'generated content is NOT addressed to "Write" (the old bug)');
});

await test('a request with no extractable name asks for the learner name instead of guessing', async () => {
  const deps = buildDeps();
  const handled = await handleParentMessageFlow(
    '+27821234567',
    'Please write to the parent about attendance for my class',
    { type: 'parentMessage' },
    deps
  );
  assertEqual(handled, true, 'message was handled by the flow');
  const prompt = deps._sent.find(m => m.text.includes("learner's name"));
  assertEqual(!!prompt, true, 'teacher is asked for the learner\'s name rather than getting a wrong guess');
  const generated = deps._sent.find(m => m.text.includes('GENERATED'));
  assertEqual(!!generated, false, 'no content was generated blind against a wrong/missing name');
});

// ─────────────────────────────────────────────────────────────

const total = passed + failed;
console.log('\n─────────────────────────────────');
if (failed === 0) {
  console.log(`✅ parentMessageFlow learner-name tests passed (${passed}/${total})`);
} else {
  console.error(`❌ parentMessageFlow learner-name tests FAILED (${passed}/${total} passed, ${failed} failed)`);
}
console.log('─────────────────────────────────\n');

process.exit(failed === 0 ? 0 : 1);

})();
