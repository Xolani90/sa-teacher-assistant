'use strict';
/**
 * Stabilization Issue #1 — dependency injection contract for assessmentFlow.js
 *
 * assessmentFlow.js receives all its dependencies via buildAssessmentDeps()
 * in routes/webhook.js. On 2026-07-19 an audit found 8 identifiers
 * (downloadMedia, updateTeacherProfile, checkAndIncrementUsage,
 * rollbackUsage, buildFullInterventionPlanPrompt, generateContent,
 * saveReport, parseInterventionSections) referenced in assessmentFlow.js
 * but never added to buildAssessmentDeps() — a silent ReferenceError
 * waiting in the mark-upload and AI intervention-plan code paths.
 *
 * This test does not parse assessmentFlow.js. It asserts the known
 * contract explicitly: every key the flow currently destructures from
 * `deps` must be present, defined, and (where applicable) callable on the
 * object buildAssessmentDeps() returns. If assessmentFlow.js is extended
 * to reference a new dependency, add it to REQUIRED_DEPS (and to
 * FUNCTION_DEPS if it's a function) in the same PR — that keeps the
 * contract intentional rather than silently drifting.
 */
const assert = require('assert');
const { buildAssessmentDeps } = require('../routes/webhook').__testExports;

const REQUIRED_DEPS = [
  'hashPhone',
  'safeSendMessage',
  'gradeLabel',
  'isProActive',
  'getTeacherByPhone',
  'dataAssessmentState',
  'parseMarks',
  'extractMarksFromImage',
  'getFormatHelpText',
  'processAssessmentData',
  'getTeacherClasses',
  'formatClassSelectionPrompt',
  'matchClassSelection',
  // regression coverage — added 2026-07-19 stabilization fix
  'downloadMedia',
  'updateTeacherProfile',
  'checkAndIncrementUsage',
  'rollbackUsage',
  'buildFullInterventionPlanPrompt',
  'generateContent',
  'saveReport',
  'parseInterventionSections',
];

// Deps that must specifically be functions. dataAssessmentState is a
// SessionStore (Map-like session state), not a function — excluded here
// but still covered by the "defined" check above.
const FUNCTION_DEPS = new Set([
  'hashPhone', 'safeSendMessage', 'gradeLabel', 'isProActive',
  'getTeacherByPhone', 'parseMarks', 'extractMarksFromImage',
  'getFormatHelpText', 'processAssessmentData', 'getTeacherClasses',
  'formatClassSelectionPrompt', 'matchClassSelection',
  'downloadMedia', 'updateTeacherProfile', 'checkAndIncrementUsage',
  'rollbackUsage', 'buildFullInterventionPlanPrompt', 'generateContent',
  'saveReport', 'parseInterventionSections',
]);

// ── Test runner (matches tests/learnerIdentityService.test.js convention) ──
let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log('PASS - ' + name);
    passed++;
  } catch (e) {
    console.log('FAIL - ' + name);
    console.log('       ' + e.message);
    process.exitCode = 1;
  }
}

const deps = buildAssessmentDeps();

test('buildAssessmentDeps returns an object', () => {
  assert.strictEqual(typeof deps, 'object');
  assert.notStrictEqual(deps, null);
});

REQUIRED_DEPS.forEach((name) => {
  test(`buildAssessmentDeps provides '${name}'`, () => {
    assert.ok(
      Object.prototype.hasOwnProperty.call(deps, name),
      `Expected buildAssessmentDeps() to include '${name}'`
    );
    assert.notStrictEqual(
      deps[name],
      undefined,
      `'${name}' is present but undefined — likely an unresolved reference in webhook.js`
    );
    if (FUNCTION_DEPS.has(name)) {
      assert.strictEqual(
        typeof deps[name],
        'function',
        `'${name}' should be a function, got ${typeof deps[name]}`
      );
    }
  });
});

console.log(`\n${passed} passed`);

// webhook.js opens persistent handles at module-load time (rate-limiter /
// session-store cleanup intervals) that are normally only ever torn down
// by the long-running server process exiting. Requiring it here (via
// __testExports) is the first time any test file has pulled webhook.js
// into a short-lived test process, so without an explicit exit the Node
// process — and thus tests/run-all.js — hangs after this file's own
// assertions are done, waiting on handles that were never meant to be
// closed mid-suite. This exit is scoped to this test file only; it does
// not change webhook.js's behavior in the real server process.
process.exit(process.exitCode || 0);
