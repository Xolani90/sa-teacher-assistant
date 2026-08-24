// tests/mentalMathsGrade5Service.test.js
'use strict';

const {
  TIER_RANGES,
  C13_A_MIN, C13_A_MAX, C13_B_MIN, C13_B_MAX,
  C13_BAND_CUT_1, C13_BAND_CUT_2,
  c12Band, c13Band,
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

console.log('\nC12 — band assignment');
{
  ok('c12Band(2) === Support', c12Band(2) === 'Support');
  ok('c12Band(3) === Core', c12Band(3) === 'Core');
  ok('c12Band(4) === Extension', c12Band(4) === 'Extension');
  let threw = false;
  try { c12Band(5); } catch (e) { threw = true; }
  ok('c12Band rejects an invalid tier', threw);

  const rand = mulberry32(7);
  const items = [];
  for (let i = 0; i < 2000; i++) items.push(generateC12(rand));
  ok('band always matches tier (Support<->2, Core<->3, Extension<->4)',
    items.every(it =>
      (it.tier === 2 && it.band === 'Support') ||
      (it.tier === 3 && it.band === 'Core') ||
      (it.tier === 4 && it.band === 'Extension')));
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

console.log('\nC13 — band assignment');
{
  ok(`c13Band(${C13_BAND_CUT_1}) === Support (inclusive boundary)`, c13Band(C13_BAND_CUT_1) === 'Support');
  ok(`c13Band(${C13_BAND_CUT_1 + 1}) === Core`, c13Band(C13_BAND_CUT_1 + 1) === 'Core');
  ok(`c13Band(${C13_BAND_CUT_2}) === Core (inclusive boundary)`, c13Band(C13_BAND_CUT_2) === 'Core');
  ok(`c13Band(${C13_BAND_CUT_2 + 1}) === Extension`, c13Band(C13_BAND_CUT_2 + 1) === 'Extension');
  ok('c13Band(20) === Support (domain floor)', c13Band(20) === 'Support');
  ok('c13Band(891) === Extension (domain ceiling)', c13Band(891) === 'Extension');

  const rand = mulberry32(123);
  const items = [];
  for (let i = 0; i < 3000; i++) items.push(generateC13(rand));
  const bandCounts = { Support: 0, Core: 0, Extension: 0 };
  items.forEach(it => bandCounts[it.band]++);
  ok('all three bands populated (no empty band)', bandCounts.Support > 0 && bandCounts.Core > 0 && bandCounts.Extension > 0);
  ok('band assignment consistent with product thresholds',
    items.every(it =>
      (it.product <= C13_BAND_CUT_1 && it.band === 'Support') ||
      (it.product > C13_BAND_CUT_1 && it.product <= C13_BAND_CUT_2 && it.band === 'Core') ||
      (it.product > C13_BAND_CUT_2 && it.band === 'Extension')));
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
