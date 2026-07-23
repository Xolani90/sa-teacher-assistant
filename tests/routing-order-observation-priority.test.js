'use strict';
/**
 * Routing-order regression test.
 *
 * Bug: an active observation session (mid ADD NOTE / CORRECT / RESOLVE /
 * DELETE) was silently hijacked because both dispatch chains in
 * routes/webhook.js checked seven other flows (report comment, profile
 * update, parent message, assessment, assessment analysis, intervention
 * plan, curriculum query) BEFORE handleObservationFlow /
 * handleObservationHistoryFlow. Those other handlers have no session of
 * their own to recognize, so they fall through to a fresh AI intent
 * classification of the raw text -- and a message like "Add note" or
 * "Delete" can easily be misclassified by one of them, stealing the
 * turn before the observation flow (which DOES have an active session)
 * ever gets a chance to handle it.
 *
 * Fix: move handleObservationFlow / handleObservationHistoryFlow to the
 * front of both dispatch chains. They check their own session state
 * first and cheaply return false when there's none, so this is a pure
 * reordering fix with no behavior change for anyone not mid-observation.
 *
 * None of the four existing observation test layers would catch a
 * regression here -- they all call handleObservationHistoryFlow /
 * handleObservationFlow directly, bypassing webhook.js's routing
 * entirely. This test reads the actual source and asserts the ordering
 * invariant directly, in both dispatch chains, rather than standing up
 * a full Express/DB/WhatsApp/AI-classifier integration harness.
 *
 * Run individually:   node tests/routing-order-observation-priority.test.js
 * Run via npm:         npm test
 */

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (!cond) {
    console.log(`  ❌ ${label}`);
    failed++;
  } else {
    console.log(`  ✅ ${label}`);
    passed++;
  }
}

// The dispatch chains asserted below live in processMessage(), which was
// extracted from routes/webhook.js into core/messageProcessor.js — read
// from its new location.
const WEBHOOK_PATH = path.join(__dirname, '..', 'core', 'messageProcessor.js');
const source = fs.readFileSync(WEBHOOK_PATH, 'utf8');

// The seven flows that must never be checked before the observation
// flows, because their handlers fall through to fresh intent
// classification when they have no active session of their own.
const OTHER_FLOW_CALLS = [
  'handleReportCommentFlow(from, text',
  'handleProfileUpdateFlow(from, text',
  'handleParentMessageFlow(from, text',
  'handleAssessmentFlow(from, text',
  'handleAssessmentAnalysisFlow(from, text',
  'handleInterventionPlanFlow(from, text',
  'handleCurriculumQueryFlow(from, text',
];

const OBSERVATION_CALLS = [
  'handleObservationFlow(from, text',
  'handleObservationHistoryFlow(from, text',
];

function indexOfFirst(haystack, needles, fromIndex) {
  let best = -1;
  for (const needle of needles) {
    const idx = haystack.indexOf(needle, fromIndex);
    if (idx !== -1 && (best === -1 || idx < best)) best = idx;
  }
  return best;
}

function indexOfLast(haystack, needles, fromIndex, toIndex) {
  let best = -1;
  for (const needle of needles) {
    const idx = haystack.indexOf(needle, fromIndex);
    if (idx !== -1 && idx < toIndex && idx > best) best = idx;
  }
  return best;
}

console.log('Routing-order regression: observation flows must be checked first');
console.log('='.repeat(75));

// ── Chain 1: alreadyMidFlow fast path ──────────────────────────────────
{
  const anchor = source.indexOf('alreadyMidFlow');
  assert(anchor !== -1, 'alreadyMidFlow dispatch chain exists in webhook.js');

  const chainEnd = source.indexOf('Defensive fallback', anchor);
  assert(chainEnd !== -1, 'alreadyMidFlow chain has expected fallback comment boundary');

  const firstObservation = indexOfFirst(source, OBSERVATION_CALLS, anchor);
  const firstOther = indexOfFirst(source, OTHER_FLOW_CALLS, anchor);

  assert(firstObservation !== -1, '[alreadyMidFlow] observation flow calls found');
  assert(firstOther !== -1, '[alreadyMidFlow] other flow calls found');
  assert(
    firstObservation !== -1 && firstOther !== -1 && firstObservation < firstOther,
    '[alreadyMidFlow] observation flow is checked before all seven other flows'
  );
}

// ── Chain 2: classified-intent dispatch chain ──────────────────────────
{
  const anchor = source.indexOf('const intent = skipClassifier');
  assert(anchor !== -1, 'classified-intent dispatch chain exists in webhook.js');

  const firstObservation = indexOfFirst(source, OBSERVATION_CALLS, anchor);
  const firstOther = indexOfFirst(source, OTHER_FLOW_CALLS, anchor);

  assert(firstObservation !== -1, '[classified-intent] observation flow calls found');
  assert(firstOther !== -1, '[classified-intent] other flow calls found');
  assert(
    firstObservation !== -1 && firstOther !== -1 && firstObservation < firstOther,
    '[classified-intent] observation flow is checked before all seven other flows'
  );
}

// ── Summary ─────────────────────────────────────────────────────────────
console.log('='.repeat(75));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
