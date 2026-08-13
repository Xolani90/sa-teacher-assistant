'use strict';
/**
 * RC1-D1-001 — Blueprint selection list showed "undefined questions".
 *
 * Root cause: services/blueprintRepository.js's listBlueprints() returns
 * each blueprint with a camelCase `questionCount` field (its documented,
 * real contract — see the JSDoc @returns on that function). But
 * flows/assessmentSessionFlow.js's formatBlueprintList() read the
 * snake_case `question_count` instead, which does not exist on the
 * returned object, so it rendered as `undefined questions` in the
 * `NEW TEST` / `PRINT` blueprint-selection message on WhatsApp.
 *
 * This test deliberately shapes its fixture to match the REAL
 * listBlueprints() return contract (camelCase questionCount) rather than
 * mirroring the bug, unlike the older fixture in
 * assessment-session-flow.test.js (`question_count: 4`), which
 * accidentally matched the buggy consumer and is why the existing suite
 * never caught this. That older fixture was deliberately left alone
 * here, per the RC1 investigation scope agreed for this defect.
 *
 * Run individually: node tests/rc1-d1-001-blueprint-question-count-display.test.js
 * Run via npm:       npm test
 */

const { createTestDb } = require('./helpers/createTestDb');

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

async function run() {
  const testDb = createTestDb(__filename);

  const { SessionStore } = require('../utils/sessionStore');
  const { handleAssessmentSessionFlow } = require('../flows/assessmentSessionFlow');
  const navigationService = require('../services/navigationService');

  navigationService.registerFlow({
    id: 'assessmentSession',
    commands: ['NEW TEST', 'PRINT', 'RESUME'],
    capabilities: { status: true, cancel: true, back: false, menus: true },
    menus: { complete: ['Start a new assessment', 'Print a blueprint question paper'] },
    hooks: { cleanup: () => {}, describeStatus: () => null },
  });

  const PHONE = '+27831234567';
  const hashPhone = (p) => `hash_${p}`;
  const sentMessages = [];

  const blueprintsFixture = [
    { id: 1, title: 'Fractions Test Term 2', grade: 6, subject: 'Mathematics', questionCount: 3 },
    { id: 2, title: 'Single Question Quiz', grade: 6, subject: 'Mathematics', questionCount: 1 },
    { id: 3, title: 'No Questions Yet Draft', grade: 6, subject: 'Mathematics', questionCount: 0 },
  ];

  const deps = {
    hashPhone,
    safeSendMessage: async (to, msg) => { sentMessages.push({ to, msg }); },
    assessmentSessionState: new SessionStore('assessmentSession', 24 * 60 * 60 * 1000),
    listBlueprints: () => blueprintsFixture,
    getTeacherClasses: () => [],
  };

  function lastMessage() {
    return sentMessages[sentMessages.length - 1]?.msg || '';
  }

  console.log('\n── RC1-D1-001: blueprint list renders the real question count ──');
  await handleAssessmentSessionFlow(PHONE, 'NEW TEST', null, null, deps);
  const msg = lastMessage();

  assert(!/undefined question/i.test(msg), 'the exact regression: message does NOT contain "undefined questions"');
  assert(msg.includes('3 questions'), 'multi-question blueprint renders "3 questions"');
  assert(msg.includes('1 question') && !msg.includes('1 questions'), 'singular "1 question" (not "1 questions") for a single-question blueprint');
  assert(msg.includes('0 questions'), 'zero-question blueprint renders "0 questions", not "undefined questions"');

  console.log('\n── RC1-D1-001: same fix applies to the PRINT blueprint list ──');
  deps.assessmentSessionState.delete(hashPhone(PHONE));
  sentMessages.length = 0;
  await handleAssessmentSessionFlow(PHONE, 'PRINT', null, null, deps);
  const printMsg = lastMessage();
  assert(!/undefined question/i.test(printMsg), 'PRINT blueprint list also does not show "undefined questions"');
  assert(printMsg.includes('3 questions'), 'PRINT list also renders the real count');

  console.log('\n' + '─'.repeat(64));
  console.log(`RC1-D1-001 Regression Results: ${passed} passed, ${failed} failed`);
  console.log('─'.repeat(64));

  testDb.cleanup?.();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test run crashed:', err);
  process.exit(1);
});
