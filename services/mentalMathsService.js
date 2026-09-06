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

// ── Senior Phase family path ───────────────────────────────────────────
//
// ⚠ PROVENANCE NOTICE — factual correction, no behaviour change.
//
// This block previously described itself as implementing a frozen
// "Senior Generation Policy v1.0", via a governance chain
// "ADR-022 -> Senior Taxonomy v1.0 (frozen) -> Senior Generation Policy
// v1.0 (frozen) -> this implementation". That chain is not what this
// repository contains. Verified against repository history:
//
//  * The only Senior Phase generation policy present is
//    docs/specs/mental-maths/Senior_Phase_Generation_Policy_v1_0_PROPOSED.md
//    (added d8bf605), whose own header reads "PROPOSED FRAMEWORK — NOT YET
//    FROZEN — NOT IMPLEMENTATION-AUTHORITATIVE", whose §4 states no
//    candidate is generation-eligible, and whose §8 states implementation
//    is "Not authorized; existing AUTHORIZED_FAMILIES entries are not
//    retroactively validated by this policy".
//  * The only Senior taxonomy present is
//    Senior_Taxonomy_v1.0_Working_Skeleton.md (a033921), headed "NOT
//    AUTHORITATIVE / NOT FROZEN".
//  * The Senior Phase policy/methodology/approval commits cited by
//    docs/governance/Grade5_C12_C13_ADR023_Section6_Freeze_Act.md §6
//    (4a1367f, 54dfef2, 676155e) are not present in this repository.
//  * ADR-022 §6 records this Senior Phase service as legacy, built before
//    the specification discipline, and §5 Governance Rule 2 states that
//    existing code is not specification authority.
//
// The constants and generators below are therefore left EXACTLY as they
// shipped — not widened, not narrowed, not removed. Whether Grades 7-8
// generation should remain live, be re-scoped to match the proposed
// policy's §2 table (which authorizes ratioSharing at G7-G8, and splits
// powersRootsFluency into integer G7-G8 / rational G8-only), or be gated
// pending an ADR-023 §6 freeze act is a Project Owner decision. Nothing
// here decides it; this comment only stops the code from asserting an
// authorization the repository does not evidence.
//
// Deliberately separate from the six-strand legacy path above:
//  - Legacy STRANDS/GENERATORS/generateMentalMathsSet are left completely
//    unmodified (still exported, still callable, still cycle all six
//    strands including addSub/fracDecPercent/roundEstimate).
//  - The three functions/maps below give the three families listed in
//    AUTHORIZED_FAMILIES (flat domains, no grade-scaling, single-family
//    sessions, genuine ratio-sharing) their own entry point that has no
//    code path to the three other strands at all — this is a structural
//    exclusion, not a runtime guard.
//  - addSub, fracDecPercent, and roundEstimate remain OPEN in the
//    taxonomy (not rejected, not yet authorized) — their generators and
//    tests are untouched; they are simply unreachable from here.

const AUTHORIZED_FAMILIES = ['mulDivFluency', 'powersRootsFluency', 'ratioSharing', 'ratioRate'];

// Family x grade matrix as shipped. See the PROVENANCE NOTICE above: this
// is the live, as-built matrix, not a matrix traceable to a frozen policy
// in this repository, and it does not match the proposed policy's §2 table.
// Enforced here, at the service boundary, not left to the caller
// (generationPipeline.js) — see reviewer requirement: relying solely on
// dispatch-layer enforcement would make the specification boundary
// caller-dependent. generateFamilySession() below independently rejects
// any combination not listed here, regardless of what any caller passes.
const FAMILY_GRADE_AUTHORIZATION = {
  mulDivFluency: [7, 8],
  powersRootsFluency: [7, 8],
  ratioSharing: [7],
  // ratioRate: D2, ADR-023 §6 freeze act (Project Owner: Xolani
  // Tshabalala, 6 September 2026) — see
  // docs/specs/mental-maths/CY79_PO_01_Decision_Act__PROPOSED.md, now
  // recorded as ACCEPTED / FROZEN.
  ratioRate: [9],
};

function isAuthorizedFamilyGrade(family, grade) {
  const grades = FAMILY_GRADE_AUTHORIZATION[family];
  return Array.isArray(grades) && grades.includes(grade);
}

// Flat, grade-independent domains as built — no per-grade scaling for any
// of the three families. Per the PROVENANCE NOTICE above, these values have
// no traceable specification source in this repository; the proposed Senior
// Phase policy's §10 item 2 explicitly records numeric/operand ranges as
// "not specified for any candidate" and states that existing code values
// carry no evidentiary weight. Left unchanged. Kept separate from
// rangeFor() above, which remains the grade-scaled legacy source used by
// genMulDiv/genSquareRoot via GENERATORS (the legacy six-strand path).
const FLAT_RANGES = {
  mulDiv: { min: 1, max: 12 },
  squareRoot: { min: 1, max: 12 }, // square / square-root component
  cube: { min: 1, max: 6 },        // cube / cube-root component
};

function genMulDivFlat(rand) {
  const { min, max } = FLAT_RANGES.mulDiv;
  const op = pick(rand, ['×', '÷']);
  if (op === '×') {
    const a = randInt(rand, min, max);
    const b = randInt(rand, min, max);
    return { prompt: `${a} × ${b}`, canonicalAnswer: a * b };
  }
  // Exact construction, same technique as legacy genMulDiv: pick
  // quotient/divisor first, derive the dividend, so division is always
  // exact.
  const divisor = randInt(rand, min, max);
  const quotient = randInt(rand, min, max);
  const dividend = divisor * quotient;
  return { prompt: `${dividend} ÷ ${divisor}`, canonicalAnswer: quotient };
}

function genPowersRootsUniform(rand) {
  // Single-stage uniform selection across all four forms, as built —
  // replaces legacy genSquareRoot's two-stage biased
  // selection (30% cube gate at grade>=8, then 50/50 root-vs-power).
  const form = pick(rand, ['square', 'squareRoot', 'cube', 'cubeRoot']);
  if (form === 'square') {
    const n = randInt(rand, FLAT_RANGES.squareRoot.min, FLAT_RANGES.squareRoot.max);
    return { prompt: `${n}²`, canonicalAnswer: n * n };
  }
  if (form === 'squareRoot') {
    const n = randInt(rand, FLAT_RANGES.squareRoot.min, FLAT_RANGES.squareRoot.max);
    return { prompt: `√${n * n}`, canonicalAnswer: n };
  }
  if (form === 'cube') {
    const n = randInt(rand, FLAT_RANGES.cube.min, FLAT_RANGES.cube.max);
    return { prompt: `${n}³`, canonicalAnswer: n * n * n };
  }
  // cubeRoot
  const n = randInt(rand, FLAT_RANGES.cube.min, FLAT_RANGES.cube.max);
  return { prompt: `∛${n * n * n}`, canonicalAnswer: n };
}

/**
 * Greatest common divisor — Euclidean algorithm. Used to deterministically
 * enforce the as-built gcd(a,b)=1 ratio-canonicalization invariant
 * (direct construction, not rejection sampling): draw a raw pair and
 * reduce it by its gcd. 1:1 is a valid canonical ratio here
 * (gcd(1,1)=1) and is never rejected — this is the one
 * explicit, testable method for guaranteeing every generated ratio is
 * coprime with two genuine (non-zero) parts.
 */
function gcd(a, b) {
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

function genRatioSharing(rand) {
  // Draw a raw pair in 1-6 and reduce to lowest terms. 1:1 is a valid,
  // permitted canonical ratio here (gcd(1,1)=1) and is NOT rejected —
  // a raw equal draw (e.g. 3,3)
  // correctly reduces to 1:1 rather than being redrawn.
  let a = randInt(rand, 1, 6);
  let b = randInt(rand, 1, 6);
  const divisor = gcd(a, b);
  a = a / divisor;
  b = b / divisor;

  const multiplier = randInt(rand, 1, 10);
  const total = (a + b) * multiplier;
  const shareA = a * multiplier;
  const shareB = b * multiplier;

  return {
    prompt: `Share ${total} in the ratio ${a}:${b}`,
    canonicalAnswer: [shareA, shareB],
  };
}

const GENERATORS_FAMILY = {
  mulDivFluency: genMulDivFlat,
  powersRootsFluency: genPowersRootsUniform,
  ratioSharing: genRatioSharing,
  // genRatioRateItem is defined further below (function declaration —
  // hoisted, so this reference is safe) and returns { prompt,
  // canonicalAnswer, form }; generateFamilySession() below only reads
  // prompt/canonicalAnswer from whatever gen() returns, so the extra
  // `form` field is simply ignored for this family, same as every
  // other family here.
  ratioRate: (rand) => genRatioRateItem(rand),
};

/**
 * Builds a single-family Mental Maths session — every question drawn from
 * exactly one family in AUTHORIZED_FAMILIES, no cross-family mixing.
 * See the PROVENANCE NOTICE above for this path's specification status.
 *
 * Distinct from generateMentalMathsSet() above, which is left completely
 * unchanged and continues to cycle all six legacy strands evenly.
 *
 * @param {Object} opts
 * @param {number} opts.grade
 * @param {string} opts.family - one of AUTHORIZED_FAMILIES
 * @param {number} [opts.count=12]
 * @param {number} [opts.seed]
 * @returns {{ grade: number, family: string, questions: Array<{strand:string, prompt:string, canonicalAnswer:*}> }}
 */
function generateFamilySession({ grade, family, count = 12, seed } = {}) {
  if (!AUTHORIZED_FAMILIES.includes(family)) {
    throw new Error(`generateFamilySession: unknown or unauthorized family "${family}" — must be one of ${AUTHORIZED_FAMILIES.join(', ')}`);
  }
  if (!isAuthorizedFamilyGrade(family, grade)) {
    throw new Error(`generateFamilySession: family "${family}" is not authorized for grade "${grade}" — grades listed for it are ${FAMILY_GRADE_AUTHORIZATION[family].join(', ')}`);
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`generateFamilySession: count must be a positive integer, got "${count}"`);
  }

  const gen = GENERATORS_FAMILY[family];
  const rand = mulberry32(seed != null ? seed : Date.now() ^ (grade * 2654435761));
  const seenPrompts = new Set();
  const questions = [];

  for (let i = 0; i < count; i++) {
    let attempt = 0;
    let question;
    do {
      const { prompt, canonicalAnswer } = gen(rand);
      question = { strand: family, prompt, canonicalAnswer };
      attempt++;
    } while (seenPrompts.has(question.prompt) && attempt < 25);
    seenPrompts.add(question.prompt);
    questions.push(question);
  }

  return { grade, family, questions };
}

// ── ratioRate (ACCEPTED / FROZEN — AUTHORIZED, G9 only) ─────────────────
//
// STATUS: ACCEPTED — Project Owner acceptance and ADR-023 §6 freeze act
// recorded 6 September 2026 (Project Owner: Xolani Tshabalala) over the
// D1–D7 design in
// docs/specs/mental-maths/CY79_RatioRate_Generation_Specification_DESIGN_PROPOSAL.md
// and docs/specs/mental-maths/CY79_PO_01_Decision_Act__PROPOSED.md (see
// that file's own header/footer for the acceptance record). This freeze
// act does NOT extend to ratioSharing or to any other candidate; D7
// explicitly leaves ratioSharing separate and unresolved.
//
// 'ratioRate' is listed in AUTHORIZED_FAMILIES and
// FAMILY_GRADE_AUTHORIZATION (G9 only, per D2) above, and genRatioRateItem
// is wired into GENERATORS_FAMILY above — so generateFamilySession() is
// its one production entry point, same as mulDivFluency/
// powersRootsFluency/ratioSharing. No separate "proposed" code path
// exists for it any more.
//
// D1 — item forms (deterministic resolver, no LLM arithmetic):
//   RR-1: distance = speed × time   (distance unknown)
//   RR-2: speed    = distance ÷ time (speed unknown)
//   RR-3: time     = distance ÷ speed (time unknown)
// D2 — grade scope: G9 only (conservative narrowing of the accepted
//   G7–G9 governance scope from CY62-PO-01 — NOT a claim that CAPS
//   requires G9-only).
// D3 — numeric ranges (implementation constraints, not CAPS claims):
//   speed 1–200 (km/h), time 1–180 min or 1–12 h, distance 1–1000 (km).
// D4 — exactness: canonical answer must be an exact terminating decimal,
//   max 2 decimal places; items that cannot resolve exactly within the
//   configured ranges are discarded and regenerated (bounded attempts).
// D5/D6 — generation constraints & exclusions: exactly one unknown,
//   exactly two knowns, positive quantities only, single compatible
//   time unit per item, no ratioSharing content, no direct/indirect
//   proportion content, no multi-unknown items.

const RATIO_RATE_RANGES = Object.freeze({
  speed: Object.freeze({ min: 1, max: 200 }),        // km/h
  timeMinutes: Object.freeze({ min: 1, max: 180 }),  // minutes
  timeHours: Object.freeze({ min: 1, max: 12 }),     // hours
  distance: Object.freeze({ min: 1, max: 1000 }),    // km
});

const RATIO_RATE_FORMS = Object.freeze(['RR-1', 'RR-2', 'RR-3']);

/**
 * Rounds to at most 2 decimal places using integer-cent-style arithmetic
 * to avoid the usual binary floating point drift.
 * @param {number} n
 */
function roundTo2dp(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * True if n, once rounded to 2dp, is indistinguishable from its exact
 * value to within floating-point tolerance — i.e. n is a terminating
 * decimal of at most 2 decimal places (D4's exactness rule).
 * @param {number} n
 */
function isExactTo2dp(n) {
  return Math.abs(n - roundTo2dp(n)) < 1e-9;
}

/**
 * Generates a single deterministic ratioRate (speed/distance/time) item.
 * The LLM never computes or alters this — prompt and canonicalAnswer are
 * both derived here with plain arithmetic, matching this file's overall
 * "deterministic generation" design (see file header).
 *
 * Draws candidate (speed, time) pairs and only accepts a form/pair
 * combination whose resulting canonical answer is an exact terminating
 * decimal within D3's configured ranges (D4). Bounded retry, not
 * unbounded — an exhausted budget throws rather than silently returning
 * an inexact or out-of-range item.
 *
 * @param {() => number} rand
 * @returns {{ prompt: string, canonicalAnswer: number, form: string }}
 */
function genRatioRateItem(rand) {
  const MAX_ATTEMPTS = 100;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const form = pick(rand, RATIO_RATE_FORMS);
    const useHours = rand() < 0.5;
    const timeRange = useHours ? RATIO_RATE_RANGES.timeHours : RATIO_RATE_RANGES.timeMinutes;
    const unitLabel = useHours ? 'h' : 'min';

    const speed = randInt(rand, RATIO_RATE_RANGES.speed.min, RATIO_RATE_RANGES.speed.max);
    const time = randInt(rand, timeRange.min, timeRange.max);
    const timeInHours = useHours ? time : time / 60;

    const rawDistance = speed * timeInHours;
    if (!isExactTo2dp(rawDistance)) continue;
    const distance = roundTo2dp(rawDistance);
    if (distance < RATIO_RATE_RANGES.distance.min || distance > RATIO_RATE_RANGES.distance.max) continue;

    if (form === 'RR-1') {
      // Distance unknown: given speed and time.
      return {
        form,
        prompt: `A car travels at ${speed} km/h for ${time} ${unitLabel}. How far does it travel, in km?`,
        canonicalAnswer: distance,
      };
    }

    if (form === 'RR-2') {
      // Speed unknown: given distance and time.
      const rawSpeed = distance / timeInHours;
      if (!isExactTo2dp(rawSpeed)) continue;
      const computedSpeed = roundTo2dp(rawSpeed);
      if (computedSpeed < RATIO_RATE_RANGES.speed.min || computedSpeed > RATIO_RATE_RANGES.speed.max) continue;
      return {
        form,
        prompt: `A car travels ${distance} km in ${time} ${unitLabel}. What is its speed, in km/h?`,
        canonicalAnswer: computedSpeed,
      };
    }

    // RR-3: time unknown: given distance and speed. Always express the
    // answer in hours so the unit is unambiguous regardless of which
    // time unit was drawn for the underlying construction.
    const rawTimeHours = distance / speed;
    if (!isExactTo2dp(rawTimeHours)) continue;
    const computedTimeHours = roundTo2dp(rawTimeHours);
    return {
      form,
      prompt: `A car travels ${distance} km at a speed of ${speed} km/h. How long does the journey take, in hours?`,
      canonicalAnswer: computedTimeHours,
    };
  }
  throw new Error('genRatioRateItem: could not construct an exact ratioRate item within the configured ranges after 100 attempts');
}

module.exports = {
  STRANDS,
  MIN_GRADE,
  MAX_GRADE,
  isSupportedGrade,
  generateMentalMathsSet,
  // Senior Phase family path — see the PROVENANCE NOTICE in this file
  AUTHORIZED_FAMILIES,
  FAMILY_GRADE_AUTHORIZATION,
  generateFamilySession,
  // exported for direct/unit testing of individual strand generators
  _internal: {
    mulberry32, randInt, generateQuestion, GENERATORS, NICE_FRACTIONS, GENERATORS_FAMILY, gcd,
    genRatioRateItem, roundTo2dp, isExactTo2dp, RATIO_RATE_RANGES,
  },
};
