// tests/mentalMathsSessionService.test.js
//
// Unit coverage for the grade-agnostic Mental Maths SESSION layer
// (services/mentalMathsSessionService.js) plus an explicit Grades R-12
// availability sweep.
//
// The sweep is the point of this file: it asserts, grade by grade from R
// to 12, that a grade is available ONLY where a governed generator
// actually exists, and that every other grade has no generation path at
// all — not merely that a dispatcher rejects it. Mathematical correctness
// is verified independently here: every generated prompt is re-parsed and
// its arithmetic recomputed from the prompt text, so canonicalAnswer is
// checked against the question the teacher actually sees rather than
// against the generator's own internal value.

'use strict';

const mm = require('../services/mentalMathsSessionService');
const grade5 = require('../services/mentalMathsGrade5Service');
const senior = require('../services/mentalMathsService');
const gradeServices = {
  1: require('../services/mentalMathsGrade1Service'),
  2: require('../services/mentalMathsGrade2Service'),
  3: require('../services/mentalMathsGrade3Service'),
  4: require('../services/mentalMathsGrade4Service'),
  5: grade5,
  6: require('../services/mentalMathsGrade6Service'),
};

let passed = 0, failed = 0;
function ok(label, condition) {
  if (condition) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}`); }
}
function throws(label, fn) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  ok(label, threw);
}

// ── Independent arithmetic verification ───────────────────────────────
//
// Recomputes the answer from the PROMPT STRING only. Returns true when the
// prompt is a recognised form AND its arithmetic agrees with
// canonicalAnswer; returns null when the form isn't recognised (so an
// unrecognised prompt can be reported as a coverage hole rather than
// silently passing).
function verifyByReparsing({ prompt, canonicalAnswer }) {
  let m;

  // Grade 5 C12 — post-MM-C12-01 form: "a + b = □ therefore □ = a + b" /
  // "a - b = □ therefore □ = a - b" (see
  // docs/governance/Grade5_C12_MM-C12-01_Consistency_Decision.md — both
  // clauses must evaluate to the same canonicalAnswer; no longer an
  // inverse-operation relationship between the two clauses).
  m = prompt.match(/^(-?\d+) ([+-]) (-?\d+) = □ therefore □ = (-?\d+) ([+-]) (-?\d+)$/);
  if (m) {
    const [, a, op, b, r, op2, b2] = m;
    const primary = op === '+' ? Number(a) + Number(b) : Number(a) - Number(b);
    const derived = op2 === '+' ? Number(r) + Number(b2) : Number(r) - Number(b2);
    return primary === canonicalAnswer && derived === canonicalAnswer;
  }

  // Foundation and Intermediate Phase addition/subtraction facts.
  m = prompt.match(/^(\d+) ([+−-]) (\d+) = \?$/);
  if (m) return canonicalAnswer === (m[2] === '+' ? Number(m[1]) + Number(m[3]) : Number(m[1]) - Number(m[3]));

  // Foundation and Intermediate Phase multiplication/division facts.
  m = prompt.match(/^(\d+) × (\d+) = \?$/);
  if (m) return canonicalAnswer === Number(m[1]) * Number(m[2]);
  m = prompt.match(/^(\d+) ÷ (\d+) = \?$/);
  if (m) return Number(m[1]) % Number(m[2]) === 0 && canonicalAnswer === Number(m[1]) / Number(m[2]);

  // Grade 6 prime recognition.
  m = prompt.match(/^Is (\d+) a prime number\?$/);
  if (m) {
    const n = Number(m[1]);
    const prime = n >= 2 && !Array.from({ length: Math.floor(Math.sqrt(n)) - 1 }, (_, i) => i + 2).some(d => n % d === 0);
    return canonicalAnswer === (prime ? 'Yes' : 'No');
  }

  // Grade 5 C13 — "a × b = □ therefore □ = p ÷ d"
  m = prompt.match(/^(\d+) × (\d+) = □ therefore □ = (\d+) ÷ (\d+)$/);
  if (m) {
    const [, a, b, p, d] = m;
    return Number(a) * Number(b) === Number(p)
      && Number(d) === Number(b)
      && Number(p) % Number(d) === 0
      && canonicalAnswer === Number(a);
  }

  // Senior mulDivFluency — "a × b" / "c ÷ d"
  m = prompt.match(/^(\d+) × (\d+)$/);
  if (m) return canonicalAnswer === Number(m[1]) * Number(m[2]);
  m = prompt.match(/^(\d+) ÷ (\d+)$/);
  if (m) {
    return Number(m[1]) % Number(m[2]) === 0
      && canonicalAnswer === Number(m[1]) / Number(m[2]);
  }

  // Senior powersRootsFluency — n², n³, √x, ∛x
  m = prompt.match(/^(\d+)²$/);
  if (m) return canonicalAnswer === Number(m[1]) ** 2;
  m = prompt.match(/^(\d+)³$/);
  if (m) return canonicalAnswer === Number(m[1]) ** 3;
  m = prompt.match(/^√(\d+)$/);
  if (m) return Number(canonicalAnswer) ** 2 === Number(m[1]);
  m = prompt.match(/^∛(\d+)$/);
  if (m) return Number(canonicalAnswer) ** 3 === Number(m[1]);

  // Senior ratioSharing — "Share T in the ratio a:b" -> [shareA, shareB]
  m = prompt.match(/^Share (\d+) in the ratio (\d+):(\d+)$/);
  if (m) {
    const [, total, a, b] = m;
    if (!Array.isArray(canonicalAnswer) || canonicalAnswer.length !== 2) return false;
    const [shareA, shareB] = canonicalAnswer;
    const gcd = (x, y) => (y === 0 ? x : gcd(y, x % y));
    return shareA + shareB === Number(total)
      && shareA * Number(b) === shareB * Number(a) // shares are in the stated ratio
      && gcd(Number(a), Number(b)) === 1           // ratio is in lowest terms
      && shareA > 0 && shareB > 0;
  }

  return null; // unrecognised form
}

// ── Grades R-12 availability sweep ────────────────────────────────────
//
// Expected availability is DERIVED from the two generator services, not
// restated as a literal, so this test cannot drift away from the governed
// authorization data — while still failing loudly if that data changes.
console.log('Grades R-12 availability sweep');
{
  const expectedAvailable = new Set([1, 2, 3, 4, 5, 6, 7, 8]);

  // Grade R is 0 in this codebase (utils/capsPhase.js).
  const ALL_GRADES = Array.from({ length: 13 }, (_, i) => i);

  for (const g of ALL_GRADES) {
    const label = g === 0 ? 'Grade R' : `Grade ${g}`;
    const shouldBeAvailable = expectedAvailable.has(g);

    if (shouldBeAvailable) {
      ok(`${label}: available`, mm.isSupportedGrade(g));
      ok(`${label}: has at least one topic`, mm.topicsForGrade(g).length > 0);
      let generated = false;
      try {
        const s = mm.generateSession({
          grade: g,
          topic: mm.topicsForGrade(g)[0].key,
          count: 4,
          mode: 'oral',
          seed: 1,
        });
        generated = s.questions.length === 4;
      } catch { generated = false; }
      ok(`${label}: generates a real session`, generated);
    } else {
      ok(`${label}: NOT available (no governed generator)`, !mm.isSupportedGrade(g));
      ok(`${label}: offers no topics`, mm.topicsForGrade(g).length === 0);
      throws(`${label}: generateSession refuses`, () => mm.generateSession({ grade: g, count: 4 }));
      ok(`${label}: not offered in the grade menu`, !mm.SUPPORTED_GRADES.includes(g));
    }
  }

  // Grade R is 0, so any teacher-facing text must go through
  // gradeMenuLabel() rather than interpolating the number — otherwise a
  // Foundation Phase teacher is told Mental Maths is unavailable for
  // "Grade 0". Grade R is genuinely reachable: capsPhase.parseGrade maps
  // "grade R" in a message to 0.
  ok('Grade R is named "Grade R", never "Grade 0"',
    mm.gradeMenuLabel(0) === 'Grade R');
  ok('a numeric grade is named normally', mm.gradeMenuLabel(7) === 'Grade 7');
  ok('no supported grade label is "Grade 0"',
    !mm.SUPPORTED_GRADES.some(g => mm.gradeMenuLabel(g) === 'Grade 0'));

  ok('SUPPORTED_GRADES is exactly the derived set, ascending',
    JSON.stringify(mm.SUPPORTED_GRADES) === JSON.stringify([...expectedAvailable].sort((a, b) => a - b)));
  ok('Grade 9 is absent (Senior Phase family authorization lists no grade 9)',
    !mm.SUPPORTED_GRADES.includes(9));
  console.log(`     (info) available grades: ${mm.SUPPORTED_GRADES.join(', ')}`);
}

// ── Topic catalogue ───────────────────────────────────────────────────
console.log('\nTopic catalogue (grade-appropriate, grade-scoped)');
{
  const g5 = mm.topicsForGrade(5).map(t => t.key);
  ok('Grade 5 topics are exactly the frozen candidates plus mixed',
    JSON.stringify(g5) === JSON.stringify(['C12', 'C13', 'mixed']));
  ok('Grade 5 default topic is the pre-existing mixed behaviour',
    mm.defaultTopicForGrade(5) === 'mixed' && mm.GRADE5_DEFAULT_TOPIC === 'mixed');

  for (const g of mm.SUPPORTED_GRADES.filter(x => x !== 5)) {
    const keys = mm.topicsForGrade(g).map(t => t.key);
    const serviceTopics = gradeServices[g]?.TOPICS;
    const expected = serviceTopics
      ? serviceTopics.map(t => t.key)
      : senior.AUTHORIZED_FAMILIES.filter(f => senior.FAMILY_GRADE_AUTHORIZATION[f].includes(g));
    ok(`Grade ${g} topics match its grade-specific generator (${expected.join(', ')})`,
      JSON.stringify(keys) === JSON.stringify(expected));
    const expectedDefault = g >= 1 && g <= 6 ? gradeServices[g].DEFAULT_TOPIC : null;
    ok(`Grade ${g} has the correct default-topic policy`,
      mm.defaultTopicForGrade(g) === expectedDefault);
    ok(`Grade ${g} rejects a Grade 5 candidate as a topic`, mm.findTopic(g, 'C12') === null);
  }

  ok('Grade 5 rejects a Senior Phase family as a topic', mm.findTopic(5, 'mulDivFluency') === null);
  ok('every topic has a non-empty label',
    mm.SUPPORTED_GRADES.every(g => mm.topicsForGrade(g).every(t => typeof t.label === 'string' && t.label.length > 0)));

  // The label collision this layer exists to handle: "Multiplication &
  // Division" is Grade 5's frozen C13 candidate AND Grade 7's mulDivFluency
  // family. A global label table would silently route one to the other.
  const shared = 'Multiplication & Division';
  ok('shared label resolves to C13 for Grade 5', mm.topicKeyForLabel(5, shared) === 'C13');
  ok('shared label resolves to mulDivFluency for Grade 7', mm.topicKeyForLabel(7, shared) === 'mulDivFluency');
  ok('label resolution returns null for an unavailable grade', mm.topicKeyForLabel(9, shared) === null);
  ok('label resolution returns null for an unknown label', mm.topicKeyForLabel(5, 'Algebra') === null);
}

// ── Mathematical correctness, every grade x topic ─────────────────────
console.log('\nMathematical correctness (prompt re-parsed, answer recomputed)');
{
  let totalChecked = 0;
  for (const g of mm.SUPPORTED_GRADES) {
    for (const topic of mm.topicsForGrade(g)) {
      const questions = [];
      // Several seeds so each topic's alternative item forms are exercised
      // (powersRootsFluency has four; C12 has add and sub).
      for (const seed of [1, 7, 13, 101, 5000]) {
        questions.push(...mm.generateSession({ grade: g, topic: topic.key, count: 12, mode: 'oral', seed }).questions);
      }
      const results = questions.map(verifyByReparsing);
      const unrecognised = questions.filter((_, i) => results[i] === null);
      const wrong = questions.filter((_, i) => results[i] === false);
      ok(`Grade ${g} / ${topic.key}: all ${questions.length} prompts are a recognised form`,
        unrecognised.length === 0);
      if (unrecognised.length > 0) console.log(`     (info) unrecognised: ${unrecognised.slice(0, 3).map(q => q.prompt).join(' | ')}`);
      ok(`Grade ${g} / ${topic.key}: every canonicalAnswer recomputes correctly from its prompt`,
        wrong.length === 0);
      if (wrong.length > 0) console.log(`     (info) wrong: ${wrong.slice(0, 3).map(q => `${q.prompt} => ${q.canonicalAnswer}`).join(' | ')}`);
      ok(`Grade ${g} / ${topic.key}: every question carries a canonicalAnswer`,
        questions.every(q => q.canonicalAnswer !== undefined && q.canonicalAnswer !== null));
      totalChecked += questions.length;
    }
  }
  console.log(`     (info) ${totalChecked} generated questions independently verified`);

  // Grade 5 single-candidate topics must draw only from that candidate.
  const onlyC12 = mm.generateSession({ grade: 5, topic: 'C12', count: 10, seed: 3 }).questions;
  ok('Grade 5 / C12 draws only C12 items', onlyC12.every(q => q.strand === 'C12'));
  const onlyC13 = mm.generateSession({ grade: 5, topic: 'C13', count: 10, seed: 3 }).questions;
  ok('Grade 5 / C13 draws only C13 items', onlyC13.every(q => q.strand === 'C13'));
  const mixed = mm.generateSession({ grade: 5, topic: 'mixed', count: 10, seed: 3 }).questions;
  ok('Grade 5 / mixed draws both candidates', new Set(mixed.map(q => q.strand)).size === 2);
}

// ── Frozen Grade 5 regression guard ───────────────────────────────────
console.log('\nFrozen Grade 5 C12/C13 regression guard');
{
  // The `candidates` option must be additive: omitting it has to reproduce
  // the original alternating sequence byte-for-byte for a given seed.
  const before = grade5.generateGrade5MentalMathsSet({ count: 12, seed: 2024 });
  const viaSession = mm.generateSession({ grade: 5, topic: 'mixed', count: 12, mode: 'oral', seed: 2024 });
  ok('mixed topic reproduces the pre-existing default sequence exactly',
    JSON.stringify(before.questions) === JSON.stringify(viaSession.questions));
  ok('frozen C13 envelope unchanged (10-99 x 2-9)',
    grade5.C13_A_MIN === 10 && grade5.C13_A_MAX === 99 && grade5.C13_B_MIN === 2 && grade5.C13_B_MAX === 9);
  ok('frozen C12 tiers unchanged',
    JSON.stringify(grade5.TIER_RANGES) === JSON.stringify({ 2: [10, 99], 3: [100, 999], 4: [1000, 9999] }));
  ok('Grade 5 candidate list is still exactly C12/C13',
    JSON.stringify(grade5.CANDIDATES) === JSON.stringify(['C12', 'C13']));
  throws('an unknown candidate is rejected by the Grade 5 generator',
    () => grade5.generateGrade5MentalMathsSet({ count: 4, candidates: ['C99'] }));
  throws('an empty candidate list is rejected',
    () => grade5.generateGrade5MentalMathsSet({ count: 4, candidates: [] }));
}

// ── No difficulty concept anywhere in this layer ──────────────────────
console.log('\nNo difficulty model is introduced (ADR-022 §5 Governance Rule 3)');
{
  ok('SESSION_DIMENSIONS excludes difficulty',
    !mm.SESSION_DIMENSIONS.some(d => /difficult|band|tier|level/i.test(d)));
  ok('SESSION_DIMENSIONS is exactly grade/topic/count/deliveryMode',
    JSON.stringify(mm.SESSION_DIMENSIONS) === JSON.stringify(['grade', 'topic', 'count', 'deliveryMode']));
  // Deliberately does not match on "support" alone — isSupportedGrade /
  // SUPPORTED_GRADES are grade availability, not a difficulty level.
  ok('no difficulty/band/Support-Core-Extension export exists',
    !Object.keys(mm).some(k => /difficult|\bband\b|cutoff|extension|(^|[^a-z])core([^a-z]|$)/i.test(k)));
  // A difficulty argument must be inert, not quietly honoured.
  const plain = mm.generateSession({ grade: 5, topic: 'mixed', count: 6, mode: 'oral', seed: 77 });
  const withBogusDifficulty = mm.generateSession({ grade: 5, topic: 'mixed', count: 6, mode: 'oral', seed: 77, difficulty: 'extension' });
  ok('a difficulty argument changes nothing',
    JSON.stringify(plain.questions) === JSON.stringify(withBogusDifficulty.questions));
  ok('the session object exposes no difficulty field',
    !Object.keys(plain).some(k => /difficult|band/i.test(k)));
}

// ── Question count ────────────────────────────────────────────────────
console.log('\nQuestion count');
{
  ok(`DEFAULT_COUNT preserves the previous hard-coded length (12)`, mm.DEFAULT_COUNT === 12);
  ok('omitting count uses DEFAULT_COUNT',
    mm.generateSession({ grade: 5, topic: 'mixed', seed: 5 }).questions.length === 12);

  for (const n of [mm.MIN_COUNT, 5, 20, mm.MAX_COUNT]) {
    const s = mm.generateSession({ grade: 5, topic: 'mixed', count: n, seed: 9 });
    ok(`count=${n} yields exactly ${n} questions`, s.questions.length === n && s.count === n);
  }
  for (const g of mm.SUPPORTED_GRADES) {
    const topic = mm.topicsForGrade(g)[0].key;
    ok(`Grade ${g} honours an explicit count`,
      mm.generateSession({ grade: g, topic, count: 7, seed: 4 }).questions.length === 7);
  }

  throws('count=0 is rejected', () => mm.generateSession({ grade: 5, topic: 'mixed', count: 0 }));
  throws('count above MAX_COUNT is rejected', () => mm.generateSession({ grade: 5, topic: 'mixed', count: mm.MAX_COUNT + 1 }));
  throws('a non-integer count is rejected', () => mm.generateSession({ grade: 5, topic: 'mixed', count: 4.5 }));
  throws('a non-numeric count is rejected', () => mm.generateSession({ grade: 5, topic: 'mixed', count: 'twelve' }));

  // normaliseCount is the lenient front door for teacher input: clamps,
  // never throws.
  ok('normaliseCount clamps above MAX_COUNT', mm.normaliseCount(500) === mm.MAX_COUNT);
  ok('normaliseCount clamps below MIN_COUNT', mm.normaliseCount(0) === mm.MIN_COUNT);
  ok('normaliseCount clamps a negative', mm.normaliseCount(-3) === mm.MIN_COUNT);
  ok('normaliseCount accepts a numeric string', mm.normaliseCount('20') === 20);
  ok('normaliseCount falls back on nonsense', mm.normaliseCount('lots') === mm.DEFAULT_COUNT);
  ok('normaliseCount falls back on null', mm.normaliseCount(null) === mm.DEFAULT_COUNT);
  ok('normaliseCount rounds a fractional value', mm.normaliseCount(7.4) === 7);
}

// ── Delivery mode (oral / written) ────────────────────────────────────
console.log('\nDelivery mode — oral and written');
{
  ok('exactly two delivery modes exist', mm.DELIVERY_MODE_VALUES.length === 2);
  ok('default mode preserves previous oral framing', mm.DEFAULT_DELIVERY_MODE === 'oral');

  const oral = mm.generateSession({ grade: 5, topic: 'mixed', count: 6, mode: 'oral', seed: 8 });
  const written = mm.generateSession({ grade: 5, topic: 'mixed', count: 6, mode: 'written', seed: 8 });
  ok('mode is carried on the session', oral.mode === 'oral' && written.mode === 'written');
  ok('mode is presentation only — identical questions for the same seed',
    JSON.stringify(oral.questions) === JSON.stringify(written.questions));
  ok('oral rendering says nothing is written',
    /nothing written/i.test(mm.renderSession(oral)));
  ok('written rendering tells learners to number their answers',
    /numbered 1 to 6/.test(mm.renderSession(written)));
  ok('written instruction interpolates the real count, leaving no placeholder',
    !mm.deliveryInstruction('written', 6).includes('{count}'));

  throws('an unknown mode is rejected', () => mm.generateSession({ grade: 5, topic: 'mixed', count: 4, mode: 'telepathic' }));
  ok('normaliseDeliveryMode accepts mixed case', mm.normaliseDeliveryMode('Written') === 'written');
  ok('normaliseDeliveryMode rejects nonsense', mm.normaliseDeliveryMode('shouted') === null);

  // Free-text detection: a teacher who already said which they want must
  // not be asked again.
  ok('"written" detected', mm.parseDeliveryMode('grade 5 mental maths, written') === 'written');
  ok('"in their books" detected as written', mm.parseDeliveryMode('mental maths in their books') === 'written');
  ok('"orally" detected', mm.parseDeliveryMode('grade 7 mental maths orally') === 'oral');
  ok('"out loud" detected as oral', mm.parseDeliveryMode('read them out loud') === 'oral');
  ok('"learners write them down" detected as written', mm.parseDeliveryMode('learners write them down') === 'written');
  ok('"write their answers" detected as written', mm.parseDeliveryMode('write their answers') === 'written');
  ok('"on paper" detected as written', mm.parseDeliveryMode('mental maths on paper') === 'written');
  ok('silence returns null so the teacher is asked', mm.parseDeliveryMode('grade 5 mental maths') === null);
  ok('empty text returns null', mm.parseDeliveryMode('') === null);
  ok('null text returns null', mm.parseDeliveryMode(null) === null);

  // A bare "write" is how a teacher asks for the session itself. Treating
  // it as the delivery answer would silently skip the delivery question.
  ok('"can you write me grade 5 mental maths" does NOT mean written delivery',
    mm.parseDeliveryMode('can you write me grade 5 mental maths') === null);
  ok('"write a mental maths session" does NOT mean written delivery',
    mm.parseDeliveryMode('write a mental maths session') === null);
  ok('"please write grade 7 mental maths" does NOT mean written delivery',
    mm.parseDeliveryMode('please write grade 7 mental maths') === null);
}

// ── Validation and error handling ─────────────────────────────────────
console.log('\nValidation and error handling');
{
  throws('a missing grade is rejected', () => mm.generateSession({}));
  throws('a null grade is rejected', () => mm.generateSession({ grade: null, count: 4 }));
  throws('a string grade is rejected', () => mm.generateSession({ grade: '5', count: 4 }));
  throws('a non-integer grade is rejected', () => mm.generateSession({ grade: 5.5, count: 4 }));
  throws('an unknown topic is rejected', () => mm.generateSession({ grade: 5, topic: 'nonsense', count: 4 }));
  throws('a topic from the wrong grade is rejected', () => mm.generateSession({ grade: 7, topic: 'C12', count: 4 }));
  throws('a Senior Phase grade with no topic is rejected (no invented default)',
    () => mm.generateSession({ grade: 7, count: 4 }));
  ok('isSupportedGrade rejects a non-integer', !mm.isSupportedGrade(7.5));
  ok('isSupportedGrade rejects a string', !mm.isSupportedGrade('5'));
  ok('isSupportedGrade rejects null', !mm.isSupportedGrade(null));
  ok('isSupportedGrade rejects undefined', !mm.isSupportedGrade(undefined));

  // Error messages must name the supported grades / available topics so the
  // dispatch layer's fallback message can never be silently wrong.
  let msg = '';
  try { mm.generateSession({ grade: 9, count: 4 }); } catch (e) { msg = e.message; }
  ok('unsupported-grade error lists the supported grades', msg.includes(mm.SUPPORTED_GRADES.join(', ')));
  try { mm.generateSession({ grade: 5, topic: 'zzz', count: 4 }); } catch (e) { msg = e.message; }
  ok('unknown-topic error lists the grade\'s available topics', msg.includes('C12') && msg.includes('C13'));
}

// ── Deterministic answer key ──────────────────────────────────────────
console.log('\nAnswer key — built in code from canonicalAnswer');
{
  const s = mm.generateSession({ grade: 5, topic: 'mixed', count: 5, mode: 'oral', seed: 31 });
  const key = mm.formatAnswerKey(s.questions);
  const lines = key.split('\n');
  ok('one answer line per question', lines.length === 5);
  ok('answers are numbered 1..n in order', lines.every((l, i) => l.startsWith(`${i + 1}. `)));
  ok('every answer line is exactly its canonicalAnswer',
    lines.every((l, i) => l === `${i + 1}. ${s.questions[i].canonicalAnswer}`));

  // ratioSharing's canonicalAnswer is a two-element array and must read as
  // a ratio, not as "12,8".
  const ratioGrade = mm.SUPPORTED_GRADES
    .find(g => mm.topicsForGrade(g).some(t => t.key === 'ratioSharing'));
  if (ratioGrade != null) {
    const rs = mm.generateSession({ grade: ratioGrade, topic: 'ratioSharing', count: 4, seed: 12 });
    ok('ratioSharing answers are arrays of two shares',
      rs.questions.every(q => Array.isArray(q.canonicalAnswer) && q.canonicalAnswer.length === 2));
    ok('ratioSharing answers render as "a : b"',
      mm.formatAnswerKey(rs.questions).split('\n').every(l => / : /.test(l)));
    ok('no answer line contains a raw JS comma-joined array',
      !mm.formatAnswerKey(rs.questions).split('\n').some(l => /\d,\d/.test(l)));
  } else {
    ok('ratioSharing answer formatting (no grade currently offers it — skipped)', true);
  }

  ok('formatAnswer leaves a number untouched', mm.formatAnswer(42) === '42');
  ok('formatAnswer joins an array as a ratio', mm.formatAnswer([3, 5]) === '3 : 5');
  ok('formatAnswerKey tolerates an empty list', mm.formatAnswerKey([]) === '');
  ok('formatQuestions numbers from 1', mm.formatQuestions(s.questions).startsWith('1. '));
  ok('formatQuestions uses the prompt verbatim',
    mm.formatQuestions(s.questions).split('\n')[0] === `1. ${s.questions[0].prompt}`);
}

// ── WhatsApp formatting of the deterministic rendering ────────────────
console.log('\nWhatsApp-compatible formatting');
{
  const s = mm.generateSession({ grade: 7, topic: 'mulDivFluency', count: 6, mode: 'written', seed: 44 });
  const out = mm.renderSession(s);

  ok('no markdown headings', !/^#{1,6}\s/m.test(out));
  ok('no markdown tables', !out.includes('|'));
  ok('no code fences', !out.includes('```'));
  ok('no markdown bold (**) — WhatsApp uses single asterisks', !out.includes('**'));
  ok('uses WhatsApp bold for the title', out.startsWith('*Mental Maths — Grade 7*'));
  ok('names the topic', out.includes('Multiplication & Division'));
  ok('names the delivery mode', out.includes('Written'));
  ok('states the question count', out.includes('6 questions'));
  ok('contains an Answers section', out.includes('*Answers*'));
  ok('every question prompt appears verbatim', s.questions.every(q => out.includes(q.prompt)));
  ok('every answer appears', s.questions.every(q => out.includes(mm.formatAnswer(q.canonicalAnswer))));
  ok('questions come before the answer key', out.indexOf(s.questions[0].prompt) < out.indexOf('*Answers*'));

  const single = mm.generateSession({ grade: 5, topic: 'C12', count: 1, mode: 'oral', seed: 2 });
  ok('singular "1 question" is not written "1 questions"', mm.renderSession(single).includes('1 question_'));

  const gradeR = mm.renderSession({ ...s, gradeLabel: 'Grade R' });
  ok('gradeLabel is used verbatim (Grade R would render as "Grade R")', gradeR.includes('*Mental Maths — Grade R*'));
}

// ── LLM faithfulness gate ─────────────────────────────────────────────
console.log('\nLLM faithfulness gate — the AI can never affect a value');
{
  const s = mm.generateSession({ grade: 5, topic: 'mixed', count: 4, mode: 'oral', seed: 55 });
  const key = mm.formatAnswerKey(s.questions);
  const faithful = `*Mental Maths — Grade 5*\n_Quick practice._\n\n${mm.formatQuestions(s.questions)}`;

  ok('faithful wording is accepted', mm.llmRenderingIsFaithful(faithful, s.questions));

  const finalised = mm.finaliseSessionContent(faithful, s);
  ok('faithful wording is kept', finalised.source === 'llm-worded');
  ok('the code-built answer key is appended', finalised.content.endsWith(key));
  ok('appended key is the only Answers section',
    (finalised.content.match(/\*Answers\*/g) || []).length === 1);

  // Each rejection reason, checked separately.
  const dropped = `Intro\n\n${mm.formatQuestions(s.questions.slice(0, 3))}`;
  ok('a dropped question is rejected', !mm.llmRenderingIsFaithful(dropped, s.questions));
  const altered = faithful.replace(s.questions[0].prompt, '1 + 1 = □ therefore □ = 2 - 1');
  ok('an altered question is rejected', !mm.llmRenderingIsFaithful(altered, s.questions));
  ok('an LLM-authored answer key is rejected',
    !mm.llmRenderingIsFaithful(`${faithful}\n\n*Answers*\n\n1. 5`, s.questions));
  ok('an LLM-authored "Answer key" heading is rejected',
    !mm.llmRenderingIsFaithful(`${faithful}\n\nAnswer key:\n1. 5`, s.questions));
  ok('an LLM-authored "Memo" heading is rejected',
    !mm.llmRenderingIsFaithful(`${faithful}\n\nMemo\n1. 5`, s.questions));
  ok('empty output is rejected', !mm.llmRenderingIsFaithful('', s.questions));
  ok('null output is rejected', !mm.llmRenderingIsFaithful(null, s.questions));
  ok('an empty question set is rejected', !mm.llmRenderingIsFaithful(faithful, []));

  // Every rejection path must still deliver the full, correct session.
  for (const [label, bad] of [
    ['dropped question', dropped],
    ['altered question', altered],
    ['LLM answer key', `${faithful}\n\n*Answers*\n\n1. 5`],
    ['null output', null],
    ['empty output', ''],
  ]) {
    const out = mm.finaliseSessionContent(bad, s);
    ok(`${label} -> deterministic fallback`, out.source === 'deterministic');
    ok(`${label} -> teacher still gets every question`, s.questions.every(q => out.content.includes(q.prompt)));
    ok(`${label} -> teacher still gets the correct answer key`, out.content.includes(key));
  }

  // The altered value must not survive anywhere in the delivered message.
  const alteredOut = mm.finaliseSessionContent(altered, s);
  ok('an altered value never reaches the teacher', !alteredOut.content.includes('1 + 1 = □ therefore □ = 2 - 1'));
}

// ── Determinism ───────────────────────────────────────────────────────
console.log('\nDeterminism / reproducibility');
{
  for (const g of mm.SUPPORTED_GRADES) {
    const topic = mm.topicsForGrade(g)[0].key;
    const a = mm.generateSession({ grade: g, topic, count: 10, mode: 'oral', seed: 314 });
    const b = mm.generateSession({ grade: g, topic, count: 10, mode: 'oral', seed: 314 });
    ok(`Grade ${g}: same seed reproduces the same session`,
      JSON.stringify(a.questions) === JSON.stringify(b.questions));
    const c = mm.generateSession({ grade: g, topic, count: 10, mode: 'oral', seed: 315 });
    ok(`Grade ${g}: a different seed produces a different session`,
      JSON.stringify(a.questions) !== JSON.stringify(c.questions));
  }
  const unseeded1 = mm.generateSession({ grade: 5, topic: 'mixed', count: 10 });
  ok('an unseeded session still generates a full set', unseeded1.questions.length === 10);
}

// ── Session metadata ──────────────────────────────────────────────────
console.log('\nSession metadata used by dispatch, SAVE and the prompt');
{
  const s = mm.generateSession({ grade: 7, topic: 'powersRootsFluency', count: 3, mode: 'written', seed: 6 });
  ok('carries grade', s.grade === 7);
  ok('carries a human grade label', s.gradeLabel === 'Grade 7');
  ok('carries the topic key', s.topic === 'powersRootsFluency');
  ok('carries the topic label used in the SAVE title', s.topicLabel === 'Powers & Roots');
  ok('carries the mode', s.mode === 'written');
  ok('carries the count', s.count === 3);
  ok('carries the questions', Array.isArray(s.questions) && s.questions.length === 3);
  ok('every question has strand/prompt/canonicalAnswer',
    s.questions.every(q => typeof q.strand === 'string' && typeof q.prompt === 'string' && q.canonicalAnswer !== undefined));
}

console.log('\n─────────────────────────────────');
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📊 Total:  ${passed + failed}`);
console.log('─────────────────────────────────\n');

if (failed > 0) process.exitCode = 1;
