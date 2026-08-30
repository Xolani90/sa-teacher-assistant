// services/mentalMathsSessionService.js
//
// Mental Maths — grade-agnostic SESSION layer.
//
// This module owns everything about a Mental Maths session that is NOT
// mathematical content: which grades are actually available, which topics
// a given grade may choose from, how many questions, oral vs written
// delivery, deterministic answer-key construction, and deterministic
// WhatsApp rendering.
//
// It deliberately contains NO mathematics and NO curriculum decisions.
// Every question and every canonicalAnswer still comes from exactly one of
// the two existing, separately-governed generators:
//
//   - services/mentalMathsGrade5Service.js   — Grade 5, candidates C12/C13
//     (frozen: Grade5_Arithmetic_Fluency_Draft_v0.1_Consolidated.md §§3-4,
//      ADR-023 §6 freeze act, docs/governance/Grade5_C12_C13_ADR023_
//      Section6_Freeze_Act.md)
//   - services/mentalMathsService.js         — Senior Phase families
//     (AUTHORIZED_FAMILIES x FAMILY_GRADE_AUTHORIZATION). NOTE: unlike
//     Grade 5, this path's specification status is unresolved — see the
//     PROVENANCE NOTICE in that file. This module reads that matrix as the
//     live authorization data and neither widens nor narrows it; if the
//     Project Owner re-scopes or gates it, the grades and topics offered
//     here follow automatically, with no change needed in this file.
//
// ── What this module deliberately does NOT do ─────────────────────────
//
//  * It does not introduce a grade. SUPPORTED_GRADES is DERIVED from the
//    two generator services at load time — never hard-coded here. A grade
//    with no authorized generator simply does not appear, which is why
//    Grade 9 and Grades R-4/6/10-12 are absent: they have no frozen
//    specification authorizing generation (ADR-022 §5 Governance Rule 1).
//  * It does not introduce a candidate, family, item form, operand range
//    or magnitude envelope.
//  * It does not introduce ANY difficulty concept. There is no band, no
//    cutoff, no score, no weight, no Support/Core/Extension. Difficulty
//    modelling requires its own separate authorization (ADR-022 §5
//    Governance Rule 3; Grade 5 freeze act §6; Senior Phase Generation
//    Policy v1.0 §10 item 4) and none exists. See SESSION_DIMENSIONS below.
//  * It never lets the LLM compute, alter or restate a mathematical value:
//    the answer key produced here is built from canonicalAnswer in code.
//
// Question count and delivery mode ARE owned here, because neither is a
// curriculum claim: count is session length, and oral/written is
// presentation. Both are explicitly listed as product requirements and
// neither asserts anything about CAPS.

'use strict';

const grade5 = require('./mentalMathsGrade5Service');
const senior = require('./mentalMathsService');
const { gradeLabel } = require('../utils/capsPhase');

// ── Session dimensions this module is allowed to own ──────────────────
// Kept as an explicit, greppable list so a future reader can see at a
// glance that difficulty is not among them.
const SESSION_DIMENSIONS = ['grade', 'topic', 'count', 'deliveryMode'];

// ── Question count ────────────────────────────────────────────────────
// DEFAULT_COUNT preserves the previously hard-coded value exactly (both
// generators default to 12 and generationPipeline.js passed count: 12), so
// a teacher who never states a count gets today's session length.
// MIN/MAX reuse bounds that already exist in the codebase rather than
// inventing new ones: both generators already require count >= 1, and
// utils/intentParser.js already clamps a stated question count to 1-30.
const DEFAULT_COUNT = 12;
const MIN_COUNT = 1;
const MAX_COUNT = 30;

// ── Delivery modes ────────────────────────────────────────────────────
// ORAL preserves today's behaviour (prompts/mentalMaths.js already framed
// every session as "read each question aloud"), so an unspecified mode is
// not a behaviour change.
const DELIVERY_MODES = { ORAL: 'oral', WRITTEN: 'written' };
const DELIVERY_MODE_VALUES = [DELIVERY_MODES.ORAL, DELIVERY_MODES.WRITTEN];
const DEFAULT_DELIVERY_MODE = DELIVERY_MODES.ORAL;

const DELIVERY_MODE_LABELS = {
  [DELIVERY_MODES.ORAL]: 'Oral — I read them aloud',
  [DELIVERY_MODES.WRITTEN]: 'Written — learners write them',
};

// ── Topic catalogue ───────────────────────────────────────────────────
//
// Grade 5: the two frozen candidates, plus "Mixed" (both, alternating) —
// which IS the behaviour that shipped before this module existed, so it is
// kept as the grade's default topic. Labels describe the operations the
// frozen candidates already generate (C12 = addition/subtraction paired
// sentences, C13 = multiplication/division paired sentences); they add no
// mathematical content.
const GRADE5_TOPICS = [
  { key: 'C12', label: 'Addition & Subtraction', candidates: ['C12'] },
  { key: 'C13', label: 'Multiplication & Division', candidates: ['C13'] },
  { key: 'mixed', label: 'Mixed — both', candidates: grade5.CANDIDATES.slice() },
];
const GRADE5_DEFAULT_TOPIC = 'mixed';

// Senior Phase: labels for the live family matrix. Moved here from
// core/generationPipeline.js so the label map has one home shared by the
// menu, the saved-resource title and the deterministic renderer;
// generationPipeline.js re-exports them unchanged for flows/mainMenuFlow.js.
const FAMILY_LABELS = {
  mulDivFluency: 'Multiplication & Division',
  powersRootsFluency: 'Powers & Roots',
  ratioSharing: 'Ratio & Sharing',
};

/**
 * Grades that have at least one authorized generation path, derived from
 * the generator services themselves.
 * @returns {number[]} ascending, de-duplicated
 */
function computeSupportedGrades() {
  const grades = new Set();
  for (let g = grade5.MIN_GRADE; g <= grade5.MAX_GRADE; g++) grades.add(g);
  for (const family of senior.AUTHORIZED_FAMILIES) {
    for (const g of senior.FAMILY_GRADE_AUTHORIZATION[family] || []) grades.add(g);
  }
  return [...grades].sort((a, b) => a - b);
}

const SUPPORTED_GRADES = computeSupportedGrades();

/**
 * @param {*} grade
 * @returns {boolean}
 */
function isSupportedGrade(grade) {
  return Number.isInteger(grade) && SUPPORTED_GRADES.includes(grade);
}

/**
 * The teacher-facing name for a grade, everywhere in the Mental Maths flow
 * (menu options, headings, the "not available for X yet" message).
 *
 * Goes through utils/capsPhase.js#gradeLabel rather than interpolating the
 * number, because Grade R is represented as 0 (see that file) — a bare
 * `Grade ${grade}` renders it as the meaningless "Grade 0". Grade R is
 * reachable here even though no Foundation Phase generator exists:
 * utils/capsPhase.js#parseGrade maps "grade R" in a teacher's message to 0,
 * and teachers.grade can hold "0", so the unavailable-grade message must be
 * able to name it correctly.
 *
 * @param {number} grade
 * @returns {string}
 */
function gradeMenuLabel(grade) {
  return gradeLabel(grade);
}

/**
 * Topics a given grade may choose from, in menu order.
 * Returns [] for any grade with no authorized generation path — the caller
 * must treat that as "not available", never as "fall back to something".
 *
 * @param {number} grade
 * @returns {Array<{key:string, label:string}>}
 */
function topicsForGrade(grade) {
  if (!Number.isInteger(grade)) return [];
  if (grade5.isSupportedGrade(grade)) {
    return GRADE5_TOPICS.map(({ key, label }) => ({ key, label }));
  }
  return senior.AUTHORIZED_FAMILIES
    .filter((family) => (senior.FAMILY_GRADE_AUTHORIZATION[family] || []).includes(grade))
    .map((family) => ({ key: family, label: FAMILY_LABELS[family] || family }));
}

/**
 * @param {number} grade
 * @param {string} topicKey
 * @returns {{key:string, label:string}|null}
 */
function findTopic(grade, topicKey) {
  return topicsForGrade(grade).find((t) => t.key === topicKey) || null;
}

/**
 * Resolves a topic MENU LABEL back to its topic key, scoped to the grade
 * whose menu produced it.
 *
 * Must be grade-scoped: the same human label legitimately maps to different
 * keys in different grades (Grade 5's "Multiplication & Division" is the
 * frozen C13 candidate; Grade 7/8's is the `mulDivFluency` family). A single
 * global label->key map would silently resolve one grade's selection to the
 * other grade's generator.
 *
 * @param {number} grade
 * @param {string} label
 * @returns {string|null}
 */
function topicKeyForLabel(grade, label) {
  const match = topicsForGrade(grade).find((t) => t.label === label);
  return match ? match.key : null;
}

/**
 * The topic used when a grade is available but the teacher hasn't chosen a
 * topic and one must not be invented. Only Grade 5 has one (its
 * pre-existing "both candidates, alternating" behaviour); Senior Phase
 * grades have no default — the teacher must choose a family, exactly as
 * the frozen family-menu architecture already required.
 *
 * @param {number} grade
 * @returns {string|null}
 */
function defaultTopicForGrade(grade) {
  return grade5.isSupportedGrade(grade) ? GRADE5_DEFAULT_TOPIC : null;
}

// ── Validation helpers ────────────────────────────────────────────────

/**
 * Coerces a requested question count into the supported range, or returns
 * DEFAULT_COUNT when nothing usable was requested. Never throws — this is
 * the lenient front door used on teacher input; generateSession() below is
 * the strict gate.
 * @param {*} raw
 * @returns {number}
 */
function normaliseCount(raw) {
  const n = typeof raw === 'number' ? Math.round(raw) : parseInt(String(raw ?? ''), 10);
  if (!Number.isInteger(n)) return DEFAULT_COUNT;
  return Math.min(MAX_COUNT, Math.max(MIN_COUNT, n));
}

/**
 * @param {*} raw
 * @returns {string|null} a DELIVERY_MODES value, or null if unrecognized
 */
function normaliseDeliveryMode(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  return DELIVERY_MODE_VALUES.includes(v) ? v : null;
}

/**
 * Detects an explicitly requested delivery mode in a teacher's free-text
 * message, so a teacher who already said what they want isn't made to
 * answer a menu about it. Returns null when the message says nothing about
 * delivery — the caller then asks.
 * @param {string} text
 * @returns {string|null}
 */
function parseDeliveryMode(text) {
  const lower = String(text || '').toLowerCase();
  // "write" must have a genuine object ("write them", "write it down",
  // "write their answers"). A bare "write" is how teachers ask for the
  // session itself — "can you write me grade 5 mental maths" means
  // "create it", not "learners write it", and must NOT silently answer the
  // delivery question on their behalf.
  if (/\b(written|in\s+their\s+books?|on\s+paper|worksheet)\b/.test(lower)
    || /\bwrite\s+(them|it|down|(their|the)\s+answers)\b/.test(lower)) {
    return DELIVERY_MODES.WRITTEN;
  }
  if (/\b(oral(ly)?|aloud|out\s+loud|verbal(ly)?|read\s+out|mental(ly)?\s+only)\b/.test(lower)) {
    return DELIVERY_MODES.ORAL;
  }
  return null;
}

// ── Session generation ────────────────────────────────────────────────

/**
 * Builds a complete Mental Maths session for any supported grade.
 *
 * Dispatches to the grade's own authorized generator and returns its
 * questions untouched — this function never constructs, rewrites or
 * inspects a question's mathematics.
 *
 * @param {Object} opts
 * @param {number} opts.grade
 * @param {string} [opts.topic] - a key from topicsForGrade(grade); falls
 *   back to defaultTopicForGrade(grade) when omitted, and throws if that
 *   grade has no default (Senior Phase must choose explicitly)
 * @param {number} [opts.count]
 * @param {string} [opts.mode] - a DELIVERY_MODES value
 * @param {number} [opts.seed]
 * @returns {{grade:number, gradeLabel:string, topic:string, topicLabel:string,
 *   mode:string, count:number, questions:Array<{strand:string, prompt:string,
 *   canonicalAnswer:*}>}}
 */
function generateSession({ grade, topic, count, mode, seed } = {}) {
  if (!isSupportedGrade(grade)) {
    throw new Error(
      `generateSession: Mental Maths is not available for grade "${grade}" — ` +
      `supported grades are ${SUPPORTED_GRADES.join(', ')}`
    );
  }

  const topicKey = topic != null ? topic : defaultTopicForGrade(grade);
  const resolvedTopic = topicKey != null ? findTopic(grade, topicKey) : null;
  if (!resolvedTopic) {
    throw new Error(
      `generateSession: topic "${topicKey}" is not available for grade ${grade} — ` +
      `available topics are ${topicsForGrade(grade).map((t) => t.key).join(', ') || '(none)'}`
    );
  }

  const resolvedCount = count == null ? DEFAULT_COUNT : count;
  if (!Number.isInteger(resolvedCount) || resolvedCount < MIN_COUNT || resolvedCount > MAX_COUNT) {
    throw new Error(
      `generateSession: count must be an integer between ${MIN_COUNT} and ${MAX_COUNT}, got "${count}"`
    );
  }

  const resolvedMode = mode == null ? DEFAULT_DELIVERY_MODE : normaliseDeliveryMode(mode);
  if (!resolvedMode) {
    throw new Error(
      `generateSession: mode must be one of ${DELIVERY_MODE_VALUES.join(', ')}, got "${mode}"`
    );
  }

  let questions;
  if (grade5.isSupportedGrade(grade)) {
    const candidates = GRADE5_TOPICS.find((t) => t.key === resolvedTopic.key).candidates;
    questions = grade5.generateGrade5MentalMathsSet({ count: resolvedCount, seed, candidates }).questions;
  } else {
    // Family/grade authorization is enforced independently inside
    // generateFamilySession() itself — an unauthorized pair reaching here
    // still fails loudly rather than generating.
    questions = senior.generateFamilySession({
      grade, family: resolvedTopic.key, count: resolvedCount, seed,
    }).questions;
  }

  return {
    grade,
    gradeLabel: gradeLabel(grade),
    topic: resolvedTopic.key,
    topicLabel: resolvedTopic.label,
    mode: resolvedMode,
    count: resolvedCount,
    questions,
  };
}

// ── Deterministic presentation ────────────────────────────────────────

/**
 * Renders one canonicalAnswer for display. Arrays (ratioSharing's two
 * shares) join with " : " so the ratio reads as a ratio; everything else
 * is a primitive and is printed as-is. No arithmetic, no rounding, no
 * reformatting of numbers.
 * @param {*} canonicalAnswer
 * @returns {string}
 */
function formatAnswer(canonicalAnswer) {
  return Array.isArray(canonicalAnswer) ? canonicalAnswer.join(' : ') : String(canonicalAnswer);
}

/**
 * The answer key, built in code from canonicalAnswer only. This is the
 * mathematical source of truth for the teacher-facing memo — the LLM is
 * never asked to produce, restate or verify it.
 * @param {Array<{canonicalAnswer:*}>} questions
 * @returns {string}
 */
function formatAnswerKey(questions) {
  return (questions || []).map((q, i) => `${i + 1}. ${formatAnswer(q.canonicalAnswer)}`).join('\n');
}

/**
 * The question list, WhatsApp-numbered.
 * @param {Array<{prompt:string}>} questions
 * @returns {string}
 */
function formatQuestions(questions) {
  return (questions || []).map((q, i) => `${i + 1}. ${q.prompt}`).join('\n');
}

// Teacher-facing delivery instruction per mode. Presentation text only.
const DELIVERY_INSTRUCTIONS = {
  [DELIVERY_MODES.ORAL]: 'Read each question aloud. Learners answer out loud or on their fingers — nothing written.',
  [DELIVERY_MODES.WRITTEN]: 'Write the questions on the board or read them out once. Learners write only their answers, numbered 1 to {count}.',
};

/**
 * @param {string} mode
 * @param {number} count
 * @returns {string}
 */
function deliveryInstruction(mode, count) {
  const template = DELIVERY_INSTRUCTIONS[mode] || DELIVERY_INSTRUCTIONS[DEFAULT_DELIVERY_MODE];
  return template.replace('{count}', String(count));
}

/**
 * Fully deterministic, WhatsApp-formatted rendering of a session — used
 * both as the answer-key source and as the guaranteed fallback whenever
 * the LLM's wording pass cannot be verified as faithful. Uses only
 * WhatsApp's own markup (*bold*, _italic_) and plain newlines: no
 * markdown tables, no headings, no code fences.
 *
 * @param {{gradeLabel:string, topicLabel:string, mode:string, count:number,
 *   questions:Array<{prompt:string, canonicalAnswer:*}>}} session
 * @returns {string}
 */
function renderSession(session) {
  const { gradeLabel: gLabel, topicLabel, mode, questions } = session;
  const count = (questions || []).length;
  return [
    `*Mental Maths — ${gLabel}*`,
    `_${topicLabel} · ${mode === DELIVERY_MODES.WRITTEN ? 'Written' : 'Oral'} · ${count} question${count === 1 ? '' : 's'}_`,
    '',
    `_${deliveryInstruction(mode, count)}_`,
    '',
    formatQuestions(questions),
    '',
    '---',
    '*Answers*',
    '',
    formatAnswerKey(questions),
  ].join('\n');
}

// Headings the wording prompt is told not to produce. If one appears, the
// LLM emitted its own answer section and the output is not usable as a
// question-only body (appending our key would give the teacher two).
const ANSWER_SECTION_PATTERN = /(^|\n)\s*[*_#\s]*answers?\b|answer\s*key|memo\b/i;

/**
 * Verifies that the LLM's wording pass left every question's mathematics
 * exactly as generated: each prompt must appear verbatim, and the output
 * must not contain its own answer section.
 *
 * This is the deterministic gate that keeps the LLM out of mathematical
 * correctness. A false result is not an error — it just means the
 * deterministic rendering is used instead.
 *
 * @param {string} text - the LLM's output
 * @param {Array<{prompt:string}>} questions
 * @returns {boolean}
 */
function llmRenderingIsFaithful(text, questions) {
  if (!text || !Array.isArray(questions) || questions.length === 0) return false;
  if (ANSWER_SECTION_PATTERN.test(text)) return false;
  return questions.every((q) => text.includes(q.prompt));
}

/**
 * Produces the final teacher-facing Mental Maths message.
 *
 * If the LLM's wording is verifiably faithful, it is kept and the
 * code-built answer key is appended. Otherwise the whole message is the
 * deterministic rendering. Either way the questions and the answer key the
 * teacher receives are exactly the generated, deterministic ones.
 *
 * @param {string|null} llmText
 * @param {Object} session - as returned by generateSession()
 * @returns {{content:string, source:'llm-worded'|'deterministic'}}
 */
function finaliseSessionContent(llmText, session) {
  const questions = session?.questions || [];
  if (llmRenderingIsFaithful(llmText, questions)) {
    return {
      content: `${llmText.trim()}\n\n---\n*Answers*\n\n${formatAnswerKey(questions)}`,
      source: 'llm-worded',
    };
  }
  return { content: renderSession(session), source: 'deterministic' };
}

module.exports = {
  SESSION_DIMENSIONS,
  SUPPORTED_GRADES,
  DEFAULT_COUNT,
  MIN_COUNT,
  MAX_COUNT,
  DELIVERY_MODES,
  DELIVERY_MODE_VALUES,
  DELIVERY_MODE_LABELS,
  DEFAULT_DELIVERY_MODE,
  FAMILY_LABELS,
  GRADE5_DEFAULT_TOPIC,
  isSupportedGrade,
  gradeMenuLabel,
  topicsForGrade,
  findTopic,
  topicKeyForLabel,
  defaultTopicForGrade,
  normaliseCount,
  normaliseDeliveryMode,
  parseDeliveryMode,
  generateSession,
  formatAnswer,
  formatAnswerKey,
  formatQuestions,
  deliveryInstruction,
  renderSession,
  llmRenderingIsFaithful,
  finaliseSessionContent,
};
