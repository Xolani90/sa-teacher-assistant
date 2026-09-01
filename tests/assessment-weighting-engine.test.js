'use strict';
/**
 * Assessment Weighting Engine + Validator tests.
 * Run individually: node tests/assessment-weighting-engine.test.js
 * Run via npm:       npm test
 */

const { computeBlueprint, allocateMarks, findRule } = require('../services/assessmentWeightingEngine');
const { validateAssessment } = require('../services/assessmentBlueprintValidator');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  \u2705 ${label}`);
    passed++;
  } else {
    console.log(`  \u274c ${label}`);
    failed++;
  }
}

function sumMarks(allocation) {
  return allocation.reduce((s, a) => s + a.marks, 0);
}

console.log('\n== Rule lookup ==');
{
  const rule = findRule({ grade: 10, subject: 'Mathematics', paper: 'Paper 1' });
  assert(rule && rule.id === 'FET-MATH-G10-P1', 'finds Grade 10 Paper 1 rule');

  const noRule = findRule({ grade: 6, subject: 'Mathematics', paper: 'Paper 1' });
  assert(noRule === null, 'returns null for Grade 6 (no verified rule)');

  const wrongSubject = findRule({ grade: 10, subject: 'English', paper: 'Paper 1' });
  assert(wrongSubject === null, 'returns null for wrong subject');
}

console.log('\n== EXPLICIT_CAPS_WEIGHTING allocation ==');
for (const marks of [10, 15, 25, 50, 100]) {
  const result = computeBlueprint({ grade: 10, subject: 'Mathematics', paper: 'Paper 1', totalMarks: marks });
  assert(result.status === 'OK', `Grade 10 Paper 1 @ ${marks} marks returns OK`);
  assert(sumMarks(result.allocation) === marks, `Grade 10 Paper 1 @ ${marks} marks: allocation sums to ${marks}`);
}

{
  const result = computeBlueprint({ grade: 12, subject: 'Mathematics', paper: 'Paper 2', totalMarks: 150 });
  assert(result.status === 'OK', 'Grade 12 Paper 2 @ 150 marks OK');
  assert(sumMarks(result.allocation) === 150, 'Grade 12 Paper 2 allocation sums to 150');
  const trig = result.allocation.find((a) => a.topic === 'Trigonometry');
  assert(trig && trig.marks === 40, 'Grade 12 Paper 2 Trigonometry allocated 40 (matches CAPS 40±3 at native 150 total)');
}

console.log('\n== Multiple topics / rounding integrity ==');
{
  // Odd total that does not divide evenly across topic proportions.
  const result = computeBlueprint({ grade: 11, subject: 'Mathematics', paper: 'Paper 1', totalMarks: 37 });
  assert(result.status === 'OK', 'Grade 11 Paper 1 @ 37 marks OK');
  assert(sumMarks(result.allocation) === 37, 'odd total (37) still sums exactly via largest-remainder rounding');
  assert(result.allocation.every((a) => Number.isInteger(a.marks)), 'all allocated marks are integers');
}

console.log('\n== WEIGHTING_UNVERIFIED for unverified grades/phases ==');
for (const grade of [4, 5, 6, 7, 8, 9, 1, 2, 3]) {
  const result = computeBlueprint({ grade, subject: 'Mathematics', totalMarks: 50 });
  assert(result.status === 'WEIGHTING_UNVERIFIED', `Grade ${grade} Mathematics returns WEIGHTING_UNVERIFIED (no invented weighting)`);
  assert(result.weightingSource === null, `Grade ${grade}: weightingSource is null, not silently CAPS`);
}

console.log('\n== Teacher custom weighting (Phase 7) ==');
{
  const result = computeBlueprint({
    grade: 7,
    subject: 'Mathematics',
    totalMarks: 50,
    customWeighting: [
      { topic: 'Algebra', percentage: 40 },
      { topic: 'Functions', percentage: 35 },
      { topic: 'Finance', percentage: 25 },
    ],
  });
  assert(result.status === 'OK', 'valid custom weighting (sums to 100) returns OK');
  assert(result.weightingSource === 'TEACHER_CUSTOM', 'custom weighting is labelled TEACHER_CUSTOM, never CAPS');
  assert(sumMarks(result.allocation) === 50, 'custom weighting allocation sums to requested total marks');
}

{
  const result = computeBlueprint({
    grade: 7,
    subject: 'Mathematics',
    totalMarks: 50,
    customWeighting: [
      { topic: 'Algebra', percentage: 40 },
      { topic: 'Functions', percentage: 35 },
      { topic: 'Finance', percentage: 20 }, // sums to 95, invalid
    ],
  });
  assert(result.status === 'INVALID_CUSTOM_WEIGHTING', 'custom weighting not summing to 100 is rejected');
}

console.log('\n== allocateMarks() helper ==');
{
  const alloc = allocateMarks(
    [
      { topic: 'A', targetMarks: 30 },
      { topic: 'B', targetMarks: 30 },
      { topic: 'C', targetMarks: 40 },
    ],
    100,
    10
  );
  assert(sumMarks(alloc) === 10, 'scaling down to 10 marks still sums exactly');
}

console.log('\n== Blueprint generation + post-generation validation (Phase 6) ==');
{
  const blueprint = computeBlueprint({ grade: 10, subject: 'Mathematics', paper: 'Paper 1', totalMarks: 100 });

  const goodQuestions = blueprint.allocation.flatMap((a, idx) => [
    { question_id: `q-${idx}-1`, topic: a.topic, marks: a.marks, cognitive_level: 'routine' },
  ]);
  const goodResult = validateAssessment(blueprint, goodQuestions);
  assert(goodResult.passed === true, 'assessment matching blueprint exactly passes validation');
  assert(goodResult.totalMarksDeviation === 0, 'matching assessment has zero total-marks deviation');

  const badQuestions = blueprint.allocation.map((a) => ({ topic: a.topic, marks: 1, cognitive_level: 'routine' }));
  const badResult = validateAssessment(blueprint, badQuestions);
  assert(badResult.passed === false, 'assessment far from blueprint fails validation');
  assert(badResult.missingRequirements.length > 0, 'failing assessment reports missing requirements per topic');
}

{
  const blueprint = computeBlueprint({ grade: 10, subject: 'Mathematics', paper: 'Paper 1', totalMarks: 100 });
  const withExtraTopic = [
    ...blueprint.allocation.map((a) => ({ topic: a.topic, marks: a.marks })),
    { topic: 'Not In Blueprint', marks: 10 },
  ];
  const result = validateAssessment(blueprint, withExtraTopic);
  assert(result.passed === false, 'assessment with an out-of-blueprint topic fails');
  assert(
    result.excessRequirements.some((e) => e.topic === 'Not In Blueprint'),
    'out-of-blueprint topic reported as excess requirement'
  );
}

console.log('\n== Regression: existing blueprint infra untouched ==');
{
  // Sanity check: requiring blueprintRepository.js still works and this
  // new engine does not monkeypatch or otherwise interfere with it.
  const blueprintRepository = require('../services/blueprintRepository');
  assert(typeof blueprintRepository.createBlueprint === 'function', 'blueprintRepository.createBlueprint still exists and is unaffected');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
