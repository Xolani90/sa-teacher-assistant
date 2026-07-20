/**
 * tests/observationFlow-followup.test.js
 *
 * Regression test for: MY OBSERVATIONS detail view must surface
 * observationsOfConcern (learner + domain + status + notes) via
 * analyzeObservations(), not just the domain-count summary.
 *
 * Run: node tests/observationFlow-followup.test.js
 * (or via your existing run-all.js auto-discovery)
 */

const assert = require('assert');

let observationFlow;
try {
  observationFlow = require('../flows/observationFlow.js');
} catch (e) {
  console.error('❌ Could not require flows/observationFlow.js:', e.message);
  process.exit(1);
}

const buildObservationDetailMessage =
  observationFlow.buildObservationDetailMessage ||
  (observationFlow.__testExports && observationFlow.__testExports.buildObservationDetailMessage);

if (typeof buildObservationDetailMessage !== 'function') {
  console.error(
    '❌ SETUP NEEDED: buildObservationDetailMessage was not found on ' +
    'flows/observationFlow.js exports or __testExports.\n' +
    '   Run patch-observation-followup.js first.'
  );
  process.exit(1);
}

// Minimal fake gradeLabel — same contract as the real one (grade -> label).
function fakeGradeLabel(grade) {
  return grade === 0 ? 'Grade R' : `Grade ${grade}`;
}

// Fake analyzeObservations mirroring the real service's documented shape:
// { observationsOfConcern: [{ learnerName, domain, status, notes }] }
function fakeAnalyzeObservations(records) {
  const concern = records.filter(
    r => r.developmentalStatus === 'Not Yet' ||
         (r.developmentalStatus === 'Developing' && r.notes)
  );
  return {
    observationsOfConcern: concern.map(r => ({
      learnerName: r.learnerName,
      domain: r.domain,
      status: r.developmentalStatus,
      notes: r.notes,
    })),
  };
}

const assessmentWithConcern = {
  grade: 0,
  subject: 'Life Skills',
  assessmentName: 'Term 2 Play Observation',
  createdAt: '2026-07-20 09:00:00',
  records: [
    {
      learnerName: 'Sipho',
      domain: 'Oral Language',
      developmentalStatus: 'Not Yet',
      notes: 'Struggles to answer in full sentences',
    },
    {
      learnerName: 'Ayanda',
      domain: 'Fine Motor',
      developmentalStatus: 'Developing',
      notes: 'Improving, still needs support with scissors',
    },
    {
      learnerName: 'Zanele',
      domain: 'Fine Motor',
      developmentalStatus: 'Achieved',
      notes: '',
    },
  ],
};

const assessmentAllClear = {
  grade: 0,
  subject: 'Life Skills',
  assessmentName: 'Term 2 Play Observation',
  createdAt: '2026-07-20 09:00:00',
  records: [
    { learnerName: 'Zanele', domain: 'Fine Motor', developmentalStatus: 'Achieved', notes: '' },
  ],
};

let passed = 0;
let failed = 0;

function check(label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${label}`);
    console.log(`    ${e.message}`);
    failed++;
  }
}

console.log('Running observationFlow-followup.test.js\n');

check('includes "Needs follow-up" header when concerns exist', () => {
  const msg = buildObservationDetailMessage(assessmentWithConcern, fakeGradeLabel, fakeAnalyzeObservations);
  assert.ok(msg.includes('Needs follow-up'));
});

check('names the specific learner, domain, and status for a "Not Yet"', () => {
  const msg = buildObservationDetailMessage(assessmentWithConcern, fakeGradeLabel, fakeAnalyzeObservations);
  assert.ok(msg.includes('Sipho'), 'expected learner name "Sipho"');
  assert.ok(msg.includes('Oral Language'), 'expected domain "Oral Language"');
  assert.ok(msg.includes('Not Yet'), 'expected status "Not Yet"');
});

check('includes notes when present', () => {
  const msg = buildObservationDetailMessage(assessmentWithConcern, fakeGradeLabel, fakeAnalyzeObservations);
  assert.ok(msg.includes('Struggles to answer in full sentences'));
});

check('includes "Developing" concerns with notes, not just "Not Yet"', () => {
  const msg = buildObservationDetailMessage(assessmentWithConcern, fakeGradeLabel, fakeAnalyzeObservations);
  assert.ok(msg.includes('Ayanda'), 'expected the Developing-with-notes learner to appear too');
});

check('does not list a clean "Achieved" record as a concern', () => {
  const msg = buildObservationDetailMessage(assessmentWithConcern, fakeGradeLabel, fakeAnalyzeObservations);
  // Scope strictly to the "Needs follow-up" block — the message also has a
  // later "*Records:*" section listing every record (including clean ones,
  // tagged rather than filtered) so a teacher can address one for ADD NOTE
  // / RESOLVE / CORRECT. That later section is expected to include Zanele;
  // only the follow-up block itself must not.
  const afterHeader = msg.split('Needs follow-up:')[1] || '';
  const concernSection = afterHeader.split('*Records:*')[0];
  assert.ok(!concernSection.includes('Zanele'), 'Zanele is Achieved and should not appear in the concern list');
});

check('shows all-clear message when there are no concerns, and no follow-up header', () => {
  const msg = buildObservationDetailMessage(assessmentAllClear, fakeGradeLabel, fakeAnalyzeObservations);
  assert.ok(
    msg.includes('No follow-up needed') || msg.includes('all learners on track'),
    'expected an explicit all-clear message'
  );
  assert.ok(!msg.includes('Needs follow-up'));
});

check('still includes the original domain-count breakdown (no regression)', () => {
  const msg = buildObservationDetailMessage(assessmentWithConcern, fakeGradeLabel, fakeAnalyzeObservations);
  assert.ok(msg.includes('By domain:'));
  assert.ok(msg.includes('Learners: '));
  assert.ok(msg.includes('Records: '));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
