// services/mentalMathsGrade2Service.js
//
// Mental Maths — Grade 2 Arithmetic Fluency.
//
// Scope authority: docs/specs/mental-maths/
//   R12_Mental_Maths_Generation_Permission_Policy_v1_0_FROZEN.md §3.1
//   (PRESENT -> DEDICATED -> EXPLICIT, Grades 1/2/3/4/6/7; PERMITTED,
//   scoped strictly to each grade's own evidenced recall range).
//
// CAPS evidence for Grade 2's own range (Foundation Phase CAPS,
// Mathematics Grade 1-3, Clarification of Grade 2 content, §1.16):
//   - Term 1 §1.16 "Requirement by year end" column (Grade 2's own
//     full-year rapid-recall target): "Recall addition and subtraction
//     facts to 20"
//   - Term 4 §1.16 "Requirement by year end" column (identical, confirms
//     no drift across the year): "Recall addition and subtraction facts
//     to 20"
//   - Term 4 §1.16 "Focus for Term 4" column, realising that target:
//     "Add and subtract facts for all numbers up to and including 20",
//     "Know all addition and subtraction number bonds to 20"
// verified directly against the source PDF (Grade 2's own Term 1 and
// Term 4 tables), independently of Grade 1 and Grade 3's own ranges —
// Grade 1's "facts to 10" is Term 1's STARTING point within Grade 2
// (explicitly framed there as "consolidation of work done in Grade 1"),
// not Grade 2's own evidenced target, so it is not used here.
//
// Scope, evidenced:
//   - addition facts to 20: a + b = c, with c (the sum) <= 20
//   - subtraction facts to 20: a - b = c, with a (the minuend) <= 20
// Scope, deliberately excluded (no CAPS basis in this grade's own record):
//   - multiplication / division of any form
//   - any operand or result above 20
//   - any difficulty band, tier, or magnitude envelope (none authorized
//     for any Mental Maths grade — ADR-022 §5 Governance Rule 3)
//
// Product-level choices NOT prescribed by CAPS, made conservatively and
// documented here rather than escalated as a governance question,
// mirroring the choices already made for services/mentalMathsGrade1Service.js:
//   - operands are drawn from 0-20 (CAPS's own bonds-to-20 material uses
//     0 as a valid part, consistent with Grade 1's "Number bonds to 10"
//     treatment of 0); a-b=c pairs are constructed so a<=20, b in [0,a],
//     c=a-b>=0 — no negative results, consistent with "facts to 20" being
//     a bounded recall table, not open subtraction.
//   - a+b=c pairs are constructed so c<=20 directly (not drawn-then-
//     filtered), for efficiency; every accepted pair is exactly a fact
//     "to 20" per the CAPS wording.
//   - exact duplicate prompts within one session are discarded and
//     redrawn, mirroring the existing Grade 1/Grade 5 services' approach.

'use strict';

const MIN_GRADE = 2;
const MAX_GRADE = 2;
const FACT_LIMIT = 20;

/**
 * Simple seeded PRNG (mulberry32) — same choice as the existing Grade 1,
 * Grade 5 and Senior Phase services, for consistency and reproducibility
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
 * Generates one addition fact within the evidenced "facts to 20" range:
 * a + b = c, c <= 20. Operands drawn directly from a decomposition of a
 * randomly-chosen sum in [0,20], so every draw is valid by construction
 * (no rejection sampling needed).
 *
 * @param {() => number} rand
 * @returns {{op:'add', a:number, b:number, result:number, prompt:string,
 *   canonicalAnswer:number}}
 */
function generateAdditionFact(rand) {
  const c = randInt(rand, 1, FACT_LIMIT); // sum, 1..20 (0+0 excluded as trivial)
  const a = randInt(rand, 0, c);
  const b = c - a;
  const prompt = `${a} + ${b} = ?`;
  return { op: 'add', a, b, result: c, prompt, canonicalAnswer: c };
}

/**
 * Generates one subtraction fact within the evidenced "facts to 20"
 * range: a - b = c, a <= 20, b in [0,a], c >= 0. Minuend drawn first so
 * every draw is valid by construction.
 *
 * @param {() => number} rand
 * @returns {{op:'sub', a:number, b:number, result:number, prompt:string,
 *   canonicalAnswer:number}}
 */
function generateSubtractionFact(rand) {
  const a = randInt(rand, 1, FACT_LIMIT); // minuend, 1..20
  const b = randInt(rand, 0, a);
  const c = a - b;
  const prompt = `${a} - ${b} = ?`;
  return { op: 'sub', a, b, result: c, prompt, canonicalAnswer: c };
}

const TOPICS = [
  { key: 'addFacts20', label: 'Addition facts to 20' },
  { key: 'subFacts20', label: 'Subtraction facts to 20' },
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
 * Builds a Grade 2 Mental Maths session.
 *
 * Mirrors the session-builder contract of mentalMathsGrade1Service.js,
 * mentalMathsGrade5Service.js and mentalMathsService.js exactly — same
 * return shape ({grade, questions: [{strand, prompt, canonicalAnswer}]}) —
 * so mentalMathsSessionService.js can consume any of the generator
 * services identically.
 *
 * @param {Object} opts
 * @param {number} [opts.count=12]
 * @param {number} [opts.seed]
 * @param {string} [opts.topic='mixed'] - 'addFacts20' | 'subFacts20' | 'mixed'
 * @returns {{ grade: 2, questions: Array<{strand:string, prompt:string,
 *   canonicalAnswer:number}> }}
 */
function generateGrade2MentalMathsSet({ count = 12, seed, topic = DEFAULT_TOPIC } = {}) {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`generateGrade2MentalMathsSet: count must be a positive integer, got "${count}"`);
  }
  const validTopics = TOPICS.map((t) => t.key);
  if (!validTopics.includes(topic)) {
    throw new Error(`generateGrade2MentalMathsSet: topic must be one of ${validTopics.join(', ')}, got "${topic}"`);
  }

  const rand = mulberry32(seed != null ? seed : Date.now() ^ 0x47523200 /* "GR2\0" */);
  const seenPrompts = new Set();
  const questions = [];

  for (let i = 0; i < count; i++) {
    const op = topic === 'mixed' ? (i % 2 === 0 ? 'add' : 'sub') : (topic === 'addFacts20' ? 'add' : 'sub');
    let attempt = 0;
    let item;
    do {
      item = op === 'add' ? generateAdditionFact(rand) : generateSubtractionFact(rand);
      attempt++;
    } while (seenPrompts.has(item.prompt) && attempt < 25);
    seenPrompts.add(item.prompt);
    questions.push({
      strand: item.op === 'add' ? 'addFacts20' : 'subFacts20',
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
  generateGrade2MentalMathsSet,
};