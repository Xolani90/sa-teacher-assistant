'use strict';
// Regression coverage for a handleCurriculumQuery() defect in
// services/curriculumIntelligenceService.js, downstream of (and distinct
// from) the already-fixed getCurrentATPWeek() December/January boundary
// defects.
//
// For a teacher WITH a grade/subject profile, handleCurriculumQuery() used
// to re-derive the "term to report on" outside term time as
// `atpInfo.nextTerm - 1`, instead of trusting the term getCurrentATPWeek()
// had already resolved. That re-derivation is wrong whenever nextTerm is 1
// — which is exactly the December (just after Term 4 ends) and January
// (just before Term 1 starts) year-boundary cases, since nextTerm always
// points at "next year's Term 1" there:
//
//   nextTerm - 1 === 1 - 1 === 0
//
// Term 0 doesn't exist in CAPS_TOPICS, so getTermTopics() always returned
// an empty list, and handleCurriculumQuery() then told the teacher:
//   "I don't have detailed CAPS topic reference data for this grade and
//    subject yet"
// — a false statement for e.g. Grade 7 Mathematics, which has full CAPS
// reference data — instead of showing Term 4's completed coverage
// (December) or Term 1's upcoming topics (January).
//
// This exercises the real, exported handleCurriculumQuery() directly with
// a profile set, freezing "now" to each boundary date, so it protects the
// actual runtime contract.

const { handleCurriculumQuery } = require('../services/curriculumIntelligenceService');

let passed = 0;
let failed = 0;
function check(condition, label, extra) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else {
    console.error(`  ❌ FAIL: ${label}${extra !== undefined ? ' -- ' + extra : ''}`);
    failed++;
  }
}

function withFrozenDate(y, m, d, fn) {
  const RealDate = global.Date;
  class FrozenDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) return new RealDate(y, m, d);
      return new RealDate(...args);
    }
    static now() { return new RealDate(y, m, d).getTime(); }
  }
  global.Date = FrozenDate;
  try {
    return fn();
  } finally {
    global.Date = RealDate;
  }
}

console.log('\n── handleCurriculumQuery() year-boundary term-resolution regression ──\n');

const profile = { grade: 7, subject: 'mathematics' };

// December: just after Term 4 ends. Should report on Term 4's coverage,
// not silently claim "no reference data".
const decMessage = withFrozenDate(2026, 11, 20, () =>
  handleCurriculumQuery('how much have I covered', profile)
);
check(
  !/no detailed CAPS topic reference data/i.test(decMessage),
  'December: does NOT falsely claim no CAPS reference data exists',
  decMessage
);
check(/Term 4/.test(decMessage), 'December: correctly reports on Term 4', decMessage);
check(/Coverage:/.test(decMessage), 'December: renders an actual coverage dashboard', decMessage);

// January: just before Term 1 starts. Should show Term 1's upcoming
// topics, not silently claim "no reference data".
const janMessage = withFrozenDate(2026, 0, 5, () =>
  handleCurriculumQuery('what topics should I cover', profile)
);
check(
  !/no detailed CAPS topic reference data/i.test(janMessage),
  'January: does NOT falsely claim no CAPS reference data exists',
  janMessage
);
check(/Term 1/.test(janMessage), 'January: correctly reports on the upcoming Term 1', janMessage);
check(/Whole numbers/.test(janMessage), 'January: shows Term 1\'s real first topic as the focus', janMessage);

// Regression guard: an ordinary between-term holiday (e.g. April, between
// Term 1 and Term 2) must be unaffected by this fix.
const aprMessage = withFrozenDate(2026, 3, 1, () =>
  handleCurriculumQuery('how much have I covered', profile)
);
check(
  !/no detailed CAPS topic reference data/i.test(aprMessage),
  'April (ordinary between-term holiday): unaffected regression guard',
  aprMessage
);
check(/Term 1/.test(aprMessage), 'April: still correctly reports on the just-completed Term 1', aprMessage);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
