// services/mentalMathsGrade5Service.js
//
// Mental Maths — Grade 5 Arithmetic Fluency, Candidates C12/C13.
//
// This module implements ONLY what is frozen in the specification chain:
//   Grade5_Arithmetic_Fluency_Draft_v0.1_Consolidated.md (Sections 3 & 4 —
//     C12/C13 generation policy)
//   stage5_difficulty_bands.md (Support/Core/Extension band criteria)
//
// It is deliberately isolated from services/mentalMathsService.js (the
// existing, frozen Senior Phase Grades 7-9 implementation) — that file is
// NOT modified by this work. Grade 5 gets its own generator, per the
// architecture decision on record: no shared MIN_GRADE/MAX_GRADE fork with
// Senior Phase.
//
// C12 — Block B paired form: a ± b = □ therefore □ = c ∓ d
// C13 — Block B paired form: a × b = □ therefore □ = c ÷ d
//
// Frozen invariants encoded here (do not change without a new authorized
// specification stage — see /areas/mental-maths-intermediate-spec.md):
//   C12: matched-length operand tiers (2/3/4-digit); subtraction ordering
//        a=max(x,y), b=min(x,y); equal-operand subtraction discarded;
//        result in [10, 9999]; 5-digit result forbidden.
//        NOTE: equal-operand ADDITION is explicitly NOT excluded by the
//        frozen policy (open ambiguity, see stage3b_findings.md #7) — this
//        implementation does not resolve it and allows a=b on addition.
//   C13: a in [10,99], b in [2,9], uniform independent draw; guards
//        a!=0,b!=0,a!=1,b!=1,divisor!=1,divisor!=dividend,a!=b (all
//        structurally unreachable at this envelope, confirmed here too
//        since the two ranges are disjoint).
//
// Difficulty bands (Stage 5, specification thresholds only — NOT
// learner-validated):
//   C12: band = operand digit tier itself (Support=2, Core=3, Extension=4).
//   C13: band = tertile of (a_value * b_value), cut at products <=177
//        (Support), <=365 (Core), else Extension.

'use strict';

const TIER_RANGES = { 2: [10, 99], 3: [100, 999], 4: [1000, 9999] };

const C13_A_MIN = 10, C13_A_MAX = 99;
const C13_B_MIN = 2, C13_B_MAX = 9;
const C13_BAND_CUT_1 = 177; // Support upper bound (inclusive)
const C13_BAND_CUT_2 = 365; // Core upper bound (inclusive)

/**
 * Simple seeded PRNG (mulberry32) — same choice as the existing Senior
 * Phase service, for consistency and reproducibility in tests.
 * @param {number} seed
 * @returns {() => number}
 */
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

function randInt(rand, min, max) {
  return min + Math.floor(rand() * (max - min + 1));
}

function digits(n) {
  return String(Math.abs(n)).length;
}

/**
 * C12 band: operand digit tier itself (Stage 5, Section 2).
 * @param {number} tier - 2, 3, or 4
 * @returns {'Support'|'Core'|'Extension'}
 */
function c12Band(tier) {
  if (tier === 2) return 'Support';
  if (tier === 3) return 'Core';
  if (tier === 4) return 'Extension';
  throw new Error(`c12Band: unexpected tier "${tier}"`);
}

/**
 * C13 band: tertile of a*b (Stage 5, Section 3).
 * @param {number} product
 * @returns {'Support'|'Core'|'Extension'}
 */
function c13Band(product) {
  if (product <= C13_BAND_CUT_1) return 'Support';
  if (product <= C13_BAND_CUT_2) return 'Core';
  return 'Extension';
}

/**
 * Generates one C12 item (Block B paired addition/subtraction sentence).
 * Frozen policy: matched-length tiers, constructive subtraction ordering,
 * equal-operand subtraction discarded, result in [10,9999].
 *
 * @param {() => number} rand
 * @returns {{candidate:'C12', op:'add'|'sub', tier:number, a:number, b:number,
 *   result:number, band:string, prompt:string, canonicalAnswer:number}}
 */
function generateC12(rand) {
  const MAX_ATTEMPTS = 500;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const tier = pick(rand, [2, 3, 4]);
    const [lo, hi] = TIER_RANGES[tier];
    const op = rand() < 0.5 ? 'add' : 'sub';

    let a, b, result;
    if (op === 'add') {
      a = randInt(rand, lo, hi);
      b = randInt(rand, lo, hi);
      result = a + b;
      if (result > 9999 || result < 10) continue; // 5-digit result forbidden / floor
    } else {
      const x = randInt(rand, lo, hi);
      const y = randInt(rand, lo, hi);
      if (x === y) continue; // equal-operand subtraction discarded (frozen policy)
      a = Math.max(x, y);
      b = Math.min(x, y);
      result = a - b;
      if (result < 10 || result > 9999) continue;
    }

    const band = c12Band(tier);
    const prompt = op === 'add'
      ? `${a} + ${b} = □ therefore □ = ${result} - ${b}`
      : `${a} - ${b} = □ therefore □ = ${result} + ${b}`;

    return { candidate: 'C12', op, tier, a, b, result, band, prompt, canonicalAnswer: result };
  }
  throw new Error('generateC12: exceeded max attempts without a valid item');
}

/**
 * Generates one C13 item (Block B paired multiplication/division sentence).
 * Frozen policy: a in [10,99], b in [2,9], uniform independent draw,
 * a!=b guard (structurally unreachable given disjoint ranges, checked
 * defensively anyway).
 *
 * @param {() => number} rand
 * @returns {{candidate:'C13', a:number, b:number, product:number, band:string,
 *   prompt:string, canonicalAnswer:number}}
 */
function generateC13(rand) {
  const MAX_ATTEMPTS = 500;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const a = randInt(rand, C13_A_MIN, C13_A_MAX);
    const b = randInt(rand, C13_B_MIN, C13_B_MAX);
    if (a === 0 || b === 0 || a === 1 || b === 1 || a === b) continue; // guards
    const product = a * b;
    const d = b;
    if (product % d !== 0) continue; // exact division mandatory
    if (d === 1 || d === product) continue;

    const band = c13Band(product);
    const prompt = `${a} × ${b} = □ therefore □ = ${product} ÷ ${d}`;

    return { candidate: 'C13', a, b, product, d, quotient: a, band, prompt, canonicalAnswer: a };
  }
  throw new Error('generateC13: exceeded max attempts without a valid item');
}

function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}

module.exports = {
  TIER_RANGES,
  C13_A_MIN, C13_A_MAX, C13_B_MIN, C13_B_MAX,
  C13_BAND_CUT_1, C13_BAND_CUT_2,
  c12Band,
  c13Band,
  generateC12,
  generateC13,
  _internal: { mulberry32, randInt, digits, pick },
};
