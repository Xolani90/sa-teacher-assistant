// tests/lessonPlanHomework.test.js
//
// Unit coverage for utils/lessonPlanHomework.js — the deterministic
// homework-section extractor/validator introduced for Feature 2.
//
// Run: node tests/lessonPlanHomework.test.js

'use strict';

const { extractHomeworkSection, hasUsableHomework } = require('../utils/lessonPlanHomework');

let passed = 0, failed = 0;
function ok(label, condition) {
  if (condition) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.error(`  ❌ ${label}`); }
}

console.log('extractHomeworkSection — Intermediate/Senior/FET (*HOMEWORK*)');
{
  const content = [
    '*LESSON PLAN: Fractions — Grade 5*',
    '*TEACHING STEPS (30 min)*',
    '1. Do a thing',
    '*HOMEWORK*',
    'Complete questions 1-10 on adding fractions with like denominators from the textbook, page 42.',
    '*DIFFERENTIATION*',
    '• Support: fewer questions',
  ].join('\n');
  const section = extractHomeworkSection(content);
  ok('finds the *HOMEWORK* heading', section && section.heading === 'HOMEWORK');
  ok('extracted text does not include the next heading', section && !section.text.includes('DIFFERENTIATION'));
  ok('extracted text contains the real task', section && section.text.includes('adding fractions'));
}

console.log('extractHomeworkSection — Foundation Phase (*OPTIONAL HOME ACTIVITY*)');
{
  const content = [
    '*LESSON PLAN: Counting to 10 — Grade 1*',
    '*CLOSING / REFLECTION (5 min)*',
    'Sing the counting song.',
    '*OPTIONAL HOME ACTIVITY*',
    'Count the spoons out loud with a family member while setting the table.',
  ].join('\n');
  const section = extractHomeworkSection(content);
  ok('finds the *OPTIONAL HOME ACTIVITY* heading', section && section.heading === 'OPTIONAL HOME ACTIVITY');
  ok('extracted text runs to end of content when no following heading', section && section.text.includes('Count the spoons'));
}

console.log('extractHomeworkSection — missing/absent');
{
  ok('null content -> null', extractHomeworkSection(null) === null);
  ok('empty string -> null', extractHomeworkSection('') === null);
  ok('no homework heading at all -> null', extractHomeworkSection('*LESSON PLAN: X*\n*TEACHING STEPS*\nfoo') === null);
}

console.log('hasUsableHomework — placeholder rejection');
{
  const placeholderContent = [
    '*HOMEWORK*',
    '[One practical homework task that reinforces the lesson objective]',
    '*DIFFERENTIATION*',
  ].join('\n');
  ok('bracket-only placeholder is rejected', !hasUsableHomework(placeholderContent));

  const emptyContent = ['*HOMEWORK*', '', '*DIFFERENTIATION*'].join('\n');
  ok('empty section is rejected', !hasUsableHomework(emptyContent));

  const tooShortContent = ['*HOMEWORK*', 'TBD', '*DIFFERENTIATION*'].join('\n');
  ok('trivially short section is rejected', !hasUsableHomework(tooShortContent));
}

console.log('hasUsableHomework — real content accepted');
{
  const realContent = [
    '*HOMEWORK*',
    'Solve 10 two-digit addition problems from Exercise 4B and check your answers using estimation.',
    '*DIFFERENTIATION*',
  ].join('\n');
  ok('real homework task is accepted', hasUsableHomework(realContent));

  const foundationContent = [
    '*OPTIONAL HOME ACTIVITY*',
    'Sort the socks in the laundry basket by colour with a grown-up, counting each pile out loud.',
  ].join('\n');
  ok('real Foundation Phase home activity is accepted', hasUsableHomework(foundationContent));
}

console.log(`\n📊 Total:  ${passed + failed}`);
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
if (failed > 0) process.exit(1);
