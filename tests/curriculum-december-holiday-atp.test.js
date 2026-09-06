'use strict';
// Regression coverage for a getCurrentATPWeek() defect: the school-term
// loop in services/curriculumIntelligenceService.js only detects the
// holiday BETWEEN two terms of the same configured year (it checks
// `term < 4` before looking ahead to the next term). A date that falls
// after Term 4 ends — the December summer holidays, which last several
// weeks every year — never matches any term and isn't caught by that
// lookahead either, so the function silently returned its all-null
// default: { term: null, isInTerm: false, nextTerm: undefined, ... }.
//
// That null term/nextTerm then flowed straight into the teacher-facing
// message built by handleCurriculumQuery()'s buildGeneralATPStatus()
// branch (reached whenever the teacher's profile grade isn't set),
// producing a genuinely broken WhatsApp message:
//   "You are currently on *Term null holiday*.
//    Term 1 starts on *soon*."
// every single day of the December break, for any teacher without a
// profile grade.
//
// This exercises the real, exported getCurrentATPWeek() and
// handleCurriculumQuery() functions directly, using a date inside the
// December gap, so it protects the actual runtime contract rather than
// just the SA_SCHOOL_CALENDAR data shape.

const {
  getCurrentATPWeek,
  handleCurriculumQuery,
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

console.log('\n── December (post-Term 4) school-calendar holiday regression ──\n');

// 2026 Term 4 ends Dec 4 (month index 11, day 4) per SA_SCHOOL_CALENDAR.
const midDecember = new Date(2026, 11, 20);

const atpInfo = getCurrentATPWeek(midDecember);

check(atpInfo.term !== null, 'term is not null for a date after Term 4 ends', atpInfo.term);
check(atpInfo.term === 4, 'term correctly identifies the just-ended Term 4', atpInfo.term);
check(atpInfo.isInTerm === false, 'isInTerm is false (genuinely on holiday)');
check(atpInfo.schoolHoliday === true, 'schoolHoliday flag is set');
check(atpInfo.nextTerm === 1, 'nextTerm correctly points at next year\'s Term 1', atpInfo.nextTerm);
check(
  atpInfo.nextTermStart instanceof Date && !Number.isNaN(atpInfo.nextTermStart.getTime()),
  'nextTermStart is a real, valid Date, not undefined'
);
check(
  atpInfo.nextTermStart && atpInfo.nextTermStart.getFullYear() === 2027,
  'nextTermStart correctly rolls over into the following calendar year',
  atpInfo.nextTermStart
);

// The actual production defect was user-visible: a profile-less teacher's
// message during December literally said "Term null holiday".
// handleCurriculumQuery() has no date parameter — it always resolves
// against "now" internally — so freeze "now" to mid-December to exercise
// the same production code path a real December run would take.
const RealDate = global.Date;
class FrozenDecemberDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) return new RealDate(2026, 11, 20);
    return new RealDate(...args);
  }
  static now() { return new RealDate(2026, 11, 20).getTime(); }
}
global.Date = FrozenDecemberDate;
let message;
try {
  message = handleCurriculumQuery('what should I teach this week', {});
} finally {
  global.Date = RealDate;
}

check(!/Term null/i.test(message), 'teacher-facing message never renders "Term null"', message);
check(/Term 4 holiday/i.test(message), 'teacher-facing message correctly names Term 4');
check(!/starts on \*soon\*/i.test(message), 'teacher-facing message gives a real date, not "soon"');
check(/January/i.test(message), 'teacher-facing message names the real next-term start date');

// Regression guard: a mid-term date and an existing (already-correct)
// between-terms date must be unaffected by this fix.
const midTerm3 = new Date(2026, 7, 5); // 5 Aug 2026 — well inside Term 3
const midTermInfo = getCurrentATPWeek(midTerm3);
check(midTermInfo.isInTerm === true, 'mid-term date is still correctly identified as in-term');
check(midTermInfo.term === 3, 'mid-term date still resolves to the correct term', midTermInfo.term);

const betweenTerm1And2 = new Date(2026, 2, 15); // 15 Mar 2026 — inside Term 1, unaffected
const between1_2Info = getCurrentATPWeek(betweenTerm1And2);
check(between1_2Info.isInTerm === true, 'an ordinary in-term date near a term boundary is unaffected');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
