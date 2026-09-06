// tests/ratioRate.test.js
//
// Tests the PROPOSED (not-yet-authorized) ratioRate family generator.
// See services/mentalMathsService.js's "ratioRate (PROPOSED — NOT
// AUTHORIZED)" section and
// docs/specs/mental-maths/CY79_RatioRate_Generation_Specification_DESIGN_PROPOSAL.md
// (CY80 revision) for the design this exercises.
//
// This file deliberately tests generateProposedFamilySession /
// genRatioRateItem directly, NOT generateFamilySession — the two are
// structurally separate on purpose (see the PROPOSED notice in
// mentalMathsService.js), and this suite does not touch or exercise the
// production AUTHORIZED_FAMILIES path at all.

'use strict';

const {
  PROPOSED_FAMILIES,
  PROPOSED_FAMILY_GRADE_AUTHORIZATION,
  generateProposedFamilySession,
  AUTHORIZED_FAMILIES,
  _internal,
} = require('../services/mentalMathsService');
const { genRatioRateItem, roundTo2dp, isExactTo2dp, RATIO_RATE_RANGES, mulberry32 } = _internal;

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

console.log('\n── ratioRate (PROPOSED): governance gating ──\n');
{
  ok('ratioRate is NOT in AUTHORIZED_FAMILIES', !AUTHORIZED_FAMILIES.includes('ratioRate'));
  ok('ratioRate IS in PROPOSED_FAMILIES', PROPOSED_FAMILIES.includes('ratioRate'));
  ok('PROPOSED_FAMILY_GRADE_AUTHORIZATION.ratioRate is G9-only (D2)',
    Array.isArray(PROPOSED_FAMILY_GRADE_AUTHORIZATION.ratioRate) &&
    PROPOSED_FAMILY_GRADE_AUTHORIZATION.ratioRate.length === 1 &&
    PROPOSED_FAMILY_GRADE_AUTHORIZATION.ratioRate[0] === 9);

  let threw = false;
  try { generateProposedFamilySession({ grade: 7, family: 'ratioRate', count: 3, seed: 1 }); } catch (e) { threw = true; }
  ok('Grade 7 is rejected for ratioRate (G9-only per D2)', threw);

  threw = false;
  try { generateProposedFamilySession({ grade: 8, family: 'ratioRate', count: 3, seed: 1 }); } catch (e) { threw = true; }
  ok('Grade 8 is rejected for ratioRate (G9-only per D2)', threw);

  threw = false;
  try { generateProposedFamilySession({ grade: 9, family: 'ratioSharing', count: 3, seed: 1 }); } catch (e) { threw = true; }
  ok('An AUTHORIZED_FAMILIES member is rejected via generateProposedFamilySession (structurally separate paths)', threw);
}

console.log('\n── ratioRate (PROPOSED): RR-1 / RR-2 / RR-3 correctness (D1) ──\n');
{
  // Run many seeds and independently re-derive each canonical answer from
  // the prompt text and the returned form, so we're checking the
  // generator's arithmetic, not just its own self-consistency.
  const SPEED_RE = /at (?:a speed of )?(\d+(?:\.\d+)?) km\/h/;
  const DISTANCE_RE = /(\d+(?:\.\d+)?) km/;
  const TIME_RE = /for (\d+(?:\.\d+)?) (h|min)\b|in (\d+(?:\.\d+)?) (h|min)\b/;

  let sawRR1 = false, sawRR2 = false, sawRR3 = false;
  let allExact = true;
  let allInRange = true;
  let allIndependentlyCorrect = true;

  for (let seed = 1; seed <= 200; seed++) {
    const rand = mulberry32(seed);
    const item = genRatioRateItem(rand);

    if (item.form === 'RR-1') sawRR1 = true;
    if (item.form === 'RR-2') sawRR2 = true;
    if (item.form === 'RR-3') sawRR3 = true;

    if (!isExactTo2dp(item.canonicalAnswer)) allExact = false;
    if (roundTo2dp(item.canonicalAnswer) !== item.canonicalAnswer) allExact = false;

    if (item.form === 'RR-1') {
      // distance unknown — check within configured distance range
      if (item.canonicalAnswer < RATIO_RATE_RANGES.distance.min || item.canonicalAnswer > RATIO_RATE_RANGES.distance.max) allInRange = false;
      const speedMatch = item.prompt.match(/at (\d+(?:\.\d+)?) km\/h/);
      const timeMatch = item.prompt.match(/for (\d+(?:\.\d+)?) (h|min)/);
      if (speedMatch && timeMatch) {
        const speed = parseFloat(speedMatch[1]);
        const time = parseFloat(timeMatch[1]);
        const hours = timeMatch[2] === 'h' ? time : time / 60;
        const expected = roundTo2dp(speed * hours);
        if (expected !== item.canonicalAnswer) allIndependentlyCorrect = false;
      } else {
        allIndependentlyCorrect = false;
      }
    } else if (item.form === 'RR-2') {
      if (item.canonicalAnswer < RATIO_RATE_RANGES.speed.min || item.canonicalAnswer > RATIO_RATE_RANGES.speed.max) allInRange = false;
      const distanceMatch = item.prompt.match(/travels (\d+(?:\.\d+)?) km/);
      const timeMatch = item.prompt.match(/in (\d+(?:\.\d+)?) (h|min)/);
      if (distanceMatch && timeMatch) {
        const distance = parseFloat(distanceMatch[1]);
        const time = parseFloat(timeMatch[1]);
        const hours = timeMatch[2] === 'h' ? time : time / 60;
        const expected = roundTo2dp(distance / hours);
        if (expected !== item.canonicalAnswer) allIndependentlyCorrect = false;
      } else {
        allIndependentlyCorrect = false;
      }
    } else if (item.form === 'RR-3') {
      // time unknown, always reported in hours
      const distanceMatch = item.prompt.match(/travels (\d+(?:\.\d+)?) km/);
      const speedMatch = item.prompt.match(/speed of (\d+(?:\.\d+)?) km\/h/);
      if (distanceMatch && speedMatch) {
        const distance = parseFloat(distanceMatch[1]);
        const speed = parseFloat(speedMatch[1]);
        const expected = roundTo2dp(distance / speed);
        if (expected !== item.canonicalAnswer) allIndependentlyCorrect = false;
      } else {
        allIndependentlyCorrect = false;
      }
    } else {
      allIndependentlyCorrect = false;
    }
  }

  ok('RR-1 (distance unknown) is generated across seeds', sawRR1);
  ok('RR-2 (speed unknown) is generated across seeds', sawRR2);
  ok('RR-3 (time unknown) is generated across seeds', sawRR3);
  ok('Every canonical answer is an exact value at ≤2dp (D4)', allExact);
  ok('Every canonical answer is within its configured D3 range', allInRange);
  ok('Every canonical answer independently re-derives correctly from the prompt', allIndependentlyCorrect);
}

console.log('\n── ratioRate (PROPOSED): generation constraints (D5) ──\n');
{
  let allPositive = true;
  let allSingleUnknown = true; // each prompt names exactly one "how ...?" question
  const questionMarkCounts = [];

  for (let seed = 1; seed <= 100; seed++) {
    const rand = mulberry32(seed);
    const item = genRatioRateItem(rand);
    if (item.canonicalAnswer <= 0) allPositive = false;
    const qCount = (item.prompt.match(/\?/g) || []).length;
    questionMarkCounts.push(qCount);
    if (qCount !== 1) allSingleUnknown = false;
  }

  ok('Canonical answers are always positive (D5.3)', allPositive);
  ok('Every generated item asks exactly one question (single unknown, D5.1)', allSingleUnknown);
}

console.log('\n── ratioRate (PROPOSED): exclusions (D6) ──\n');
{
  let noRatioSharingWording = true;
  let noProportionWording = true;

  for (let seed = 1; seed <= 100; seed++) {
    const rand = mulberry32(seed);
    const item = genRatioRateItem(rand);
    if (/\bshare\b|\bratio\b|:\d/i.test(item.prompt)) noRatioSharingWording = false;
    if (/\bproportion\b/i.test(item.prompt)) noProportionWording = false;
  }

  ok('No generated ratioRate prompt uses ratioSharing wording ("share"/"ratio")', noRatioSharingWording);
  ok('No generated ratioRate prompt uses direct/indirect proportion wording', noProportionWording);
}

console.log('\n── ratioRate (PROPOSED): session-level behavior ──\n');
{
  const session = generateProposedFamilySession({ grade: 9, family: 'ratioRate', count: 12, seed: 42 });
  ok('Session reports grade 9', session.grade === 9);
  ok('Session reports family "ratioRate"', session.family === 'ratioRate');
  ok('Session returns the requested number of questions', session.questions.length === 12);
  ok('Every question is stamped with strand "ratioRate"', session.questions.every(q => q.strand === 'ratioRate'));
  ok('Every question has a positive, ≤2dp canonicalAnswer', session.questions.every(q => q.canonicalAnswer > 0 && isExactTo2dp(q.canonicalAnswer)));

  const sessionA = generateProposedFamilySession({ grade: 9, family: 'ratioRate', count: 5, seed: 7 });
  const sessionB = generateProposedFamilySession({ grade: 9, family: 'ratioRate', count: 5, seed: 7 });
  ok('Same seed produces a deterministic/reproducible session', JSON.stringify(sessionA) === JSON.stringify(sessionB));

  let threw = false;
  try { generateProposedFamilySession({ grade: 9, family: 'ratioRate', count: 0, seed: 1 }); } catch (e) { threw = true; }
  ok('count=0 is rejected', threw);

  threw = false;
  try { generateProposedFamilySession({ grade: 9, family: 'notAFamily', count: 3, seed: 1 }); } catch (e) { threw = true; }
  ok('Unknown family is rejected', threw);
}

console.log('\n── ratioRate (PROPOSED): boundary ranges (D3) ──\n');
{
  ok('Configured speed range matches D3 (1–200)', RATIO_RATE_RANGES.speed.min === 1 && RATIO_RATE_RANGES.speed.max === 200);
  ok('Configured minutes range matches D3 (1–180)', RATIO_RATE_RANGES.timeMinutes.min === 1 && RATIO_RATE_RANGES.timeMinutes.max === 180);
  ok('Configured hours range matches D3 (1–12)', RATIO_RATE_RANGES.timeHours.min === 1 && RATIO_RATE_RANGES.timeHours.max === 12);
  ok('Configured distance range matches D3 (1–1000)', RATIO_RATE_RANGES.distance.min === 1 && RATIO_RATE_RANGES.distance.max === 1000);

  ok('roundTo2dp/isExactTo2dp: 12.345 is not exact to 2dp', !isExactTo2dp(12.345));
  ok('roundTo2dp/isExactTo2dp: 12.34 is exact to 2dp', isExactTo2dp(12.34));
  ok('roundTo2dp/isExactTo2dp: 12 is exact to 2dp', isExactTo2dp(12));
  ok('roundTo2dp(0.1 + 0.2) avoids floating point drift', roundTo2dp(0.1 + 0.2) === 0.3);
}

console.log('\n─────────────────────────────────');
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📊 Total:  ${passed + failed}`);
console.log('─────────────────────────────────\n');

if (failed > 0) {
  process.exitCode = 1;
}
