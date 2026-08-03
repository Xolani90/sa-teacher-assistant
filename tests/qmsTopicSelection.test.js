'use strict';
/**
 * qmsTopicSelection Helper Tests (PR32, ADR-013 §4.2/§8 Section 3.5)
 *
 * Pure unit tests, no database, no flow involved — tested directly
 * rather than only indirectly through reflectionFlow/growthPlanFlow.
 * Covers: topic list rendering, number -> topicId mapping, invalid-reply
 * handling, boundary conditions, and statelessness across calls.
 *
 * Run individually:   node tests/qmsTopicSelection.test.js
 * Run via npm:         npm test
 */

const {
  renderTopicListMessage,
  resolveTopicSelection,
  labelForTopicId,
} = require('../utils/qmsTopicSelection');
const { listTopicsOrdered } = require('../utils/qmsTopics');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

function assertEq(a, b, label) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    console.error(`     expected: ${JSON.stringify(b)}`);
    console.error(`     got:      ${JSON.stringify(a)}`);
    failed++;
  }
}

function run() {
  const orderedTopics = listTopicsOrdered();

  console.log('📋 Section 3.5: qmsTopicSelection helper');

  // ── renderTopicListMessage ────────────────────────────────────────
  const message = renderTopicListMessage();
  assert(typeof message === 'string' && message.length > 0, 'renderTopicListMessage returns a non-empty string');

  orderedTopics.forEach((topic, index) => {
    assert(message.includes(`${index + 1}. ${topic.label}`), `list includes "${index + 1}. ${topic.label}" in order position`);
  });

  // Ordering must follow listTopicsOrdered() (ascending `order`), not
  // module declaration order.
  const linePositions = orderedTopics.map((topic) => message.indexOf(topic.label));
  const sortedPositions = [...linePositions].sort((a, b) => a - b);
  assertEq(linePositions, sortedPositions, 'topics appear in ascending `order`, not declaration order');

  // ── resolveTopicSelection: valid replies ────────────────────────────
  orderedTopics.forEach((topic, index) => {
    const result = resolveTopicSelection(String(index + 1));
    assert(result.ok === true, `numeric reply "${index + 1}" resolves ok`);
    assertEq(result.topicId, topic.id, `numeric reply "${index + 1}" maps to ${topic.id}`);
    assertEq(result.label, topic.label, `numeric reply "${index + 1}" carries correct label`);
  });

  // Whitespace tolerance
  const paddedResult = resolveTopicSelection('  1  ');
  assert(paddedResult.ok === true, 'reply with surrounding whitespace resolves ok');
  assertEq(paddedResult.topicId, orderedTopics[0].id, 'padded reply maps to first topic');

  // ── resolveTopicSelection: invalid replies ──────────────────────────
  assert(resolveTopicSelection('0').ok === false, 'reply "0" is invalid (no zero-indexed option)');
  assert(resolveTopicSelection('-1').ok === false, 'negative reply is invalid');
  assert(resolveTopicSelection('1.5').ok === false, 'non-integer reply is invalid');
  assert(resolveTopicSelection('01').ok === false, 'leading-zero reply is invalid');
  assert(resolveTopicSelection('1a').ok === false, 'trailing-character reply is invalid');
  assert(resolveTopicSelection('abc').ok === false, 'non-numeric reply is invalid');
  assert(resolveTopicSelection('').ok === false, 'empty reply is invalid');
  assert(resolveTopicSelection('   ').ok === false, 'whitespace-only reply is invalid');
  assert(resolveTopicSelection(null).ok === false, 'null reply is invalid');
  assert(resolveTopicSelection(undefined).ok === false, 'undefined reply is invalid');

  // Boundary: exactly one past the last valid option
  const outOfRange = String(orderedTopics.length + 1);
  assert(resolveTopicSelection(outOfRange).ok === false, `reply "${outOfRange}" (one past last option) is invalid`);

  // Boundary: last valid option itself
  const lastValid = String(orderedTopics.length);
  assert(resolveTopicSelection(lastValid).ok === true, `reply "${lastValid}" (last valid option) resolves ok`);

  // ── labelForTopicId ──────────────────────────────────────────────
  orderedTopics.forEach((topic) => {
    assertEq(labelForTopicId(topic.id), topic.label, `labelForTopicId resolves ${topic.id} correctly`);
  });
  assertEq(labelForTopicId('TOPIC_DOES_NOT_EXIST'), null, 'labelForTopicId returns null for unknown topicId');
  assertEq(labelForTopicId(null), null, 'labelForTopicId returns null for null input');
  assertEq(labelForTopicId(undefined), null, 'labelForTopicId returns null for undefined input');

  // ── Statelessness ────────────────────────────────────────────────
  const firstCall = resolveTopicSelection('1');
  const secondCall = resolveTopicSelection('1');
  assertEq(firstCall, secondCall, 'repeated identical calls return identical results (no hidden state)');

  // Calling with a different value in between doesn't affect subsequent
  // calls with the original value.
  resolveTopicSelection(String(orderedTopics.length));
  const thirdCall = resolveTopicSelection('1');
  assertEq(thirdCall, firstCall, 'interleaved calls with different input do not affect later results');

  console.log('─────────────────────────────────');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('─────────────────────────────────');

  if (failed > 0) process.exit(1);
}

run();
