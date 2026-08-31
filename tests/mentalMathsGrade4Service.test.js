// tests/mentalMathsGrade4Service.test.js
'use strict';

const {
  MIN_GRADE, MAX_GRADE, FACTOR_MIN, FACTOR_MAX, TOPICS, DEFAULT_TOPIC,
  isSupportedGrade,
  generateMultiplicationFact, generateDivisionFact,
  generateGrade4MentalMathsSet,
} = require('../services/mentalMathsGrade4Service');

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

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const N = 5000;

console.log('Grade scope');
{
  ok('MIN_GRADE === MAX_GRADE === 4', MIN_GRADE === 4 && MAX_GRADE === 4);
  ok('FACTOR_MIN === 1, FACTOR_MAX === 10', FACTOR_MIN === 1 && FACTOR_MAX === 10);
  ok('isSupportedGrade(4) is true', isSupportedGrade(4));
  ok('isSupportedGrade(3) is false', !isSupportedGrade(3));
  ok('isSupportedGrade(5) is false', !isSupportedGrade(5));
  ok('isSupportedGrade(4.5) is false', !isSupportedGrade(4.5));
  ok('isSupportedGrade("4") is false', !isSupportedGrade('4'));
}

console.log('\nTopic catalogue — no addition/subtraction topic (evidence gap, not fabricated)');
{
  ok('TOPICS has exactly mulFacts10x10/divFacts10x10/mixed',
    JSON.stringify(TOPICS.map(t => t.key)) === JSON.stringify(['mulFacts10x10', 'divFacts10x10', 'mixed']));
  ok('DEFAULT_TOPIC is mixed', DEFAULT_TOPIC === 'mixed');
  ok('no addFacts/subFacts topic exists', !TOPICS.some(t => /add|sub/i.test(t.key)));
}

console.log('\nMultiplication facts — bulk generation invariants');
{
  const rand = mulberry32(42);
  const items = [];
  for (let i = 0; i < N; i++) items.push(generateMultiplicationFact(rand));

  ok('all factors in [1,10]', items.every(it => it.a >= 1 && it.a <= 10 && it.b >= 1 && it.b <= 10));
  ok('all products <= 100', items.every(it => it.result <= 100));
  ok('a * b === result', items.every(it => it.a * it.b === it.result));
  ok('canonicalAnswer === result', items.every(it => it.canonicalAnswer === it.result));
  ok('prompt format is "a × b = ?"', items.every(it => it.prompt === `${it.a} × ${it.b} = ?`));
  const coverageA = new Set(items.map(it => it.a)).size;
  const coverageB = new Set(items.map(it => it.b)).size;
  ok('full factor-a coverage over enough draws (1-10)', coverageA === 10);
  ok('full factor-b coverage over enough draws (1-10)', coverageB === 10);
  ok('10 x 10 = 100 is reachable (the stated ceiling itself)',
    items.some(it => it.a === 10 && it.b === 10 && it.result === 100));
}

console.log('\nDivision facts — bulk generation invariants (exact inverse of the 10x10 table)');
{
  const rand = mulberry32(99);
  const items = [];
  for (let i = 0; i < N; i++) items.push(generateDivisionFact(rand));

  ok('all divisors in [1,10]', items.every(it => it.b >= 1 && it.b <= 10));
  ok('all quotients in [1,10]', items.every(it => it.result >= 1 && it.result <= 10));
  ok('all dividends <= 100 (product of two evidenced factors)', items.every(it => it.a <= 100));
  ok('dividend is exactly divisor * quotient', items.every(it => it.b * it.result === it.a));
  ok('a / b === result (exact division, no remainder)', items.every(it => it.a % it.b === 0 && it.a / it.b === it.result));
  ok('canonicalAnswer === result', items.every(it => it.canonicalAnswer === it.result));
  ok('prompt format is "a ÷ b = ?"', items.every(it => it.prompt === `${it.a} ÷ ${it.b} = ?`));
}

console.log('\nSession builder — generateGrade4MentalMathsSet');
{
  const mixed = generateGrade4MentalMathsSet({ count: 20, seed: 7, topic: 'mixed' });
  ok('grade === 4', mixed.grade === 4);
  ok('returns exactly `count` questions', mixed.questions.length === 20);
  ok('mixed draws both strands', new Set(mixed.questions.map(q => q.strand)).size === 2);
  ok('every question has strand/prompt/canonicalAnswer',
    mixed.questions.every(q => typeof q.strand === 'string' && typeof q.prompt === 'string' && typeof q.canonicalAnswer === 'number'));

  const mulOnly = generateGrade4MentalMathsSet({ count: 15, seed: 7, topic: 'mulFacts10x10' });
  ok('mulFacts10x10 draws only multiplication items', mulOnly.questions.every(q => q.strand === 'mulFacts10x10'));

  const divOnly = generateGrade4MentalMathsSet({ count: 15, seed: 7, topic: 'divFacts10x10' });
  ok('divFacts10x10 draws only division items', divOnly.questions.every(q => q.strand === 'divFacts10x10'));

  ok('default count is 12', generateGrade4MentalMathsSet({ seed: 1 }).questions.length === 12);

  // No factor/product ever exceeds the evidenced 10x10 ceiling, across a
  // large sweep.
  const bigSweep = generateGrade4MentalMathsSet({ count: 500, seed: 2024, topic: 'mixed' }).questions;
  const exceedsRange = bigSweep.some(q => {
    let m = q.prompt.match(/^(\d+) × (\d+) = \?$/);
    if (m) return Number(m[1]) > 10 || Number(m[2]) > 10 || q.canonicalAnswer > 100;
    m = q.prompt.match(/^(\d+) ÷ (\d+) = \?$/);
    if (m) return Number(m[2]) > 10 || q.canonicalAnswer > 10 || Number(m[1]) > 100;
    return true;
  });
  ok('large sweep: no factor/product ever exceeds the 10x10 ceiling, no unrecognised form', !exceedsRange);
}

console.log('\nDeterminism / reproducibility');
{
  const a = generateGrade4MentalMathsSet({ count: 30, seed: 555, topic: 'mixed' });
  const b = generateGrade4MentalMathsSet({ count: 30, seed: 555, topic: 'mixed' });
  ok('same seed reproduces the same session', JSON.stringify(a.questions) === JSON.stringify(b.questions));
  const c = generateGrade4MentalMathsSet({ count: 30, seed: 556, topic: 'mixed' });
  ok('different seed produces a different session', JSON.stringify(a.questions) !== JSON.stringify(c.questions));
}

console.log('\nError handling / malformed inputs');
{
  throws('count = 0 is rejected', () => generateGrade4MentalMathsSet({ count: 0 }));
  throws('negative count is rejected', () => generateGrade4MentalMathsSet({ count: -3 }));
  throws('non-integer count is rejected', () => generateGrade4MentalMathsSet({ count: 4.5 }));
  throws('non-numeric count is rejected', () => generateGrade4MentalMathsSet({ count: 'lots' }));
  throws('unknown topic is rejected', () => generateGrade4MentalMathsSet({ count: 4, topic: 'zzz' }));
  throws('an addition topic (not evidenced for Grade 4) is rejected', () => generateGrade4MentalMathsSet({ count: 4, topic: 'addFacts20' }));
  throws('a Grade 3 topic key is rejected', () => generateGrade4MentalMathsSet({ count: 4, topic: 'mulFacts2x10x' }));
}

console.log('\n─────────────────────────────────');
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📊 Total:  ${passed + failed}`);
console.log('─────────────────────────────────\n');

if (failed > 0) process.exitCode = 1;