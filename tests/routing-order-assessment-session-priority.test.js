'use strict';
/**
 * Routing-order regression test (ADR-006 PR1.5 — Webhook integration).
 *
 * Same class of bug the observation routing-order test guards against
 * (tests/routing-order-observation-priority.test.js): a flow with its own
 * active session must be checked BEFORE any flow that has no session of
 * its own and falls through to a fresh AI intent classification -- a bare
 * mark like "4" typed mid-assessment-session could otherwise be stolen by
 * another flow's classifier guess before handleAssessmentSessionFlow (which
 * DOES have an active session) ever sees it.
 *
 * This reads the actual source and asserts the ordering invariant directly
 * in both dispatch chains, the same style as the observation test, rather
 * than standing up a full Express/DB/WhatsApp/AI-classifier harness.
 *
 * Also asserts the STOP/opt-out non-collision decision from PR1: STOP must
 * be handled by handleCommand() -- which runs before either dispatch chain
 * -- and handleAssessmentSessionFlow must never appear inside handleCommand.
 *
 * Run individually:   node tests/routing-order-assessment-session-priority.test.js
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

const WEBHOOK_PATH = path.join(__dirname, '..', 'routes', 'webhook.js');
const source = fs.readFileSync(WEBHOOK_PATH, 'utf8');

// Flows that have no session of their own and fall through to fresh intent
// classification -- an assessment session must be checked before all of
// them, same principle as the observation flow.
const OTHER_FLOW_CALLS = [
  'handleReportCommentFlow(from, text',
  'handleProfileUpdateFlow(from, text',
  'handleParentMessageFlow(from, text',
  'handleAssessmentFlow(from, text',
  'handleAssessmentAnalysisFlow(from, text',
  'handleInterventionPlanFlow(from, text',
  'handleCurriculumQueryFlow(from, text',
];

const ASSESSMENT_SESSION_CALLS = [
  'handleAssessmentSessionFlow(from, text',
];

function indexOfFirst(haystack, needles, fromIndex) {
  let best = -1;
  for (const needle of needles) {
    const idx = haystack.indexOf(needle, fromIndex);
    if (idx !== -1 && (best === -1 || idx < best)) best = idx;
  }
  return best;
}

console.log('Routing-order regression: assessment session flow must be checked before the other flows');
console.log('='.repeat(75));

// ── Chain 1: alreadyMidFlow fast path ──────────────────────────────────
{
  const anchor = source.indexOf('alreadyMidFlow');
  assert(anchor !== -1, 'alreadyMidFlow dispatch chain exists in webhook.js');

  const chainEnd = source.indexOf('Defensive fallback', anchor);
  assert(chainEnd !== -1, 'alreadyMidFlow chain has expected fallback comment boundary');

  const boolBlock = source.slice(anchor, source.indexOf('if (alreadyMidFlow)', anchor));
  assert(
    boolBlock.includes('assessmentSessionState.get(phoneHash)'),
    '[alreadyMidFlow] assessmentSessionState included in the bypass condition'
  );

  const firstAssessmentSession = indexOfFirst(source, ASSESSMENT_SESSION_CALLS, anchor);
  const firstOther = indexOfFirst(source, OTHER_FLOW_CALLS, anchor);

  assert(firstAssessmentSession !== -1, '[alreadyMidFlow] assessment session flow call found');
  assert(firstOther !== -1, '[alreadyMidFlow] other flow calls found');
  assert(
    firstAssessmentSession !== -1 && firstOther !== -1 && firstAssessmentSession < firstOther,
    '[alreadyMidFlow] assessment session flow is checked before all seven other flows'
  );
}

// ── Chain 2: classified-intent dispatch chain ──────────────────────────
{
  const anchor = source.indexOf('const intent = skipClassifier');
  assert(anchor !== -1, 'classified-intent dispatch chain exists in webhook.js');

  const firstAssessmentSession = indexOfFirst(source, ASSESSMENT_SESSION_CALLS, anchor);
  const firstOther = indexOfFirst(source, OTHER_FLOW_CALLS, anchor);

  assert(firstAssessmentSession !== -1, '[classified-intent] assessment session flow call found');
  assert(firstOther !== -1, '[classified-intent] other flow calls found');
  assert(
    firstAssessmentSession !== -1 && firstOther !== -1 && firstAssessmentSession < firstOther,
    '[classified-intent] assessment session flow is checked before all seven other flows'
  );
}

// ── STOP must remain the global opt-out command, untouched by ADR-006 ──
{
  const commandFnStart = source.indexOf('async function handleCommand(from, text)');
  const commandFnEnd = source.indexOf('\nasync function ', commandFnStart + 1);
  assert(commandFnStart !== -1 && commandFnEnd !== -1, 'handleCommand() function located');

  const commandFnBody = source.slice(commandFnStart, commandFnEnd === -1 ? undefined : commandFnEnd);
  assert(
    commandFnBody.includes("upper === 'STOP'"),
    'handleCommand() still owns the global STOP opt-out branch'
  );
  assert(
    !commandFnBody.includes('handleAssessmentSessionFlow') && !commandFnBody.includes('assessmentSessionState'),
    'handleAssessmentSessionFlow / assessmentSessionState are not referenced inside handleCommand() (no STOP collision)'
  );

  // handleCommand() must run before either assessment-session dispatch call,
  // since it's what lets STOP short-circuit the whole message before any
  // flow (including this one) ever sees it.
  const commandCallSite = source.indexOf('const commandHandled = await handleCommand(from, text)');
  const firstAssessmentSessionCall = indexOfFirst(source, ASSESSMENT_SESSION_CALLS, 0);
  assert(
    commandCallSite !== -1 && firstAssessmentSessionCall !== -1 && commandCallSite < firstAssessmentSessionCall,
    'handleCommand() (and therefore STOP) is dispatched before handleAssessmentSessionFlow is ever reached'
  );
}

// ── Summary ─────────────────────────────────────────────────────────────
console.log('='.repeat(75));
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
