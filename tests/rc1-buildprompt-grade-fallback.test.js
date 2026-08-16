'use strict';
// RC1-H-011 — focused regression test for a confirmed buildPrompt() defect.
//
// DEFECT: services/promptService.js::buildPrompt()'s profile-grade fallback
// checks `intent.grade !== undefined`. utils/intentParser.js::parseIntent()
// always returns a defined `grade` key (a number OR null — never
// `undefined`), so this check is always true, even when grade is null. The
// profile.grade fallback is therefore dead code — it can never execute.
//
// USER-VISIBLE EFFECT: a teacher with e.g. grade=7 in their profile who
// sends a natural-language request with no explicit grade (very plausible
// for ATP: "Annual teaching plan for Mathematics", or just "ATP") gets a
// GENERIC, ungraded prompt sent to the AI — while the acknowledgment
// message (core/generationPipeline.js, which uses the CORRECT
// `intent.grade != null` pattern) tells the teacher "for your grade
// (Grade 7)". The teacher is told one thing and given another.
//
// Confirmed not ATP-specific: the same buildPrompt() function is shared by
// every generation type (ATP, WORKSHEET, LESSON PLAN, TEST, EXAM PAPER,
// RUBRIC, SBA TASK, etc.), so the fix belongs at this shared layer.
//
// This test is written to FAIL against the current (buggy) code, and to
// PASS once the minimal fix (`!== undefined` -> `!= null`) is applied.
// Also locks in the surrounding correct-but-adjacent behaviors so the fix
// cannot accidentally break them.
//
// Run: node tests/rc1-buildprompt-grade-fallback.test.js

process.env.PII_SECRET = 'test-secret-key-32-bytes-long!!';

let passed = 0;
let failed = 0;
const failures = [];
function check(condition, label, extra) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else {
    console.error(`  ❌ FAIL: ${label}${extra !== undefined ? ' -- ' + extra : ''}`);
    failed++;
    failures.push(label);
  }
}

const { buildPrompt } = require('../services/promptService');
const { parseIntent } = require('../utils/intentParser');

console.log('\n── RC1-H-011: buildPrompt() profile-grade fallback ──\n');

// ═══════════════════════════════════════════════════════════════════
// Reproduction — ATP, the type that surfaced this defect
// ═══════════════════════════════════════════════════════════════════
console.log('\n── Reproduction: ATP request with no explicit grade, profile grade="7" ──');
{
  const intent = parseIntent('Annual teaching plan for Mathematics');
  check(intent.type === 'atp', 'parseIntent classifies as atp');
  check(intent.grade === null, 'parseIntent returns grade: null (not undefined) when omitted', JSON.stringify(intent.grade));

  // profile.grade is a STRING here deliberately — the real `teachers.grade`
  // DB column is TEXT (confirmed via utils/database.js schema), so this
  // matches actual production representation, not a synthetic shape.
  const profile = { grade: '7', subject: 'mathematics', name: 'Test Teacher' };
  const prompt = buildPrompt(intent, profile);

  check(/Grade 7/.test(prompt), 'EXPECTED: generated ATP prompt uses the teacher\'s profile grade (Grade 7)', prompt.slice(0, 200));
  check(!/appropriate grade level/.test(prompt), 'EXPECTED: prompt does NOT fall back to the generic "appropriate grade level" phrasing when a profile grade exists', prompt.slice(0, 200));
}

// ═══════════════════════════════════════════════════════════════════
// Blast-radius confirmation — WORKSHEET, a second shared type
// ═══════════════════════════════════════════════════════════════════
console.log('\n── Blast radius: WORKSHEET request with no explicit grade, profile grade="7" ──');
{
  const intent = parseIntent('worksheet on fractions');
  check(intent.type === 'worksheet', 'parseIntent classifies as worksheet');
  check(intent.grade === null, 'parseIntent returns grade: null for worksheet when omitted', JSON.stringify(intent.grade));

  const profile = { grade: '7', subject: 'mathematics' };
  const prompt = buildPrompt(intent, profile);

  check(/Grade 7/.test(prompt), 'EXPECTED: generated WORKSHEET prompt also uses the teacher\'s profile grade (Grade 7)', prompt.slice(0, 300));
}

// ═══════════════════════════════════════════════════════════════════
// Edge-case matrix — must all hold after the fix, not just the happy path
// ═══════════════════════════════════════════════════════════════════
console.log('\n── Edge-case matrix ──');
{
  // 1. Explicit grade in the message must always win over profile.
  const explicitIntent = parseIntent('Grade 9 ATP for English');
  check(explicitIntent.grade === 9, 'explicit-grade intent parses grade=9');
  const promptExplicit = buildPrompt(explicitIntent, { grade: '7', subject: 'english' });
  check(/Grade 9/.test(promptExplicit), 'explicit grade (9) in the message overrides profile grade (7)', promptExplicit.slice(0, 200));
  check(!/Grade 7/.test(promptExplicit), 'profile grade (7) does NOT leak in when an explicit grade was given', promptExplicit.slice(0, 200));

  // 2. No grade in message, no grade in profile -> generic fallback preserved.
  const noGradeIntent = parseIntent('Annual teaching plan for Geography');
  check(noGradeIntent.grade === null, 'no-grade intent parses grade=null');
  const promptNoProfileGrade = buildPrompt(noGradeIntent, { subject: 'geography' }); // profile.grade undefined
  check(/appropriate grade level|Grade\s*$/.test(promptNoProfileGrade) || !/Grade \d/.test(promptNoProfileGrade),
    'no grade anywhere (message or profile) -> generic fallback wording preserved, no fabricated grade number',
    promptNoProfileGrade.slice(0, 200));

  // 3. intent.grade explicitly undefined (defensive — not produced by
  //    parseIntent today, but buildPrompt's own comment implies this was
  //    the intended trigger for the fallback) still falls back to profile.
  const syntheticIntent = { type: 'atp', subject: 'mathematics', topic: null };
  // grade key intentionally omitted -> intent.grade is undefined
  const promptSynthetic = buildPrompt(syntheticIntent, { grade: '7', subject: 'mathematics' });
  check(/Grade 7/.test(promptSynthetic), 'a genuinely undefined intent.grade also correctly falls back to profile.grade=7', promptSynthetic.slice(0, 200));

  // 4. grade: 0 (Grade R) must not be treated as falsy/"no grade" — a classic
  //    off-by-truthiness trap adjacent to this fix.
  const gradeRIntent = parseIntent('Grade R ATP for Life Skills');
  check(gradeRIntent.grade === 0, 'Grade R parses as grade=0 (not null)', JSON.stringify(gradeRIntent.grade));
  const promptGradeR = buildPrompt(gradeRIntent, { grade: '5', subject: 'life skills' });
  check(/Grade R/.test(promptGradeR), 'explicit Grade R (0) is honoured, not overwritten by profile grade 5, and not mistaken for "no grade"', promptGradeR.slice(0, 200));
}

console.log('\n─────────────────────────────────');
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
if (failures.length) {
  console.log('\nFailed checks:');
  failures.forEach(f => console.log(`  - ${f}`));
}
process.exit(failed > 0 ? 1 : 0);
