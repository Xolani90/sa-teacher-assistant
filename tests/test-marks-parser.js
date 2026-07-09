'use strict';

/**
 * test-marks-parser.js
 * Tests for utils/marksParser.js
 * No test framework — mirrors the existing project test style.
 */

const { parseMarks, parseTextFormat, parseCsvFormat } = require('../utils/marksParser');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}`);
    failed++;
  }
}

function assertEqual(actual, expected, label) {
  if (actual === expected) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n── ${name} ─────────────────────────────────────`);
}

// ── TEXT FORMAT TESTS ────────────────────────────────────────────────────────

section('Text: basic happy path');
{
  const text = [
    'Thabo 18/30 Q1:5/5 Q2:3/5 Q3:6/10 Q4:4/10',
    'Sipho 22/30 Q1:5/5 Q2:4/5 Q3:8/10 Q4:5/10',
    'Lerato 15/30 Q1:3/5 Q2:2/5 Q3:5/10 Q4:5/10',
  ].join('\n');

  const result = parseTextFormat(text);

  assertEqual(result.errors.length, 0, 'No errors');
  assertEqual(result.learners.length, 3, 'Three learners parsed');
  assertEqual(result.learners[0].learnerName, 'Thabo', 'First learner name');
  assertEqual(result.learners[0].mark, 18, 'First learner mark');
  assertEqual(result.learners[0].totalMarks, 30, 'First learner totalMarks');
  assertEqual(result.learners[0].questionData['1'].mark, 5, 'Q1 mark');
  assertEqual(result.learners[0].questionData['3'].maxMark, 10, 'Q3 maxMark');
  assertEqual(result.totalMark, 30, 'totalMark from first learner');
  assertEqual(result.questionCount, 4, 'Four questions detected');
  assertEqual(result.questionMaxMarks['3'], 10, 'questionMaxMarks Q3 = 10');
}

section('Text: overall mark derived from question totals when not given');
{
  const text = 'Amahle Q1:4/5 Q2:8/10 Q3:3/5';
  const result = parseTextFormat(text);
  assertEqual(result.errors.length, 0, 'No errors');
  assertEqual(result.learners[0].mark, 15, 'Mark derived as sum of Q marks');
  assertEqual(result.learners[0].totalMarks, 20, 'Total derived as sum of Q maxes');
}

section('Text: comment lines and blank lines ignored');
{
  const text = [
    '# Grade 8 Maths Term 2 Test',
    '',
    'Thabo 18/30 Q1:5/5 Q2:3/5 Q3:6/10 Q4:4/10',
    '',
    '# end',
    'Sipho 22/30 Q1:5/5 Q2:4/5 Q3:8/10 Q4:5/10',
  ].join('\n');
  const result = parseTextFormat(text);
  assertEqual(result.learners.length, 2, 'Comments and blank lines ignored');
}

section('Text: mark exceeds total → warning not error');
{
  const text = 'Thabo 35/30 Q1:5/5 Q2:5/5 Q3:15/10 Q4:10/10';
  const result = parseTextFormat(text);
  assertEqual(result.errors.length, 0, 'No hard error');
  assert(result.warnings.length > 0, 'Warning generated for mark > total');
  assertEqual(result.learners.length, 1, 'Learner still included despite warning');
}

section('Text: empty input → error');
{
  const result = parseTextFormat('');
  assert(result.errors.length > 0, 'Error returned for empty input');
  assertEqual(result.learners.length, 0, 'No learners');
}

section('Text: only comment lines → error');
{
  const result = parseTextFormat('# just a comment\n# another comment');
  assert(result.errors.length > 0, 'Error returned for comment-only input');
}

section('Text: line with no valid marks → skipped with warning');
{
  const text = [
    'Thabo 18/30 Q1:5/5 Q2:3/5 Q3:6/10 Q4:4/10',
    'just a note without marks',
    'Sipho 22/30 Q1:5/5 Q2:4/5 Q3:8/10 Q4:5/10',
  ].join('\n');
  const result = parseTextFormat(text);
  assertEqual(result.learners.length, 2, 'Two valid learners parsed, bad line skipped');
  assert(result.warnings.length > 0, 'Warning generated for bad line');
}

section('Text: multi-word learner name');
{
  const text = 'Sipho Ndlovu 22/30 Q1:5/5 Q2:4/5';
  const result = parseTextFormat(text);
  assertEqual(result.learners[0].learnerName, 'Sipho Ndlovu', 'Multi-word name parsed');
}

section('Text: question numbers not starting at 1');
{
  const text = 'Thabo 18/30 Q3:6/10 Q7:8/10 Q12:4/10';
  const result = parseTextFormat(text);
  assert('3' in result.learners[0].questionData, 'Q3 in questionData');
  assert('7' in result.learners[0].questionData, 'Q7 in questionData');
  assert('12' in result.learners[0].questionData, 'Q12 in questionData');
}

// ── CSV FORMAT TESTS ─────────────────────────────────────────────────────────

section('CSV: basic happy path with max marks in header');
{
  const csv = [
    'Name,Total/30,Q1/5,Q2/5,Q3/10,Q4/10',
    'Thabo,18,5,3,6,4',
    'Sipho,22,5,4,8,5',
    'Lerato,15,3,2,5,5',
  ].join('\n');

  const result = parseCsvFormat(csv);
  assertEqual(result.errors.length, 0, 'No errors');
  assertEqual(result.learners.length, 3, 'Three learners parsed');
  assertEqual(result.learners[0].learnerName, 'Thabo', 'First learner name');
  assertEqual(result.learners[0].mark, 18, 'First learner mark');
  assertEqual(result.learners[0].totalMarks, 30, 'First learner totalMarks');
  assertEqual(result.learners[0].questionData['1'].mark, 5, 'Q1 mark for Thabo');
  assertEqual(result.learners[0].questionData['3'].maxMark, 10, 'Q3 maxMark from header');
  assertEqual(result.questionMaxMarks['4'], 10, 'Q4 maxMark parsed from header');
}

section('CSV: Topics row captured and threaded into questionData');
{
  const csv = [
    'Name,Total/30,Q1/5,Q2/5,Q3/10,Q4/10',
    'Topics,,fractions,fractions,algebraic equations,geometry',
    'Thabo,18,5,3,6,4',
  ].join('\n');

  const result = parseCsvFormat(csv);
  assertEqual(result.errors.length, 0, 'No errors');
  assertEqual(result.questionTopics['1'], 'fractions', 'Q1 topic = fractions');
  assertEqual(result.questionTopics['3'], 'algebraic equations', 'Q3 topic');
  assertEqual(result.questionTopics['4'], 'geometry', 'Q4 topic');
  assertEqual(result.learners[0].questionData['3'].topic, 'algebraic equations', 'Topic on learner questionData');
}

section('CSV: no Total column — overall mark derived from question sums');
{
  const csv = [
    'Name,Q1/5,Q2/5,Q3/10',
    'Thabo,5,3,6',
    'Sipho,4,4,8',
  ].join('\n');
  const result = parseCsvFormat(csv);
  assertEqual(result.errors.length, 0, 'No errors');
  assertEqual(result.learners[0].mark, 14, 'Mark derived from Q1+Q2+Q3 for Thabo');
  assertEqual(result.learners[1].mark, 16, 'Mark derived for Sipho');
}

section('CSV: quoted fields with embedded commas');
{
  const csv = [
    'Name,Total/30,Q1/5',
    '"Dlamini, Sipho",22,5',
  ].join('\n');
  const result = parseCsvFormat(csv);
  assertEqual(result.learners[0].learnerName, 'Dlamini, Sipho', 'Quoted name with comma');
  assertEqual(result.learners[0].mark, 22, 'Mark parsed correctly after quoted name');
}

section('CSV: mark > total → warning not error');
{
  const csv = [
    'Name,Total/30,Q1/5',
    'Thabo,35,5',
  ].join('\n');
  const result = parseCsvFormat(csv);
  assertEqual(result.errors.length, 0, 'No hard error');
  assert(result.warnings.length > 0, 'Warning for mark > total');
  assertEqual(result.learners.length, 1, 'Learner still included');
}

section('CSV: missing header → error');
{
  const result = parseCsvFormat('');
  assert(result.errors.length > 0, 'Error for empty CSV');
}

section('CSV: header does not start with Name → error');
{
  const csv = 'Learner,Total\nThabo,18';
  const result = parseCsvFormat(csv);
  assert(result.errors.length > 0, 'Error for non-Name first column');
}

section('CSV: empty learner name rows skipped');
{
  const csv = [
    'Name,Total/30,Q1/5',
    'Thabo,18,5',
    ',15,4',
    'Sipho,22,5',
  ].join('\n');
  const result = parseCsvFormat(csv);
  assertEqual(result.learners.length, 2, 'Empty-name row skipped');
}

section('CSV: Buffer input handled');
{
  const csv = 'Name,Total/30,Q1/5\nThabo,18,5';
  const result = parseCsvFormat(Buffer.from(csv, 'utf8'));
  assertEqual(result.errors.length, 0, 'No errors for Buffer input');
  assertEqual(result.learners[0].mark, 18, 'Mark parsed from Buffer');
}

// ── AUTO-DETECT TESTS ────────────────────────────────────────────────────────

section('Auto-detect: Buffer → CSV path');
{
  const csv = 'Name,Total/30,Q1/5\nThabo,18,5';
  const result = parseMarks(Buffer.from(csv, 'utf8'));
  assertEqual(result.learners[0].mark, 18, 'Buffer auto-detected as CSV');
}

section('Auto-detect: CSV-looking string → CSV path');
{
  const csv = 'Name,Total/30,Q1/5\nThabo,18,5';
  const result = parseMarks(csv, 'auto');
  assertEqual(result.learners[0].mark, 18, 'CSV string auto-detected');
}

section('Auto-detect: text string → text path');
{
  const text = 'Thabo 18/30 Q1:5/5 Q2:3/5';
  const result = parseMarks(text, 'auto');
  assertEqual(result.learners[0].learnerName, 'Thabo', 'Text auto-detected');
}

// ── SUMMARY ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('❌ Some tests failed');
  process.exit(1);
} else {
  console.log('✅ All tests passed');
}
