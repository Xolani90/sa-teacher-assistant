'use strict';

/**
 * test-atp-topic-alignment.js
 *
 * Regression coverage for the "Algebraic Equations in Term 3" bug class:
 * a lesson plan (or worksheet/test) topic that doesn't match the app's own
 * ATP for that grade/subject/term.
 *
 * Root causes fixed, each covered below:
 *  1. CAPS_TOPICS for Mathematics Grades 7-9 repeated the same full-year
 *     topic list in every term instead of being term-specific.
 *  2. intentClassifier.js had no "don't invent a topic" guardrail (topic
 *     had no equivalent of the existing grade/subject anti-guessing rule).
 *  3. generationPipeline.js never consulted the ATP at all for topic-driven
 *     document types — a missing topic just went straight to the AI prompt.
 *  4. The regex fallback parser could leave "term 3" itself behind as a
 *     fake topic, which (being non-null) would have skipped ATP resolution.
 */

const assert = require('assert');

const {
  CAPS_TOPICS,
  getTermTopics,
  resolveCurrentTopic,
  topicMatchesCurrentATP,
} = require('../services/curriculumIntelligenceService');
const { parseIntent } = require('../utils/intentParser');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`         ${e.message}`);
    failed++;
  }
}

console.log('\n=== ATP / Lesson Plan Topic Alignment ===\n');

// ── 1. CAPS_TOPICS term-uniqueness for Grades 7-9 Mathematics ──────────────
for (const grade of [7, 8, 9]) {
  test(`Grade ${grade} Mathematics: no term's topic list is identical to another's`, () => {
    const terms = CAPS_TOPICS.mathematics[grade];
    const termNums = Object.keys(terms).map(Number);
    for (let i = 0; i < termNums.length; i++) {
      for (let j = i + 1; j < termNums.length; j++) {
        const a = terms[termNums[i]].slice().sort().join('|');
        const b = terms[termNums[j]].slice().sort().join('|');
        assert.notStrictEqual(
          a, b,
          `Term ${termNums[i]} and Term ${termNums[j]} have identical topic lists — ` +
          `these are supposed to be term-specific, not the full-year list repeated`
        );
      }
    }
  });
}

test('Grade 7 Mathematics: "Algebraic equations" is not listed in Term 3 (the original bug)', () => {
  const term3 = getTermTopics(7, 'mathematics', 3);
  const hasAlgebraicEquations = term3.some(t => /algebraic equations/i.test(t));
  assert.strictEqual(hasAlgebraicEquations, false,
    `Term 3 topics were ${JSON.stringify(term3)} — algebra content belongs in Term 2 per the DBE ATP`);
});

test('Grade 7 Mathematics: Term 3 is geometry-focused, matching the real DBE/uploaded ATP', () => {
  const term3 = getTermTopics(7, 'mathematics', 3);
  assert.ok(term3.some(t => /geometry/i.test(t)), `Expected geometry content in Term 3, got ${JSON.stringify(term3)}`);
});

// ── 2. resolveCurrentTopic returns a topic that's actually in that term ────
test('resolveCurrentTopic (Grade 7 Maths, mid-Term 3 date) returns a Term 3 topic', () => {
  const date = new Date(2026, 6, 21); // 21 July 2026 — inside Term 3 per SA_SCHOOL_CALENDAR
  const resolved = resolveCurrentTopic(7, 'mathematics', date);
  assert.ok(resolved, 'Expected a resolved topic, got null');
  assert.strictEqual(resolved.term, 3);
  const term3Topics = getTermTopics(7, 'mathematics', 3);
  assert.ok(term3Topics.includes(resolved.topic),
    `Resolved topic "${resolved.topic}" is not one of this term's ATP topics: ${JSON.stringify(term3Topics)}`);
});

test('resolveCurrentTopic returns null for a grade/subject with no ATP reference data', () => {
  const resolved = resolveCurrentTopic(4, 'mathematics', new Date(2026, 6, 21));
  assert.strictEqual(resolved, null);
});

// ── 3. topicMatchesCurrentATP flags mismatches without blocking ────────────
test('topicMatchesCurrentATP flags "Algebraic Equations" as not matching Term 3', () => {
  const date = new Date(2026, 6, 21);
  const check = topicMatchesCurrentATP(7, 'mathematics', 'Algebraic Equations', date);
  assert.strictEqual(check.checked, true);
  assert.strictEqual(check.matches, false);
});

test('topicMatchesCurrentATP accepts a real Term 3 topic', () => {
  const date = new Date(2026, 6, 21);
  const check = topicMatchesCurrentATP(7, 'mathematics', 'Geometry of 2D shapes', date);
  assert.strictEqual(check.matches, true);
});

test('topicMatchesCurrentATP does not block (checked=false) when no reference data exists', () => {
  const check = topicMatchesCurrentATP(4, 'mathematics', 'anything', new Date(2026, 6, 21));
  assert.strictEqual(check.checked, false);
  assert.strictEqual(check.matches, true);
});

// ── 4. Regex fallback parser no longer leaves "term 3" behind as a topic ───
test('parseIntent("lesson plan grade 7 maths term 3") does not set topic to "term 3"', () => {
  const intent = parseIntent('lesson plan grade 7 maths term 3');
  assert.notStrictEqual((intent.topic || '').toLowerCase(), 'term 3');
});

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
