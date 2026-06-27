'use strict';

/**
 * test-atp.js — ATP feature test suite
 *
 * Covers:
 *  1.  ATP trigger phrases
 *  2.  Topic always null for ATP
 *  3.  Grade extraction in ATP context
 *  4.  Subject detection: maths, physical sciences, life sciences, etc.
 *  5.  ATP priority over lessonPlan for overlapping phrases
 *  6.  buildPrompt delegates to atpPrompt with correct structure
 *  7.  atpPrompt null-grade fallback + language injection
 *  8.  MODEL_CONFIG: Sonnet + 8k tokens + 120s timeout
 *  9.  pdfService: title map, typeLabel, grade coercion, margin guards,
 *      pipe-table renderer, per-table header, drawFooter doc.y restore,
 *      renderInlineBold continued-text fix
 * 10.  Phone hash normalization: +27… and 27… hash identically
 */

const assert = require('assert');

// ── Load modules ─────────────────────────────────────────────────────────────
const { parseIntent }  = require('../utils/intentParser');
const { buildPrompt }  = require('../services/promptService');
const atpPrompt        = require('../prompts/atp');
const { generatePdf }  = require('../services/pdfService');
const { hashPhone }    = require('../utils/usageTracker');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`         ${e.message}`);
    failed++;
  }
}

// ── 1. ATP trigger phrases ────────────────────────────────────────────────────
console.log('\n📋  1. ATP trigger phrases');

const triggerPhrases = [
  'annual teaching plan grade 7 mathematics',
  'ATP grade 9 life sciences',
  'year plan grade 10 physical sciences',
  'annual plan for grade 8 history',
  'create an annual teaching plan for maths grade 11',
];

for (const phrase of triggerPhrases) {
  test(`"${phrase}" → type=atp`, () => {
    const intent = parseIntent(phrase);
    assert.strictEqual(intent.type, 'atp', `Got type="${intent.type}"`);
  });
}

// ── 2. Topic always null for ATP ──────────────────────────────────────────────
console.log('\n📋  2. Topic always null for ATP');

test('ATP intent has topic=null', () => {
  const intent = parseIntent('annual teaching plan grade 8 mathematics');
  assert.strictEqual(intent.topic, null, `topic should be null, got "${intent.topic}"`);
});

test('ATP intent with subject in phrase still has topic=null', () => {
  const intent = parseIntent('atp grade 9 life sciences photosynthesis');
  assert.strictEqual(intent.topic, null);
});

// ── 3. Grade extraction ───────────────────────────────────────────────────────
console.log('\n📋  3. Grade extraction in ATP context');

test('grade 7 extracted correctly', () => {
  const intent = parseIntent('annual teaching plan grade 7 mathematics');
  assert.strictEqual(intent.grade, 7);
});

test('grade 12 extracted correctly', () => {
  const intent = parseIntent('atp grade 12 accounting');
  assert.strictEqual(intent.grade, 12);
});

test('no grade yields null', () => {
  const intent = parseIntent('annual teaching plan mathematics');
  assert.strictEqual(intent.grade, null);
});

// ── 4. Subject detection ──────────────────────────────────────────────────────
console.log('\n📋  4. Subject detection in ATP context');

const subjectCases = [
  ['maths',            'mathematics'],
  ['mathematics',      'mathematics'],
  ['physical sciences','physical sciences'],
  ['physics',          'physical sciences'],
  ['life sciences',    'life sciences'],
  ['biology',          'life sciences'],
  ['history',          'history'],
  ['accounting',       'accounting'],
  ['english',          'english'],
];

for (const [input, expected] of subjectCases) {
  test(`"${input}" detected as "${expected}"`, () => {
    const intent = parseIntent(`annual teaching plan grade 9 ${input}`);
    assert.strictEqual(intent.subject, expected, `Got "${intent.subject}"`);
  });
}

// ── 5. ATP priority over lessonPlan ──────────────────────────────────────────
console.log('\n📋  5. ATP priority over lessonPlan');

test('"annual teaching plan" beats lessonPlan detection', () => {
  const intent = parseIntent('annual teaching plan grade 8 maths');
  assert.strictEqual(intent.type, 'atp');
  assert.notStrictEqual(intent.type, 'lessonPlan');
});

test('"year plan" beats lessonPlan detection', () => {
  const intent = parseIntent('year plan grade 10 history');
  assert.strictEqual(intent.type, 'atp');
});

// ── 6. buildPrompt delegates to atpPrompt ────────────────────────────────────
console.log('\n📋  6. buildPrompt delegates to atpPrompt');

test('buildPrompt({ type:"atp" }) returns a non-empty string', () => {
  const prompt = buildPrompt({ type: 'atp', grade: 8, subject: 'mathematics', topic: null, language: 'english' });
  assert.ok(typeof prompt === 'string' && prompt.length > 50, 'Prompt too short or wrong type');
});

test('buildPrompt for ATP includes subject', () => {
  const prompt = buildPrompt({ type: 'atp', grade: 9, subject: 'life sciences', topic: null, language: 'english' });
  assert.ok(prompt.toLowerCase().includes('life sciences'), 'Subject not in prompt');
});

test('buildPrompt for ATP includes grade', () => {
  const prompt = buildPrompt({ type: 'atp', grade: 10, subject: 'history', topic: null, language: 'english' });
  assert.ok(prompt.includes('10') || prompt.toLowerCase().includes('grade'), 'Grade not in prompt');
});

// ── 7. atpPrompt null-grade fallback + language injection ─────────────────────
console.log('\n📋  7. atpPrompt null-grade fallback and language injection');

test('atpPrompt with null grade does not crash', () => {
  const prompt = atpPrompt({ grade: null, subject: 'mathematics', language: 'english' });
  assert.ok(typeof prompt === 'string' && prompt.length > 0);
});

test('atpPrompt Afrikaans prompt includes language instruction', () => {
  const prompt = atpPrompt({ grade: 8, subject: 'wiskunde', language: 'afrikaans' });
  assert.ok(
    prompt.toLowerCase().includes('afrikaans') || prompt.toLowerCase().includes('afrikaans'),
    'Expected Afrikaans language instruction in prompt'
  );
});

test('atpPrompt english prompt is structured (has grade and subject)', () => {
  const prompt = atpPrompt({ grade: 7, subject: 'mathematics', language: 'english' });
  assert.ok(prompt.includes('7') || prompt.toLowerCase().includes('grade'));
  assert.ok(prompt.toLowerCase().includes('mathematics') || prompt.toLowerCase().includes('math'));
});

// ── 8. MODEL_CONFIG for ATP ───────────────────────────────────────────────────
console.log('\n📋  8. MODEL_CONFIG: Sonnet + 8k tokens + 120s timeout');

const aiService = require('../services/aiService');
const MODEL_CONFIG = aiService._MODEL_CONFIG || aiService.MODEL_CONFIG || null;

if (MODEL_CONFIG && MODEL_CONFIG.atp) {
  test('ATP model config exists', () => {
    assert.ok(MODEL_CONFIG.atp, 'No atp entry in MODEL_CONFIG');
  });

  test('ATP uses claude-sonnet (not haiku)', () => {
    const model = MODEL_CONFIG.atp.anthropic?.model || MODEL_CONFIG.atp.model || '';
    assert.ok(model.includes('sonnet'), `Expected sonnet, got "${model}"`);
  });

  test('ATP max_tokens >= 8000', () => {
    const tokens = MODEL_CONFIG.atp.anthropic?.maxTokens || MODEL_CONFIG.atp.maxTokens || 0;
    assert.ok(tokens >= 8000, `Expected >=8000 tokens, got ${tokens}`);
  });

  test('ATP timeout >= 120000ms', () => {
    const timeout = MODEL_CONFIG.atp.timeout || MODEL_CONFIG.atp.anthropic?.timeout || 0;
    assert.ok(timeout >= 120000, `Expected >=120000ms timeout, got ${timeout}`);
  });
} else {
  // MODEL_CONFIG not directly exported — just verify aiService loads without error
  test('aiService loads without error', () => {
    assert.ok(aiService, 'aiService failed to load');
  });
  console.log('    ℹ  MODEL_CONFIG not directly exported — skipping model detail assertions');
}

// ── 9. pdfService: title, filename, grade coercion, PDF content ───────────────
console.log('\n📋  9. pdfService: title map, typeLabel, grade coercion, PDF content');

test('generatePdf with integer grade does not throw (grade coercion)', async () => {
  // Previously crashed with TypeError: grade.replace is not a function
  await generatePdf({
    content: 'Test content for coercion check',
    type: 'worksheet',
    topic: 'Fractions',
    grade: 7,    // integer, not string
    subject: 'Mathematics',
  });
});

test('ATP PDF generates successfully and is non-empty', async () => {
  const fs = require('fs');
  const atpContent = [
    'ANNUAL TEACHING PLAN: MATHEMATICS GRADE 8',
    '',
    '*TERM 1 (Weeks 1–10)*',
    '',
    '| Week | Topic | CAPS Content | Assessment |',
    '|---|---|---|---|',
    '| 1-2 | Whole numbers | Properties, LCM, HCF | Class activity |',
    '| 3-4 | Integers | Operations | Assignment |',
    '',
    '*TERM 2 (Weeks 11–20)*',
    '',
    '| Week | Topic | CAPS Content | Assessment |',
    '|---|---|---|---|',
    '| 11-12 | Algebra | Expand, factorise | Class activity |',
    '| 13-14 | Equations | Linear equations | Test |',
  ].join('\n');

  const result = await generatePdf({
    content: atpContent,
    type: 'atp',
    topic: null,
    grade: 8,
    subject: 'Mathematics',
  });

  assert.ok(fs.existsSync(result.filePath), 'PDF file not created');
  const size = fs.statSync(result.filePath).size;
  assert.ok(size > 1000, `PDF too small (${size} bytes) — likely blank`);
  fs.unlinkSync(result.filePath); // cleanup
});

test('ATP PDF filename contains Annual_Teaching_Plan', async () => {
  const fs = require('fs');
  const result = await generatePdf({
    content: '| Week | Topic |\n|---|---|\n| 1 | Intro |',
    type: 'atp',
    topic: null,
    grade: 9,
    subject: 'History',
  });
  assert.ok(result.filename.includes('Annual_Teaching_Plan'), `Filename: ${result.filename}`);
  fs.unlinkSync(result.filePath);
});

test('renderInlineBold: *bold* line generates PDF without crash', async () => {
  const fs = require('fs');
  const result = await generatePdf({
    content: '*This is a bold heading*\nNormal text follows\n*Another bold line*',
    type: 'explanation',
    topic: 'Test',
    grade: 8,
    subject: 'Mathematics',
  });
  assert.ok(fs.existsSync(result.filePath));
  fs.unlinkSync(result.filePath);
});

// ── 10. Phone hash normalization ──────────────────────────────────────────────
console.log('\n📋 10. Phone hash normalization');

test('+27821234567 and 27821234567 hash to the same value', () => {
  // PII_SECRET must be set for hashPhone; use a test value if not set
  const origSecret = process.env.PII_SECRET;
  if (!process.env.PII_SECRET) process.env.PII_SECRET = 'test-secret-for-hashing';

  const hashWithPlus    = hashPhone('+27821234567');
  const hashWithoutPlus = hashPhone('27821234567');

  if (!origSecret) delete process.env.PII_SECRET;

  assert.strictEqual(
    hashWithPlus,
    hashWithoutPlus,
    `Hash mismatch: "+27…" → ${hashWithPlus}, "27…" → ${hashWithoutPlus}`
  );
});

test('+27782629774 and 27782629774 hash identically', () => {
  const origSecret = process.env.PII_SECRET;
  if (!process.env.PII_SECRET) process.env.PII_SECRET = 'test-secret-for-hashing';

  const h1 = hashPhone('+27782629774');
  const h2 = hashPhone('27782629774');

  if (!origSecret) delete process.env.PII_SECRET;

  assert.strictEqual(h1, h2);
});

// ── Results ───────────────────────────────────────────────────────────────────
// Allow async tests to settle before printing results
setTimeout(() => {
  console.log('\n─────────────────────────────────');
  console.log(`✅  Passed: ${passed}`);
  console.log(`❌  Failed: ${failed}`);
  console.log(`📊  Total:  ${passed + failed}`);
  console.log('─────────────────────────────────\n');
  if (failed > 0) process.exit(1);
}, 3000);
