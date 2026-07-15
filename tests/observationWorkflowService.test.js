'use strict';

const { processObservationSubmission } = require('../utils/observationWorkflowService');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  const ok = actual === expected;
  if (!ok) {
    console.error(`     expected: ${JSON.stringify(expected)}`);
    console.error(`     actual:   ${JSON.stringify(actual)}`);
  }
  assert(ok, message);
}

function test(name, fn) {
  console.log(`\n── ${name} ─────────────────────────────────`);
  try {
    fn();
  } catch (err) {
    failed++;
    console.error(`  ❌ threw unexpectedly: ${err.message}`);
  }
}

const HAPPY_INPUT = [
  'Assessment: Term 3 Week 4',
  'Grade: R',
  'Subject: Mathematics',
  '',
  'Learner: Sipho',
  'Domain: Number Recognition',
  'Status: Not Yet',
  'Notes: Struggles to count past 5.',
  '',
  'Learner: Ayanda',
  'Domain: Number Recognition',
  'Status: Achieved',
].join('\n');

// ─────────────────────────────────────────────────────────────
// Happy path — full pipeline wiring
// ─────────────────────────────────────────────────────────────

test('successful submission returns success:true with all pipeline outputs populated', () => {
  const result = processObservationSubmission(HAPPY_INPUT);

  assertEqual(result.success, true, 'success is true');
  assert(result.records !== null, 'records is populated');
  assert(result.analysis !== null, 'analysis is populated');
  assert(result.developmentalSummary !== null, 'developmentalSummary is populated');
  assert(result.domainStatusGroups !== null, 'domainStatusGroups is populated');
  assert(result.learnerGroups !== null, 'learnerGroups is populated');
  assertEqual(result.helpText, null, 'helpText is null on success');
});

test('successful submission header/metadata match the parser output', () => {
  const result = processObservationSubmission(HAPPY_INPUT);

  assertEqual(result.header.assessment, 'Term 3 Week 4', 'header.assessment correct');
  assertEqual(result.header.grade, 'R', 'header.grade correct');
  assertEqual(result.metadata.recordCount, 2, 'metadata.recordCount correct');
  assertEqual(result.metadata.learnerCount, 2, 'metadata.learnerCount correct');
});

test('successful submission analysis reflects the parsed records (not recomputed differently)', () => {
  const result = processObservationSubmission(HAPPY_INPUT);

  assertEqual(result.analysis.totalLearners, 2, 'analysis.totalLearners correct');
  assertEqual(result.analysis.observationsOfConcern.length, 1, 'one observation of concern (the Not Yet)');
  assertEqual(result.analysis.observationsOfConcern[0].learnerName, 'Sipho', 'concern is Sipho');
});

test('successful submission developmentalSummary is generated FROM the same analysis object', () => {
  const result = processObservationSubmission(HAPPY_INPUT);

  assert(result.developmentalSummary.includes('Sipho'), 'summary mentions Sipho');
  assert(result.developmentalSummary.includes('Number Recognition'), 'summary mentions the domain');
  assert(!result.developmentalSummary.includes('%'), 'summary has no percentage framing');
});

test('successful submission domainStatusGroups clusters correctly', () => {
  const result = processObservationSubmission(HAPPY_INPUT);

  assertEqual(result.domainStatusGroups.length, 2, 'two domain+status groups (Not Yet cluster + Achieved cluster)');
  const notYetGroup = result.domainStatusGroups.find((g) => g.developmentalStatus === 'Not Yet');
  assertEqual(notYetGroup.learners.length, 1, 'one learner in the Not Yet cluster');
  assertEqual(notYetGroup.learners[0].learnerName, 'Sipho', 'Sipho is in the Not Yet cluster');
});

test('successful submission learnerGroups produces one profile per learner', () => {
  const result = processObservationSubmission(HAPPY_INPUT);

  assertEqual(result.learnerGroups.length, 2, 'two learner profiles');
  const sipho = result.learnerGroups.find((g) => g.learnerName === 'Sipho');
  assertEqual(sipho.records.length, 1, 'Sipho has one record');
});

test('successful submission carries through non-fatal warnings, if any', () => {
  const inputWithWarning = HAPPY_INPUT + '\nSkill: Something Unknown';
  const result = processObservationSubmission(inputWithWarning);

  assertEqual(result.success, true, 'still succeeds overall');
  assert(
    result.warnings.some((w) => w.includes('Unknown field "Skill"')),
    'warning about unknown field is carried through'
  );
});

// ─────────────────────────────────────────────────────────────
// Fail-fast contract — parse failure short-circuits the pipeline
// ─────────────────────────────────────────────────────────────

test('failed parse (empty input) returns success:false with no analysis/grouping performed', () => {
  const result = processObservationSubmission('');

  assertEqual(result.success, false, 'success is false');
  assertEqual(result.records, null, 'records is null, not an empty array — analysis never ran');
  assertEqual(result.analysis, null, 'analysis is null');
  assertEqual(result.developmentalSummary, null, 'developmentalSummary is null');
  assertEqual(result.domainStatusGroups, null, 'domainStatusGroups is null');
  assertEqual(result.learnerGroups, null, 'learnerGroups is null');
  assert(result.errors.length > 0, 'errors array is populated');
  assert(typeof result.helpText === 'string' && result.helpText.length > 0, 'helpText is populated on failure');
});

test('failed parse (unknown status) returns success:false and surfaces the parser error verbatim', () => {
  const badInput = ['Learner: Sipho', 'Domain: Oral Language', 'Status: Excellent'].join('\n');
  const result = processObservationSubmission(badInput);

  assertEqual(result.success, false, 'success is false');
  assert(
    result.errors.some((e) => e.includes('Unknown status "Excellent"')),
    'parser error is surfaced unchanged'
  );
  assertEqual(result.analysis, null, 'analysis was never invoked on the failed parse');
});

test('failed parse (missing learner name) short-circuits before grouping runs', () => {
  const badInput = ['Learner:', 'Domain: Oral Language', 'Status: Developing'].join('\n');
  const result = processObservationSubmission(badInput);

  assertEqual(result.success, false, 'success is false');
  assertEqual(result.domainStatusGroups, null, 'grouping was never invoked');
  assertEqual(result.learnerGroups, null, 'grouping was never invoked');
});

test('failed parse still returns header/metadata for whatever header context was captured', () => {
  const badInput = ['Assessment: Term 3', 'Grade: R', 'Learner:'].join('\n');
  const result = processObservationSubmission(badInput);

  assertEqual(result.success, false, 'success is false');
  assertEqual(result.header.assessment, 'Term 3', 'header still reflects captured Assessment');
  assertEqual(result.header.grade, 'R', 'header still reflects captured Grade');
});

// ─────────────────────────────────────────────────────────────

const total = passed + failed;
console.log('\n─────────────────────────────────');
if (failed === 0) {
  console.log(`✅ observationWorkflowService tests passed (${passed}/${total})`);
} else {
  console.error(`❌ observationWorkflowService tests FAILED (${passed}/${total} passed, ${failed} failed)`);
}
console.log('─────────────────────────────────\n');

process.exit(failed === 0 ? 0 : 1);
