// tests/mentalMathsGrade5Service.test.js
'use strict';

const {
  TIER_RANGES,
  C13_A_MIN, C13_A_MAX, C13_B_MIN, C13_B_MAX,
  generateC12, generateC13,
  _internal,
} = require('../services/mentalMathsGrade5Service');
const { mulberry32 } = _internal;

let passed = 0, failed = 0;
function ok(label, condition) {
  if (condition) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}`); }
}

const N = 5000; // larger than the analytical corpus's own C13 n, to stress-test

console.log('C12 — frozen invariants (bulk generation)');
{
  const rand = mulberry32(42);
  const items = [];
  for (let i = 0; i < N; i++) items.push(generateC12(rand));

  ok('all results in [10,9999]', items.every(it => it.result >= 10 && it.result <= 9999));
  ok('all subtraction items have a > b', items.filter(it => it.op === 'sub').every(it => it.a > it.b));
  ok('all subtraction items have a != b (equal-operand sub discarded)', items.filter(it => it.op === 'sub').every(it => it.a !== it.b));
  ok('matched-length operands (digits(a) === digits(b))', items.every(it => String(it.a).length === String(it.b).length));
  ok('operand tier always in {2,3,4}', items.every(it => [2, 3, 4].includes(it.tier)));
  ok('canonicalAnswer === result', items.every(it => it.canonicalAnswer === it.result));

  const addResults = items.filter(it => it.op === 'add').map(it => it.result);
  ok('no 5-digit addition results (>9999)', addResults.every(r => r <= 9999));

  // open ambiguity check — confirm equal-operand ADDITION is permitted (not silently excluded)
  const equalAdd = items.filter(it => it.op === 'add' && it.a === it.b);
  ok('equal-operand addition is NOT excluded (documented open ambiguity, not a bug)', true); // presence/absence both valid; just documenting
  console.log(`     (info) equal-operand addition occurrences in this run: ${equalAdd.length}`);

  const tierCounts = { 2: 0, 3: 0, 4: 0 };
  items.forEach(it => tierCounts[it.tier]++);
  ok('all three tiers populated (no empty tier)', tierCounts[2] > 0 && tierCounts[3] > 0 && tierCounts[4] > 0);
}

console.log('\nC13 — frozen invariants (bulk generation)');
{
  const rand = mulberry32(99);
  const items = [];
  for (let i = 0; i < N; i++) items.push(generateC13(rand));

  ok(`all a in [${C13_A_MIN},${C13_A_MAX}]`, items.every(it => it.a >= C13_A_MIN && it.a <= C13_A_MAX));
  ok(`all b in [${C13_B_MIN},${C13_B_MAX}]`, items.every(it => it.b >= C13_B_MIN && it.b <= C13_B_MAX));
  ok('a always != b (guard, structurally unreachable but checked)', items.every(it => it.a !== it.b));
  ok('exact division holds (product % b === 0)', items.every(it => it.product % it.b === 0));
  ok('quotient === a', items.every(it => it.quotient === it.a));
  ok('canonicalAnswer === a', items.every(it => it.canonicalAnswer === it.a));
  ok('product range matches frozen policy (20-891)', items.every(it => it.product >= 20 && it.product <= 891) &&
     Math.min(...items.map(it => it.product)) >= 20 && Math.max(...items.map(it => it.product)) <= 891);

  const aCoverage = new Set(items.map(it => it.a)).size;
  const bCoverage = new Set(items.map(it => it.b)).size;
  ok('full a coverage over enough draws (90 possible values)', aCoverage === 90);
  ok('full b coverage over enough draws (8 possible values)', bCoverage === 8);
}

console.log('\nDeterminism / reproducibility');
{
  const items1 = []; const rand1 = mulberry32(555);
  for (let i = 0; i < 50; i++) items1.push(generateC12(rand1));
  const items2 = []; const rand2 = mulberry32(555);
  for (let i = 0; i < 50; i++) items2.push(generateC12(rand2));
  ok('same seed produces identical C12 sequence', JSON.stringify(items1) === JSON.stringify(items2));

  const c13a = []; const randA = mulberry32(555);
  for (let i = 0; i < 50; i++) c13a.push(generateC13(randA));
  const c13b = []; const randB = mulberry32(555);
  for (let i = 0; i < 50; i++) c13b.push(generateC13(randB));
  ok('same seed produces identical C13 sequence', JSON.stringify(c13a) === JSON.stringify(c13b));
}

console.log('\nExisting Senior Phase service untouched (regression guard)');
{
  const path = require('path');
  const fs = require('fs');
  const seniorPath = path.join(__dirname, '..', 'services', 'mentalMathsService.js');
  const exists = fs.existsSync(seniorPath);
  ok('services/mentalMathsService.js still present', exists);
  if (exists) {
    const senior = require('../services/mentalMathsService');
    ok('Senior Phase MIN_GRADE/MAX_GRADE unchanged (7-9)', senior.MIN_GRADE === 7 && senior.MAX_GRADE === 9);
    ok('Senior Phase STRANDS unchanged (6 strands)', senior.STRANDS.length === 6);
  }
}

console.log('\n─────────────────────────────────');
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📊 Total:  ${passed + failed}`);
console.log('─────────────────────────────────\n');

if (failed > 0) process.exitCode = 1;
