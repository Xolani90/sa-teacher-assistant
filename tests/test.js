'use strict';

/**
 * Test suite for intent parsing and prompt building.
 * Run with: node tests/test.js
 * No external test framework required.
 */

const { parseIntent } = require('../utils/intentParser');
const { buildPrompt } = require('../services/promptService');
const { chunkMessage } = require('../services/whatsappService');

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${testName}`);
    failed++;
  }
}

function assertEquals(actual, expected, testName) {
  if (actual === expected) {
    console.log(`  ✅ PASS: ${testName} (${actual})`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${testName} — expected "${expected}", got "${actual}"`);
    failed++;
  }
}

// ─────────────────────────────────────────────
// TEST 1: Grade 7 algebra worksheet
// ─────────────────────────────────────────────
console.log('\n📋 TEST 1: "Grade 7 algebra worksheet"');
{
  const input = 'Grade 7 algebra worksheet';
  const intent = parseIntent(input);
  assertEquals(intent.type, 'worksheet', 'intent.type');
  assertEquals(intent.grade, 7, 'intent.grade');
  assertEquals(intent.subject, 'mathematics', 'intent.subject');
  assert(intent.topic.toLowerCase().includes('algebra'), 'intent.topic includes algebra');
  const prompt = buildPrompt(intent);
  assert(prompt.includes('Grade 7'), 'prompt includes Grade 7');
  assert(prompt.includes('WORKSHEET'), 'prompt includes WORKSHEET heading');
  assert(prompt.includes('CAPS'), 'prompt includes CAPS');
  assert(prompt.includes('algebra'), 'prompt includes topic');
  console.log(`  📝 Topic extracted: "${intent.topic}"`);
}

// ─────────────────────────────────────────────
// TEST 2: Explain photosynthesis Grade 8
// ─────────────────────────────────────────────
console.log('\n📋 TEST 2: "Explain photosynthesis Grade 8"');
{
  const input = 'Explain photosynthesis Grade 8';
  const intent = parseIntent(input);
  assertEquals(intent.type, 'explanation', 'intent.type');
  assertEquals(intent.grade, 8, 'intent.grade');
  assertEquals(intent.subject, 'life sciences', 'intent.subject');
  assert(intent.topic.toLowerCase().includes('photosynthesis'), 'intent.topic includes photosynthesis');
  const prompt = buildPrompt(intent);
  assert(prompt.includes('Grade 8'), 'prompt includes Grade 8');
  assert(prompt.includes('Explanation'), 'prompt type is explanation');
  assert(prompt.includes('photosynthesis'), 'prompt includes topic');
  assert(prompt.includes('South African'), 'prompt includes SA context');
  console.log(`  📝 Topic extracted: "${intent.topic}"`);
}

// ─────────────────────────────────────────────
// TEST 3: 20-mark test on fractions
// ─────────────────────────────────────────────
console.log('\n📋 TEST 3: "Make a 20-mark test on fractions"');
{
  const input = 'Make a 20-mark test on fractions';
  const intent = parseIntent(input);
  assertEquals(intent.type, 'test', 'intent.type');
  assertEquals(intent.marks, 20, 'intent.marks');
  assertEquals(intent.subject, 'mathematics', 'intent.subject');
  assert(intent.topic.toLowerCase().includes('fraction'), 'intent.topic includes fractions');
  const prompt = buildPrompt(intent);
  assert(prompt.includes('20'), 'prompt includes mark total');
  assert(prompt.includes('MEMORANDUM'), 'prompt includes memorandum');
  assert(prompt.includes('fraction'), 'prompt includes topic');
  assert(prompt.includes('cognitive level'), 'prompt includes cognitive levels');
  console.log(`  📝 Marks extracted: ${intent.marks}, Topic: "${intent.topic}"`);
}

// ─────────────────────────────────────────────
// TEST 4: Lesson plan Grade 9 English poetry
// ─────────────────────────────────────────────
console.log('\n📋 TEST 4: "Lesson plan Grade 9 English poetry"');
{
  const input = 'Lesson plan Grade 9 English poetry';
  const intent = parseIntent(input);
  assertEquals(intent.type, 'lessonPlan', 'intent.type');
  assertEquals(intent.grade, 9, 'intent.grade');
  assertEquals(intent.subject, 'english', 'intent.subject');
  assert(intent.topic.toLowerCase().includes('poet'), 'intent.topic includes poetry');
  const prompt = buildPrompt(intent);
  assert(prompt.includes('Grade 9'), 'prompt includes Grade 9');
  assert(prompt.includes('LESSON PLAN'), 'prompt type is lesson plan');
  assert(prompt.includes('LEARNING OBJECTIVES'), 'prompt includes objectives section');
  assert(prompt.includes('60 min'), 'prompt includes duration');
  console.log(`  📝 Topic extracted: "${intent.topic}"`);
}

// ─────────────────────────────────────────────
// TEST 5: Intent edge cases
// ─────────────────────────────────────────────
console.log('\n📋 TEST 5: Edge cases');
{
  // No grade specified
  const noGrade = parseIntent('Create a worksheet on the water cycle');
  assertEquals(noGrade.grade, null, 'no grade → null');
  assertEquals(noGrade.type, 'worksheet', 'worksheet detected without grade');

  // Short message
  const short = parseIntent('fractions');
  assert(short.topic.length > 0, 'short message — topic not empty');

  // Test with marks
  const with50 = parseIntent('50-mark exam on quadratic equations');
  assertEquals(with50.marks, 50, '50 marks extracted');
  assertEquals(with50.type, 'test', 'exam → test intent');

  // Grade 12 FET
  const grade12 = parseIntent('Grade 12 accounting balance sheet lesson plan');
  assertEquals(grade12.grade, 12, 'Grade 12 extracted');
  assertEquals(grade12.subject, 'accounting', 'accounting detected');
  assertEquals(grade12.type, 'lessonPlan', 'lesson plan detected');

  // ── Regression (Phase C1): bare "exam"/"examination" must NOT pre-empt the
  // generic TEST classification. Only explicitly-qualified formal-exam
  // phrasing should route to EXAM_PAPER. See utils/intentParser.js, EXAM_PAPER
  // branch — previously included bare `exam` and `examination` alternatives
  // which matched any message containing that word, regardless of context.
  const unqualifiedExam = parseIntent('Grade 10 exam on Newtons laws');
  assertEquals(unqualifiedExam.type, 'test', 'unqualified "exam" mention → test, not examPaper');

  const unqualifiedExamination = parseIntent('quick examination on verbs');
  assertEquals(unqualifiedExamination.type, 'test', 'unqualified "examination" mention → test, not examPaper');

  // Qualified formal-exam phrasing must still correctly route to EXAM_PAPER.
  const qualifiedExamPaper = parseIntent('exam paper for Grade 11 physics');
  assertEquals(qualifiedExamPaper.type, 'examPaper', '"exam paper" → examPaper');

  const qualifiedMidYear = parseIntent('mid-year exam for Grade 9 maths');
  assertEquals(qualifiedMidYear.type, 'examPaper', '"mid-year exam" → examPaper');

  const qualifiedFinal = parseIntent('final exam Grade 8 english');
  assertEquals(qualifiedFinal.type, 'examPaper', '"final exam" → examPaper');

  const qualifiedNovember = parseIntent('november exam Grade 12 biology');
  assertEquals(qualifiedNovember.type, 'examPaper', '"november exam" → examPaper');
}

// ─────────────────────────────────────────────
// TEST 6: Message chunker
// ─────────────────────────────────────────────
console.log('\n📋 TEST 6: Message chunker');
{
  // Short message — no split
  const short = 'Hello teacher!';
  const shortChunks = chunkMessage(short);
  assertEquals(shortChunks.length, 1, 'short message = 1 chunk');
  assertEquals(shortChunks[0], short, 'short message unchanged');

  // Long message — should split
  const longText = 'A'.repeat(8000);
  const longChunks = chunkMessage(longText);
  assert(longChunks.length >= 2, 'long message = 2+ chunks');
  assert(longChunks[0].includes('Part 1'), 'first chunk labeled Part 1');
  assert(longChunks[longChunks.length - 1].includes('Part'), 'last chunk has part label');

  // All chunks within limit
  for (const chunk of longChunks) {
    assert(chunk.length <= 4000, `chunk length ${chunk.length} ≤ 4000`);
  }
}

// ─────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────
console.log('\n─────────────────────────────────');
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📊 Total:  ${passed + failed}`);
console.log('─────────────────────────────────\n');

if (failed > 0) {
  process.exit(1);
}
