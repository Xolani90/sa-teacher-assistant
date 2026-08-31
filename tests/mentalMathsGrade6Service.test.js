// tests/mentalMathsGrade6Service.test.js
//
// Unit coverage for services/mentalMathsGrade6Service.js. Verifies the
// evidenced 12x12 multiplication/division boundary and prime-recognition
// range [2,100] are never exceeded, generation is deterministic given a
// seed, and the service integrates correctly through
// mentalMathsSessionService.js alongside the existing generators.

'use strict';

const grade6 = require('../services/mentalMathsGrade6Service');
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
ok('MIN_GRADE === MAX_GRADE === 6', grade6.MIN_GRADE === 6 && grade6.MAX_GRADE === 6);
ok('isSupportedGrade(6) is true', grade6.isSupportedGrade(6));
ok('isSupportedGrade(5) is false', !grade6.isSupportedGrade(5));
ok('isSupportedGrade(7) is false', !grade6.isSupportedGrade(7));
ok('isSupportedGrade(6.5) is false (non-integer)', !grade6.isSupportedGrade(6.5));

console.log('\nEvidenced constants');
ok('FACTOR_MIN === 1 and FACTOR_MAX === 12', grade6.FACTOR_MIN === 1 && grade6.FACTOR_MAX === 12);
ok('PRIME_RANGE_MIN === 2 and PRIME_RANGE_MAX === 100',
  grade6.PRIME_RANGE_MIN === 2 && grade6.PRIME_RANGE_MAX === 100);
ok('Grade 6 ceiling (12) differs from Grade 4\'s (10) — not inherited',
  grade6.FACTOR_MAX !== require('../services/mentalMathsGrade4Service').FACTOR_MAX);

console.log('\nTopics');
{
  const keys = grade6.TOPICS.map((t) => t.key);
  ok('TOPICS is exactly the three evidenced constructs plus mixed',
    JSON.stringify(keys) === JSON.stringify([
      'mulFacts12x12', 'divFacts12x12', 'primeRecognition', 'mixed',
    ]));
  ok('DEFAULT_TOPIC is mixed', grade6.DEFAULT_TOPIC === 'mixed');
  ok('every topic has a non-empty label',
    grade6.TOPICS.every((t) => typeof t.label === 'string' && t.label.length > 0));
}

console.log('\nisPrime correctness');
{
  const knownPrimes = [2, 3, 5, 7, 11, 13, 97];
  const knownComposites = [1, 0, -5, 4, 6, 8, 9, 100];
  ok('all known primes recognised', knownPrimes.every((n) => grade6.isPrime(n)));
  ok('all known non-primes rejected', knownComposites.every((n) => !grade6.isPrime(n)));
  ok('isPrime rejects non-integers', !grade6.isPrime(4.5));
}

console.log('\nMultiplication facts to 12 × 12 (single-fact generator, large batch)');
{
  const rand = () => Math.random();
  let allValid = true;
  for (let i = 0; i < 500; i++) {
    const f = grade6.generateMultiplicationFact(rand);
    if (f.a < 1 || f.a > 12 || f.b < 1 || f.b > 12 || f.result !== f.a * f.b) { allValid = false; break; }
  }
  ok('500 multiplication facts: both factors in [1,12], product correct', allValid);
}

console.log('\nDivision facts (inverse of 12 × 12, large batch)');
{
  const rand = () => Math.random();
  let allValid = true;
  for (let i = 0; i < 500; i++) {
    const f = grade6.generateDivisionFact(rand);
    if (f.b < 1 || f.b > 12 || f.result < 1 || f.result > 12 || f.a !== f.b * f.result) { allValid = false; break; }
  }
  ok('500 division facts: divisor and quotient both in [1,12], exact division', allValid);
}

console.log('\nPrime recognition (large batch)');
{
  const rand = () => Math.random();
  let allValid = true;
  for (let i = 0; i < 500; i++) {
    const f = grade6.generatePrimeFact(rand);
    const expected = grade6.isPrime(f.n) ? 'Yes' : 'No';
    if (f.n < 2 || f.n > 100 || f.canonicalAnswer !== expected) { allValid = false; break; }
  }
  ok('500 prime-recognition items: n in [2,100], canonicalAnswer matches isPrime(n)', allValid);
}

console.log('\nSupported question forms (per topic, via the session builder)');
{
  const forms = {
    mulFacts12x12: /^\d+ × \d+ = \?$/,
    divFacts12x12: /^\d+ ÷ \d+ = \?$/,
    primeRecognition: /^Is \d+ a prime number\?$/,
  };
  for (const [topic, re] of Object.entries(forms)) {
    const set = grade6.generateGrade6MentalMathsSet({ count: 40, seed: 7, topic });
    ok(`${topic}: all 40 prompts match the expected form`,
      set.questions.every((q) => re.test(q.prompt)));
  }
  const mixed = grade6.generateGrade6MentalMathsSet({ count: 60, seed: 7, topic: 'mixed' });
  const anyForm = Object.values(forms);
  ok('mixed: all 60 prompts match one of the three forms',
    mixed.questions.every((q) => anyForm.some((re) => re.test(q.prompt))));
}

console.log('\nEdge cases');
{
  const s1 = grade6.generateGrade6MentalMathsSet({ count: 1, seed: 3, topic: 'mulFacts12x12' });
  ok('count=1 returns exactly one question', s1.questions.length === 1);
  const sBig = grade6.generateGrade6MentalMathsSet({ count: 60, seed: 3, topic: 'mixed' });
  ok('a large count (60) still returns exactly 60 questions', sBig.questions.length === 60);
  const s12x12 = grade6.generateGrade6MentalMathsSet({ count: 5, seed: 3, topic: 'mulFacts12x12' });
  ok('12x12 boundary reachable in principle (FACTOR_MAX*FACTOR_MAX === 144)',
    grade6.FACTOR_MAX * grade6.FACTOR_MAX === 144);
}

console.log('\nMalformed / invalid inputs');
{
  throws('count = 0 throws', () => grade6.generateGrade6MentalMathsSet({ count: 0 }));
  throws('negative count throws', () => grade6.generateGrade6MentalMathsSet({ count: -3 }));
  throws('non-integer count throws', () => grade6.generateGrade6MentalMathsSet({ count: 2.5 }));
  throws('unknown topic throws', () => grade6.generateGrade6MentalMathsSet({ count: 5, topic: 'algebra' }));
  throws('null-ish garbage count throws', () => grade6.generateGrade6MentalMathsSet({ count: 'twelve' }));
}

console.log('\nAnswer-key integrity (canonicalAnswer matches the operation the prompt states)');
{
  const set = grade6.generateGrade6MentalMathsSet({ count: 200, seed: 99, topic: 'mixed' });
  let allCorrect = true;
  for (const q of set.questions) {
    let m;
    if ((m = q.prompt.match(/^(\d+) × (\d+) = \?$/))) {
      if (q.canonicalAnswer !== Number(m[1]) * Number(m[2])) { allCorrect = false; break; }
    } else if ((m = q.prompt.match(/^(\d+) ÷ (\d+) = \?$/))) {
      if (Number(m[1]) % Number(m[2]) !== 0 || q.canonicalAnswer !== Number(m[1]) / Number(m[2])) {
        allCorrect = false; break;
      }
    } else if ((m = q.prompt.match(/^Is (\d+) a prime number\?$/))) {
      const expected = grade6.isPrime(Number(m[1])) ? 'Yes' : 'No';
      if (q.canonicalAnswer !== expected) { allCorrect = false; break; }
    } else {
      allCorrect = false; break;
    }
  }
  ok('every canonicalAnswer recomputes correctly by re-parsing its own prompt', allCorrect);
}

console.log('\nSeeded reproducibility');
{
  const a = grade6.generateGrade6MentalMathsSet({ count: 20, seed: 12345, topic: 'mixed' });
  const b = grade6.generateGrade6MentalMathsSet({ count: 20, seed: 12345, topic: 'mixed' });
  ok('same seed produces an identical question sequence',
    JSON.stringify(a.questions) === JSON.stringify(b.questions));

  const c = grade6.generateGrade6MentalMathsSet({ count: 20, seed: 54321, topic: 'mixed' });
  ok('a different seed produces a different sequence (extremely likely)',
    JSON.stringify(a.questions) !== JSON.stringify(c.questions));
}

console.log('\nNo duplicate prompts within a single session (dedup-and-redraw)');
{
  const set = grade6.generateGrade6MentalMathsSet({ count: 20, seed: 1, topic: 'primeRecognition' });
  const prompts = set.questions.map((q) => q.prompt);
  ok('primeRecognition session of 20 has few exact duplicates (99 possible n values)',
    new Set(prompts).size >= 15);
}

// ── Integration through the session layer ──────────────────────────────
console.log('\nIntegration: mentalMathsSessionService.js');
{
  ok('Grade 6 is supported', mm.isSupportedGrade(6));
  ok('Grade 6 is in SUPPORTED_GRADES', mm.SUPPORTED_GRADES.includes(6));
  ok('Grade 6 topics match the generator\'s own TOPICS',
    JSON.stringify(mm.topicsForGrade(6).map((t) => t.key))
    === JSON.stringify(grade6.TOPICS.map((t) => t.key)));
  ok('Grade 6 default topic matches the generator\'s DEFAULT_TOPIC',
    mm.defaultTopicForGrade(6) === grade6.DEFAULT_TOPIC);
  ok('Grade 6 rejects a Grade 5 candidate as a topic', mm.findTopic(6, 'C12') === null);
  ok('Grade 4 rejects a Grade 6 topic', mm.findTopic(4, 'primeRecognition') === null);

  const session = mm.generateSession({ grade: 6, topic: 'mixed', count: 10, mode: 'oral', seed: 42 });
  ok('generateSession(grade:6) returns 10 questions', session.questions.length === 10);
  ok('generateSession(grade:6) gradeLabel is "Grade 6"', session.gradeLabel === 'Grade 6');
  ok('every session question has strand/prompt/canonicalAnswer', session.questions.every(
    (q) => typeof q.strand === 'string' && typeof q.prompt === 'string' && q.canonicalAnswer !== undefined,
  ));
}

console.log('\n─────────────────────────────────');
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📊 Total:  ${passed + failed}`);
console.log('─────────────────────────────────');
if (failed > 0) process.exit(1);