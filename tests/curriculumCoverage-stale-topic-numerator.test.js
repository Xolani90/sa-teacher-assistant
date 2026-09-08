'use strict';
// Regression test — Pass 6, P1-02 (Curriculum/Coverage, MY PROGRESS).
//
// Bug: services/curriculumCoverageService.js's analyzeCoverage() computed its
// numerator as coveredTopicNames.size — the raw count of distinct topic-name
// rows found in curriculum_coverage for the scope — instead of intersecting
// that set against the CURRENT expectedTopics list (from CAPS_TOPICS). If a
// persisted row's topic name no longer appears in the current taxonomy (e.g.
// after a topic rename/removal between app versions), it still inflated the
// numerator, which could push coveragePercentage above 100% and was
// inconsistent with outstandingTopics (already correctly expected-set-scoped
// via expectedTopics.filter).
//
// Fix: numerator is now derived as expectedTopics.length - outstandingTopics.length,
// i.e. the count of current expected topics actually present in the covered set.
//
// Run: node tests/curriculumCoverage-stale-topic-numerator.test.js

const { createTestDb } = require('./helpers/createTestDb');
const testDb = createTestDb(__filename);
const db = testDb.db;

const { markTopicCovered, analyzeCoverage } = require('../services/curriculumCoverageService');
const { CAPS_TOPICS } = require('../services/curriculumIntelligenceService');

let passed = 0;
let failed = 0;
function assert(condition, label) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ FAIL: ${label}`); failed++; }
}

function insertTeacher(phoneHash, grade, subject) {
  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject, is_pro) VALUES (?, ?, ?, ?, 1)`)
    .run(phoneHash, 'Test Teacher', String(grade), subject);
}

const PHONE_HASH = 'test-phone-hash-stale-topic';
const GRADE = 7;
const SUBJECT = 'mathematics';
const TERM = 1;
const expectedTopics = CAPS_TOPICS[SUBJECT][GRADE][TERM]; // ['Whole numbers', 'Common fractions', 'Decimal fractions']
assert(Array.isArray(expectedTopics) && expectedTopics.length === 3,
  'precondition: mathematics/grade 7/term 1 has 3 current expected topics');

// ── Case 1: the defect — a stale topic name not in the current taxonomy ────
// Cover ONE real current topic, plus one topic whose name belongs to an
// older/renamed taxonomy and does not appear in expectedTopics at all.
insertTeacher(PHONE_HASH, GRADE, SUBJECT);
markTopicCovered(PHONE_HASH, GRADE, SUBJECT, TERM, expectedTopics[0]);
markTopicCovered(PHONE_HASH, GRADE, SUBJECT, TERM, 'Numbers and number patterns (old taxonomy name)');

let result = analyzeCoverage(PHONE_HASH, GRADE, SUBJECT, TERM);
const termResult = result.termResults[0];

assert(termResult.coveredTopics === 1,
  `stale topic does not inflate numerator (coveredTopics === 1, got ${termResult.coveredTopics})`);
assert(termResult.coveragePercentage <= 100,
  `coverage cannot exceed 100% (got ${termResult.coveragePercentage})`);
assert(Math.round((1 / expectedTopics.length) * 100) === termResult.coveragePercentage,
  `coveragePercentage matches expected-set-scoped ratio (got ${termResult.coveragePercentage})`);
assert(termResult.outstandingTopics === expectedTopics.length - 1,
  `outstandingTopics still based on current expected set (got ${termResult.outstandingTopics})`);
assert(termResult.coveredTopicList.length === 1 && termResult.coveredTopicList[0] === expectedTopics[0],
  'coveredTopicList only contains the current expected topic, not the stale one');

// ── Case 2: normal behavior — all current expected topics covered ─────────
const PHONE_HASH_2 = 'test-phone-hash-full-coverage';
insertTeacher(PHONE_HASH_2, GRADE, SUBJECT);
for (const t of expectedTopics) {
  markTopicCovered(PHONE_HASH_2, GRADE, SUBJECT, TERM, t);
}
const result2 = analyzeCoverage(PHONE_HASH_2, GRADE, SUBJECT, TERM);
const termResult2 = result2.termResults[0];

assert(termResult2.coveredTopics === expectedTopics.length,
  `normal case: all current expected topics covered (got ${termResult2.coveredTopics})`);
assert(termResult2.coveragePercentage === 100,
  `normal case: coverage is exactly 100% (got ${termResult2.coveragePercentage})`);
assert(termResult2.outstandingTopics === 0,
  'normal case: no outstanding topics');

// ── Summary ─────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
testDb.cleanup();
process.exit(failed === 0 ? 0 : 1);
