// services/mentalMathsGrade4Service.js
//
// Mental Maths — Grade 4 Arithmetic Fluency.
//
// Scope authority: docs/specs/mental-maths/
//   R12_Mental_Maths_Generation_Permission_Policy_v1_0_FROZEN.md §3.1
//   (PRESENT -> DEDICATED -> EXPLICIT, Grades 1/2/3/4/6/7; PERMITTED,
//   scoped strictly to each grade's own evidenced recall range).
//
// CAPS evidence for Grade 4's own range (Intermediate Phase CAPS,
// Mathematics Grade 4-6, §3.3.1 Clarification of content for Grade 4,
// Mental Mathematics rows, GRADE 4 TERM 1 and GRADE 4 TERM 4 — verified
// directly against both tables, which state the identical figures,
// confirming no drift across the year; corroborated by the Section 2
// Phase Overview table, §1.1 "Mental calculations involving" column for
// Grade 4):
//   - "Multiplication of whole numbers to at least 10 x 10"
//   - "times tables involving multiplication of whole numbers to at
//      least 10 x 10" (Term 1 clarification notes, listed explicitly as
//      one of the three "Number facts" aspects of the mental mathematics
//      programme)
//   - "using multiplication to do division" (Term 1 clarification notes,
//      listed as a calculation technique) — this is the CAPS-stated link
//      that authorizes generating division facts as the direct inverse
//      of the evidenced 10x10 multiplication table, rather than as an
//      independently-invented division range.
//
// DELIBERATELY NOT IMPLEMENTED — addition/subtraction (evidence gap,
// not an invented boundary):
//   Grade 4's own record also lists "Addition and subtraction facts for:
//   units / multiples of 10 / multiples of 100 / multiples of 1 000."
//   Unlike Foundation Phase (Grades 1-3), where CAPS states a closed
//   numeric ceiling ("facts to 10", "facts to 20"), Grade 4's addition/
//   subtraction recall is scoped by PLACE-VALUE BAND, not by a magnitude
//   ceiling — there is no stated "facts to N" figure to generate against.
//   Turning "addition/subtraction facts for units, multiples of 10, 100,
//   1000" into a concrete generated item (e.g. picking an operand range,
//   an answer ceiling, or which combination of bands to draw from) would
//   require inventing a curriculum boundary CAPS does not itself state,
//   which this service does not do. This is recorded here as an open
//   evidence gap for a future generation pass, not silently resolved by
//   assumption. (Grade 4's own record is used throughout this file; no
//   Grade 3 or Grade 5 figure is borrowed by adjacency.)
//
// Scope, evidenced:
//   - multiplication facts to 10x10: a × b = c, a in [1,10], b in [1,10]
//     (both factors independently drawn, so the full evidenced table is
//     reachable — CAPS states "at least 10 x 10" without restricting
//     which factor combinations count, unlike Grade 3's narrower "2 times
//     table" / "10 times table" evidence, which named specific tables)
//   - division facts, the exact inverse of the above: a ÷ b = c, with
//     a = b * c for some b, c both in [1,10] (i.e. only dividing a number
//     that IS a product from the evidenced 10x10 table, by one of its
//     evidenced factors)
// Scope, deliberately excluded (no CAPS basis in this grade's own
// record, or an open evidence gap as documented above):
//   - addition and subtraction (evidence gap — see above)
//   - any operand or result above the stated 10x10 ceiling
//   - any difficulty band, tier, or magnitude envelope (none authorized
//     for any Mental Maths grade — ADR-022 §5 Governance Rule 3)
//
// Product-level choices NOT prescribed by CAPS, made conservatively and
// documented here rather than escalated as a governance question,
// mirroring the choices already made for Grades 1-3:
//   - both multiplication factors are drawn independently from [1,10]
//     (not "table x multiplier" as in Grade 3, since Grade 4's evidence
//     names no specific table(s) — it authorizes the whole 10x10 range).
//   - division facts are constructed as the exact inverse of a drawn
//     multiplication fact (dividend = product, divisor = one factor,
//     quotient = the other), so every division fact generated here is
//     also a multiplication fact CAPS separately authorizes — mirroring
//     the same evidence-preserving construction used in
//     mentalMathsGrade3Service.js.
//   - exact duplicate prompts within one session are discarded and
//     redrawn, mirroring the existing Grade 1/2/3/5 services.

'use strict';

const MIN_GRADE = 4;
const MAX_GRADE = 4;
const FACTOR_MIN = 1;
const FACTOR_MAX = 10; // "at least 10 x 10" — the evidenced ceiling

/**
 * Simple seeded PRNG (mulberry32) — same choice as the existing Grade
 * 1/2/3/5 and Senior Phase services, for consistency and reproducibility
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
 * Generates one multiplication fact within the evidenced 10x10 range:
 * a × b = c, both a and b in [1,10].
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
 * a and b both in [1,10].
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

const TOPICS = [
  { key: 'mulFacts10x10', label: 'Multiplication facts to 10 × 10' },
  { key: 'divFacts10x10', label: 'Division facts (inverse of 10 × 10)' },
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
 * Builds a Grade 4 Mental Maths session.
 *
 * Mirrors the session-builder contract of mentalMathsGrade1/2/3Service.js
 * exactly — same return shape ({grade, questions: [{strand, prompt,
 * canonicalAnswer}]}) — so mentalMathsSessionService.js can consume any of
 * the generator services identically.
 *
 * @param {Object} opts
 * @param {number} [opts.count=12]
 * @param {number} [opts.seed]
 * @param {string} [opts.topic='mixed'] - 'mulFacts10x10' | 'divFacts10x10' | 'mixed'
 * @returns {{ grade: 4, questions: Array<{strand:string, prompt:string,
 *   canonicalAnswer:number}> }}
 */
function generateGrade4MentalMathsSet({ count = 12, seed, topic = DEFAULT_TOPIC } = {}) {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`generateGrade4MentalMathsSet: count must be a positive integer, got "${count}"`);
  }
  const validTopics = TOPICS.map((t) => t.key);
  if (!validTopics.includes(topic)) {
    throw new Error(`generateGrade4MentalMathsSet: topic must be one of ${validTopics.join(', ')}, got "${topic}"`);
  }

  const rand = mulberry32(seed != null ? seed : Date.now() ^ 0x47523400 /* "GR4\0" */);
  const seenPrompts = new Set();
  const questions = [];

  for (let i = 0; i < count; i++) {
    const op = topic === 'mixed' ? (i % 2 === 0 ? 'mul' : 'div') : (topic === 'mulFacts10x10' ? 'mul' : 'div');
    let attempt = 0;
    let item;
    do {
      item = op === 'mul' ? generateMultiplicationFact(rand) : generateDivisionFact(rand);
      attempt++;
    } while (seenPrompts.has(item.prompt) && attempt < 25);
    seenPrompts.add(item.prompt);
    questions.push({
      strand: item.op === 'mul' ? 'mulFacts10x10' : 'divFacts10x10',
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
  TOPICS,
  DEFAULT_TOPIC,
  isSupportedGrade,
  generateMultiplicationFact,
  generateDivisionFact,
  generateGrade4MentalMathsSet,
};