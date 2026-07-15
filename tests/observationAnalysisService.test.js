'use strict';

const {
  analyzeObservations,
  generateDevelopmentalSummary,
} = require('../services/observationAnalysisService');

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
// analyzeObservations
// ─────────────────────────────────────────────────────────────

test('analyzeObservations: empty array returns zeroed-out analysis', () => {
  const analysis = analyzeObservations([]);

  assertEqual(analysis.totalLearners, 0, 'totalLearners is 0');
  assertDeepEqual(analysis.domainSummaries, [], 'domainSummaries is empty');
  assertDeepEqual(analysis.observationsOfConcern, [], 'observationsOfConcern is empty');
});

test('analyzeObservations: throws on non-array input', () => {
  let threw = false;
  try {
    analyzeObservations('not an array');
  } catch (err) {
    threw = true;
  }
  assert(threw, 'throws when records is not an array');
});

test('analyzeObservations: single Achieved record tallies correctly, no concern raised', () => {
  const records = [
    { learnerName: 'Sipho', domain: 'Oral Language', developmentalStatus: 'Achieved', notes: null },
  ];
  const analysis = analyzeObservations(records);

  assertEqual(analysis.totalLearners, 1, 'one learner');
  assertEqual(analysis.domainSummaries.length, 1, 'one domain');
  assertDeepEqual(
    analysis.domainSummaries[0],
    { domain: 'Oral Language', achieved: 1, developing: 0, notYet: 0 },
    'tally correct'
  );
  assertDeepEqual(analysis.observationsOfConcern, [], 'Achieved never raises a concern');
});

test('analyzeObservations: Not Yet record raises a concern regardless of notes', () => {
  const records = [
    { learnerName: 'Ayanda', domain: 'Fine Motor', developmentalStatus: 'Not Yet', notes: null },
  ];
  const analysis = analyzeObservations(records);

  assertEqual(analysis.observationsOfConcern.length, 1, 'one concern');
  assertEqual(analysis.observationsOfConcern[0].learnerName, 'Ayanda', 'concern learner correct');
  assertEqual(analysis.observationsOfConcern[0].notes, null, 'concern notes preserved as null');
});

test('analyzeObservations: Not Yet record WITH notes still raises a concern (notes included)', () => {
  const records = [
    {
      learnerName: 'Ayanda',
      domain: 'Fine Motor',
      developmentalStatus: 'Not Yet',
      notes: 'Struggles to hold a pencil correctly.',
    },
  ];
  const analysis = analyzeObservations(records);

  assertEqual(analysis.observationsOfConcern.length, 1, 'one concern');
  assertEqual(
    analysis.observationsOfConcern[0].notes,
    'Struggles to hold a pencil correctly.',
    'notes carried through to the concern entry'
  );
});

test('analyzeObservations: Developing WITHOUT notes does NOT raise a concern', () => {
  const records = [
    { learnerName: 'Lethu', domain: 'Number Recognition', developmentalStatus: 'Developing', notes: null },
  ];
  const analysis = analyzeObservations(records);

  assertDeepEqual(analysis.observationsOfConcern, [], 'no concern for note-less Developing record');
});

test('analyzeObservations: Developing WITH notes DOES raise a concern', () => {
  const records = [
    {
      learnerName: 'Lethu',
      domain: 'Number Recognition',
      developmentalStatus: 'Developing',
      notes: 'Can count to 5 reliably, still building to 10.',
    },
  ];
  const analysis = analyzeObservations(records);

  assertEqual(analysis.observationsOfConcern.length, 1, 'one concern');
  assertEqual(analysis.observationsOfConcern[0].developmentalStatus, 'Developing', 'status is Developing');
});

test('analyzeObservations: Developing with empty-string notes does NOT raise a concern', () => {
  const records = [
    { learnerName: 'Lethu', domain: 'Number Recognition', developmentalStatus: 'Developing', notes: '' },
  ];
  const analysis = analyzeObservations(records);

  assertDeepEqual(analysis.observationsOfConcern, [], 'empty string notes treated as no notes');
});

test('analyzeObservations: Achieved WITH notes still does NOT raise a concern', () => {
  const records = [
    {
      learnerName: 'Sipho',
      domain: 'Oral Language',
      developmentalStatus: 'Achieved',
      notes: 'Very confident speaker.',
    },
  ];
  const analysis = analyzeObservations(records);

  assertDeepEqual(analysis.observationsOfConcern, [], 'Achieved is never a concern, notes or not');
});

test('analyzeObservations: multiple domains tally independently', () => {
  const records = [
    { learnerName: 'Sipho', domain: 'Oral Language', developmentalStatus: 'Achieved', notes: null },
    { learnerName: 'Sipho', domain: 'Fine Motor', developmentalStatus: 'Not Yet', notes: null },
    { learnerName: 'Ayanda', domain: 'Oral Language', developmentalStatus: 'Developing', notes: null },
  ];
  const analysis = analyzeObservations(records);

  assertEqual(analysis.domainSummaries.length, 2, 'two distinct domains');
  const oralLanguage = analysis.domainSummaries.find((d) => d.domain === 'Oral Language');
  const fineMotor = analysis.domainSummaries.find((d) => d.domain === 'Fine Motor');
  assertDeepEqual(
    oralLanguage,
    { domain: 'Oral Language', achieved: 1, developing: 1, notYet: 0 },
    'Oral Language tally correct'
  );
  assertDeepEqual(
    fineMotor,
    { domain: 'Fine Motor', achieved: 0, developing: 0, notYet: 1 },
    'Fine Motor tally correct'
  );
});

test('analyzeObservations: domainSummaries preserves first-seen domain order', () => {
  const records = [
    { learnerName: 'A', domain: 'Zebra Domain', developmentalStatus: 'Achieved', notes: null },
    { learnerName: 'B', domain: 'Alpha Domain', developmentalStatus: 'Achieved', notes: null },
  ];
  const analysis = analyzeObservations(records);

  assertEqual(analysis.domainSummaries[0].domain, 'Zebra Domain', 'first-seen domain appears first');
  assertEqual(analysis.domainSummaries[1].domain, 'Alpha Domain', 'second-seen domain appears second');
});

test('analyzeObservations: totalLearners deduplicates by case-insensitive name', () => {
  const records = [
    { learnerName: 'Sipho', domain: 'Oral Language', developmentalStatus: 'Achieved', notes: null },
    { learnerName: 'sipho', domain: 'Fine Motor', developmentalStatus: 'Developing', notes: null },
    { learnerName: 'Ayanda', domain: 'Oral Language', developmentalStatus: 'Not Yet', notes: null },
  ];
  const analysis = analyzeObservations(records);

  assertEqual(analysis.totalLearners, 2, 'Sipho/sipho counted once, plus Ayanda');
});

test('analyzeObservations: multiple concerns preserve record order', () => {
  const records = [
    { learnerName: 'A', domain: 'D1', developmentalStatus: 'Not Yet', notes: null },
    { learnerName: 'B', domain: 'D1', developmentalStatus: 'Achieved', notes: null },
    { learnerName: 'C', domain: 'D1', developmentalStatus: 'Developing', notes: 'needs support' },
  ];
  const analysis = analyzeObservations(records);

  assertEqual(analysis.observationsOfConcern.length, 2, 'two concerns (A and C, not B)');
  assertEqual(analysis.observationsOfConcern[0].learnerName, 'A', 'first concern is A');
  assertEqual(analysis.observationsOfConcern[1].learnerName, 'C', 'second concern is C');
});

// ─────────────────────────────────────────────────────────────
// generateDevelopmentalSummary
// ─────────────────────────────────────────────────────────────

test('generateDevelopmentalSummary: throws on missing analysis object', () => {
  let threw = false;
  try {
    generateDevelopmentalSummary(null);
  } catch (err) {
    threw = true;
  }
  assert(threw, 'throws when analysis is null');
});

test('generateDevelopmentalSummary: singular learner phrasing for exactly 1 learner', () => {
  const analysis = analyzeObservations([
    { learnerName: 'Sipho', domain: 'Oral Language', developmentalStatus: 'Achieved', notes: null },
  ]);
  const summary = generateDevelopmentalSummary(analysis);

  assert(summary.includes('1 learner.'), 'uses singular "1 learner."');
  assert(!summary.includes('1 learners.'), 'does not use plural for count of 1');
});

test('generateDevelopmentalSummary: plural learner phrasing for more than 1 learner', () => {
  const analysis = analyzeObservations([
    { learnerName: 'Sipho', domain: 'Oral Language', developmentalStatus: 'Achieved', notes: null },
    { learnerName: 'Ayanda', domain: 'Oral Language', developmentalStatus: 'Developing', notes: null },
  ]);
  const summary = generateDevelopmentalSummary(analysis);

  assert(summary.includes('2 learners.'), 'uses plural "2 learners."');
});

test('generateDevelopmentalSummary: includes domain tally lines', () => {
  const analysis = analyzeObservations([
    { learnerName: 'Sipho', domain: 'Oral Language', developmentalStatus: 'Achieved', notes: null },
  ]);
  const summary = generateDevelopmentalSummary(analysis);

  assert(summary.includes('Oral Language'), 'mentions the domain');
  assert(summary.includes('1 Achieved'), 'mentions the achieved count');
});

test('generateDevelopmentalSummary: no domains recorded produces explanatory line', () => {
  const analysis = analyzeObservations([]);
  const summary = generateDevelopmentalSummary(analysis);

  assert(summary.includes('No developmental domains were recorded.'), 'explains absence of domains');
});

test('generateDevelopmentalSummary: no concerns produces reassuring line', () => {
  const analysis = analyzeObservations([
    { learnerName: 'Sipho', domain: 'Oral Language', developmentalStatus: 'Achieved', notes: null },
  ]);
  const summary = generateDevelopmentalSummary(analysis);

  assert(summary.includes('No observations currently need follow-up.'), 'states no follow-up needed');
});

test('generateDevelopmentalSummary: concerns are listed with learner, domain, status', () => {
  const analysis = analyzeObservations([
    { learnerName: 'Ayanda', domain: 'Fine Motor', developmentalStatus: 'Not Yet', notes: null },
  ]);
  const summary = generateDevelopmentalSummary(analysis);

  assert(summary.includes('Ayanda'), 'mentions learner name');
  assert(summary.includes('Fine Motor'), 'mentions domain');
  assert(summary.includes('Not Yet'), 'mentions status');
});

test('generateDevelopmentalSummary: concern notes are appended when present', () => {
  const analysis = analyzeObservations([
    {
      learnerName: 'Ayanda',
      domain: 'Fine Motor',
      developmentalStatus: 'Not Yet',
      notes: 'Struggles with pencil grip.',
    },
  ]);
  const summary = generateDevelopmentalSummary(analysis);

  assert(summary.includes('Struggles with pencil grip.'), 'includes the notes text');
});

test('generateDevelopmentalSummary: never contains a percent sign (no numeric framing)', () => {
  const analysis = analyzeObservations([
    { learnerName: 'Sipho', domain: 'Oral Language', developmentalStatus: 'Achieved', notes: null },
    { learnerName: 'Ayanda', domain: 'Fine Motor', developmentalStatus: 'Not Yet', notes: null },
  ]);
  const summary = generateDevelopmentalSummary(analysis);

  assert(!summary.includes('%'), 'summary contains no percentage framing');
});

// ─────────────────────────────────────────────────────────────

const total = passed + failed;
console.log('\n─────────────────────────────────');
if (failed === 0) {
  console.log(`✅ observationAnalysisService tests passed (${passed}/${total})`);
} else {
  console.error(`❌ observationAnalysisService tests FAILED (${passed}/${total} passed, ${failed} failed)`);
}
console.log('─────────────────────────────────\n');

process.exit(failed === 0 ? 0 : 1);
