// tests/mentalMathsService.test.js
'use strict';

const {
  STRANDS,
  MIN_GRADE,
  MAX_GRADE,
  isSupportedGrade,
  generateMentalMathsSet,
  _internal,
} = require('../services/mentalMathsService');
const { generateQuestion, GENERATORS, mulberry32 } = _internal;

let passed = 0;
let failed = 0;

function ok(label, condition) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.log(`  ❌ ${label}`);
  }
}

function evalPrompt(strand, prompt, grade) {
  // Independently re-derive the correct answer for prompts we can parse
  // with plain arithmetic, so we're not just checking the service against
  // itself for addSub/mulDiv/squareRoot.
  if (strand === 'addSub') {
    const m = prompt.match(/^(-?\d+) ([+-]) (-?\d+)$/);
    const a = parseInt(m[1], 10), b = parseInt(m[3], 10);
    return m[2] === '+' ? a + b : a - b;
  }
  if (strand === 'mulDiv') {
    const mMul = prompt.match(/^(\d+) × (\d+)$/);
    if (mMul) return parseInt(mMul[1], 10) * parseInt(mMul[2], 10);
    const mDiv = prompt.match(/^(\d+) ÷ (\d+)$/);
    return parseInt(mDiv[1], 10) / parseInt(mDiv[2], 10);
  }
  if (strand === 'squareRoot') {
    let m = prompt.match(/^√(\d+)$/);
    if (m) return Math.sqrt(parseInt(m[1], 10));
    m = prompt.match(/^(\d+)²$/);
    if (m) return parseInt(m[1], 10) ** 2;
    m = prompt.match(/^∛(\d+)$/);
    if (m) return Math.cbrt(parseInt(m[1], 10));
    m = prompt.match(/^(\d+)³$/);
    if (m) return parseInt(m[1], 10) ** 3;
  }
  return undefined;
}

console.log('\n── Mental Maths Service: strand-level arithmetic correctness ──\n');

for (const grade of [7, 8, 9]) {
  const rand = mulberry32(12345 + grade);
  for (const strand of ['addSub', 'mulDiv', 'squareRoot']) {
    for (let i = 0; i < 10; i++) {
      const q = generateQuestion(rand, grade, strand);
      const independent = evalPrompt(strand, q.prompt, grade);
      ok(
        `Grade ${grade} ${strand} #${i}: "${q.prompt}" = ${q.canonicalAnswer} (independently verified)`,
        Math.abs(independent - q.canonicalAnswer) < 1e-9
      );
    }
  }
}

console.log('\n── Mental Maths Service: mulDiv always divides exactly ──\n');
{
  const rand = mulberry32(999);
  for (let i = 0; i < 30; i++) {
    const q = generateQuestion(rand, 8, 'mulDiv');
    if (q.prompt.includes('÷')) {
      ok(`Division #${i} "${q.prompt}" = ${q.canonicalAnswer} is an exact integer`, Number.isInteger(q.canonicalAnswer));
    }
  }
}

console.log('\n── Mental Maths Service: fracDecPercent canonical mapping ──\n');
{
  const rand = mulberry32(42);
  for (let i = 0; i < 15; i++) {
    const q = generateQuestion(rand, 7, 'fracDecPercent');
    ok(`fracDecPercent #${i} "${q.prompt}" has non-null canonicalAnswer`, q.canonicalAnswer !== null && q.canonicalAnswer !== undefined);
    if (q.prompt.includes('percentage')) {
      ok(`fracDecPercent #${i} percentage answer ends with "%"`, typeof q.canonicalAnswer === 'string' && q.canonicalAnswer.endsWith('%'));
    } else {
      ok(`fracDecPercent #${i} decimal answer is a number`, typeof q.canonicalAnswer === 'number');
    }
  }
}

console.log('\n── Mental Maths Service: roundEstimate rounds to the stated magnitude ──\n');
{
  const rand = mulberry32(77);
  for (let i = 0; i < 15; i++) {
    const q = generateQuestion(rand, 9, 'roundEstimate');
    const m = q.prompt.match(/Round (\d+) to the nearest (\d+)/);
    const number = parseInt(m[1], 10);
    const magnitude = parseInt(m[2], 10);
    const expected = Math.round(number / magnitude) * magnitude;
    ok(`roundEstimate #${i} "${q.prompt}" = ${q.canonicalAnswer}`, q.canonicalAnswer === expected);
    ok(`roundEstimate #${i} result is a multiple of ${magnitude}`, q.canonicalAnswer % magnitude === 0);
  }
}

console.log('\n── Mental Maths Service: ratioRate divides evenly ──\n');
{
  const rand = mulberry32(555);
  for (let i = 0; i < 15; i++) {
    const q = generateQuestion(rand, 7, 'ratioRate');
    const mTotal = q.prompt.match(/Share (\d+) sweets/);
    const mParts = q.prompt.match(/among (\d+) learners/);
    const total = parseInt(mTotal[1], 10);
    const parts = parseInt(mParts[1], 10);
    ok(`ratioRate #${i} "${q.prompt}" divides evenly`, total % parts === 0);
    ok(`ratioRate #${i} canonicalAnswer matches total/parts`, q.canonicalAnswer === total / parts);
  }
}

console.log('\n── Mental Maths Service: construction guarantees (generateMentalMathsSet) ──\n');
{
  const set7 = generateMentalMathsSet({ grade: 7, count: 12, seed: 1 });
  ok('Grade 7 set returns requested count', set7.questions.length === 12);
  ok('Grade 7 set echoes grade', set7.grade === 7);
  ok('Grade 7 set cycles through all 6 strands within 12 questions', new Set(set7.questions.map(q => q.strand)).size === 6);

  const set9 = generateMentalMathsSet({ grade: 9, count: 18, seed: 2 });
  ok('Grade 9 set returns requested count of 18', set9.questions.length === 18);
  ok('Grade 9 strand cycling is even (first 6 are all distinct strands)', new Set(set9.questions.slice(0, 6).map(q => q.strand)).size === 6);

  ok('Every question has a non-empty prompt string', set7.questions.every(q => typeof q.prompt === 'string' && q.prompt.length > 0));
  ok('Every question has a defined canonicalAnswer', set7.questions.every(q => q.canonicalAnswer !== undefined && q.canonicalAnswer !== null));
  ok('Every question strand is one of the 6 known STRANDS', set7.questions.every(q => STRANDS.includes(q.strand)));
}

console.log('\n── Mental Maths Service: duplicate prevention within a session ──\n');
{
  // A small count relative to strand variety should still avoid exact
  // duplicate prompts within the same generated set.
  const set = generateMentalMathsSet({ grade: 8, count: 24, seed: 7 });
  const prompts = set.questions.map(q => q.prompt);
  const uniquePrompts = new Set(prompts);
  ok(`24-question Grade 8 set has no exact duplicate prompts (${uniquePrompts.size}/${prompts.length} unique)`, uniquePrompts.size === prompts.length);
}

console.log('\n── Mental Maths Service: reproducibility (same seed → same set) ──\n');
{
  const a = generateMentalMathsSet({ grade: 7, count: 12, seed: 4242 });
  const b = generateMentalMathsSet({ grade: 7, count: 12, seed: 4242 });
  ok('Same grade+seed produces identical prompts', JSON.stringify(a.questions.map(q => q.prompt)) === JSON.stringify(b.questions.map(q => q.prompt)));
  ok('Same grade+seed produces identical canonical answers', JSON.stringify(a.questions.map(q => q.canonicalAnswer)) === JSON.stringify(b.questions.map(q => q.canonicalAnswer)));

  const c = generateMentalMathsSet({ grade: 7, count: 12, seed: 4243 });
  ok('Different seed produces a different set (regenerate/RETRY works)', JSON.stringify(a.questions.map(q => q.prompt)) !== JSON.stringify(c.questions.map(q => q.prompt)));
}

console.log('\n── Mental Maths Service: grade-scaled difficulty ──\n');
{
  const rand7 = mulberry32(1);
  const rand9 = mulberry32(1);
  let maxProduct7 = 0, maxProduct9 = 0;
  for (let i = 0; i < 40; i++) {
    const q7 = generateQuestion(rand7, 7, 'mulDiv');
    const q9 = generateQuestion(rand9, 9, 'mulDiv');
    if (q7.prompt.includes('×')) maxProduct7 = Math.max(maxProduct7, q7.canonicalAnswer);
    if (q9.prompt.includes('×')) maxProduct9 = Math.max(maxProduct9, q9.canonicalAnswer);
  }
  ok(`Grade 9 mulDiv range reaches higher products than Grade 7 (7:${maxProduct7} vs 9:${maxProduct9})`, maxProduct9 >= maxProduct7);
}

console.log('\n── Mental Maths Service: presentation-boundary — canonicalAnswer is never string-coerced into prompt text ──\n');
{
  const set = generateMentalMathsSet({ grade: 8, count: 12, seed: 99 });
  ok(
    'No question prompt string leaks its own canonicalAnswer as substring (answers are withheld from prompt text)',
    set.questions.every(q => !String(q.prompt).includes(String(q.canonicalAnswer)))
  );
}

console.log('\n── Mental Maths Service: validation / fallback behavior ──\n');
{
  let threw = false;
  try { generateMentalMathsSet({ grade: 6, count: 12 }); } catch (e) { threw = true; }
  ok('Grade 6 (below range) is rejected', threw);

  threw = false;
  try { generateMentalMathsSet({ grade: 10, count: 12 }); } catch (e) { threw = true; }
  ok('Grade 10 (above range) is rejected', threw);

  threw = false;
  try { generateMentalMathsSet({ grade: 7, count: 0 }); } catch (e) { threw = true; }
  ok('count=0 is rejected', threw);

  threw = false;
  try { generateMentalMathsSet({ grade: 7, count: -3 }); } catch (e) { threw = true; }
  ok('negative count is rejected', threw);

  ok('isSupportedGrade(7) is true', isSupportedGrade(7) === true);
  ok('isSupportedGrade(9) is true', isSupportedGrade(9) === true);
  ok('isSupportedGrade(6) is false', isSupportedGrade(6) === false);
  ok('isSupportedGrade(10) is false', isSupportedGrade(10) === false);
  ok('isSupportedGrade(7.5) is false (non-integer)', isSupportedGrade(7.5) === false);
  ok('MIN_GRADE/MAX_GRADE match documented range', MIN_GRADE === 7 && MAX_GRADE === 9);

  threw = false;
  try { generateQuestion(mulberry32(1), 7, 'notAStrand'); } catch (e) { threw = true; }
  ok('generateQuestion rejects an unknown strand', threw);
}

console.log('\n─────────────────────────────────');
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📊 Total:  ${passed + failed}`);
console.log('─────────────────────────────────\n');

if (failed > 0) {
  process.exitCode = 1;
}
