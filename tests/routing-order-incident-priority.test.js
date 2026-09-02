'use strict';
/**
 * Routing-order regression test (Feature 3 Phase 2).
 *
 * Same failure mode as routing-order-observation-priority.test.js: an
 * active incident / incident-history session could be silently hijacked
 * if any of report comment, profile update, parent message, assessment,
 * assessment analysis, intervention plan, or curriculum query were
 * checked first in either dispatch chain — those handlers have no
 * session of their own to recognize, so they fall through to a fresh AI
 * intent classification of the raw text, which can misclassify a bare
 * reply like "2" or "BACK" and steal the turn.
 *
 * This test reads core/messageProcessor.js directly and asserts the
 * ordering invariant in both dispatch chains, mirroring
 * routing-order-observation-priority.test.js's approach.
 *
 * Run individually:   node tests/routing-order-incident-priority.test.js
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

const WEBHOOK_PATH = path.join(__dirname, '..', 'core', 'messageProcessor.js');
const source = fs.readFileSync(WEBHOOK_PATH, 'utf8');

const OTHER_FLOW_CALLS = [
  'handleReportCommentFlow(from, text',
  'handleProfileUpdateFlow(from, text',
  'handleParentMessageFlow(from, text',
  'handleAssessmentFlow(from, text',
  'handleAssessmentAnalysisFlow(from, text',
  'handleInterventionPlanFlow(from, text',
  'handleCurriculumQueryFlow(from, text',
];

const INCIDENT_CALLS = [
  'handleIncidentFlow(from, text',
  'handleIncidentHistoryFlow(from, text',
];

function indexOfFirst(haystack, needles, fromIndex) {
  let best = -1;
  for (const needle of needles) {
    const idx = haystack.indexOf(needle, fromIndex);
    if (idx !== -1 && (best === -1 || idx < best)) best = idx;
  }
  return best;
}

console.log('Routing-order regression: incident flows must be checked before generic flows');
console.log('='.repeat(75));

// ── Chain 1: alreadyMidFlow fast path ──────────────────────────────────
{
  const anchor = source.indexOf('alreadyMidFlow');
  assert(anchor !== -1, 'alreadyMidFlow dispatch chain exists in messageProcessor.js');

  const firstIncident = indexOfFirst(source, INCIDENT_CALLS, anchor);
  const firstOther = indexOfFirst(source, OTHER_FLOW_CALLS, anchor);

  assert(firstIncident !== -1, '[alreadyMidFlow] incident flow calls found');
  assert(firstOther !== -1, '[alreadyMidFlow] other flow calls found');
  assert(
    firstIncident !== -1 && firstOther !== -1 && firstIncident < firstOther,
    '[alreadyMidFlow] incident flows are checked before the seven generic flows'
  );
}

// ── Chain 2: classified-intent dispatch chain ──────────────────────────
{
  const anchor = source.indexOf('const intent = skipClassifier');
  assert(anchor !== -1, 'classified-intent dispatch chain exists in messageProcessor.js');

  const firstIncident = indexOfFirst(source, INCIDENT_CALLS, anchor);
  const firstOther = indexOfFirst(source, OTHER_FLOW_CALLS, anchor);

  assert(firstIncident !== -1, '[classified-intent] incident flow calls found');
  assert(firstOther !== -1, '[classified-intent] other flow calls found');
  assert(
    firstIncident !== -1 && firstOther !== -1 && firstIncident < firstOther,
    '[classified-intent] incident flows are checked before the seven generic flows'
  );
}

// ── Ordering between handleIncidentFlow and handleIncidentHistoryFlow ──
// Not load-bearing for correctness (each checks its own distinct session
// state), but keeping create-flow ahead of history-flow in source order
// matches the convention observation/observationHistory established.
{
  const anchor = source.indexOf('const intent = skipClassifier');
  const incidentIdx = source.indexOf('handleIncidentFlow(from, text', anchor);
  const incidentHistoryIdx = source.indexOf('handleIncidentHistoryFlow(from, text', anchor);
  assert(
    incidentIdx !== -1 && incidentHistoryIdx !== -1 && incidentIdx < incidentHistoryIdx,
    '[classified-intent] handleIncidentFlow is checked before handleIncidentHistoryFlow'
  );
}

// ── Summary ─────────────────────────────────────────────────────────────
console.log('='.repeat(75));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
