// services/mentalMathsGrade3Service.js
//
// Mental Maths — Grade 3 Arithmetic Fluency.
//
// Scope authority: docs/specs/mental-maths/
//   R12_Mental_Maths_Generation_Permission_Policy_v1_0_FROZEN.md §3.1
//   (PRESENT -> DEDICATED -> EXPLICIT, Grades 1/2/3/4/6/7; PERMITTED,
//   scoped strictly to each grade's own evidenced recall range).
//
// CAPS evidence for Grade 3's own range (Foundation Phase CAPS,
// Mathematics Grade 1-3, Clarification of Grade 3 content, §1.16
// "Mental mathematics" — verified directly against Grade 3's own Term 1
// and Term 4 "REQUIREMENT BY YEAR END" columns, which state the identical
// figures, confirming no drift across the year; this is Grade 3's OWN
// evidence, not inherited from Grade 2 or Grade 4 merely because Grade 3
// sits between them):
//   - "Rapidly recall: Addition and subtraction facts to 20"
//   - "Add or subtract multiples of [10] from [0] to [100]" (Term 4's
//     "Focus for Term 4" column realises this with worked examples: e.g.
//     "Say how many steps must be taken on a number line to get from 30
//     to 100", "Find pairs of cards to make 100", "20 + [ ] = 100",
//     "100 - 40 = [ ]" — all pairs of multiples of 10 within 0-100)
//   - "Multiplication and division facts for the: two times table up to
//     [20]; ten times table up to [100]"
//
// Unlike Grade 4's evidence ("at least 10 x 10", no named table), Grade
// 3's own record names exactly two specific tables — the two times table
// and the ten times table — so this service does NOT draw both factors
// independently the way Grade 4/6 do; it mirrors the "table x multiplier"
// construction that Grade 3's narrower, table-named evidence actually
// supports (documented in the R12 policy's own note on this distinction).
//
// Scope, evidenced:
//   - addition/subtraction facts to 20 (identical construction to
//     mentalMathsGrade2Service.js — this is Grade 3's own restated
//     year-end target, not an assumption that Grade 3 "still does" what
//     Grade 2 did)
//   - addition/subtraction of multiples of 10, within 0-100: a + b = c or
//     a - b = c, with a, b, c all multiples of 10 in [0,100]
//   - multiplication facts for the 2x and 10x tables: table * multiplier
//     = product, table in {2,10}, multiplier in [1,10] (2x table "up to
//     20" = 2x1..2x10; 10x table "up to 100" = 10x1..10x10)
//   - division facts, the exact inverse of the above: product / table =
//     multiplier, for the same {2,10} tables
// Scope, deliberately excluded (no CAPS basis in this grade's own
// record):
//   - any times table other than 2x and 10x (no evidence for 5x, 3x, etc.
//     in Grade 3's own record — that is Grade 5/Senior Phase territory)
//   - any operand or result above the stated ceilings (20 for add/sub
//     facts, 100 for multiples-of-10 and the 10x table)
//   - any difficulty band, tier, or magnitude envelope (none authorized
//     for any Mental Maths grade — ADR-022 §5 Governance Rule 3)
//
// Product-level choices NOT prescribed by CAPS, made conservatively and
// documented here rather than escalated as a governance question,
// mirroring the choices already made for Grades 1/2/4/6:
//   - addFacts20/subFacts20 items use the exact same construction as
//     mentalMathsGrade2Service.js (sum/minuend drawn first, so every draw
//     is valid by construction; 0 is a valid part).
//   - addSub multiples-of-10 items: the sum c (for addition) or minuend a
//     (for subtraction) is drawn as a multiple of 10 in [0,100], then
//     decomposed into two multiples of 10, mirroring the addFacts20
//     construction scaled to this range — every accepted pair is exactly
//     "multiples of 10 within 0-100" per the CAPS wording.
//   - mulTables2and10/divTables2and10 items: table is drawn uniformly
//     from {2,10} (not weighted), multiplier from [1,10]; division facts
//     are the exact inverse of a drawn multiplication fact, mirroring
//     mentalMathsGrade4Service.js's evidence-preserving construction.
//   - exact duplicate prompts within one session are discarded and
//     redrawn, mirroring the existing Grade 1/2/4/5/6 services' approach.

'use strict';

const MIN_GRADE = 3;
const MAX_GRADE = 3;
const ADD_SUB_FACT_LIMIT = 20; // "facts to 20" — the evidenced ceiling
const MULTIPLES_OF_10_MAX = 100; // "multiples of 10 from 0 to 100"
const TABLES = [2, 10]; // the two evidenced times tables
const TABLE_MULTIPLIER_MIN = 1;
const TABLE_MULTIPLIER_MAX = 10;

/**
 * Simple seeded PRNG (mulberry32) — same choice as the existing Grade
 * 1/2/4/5/6 and Senior Phase services, for consistency and reproducibility
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

function randChoice(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}

/**
 * Generates one addition fact within the evidenced "facts to 20" range:
 * a + b = c, c <= 20. Construction identical to
 * mentalMathsGrade2Service.js#generateAdditionFact.
 * @param {() => number} rand
 * @returns {{op:'add', a:number, b:number, result:number, prompt:string,
 *   canonicalAnswer:number}}
 */
function generateAdditionFact(rand) {
  const c = randInt(rand, 1, ADD_SUB_FACT_LIMIT);
  const a = randInt(rand, 0, c);
  const b = c - a;
  const prompt = `${a} + ${b} = ?`;
  return { op: 'add', a, b, result: c, prompt, canonicalAnswer: c };
}

/**
 * Generates one subtraction fact within the evidenced "facts to 20"
 * range: a - b = c, a <= 20, b in [0,a], c >= 0. Construction identical to
 * mentalMathsGrade2Service.js#generateSubtractionFact.
 * @param {() => number} rand
 * @returns {{op:'sub', a:number, b:number, result:number, prompt:string,
 *   canonicalAnswer:number}}
 */
function generateSubtractionFact(rand) {
  const a = randInt(rand, 1, ADD_SUB_FACT_LIMIT);
  const b = randInt(rand, 0, a);
  const c = a - b;
  const prompt = `${a} - ${b} = ?`;
  return { op: 'sub', a, b, result: c, prompt, canonicalAnswer: c };
}

/**
 * Generates one addition-of-multiples-of-10 fact within [0,100]:
 * a + b = c, all of a, b, c multiples of 10, c <= 100. The sum c is drawn
 * first (as a multiple of 10) and decomposed, so every draw is valid by
 * construction.
 * @param {() => number} rand
 * @returns {{op:'addTens', a:number, b:number, result:number,
 *   prompt:string, canonicalAnswer:number}}
 */
function generateAddTensFact(rand) {
  const cTens = randInt(rand, 1, MULTIPLES_OF_10_MAX / 10); // 1..10 tens
  const aTens = randInt(rand, 0, cTens);
  const a = aTens * 10;
  const b = (cTens - aTens) * 10;
  const c = cTens * 10;
  const prompt = `${a} + ${b} = ?`;
  return { op: 'addTens', a, b, result: c, prompt, canonicalAnswer: c };
}

/**
 * Generates one subtraction-of-multiples-of-10 fact within [0,100]:
 * a - b = c, all of a, b, c multiples of 10, a <= 100.
 * @param {() => number} rand
 * @returns {{op:'subTens', a:number, b:number, result:number,
 *   prompt:string, canonicalAnswer:number}}
 */
function generateSubTensFact(rand) {
  const aTens = randInt(rand, 1, MULTIPLES_OF_10_MAX / 10); // 1..10 tens
  const bTens = randInt(rand, 0, aTens);
  const a = aTens * 10;
  const b = bTens * 10;
  const c = a - b;
  const prompt = `${a} - ${b} = ?`;
  return { op: 'subTens', a, b, result: c, prompt, canonicalAnswer: c };
}

/**
 * Generates one multiplication fact for the evidenced 2x or 10x table:
 * table * multiplier = product, table in {2,10}, multiplier in [1,10].
 * @param {() => number} rand
 * @returns {{op:'mulTable', a:number, b:number, result:number,
 *   prompt:string, canonicalAnswer:number}}
 */
function generateMulTableFact(rand) {
  const table = randChoice(rand, TABLES);
  const multiplier = randInt(rand, TABLE_MULTIPLIER_MIN, TABLE_MULTIPLIER_MAX);
  const product = table * multiplier;
  const prompt = `${table} × ${multiplier} = ?`;
  return { op: 'mulTable', a: table, b: multiplier, result: product, prompt, canonicalAnswer: product };
}

/**
 * Generates one division fact as the exact inverse of an evidenced 2x/10x
 * multiplication fact: product / table = multiplier.
 * @param {() => number} rand
 * @returns {{op:'divTable', a:number, b:number, result:number,
 *   prompt:string, canonicalAnswer:number}}
 */
function generateDivTableFact(rand) {
  const table = randChoice(rand, TABLES);
  const multiplier = randInt(rand, TABLE_MULTIPLIER_MIN, TABLE_MULTIPLIER_MAX);
  const product = table * multiplier;
  const prompt = `${product} ÷ ${table} = ?`;
  return { op: 'divTable', a: product, b: table, result: multiplier, prompt, canonicalAnswer: multiplier };
}

const TOPICS = [
  { key: 'addSubFacts20', label: 'Addition & subtraction facts to 20' },
  { key: 'addSubTens', label: 'Add & subtract multiples of 10 (to 100)' },
  { key: 'mulDivTables2and10', label: '2x and 10x tables (and division)' },
  { key: 'mixed', label: 'Mixed — all of the above' },
];
const DEFAULT_TOPIC = 'mixed';

// Ops drawn for each topic, in the order 'mixed' cycles through them.
const TOPIC_OPS = {
  addSubFacts20: ['add', 'sub'],
  addSubTens: ['addTens', 'subTens'],
  mulDivTables2and10: ['mulTable', 'divTable'],
  mixed: ['add', 'sub', 'addTens', 'subTens', 'mulTable', 'divTable'],
};

const GENERATORS = {
  add: generateAdditionFact,
  sub: generateSubtractionFact,
  addTens: generateAddTensFact,
  subTens: generateSubTensFact,
  mulTable: generateMulTableFact,
  divTable: generateDivTableFact,
};

/**
 * @param {number} grade
 * @returns {boolean}
 */
function isSupportedGrade(grade) {
  return Number.isInteger(grade) && grade >= MIN_GRADE && grade <= MAX_GRADE;
}

/**
 * Builds a Grade 3 Mental Maths session.
 *
 * Mirrors the session-builder contract of mentalMathsGrade1/2/4/6Service.js
 * exactly — same return shape ({grade, questions: [{strand, prompt,
 * canonicalAnswer}]}) — so mentalMathsSessionService.js can consume any of
 * the generator services identically.
 *
 * @param {Object} opts
 * @param {number} [opts.count=12]
 * @param {number} [opts.seed]
 * @param {string} [opts.topic='mixed']
 * @returns {{ grade: 3, questions: Array<{strand:string, prompt:string,
 *   canonicalAnswer:number}> }}
 */
function generateGrade3MentalMathsSet({ count = 12, seed, topic = DEFAULT_TOPIC } = {}) {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`generateGrade3MentalMathsSet: count must be a positive integer, got "${count}"`);
  }
  const validTopics = TOPICS.map((t) => t.key);
  if (!validTopics.includes(topic)) {
    throw new Error(`generateGrade3MentalMathsSet: topic must be one of ${validTopics.join(', ')}, got "${topic}"`);
  }

  const rand = mulberry32(seed != null ? seed : Date.now() ^ 0x47523300 /* "GR3\0" */);
  const seenPrompts = new Set();
  const questions = [];
  const ops = TOPIC_OPS[topic];

  for (let i = 0; i < count; i++) {
    const op = ops[i % ops.length];
    let attempt = 0;
    let item;
    do {
      item = GENERATORS[op](rand);
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
  ADD_SUB_FACT_LIMIT,
  MULTIPLES_OF_10_MAX,
  TABLES,
  TABLE_MULTIPLIER_MIN,
  TABLE_MULTIPLIER_MAX,
  TOPICS,
  DEFAULT_TOPIC,
  isSupportedGrade,
  generateAdditionFact,
  generateSubtractionFact,
  generateAddTensFact,
  generateSubTensFact,
  generateMulTableFact,
  generateDivTableFact,
  generateGrade3MentalMathsSet,
};