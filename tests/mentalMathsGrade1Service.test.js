// tests/mentalMathsGrade1Service.test.js
//
// Unit coverage for services/mentalMathsGrade1Service.js. Verifies the
// evidenced boundary (facts to 10) is never exceeded, generation is
// deterministic given a seed, and the service integrates correctly
// through mentalMathsSessionService.js alongside the existing Grade 5
// and Senior Phase generators.

'use strict';

const grade1 = require('../services/mentalMathsGrade1Service');
const mm = require('../services/mentalMathsSessionService');

let passed = 0, failed = 0;
function ok(label, condition) {
  if (condition) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}`); }
}
function throws(label, fn) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  ok(label, threw);
}

console.log('Grade range');
ok('MIN_GRADE === MAX_GRADE === 1', grade1.MIN_GRADE === 1 && grade1.MAX_GRADE === 1);
ok('isSupportedGrade(1) is true', grade1.isSupportedGrade(1));
ok('isSupportedGrade(2) is false', !grade1.isSupportedGrade(2));
ok('isSupportedGrade(0) is false (Grade R)', !grade1.isSupportedGrade(0));
ok('isSupportedGrade(1.5) is false (non-integer)', !grade1.isSupportedGrade(1.5));

console.log('\nFACT_LIMIT boundary — the evidenced range, never exceeded');
{
  let sawSumEqualTo10 = false;
  let sawMinuendEqualTo10 = false;
  for (let seed = 0; seed < 500; seed++) {
    const rand = (() => {
      let a = seed >>> 0;
      return () => {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    })();
    const add = grade1.generateAdditionFact(rand);
    if (add.result > 10) { failed++; console.log(`  ❌ addition sum exceeded 10: ${add.prompt}`); }
    if (add.a < 0 || add.b < 0) { failed++; console.log(`  ❌ addition operand negative: ${add.prompt}`); }
    if (add.result === 10) sawSumEqualTo10 = true;

    const sub = grade1.generateSubtractionFact(rand);
    if (sub.a > 10) { failed++; console.log(`  ❌ subtraction minuend exceeded 10: ${sub.prompt}`); }
    if (sub.result < 0) { failed++; console.log(`  ❌ subtraction result negative: ${sub.prompt}`); }
    if (sub.b > sub.a) { failed++; console.log(`  ❌ subtraction subtrahend exceeded minuend: ${sub.prompt}`); }
    if (sub.a === 10) sawMinuendEqualTo10 = true;
  }
  ok('500 addition facts: no sum > 10, no negative operand', true);
  ok('500 subtraction facts: no minuend > 10, no negative result, b <= a', true);
  ok('sum of exactly 10 is reachable (boundary is inclusive)', sawSumEqualTo10);
  ok('minuend of exactly 10 is reachable (boundary is inclusive)', sawMinuendEqualTo10);
}

console.log('\nSession generation');
{
  const session = grade1.generateGrade1MentalMathsSet({ count: 12, seed: 42 });
  ok('grade is 1', session.grade === 1);
  ok('generates the requested count', session.questions.length === 12);
  ok('every question has a prompt and canonicalAnswer', session.questions.every((q) => typeof q.prompt === 'string' && typeof q.canonicalAnswer === 'number'));
  ok('every question strand is addFacts10 or subFacts10', session.questions.every((q) => q.strand === 'addFacts10' || q.strand === 'subFacts10'));

  // Independent re-derivation: parse the prompt string itself and recompute
  // the answer, rather than trusting the generator's own internal value.
  const allCorrect = session.questions.every((q) => {
    const addMatch = q.prompt.match(/^(\d+) \+ (\d+) = \?$/);
    if (addMatch) return Number(addMatch[1]) + Number(addMatch[2]) === q.canonicalAnswer;
    const subMatch = q.prompt.match(/^(\d+) - (\d+) = \?$/);
    if (subMatch) return Number(subMatch[1]) - Number(subMatch[2]) === q.canonicalAnswer;
    return false;
  });
  ok('canonicalAnswer matches independent re-parse of every prompt', allCorrect);
}

console.log('\nDeterminism / reproducibility');
{
  const s1 = grade1.generateGrade1MentalMathsSet({ count: 10, seed: 7 });
  const s2 = grade1.generateGrade1MentalMathsSet({ count: 10, seed: 7 });
  ok('same seed produces identical sequence', JSON.stringify(s1) === JSON.stringify(s2));
}

console.log('\nTopic scoping');
{
  const addOnly = grade1.generateGrade1MentalMathsSet({ count: 10, seed: 3, topic: 'addFacts10' });
  ok('topic addFacts10 generates only addition items', addOnly.questions.every((q) => q.strand === 'addFacts10'));

  const subOnly = grade1.generateGrade1MentalMathsSet({ count: 10, seed: 3, topic: 'subFacts10' });
  ok('topic subFacts10 generates only subtraction items', subOnly.questions.every((q) => q.strand === 'subFacts10'));

  const mixed = grade1.generateGrade1MentalMathsSet({ count: 10, seed: 3, topic: 'mixed' });
  const strands = new Set(mixed.questions.map((q) => q.strand));
  ok('topic mixed generates both strands', strands.has('addFacts10') && strands.has('subFacts10'));
}

console.log('\nValidation');
throws('rejects count 0', () => grade1.generateGrade1MentalMathsSet({ count: 0 }));
throws('rejects negative count', () => grade1.generateGrade1MentalMathsSet({ count: -1 }));
throws('rejects unknown topic', () => grade1.generateGrade1MentalMathsSet({ topic: 'multiplication' }));

console.log('\nNo unauthorized operations — multiplication/division never appear');
{
  const session = grade1.generateGrade1MentalMathsSet({ count: 30, seed: 99 });
  const hasMulDiv = session.questions.some((q) => /[×x÷]/.test(q.prompt));
  ok('no multiplication or division symbol in any generated prompt', !hasMulDiv);
}

console.log('\nIntegration via mentalMathsSessionService');
{
  ok('Grade 1 is in SUPPORTED_GRADES', mm.SUPPORTED_GRADES.includes(1));
  ok('Grade 1 has three topics (add, sub, mixed)', mm.topicsForGrade(1).length === 3);

  const session = mm.generateSession({ grade: 1, seed: 11 });
  ok('generateSession({grade:1}) defaults to mixed topic', session.topic === 'mixed');
  ok('generateSession({grade:1}) returns 12 questions by default', session.questions.length === 12);
  ok('gradeLabel is "Grade 1"', session.gradeLabel === 'Grade 1');

  const explicit = mm.generateSession({ grade: 1, topic: 'addFacts10', count: 5, seed: 11 });
  ok('explicit addFacts10 topic honoured through the session service', explicit.questions.every((q) => q.strand === 'addFacts10'));
  ok('explicit count honoured through the session service', explicit.questions.length === 5);
}

console.log('\nOther grades unaffected by Grade 1 addition');
{
  ok('Grade 2 unaffected by Grade 1 (still supported, its own 20-limit generator)', mm.isSupportedGrade(2));
  ok('Grade 5 still supported', mm.isSupportedGrade(5));
  ok('Grade 7 still supported', mm.isSupportedGrade(7));
  ok('Grade 9 still unsupported', !mm.isSupportedGrade(9));
}

console.log('\n─────────────────────────────────');
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📊 Total:  ${passed + failed}`);
console.log('─────────────────────────────────');

if (failed > 0) process.exit(1);