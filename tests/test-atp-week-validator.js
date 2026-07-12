'use strict';
/**
 * test-atp-week-validator.js — ATP week-range safety-net test suite
 *
 * Covers:
 *  1.  Valid sequential, non-overlapping week ranges pass
 *  2.  Repeated week number across two rows (e.g. "4-5" then "5-6") is caught
 *  3.  Single-week repeat (e.g. "7" then "7-8") is caught
 *  4.  Out-of-order rows (start before previous row's end) are caught
 *  5.  End-before-start on a single row is caught
 *  6.  Week numbers reset correctly across TERM boundaries (Term 2 starting
 *      at 11 is not a false-positive overlap with Term 1)
 *  7.  Non-table content (prose, headers, separator rows) is ignored, not
 *      mistaken for week cells
 *  8.  Header row ("| Week | Topic / Content | Assessment |") is skipped,
 *      not misparsed as a week cell
 *  9.  Empty / non-string input doesn't throw and reports valid
 *  10. Real-world regression: the exact overlapping content pattern found
 *      in production (Week 4 and Week 27 both double-claimed)
 */
const assert = require('assert');
const { validateAtpWeeks } = require('../utils/atpWeekValidator');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`         ${e.message}`);
    failed++;
  }
}

// ── 1. Valid sequential ranges ─────────────────────────────────────────────
console.log('\n📋  1. Valid sequential, non-overlapping week ranges');
test('clean single-term table is valid with no issues', () => {
  const content = `
*TERM 1 (Weeks 1-10)*
| Week | Topic / Content | Assessment |
| 1-2 | Whole Numbers | |
| 3-4 | Integers | |
| 5 | Exponents | |
| 6-7 | Patterns | |
| 8 | Functions | |
| 9-10 | Fractions | |
`;
  const result = validateAtpWeeks(content);
  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(result.issues, []);
});

// ── 2. Repeated week across two rows ────────────────────────────────────────
console.log('\n📋  2. Repeated week number across two rows');
test('"4-5" followed by "5-6" is flagged as invalid', () => {
  const content = `
*TERM 1 (Weeks 1-10)*
| Week | Topic / Content | Assessment |
| 1-2 | Whole Numbers | |
| 3-4 | Integers | |
| 4-5 | Exponents | |
| 5-6 | Patterns | |
`;
  const result = validateAtpWeeks(content);
  assert.strictEqual(result.valid, false);
  assert.ok(result.issues.some(i => i.includes('Week 4')), 'expected an issue mentioning Week 4');
  assert.ok(result.issues.some(i => i.includes('Week 5')), 'expected an issue mentioning Week 5');
});

// ── 3. Single-week repeat ───────────────────────────────────────────────────
console.log('\n📋  3. Single-week repeat');
test('"7" followed by "7-8" is flagged', () => {
  const content = `
*TERM 3 (Weeks 21-30)*
| Week | Topic / Content | Assessment |
| 21-22 | Algebra | |
| 23 | Equations | |
| 7-8 | Nonsense row for test | |
`;
  // Note: week numbers here are per-term-local, not global — this row uses
  // small numbers on purpose to test a same-term repeat against week 23's
  // range not being touched; adjust to a real overlap:
  const overlapContent = `
*TERM 3 (Weeks 21-30)*
| Week | Topic / Content | Assessment |
| 21-22 | Algebra | |
| 23 | Equations | |
| 23-24 | 3D Geometry | |
`;
  const result = validateAtpWeeks(overlapContent);
  assert.strictEqual(result.valid, false);
  assert.ok(result.issues.some(i => i.includes('Week 23')), 'expected an issue mentioning Week 23');
});

// ── 4. Out-of-order rows ────────────────────────────────────────────────────
console.log('\n📋  4. Out-of-order rows (non-repeating but backwards)');
test('a row starting before the previous row ended is flagged', () => {
  const content = `
*TERM 2 (Weeks 11-20)*
| Week | Topic / Content | Assessment |
| 11-14 | Decimals | |
| 12-13 | Percentages | |
`;
  const result = validateAtpWeeks(content);
  assert.strictEqual(result.valid, false);
  assert.ok(result.issues.length > 0);
});

// ── 5. End before start on a single row ─────────────────────────────────────
console.log('\n📋  5. End-before-start on a single row');
test('a row like "9-5" (end before start) is flagged', () => {
  const content = `
*TERM 1 (Weeks 1-10)*
| Week | Topic / Content | Assessment |
| 9-5 | Malformed row | |
`;
  const result = validateAtpWeeks(content);
  assert.strictEqual(result.valid, false);
  assert.ok(result.issues.some(i => i.includes('end week before start week')));
});

// ── 6. Term boundaries reset week tracking ──────────────────────────────────
console.log('\n📋  6. Week numbers reset across TERM boundaries');
test('Term 2 starting at week 11 is not a false-positive vs Term 1', () => {
  const content = `
*TERM 1 (Weeks 1-10)*
| Week | Topic / Content | Assessment |
| 1-5 | Whole Numbers | |
| 6-10 | Integers | |

*TERM 2 (Weeks 11-20)*
| Week | Topic / Content | Assessment |
| 11-15 | Decimals | |
| 16-20 | Percentages | |
`;
  const result = validateAtpWeeks(content);
  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(result.issues, []);
});

// ── 7. Non-table content is ignored ─────────────────────────────────────────
console.log('\n📋  7. Non-table content ignored, not misparsed as week cells');
test('prose, bold headers, and separator rows do not trigger false positives', () => {
  const content = `
*ANNUAL TEACHING PLAN 2026*
*Grade 7 Mathematics*

This document covers the full CAPS curriculum for the year.

---

*TERM 1 (Weeks 1-10)*
| Week | Topic / Content | Assessment |
|---|---|---|
| 1-2 | Whole Numbers | |
| 3-4 | Integers | |
`;
  const result = validateAtpWeeks(content);
  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(result.issues, []);
});

// ── 8. Header row is skipped ────────────────────────────────────────────────
console.log('\n📋  8. Header row skipped, not misparsed');
test('the literal "Week" header cell does not throw or get treated as week 0', () => {
  const content = `
*TERM 1 (Weeks 1-10)*
| Week | Topic / Content | Assessment |
| 1-2 | Whole Numbers | |
`;
  const result = validateAtpWeeks(content);
  assert.strictEqual(result.valid, true);
});

// ── 9. Empty / non-string input ─────────────────────────────────────────────
console.log('\n📋  9. Empty / non-string input handling');
test('empty string returns valid with no issues', () => {
  const result = validateAtpWeeks('');
  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(result.issues, []);
});
test('null input does not throw and returns valid', () => {
  assert.doesNotThrow(() => validateAtpWeeks(null));
  const result = validateAtpWeeks(null);
  assert.strictEqual(result.valid, true);
});
test('undefined input does not throw and returns valid', () => {
  assert.doesNotThrow(() => validateAtpWeeks(undefined));
});

// ── 10. Real-world regression case ──────────────────────────────────────────
console.log('\n📋  10. Real-world regression — production overlap pattern');
test('reproduces and catches the exact Week 4 / Week 5 and Week 27 overlaps seen in production', () => {
  const content = `
*TERM 1 (Weeks 1-10)*
| Week | Topic / Content | Assessment |
| 1-2 | Whole Numbers | |
| 3-4 | Integers | |
| 4-5 | Exponents | |
| 5-6 | Numeric and Geometric Patterns | |
| 7 | Functions and Relationships | |
| 8-9 | Common Fractions | |
| 10 | Common Fractions (continued) | |

*TERM 3 (Weeks 21-30)*
| Week | Topic / Content | Assessment |
| 21-22 | Algebraic Expressions | |
| 23 | Algebraic Equations | |
| 24-25 | Geometry of 3D Objects | |
| 26-27 | Area and Perimeter of 2D Shapes | |
| 27-28 | Surface Area and Volume | |
| 29-30 | Capacity and Volume | |
`;
  const result = validateAtpWeeks(content);
  assert.strictEqual(result.valid, false);
  assert.ok(result.issues.some(i => i.includes('Term 1') && i.includes('Week 4')));
  assert.ok(result.issues.some(i => i.includes('Term 1') && i.includes('Week 5')));
  assert.ok(result.issues.some(i => i.includes('Term 3') && i.includes('Week 27')));
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`Total: ${passed + failed}  ✅ Passed: ${passed}  ❌ Failed: ${failed}`);
if (failed > 0) process.exit(1);
