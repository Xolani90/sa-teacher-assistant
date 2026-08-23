// services/mentalMathsService.js
//
// Mental Maths (V1) — deterministic question/answer generation for
// Grades 7-9 mental-fluency practice.
//
// Why deterministic: unlike worksheet/test/lessonPlan (where the AI
// authors the content and the human teacher is the check), a "mental
// maths" set is explicitly marketed to teachers as fast, low-stakes
// arithmetic fluency practice — the whole point is that the answers are
// exactly right, every time, with no possibility of an AI arithmetic
// slip. So this service computes every question and its canonical
// answer with plain JS arithmetic. The AI (see prompts/mentalMaths.js)
// is only ever used downstream to wrap this in friendly WhatsApp
// wording — it is never given the opportunity to compute or alter an
// answer.
//
// Six strands, cycled evenly across a session so no single skill
// dominates:
//   1. addSub        - addition & subtraction facts
//   2. mulDiv         - multiplication & division facts
//   3. fracDecPercent - fraction/decimal/percentage equivalence
//   4. roundEstimate  - rounding & estimation
//   5. squareRoot     - squares, cubes, square/cube roots
//   6. ratioRate      - simple ratio & rate problems
//
// NOTE: Mental Maths deliberately does NOT model its six strands as
// CAPS ATP topics (see core/generationPipeline.js ATP_GROUNDED_TYPES —
// mentalMaths is intentionally excluded) — this is fast-fire fluency
// practice, not a CAPS-topic-aligned generator, so ATP grounding /
// topic warnings don't apply to it.

'use strict';

const STRANDS = ['addSub', 'mulDiv', 'fracDecPercent', 'roundEstimate', 'squareRoot', 'ratioRate'];

const MIN_GRADE = 7;
const MAX_GRADE = 9;

/**
 * @param {number} grade
 * @returns {boolean}
 */
function isSupportedGrade(grade) {
  return Number.isInteger(grade) && grade >= MIN_GRADE && grade <= MAX_GRADE;
}

/**
 * Simple seeded PRNG (mulberry32) so a given (grade, strand, index, seed)
 * always produces the same question — makes generation reproducible for
 * tests and lets "regenerate" reliably produce a *different* set by
 * varying the seed, without reaching for a heavier dependency.
 * @param {number} seed
 * @returns {() => number} function returning a float in [0, 1)
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

/**
 * @param {() => number} rand
 * @param {number} min inclusive
 * @param {number} max inclusive
 */
function randInt(rand, min, max) {
  return min + Math.floor(rand() * (max - min + 1));
}

function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}

// Grade-scaled numeric ranges. Grade 9 gets larger/more negative-friendly
// ranges than Grade 7, per CAPS progression expectations for mental
// fluency at each phase of the Senior Phase.
function rangeFor(grade, strand) {
  const g = grade - MIN_GRADE; // 0, 1, 2
  switch (strand) {
    case 'addSub':
      return { min: -(10 + g * 40), max: 20 + g * 80 };
    case 'mulDiv':
      return { min: 2, max: 10 + g * 5 };
    case 'squareRoot':
      return { min: 2, max: 12 + g * 3 };
    default:
      return { min: 1, max: 100 };
  }
}

// ── Strand generators ─────────────────────────────────────────────────
// Each returns { prompt, canonicalAnswer, workingNote }.
// canonicalAnswer is always a primitive (number or exact string) so
// equality checks in tests and downstream duplicate-detection are exact,
// never floating-point-fuzzy.

function genAddSub(rand, grade) {
  const { min, max } = rangeFor(grade, 'addSub');
  const a = randInt(rand, min, max);
  const b = randInt(rand, min, max);
  const op = pick(rand, ['+', '-']);
  const answer = op === '+' ? a + b : a - b;
  return { prompt: `${a} ${op} ${b}`, canonicalAnswer: answer };
}

function genMulDiv(rand, grade) {
  const { min, max } = rangeFor(grade, 'mulDiv');
  const op = pick(rand, ['×', '÷']);
  if (op === '×') {
    const a = randInt(rand, min, max);
    const b = randInt(rand, min, max);
    return { prompt: `${a} × ${b}`, canonicalAnswer: a * b };
  }
  // Construct division so it's always exact (no fractional mental-maths
  // answers) — pick the quotient and divisor first, derive the dividend.
  const divisor = randInt(rand, min, max);
  const quotient = randInt(rand, min, max);
  const dividend = divisor * quotient;
  return { prompt: `${dividend} ÷ ${divisor}`, canonicalAnswer: quotient };
}

const NICE_FRACTIONS = [
  { fraction: '1/2', decimal: 0.5, percent: 50 },
  { fraction: '1/4', decimal: 0.25, percent: 25 },
  { fraction: '3/4', decimal: 0.75, percent: 75 },
  { fraction: '1/5', decimal: 0.2, percent: 20 },
  { fraction: '2/5', decimal: 0.4, percent: 40 },
  { fraction: '1/10', decimal: 0.1, percent: 10 },
  { fraction: '3/10', decimal: 0.3, percent: 30 },
  { fraction: '1/8', decimal: 0.125, percent: 12.5 },
  { fraction: '3/8', decimal: 0.375, percent: 37.5 },
  { fraction: '1/20', decimal: 0.05, percent: 5 },
];

function genFracDecPercent(rand, grade) {
  const item = pick(rand, NICE_FRACTIONS);
  const askFor = pick(rand, ['decimal', 'percent']);
  if (askFor === 'decimal') {
    return { prompt: `Write ${item.fraction} as a decimal`, canonicalAnswer: item.decimal };
  }
  return { prompt: `Write ${item.fraction} as a percentage`, canonicalAnswer: `${item.percent}%` };
}

function genRoundEstimate(rand, grade) {
  const g = grade - MIN_GRADE;
  const magnitude = pick(rand, [10, 100, 1000].slice(0, 2 + g)); // more magnitudes unlocked at higher grades
  const base = randInt(rand, 1, 20) * magnitude;
  const offset = randInt(rand, 1, Math.floor(magnitude / 2) - 1 || 1);
  const number = base + offset;
  const rounded = Math.round(number / magnitude) * magnitude;
  return { prompt: `Round ${number} to the nearest ${magnitude}`, canonicalAnswer: rounded };
}

function genSquareRoot(rand, grade) {
  const { min, max } = rangeFor(grade, 'squareRoot');
  const useCube = grade >= 8 && rand() < 0.3;
  const n = randInt(rand, min, max);
  if (useCube) {
    const asRoot = rand() < 0.5;
    return asRoot
      ? { prompt: `∛${n * n * n}`, canonicalAnswer: n }
      : { prompt: `${n}³`, canonicalAnswer: n * n * n };
  }
  const asRoot = rand() < 0.5;
  return asRoot
    ? { prompt: `√${n * n}`, canonicalAnswer: n }
    : { prompt: `${n}²`, canonicalAnswer: n * n };
}

function genRatioRate(rand, grade) {
  const total = randInt(rand, 2, 12) * randInt(rand, 2, 6);
  const parts = randInt(rand, 2, 6);
  // Ensure total divides evenly by parts for a clean mental answer.
  const share = Math.max(1, Math.round(total / parts));
  const cleanTotal = share * parts;
  return {
    prompt: `Share ${cleanTotal} sweets equally among ${parts} learners. How many does each learner get?`,
    canonicalAnswer: share,
  };
}

const GENERATORS = {
  addSub: genAddSub,
  mulDiv: genMulDiv,
  fracDecPercent: genFracDecPercent,
  roundEstimate: genRoundEstimate,
  squareRoot: genSquareRoot,
  ratioRate: genRatioRate,
};

/**
 * Generates one question for a given strand.
 * @param {() => number} rand
 * @param {number} grade
 * @param {string} strand
 */
function generateQuestion(rand, grade, strand) {
  const gen = GENERATORS[strand];
  if (!gen) throw new Error(`generateQuestion: unknown strand "${strand}"`);
  const { prompt, canonicalAnswer } = gen(rand, grade);
  return { strand, prompt, canonicalAnswer };
}

/**
 * Builds a full Mental Maths session: an ordered list of questions
 * cycling evenly through all six strands, with exact duplicate prompts
 * within the same session prevented (retries with a fresh draw, capped
 * to avoid an infinite loop on pathologically small ranges).
 *
 * @param {Object} opts
 * @param {number} opts.grade - must be 7, 8, or 9
 * @param {number} [opts.count=12] - number of questions to generate
 * @param {number} [opts.seed] - RNG seed; defaults to a value derived
 *   from Date.now() so repeated calls without a seed vary, but a fixed
 *   seed always reproduces the same set (used by tests).
 * @returns {{ grade: number, questions: Array<{strand:string, prompt:string, canonicalAnswer:*}> }}
 */
function generateMentalMathsSet({ grade, count = 12, seed } = {}) {
  if (!isSupportedGrade(grade)) {
    throw new Error(`generateMentalMathsSet: unsupported grade "${grade}" — Mental Maths V1 supports Grades ${MIN_GRADE}-${MAX_GRADE} only`);
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`generateMentalMathsSet: count must be a positive integer, got "${count}"`);
  }

  const rand = mulberry32(seed != null ? seed : Date.now() ^ (grade * 2654435761));
  const seenPrompts = new Set();
  const questions = [];

  for (let i = 0; i < count; i++) {
    const strand = STRANDS[i % STRANDS.length];
    let attempt = 0;
    let question;
    do {
      question = generateQuestion(rand, grade, strand);
      attempt++;
    } while (seenPrompts.has(question.prompt) && attempt < 25);
    seenPrompts.add(question.prompt);
    questions.push(question);
  }

  return { grade, questions };
}

module.exports = {
  STRANDS,
  MIN_GRADE,
  MAX_GRADE,
  isSupportedGrade,
  generateMentalMathsSet,
  // exported for direct/unit testing of individual strand generators
  _internal: { mulberry32, randInt, generateQuestion, GENERATORS, NICE_FRACTIONS },
};
