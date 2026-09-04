'use strict';
// Regression coverage for the Cycle 32/33 Grade 7 Mathematics ATP
// term-mapping defect: CAPS_TOPICS.mathematics[7] previously assigned
// several topics to the wrong term (most concretely, "Integers" was
// listed under Term 1 when the authoritative 2026/2023-24 DBE Grade 7
// Mathematics ATP places it in Term 2), so resolveCurrentTopic() could
// silently auto-fill a topic that belongs to a different term than the
// one actually in progress.
//
// This exercises the real, public resolution function
// (resolveCurrentTopic()) rather than reading the CAPS_TOPICS constant
// directly, so it protects the actual runtime contract used by
// core/generationPipeline.js, not just the data shape.
//
// NOTE: "Geometric constructions" is used below (not the ATP's literal
// "Construction of geometric figures") because it's the same real ATP
// topic under the repository's existing naming, which
// tests/rc1-lessonplan-dispatch.test.js and
// tests/feature2-lessonplan-homework-e2e-journey.test.js already pin as
// the resolved topic for Grade 7 Mathematics on 2026-08-05.

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

console.log('\n── Grade 7 Mathematics ATP term/topic regression (Cycle 32/33) ──\n');

// Authoritative per-term topic sets, verified directly against
// education.gov.za-hosted DBE Grade 7 Mathematics ATP content (Cycle 32).
const AUTHORITATIVE_TERM_TOPICS = {
  1: ['Whole numbers', 'Common fractions', 'Decimal fractions'],
  2: ['Exponents', 'Integers', 'Numeric and geometric patterns', 'Functions and relationships'],
  3: ['Geometric constructions', 'Geometry of straight lines', 'Geometry of 2D shapes', 'Transformation geometry'],
  4: ['Area and perimeter of 2D shapes', 'Surface area and volume of 3D objects', 'Data handling'],
};

// getTermTopics() itself must return exactly the authoritative set for
// each term — no extra topics, no missing topics, no cross-term leakage.
for (const term of [1, 2, 3, 4]) {
  const actual = getTermTopics(7, 'mathematics', term);
  const expected = AUTHORITATIVE_TERM_TOPICS[term];
  check(
    JSON.stringify(actual) === JSON.stringify(expected),
    `Term ${term}: getTermTopics(7,'mathematics',${term}) returns exactly the authoritative topic set`,
    JSON.stringify({ actual, expected })
  );
}

// Representative dates inside each real 2026 school term (per
// SA_SCHOOL_CALENDAR[2026]) must never resolve to a topic belonging to
// a DIFFERENT term's authoritative set.
const REPRESENTATIVE_DATES = {
  1: ['2026-01-20', '2026-02-15', '2026-03-10'],
  2: ['2026-04-10', '2026-05-01', '2026-06-01'],
  3: ['2026-07-01', '2026-07-25', '2026-08-15'],
  4: ['2026-10-06', '2026-10-20', '2026-11-01'],
};

for (const [term, dates] of Object.entries(REPRESENTATIVE_DATES)) {
  const termNum = Number(term);
  const ownTopics = new Set(AUTHORITATIVE_TERM_TOPICS[termNum]);
  const otherTopics = new Set(
    Object.entries(AUTHORITATIVE_TERM_TOPICS)
      .filter(([t]) => Number(t) !== termNum)
      .flatMap(([, topics]) => topics)
  );

  for (const iso of dates) {
    const resolved = resolveCurrentTopic(7, 'mathematics', new Date(`${iso}T09:00:00`));
    check(
      !!resolved && ownTopics.has(resolved.topic) && !otherTopics.has(resolved.topic),
      `${iso} (real Term ${termNum} window): resolveCurrentTopic() returns a Term ${termNum} topic, not a topic from another term`,
      JSON.stringify(resolved)
    );
  }
}

// The originally demonstrated defect, pinned exactly: 2026-02-01 sits in
// the real Term 1 window, and "Integers" is a Term 2 topic — it must
// never be returned for this date.
{
  const resolved = resolveCurrentTopic(7, 'mathematics', new Date('2026-02-01T09:00:00'));
  check(
    !!resolved && resolved.topic !== 'Integers',
    '2026-02-01: Grade 7 Mathematics does NOT resolve to "Integers" (the original Cycle 32 defect)',
    JSON.stringify(resolved)
  );
  check(
    !!resolved && resolved.term === 1,
    '2026-02-01: resolves within Term 1 as expected',
    JSON.stringify(resolved)
  );
}

// Pin the pre-existing cross-suite dependency explicitly here too, so a
// future edit to CAPS_TOPICS.mathematics[7][3] ordering fails fast in
// this focused suite instead of only in the e2e journeys.
{
  const resolved = resolveCurrentTopic(7, 'mathematics', new Date('2026-08-05T09:00:00'));
  check(
    !!resolved && resolved.topic === 'Geometric constructions',
    '2026-08-05: resolves to "Geometric constructions" (matches tests/rc1-lessonplan-dispatch.test.js and tests/feature2-lessonplan-homework-e2e-journey.test.js)',
    JSON.stringify(resolved)
  );
}

console.log(`\nGrade 7 Mathematics ATP Regression Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
