// services/mentalMathsGrade5Service.js
//
// Mental Maths — Grade 5 Arithmetic Fluency, Candidates C12/C13.
//
// This module implements ONLY what is frozen in the specification chain:
//   Grade5_Arithmetic_Fluency_Draft_v0.1_Consolidated.md (Sections 3 & 4 —
//     C12/C13 generation policy)
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
// Difficulty banding (Support/Core/Extension) was previously implemented
// here (c12Band/c13Band, C13_BAND_CUT_1/2) but has been removed. It cited
// a "stage5_difficulty_bands.md" source that does not exist in the spec
// chain, and Stage 4 explicitly records difficulty banding as not started
// / deferred, pending its own authorization. The thresholds therefore had
// no legitimate provenance. If adaptive difficulty banding is wanted for
// Grade 5, that stage should be opened deliberately, as new work, rather
// than reconstructed from this removal.

'use strict';

const TIER_RANGES = { 2: [10, 99], 3: [100, 999], 4: [1000, 9999] };

const C13_A_MIN = 10, C13_A_MAX = 99;
const C13_B_MIN = 2, C13_B_MAX = 9;

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
 * Generates one C12 item (Block B paired addition/subtraction sentence).
 * Frozen policy: matched-length tiers, constructive subtraction ordering,
 * equal-operand subtraction discarded, result in [10,9999].
 *
 * @param {() => number} rand
 * @returns {{candidate:'C12', op:'add'|'sub', tier:number, a:number, b:number,
 *   result:number, prompt:string, canonicalAnswer:number}}
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

    const prompt = op === 'add'
      ? `${a} + ${b} = □ therefore □ = ${result} - ${b}`
      : `${a} - ${b} = □ therefore □ = ${result} + ${b}`;

    return { candidate: 'C12', op, tier, a, b, result, prompt, canonicalAnswer: result };
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
 * @returns {{candidate:'C13', a:number, b:number, product:number,
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

    const prompt = `${a} × ${b} = □ therefore □ = ${product} ÷ ${d}`;

    return { candidate: 'C13', a, b, product, d, quotient: a, prompt, canonicalAnswer: a };
  }
  throw new Error('generateC13: exceeded max attempts without a valid item');
}

function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}

// ── Integration surface (Stage 2) ───────────────────────────────────
//
// Grade 5 is its own supported grade, separate from the Senior Phase
// MIN_GRADE/MAX_GRADE=7-9 range in mentalMathsService.js — per the
// architecture decision recorded above (no shared range/fork).
const MIN_GRADE = 5;
const MAX_GRADE = 5;
const CANDIDATES = ['C12', 'C13'];

/**
 * @param {number} grade
 * @returns {boolean}
 */
function isSupportedGrade(grade) {
  return Number.isInteger(grade) && grade >= MIN_GRADE && grade <= MAX_GRADE;
}

/**
 * Builds a full Grade 5 Mental Maths session: an ordered list of items
 * alternating evenly between C12 and C13, with exact duplicate prompts
 * within the same session discarded (retries with a fresh draw, capped
 * to avoid an infinite loop). Mirrors the session-builder contract of
 * services/mentalMathsService.js#generateMentalMathsSet exactly — same
 * return shape ({grade, questions: [{strand, prompt, canonicalAnswer}]}) —
 * so generationPipeline.js and prompts/mentalMaths.js can consume either
 * service's output identically without a shape check.
 *
 * `strand` here carries the candidate id (C12/C13) rather than a Senior
 * Phase strand name — prompts/mentalMaths.js never reads `strand` for
 * anything other than display context, so this is a safe reuse of the
 * field rather than a new one, and keeps the two services' output
 * interchangeable at the pipeline boundary.
 *
 * @param {Object} opts
 * @param {number} [opts.count=12] - number of items to generate
 * @param {number} [opts.seed] - RNG seed; defaults to Date.now()-derived
 *   value so unseeded calls vary, but a fixed seed reproduces the same
 *   session (used by tests).
 * @param {string[]} [opts.candidates=CANDIDATES] - which of the frozen
 *   candidates to draw from, cycled in the given order. Defaults to the
 *   full CANDIDATES list, so an omitted/undefined value reproduces the
 *   original alternating C12/C13 behaviour byte-for-byte for a given seed.
 *   This selects between the two ALREADY-frozen candidates only — it adds
 *   no candidate, changes no generation rule, and introduces no difficulty
 *   or magnitude concept. See the ADR-023 §6 freeze act: C12 and C13 are
 *   each independently frozen, so generating either alone is exactly as
 *   authorized as generating both.
 * @returns {{ grade: 5, questions: Array<{strand:string, prompt:string,
 *   canonicalAnswer:number, candidate:string}> }}
 */
function generateGrade5MentalMathsSet({ count = 12, seed, candidates } = {}) {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`generateGrade5MentalMathsSet: count must be a positive integer, got "${count}"`);
  }

  const selected = candidates === undefined ? CANDIDATES : candidates;
  if (!Array.isArray(selected) || selected.length === 0 || selected.some((c) => !CANDIDATES.includes(c))) {
    throw new Error(`generateGrade5MentalMathsSet: candidates must be a non-empty subset of ${CANDIDATES.join(', ')}, got "${JSON.stringify(candidates)}"`);
  }

  const rand = mulberry32(seed != null ? seed : Date.now() ^ 0x47523500 /* "GR5\0" */);
  const seenPrompts = new Set();
  const questions = [];

  for (let i = 0; i < count; i++) {
    const candidate = selected[i % selected.length];
    let attempt = 0;
    let item;
    do {
      item = candidate === 'C12' ? generateC12(rand) : generateC13(rand);
      attempt++;
    } while (seenPrompts.has(item.prompt) && attempt < 25);
    seenPrompts.add(item.prompt);
    questions.push({
      strand: item.candidate,
      candidate: item.candidate,
      prompt: item.prompt,
      canonicalAnswer: item.canonicalAnswer,
    });
  }

  return { grade: MIN_GRADE, questions };
}

module.exports = {
  TIER_RANGES,
  C13_A_MIN, C13_A_MAX, C13_B_MIN, C13_B_MAX,
  MIN_GRADE,
  MAX_GRADE,
  CANDIDATES,
  isSupportedGrade,
  generateC12,
  generateC13,
  generateGrade5MentalMathsSet,
  _internal: { mulberry32, randInt, digits, pick },
};
