'use strict';

const { parseObservation, getObservationFormatHelpText } = require('../utils/observationParser');

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

function assertDeepEqual(actual, expected, message) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
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

// ─────────────────────────────────────────────────────────────

test('valid observation with headers succeeds with correct metadata', () => {
  const input = [
    'Assessment: Term 3 Week 4',
    'Grade: R',
    'Subject: Mathematics',
    '',
    'Learner: Sipho',
    'Domain: Number Recognition',
    'Status: Developing',
    'Notes: Counts confidently to 10 but struggles beyond that.',
  ].join('\n');

  const result = parseObservation(input);

  assertEqual(result.success, true, 'success is true');
  assertDeepEqual(result.errors, [], 'no errors');
  assertEqual(result.records.length, 1, 'one record');
  assertDeepEqual(
    result.records[0],
    {
      learnerName: 'Sipho',
      domain: 'Number Recognition',
      developmentalStatus: 'Developing',
      notes: 'Counts confidently to 10 but struggles beyond that.',
    },
    'record shape is correct'
  );
  assertDeepEqual(
    result.metadata,
    {
      assessment: 'Term 3 Week 4',
      grade: 'R',
      subject: 'Mathematics',
      learnerCount: 1,
      recordCount: 1,
    },
    'metadata is correct'
  );
});

test('valid observation without headers succeeds with null header metadata', () => {
  const input = ['Learner: Sipho', 'Domain: Oral Language', 'Status: Achieved'].join('\n');
  const result = parseObservation(input);

  assertEqual(result.success, true, 'success is true');
  assertEqual(result.metadata.assessment, null, 'assessment is null');
  assertEqual(result.metadata.grade, null, 'grade is null');
  assertEqual(result.metadata.subject, null, 'subject is null');
  assertEqual(result.metadata.recordCount, 1, 'recordCount is 1');
});

test('multiple domains for one learner produce multiple records', () => {
  const input = [
    'Learner: Sipho',
    'Domain: Oral Language',
    'Status: Developing',
    'Domain: Gross Motor',
    'Status: Achieved',
  ].join('\n');

  const result = parseObservation(input);

  assertEqual(result.success, true, 'success is true');
  assertEqual(result.records.length, 2, 'two records');
  assertEqual(result.records[0].domain, 'Oral Language', 'first domain correct');
  assertEqual(result.records[1].domain, 'Gross Motor', 'second domain correct');
  assertEqual(result.metadata.learnerCount, 1, 'learnerCount is 1');
  assertEqual(result.metadata.recordCount, 2, 'recordCount is 2');
});

test('multiple learners produce correct learnerCount', () => {
  const input = [
    'Learner: Sipho',
    'Domain: Number Recognition',
    'Status: Developing',
    '',
    'Learner: Ayanda',
    'Domain: Number Recognition',
    'Status: Achieved',
    '',
    'Learner: sipho', // same learner, different casing
    'Domain: Fine Motor',
    'Status: Not Yet',
  ].join('\n');

  const result = parseObservation(input);

  assertEqual(result.success, true, 'success is true');
  assertEqual(result.records.length, 3, 'three records');
  assertEqual(result.metadata.learnerCount, 2, 'learnerCount is 2 (case-insensitive dedup)');
});

test('"NotYet" alias normalizes to "Not Yet"', () => {
  const input = ['Learner: Lethu', 'Domain: Number Recognition', 'Status: NotYet'].join('\n');
  const result = parseObservation(input);

  assertEqual(result.success, true, 'success is true');
  assertEqual(result.records[0].developmentalStatus, 'Not Yet', 'NotYet normalizes correctly');
});

test('"not yet" alias normalizes correctly', () => {
  const input = ['Learner: Lethu', 'Domain: Number Recognition', 'Status: not yet'].join('\n');
  const result = parseObservation(input);

  assertEqual(result.success, true, 'success is true');
  assertEqual(result.records[0].developmentalStatus, 'Not Yet', '"not yet" normalizes correctly');
});

test('mixed-case status "developing" normalizes correctly', () => {
  const input = ['Learner: Sipho', 'Domain: Oral Language', 'Status: developing'].join('\n');
  const result = parseObservation(input);

  assertEqual(result.success, true, 'success is true');
  assertEqual(result.records[0].developmentalStatus, 'Developing', '"developing" normalizes correctly');
});

test('unknown status produces an error', () => {
  const input = ['Learner: Sipho', 'Domain: Oral Language', 'Status: Good'].join('\n');
  const result = parseObservation(input);

  assertEqual(result.success, false, 'success is false');
  assert(result.errors.some((e) => e.includes('Unknown status "Good"')), 'error mentions unknown status');
});

test('header phase stays open after a malformed record line (domain before learner)', () => {
  const input = [
    'Assessment: Term 3',
    'Domain: Oral Language',
    'Status: Developing',
    'Subject: Mathematics',
    'Learner: Sipho',
  ].join('\n');

  const result = parseObservation(input);

  assert(
    result.errors.some((e) => e.includes('Domain given before any "Learner:" line')),
    'error reports domain before learner'
  );
  assertEqual(result.header.subject, 'Mathematics', 'subject still accepted after malformed line');
  assertDeepEqual(result.warnings, [], 'no warnings');
});

test('status before domain produces an error', () => {
  const input = ['Learner: Sipho', 'Status: Developing'].join('\n');
  const result = parseObservation(input);

  assertEqual(result.success, false, 'success is false');
  assert(
    result.errors.some((e) => e.includes('"Status:" given with no preceding "Domain:" line')),
    'error reports status before domain'
  );
});

test('missing learner name produces an error', () => {
  const input = ['Learner:', 'Domain: Oral Language', 'Status: Developing'].join('\n');
  const result = parseObservation(input);

  assertEqual(result.success, false, 'success is false');
  assert(result.errors.some((e) => e.includes('Missing learner name')), 'error mentions missing learner name');
});

test('missing domain name produces an error', () => {
  const input = ['Learner: Sipho', 'Domain:', 'Status: Developing'].join('\n');
  const result = parseObservation(input);

  assertEqual(result.success, false, 'success is false');
  assert(result.errors.some((e) => e.includes('Missing domain name')), 'error mentions missing domain name');
});

test('unknown key produces a warning listing valid keys', () => {
  const input = ['Learner: Sipho', 'Domain: Oral Language', 'Status: Developing', 'Skill: Something'].join('\n');
  const result = parseObservation(input);

  assertEqual(result.success, true, 'success is true');
  assert(result.warnings.some((w) => w.includes('Unknown field "Skill"')), 'warning mentions unknown field');
  assert(result.warnings.some((w) => w.includes('Expected one of:')), 'warning lists valid keys');
});

test('multi-line notes are combined correctly', () => {
  const input = [
    'Learner: Sipho',
    'Domain: Fine Motor',
    'Status: Developing',
    'Notes:',
    'Can identify colours.',
    'Needs support naming shapes.',
  ].join('\n');

  const result = parseObservation(input);

  assertEqual(result.success, true, 'success is true');
  assertEqual(
    result.records[0].notes,
    'Can identify colours. Needs support naming shapes.',
    'multi-line notes combined correctly'
  );
});

test('empty input produces an error', () => {
  const result = parseObservation('');

  assertEqual(result.success, false, 'success is false');
  assertDeepEqual(result.records, [], 'no records');
  assert(result.errors.length > 0, 'has at least one error');
});

test('empty Notes: is stored as null', () => {
  const input = ['Learner: Sipho', 'Domain: Oral Language', 'Status: Developing', 'Notes:'].join('\n');
  const result = parseObservation(input);

  assertEqual(result.success, true, 'success is true');
  assertEqual(result.records[0].notes, null, 'notes is null');
});

test('whitespace-only Notes: is stored as null', () => {
  const input = ['Learner: Sipho', 'Domain: Oral Language', 'Status: Developing', 'Notes:   '].join('\n');
  const result = parseObservation(input);

  assertEqual(result.success, true, 'success is true');
  assertEqual(result.records[0].notes, null, 'whitespace-only notes is null');
});

test('header repeated after first learner produces a warning and is ignored', () => {
  const input = [
    'Assessment: Term 3',
    'Grade: R',
    'Subject: Mathematics',
    '',
    'Learner: Sipho',
    'Domain: Oral Language',
    'Status: Developing',
    'Grade: 1', // repeated header after real learner phase started
  ].join('\n');

  const result = parseObservation(input);

  assertEqual(result.success, true, 'success is true');
  assertEqual(result.header.grade, 'R', 'grade unchanged');
  assert(
    result.warnings.some((w) => w.includes('"Grade" appeared after learner records began')),
    'warning about late header'
  );
});

test('multiple Notes: fields for the same domain — last one wins', () => {
  const input = [
    'Learner: Sipho',
    'Domain: Oral Language',
    'Status: Developing',
    'Notes: First note',
    'Notes: Second note',
  ].join('\n');

  const result = parseObservation(input);

  assertEqual(result.success, true, 'success is true');
  assertEqual(result.records.length, 1, 'one record');
  assertEqual(result.records[0].notes, 'Second note', 'last Notes: value wins');
});

test('duplicate header before learner — last value wins', () => {
  const input = ['Grade: R', 'Grade: 1', 'Learner: Sipho', 'Domain: Oral Language', 'Status: Developing'].join('\n');
  const result = parseObservation(input);

  assertEqual(result.success, true, 'success is true');
  assertEqual(result.header.grade, '1', 'last header value wins');
  assertDeepEqual(result.warnings, [], 'no warnings');
});

test('hyphenated key mid-record ("Teacher-Name:") warns and is NOT absorbed into notes', () => {
  const input = ['Learner: Sipho', 'Domain: Oral Language', 'Status: Developing', 'Teacher-Name: Ms Dlamini'].join(
    '\n'
  );

  const result = parseObservation(input);

  assertEqual(result.success, true, 'success is true');
  assertEqual(result.records.length, 1, 'one record');
  assertEqual(result.records[0].notes, null, 'notes not polluted by malformed key');
  assert(
    result.warnings.some(
      (w) => w.includes("looks like a field but isn't a recognized one") && w.includes('Teacher-Name')
    ),
    'warning mentions Teacher-Name'
  );
});

test('underscored key mid-record ("Teacher_Name:") warns and is NOT absorbed into notes', () => {
  const input = ['Learner: Sipho', 'Domain: Oral Language', 'Status: Developing', 'Teacher_Name: Ms Dlamini'].join(
    '\n'
  );

  const result = parseObservation(input);

  assertEqual(result.success, true, 'success is true');
  assertEqual(result.records[0].notes, null, 'notes not polluted by malformed key');
  assert(
    result.warnings.some(
      (w) => w.includes("looks like a field but isn't a recognized one") && w.includes('Teacher_Name')
    ),
    'warning mentions Teacher_Name'
  );
});

test('malformed key-like line does not get absorbed even when a genuine Notes: already exists', () => {
  const input = [
    'Learner: Sipho',
    'Domain: Oral Language',
    'Status: Developing',
    'Notes: Speaks confidently.',
    'Teacher-Name: Ms Dlamini',
  ].join('\n');

  const result = parseObservation(input);

  assertEqual(result.success, true, 'success is true');
  assertEqual(result.records[0].notes, 'Speaks confidently.', 'notes unaffected by malformed line');
  assert(result.warnings.some((w) => w.includes('Teacher-Name')), 'warning mentions Teacher-Name');
});

test('header values are trimmed of surrounding whitespace', () => {
  const input = [
    'Grade:    R',
    'Subject:    Mathematics',
    'Learner: Sipho',
    'Domain: Oral Language',
    'Status: Developing',
  ].join('\n');

  const result = parseObservation(input);

  assertEqual(result.header.grade, 'R', 'grade trimmed');
  assertEqual(result.header.subject, 'Mathematics', 'subject trimmed');
});

test('long notes spanning several continuation lines are concatenated in order', () => {
  const input = [
    'Learner: Sipho',
    'Domain: Oral Language',
    'Status: Developing',
    'Notes:',
    'First sentence.',
    'Second sentence.',
    'Third sentence.',
  ].join('\n');

  const result = parseObservation(input);

  assertEqual(result.success, true, 'success is true');
  assertEqual(
    result.records[0].notes,
    'First sentence. Second sentence. Third sentence.',
    'notes concatenated in order'
  );
});

test("\"Notes:\" immediately followed by the next Learner: line resolves to null, not the next record's content", () => {
  const input = [
    'Learner: Sipho',
    'Domain: Oral Language',
    'Status: Developing',
    'Notes:',
    'Learner: Ayanda',
    'Domain: Number Recognition',
    'Status: Achieved',
  ].join('\n');

  const result = parseObservation(input);

  assertEqual(result.success, true, 'success is true');
  assertEqual(result.records.length, 2, 'two records');
  assertEqual(result.records[0].learnerName, 'Sipho', 'first learner correct');
  assertEqual(result.records[0].notes, null, 'first record notes is null, not leaked from second');
  assertEqual(result.records[1].learnerName, 'Ayanda', 'second learner correct');
});

test('getObservationFormatHelpText returns non-empty guidance text', () => {
  const text = getObservationFormatHelpText();
  assertEqual(typeof text, 'string', 'returns a string');
  assert(text.length > 0, 'text is non-empty');
  assert(text.includes('Learner:'), 'text mentions Learner:');
});

// ─────────────────────────────────────────────────────────────

const total = passed + failed;
console.log('\n─────────────────────────────────');
if (failed === 0) {
  console.log(`✅ observationParser tests passed (${passed}/${total})`);
} else {
  console.error(`❌ observationParser tests FAILED (${passed}/${total} passed, ${failed} failed)`);
}
console.log('─────────────────────────────────\n');

process.exit(failed === 0 ? 0 : 1);
