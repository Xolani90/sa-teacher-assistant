'use strict';
/**
 * parsedMarksAdapter.js tests (ADR-006 PR4 — Bulk Capture, Phase 1).
 *
 * Pure shape-conversion logic, no parser or DB involved — parsed learner
 * records are constructed by hand here to isolate the adapter from
 * marksParser.js's own behaviour (that pairing is Phase 2's concern).
 *
 * Run individually: node tests/parsed-marks-adapter.test.js
 * Run via npm:       npm test
 */

const { adaptParsedMarks, adaptLearner, indexQuestionsByNumber } = require('../services/parsedMarksAdapter');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

const QUESTIONS = [
  { questionNumber: 1, topic: 'fractions', maxMarks: 5 },
  { questionNumber: 2, topic: 'fractions', maxMarks: 5 },
  { questionNumber: 3, topic: 'algebraic equations', maxMarks: 10 },
];

function parsedLearner(overrides = {}) {
  return {
    learnerName: 'Thabo',
    mark: 16,
    totalMarks: 20,
    questionData: {
      1: { mark: 5, maxMark: 5 },
      2: { mark: 3, maxMark: 5 },
      3: { mark: 8, maxMark: 10 },
    },
    ...overrides,
  };
}

console.log('\n── Section 1: indexQuestionsByNumber ─────────────────────');
{
  const idx = indexQuestionsByNumber(QUESTIONS);
  assert(idx.size === 3, 'indexes all three questions');
  assert(idx.get('1').maxMarks === 5, 'Q1 max marks preserved');
  assert(idx.get('3').questionNumber === 3, 'Q3 questionNumber preserved as a number');
  assert(indexQuestionsByNumber([]).size === 0, 'empty questions array indexes to empty map');
}

console.log('\n── Section 2: adaptLearner — happy path ──────────────────');
{
  const idx = indexQuestionsByNumber(QUESTIONS);
  const result = adaptLearner(parsedLearner(), idx);
  assert(result.ok === true, 'valid learner accepted');
  assert(result.learner.name === 'Thabo', 'name carried through');
  assert(result.learner.marks[1] === 5 && result.learner.marks[2] === 3 && result.learner.marks[3] === 8,
    'marks keyed by questionNumber, matching submitReply()\'s shape');
  assert(Object.keys(result.learner.marks).length === 3, 'exactly one mark per blueprint question, no extras');
}

console.log('\n── Section 3: adaptLearner — structured rejection, never thrown ─');
{
  const idx = indexQuestionsByNumber(QUESTIONS);

  const noName = adaptLearner(parsedLearner({ learnerName: '' }), idx);
  assert(noName.ok === false && typeof noName.error === 'string', 'empty name rejected with a structured error, not a throw');

  const shortName = adaptLearner(parsedLearner({ learnerName: 'X' }), idx);
  assert(shortName.ok === false, 'single-character name rejected');

  const unknownQuestion = adaptLearner(parsedLearner({
    questionData: { 1: { mark: 5, maxMark: 5 }, 2: { mark: 3, maxMark: 5 }, 3: { mark: 8, maxMark: 10 }, 9: { mark: 1, maxMark: 1 } },
  }), idx);
  assert(unknownQuestion.ok === false, 'question number not in blueprint is rejected');
  assert(/Q9/.test(unknownQuestion.error), 'error names the offending question number');

  const outOfRange = adaptLearner(parsedLearner({
    questionData: { 1: { mark: 99, maxMark: 5 }, 2: { mark: 3, maxMark: 5 }, 3: { mark: 8, maxMark: 10 } },
  }), idx);
  assert(outOfRange.ok === false, 'mark exceeding blueprint maxMarks is rejected');
  assert(/between 0 and 5/.test(outOfRange.error), 'error states the correct max for that question');

  const negative = adaptLearner(parsedLearner({
    questionData: { 1: { mark: -1, maxMark: 5 }, 2: { mark: 3, maxMark: 5 }, 3: { mark: 8, maxMark: 10 } },
  }), idx);
  assert(negative.ok === false, 'negative mark is rejected');

  const nonInteger = adaptLearner(parsedLearner({
    questionData: { 1: { mark: 2.5, maxMark: 5 }, 2: { mark: 3, maxMark: 5 }, 3: { mark: 8, maxMark: 10 } },
  }), idx);
  assert(nonInteger.ok === false, 'non-integer mark is rejected (matches submitReply()\'s whole-number-only rule)');

  const missingQuestion = adaptLearner(parsedLearner({
    questionData: { 1: { mark: 5, maxMark: 5 }, 2: { mark: 3, maxMark: 5 } }, // Q3 missing
  }), idx);
  assert(missingQuestion.ok === false, 'learner missing a blueprint question is rejected, not partially recorded');
  assert(/Q3/.test(missingQuestion.error), 'error names the missing question');
}

console.log('\n── Section 4: adaptParsedMarks — batch behaviour ─────────');
{
  const parsedMarks = {
    learners: [
      parsedLearner({ learnerName: 'Thabo' }),
      parsedLearner({ learnerName: 'Sipho', questionData: { 1: { mark: 5, maxMark: 5 }, 2: { mark: 4, maxMark: 5 }, 3: { mark: 9, maxMark: 10 } } }),
      parsedLearner({ learnerName: 'X' }), // invalid name -> skipped
    ],
    warnings: ['Imported from Excel sheet: "Sheet1"'],
    errors: [],
  };

  const result = adaptParsedMarks(parsedMarks, QUESTIONS);
  assert(result.accepted.length === 2, 'two valid learners accepted');
  assert(result.skipped.length === 1, 'one invalid learner skipped, not silently dropped');
  assert(result.skipped[0].learnerName === 'X', 'skipped record identifies which learner');
  assert(typeof result.skipped[0].reason === 'string', 'skipped record carries a structured reason, not a boolean');
  assert(result.warnings.length === 1 && result.warnings[0].includes('Excel'), 'parser-level warnings pass through untouched');
  assert(result.errors.length === 0, 'no parser-level errors on a well-formed batch');
}

console.log('\n── Section 5: adaptParsedMarks — parser-level fatal errors short-circuit ─');
{
  const parsedMarks = {
    learners: [],
    warnings: [],
    errors: ['No learner data found. Please check your format and try again.'],
  };
  const result = adaptParsedMarks(parsedMarks, QUESTIONS);
  assert(result.accepted.length === 0, 'nothing accepted when parser reported a fatal error');
  assert(result.skipped.length === 0, 'nothing marked skipped either — there was nothing to adapt');
  assert(result.errors.length === 1, 'parser-level error passed through unchanged');
}

console.log('\n── Section 6: adaptParsedMarks — all-skipped batch (structured, not thrown) ─');
{
  const parsedMarks = {
    learners: [
      parsedLearner({ learnerName: 'Thabo', questionData: { 1: { mark: 99, maxMark: 5 }, 2: { mark: 3, maxMark: 5 }, 3: { mark: 8, maxMark: 10 } } }),
    ],
    warnings: [],
    errors: [],
  };
  const result = adaptParsedMarks(parsedMarks, QUESTIONS);
  assert(result.accepted.length === 0, 'no learners accepted when every one fails validation');
  assert(result.skipped.length === 1, 'the failing learner is reported as a structured skip');
  assert(result.errors.length === 0, 'this is not treated as a parser-level fatal error — it is a per-learner outcome');
}

console.log('\n' + '='.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));
if (failed > 0) process.exit(1);
