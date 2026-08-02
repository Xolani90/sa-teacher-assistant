'use strict';
/**
 * Learner Repository (ADR-003 PR2) — real DB
 *
 * Loads the REAL repositories/learnerRepository.js and runs it against a
 * REAL in-memory SQLite database (via the node:sqlite shim, same convention
 * as tests/observationRepository-corrections-delete-resolve.test.js and
 * tests/phase-6-observation-repository.test.js), so it exercises the
 * actual SQL rather than a mocked repository.
 *
 * Run individually:   node tests/learnerRepository.test.js
 * Run via npm:         npm test
 */

// ── Shared real-migrations test DB helper (see docs/TSE_SCHOOL_CALENDAR_TEST_GAP.md) ──
const { createTestDb } = require('./helpers/createTestDb');

// ── Helpers ──────────────────────────────────────────────────────────────
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

function assertEq(a, b, label) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    console.error(`     expected: ${JSON.stringify(b)}`);
    console.error(`     got:      ${JSON.stringify(a)}`);
    failed++;
  }
}

function assertThrows(fn, expectedMsg, label) {
  try {
    fn();
    console.error(`  ❌ FAIL: ${label} — expected throw, got no error`);
    failed++;
  } catch (err) {
    if (expectedMsg && !err.message.includes(expectedMsg)) {
      console.error(`  ❌ FAIL: ${label}`);
      console.error(`     expected message to include: "${expectedMsg}"`);
      console.error(`     got: "${err.message}"`);
      failed++;
    } else {
      console.log(`  ✅ ${label}`);
      passed++;
    }
  }
}

// ── Fixture helpers (direct inserts — this suite tests the repository's
//    READS, not the write paths already covered by
//    diagnosticWorkflowService/observationRepository tests, so fixtures
//    bypass resolveLearner() and insert rows directly) ────────────────────
function insertLearner(db, { phoneHash, classId = null, name }) {
  const info = db.prepare(`
    INSERT INTO learners (phone_hash, class_id, canonical_name, normalized_name)
    VALUES (?, ?, ?, ?)
  `).run(phoneHash, classId, name, name.toLowerCase());
  return info.lastInsertRowid;
}

function insertAssessment(db, { phoneHash, title = 'Test Assessment', grade = 7, subject = 'Mathematics', term = 1, assessmentType = 'test', totalMarks = 20, blueprintId = null, blueprintVersion = null }) {
  const info = db.prepare(`
    INSERT INTO assessments (phone_hash, title, grade, subject, term, assessment_type, total_marks, blueprint_id, blueprint_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(phoneHash, title, grade, subject, term, assessmentType, totalMarks, blueprintId, blueprintVersion);
  return info.lastInsertRowid;
}

function insertResult(db, { assessmentId, learnerId, learnerName, mark = 15, totalMarks = 20, createdAt = null }) {
  const percentage = (mark / totalMarks) * 100;
  const info = createdAt
    ? db.prepare(`
        INSERT INTO learner_results (assessment_id, learner_name, mark, total_marks, percentage, learner_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(assessmentId, learnerName, mark, totalMarks, percentage, learnerId, createdAt)
    : db.prepare(`
        INSERT INTO learner_results (assessment_id, learner_name, mark, total_marks, percentage, learner_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(assessmentId, learnerName, mark, totalMarks, percentage, learnerId);
  return info.lastInsertRowid;
}

function insertObsAssessment(db, { phoneHash, grade = '3', subject = 'Literacy', assessmentName = 'Term 1 Observation', classId = null, correctsAssessmentId = null }) {
  const info = db.prepare(`
    INSERT INTO observation_assessments (phone_hash, grade, subject, assessment_name, class_id, corrects_assessment_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(phoneHash, grade, subject, assessmentName, classId, correctsAssessmentId);
  return info.lastInsertRowid;
}

function insertObsRecord(db, { assessmentId, learnerId, learnerName, domain = 'Reading', developmentalStatus = 'Developing', notes = null, createdAt = null }) {
  const info = createdAt
    ? db.prepare(`
        INSERT INTO observation_records (assessment_id, learner_name, domain, developmental_status, notes, learner_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(assessmentId, learnerName, domain, developmentalStatus, notes, learnerId, createdAt)
    : db.prepare(`
        INSERT INTO observation_records (assessment_id, learner_name, domain, developmental_status, notes, learner_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(assessmentId, learnerName, domain, developmentalStatus, notes, learnerId);
  return info.lastInsertRowid;
}

async function run() {
  const testDb = createTestDb(__filename);
  const _db = testDb.db;

  const {
    getLearnerById,
    getAssessmentHistory,
    getObservationHistory,
    getLearnerHistory,
    getRecentAssessments,
    getClassHistory,
    searchLearnersByName,
  } = require('../services/learnerRepository');

  const TEACHER_A = 'learner_repo_teacher_a';
  const TEACHER_B = 'learner_repo_teacher_b';
  _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(TEACHER_A);
  _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(TEACHER_B);

  const classA = _db.prepare(`INSERT INTO classes (phone_hash, name, grade, subject) VALUES (?, ?, ?, ?)`)
    .run(TEACHER_A, '7A', 7, 'Mathematics').lastInsertRowid;
  const classB = _db.prepare(`INSERT INTO classes (phone_hash, name, grade, subject) VALUES (?, ?, ?, ?)`)
    .run(TEACHER_A, '7B', 7, 'Mathematics').lastInsertRowid;

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 1: getLearnerById
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 1: getLearnerById ──────────────────────────────────────────');

  console.log('\nTest LR-01: getLearnerById returns the expected learner');
  const sipho = insertLearner(_db, { phoneHash: TEACHER_A, classId: classA, name: 'Sipho' });
  const fetched = getLearnerById(sipho);
  assertEq(fetched.canonicalName, 'Sipho', 'canonicalName matches');
  assertEq(fetched.classId, classA, 'classId matches');

  console.log('\nTest LR-02: getLearnerById returns null for an unknown id');
  assertEq(getLearnerById(999999), null, 'unknown learner id returns null, not throw');

  console.log('\nTest LR-03: getLearnerById throws on missing argument');
  assertThrows(() => getLearnerById(null), 'must not be null or empty', 'null learnerId throws');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 2: getAssessmentHistory / getObservationHistory (chronological)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 2: chronological history ───────────────────────────────────');

  const assessment1 = insertAssessment(_db, { phoneHash: TEACHER_A, title: 'Term 1 Test' });
  const assessment2 = insertAssessment(_db, { phoneHash: TEACHER_A, title: 'Term 2 Test' });
  insertResult(_db, { assessmentId: assessment1, learnerId: sipho, learnerName: 'Sipho', mark: 12, createdAt: '2026-01-10 09:00:00' });
  insertResult(_db, { assessmentId: assessment2, learnerId: sipho, learnerName: 'Sipho', mark: 18, createdAt: '2026-03-10 09:00:00' });

  console.log('\nTest LR-04: getAssessmentHistory returns newest first');
  const assessHistory = getAssessmentHistory(sipho);
  assertEq(assessHistory.length, 2, 'two assessment events returned');
  assertEq(assessHistory[0].title, 'Term 2 Test', 'newest (Term 2) is first');
  assertEq(assessHistory[1].title, 'Term 1 Test', 'oldest (Term 1) is second');
  assertEq(assessHistory[0].type, 'assessment', 'event type is "assessment"');
  assertEq(assessHistory[0].blueprintId, null, 'blueprintId is null for a non-blueprint assessment');
  assertEq(assessHistory[0].blueprintVersion, null, 'blueprintVersion is null for a non-blueprint assessment');

  // Dedicated learner (not `sipho`) so this fixture doesn't perturb the
  // assessment counts LR-11/LR-12 rely on later in this file.
  const blueprintTestLearner = insertLearner(_db, { phoneHash: TEACHER_A, classId: classA, name: 'BlueprintFixtureLearner' });
  // The real assessments.blueprint_id column is an enforced FK to
  // assessment_blueprints(id) (Migration 029) — unlike the hand-rolled
  // schema this replaces, a sentinel id like 42 with no matching row
  // now throws. Insert a real blueprint row to reference instead.
  const fixtureBlueprintId = _db.prepare(`
    INSERT INTO assessment_blueprints (phone_hash, title, subject, grade, total_marks, version)
    VALUES (?, 'Fixture Blueprint', 'Mathematics', 7, 20, 2)
  `).run(TEACHER_A).lastInsertRowid;
  const blueprintBackedAssessmentId = insertAssessment(_db, {
    phoneHash: TEACHER_A, title: 'Blueprint Test', term: 2, blueprintId: fixtureBlueprintId, blueprintVersion: 2,
  });
  insertResult(_db, { assessmentId: blueprintBackedAssessmentId, learnerId: blueprintTestLearner, learnerName: 'BlueprintFixtureLearner', mark: 18, totalMarks: 20, createdAt: '2026-05-01 09:00:00' });
  const blueprintRow = getAssessmentHistory(blueprintTestLearner).find((e) => e.title === 'Blueprint Test');
  assertEq(blueprintRow.blueprintId, fixtureBlueprintId, 'blueprintId passes through when the assessment is blueprint-backed');
  assertEq(blueprintRow.blueprintVersion, 2, 'blueprintVersion passes through when the assessment is blueprint-backed');

  const obsAssessment1 = insertObsAssessment(_db, { phoneHash: TEACHER_A, assessmentName: 'Jan Observation' });
  const obsAssessment2 = insertObsAssessment(_db, { phoneHash: TEACHER_A, assessmentName: 'Feb Observation' });
  insertObsRecord(_db, { assessmentId: obsAssessment1, learnerId: sipho, learnerName: 'Sipho', createdAt: '2026-01-15 09:00:00' });
  insertObsRecord(_db, { assessmentId: obsAssessment2, learnerId: sipho, learnerName: 'Sipho', createdAt: '2026-02-15 09:00:00' });

  console.log('\nTest LR-05: getObservationHistory returns newest first');
  const obsHistory = getObservationHistory(sipho);
  assertEq(obsHistory.length, 2, 'two observation events returned');
  assertEq(obsHistory[0].title, 'Feb Observation', 'newest (Feb) is first');
  assertEq(obsHistory[1].title, 'Jan Observation', 'oldest (Jan) is second');
  assertEq(obsHistory[0].type, 'observation', 'event type is "observation"');

  console.log('\nTest LR-06: getObservationHistory excludes superseded assessments by default');
  const obsAssessment3 = insertObsAssessment(_db, { phoneHash: TEACHER_A, assessmentName: 'Mar Original' });
  insertObsRecord(_db, { assessmentId: obsAssessment3, learnerId: sipho, learnerName: 'Sipho', createdAt: '2026-03-01 09:00:00' });
  const obsAssessment3Correction = insertObsAssessment(_db, { phoneHash: TEACHER_A, assessmentName: 'Mar Corrected', correctsAssessmentId: obsAssessment3 });
  insertObsRecord(_db, { assessmentId: obsAssessment3Correction, learnerId: sipho, learnerName: 'Sipho', createdAt: '2026-03-02 09:00:00' });

  const historyDefault = getObservationHistory(sipho);
  assert(!historyDefault.some(e => e.title === 'Mar Original'), 'superseded original excluded by default');
  assert(historyDefault.some(e => e.title === 'Mar Corrected'), 'correction appears by default');

  console.log('\nTest LR-07: getObservationHistory({ includeSuperseded: true }) includes it');
  const historyIncluded = getObservationHistory(sipho, { includeSuperseded: true });
  assert(historyIncluded.some(e => e.title === 'Mar Original'), 'superseded original reappears with includeSuperseded');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 3: getLearnerHistory (merge + sort)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 3: getLearnerHistory merges and sorts ──────────────────────');

  console.log('\nTest LR-08: getLearnerHistory merges assessments and observations chronologically');
  const merged = getLearnerHistory(sipho, { includeSuperseded: false });
  const mergedTypes = merged.map(e => e.type);
  assert(mergedTypes.includes('assessment') && mergedTypes.includes('observation'), 'merged list contains both types');
  const timestamps = merged.map(e => e.createdAt);
  const sortedDesc = [...timestamps].sort().reverse();
  assertEq(timestamps, sortedDesc, 'merged list is sorted newest first by createdAt');

  console.log('\nTest LR-09: getLearnerHistory respects the limit option');
  const limited = getLearnerHistory(sipho, { limit: 2 });
  assertEq(limited.length, 2, 'limit option caps the merged result');

  console.log('\nTest LR-10: getLearnerHistory throws on missing argument');
  assertThrows(() => getLearnerHistory(null), 'must not be null or empty', 'null learnerId throws');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 4: getRecentAssessments
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 4: getRecentAssessments ────────────────────────────────────');

  console.log('\nTest LR-11: getRecentAssessments respects the limit');
  const recent = getRecentAssessments(sipho, 1);
  assertEq(recent.length, 1, 'limit=1 returns exactly one row');
  assertEq(recent[0].title, 'Term 2 Test', 'the single row returned is the most recent');

  console.log('\nTest LR-12: getRecentAssessments defaults to 10');
  const recentDefault = getRecentAssessments(sipho);
  assertEq(recentDefault.length, 2, 'default limit of 10 returns all available (2) rows');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 5: isolation — teacher, class, duplicate names
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 5: isolation ────────────────────────────────────────────────');

  console.log('\nTest LR-13: a learner with no history returns empty arrays, not a throw');
  const lonely = insertLearner(_db, { phoneHash: TEACHER_A, classId: classA, name: 'Lindiwe' });
  assertEq(getAssessmentHistory(lonely), [], 'empty assessment history is []');
  assertEq(getObservationHistory(lonely), [], 'empty observation history is []');
  assertEq(getLearnerHistory(lonely), [], 'empty merged history is []');

  console.log('\nTest LR-14: duplicate learner names in different classes are distinct rows/histories');
  const siphoClassB = insertLearner(_db, { phoneHash: TEACHER_A, classId: classB, name: 'Sipho' });
  const assessmentClassB = insertAssessment(_db, { phoneHash: TEACHER_A, title: 'Class B Test' });
  insertResult(_db, { assessmentId: assessmentClassB, learnerId: siphoClassB, learnerName: 'Sipho', mark: 5, createdAt: '2026-04-01 09:00:00' });
  assert(sipho !== siphoClassB, 'same name in different classes yields different learner ids');
  const classAHistory = getAssessmentHistory(sipho);
  const classBHistory = getAssessmentHistory(siphoClassB);
  assert(!classAHistory.some(e => e.title === 'Class B Test'), "class A Sipho's history does not include class B Sipho's result");
  assertEq(classBHistory.length, 1, "class B Sipho's history is isolated to their own single result");

  console.log('\nTest LR-15: getClassHistory isolates by class and splits assessments/observations');
  const classAResult = getClassHistory(classA);
  const classBResult = getClassHistory(classB);
  assert(Array.isArray(classAResult.assessments) && Array.isArray(classAResult.observations), 'getClassHistory returns {assessments, observations} shape');
  assert(classAResult.assessments.some(e => e.title === 'Term 1 Test'), 'class A history includes class A assessment');
  assert(!classAResult.assessments.some(e => e.title === 'Class B Test'), 'class A history excludes class B assessment');
  assert(classBResult.assessments.some(e => e.title === 'Class B Test'), 'class B history includes its own assessment');
  assertEq(classBResult.observations, [], 'class B has no observation records — returns []');

  console.log('\nTest LR-16: getClassHistory throws on missing argument');
  assertThrows(() => getClassHistory(null), 'must not be null or empty', 'null classId throws');

  console.log('\nTest LR-17: teacher isolation — TEACHER_B has no rows and sees nothing via TEACHER_A\'s class');
  const teacherBLearner = insertLearner(_db, { phoneHash: TEACHER_B, classId: null, name: 'Nomvula' });
  assertEq(getAssessmentHistory(teacherBLearner), [], "TEACHER_B's learner has no assessment history");
  assertEq(getObservationHistory(teacherBLearner), [], "TEACHER_B's learner has no observation history");

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 6: searchLearnersByName
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 6: searchLearnersByName ────────────────────────────────────');

  console.log('\nTest LR-18: partial, case-insensitive match finds the learner');
  const thabo = insertLearner(_db, { phoneHash: TEACHER_A, classId: classA, name: 'Thabo Nkosi' });
  const partialMatch = searchLearnersByName('thabo', { phoneHash: TEACHER_A });
  assert(partialMatch.some(l => l.id === thabo), 'lowercase partial term matches "Thabo Nkosi"');

  console.log('\nTest LR-19: search is scoped by phoneHash — TEACHER_B does not see TEACHER_A results');
  const noCrossTeacher = searchLearnersByName('thabo', { phoneHash: TEACHER_B });
  assertEq(noCrossTeacher, [], "TEACHER_B's search for TEACHER_A's learner returns []");

  console.log('\nTest LR-20: search is scoped by classId when provided');
  const classScoped = searchLearnersByName('sipho', { phoneHash: TEACHER_A, classId: classB });
  assert(classScoped.every(l => l.id !== sipho), 'classId scoping excludes class A Sipho');
  assert(classScoped.some(l => l.id === siphoClassB), 'classId scoping includes class B Sipho');

  console.log('\nTest LR-21: no match returns an empty array, not a throw');
  assertEq(searchLearnersByName('zzznomatch', { phoneHash: TEACHER_A }), [], 'no match returns []');

  console.log('\nTest LR-22: respects limit');
  const limitedSearch = searchLearnersByName('a', { phoneHash: TEACHER_A, limit: 1 });
  assertEq(limitedSearch.length, 1, 'limit=1 returns exactly one row');

  console.log('\nTest LR-23: throws on empty name');
  assertThrows(() => searchLearnersByName(''), 'must not be null or empty', 'empty name throws');
  assertThrows(() => searchLearnersByName('   '), 'must not be null or empty', 'whitespace-only name throws');

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`Learner Repository Results: ${passed} passed, ${failed} failed`);

  testDb.cleanup();

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
