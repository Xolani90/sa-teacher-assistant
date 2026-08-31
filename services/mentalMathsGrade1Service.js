// services/mentalMathsGrade1Service.js
//
// Mental Maths — Grade 1 Arithmetic Fluency.
//
// Scope authority: docs/specs/mental-maths/
//   R12_Mental_Maths_Generation_Permission_Policy_v1_0_FROZEN.md §3.1
//   (PRESENT -> DEDICATED -> EXPLICIT, Grades 1/2/3/4/6/7; PERMITTED,
//   scoped strictly to each grade's own evidenced recall range).
//
// CAPS evidence for Grade 1's own range (Foundation Phase CAPS,
// Mathematics Grade 1-3, Clarification of Grade 1 content, Term 1,
// Numbers/Operations/Relationships §1.16 "number concept: range"):
//   "recall addition and subtraction facts to 10"
//   "Number bonds to 10"
// verified directly against the source PDF (not inferred from Grade 2 or
// any other grade), independently of the earlier draft policy that first
// named this range.
//
// This is a DIFFERENT, narrower target than the same term's general
// working range for Numbers/Operations/Relationships §1.13 ("Number
// range: 1-20", "Add up to 20", "Subtract from 20") — that range is for
// calculation WITH apparatus (concrete objects, pictures, number lines),
// not rapid recall. §1.16 explicitly separates "mental mathematics
// sessions" — rapid recall without apparatus — from that calculation
// work, and it is §1.16's own range ("facts to 10") that is the EXPLICIT,
// bounded recall target the R12 policy's `DERIVED` scope authorizes.
// Generating up to 20 here would be exactly the range-bleed the policy's
// `evidence_boundaries` clause for this path forbids: "generation must
// not extend beyond the specific evidenced range of the grade in
// question, even where an adjacent grade's range would look like a
// natural difficulty progression."
//
// Scope, evidenced:
//   - addition facts to 10: a + b = c, with c (the sum) <= 10
//   - subtraction facts to 10: a - b = c, with a (the minuend) <= 10
// Scope, deliberately excluded (no CAPS basis in this grade's own record):
//   - multiplication / division of any form
//   - any operand or result above 10
//   - any difficulty band, tier, or magnitude envelope (none authorized
//     for any Mental Maths grade — ADR-022 §5 Governance Rule 3)
//
// Product-level choices NOT prescribed by CAPS, made conservatively and
// documented here rather than escalated as a governance question:
//   - operands are drawn from 0-10 (CAPS's own "Number bonds to 10"
//     material uses 0 as a valid part, e.g. bonds of 10 include 0+10);
//     a-b=c pairs are constructed so a<=10, b in [0,a], c=a-b>=0 — no
//     negative results, consistent with "facts to 10" being a bounded
//     recall table, not open subtraction.
//   - a+b=c pairs are constructed so c<=10 directly (not drawn-then-
//     filtered), for efficiency; every accepted pair is exactly a fact
//     "to 10" per the CAPS wording.
//   - exact duplicate prompts within one session are discarded and
//     redrawn, mirroring the existing Grade 5 service's approach.

'use strict';

const MIN_GRADE = 1;
const MAX_GRADE = 1;
const FACT_LIMIT = 10;

/**
 * Simple seeded PRNG (mulberry32) — same choice as the existing Grade 5
 * and Senior Phase services, for consistency and reproducibility in tests.
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
 * Generates one addition fact within the evidenced "facts to 10" range:
 * a + b = c, c <= 10. Operands drawn directly from a decomposition of a
 * randomly-chosen sum in [0,10], so every draw is valid by construction
 * (no rejection sampling needed).
 *
 * @param {() => number} rand
 * @returns {{op:'add', a:number, b:number, result:number, prompt:string,
 *   canonicalAnswer:number}}
 */
function generateAdditionFact(rand) {
  const c = randInt(rand, 1, FACT_LIMIT); // sum, 1..10 (0+0 excluded as trivial)
  const a = randInt(rand, 0, c);
  const b = c - a;
  const prompt = `${a} + ${b} = ?`;
  return { op: 'add', a, b, result: c, prompt, canonicalAnswer: c };
}

/**
 * Generates one subtraction fact within the evidenced "facts to 10"
 * range: a - b = c, a <= 10, b in [0,a], c >= 0. Minuend drawn first so
 * every draw is valid by construction.
 *
 * @param {() => number} rand
 * @returns {{op:'sub', a:number, b:number, result:number, prompt:string,
 *   canonicalAnswer:number}}
 */
function generateSubtractionFact(rand) {
  const a = randInt(rand, 1, FACT_LIMIT); // minuend, 1..10
  const b = randInt(rand, 0, a);
  const c = a - b;
  const prompt = `${a} - ${b} = ?`;
  return { op: 'sub', a, b, result: c, prompt, canonicalAnswer: c };
}

const TOPICS = [
  { key: 'addFacts10', label: 'Addition facts to 10' },
  { key: 'subFacts10', label: 'Subtraction facts to 10' },
  { key: 'mixed', label: 'Mixed — both' },
];
const DEFAULT_TOPIC = 'mixed';

/**
 * @param {number} grade
 * @returns {boolean}
 */
function isSupportedGrade(grade) {
  return Number.isInteger(grade) && grade >= MIN_GRADE && grade <= MAX_GRADE;
}

/**
 * Builds a Grade 1 Mental Maths session.
 *
 * Mirrors the session-builder contract of mentalMathsGrade5Service.js and
 * mentalMathsService.js exactly — same return shape
 * ({grade, questions: [{strand, prompt, canonicalAnswer}]}) — so
 * mentalMathsSessionService.js can consume any of the three generator
 * services identically.
 *
 * @param {Object} opts
 * @param {number} [opts.count=12]
 * @param {number} [opts.seed]
 * @param {string} [opts.topic='mixed'] - 'addFacts10' | 'subFacts10' | 'mixed'
 * @returns {{ grade: 1, questions: Array<{strand:string, prompt:string,
 *   canonicalAnswer:number}> }}
 */
function generateGrade1MentalMathsSet({ count = 12, seed, topic = DEFAULT_TOPIC } = {}) {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`generateGrade1MentalMathsSet: count must be a positive integer, got "${count}"`);
  }
  const validTopics = TOPICS.map((t) => t.key);
  if (!validTopics.includes(topic)) {
    throw new Error(`generateGrade1MentalMathsSet: topic must be one of ${validTopics.join(', ')}, got "${topic}"`);
  }

  const rand = mulberry32(seed != null ? seed : Date.now() ^ 0x47523100 /* "GR1\0" */);
  const seenPrompts = new Set();
  const questions = [];

  for (let i = 0; i < count; i++) {
    const op = topic === 'mixed' ? (i % 2 === 0 ? 'add' : 'sub') : (topic === 'addFacts10' ? 'add' : 'sub');
    let attempt = 0;
    let item;
    do {
      item = op === 'add' ? generateAdditionFact(rand) : generateSubtractionFact(rand);
      attempt++;
    } while (seenPrompts.has(item.prompt) && attempt < 25);
    seenPrompts.add(item.prompt);
    questions.push({
      strand: item.op === 'add' ? 'addFacts10' : 'subFacts10',
      prompt: item.prompt,
      canonicalAnswer: item.canonicalAnswer,
    });
  }

  return { grade: MIN_GRADE, questions };
}

module.exports = {
  MIN_GRADE,
  MAX_GRADE,
  FACT_LIMIT,
  TOPICS,
  DEFAULT_TOPIC,
  isSupportedGrade,
  generateAdditionFact,
  generateSubtractionFact,
  generateGrade1MentalMathsSet,
};