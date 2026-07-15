'use strict';

const {
  groupByDomainAndStatus,
  groupByLearner,
} = require('../services/observationGroupingService');

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
// groupByDomainAndStatus
// ─────────────────────────────────────────────────────────────

test('groupByDomainAndStatus: empty array returns empty array', () => {
  assertDeepEqual(groupByDomainAndStatus([]), [], 'empty result');
});

test('groupByDomainAndStatus: throws on non-array input', () => {
  let threw = false;
  try {
    groupByDomainAndStatus('nope');
  } catch (err) {
    threw = true;
  }
  assert(threw, 'throws when records is not an array');
});

test('groupByDomainAndStatus: single record produces a single group', () => {
  const records = [
    { learnerName: 'Sipho', domain: 'Number Recognition', developmentalStatus: 'Not Yet', notes: null },
  ];
  const groups = groupByDomainAndStatus(records);

  assertEqual(groups.length, 1, 'one group');
  assertEqual(groups[0].domain, 'Number Recognition', 'domain correct');
  assertEqual(groups[0].developmentalStatus, 'Not Yet', 'status correct');
  assertEqual(groups[0].learners.length, 1, 'one learner in group');
  assertDeepEqual(groups[0].learners[0], records[0], 'full original record preserved, including notes field');
});

test('groupByDomainAndStatus: same domain+status clusters multiple learners together', () => {
  const records = [
    { learnerName: 'Sipho', domain: 'Number Recognition', developmentalStatus: 'Not Yet', notes: null },
    { learnerName: 'Ayanda', domain: 'Number Recognition', developmentalStatus: 'Not Yet', notes: 'Needs 1:1 support' },
    { learnerName: 'Lethu', domain: 'Number Recognition', developmentalStatus: 'Achieved', notes: null },
  ];
  const groups = groupByDomainAndStatus(records);

  assertEqual(groups.length, 2, 'two groups (Not Yet cluster + Achieved cluster)');
  const notYetGroup = groups.find((g) => g.developmentalStatus === 'Not Yet');
  assertEqual(notYetGroup.learners.length, 2, 'two learners clustered as Not Yet');
  assertEqual(notYetGroup.learners[1].notes, 'Needs 1:1 support', 'notes preserved on clustered learner');
});

test('groupByDomainAndStatus: same domain different status produces separate groups', () => {
  const records = [
    { learnerName: 'A', domain: 'Oral Language', developmentalStatus: 'Achieved', notes: null },
    { learnerName: 'B', domain: 'Oral Language', developmentalStatus: 'Developing', notes: null },
    { learnerName: 'C', domain: 'Oral Language', developmentalStatus: 'Not Yet', notes: null },
  ];
  const groups = groupByDomainAndStatus(records);

  assertEqual(groups.length, 3, 'three distinct status groups within the same domain');
});

test('groupByDomainAndStatus: different domains never merge even with same status', () => {
  const records = [
    { learnerName: 'A', domain: 'Fine Motor', developmentalStatus: 'Not Yet', notes: null },
    { learnerName: 'B', domain: 'Gross Motor', developmentalStatus: 'Not Yet', notes: null },
  ];
  const groups = groupByDomainAndStatus(records);

  assertEqual(groups.length, 2, 'two groups, one per domain, despite identical status');
});

test('groupByDomainAndStatus: preserves first-seen group order', () => {
  const records = [
    { learnerName: 'A', domain: 'Zebra Domain', developmentalStatus: 'Achieved', notes: null },
    { learnerName: 'B', domain: 'Alpha Domain', developmentalStatus: 'Not Yet', notes: null },
    { learnerName: 'C', domain: 'Zebra Domain', developmentalStatus: 'Achieved', notes: null },
  ];
  const groups = groupByDomainAndStatus(records);

  assertEqual(groups[0].domain, 'Zebra Domain', 'first-seen domain+status group appears first');
  assertEqual(groups[1].domain, 'Alpha Domain', 'second-seen domain+status group appears second');
});

test('groupByDomainAndStatus: records missing domain or status are skipped, not thrown', () => {
  const records = [
    { learnerName: 'A', domain: null, developmentalStatus: 'Achieved', notes: null },
    { learnerName: 'B', domain: 'Fine Motor', developmentalStatus: null, notes: null },
    { learnerName: 'C', domain: 'Fine Motor', developmentalStatus: 'Achieved', notes: null },
  ];
  const groups = groupByDomainAndStatus(records);

  assertEqual(groups.length, 1, 'only the well-formed record produces a group');
  assertEqual(groups[0].learners.length, 1, 'malformed records excluded, not crashed on');
});

test('groupByDomainAndStatus: mutating the returned learner record does not mutate the input', () => {
  const original = { learnerName: 'Sipho', domain: 'Fine Motor', developmentalStatus: 'Achieved', notes: null };
  const records = [original];
  const groups = groupByDomainAndStatus(records);

  groups[0].learners[0].notes = 'mutated';
  assertEqual(original.notes, null, 'original input record is untouched (defensive copy)');
});

// ─────────────────────────────────────────────────────────────
// groupByLearner
// ─────────────────────────────────────────────────────────────

test('groupByLearner: empty array returns empty array', () => {
  assertDeepEqual(groupByLearner([]), [], 'empty result');
});

test('groupByLearner: throws on non-array input', () => {
  let threw = false;
  try {
    groupByLearner(42);
  } catch (err) {
    threw = true;
  }
  assert(threw, 'throws when records is not an array');
});

test('groupByLearner: single learner with multiple domains groups into one profile', () => {
  const records = [
    { learnerName: 'Sipho', domain: 'Oral Language', developmentalStatus: 'Developing', notes: null },
    { learnerName: 'Sipho', domain: 'Fine Motor', developmentalStatus: 'Achieved', notes: 'Great pencil grip' },
  ];
  const groups = groupByLearner(records);

  assertEqual(groups.length, 1, 'one learner profile');
  assertEqual(groups[0].learnerName, 'Sipho', 'learner name correct');
  assertEqual(groups[0].records.length, 2, 'both domain records grouped under the learner');
  assertEqual(groups[0].records[1].notes, 'Great pencil grip', 'notes preserved in grouped record');
});

test('groupByLearner: case-insensitive dedup uses first-seen casing as canonical name', () => {
  const records = [
    { learnerName: 'Sipho', domain: 'Oral Language', developmentalStatus: 'Achieved', notes: null },
    { learnerName: 'sipho', domain: 'Fine Motor', developmentalStatus: 'Developing', notes: null },
    { learnerName: 'SIPHO', domain: 'Gross Motor', developmentalStatus: 'Not Yet', notes: null },
  ];
  const groups = groupByLearner(records);

  assertEqual(groups.length, 1, 'all three casings merge into one learner');
  assertEqual(groups[0].learnerName, 'Sipho', 'canonical name is the first-seen casing');
  assertEqual(groups[0].records.length, 3, 'all three records grouped');
});

test('groupByLearner: multiple distinct learners produce separate profiles', () => {
  const records = [
    { learnerName: 'Sipho', domain: 'Oral Language', developmentalStatus: 'Achieved', notes: null },
    { learnerName: 'Ayanda', domain: 'Oral Language', developmentalStatus: 'Developing', notes: null },
  ];
  const groups = groupByLearner(records);

  assertEqual(groups.length, 2, 'two distinct learner profiles');
});

test('groupByLearner: preserves first-seen learner order', () => {
  const records = [
    { learnerName: 'Zanele', domain: 'D', developmentalStatus: 'Achieved', notes: null },
    { learnerName: 'Amahle', domain: 'D', developmentalStatus: 'Achieved', notes: null },
  ];
  const groups = groupByLearner(records);

  assertEqual(groups[0].learnerName, 'Zanele', 'first-seen learner appears first (not alphabetical)');
  assertEqual(groups[1].learnerName, 'Amahle', 'second-seen learner appears second');
});

test('groupByLearner: records missing learnerName are skipped, not thrown', () => {
  const records = [
    { learnerName: null, domain: 'D', developmentalStatus: 'Achieved', notes: null },
    { learnerName: 'Sipho', domain: 'D', developmentalStatus: 'Achieved', notes: null },
  ];
  const groups = groupByLearner(records);

  assertEqual(groups.length, 1, 'only the well-formed record produces a profile');
});

test('groupByLearner: mutating the returned record does not mutate the input', () => {
  const original = { learnerName: 'Sipho', domain: 'Fine Motor', developmentalStatus: 'Achieved', notes: null };
  const records = [original];
  const groups = groupByLearner(records);

  groups[0].records[0].notes = 'mutated';
  assertEqual(original.notes, null, 'original input record is untouched (defensive copy)');
});

test('groupByLearner: full record fields (domain, status, notes) all survive grouping', () => {
  const records = [
    { learnerName: 'Sipho', domain: 'Fine Motor', developmentalStatus: 'Not Yet', notes: 'Struggles with scissors' },
  ];
  const groups = groupByLearner(records);

  assertDeepEqual(groups[0].records[0], records[0], 'grouped record is identical to the original, nothing dropped');
});

// ─────────────────────────────────────────────────────────────

const total = passed + failed;
console.log('\n─────────────────────────────────');
if (failed === 0) {
  console.log(`✅ observationGroupingService tests passed (${passed}/${total})`);
} else {
  console.error(`❌ observationGroupingService tests FAILED (${passed}/${total} passed, ${failed} failed)`);
}
console.log('─────────────────────────────────\n');

process.exit(failed === 0 ? 0 : 1);
