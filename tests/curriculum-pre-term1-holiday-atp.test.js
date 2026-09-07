'use strict';
// Regression coverage for a second getCurrentATPWeek() boundary defect,
// the mirror image of the December (post-Term-4) one fixed earlier: the
// "between terms" lookahead only checked `date < nextTerm.start`, with no
// corresponding check that the CURRENT term had actually ended
// (`date > termEnd`). That meant a date BEFORE Term 1 even started (e.g.
// 5 January, while Term 1 starts 14 January) still satisfied "before
// Term 2 starts" on the term=1 iteration, so it was wrongly reported as
// "Term 1 holiday, Term 2 starts [in April]" — three months and an entire
// term wrong, and worse than simply unhelpful.
//
// Fixing the guard (adding `date > termEnd`) reintroduces the original
// "unmatched" gap for this window, so a new explicit branch handles
// "date before Term 1 of the year has started" and buildGeneralATPStatus()
// was updated to render a generic "school holiday" (not "Term null
// holiday") when there is no prior term to name.
//
// This exercises the real, exported getCurrentATPWeek() and
// handleCurriculumQuery() functions directly.

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

console.log('\n── Pre-Term-1 (January, before school starts) school-calendar regression ──\n');

// 2026 Term 1 starts 14 January per SA_SCHOOL_CALENDAR.
const earlyJanuary = new Date(2026, 0, 5); // 5 January 2026

const atpInfo = getCurrentATPWeek(earlyJanuary);

check(atpInfo.isInTerm === false, 'isInTerm is false (genuinely before school starts)');
check(atpInfo.schoolHoliday === true, 'schoolHoliday flag is set');
check(atpInfo.term === null, 'term is null — there is no prior term to name yet this year', atpInfo.term);
check(atpInfo.nextTerm === 1, 'nextTerm correctly points at Term 1 (not Term 2)', atpInfo.nextTerm);
check(
  atpInfo.nextTermStart instanceof Date && !Number.isNaN(atpInfo.nextTermStart.getTime()),
  'nextTermStart is a real, valid Date'
);
check(
  atpInfo.nextTermStart && atpInfo.nextTermStart.getMonth() === 0 && atpInfo.nextTermStart.getDate() === 14,
  'nextTermStart is the real Term 1 start date (14 January), not Term 2\'s (the old bug)',
  atpInfo.nextTermStart
);

// The actual production defect was user-visible: a profile-less teacher's
// message in early January said "Term 1 holiday, Term 2 starts [April]".
const RealDate = global.Date;
class FrozenJanuaryDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) return new RealDate(2026, 0, 5);
    return new RealDate(...args);
  }
  static now() { return new RealDate(2026, 0, 5).getTime(); }
}
global.Date = FrozenJanuaryDate;
let message;
try {
  message = handleCurriculumQuery('what should I teach this week', {});
} finally {
  global.Date = RealDate;
}

check(!/Term null/i.test(message), 'message never renders "Term null"');
check(!/Term 1 holiday/i.test(message), 'message does NOT falsely claim Term 1 already happened (the old bug)', message);
check(/school holiday/i.test(message), 'message uses a generic "school holiday" label when no prior term exists');
check(/Term 1 starts/i.test(message), 'message correctly says Term 1 (not Term 2) is what is coming up');
check(/14 January/i.test(message), 'message gives the real Term 1 start date, not a fabricated April date');

// Regression guards: the December (post-Term-4) fix from the prior pass,
// and ordinary in-term / between-terms dates, must be unaffected.
const midDecember = new Date(2026, 11, 20);
const decInfo = getCurrentATPWeek(midDecember);
check(decInfo.term === 4 && decInfo.nextTerm === 1, 'December (post-Term-4) holiday handling is unaffected by this fix');

const midTerm1 = new Date(2026, 2, 15); // 15 Mar 2026 — well inside Term 1
check(getCurrentATPWeek(midTerm1).isInTerm === true, 'mid-Term-1 date is still correctly identified as in-term');

const betweenTerm1And2 = new Date(2026, 2, 30); // 30 Mar 2026 — genuinely after Term 1 ends (27 Feb), before Term 2 (8 Apr)
const between1_2 = getCurrentATPWeek(betweenTerm1And2);
check(
  between1_2.isInTerm === false && between1_2.term === 1 && between1_2.nextTerm === 2,
  'a genuine between-Term-1-and-2 holiday date is still correctly identified'
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
