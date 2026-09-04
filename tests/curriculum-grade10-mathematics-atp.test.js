'use strict';
// Regression coverage for the Cycle 35/36/37 Grade 10 Mathematics ATP
// term-mapping defect: CAPS_TOPICS.mathematics[10] previously assigned
// several topics to the wrong term (most concretely, "Euclidean geometry"
// was listed under Term 1 when the authoritative DBE Grade 10 Mathematics
// ATP places it in Term 2), and Term 4 contained topics that don't belong
// to the Grade 10 ATP at all ("Trigonometry"/"Euclidean geometry"/
// "Analytical geometry"/"Statistics"/"Probability" are not Term 4 content
// — the ATP's Term 4 introduces "Measurement" and "Number patterns" and
// otherwise revises prior terms), so resolveCurrentTopic() could silently
// auto-fill a topic that belongs to a different term than the one
// actually in progress.
//
// This exercises the real, public resolution function
// (resolveCurrentTopic()) rather than reading the CAPS_TOPICS constant
// directly, so it protects the actual runtime contract used by
// core/generationPipeline.js, not just the data shape.

const {
  resolveCurrentTopic,
  getTermTopics,
} = require('../services/curriculumIntelligenceService');

let passed = 0;
let failed = 0;
function check(condition, label, extra) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else {
    console.error(`  ❌ FAIL: ${label}${extra !== undefined ? ' -- ' + extra : ''}`);
    failed++;
  }
}

console.log('\n── Grade 10 Mathematics ATP term/topic regression (Cycle 35/36/37) ──\n');

// Authoritative per-term topic sets, verified directly against a
// education.gov.za-hosted DBE Grade 10 Mathematics ATP (Cycle 35/36).
const AUTHORITATIVE_TERM_TOPICS = {
  1: ['Algebraic expressions', 'Exponents', 'Equations & inequalities', 'Trigonometry'],
  2: ['Euclidean geometry', 'Analytical geometry', 'Functions'],
  3: ['Trigonometry', 'Statistics', 'Probability', 'Finance & growth'],
  4: ['Measurement', 'Number patterns'],
};

// getTermTopics() itself must return exactly the authoritative set for
// each term — no extra topics, no missing topics, no cross-term leakage.
for (const term of [1, 2, 3, 4]) {
  const actual = getTermTopics(10, 'mathematics', term);
  const expected = AUTHORITATIVE_TERM_TOPICS[term];
  check(
    JSON.stringify(actual) === JSON.stringify(expected),
    `Term ${term}: getTermTopics(10,'mathematics',${term}) returns exactly the authoritative topic set`,
    JSON.stringify({ actual, expected })
  );
}

// Representative dates inside each real 2026 school term (per
// SA_SCHOOL_CALENDAR[2026]) must never resolve to a topic belonging to
// a DIFFERENT term's authoritative set.
const REPRESENTATIVE_DATES = {
  1: ['2026-01-14', '2026-02-11', '2026-03-11'],
  2: ['2026-04-08', '2026-05-06', '2026-06-10'],
  3: ['2026-07-20', '2026-08-03', '2026-08-24'],
  4: ['2026-10-06', '2026-10-20', '2026-11-02'],
};

// Note: "Trigonometry" legitimately appears in BOTH the authoritative
// Term 1 and Term 3 sets (the ATP teaches it in both terms), so the
// cross-term check below only flags a topic as wrong when it belongs
// EXCLUSIVELY to a different term than the one resolved.
for (const [term, dates] of Object.entries(REPRESENTATIVE_DATES)) {
  const termNum = Number(term);
  const ownTopics = new Set(AUTHORITATIVE_TERM_TOPICS[termNum]);

  for (const iso of dates) {
    const resolved = resolveCurrentTopic(10, 'mathematics', new Date(`${iso}T09:00:00`));
    check(
      !!resolved && ownTopics.has(resolved.topic),
      `${iso} (real Term ${termNum} window): resolveCurrentTopic() returns a Term ${termNum} topic`,
      JSON.stringify(resolved)
    );
  }
}

// The originally demonstrated defect, pinned exactly: 2026-02-25 sits in
// the real Term 1 window, and "Euclidean geometry" is a Term 2 topic —
// it must never be returned for this date.
{
  const resolved = resolveCurrentTopic(10, 'mathematics', new Date('2026-02-25T09:00:00'));
  check(
    !!resolved && resolved.topic !== 'Euclidean geometry',
    '2026-02-25: Grade 10 Mathematics does NOT resolve to "Euclidean geometry" (the original Cycle 35 defect)',
    JSON.stringify(resolved)
  );
  check(
    !!resolved && resolved.term === 1,
    '2026-02-25: resolves within Term 1 as expected',
    JSON.stringify(resolved)
  );
}

// Term 4 regression: none of the old (unsupported) Term 4 topics may
// ever be returned again for any Term 4 date.
{
  const OLD_UNSUPPORTED_TERM4 = ['Trigonometry', 'Euclidean geometry', 'Analytical geometry', 'Statistics', 'Probability'];
  const term4Dates = ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27', '2026-11-02'];
  for (const iso of term4Dates) {
    const resolved = resolveCurrentTopic(10, 'mathematics', new Date(`${iso}T09:00:00`));
    check(
      !!resolved && !OLD_UNSUPPORTED_TERM4.includes(resolved.topic) && ['Measurement', 'Number patterns'].includes(resolved.topic),
      `${iso}: Term 4 resolves only within {Measurement, Number patterns}, not the old unsupported topic set`,
      JSON.stringify(resolved)
    );
  }
}

// Grade isolation: Grades 8, 9, 11, 12 must be entirely unaffected by
// the Grade 10 correction.
{
  const g8t2 = getTermTopics(8, 'mathematics', 2);
  check(
    JSON.stringify(g8t2) === JSON.stringify(['Exponents', 'Algebraic expressions', 'Algebraic equations', 'Functions and relationships', 'Graphs']),
    'Grade 8 Term 2 taxonomy is unchanged by the Grade 10 correction',
    JSON.stringify(g8t2)
  );

  const g9t3 = getTermTopics(9, 'mathematics', 3);
  check(
    JSON.stringify(g9t3) === JSON.stringify(['Geometry of 2D shapes', 'Area and perimeter', 'Data handling', 'Probability']),
    'Grade 9 Term 3 taxonomy is unchanged by the Grade 10 correction',
    JSON.stringify(g9t3)
  );

  // Note: Grade 11's Term 1 taxonomy was itself corrected in Cycle 39
  // (a separate defect/fix). This assertion is updated only to reflect
  // that corrected value, so this file continues to prove Grade 10's
  // change didn't touch Grade 11 — not to re-verify Grade 11's own fix
  // (see curriculum-grade11-mathematics-atp.test.js for that).
  const g11t1 = getTermTopics(11, 'mathematics', 1);
  check(
    JSON.stringify(g11t1) === JSON.stringify(['Exponents & surds', 'Equations & inequalities', 'Trigonometry']),
    'Grade 11 Term 1 taxonomy is unchanged by the Grade 10 correction',
    JSON.stringify(g11t1)
  );

  const g12t1 = getTermTopics(12, 'mathematics', 1);
  check(
    JSON.stringify(g12t1) === JSON.stringify(['Patterns, sequences & series', 'Functions', 'Trigonometry']),
    'Grade 12 Term 1 taxonomy is unchanged by the Grade 10 correction',
    JSON.stringify(g12t1)
  );
}

console.log(`\nGrade 10 Mathematics ATP Regression Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
