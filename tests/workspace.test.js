'use strict';
/**
 * Integration tests for teacher workspace features:
 *   - teacherWorkspaceService (classes, assessment history)
 *   - curriculumCoverageService (topic tracking, dataAvailable flag, broader CAPS table)
 *
 * Uses the REAL migration chain (see tests/helpers/createTestDb.js) rather
 * than a hand-rolled schema mock, so this test can never drift from what
 * production actually creates (e.g. school_calendar / tse_evidence_links,
 * missing here previously — see docs/TSE_SCHOOL_CALENDAR_TEST_GAP.md).
 *
 * Run individually:   node tests/workspace.test.js
 * Run via npm:        npm test  (included in the test script)
 */

// MUST be required first — installs the better-sqlite3 → node:sqlite shim
// before utils/database.js (or any service that transitively requires it)
// is loaded. See tests/helpers/createTestDb.js for why.
const { createTestDb } = require('./helpers/createTestDb');

let _db = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
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

// ── Test runner ───────────────────────────────────────────────────────────────
async function run() {
  const testDb = createTestDb(__filename);
  _db = testDb.db;

  const HASH = 'testhash_workspace_001';

  // Seed a teacher with grade + subject set
  _db.prepare(`
    INSERT INTO teachers (phone_hash, name, grade, subject)
    VALUES (?, 'Ms Dlamini', 10, 'Mathematics')
  `).run(HASH);

  const {
    createClass,
    getTeacherClasses,
    getAssessmentHistory,
  } = require('../services/teacherWorkspaceService');

  const {
    markTopicCovered,
    analyzeCoverage,
    updateCoverageFromAssessment,
    getTeacherProgressReport,
  } = require('../services/curriculumCoverageService');

  // ── Test 1: createClass creates a record ──────────────────────────────────
  console.log('\nTest 1: createClass creates and returns a record');
  const cls = createClass(HASH, 'Grade 10A Mathematics', 10, 'Mathematics', 32);
  assert(cls && cls.id > 0, 'class was created with an ID');
  assertEq(cls.name, 'Grade 10A Mathematics', 'class name is correct');
  assertEq(cls.learner_count, 32, 'learner count is correct');

  // ── Test 2: first class becomes the default ───────────────────────────────
  console.log('\nTest 2: first class is auto-set as default');
  const teacher = _db.prepare('SELECT default_class_id FROM teachers WHERE phone_hash = ?').get(HASH);
  assertEq(teacher.default_class_id, cls.id, 'default_class_id was set to the first class');

  // ── Test 3: getTeacherClasses returns the class ───────────────────────────
  console.log('\nTest 3: getTeacherClasses returns created class');
  const classes = getTeacherClasses(HASH);
  assertEq(classes.length, 1, 'one class returned');
  assertEq(classes[0].name, 'Grade 10A Mathematics', 'class name matches');

  // ── Test 4: second class does NOT override default ────────────────────────
  console.log('\nTest 4: second class does not override default_class_id');
  createClass(HASH, 'Grade 10B Mathematics', 10, 'Mathematics', 28);
  const teacher2 = _db.prepare('SELECT default_class_id FROM teachers WHERE phone_hash = ?').get(HASH);
  assertEq(teacher2.default_class_id, cls.id, 'default_class_id still points to first class');

  // ── Test 5: getAssessmentHistory with no assessments ─────────────────────
  console.log('\nTest 5: getAssessmentHistory returns empty array for new teacher');
  const history = getAssessmentHistory(HASH);
  assertEq(history.length, 0, 'no assessments yet');

  // ── Test 6: getAssessmentHistory returns real data ────────────────────────
  console.log('\nTest 6: getAssessmentHistory returns seeded assessments with averages');
  const asmtId = _db.prepare(`
    INSERT INTO assessments (phone_hash, title, grade, subject, term, assessment_type, total_marks)
    VALUES (?, 'Term 2 Test', 10, 'Mathematics', 2, 'test', 100)
  `).run(HASH).lastInsertRowid;
  _db.prepare(`INSERT INTO learner_results (assessment_id, learner_name, mark, total_marks, percentage) VALUES (?, ?, ?, ?, ?)`).run(asmtId, 'Learner A', 72, 100, 72);
  _db.prepare(`INSERT INTO learner_results (assessment_id, learner_name, mark, total_marks, percentage) VALUES (?, ?, ?, ?, ?)`).run(asmtId, 'Learner B', 58, 100, 58);
  _db.prepare(`INSERT INTO learner_results (assessment_id, learner_name, mark, total_marks, percentage) VALUES (?, ?, ?, ?, ?)`).run(asmtId, 'Learner C', 80, 100, 80);

  const history2 = getAssessmentHistory(HASH);
  assertEq(history2.length, 1, 'one assessment in history');
  assertEq(history2[0].title, 'Term 2 Test', 'title matches');
  assertEq(history2[0].learner_count, 3, 'learner count is 3');
  const avg = Math.round(history2[0].class_average);
  assert(avg >= 69 && avg <= 71, `class average ~70% (got ${avg}%)`);

  // ── Test 7: markTopicCovered + analyzeCoverage ────────────────────────────
  console.log('\nTest 7: markTopicCovered and analyzeCoverage reflect persisted data');
  markTopicCovered(HASH, 10, 'Mathematics', 1, 'Functions');
  markTopicCovered(HASH, 10, 'Mathematics', 1, 'Algebra');
  const coverage = analyzeCoverage(HASH, 10, 'Mathematics', 1);
  assert(coverage.dataAvailable === true, 'dataAvailable is true for a supported subject/grade');
  assert(coverage.totalExpected > 0, `totalExpected > 0 (got ${coverage.totalExpected})`);
  assert(coverage.totalCovered >= 2, `at least 2 topics covered (got ${coverage.totalCovered})`);
  assert(coverage.overallCoverage > 0, `overallCoverage > 0% (got ${coverage.overallCoverage}%)`);

  // ── Test 8: dataAvailable is false for unsupported subject ────────────────
  console.log('\nTest 8: dataAvailable is false for a subject with no CAPS reference data');
  const unsupported = analyzeCoverage(HASH, 10, 'Accounting', 1);
  assertEq(unsupported.dataAvailable, false, 'Accounting Grade 10 has no reference data → dataAvailable false');
  assertEq(unsupported.overallCoverage, 0, 'overallCoverage is 0 when no reference data');

  // ── Test 9: Grade 9 Mathematics now works (was broken with the narrow table) ──
  console.log('\nTest 9: Grade 9 Mathematics returns data (was empty in the narrow table)');
  const grade9 = analyzeCoverage(HASH, 9, 'Mathematics', 1);
  assert(grade9.dataAvailable === true, 'Grade 9 Maths now has reference data via broader table');
  assert(grade9.totalExpected > 0, `Grade 9 Maths Term 1 has ${grade9.totalExpected} expected topics`);

  // ── Test 10: updateCoverageFromAssessment marks ATP topics ────────────────
  console.log('\nTest 10: updateCoverageFromAssessment marks atp_topics from assessment record');
  const HASH2 = 'testhash_workspace_002';
  _db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject) VALUES (?, 'Mr Khumalo', 7, 'Mathematics')`).run(HASH2);
  const asmtId2 = _db.prepare(`
    INSERT INTO assessments (phone_hash, title, grade, subject, term, assessment_type, total_marks, atp_topics)
    VALUES (?, 'Term 1 Test', 7, 'Mathematics', 1, 'test', 50, ?)
  `).run(HASH2, JSON.stringify(['Number operations', 'Integers'])).lastInsertRowid;

  updateCoverageFromAssessment(asmtId2);
  const rows = _db.prepare(`SELECT topic FROM curriculum_coverage WHERE phone_hash = ?`).all(HASH2);
  const topicNames = rows.map(r => r.topic);
  assert(topicNames.includes('Number operations'), 'Number operations marked as covered');
  assert(topicNames.includes('Integers'), 'Integers marked as covered');

  // ── Test 11: getTeacherProgressReport works end-to-end ────────────────────
  console.log('\nTest 11: getTeacherProgressReport returns correct data for a seeded teacher');
  const report = getTeacherProgressReport(HASH2);
  assert(!report.error, 'no error returned');
  assert(report.dataAvailable === true, 'dataAvailable true for Gr7 Mathematics');
  assert(report.totalCovered >= 2, `at least 2 topics covered (got ${report.totalCovered})`);

  // ── Test 12: getTeacherProgressReport handles incomplete profile ──────────
  console.log('\nTest 12: getTeacherProgressReport returns {error} for teacher with no grade/subject');
  const HASH3 = 'testhash_workspace_003';
  _db.prepare(`INSERT INTO teachers (phone_hash, name) VALUES (?, 'New Teacher')`).run(HASH3);
  const reportEmpty = getTeacherProgressReport(HASH3);
  assert(reportEmpty.error !== undefined, 'returns {error} object, not a crash');

  // ── Tests 13–24: validateNewClassInput — validation regression suite ──────
  //
  //  validateNewClassInput(name, rawCount, existingClasses)
  //  is a pure function with no DB access.  We test each failure path and
  //  the happy path here so that any future change to validation rules
  //  immediately surfaces as a failing test.

  const { validateNewClassInput } = require('../services/teacherWorkspaceService');

  console.log('\nTest 13: missing name → missing_name error');
  assertEq(validateNewClassInput('', '30', []).error, 'missing_name', 'empty name returns missing_name');

  console.log('\nTest 14: whitespace-only name → missing_name error');
  assertEq(validateNewClassInput('   ', '30', []).error, 'missing_name', 'whitespace name returns missing_name');

  console.log('\nTest 15: name longer than 80 chars → name_too_long error');
  const longName = 'A'.repeat(81);
  assertEq(validateNewClassInput(longName, '30', []).error, 'name_too_long', '81-char name returns name_too_long');

  console.log('\nTest 16: name at exactly 80 chars → valid');
  const maxName = 'Grade 7 Mathematics ' + 'A'.repeat(60); // exactly 80 chars
  assert(maxName.length === 80, `name is exactly 80 chars (got ${maxName.length})`);
  assert(validateNewClassInput(maxName, '30', []).valid === true, '80-char name is accepted');

  console.log('\nTest 17: name with only special characters → name_invalid_chars error');
  assertEq(validateNewClassInput('@#$%!', '30', []).error, 'name_invalid_chars', 'symbol-only name rejected');

  console.log('\nTest 18: missing count (empty string) → missing_count error');
  assertEq(validateNewClassInput('Grade 7A', '', []).error, 'missing_count', 'empty count returns missing_count');

  console.log('\nTest 19: non-numeric count → count_not_a_number error');
  assertEq(validateNewClassInput('Grade 7A', 'abc', []).error, 'count_not_a_number', '"abc" count rejected');

  console.log('\nTest 20: count = 0 → count_too_low error');
  assertEq(validateNewClassInput('Grade 7A', '0', []).error, 'count_too_low', 'zero learners rejected');

  console.log('\nTest 21: negative count → count_too_low error');
  assertEq(validateNewClassInput('Grade 7A', '-5', []).error, 'count_too_low', 'negative count rejected');

  console.log('\nTest 22: count > 200 → count_too_high error');
  assertEq(validateNewClassInput('Grade 7A', '201', []).error, 'count_too_high', '201 learners rejected');
  assertEq(validateNewClassInput('Grade 7A', '999', []).error, 'count_too_high', '999 learners rejected');

  console.log('\nTest 23: duplicate class name (case-insensitive) → duplicate_name error');
  const existingClasses = [{ name: 'Grade 7A Mathematics' }];
  assertEq(validateNewClassInput('Grade 7A Mathematics', '30', existingClasses).error, 'duplicate_name', 'exact-case duplicate rejected');
  assertEq(validateNewClassInput('grade 7a mathematics', '30', existingClasses).error, 'duplicate_name', 'lowercase duplicate rejected');
  assertEq(validateNewClassInput('GRADE 7A MATHEMATICS', '30', existingClasses).error, 'duplicate_name', 'uppercase duplicate rejected');
  assertEq(validateNewClassInput('  Grade 7A Mathematics  ', '30', existingClasses).error, 'duplicate_name', 'duplicate with surrounding whitespace rejected');

  console.log('\nTest 24: happy path with leading/trailing whitespace → valid, trimmed');
  const happy = validateNewClassInput('  Grade 8B Mathematics  ', ' 28 ', []);
  assert(happy.valid === true, 'padded valid input is accepted');
  assertEq(happy.name, 'Grade 8B Mathematics', 'name is trimmed');
  assertEq(happy.count, 28, 'count is parsed correctly');

  // Bonus: count "32 learners" (parseInt stops at non-digit) → valid
  const withSuffix = validateNewClassInput('Grade 9A', '32 learners', []);
  assert(withSuffix.valid === true, '"32 learners" is accepted (parseInt stops at non-digit)');
  assertEq(withSuffix.count, 32, '"32 learners" parses to 32');

  // ── Phase B: saveResource and getSavedResources ───────────────────────────

  console.log('\nTest 25: saveResource stores a resource and returns it with an id');
  const { saveResource, getSavedResources } = require('../services/teacherWorkspaceService');
  const phoneHash = 'testhash_phaseb';

  // Seed the teacher row first (saveResource increments saved_resources_count)
  _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(phoneHash);

  const saved1 = saveResource(phoneHash, 'worksheet', 'Fractions — worksheet', 'content here', {
    grade: 7, subject: 'mathematics', topic: 'Fractions', intent: 'worksheet', term: 2,
  });
  assert(saved1 && saved1.id > 0, 'saveResource returns object with id');
  assertEq(saved1.resource_type, 'worksheet', 'resource_type persisted');
  assertEq(saved1.title, 'Fractions — worksheet', 'title persisted');
  assertEq(saved1.grade, 7, 'grade persisted');
  assertEq(saved1.subject, 'mathematics', 'subject persisted');
  assertEq(saved1.topic, 'Fractions', 'topic persisted');

  console.log('\nTest 26: saveResource increments saved_resources_count on teacher row');
  const teacherRow = _db.prepare(`SELECT saved_resources_count FROM teachers WHERE phone_hash = ?`).get(phoneHash);
  assertEq(teacherRow.saved_resources_count, 1, 'saved_resources_count incremented to 1 after first save');

  console.log('\nTest 27: saveResource persists all searchable metadata in JSON column');
  const meta = JSON.parse(saved1.metadata);
  assertEq(meta.grade, 7,               'metadata.grade correct');
  assertEq(meta.subject, 'mathematics', 'metadata.subject correct');
  assertEq(meta.topic, 'Fractions',     'metadata.topic correct');
  assertEq(meta.intent, 'worksheet',    'metadata.intent correct');
  assertEq(meta.term, 2,                'metadata.term correct');

  console.log('\nTest 28: saveResource with optional atpTopic and term persists them');
  const saved2 = saveResource(phoneHash, 'atp', 'Number Sense — Annual Teaching Plan', 'atp content', {
    grade: 8, subject: 'mathematics', topic: 'Number Sense', intent: 'atp', term: 1, atpTopic: 'Whole numbers',
  });
  const meta2 = JSON.parse(saved2.metadata);
  assertEq(meta2.atpTopic, 'Whole numbers', 'atpTopic persisted in metadata');

  console.log('\nTest 29: getSavedResources returns resources in reverse-creation order');
  const resources = getSavedResources(phoneHash);
  assert(resources.length >= 2, 'at least 2 resources returned');
  // Most recent (saved2) should come first
  assertEq(resources[0].id, saved2.id, 'most recent resource is first');

  console.log('\nTest 30: getSavedResources filters by resource_type');
  const worksheets = getSavedResources(phoneHash, { resourceType: 'worksheet' });
  assert(worksheets.every(r => r.resource_type === 'worksheet'), 'all returned resources are worksheets');
  assertEq(worksheets.length, 1, 'exactly one worksheet returned');

  console.log('\nTest 31: getSavedResources filters by grade');
  const grade7 = getSavedResources(phoneHash, { grade: 7 });
  assert(grade7.every(r => r.grade === 7), 'all returned resources are grade 7');
  assertEq(grade7.length, 1, 'exactly one grade 7 resource returned');

  console.log('\nTest 32: getSavedResources with no matches returns empty array');
  const noMatch = getSavedResources(phoneHash, { grade: 12 });
  assertEq(noMatch.length, 0, 'no resources for grade 12');

  console.log('\nTest 33: getSavedResources for unknown teacher returns empty array');
  const noTeacher = getSavedResources('unknown_hash_xyz');
  assertEq(noTeacher.length, 0, 'empty array for unknown teacher');

  console.log('\nTest 34: saveResource — second save increments counter again');
  const saved3 = saveResource(phoneHash, 'test', 'Algebra — test & memorandum', 'test content', {
    grade: 7, subject: 'mathematics', topic: 'Algebra', intent: 'test',
  });
  assert(saved3 && saved3.id > saved2.id, 'third save gets a new id');
  const teacherRow2 = _db.prepare(`SELECT saved_resources_count FROM teachers WHERE phone_hash = ?`).get(phoneHash);
  assertEq(teacherRow2.saved_resources_count, 3, 'saved_resources_count is 3 after three saves');

  console.log('\nTest 35: getSavedResources respects limit — all 3 resources visible');
  const all3 = getSavedResources(phoneHash);
  assertEq(all3.length, 3, 'all 3 saved resources returned');

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  testDb.cleanup();
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
