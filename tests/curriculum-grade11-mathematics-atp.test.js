'use strict';
// Regression coverage for the Cycle 38/39 Grade 11 Mathematics ATP
// term-mapping defect: CAPS_TOPICS.mathematics[11] previously assigned
// several topics to the wrong term (e.g. "Euclidean geometry" and
// "Functions" were listed under Term 1 when the authoritative DBE Grade 11
// Mathematics ATP places them in Term 2; "Equations & inequalities" was
// duplicated into Term 2 when it belongs only to Term 1), and Term 4
// contained a taxonomy ("Trigonometry"/"Euclidean geometry"/"Analytical
// geometry"/"Statistics"/"Probability") that doesn't match the ATP's
// actual Term 4 content at all (Number patterns + revision of
// measurement/Algebra/Trigonometry), so resolveCurrentTopic() could
// silently auto-fill a topic from the wrong term.
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

console.log('\n── Grade 11 Mathematics ATP term/topic regression (Cycle 38/39) ──\n');

// Authoritative per-term topic sets, verified directly against a
// education.gov.za-hosted DBE Grade 11 Mathematics ATP (2023/24) — Cycle 38.
const AUTHORITATIVE_TERM_TOPICS = {
  1: ['Exponents & surds', 'Equations & inequalities', 'Trigonometry'],
  2: ['Euclidean geometry', 'Analytical geometry', 'Functions'],
  3: ['Trigonometry', 'Statistics', 'Probability', 'Finance, growth & decay'],
  4: ['Number patterns', 'Revision of measurement', 'Revision of Algebra', 'Revision of Trigonometry'],
};

// getTermTopics() itself must return exactly the authoritative set for
// each term — no extra topics, no missing topics, no cross-term leakage.
for (const term of [1, 2, 3, 4]) {
  const actual = getTermTopics(11, 'mathematics', term);
  const expected = AUTHORITATIVE_TERM_TOPICS[term];
  check(
    JSON.stringify(actual) === JSON.stringify(expected),
    `Term ${term}: getTermTopics(11,'mathematics',${term}) returns exactly the authoritative topic set`,
    JSON.stringify({ actual, expected })
  );
}

// Representative dates inside each real 2026 school term (per
// SA_SCHOOL_CALENDAR[2026]) must never resolve to a topic belonging
// EXCLUSIVELY to a different term's authoritative set.
// Note: "Trigonometry" legitimately appears in both the authoritative
// Term 1 and Term 3 sets, so it is not treated as exclusive to either.
const REPRESENTATIVE_DATES = {
  1: ['2026-01-16', '2026-02-06'],
  2: ['2026-04-10', '2026-05-01'],
  3: ['2026-07-22', '2026-08-05', '2026-08-24'],
  4: ['2026-10-07', '2026-10-21', '2026-11-25'],
};

for (const [term, dates] of Object.entries(REPRESENTATIVE_DATES)) {
  const termNum = Number(term);
  const ownTopics = new Set(AUTHORITATIVE_TERM_TOPICS[termNum]);

  for (const iso of dates) {
    const resolved = resolveCurrentTopic(11, 'mathematics', new Date(`${iso}T09:00:00`));
    check(
      !!resolved && ownTopics.has(resolved.topic),
      `${iso} (real Term ${termNum} window): resolveCurrentTopic() returns a Term ${termNum} topic`,
      JSON.stringify(resolved)
    );
  }
}

// The originally demonstrated Cycle 38 defects, pinned exactly.
{
  const cases = [
    { iso: '2026-03-25', bad: 'Euclidean geometry', term: 1 },
    { iso: '2026-04-10', bad: 'Equations & inequalities', term: 2 },
    { iso: '2026-06-17', bad: 'Statistics', term: 2 },
    { iso: '2026-07-22', bad: 'Functions', term: 3 },
    { iso: '2026-08-24', bad: 'Euclidean geometry', term: 3 },
  ];
  for (const { iso, bad, term } of cases) {
    const resolved = resolveCurrentTopic(11, 'mathematics', new Date(`${iso}T09:00:00`));
    check(
      !!resolved && resolved.topic !== bad,
      `${iso}: Grade 11 Mathematics does NOT resolve to "${bad}" (the original Cycle 38 defect)`,
      JSON.stringify(resolved)
    );
    check(
      !!resolved && resolved.term === term,
      `${iso}: resolves within Term ${term} as expected`,
      JSON.stringify(resolved)
    );
  }
}

// Term 4 regression: none of the old (fabricated) Term 4 topics may ever
// be returned again for any Term 4 date.
{
  const OLD_UNSUPPORTED_TERM4 = ['Trigonometry', 'Euclidean geometry', 'Analytical geometry', 'Statistics', 'Probability'];
  const term4Dates = ['2026-10-07', '2026-10-14', '2026-10-21', '2026-10-28', '2026-11-04', '2026-11-25'];
  for (const iso of term4Dates) {
    const resolved = resolveCurrentTopic(11, 'mathematics', new Date(`${iso}T09:00:00`));
    check(
      !!resolved && !OLD_UNSUPPORTED_TERM4.includes(resolved.topic) &&
        AUTHORITATIVE_TERM_TOPICS[4].includes(resolved.topic),
      `${iso}: Term 4 resolves only within the corrected topic set, not the old fabricated set`,
      JSON.stringify(resolved)
    );
  }
}

// Grade isolation: Grades 8, 9, 10, 12 must be entirely unaffected by
// the Grade 11 correction.
{
  const g8t2 = getTermTopics(8, 'mathematics', 2);
  check(
    JSON.stringify(g8t2) === JSON.stringify(['Exponents', 'Algebraic expressions', 'Algebraic equations', 'Functions and relationships', 'Graphs']),
    'Grade 8 Term 2 taxonomy is unchanged by the Grade 11 correction',
    JSON.stringify(g8t2)
  );

  const g9t3 = getTermTopics(9, 'mathematics', 3);
  check(
    JSON.stringify(g9t3) === JSON.stringify(['Geometry of 2D shapes', 'Area and perimeter', 'Data handling', 'Probability']),
    'Grade 9 Term 3 taxonomy is unchanged by the Grade 11 correction',
    JSON.stringify(g9t3)
  );

  const g10t1 = getTermTopics(10, 'mathematics', 1);
  check(
    JSON.stringify(g10t1) === JSON.stringify(['Algebraic expressions', 'Exponents', 'Equations & inequalities', 'Trigonometry']),
    'Grade 10 Term 1 taxonomy is unchanged by the Grade 11 correction',
    JSON.stringify(g10t1)
  );

  const g12t1 = getTermTopics(12, 'mathematics', 1);
  check(
    JSON.stringify(g12t1) === JSON.stringify(['Patterns, sequences & series', 'Functions', 'Trigonometry']),
    'Grade 12 Term 1 taxonomy is unchanged by the Grade 11 correction',
    JSON.stringify(g12t1)
  );
}

console.log(`\nGrade 11 Mathematics ATP Regression Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
