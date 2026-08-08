'use strict';
/**
 * GET /api/qms/topics tests.
 *
 * Thin-route test only: proves the handler returns the taxonomy from
 * listTopicsOrdered() shaped as { topics: [{id,label}] }, with no
 * description/order leakage and no independent topic list of its own
 * (ADR-013 §3/§4.2). listTopicsOrdered() itself is already covered by
 * tests/qmsTopics.test.js and is NOT re-tested here.
 *
 * Run individually: node tests/api-qms-topics.test.js
 * Run via npm:       npm test
 */

const assert = require('assert');
const { createGetQmsTopicsHandler } = require('../routes/api').__testExports;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}`);
    console.log(`       ${e.message}`);
    failed++;
    process.exitCode = 1;
  }
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

const sampleTopics = [
  { id: 'TOPIC_A', label: 'Topic A', description: 'desc A', order: 1 },
  { id: 'TOPIC_B', label: 'Topic B', description: 'desc B', order: 2 },
];

test('returns 200 with { topics: [{id,label}] }, stripping description/order', () => {
  const handler = createGetQmsTopicsHandler({ listTopicsOrdered: () => sampleTopics });
  const res = mockRes();
  handler({}, res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, {
    topics: [
      { id: 'TOPIC_A', label: 'Topic A' },
      { id: 'TOPIC_B', label: 'Topic B' },
    ],
  });
});

test('calls listTopicsOrdered() with no arguments (no filtering/auth logic of its own)', () => {
  let called = false;
  const handler = createGetQmsTopicsHandler({
    listTopicsOrdered: () => { called = true; return []; },
  });
  handler({}, mockRes());
  assert.strictEqual(called, true);
});

test('returns empty topics array cleanly if taxonomy is empty (defensive, not expected in practice)', () => {
  const handler = createGetQmsTopicsHandler({ listTopicsOrdered: () => [] });
  const res = mockRes();
  handler({}, res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { topics: [] });
});

console.log(`\n${passed} passed, ${failed} failed`);
