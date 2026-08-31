// tests/mentalMathsGrade2Service.test.js
'use strict';

const {
  MIN_GRADE, MAX_GRADE, FACT_LIMIT, TOPICS, DEFAULT_TOPIC,
  isSupportedGrade,
  generateAdditionFact, generateSubtractionFact,
  generateGrade2MentalMathsSet,
} = require('../services/mentalMathsGrade2Service');

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

console.log('Grade 2 — scope constants');
{
  ok('MIN_GRADE === MAX_GRADE === 2', MIN_GRADE === 2 && MAX_GRADE === 2);
  ok('FACT_LIMIT === 20', FACT_LIMIT === 20);
  ok('isSupportedGrade(2) is true', isSupportedGrade(2) === true);
  ok('isSupportedGrade(1) is false', isSupportedGrade(1) === false);
  ok('isSupportedGrade(3) is false', isSupportedGrade(3) === false);
  ok('DEFAULT_TOPIC is mixed', DEFAULT_TOPIC === 'mixed');
  ok('TOPICS has three entries', TOPICS.length === 3);
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

const N = 2000;

console.log('Grade 2 — addition facts to 20 (bulk generation)');
{
  const rand = mulberry32(17);
  const items = [];
  for (let i = 0; i < N; i++) items.push(generateAdditionFact(rand));

  ok('every sum <= 20', items.every((it) => it.result <= FACT_LIMIT));
  ok('every sum >= 1 (0+0 excluded as trivial)', items.every((it) => it.result >= 1));
  ok('a + b === result for every item', items.every((it) => it.a + it.b === it.result));
  ok('canonicalAnswer === result', items.every((it) => it.canonicalAnswer === it.result));
  ok('every operand is non-negative', items.every((it) => it.a >= 0 && it.b >= 0));
  ok('prompt matches "a + b = ?" exactly', items.every((it) => it.prompt === `${it.a} + ${it.b} = ?`));

  const beyondGrade1 = items.filter((it) => it.result > 10);
  console.log(`     (info) items with a sum > 10 (beyond Grade 1's own range) in this run: ${beyondGrade1.length}`);
}

console.log('Grade 2 — subtraction facts to 20 (bulk generation)');
{
  const rand = mulberry32(23);
  const items = [];
  for (let i = 0; i < N; i++) items.push(generateSubtractionFact(rand));

  ok('every minuend a <= 20', items.every((it) => it.a <= FACT_LIMIT));
  ok('every minuend a >= 1', items.every((it) => it.a >= 1));
  ok('every subtrahend b in [0, a]', items.every((it) => it.b >= 0 && it.b <= it.a));
  ok('every result c >= 0 (no negative results)', items.every((it) => it.result >= 0));
  ok('a - b === result for every item', items.every((it) => it.a - it.b === it.result));
  ok('canonicalAnswer === result', items.every((it) => it.canonicalAnswer === it.result));
  ok('prompt matches "a - b = ?" exactly', items.every((it) => it.prompt === `${it.a} - ${it.b} = ?`));
}

console.log('Grade 2 — generateGrade2MentalMathsSet()');
{
  const set = generateGrade2MentalMathsSet({ count: 12, seed: 5 });
  ok('grade === 2', set.grade === 2);
  ok('12 questions returned', set.questions.length === 12);
  ok('every question has strand/prompt/canonicalAnswer',
    set.questions.every((q) => typeof q.strand === 'string' && typeof q.prompt === 'string' && q.canonicalAnswer !== undefined));
  ok('mixed topic alternates addFacts20/subFacts20 strands only',
    set.questions.every((q) => q.strand === 'addFacts20' || q.strand === 'subFacts20'));

  const addOnly = generateGrade2MentalMathsSet({ count: 10, seed: 5, topic: 'addFacts20' });
  ok('addFacts20 topic yields only addFacts20 strand', addOnly.questions.every((q) => q.strand === 'addFacts20'));

  const subOnly = generateGrade2MentalMathsSet({ count: 10, seed: 5, topic: 'subFacts20' });
  ok('subFacts20 topic yields only subFacts20 strand', subOnly.questions.every((q) => q.strand === 'subFacts20'));

  ok('deterministic for a given seed', JSON.stringify(generateGrade2MentalMathsSet({ count: 8, seed: 99 }))
    === JSON.stringify(generateGrade2MentalMathsSet({ count: 8, seed: 99 })));

  throws('count = 0 throws', () => generateGrade2MentalMathsSet({ count: 0 }));
  throws('negative count throws', () => generateGrade2MentalMathsSet({ count: -3 }));
  throws('unknown topic throws', () => generateGrade2MentalMathsSet({ count: 4, topic: 'multiplyFacts' }));

  // No CAPS basis for anything beyond facts to 20 — no operand or result
  // should ever exceed FACT_LIMIT, regardless of topic or count.
  const big = generateGrade2MentalMathsSet({ count: 500, seed: 123 });
  ok('no operand or result exceeds FACT_LIMIT across a large batch', big.questions.every((q) => {
    const m = q.prompt.match(/^(\d+) [+-] (\d+) = \?$/);
    if (!m) return false;
    const [, a, b] = m;
    return Number(a) <= FACT_LIMIT && Number(b) <= FACT_LIMIT && q.canonicalAnswer <= FACT_LIMIT;
  }));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);