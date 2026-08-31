// tests/mentalMathsGrade3Service.test.js
//
// Unit coverage for services/mentalMathsGrade3Service.js. Verifies the
// evidenced facts-to-20, multiples-of-10-to-100, and 2x/10x table
// boundaries are never exceeded, generation is deterministic given a
// seed, and the service integrates correctly through
// mentalMathsSessionService.js alongside the existing generators.

'use strict';

const grade3 = require('../services/mentalMathsGrade3Service');
const grade2 = require('../services/mentalMathsGrade2Service');
const grade4 = require('../services/mentalMathsGrade4Service');
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
ok('MIN_GRADE === MAX_GRADE === 3', grade3.MIN_GRADE === 3 && grade3.MAX_GRADE === 3);
ok('isSupportedGrade(3) is true', grade3.isSupportedGrade(3));
ok('isSupportedGrade(2) is false', !grade3.isSupportedGrade(2));
ok('isSupportedGrade(4) is false', !grade3.isSupportedGrade(4));
ok('isSupportedGrade(3.5) is false (non-integer)', !grade3.isSupportedGrade(3.5));

console.log('\nEvidenced constants');
ok('ADD_SUB_FACT_LIMIT === 20 (Grade 3\'s own year-end target, same figure as Grade 2\'s)',
  grade3.ADD_SUB_FACT_LIMIT === 20 && grade3.ADD_SUB_FACT_LIMIT === grade2.FACT_LIMIT);
ok('MULTIPLES_OF_10_MAX === 100', grade3.MULTIPLES_OF_10_MAX === 100);
ok('TABLES is exactly [2, 10] — no other table evidenced', JSON.stringify(grade3.TABLES) === JSON.stringify([2, 10]));
ok('TABLE_MULTIPLIER_MIN === 1 and TABLE_MULTIPLIER_MAX === 10',
  grade3.TABLE_MULTIPLIER_MIN === 1 && grade3.TABLE_MULTIPLIER_MAX === 10);
ok('Grade 3 multiplication does not inherit Grade 4\'s 10x10 factor range',
  !(grade3.TABLE_MULTIPLIER_MAX === grade4.FACTOR_MAX && grade3.TABLES.length === 10));

console.log('\nTopics');
{
  const keys = grade3.TOPICS.map((t) => t.key);
  ok('TOPICS is exactly the three evidenced constructs plus mixed',
    JSON.stringify(keys) === JSON.stringify([
      'addSubFacts20', 'addSubTens', 'mulDivTables2and10', 'mixed',
    ]));
  ok('DEFAULT_TOPIC is mixed', grade3.DEFAULT_TOPIC === 'mixed');
  ok('every topic has a non-empty label',
    grade3.TOPICS.every((t) => typeof t.label === 'string' && t.label.length > 0));
}

console.log('\ngenerateAdditionFact() / generateSubtractionFact() — facts to 20');
{
  for (let i = 0; i < 500; i++) {
    const rnd = Math.random;
    const add = grade3.generateAdditionFact(rnd);
    ok(`add #${i}: a>=0`, add.a >= 0);
    ok(`add #${i}: b>=0`, add.b >= 0);
    ok(`add #${i}: result<=20`, add.result <= grade3.ADD_SUB_FACT_LIMIT);
    ok(`add #${i}: result === a+b`, add.result === add.a + add.b);
    ok(`add #${i}: canonicalAnswer === result`, add.canonicalAnswer === add.result);
    ok(`add #${i}: prompt matches "a + b = ?"`, /^\d+ \+ \d+ = \?$/.test(add.prompt));
    if (i > 5) break;
  }
  for (let i = 0; i < 6; i++) {
    const sub = grade3.generateSubtractionFact(Math.random);
    ok(`sub #${i}: a<=20`, sub.a <= grade3.ADD_SUB_FACT_LIMIT);
    ok(`sub #${i}: b in [0,a]`, sub.b >= 0 && sub.b <= sub.a);
    ok(`sub #${i}: result>=0`, sub.result >= 0);
    ok(`sub #${i}: result === a-b`, sub.result === sub.a - sub.b);
    ok(`sub #${i}: prompt matches "a - b = ?"`, /^\d+ - \d+ = \?$/.test(sub.prompt));
  }
}

console.log('\ngenerateAddTensFact() / generateSubTensFact() — multiples of 10 to 100');
for (let i = 0; i < 200; i++) {
  const add = grade3.generateAddTensFact(Math.random);
  ok(`addTens #${i}: a is a multiple of 10`, add.a % 10 === 0);
  ok(`addTens #${i}: b is a multiple of 10`, add.b % 10 === 0);
  ok(`addTens #${i}: result is a multiple of 10`, add.result % 10 === 0);
  ok(`addTens #${i}: result<=100`, add.result <= grade3.MULTIPLES_OF_10_MAX);
  ok(`addTens #${i}: result === a+b`, add.result === add.a + add.b);
  ok(`addTens #${i}: a,b >= 0`, add.a >= 0 && add.b >= 0);

  const sub = grade3.generateSubTensFact(Math.random);
  ok(`subTens #${i}: a is a multiple of 10`, sub.a % 10 === 0);
  ok(`subTens #${i}: b is a multiple of 10`, sub.b % 10 === 0);
  ok(`subTens #${i}: a<=100`, sub.a <= grade3.MULTIPLES_OF_10_MAX);
  ok(`subTens #${i}: b<=a (no negative results)`, sub.b <= sub.a);
  ok(`subTens #${i}: result === a-b`, sub.result === sub.a - sub.b);
  if (i > 20) break;
}

console.log('\ngenerateMulTableFact() / generateDivTableFact() — 2x and 10x tables');
for (let i = 0; i < 300; i++) {
  const mul = grade3.generateMulTableFact(Math.random);
  ok(`mulTable #${i}: table is 2 or 10`, mul.a === 2 || mul.a === 10);
  ok(`mulTable #${i}: multiplier in [1,10]`, mul.b >= 1 && mul.b <= 10);
  ok(`mulTable #${i}: result === table*multiplier`, mul.result === mul.a * mul.b);
  ok(`mulTable #${i}: 2x ceiling is 20, 10x ceiling is 100`,
    (mul.a === 2 && mul.result <= 20) || (mul.a === 10 && mul.result <= 100));

  const div = grade3.generateDivTableFact(Math.random);
  ok(`divTable #${i}: table (divisor) is 2 or 10`, div.b === 2 || div.b === 10);
  ok(`divTable #${i}: quotient in [1,10]`, div.result >= 1 && div.result <= 10);
  ok(`divTable #${i}: dividend === divisor*quotient`, div.a === div.b * div.result);
  ok(`divTable #${i}: division is exact`, div.a % div.b === 0);
  if (i > 20) break;
}

console.log('\ngenerateGrade3MentalMathsSet()');
{
  const s = grade3.generateGrade3MentalMathsSet({ count: 12, seed: 42 });
  ok('grade === 3', s.grade === 3);
  ok('12 questions returned', s.questions.length === 12);
  ok('every question has strand/prompt/canonicalAnswer',
    s.questions.every((q) => typeof q.strand === 'string' && typeof q.prompt === 'string' && q.canonicalAnswer !== undefined));

  const mixedStrands = new Set(s.questions.map((q) => q.strand));
  ok('mixed topic draws from more than one strand',
    mixedStrands.size > 1 && [...mixedStrands].every((s2) => ['add', 'sub', 'addTens', 'subTens', 'mulTable', 'divTable'].includes(s2)));

  const addSub = grade3.generateGrade3MentalMathsSet({ count: 10, seed: 1, topic: 'addSubFacts20' });
  ok('addSubFacts20 topic yields only add/sub strands',
    addSub.questions.every((q) => q.strand === 'add' || q.strand === 'sub'));

  const tens = grade3.generateGrade3MentalMathsSet({ count: 10, seed: 1, topic: 'addSubTens' });
  ok('addSubTens topic yields only addTens/subTens strands',
    tens.questions.every((q) => q.strand === 'addTens' || q.strand === 'subTens'));

  const tables = grade3.generateGrade3MentalMathsSet({ count: 10, seed: 1, topic: 'mulDivTables2and10' });
  ok('mulDivTables2and10 topic yields only mulTable/divTable strands',
    tables.questions.every((q) => q.strand === 'mulTable' || q.strand === 'divTable'));

  const seedA = grade3.generateGrade3MentalMathsSet({ count: 12, seed: 7 });
  const seedA2 = grade3.generateGrade3MentalMathsSet({ count: 12, seed: 7 });
  ok('deterministic for a given seed', JSON.stringify(seedA) === JSON.stringify(seedA2));

  const seedB = grade3.generateGrade3MentalMathsSet({ count: 12, seed: 8 });
  ok('different seeds produce different sessions', JSON.stringify(seedA) !== JSON.stringify(seedB));
}

console.log('\nError handling / malformed inputs');
throws('count = 0 is rejected', () => grade3.generateGrade3MentalMathsSet({ count: 0 }));
throws('negative count is rejected', () => grade3.generateGrade3MentalMathsSet({ count: -3 }));
throws('non-integer count is rejected', () => grade3.generateGrade3MentalMathsSet({ count: 4.5 }));
throws('unknown topic is rejected', () => grade3.generateGrade3MentalMathsSet({ count: 5, topic: 'nope' }));
throws('a Grade 4 topic key is rejected', () => grade3.generateGrade3MentalMathsSet({ count: 5, topic: 'mulFacts10x10' }));

console.log('\nSession-service integration');
{
  ok('Grade 3 is supported', mm.isSupportedGrade(3));
  ok('Grade 3 is in SUPPORTED_GRADES', mm.SUPPORTED_GRADES.includes(3));
  ok('Grade 3 topics match the generator\'s own TOPICS',
    JSON.stringify(mm.topicsForGrade(3)) === JSON.stringify(grade3.TOPICS));
  ok('Grade 3 default topic matches the generator\'s DEFAULT_TOPIC',
    mm.defaultTopicForGrade(3) === grade3.DEFAULT_TOPIC);
  ok('Grade 3 rejects a Grade 5 candidate as a topic', mm.findTopic(3, 'C12') === null);
  ok('Grade 2 rejects a Grade 3 topic', mm.findTopic(2, 'mulDivTables2and10') === null);

  const session = mm.generateSession({ grade: 3, topic: 'mixed', count: 10, mode: 'oral', seed: 3 });
  ok('generateSession(grade:3) returns 10 questions', session.questions.length === 10);
  ok('generateSession(grade:3) gradeLabel is "Grade 3"', session.gradeLabel === 'Grade 3');
  ok('every session question has strand/prompt/canonicalAnswer',
    session.questions.every((q) => typeof q.prompt === 'string' && q.canonicalAnswer !== undefined));
}

console.log('\nOther grades unaffected by Grade 3\'s addition');
ok('Grade 2 unaffected (still its own 20-limit generator)', mm.isSupportedGrade(2) && mm.topicsForGrade(2).length === grade2.TOPICS.length);
ok('Grade 4 unaffected', mm.isSupportedGrade(4));
ok('Grade 5 still supported', mm.isSupportedGrade(5));
ok('Grade 9 still unsupported', !mm.isSupportedGrade(9));

console.log('\n─────────────────────────────────');
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log('─────────────────────────────────');
if (failed > 0) process.exit(1);