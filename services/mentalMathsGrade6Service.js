// services/mentalMathsGrade6Service.js
//
// Mental Maths — Grade 6 Arithmetic Fluency.
//
// Scope authority: docs/specs/mental-maths/
//   R12_Mental_Maths_Generation_Permission_Policy_v1_0_FROZEN.md §3.1
//   (PRESENT -> DEDICATED -> EXPLICIT, Grades 1/2/3/4/6/7; PERMITTED,
//   scoped strictly to each grade's own evidenced recall range).
//
// CAPS evidence for Grade 6's own range (Intermediate Phase CAPS,
// Mathematics Grade 4-6, §3.3.3 Clarification of content for Grade 6,
// Mental Mathematics rows, GRADE 6 TERM 1 — verified directly against
// that table, corroborated by the Section 2 Phase Overview table (§1.1
// "Mental calculations involving" column), which lists Grade 4, Grade 5
// and Grade 6 SIDE BY SIDE and shows the multiplication ceiling changes
// between them):
//   - "Multiplication of whole numbers to at least 12 x 12" — Grade 6's
//     OWN ceiling. The overview table's three-column layout makes the
//     grade-to-grade difference explicit: Grade 4 and Grade 5 both state
//     "at least 10 x 10"; Grade 6 alone states "at least 12 x 12". This is
//     not inherited from Grade 4/5 and does not inherit into them —
//     mentalMathsGrade4Service.js's own FACTOR_MAX (10) is untouched by
//     this file.
//   - "using multiplication to do division" (Term 1 clarification notes,
//      listed as a calculation technique) — the same CAPS-stated link
//      already used in mentalMathsGrade4Service.js, authorizing division
//      facts as the direct inverse of the evidenced 12x12 multiplication
//      table, rather than as an independently-invented division range.
//   - "Represent prime numbers to at least 100" — the overview table's
//     §1.1-adjacent whole-numbers row shows this REPLACES, not extends,
//     Grade 4 and Grade 5's "Represent odd and even numbers to at least
//     1 000" line. This is a genuinely distinct construct for Grade 6, not
//     a collapse of Grade 4/5's odd/even recognition into a new grade —
//     it is preserved here as its own topic (primeRecognition) rather than
//     folded into a generic number-property topic.
//
// DELIBERATELY NOT IMPLEMENTED — addition/subtraction (evidence gap, not
// an invented boundary; same treatment as Grade 4's own record):
//   Grade 6's own record lists "Addition and subtraction of: units /
//   multiples of 10 / multiples of 100 / multiples of 1 000" — scoped by
//   PLACE-VALUE BAND, not by a stated magnitude ceiling. There is no
//   "facts to N" figure to generate against, exactly as for Grade 4 (see
//   mentalMathsGrade4Service.js's own comment on this same gap). Turning
//   this into a concrete generated item would require inventing a
//   boundary CAPS does not itself state, which this service does not do.
//   Recorded here as an open evidence gap, not silently resolved.
//
// DELIBERATELY NOT IMPLEMENTED — "multiplication facts of units and tens
// by multiples of 10/100/1 000/10 000" (evidence gap, not an invented
// boundary):
//   Grade 6's own record also lists this as a distinct construct from the
//   12x12 table. Unlike the 12x12 ceiling, CAPS states no upper bound on
//   which multiple of 10 000 is in scope ("units and tens by multiples of
//   10 000" names the STEP, not a stated maximum multiplier) — there is no
//   evidenced ceiling to generate against without inventing one. Recorded
//   here as an open evidence gap for a future generation pass.
//
// Scope, evidenced:
//   - multiplication facts to 12x12: a × b = c, a in [1,12], b in [1,12]
//     (both factors independently drawn, mirroring Grade 4's construction
//     — CAPS states "at least 12 x 12" without restricting which factor
//     combinations count)
//   - division facts, the exact inverse of the above: a ÷ b = c, with
//     a = b * c for some b, c both in [1,12] (only dividing a number that
//     IS a product from the evidenced 12x12 table, by one of its
//     evidenced factors — mirrors mentalMathsGrade4Service.js exactly)
//   - prime-number recognition to at least 100: "Is N prime?" for N drawn
//     from [2,100] (2 is the smallest prime; primality is undefined below
//     2, so the range starts there rather than at 0/1, which would have
//     no correct "Yes" answer and would misrepresent the construct)
// Scope, deliberately excluded (no CAPS basis in this grade's own record,
// or an open evidence gap as documented above):
//   - addition and subtraction (evidence gap — see above)
//   - "units/tens by multiples of 10/100/1000/10000" facts (evidence gap
//     — see above)
//   - any operand or result above the stated 12x12 ceiling
//   - any prime-recognition target above 100 (the stated ceiling) —
//     100 itself is included since CAPS states "to AT LEAST 100"
//   - any difficulty band, tier, or magnitude envelope (none authorized
//     for any Mental Maths grade — ADR-022 §5 Governance Rule 3)
//
// Product-level choices NOT prescribed by CAPS, made conservatively and
// documented here rather than escalated as a governance question,
// mirroring the choices already made for Grades 1-4:
//   - both multiplication factors are drawn independently from [1,12],
//     mirroring mentalMathsGrade4Service.js's [1,10] construction exactly,
//     scaled to Grade 6's own evidenced ceiling.
//   - division facts are constructed as the exact inverse of a drawn
//     multiplication fact, mirroring mentalMathsGrade4Service.js.
//   - prime-number items are drawn uniformly from [2,100] rather than
//     biased toward primes or composites, so a session reflects the
//     actual density of primes in that range rather than an invented 50/50
//     split; canonicalAnswer is the string 'Yes' or 'No' (whether N is
//     prime), consistent with formatAnswer's plain-string rendering in
//     mentalMathsSessionService.js — there is no numeric "canonical value"
//     for a yes/no recognition item.
//   - exact duplicate prompts within one session are discarded and
//     redrawn, mirroring the existing Grade 1/2/3/4/5 services' approach.

'use strict';

const MIN_GRADE = 6;
const MAX_GRADE = 6;
const FACTOR_MIN = 1;
const FACTOR_MAX = 12; // "at least 12 x 12" — the evidenced ceiling
const PRIME_RANGE_MIN = 2; // smallest prime; primality undefined below 2
const PRIME_RANGE_MAX = 100; // "to at least 100" — the evidenced ceiling

/**
 * Simple seeded PRNG (mulberry32) — same choice as the existing Grade
 * 1/2/3/4/5 and Senior Phase services, for consistency and reproducibility
 * in tests.
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

/**
 * Trial-division primality check. PRIME_RANGE_MAX is 100, so this is
 * never asked to do meaningful work — included for correctness and
 * clarity rather than performance.
 * @param {number} n
 * @returns {boolean}
 */
function isPrime(n) {
  if (!Number.isInteger(n) || n < 2) return false;
  for (let d = 2; d * d <= n; d++) {
    if (n % d === 0) return false;
  }
  return true;
}

/**
 * Generates one multiplication fact within the evidenced 12x12 range:
 * a × b = c, both a and b in [1,12].
 * @param {() => number} rand
 * @returns {{op:'mul', a:number, b:number, result:number, prompt:string,
 *   canonicalAnswer:number}}
 */
function generateMultiplicationFact(rand) {
  const a = randInt(rand, FACTOR_MIN, FACTOR_MAX);
  const b = randInt(rand, FACTOR_MIN, FACTOR_MAX);
  const c = a * b;
  const prompt = `${a} × ${b} = ?`;
  return { op: 'mul', a, b, result: c, prompt, canonicalAnswer: c };
}

/**
 * Generates one division fact as the exact inverse of an evidenced
 * multiplication fact: dividend = a * b, divisor = b, quotient = a, with
 * a and b both in [1,12].
 * @param {() => number} rand
 * @returns {{op:'div', a:number, b:number, result:number, prompt:string,
 *   canonicalAnswer:number}}
 */
function generateDivisionFact(rand) {
  const quotient = randInt(rand, FACTOR_MIN, FACTOR_MAX);
  const divisor = randInt(rand, FACTOR_MIN, FACTOR_MAX);
  const dividend = quotient * divisor;
  const prompt = `${dividend} ÷ ${divisor} = ?`;
  return { op: 'div', a: dividend, b: divisor, result: quotient, prompt, canonicalAnswer: quotient };
}

/**
 * Generates one prime-recognition item within the evidenced [2,100]
 * range: "Is N prime?" with canonicalAnswer 'Yes' or 'No'.
 * @param {() => number} rand
 * @returns {{op:'prime', n:number, prompt:string, canonicalAnswer:string}}
 */
function generatePrimeFact(rand) {
  const n = randInt(rand, PRIME_RANGE_MIN, PRIME_RANGE_MAX);
  const prompt = `Is ${n} a prime number?`;
  return { op: 'prime', n, prompt, canonicalAnswer: isPrime(n) ? 'Yes' : 'No' };
}

const TOPICS = [
  { key: 'mulFacts12x12', label: 'Multiplication facts to 12 × 12' },
  { key: 'divFacts12x12', label: 'Division facts (inverse of 12 × 12)' },
  { key: 'primeRecognition', label: 'Prime number recognition (up to 100)' },
  { key: 'mixed', label: 'Mixed — all of the above' },
];
const DEFAULT_TOPIC = 'mixed';

const MIXED_KEYS = ['mulFacts12x12', 'divFacts12x12', 'primeRecognition'];

/**
 * @param {number} grade
 * @returns {boolean}
 */
function isSupportedGrade(grade) {
  return Number.isInteger(grade) && grade >= MIN_GRADE && grade <= MAX_GRADE;
}

/**
 * @param {string} topicKey
 * @param {() => number} rand
 * @param {number} i
 * @returns {{op:string, prompt:string, canonicalAnswer:*}}
 */
function drawItem(topicKey, rand, i) {
  if (topicKey === 'mixed') {
    const key = MIXED_KEYS[i % MIXED_KEYS.length];
    return drawItem(key, rand, i);
  }
  if (topicKey === 'mulFacts12x12') return generateMultiplicationFact(rand);
  if (topicKey === 'divFacts12x12') return generateDivisionFact(rand);
  return generatePrimeFact(rand);
}

/**
 * Builds a Grade 6 Mental Maths session.
 *
 * Mirrors the session-builder contract of mentalMathsGrade1/2/3/4Service.js
 * exactly — same return shape ({grade, questions: [{strand, prompt,
 * canonicalAnswer}]}) — so mentalMathsSessionService.js can consume any of
 * the generator services identically.
 *
 * @param {Object} opts
 * @param {number} [opts.count=12]
 * @param {number} [opts.seed]
 * @param {string} [opts.topic='mixed']
 * @returns {{ grade: 6, questions: Array<{strand:string, prompt:string,
 *   canonicalAnswer:*}> }}
 */
function generateGrade6MentalMathsSet({ count = 12, seed, topic = DEFAULT_TOPIC } = {}) {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`generateGrade6MentalMathsSet: count must be a positive integer, got "${count}"`);
  }
  const validTopics = TOPICS.map((t) => t.key);
  if (!validTopics.includes(topic)) {
    throw new Error(`generateGrade6MentalMathsSet: topic must be one of ${validTopics.join(', ')}, got "${topic}"`);
  }

  const rand = mulberry32(seed != null ? seed : Date.now() ^ 0x47523600 /* "GR6\0" */);
  const seenPrompts = new Set();
  const questions = [];

  for (let i = 0; i < count; i++) {
    let attempt = 0;
    let item;
    do {
      item = drawItem(topic, rand, i);
      attempt++;
    } while (seenPrompts.has(item.prompt) && attempt < 25);
    seenPrompts.add(item.prompt);
    questions.push({
      strand: item.op,
      prompt: item.prompt,
      canonicalAnswer: item.canonicalAnswer,
    });
  }

  return { grade: MIN_GRADE, questions };
}

module.exports = {
  MIN_GRADE,
  MAX_GRADE,
  FACTOR_MIN,
  FACTOR_MAX,
  PRIME_RANGE_MIN,
  PRIME_RANGE_MAX,
  TOPICS,
  DEFAULT_TOPIC,
  isSupportedGrade,
  isPrime,
  generateMultiplicationFact,
  generateDivisionFact,
  generatePrimeFact,
  generateGrade6MentalMathsSet,
};