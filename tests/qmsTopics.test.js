'use strict';
/**
 * QMS Topic Taxonomy Tests (PR32, ADR-013 §3/§8 Section 1)
 *
 * Pure unit tests — no database involved. Covers:
 *   1. Unique ids, unique labels, no duplicate metadata
 *   2. isValidTopicId() behaviour
 *   3. getTopicById() behaviour, including resilience for malformed input
 *   4. listTopicsOrdered() honours ascending `order`, not declaration order
 *   5. Taxonomy is frozen (cannot be mutated at runtime)
 *
 * Run individually:   node tests/qmsTopics.test.js
 * Run via npm:         npm test
 */

const {
  QMS_TOPICS,
  isValidTopicId,
  getTopicById,
  listTopicsOrdered,
} = require('../utils/qmsTopics');

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
  console.log('📋 Section 1: Topic constants');

  assert(Array.isArray(QMS_TOPICS) && QMS_TOPICS.length > 0, 'QMS_TOPICS is a non-empty array');

  const ids = QMS_TOPICS.map((t) => t.id);
  assertEq(new Set(ids).size, ids.length, 'all topic ids are unique');

  const labels = QMS_TOPICS.map((t) => t.label);
  assertEq(new Set(labels).size, labels.length, 'all topic labels are unique');

  const orders = QMS_TOPICS.map((t) => t.order);
  assertEq(new Set(orders).size, orders.length, 'all topic order values are unique');

  for (const topic of QMS_TOPICS) {
    assert(typeof topic.id === 'string' && topic.id.startsWith('TOPIC_'), `${topic.id}: id follows TOPIC_ prefix convention`);
    assert(typeof topic.label === 'string' && topic.label.length > 0, `${topic.id}: has a non-empty label`);
    assert(typeof topic.description === 'string' && topic.description.length > 0, `${topic.id}: has a non-empty description`);
    assert(typeof topic.order === 'number', `${topic.id}: order is a number`);
  }

  console.log('📋 Section 2: isValidTopicId()');

  assert(isValidTopicId('TOPIC_CLASSROOM_MANAGEMENT') === true, 'accepts a known valid topicId');
  assert(isValidTopicId('TOPIC_BANANAS') === false, 'rejects an unknown topicId (ADR-013 §6.1 scenario)');
  assert(isValidTopicId(null) === false, 'rejects null');
  assert(isValidTopicId(undefined) === false, 'rejects undefined');
  assert(isValidTopicId('') === false, 'rejects empty string');
  assert(isValidTopicId(42) === false, 'rejects non-string input');

  console.log('📋 Section 3: getTopicById()');

  const cm = getTopicById('TOPIC_CLASSROOM_MANAGEMENT');
  assert(cm !== null, 'returns a topic for a valid id');
  assertEq(cm.label, 'Classroom Management', 'returned topic has the expected label');

  assert(getTopicById('TOPIC_BANANAS') === null, 'returns null for an unknown id (does not throw)');
  assert(getTopicById(null) === null, 'returns null for null input (does not throw)');
  assert(getTopicById(undefined) === null, 'returns null for undefined input (does not throw)');
  assert(getTopicById(42) === null, 'returns null for non-string input (does not throw)');

  console.log('📋 Section 4: listTopicsOrdered()');

  const ordered = listTopicsOrdered();
  assertEq(ordered.length, QMS_TOPICS.length, 'returns every topic');
  const returnedOrders = ordered.map((t) => t.order);
  const sortedOrders = [...returnedOrders].sort((a, b) => a - b);
  assertEq(returnedOrders, sortedOrders, 'topics are sorted by ascending order');

  console.log('📋 Section 5: Taxonomy is frozen');

  assert(Object.isFrozen(QMS_TOPICS), 'QMS_TOPICS array itself is frozen');
  assert(QMS_TOPICS.every(Object.isFrozen), 'every individual topic entry is frozen');

  let mutationThrew = false;
  try {
    QMS_TOPICS[0].label = 'Hacked';
  } catch (err) {
    mutationThrew = true;
  }
  // In non-strict contexts a frozen-object write silently no-ops rather than
  // throwing; either way the value must not change.
  assert(mutationThrew || QMS_TOPICS[0].label !== 'Hacked', 'mutating a topic entry has no effect');

  console.log('─────────────────────────────────');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('─────────────────────────────────');

  if (failed > 0) process.exit(1);
}

run();
