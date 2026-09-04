'use strict';
/**
 * Migration 029 + Blueprint Repository Tests (ADR-005 Phase 1)
 *
 * Covers:
 *   1. Migration 029 verification (per MIGRATION-029-assessment-blueprints.md
 *      §"Verification after applying") — blueprint_id nullable on
 *      assessments, both NULL and populated rows read back correctly.
 *   2. createBlueprint() input guards + transaction atomicity
 *   3. Round-trip retrieval via getBlueprintById()
 *   4. listBlueprints() filtering (subject/grade/status/archived exclusion)
 *   5. Lifecycle: draft → published lock, archive, ownership checks
 *   6. createBlueprintVersion() revision chain
 *   7. addQuestion()/updateQuestion()/deleteQuestion() draft-only guards
 *
 * Run individually:   node tests/migration-029-blueprint-repository.test.js
 * Run via npm:        npm test
 */

// ── Shared real-migrations test DB helper (see docs/TSE_SCHOOL_CALENDAR_TEST_GAP.md) ──
const { createTestDb } = require('./helpers/createTestDb');

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

// ── Test runner ───────────────────────────────────────────────────────────────
async function run() {
  const testDb = createTestDb(__filename);
  const _db = testDb.db;

  const {
    createBlueprint,
    createBlueprintVersion,
    getBlueprintById,
    listBlueprints,
    updateBlueprintMetadata,
    addQuestion,
    updateQuestion,
    deleteQuestion,
    publishBlueprint,
    archiveBlueprint,
    deleteBlueprint,
  } = require('../services/blueprintRepository');

  const PHONE = 'bp_test_hash_001';
  const OTHER_PHONE = 'bp_test_hash_002';
  _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(PHONE);
  _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(OTHER_PHONE);

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 1: Migration 029 verification (per migration doc's own
  // "Verification after applying" checklist)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 1: Migration 029 verification ───────────────────────────');

  console.log('\nTest M29-01: assessments.blueprint_id defaults to NULL for existing rows');
  const legacyAssessment = _db.prepare(
    `INSERT INTO assessments (phone_hash, title, grade, subject, term, assessment_type, total_marks)
     VALUES (?, 'Legacy Test', 6, 'Mathematics', 2, 'test', 20)`
  ).run(PHONE);
  const legacyRow = _db.prepare(`SELECT blueprint_id FROM assessments WHERE id = ?`).get(legacyAssessment.lastInsertRowid);
  assertEq(legacyRow.blueprint_id, null, 'pre-existing assessment row has NULL blueprint_id, no error');

  console.log('\nTest M29-02: assessments.blueprint_id can reference a blueprint');
  const setup = createBlueprint(PHONE, { title: 'Fractions Test', subject: 'Mathematics', grade: 6, totalMarks: 20 }, [
    { questionNumber: 1, topic: 'Fractions', maxMarks: 10 },
    { questionNumber: 2, topic: 'Decimals', maxMarks: 10 },
  ]);
  const linkedAssessment = _db.prepare(
    `INSERT INTO assessments (phone_hash, blueprint_id, title, grade, subject, term, assessment_type, total_marks)
     VALUES (?, ?, 'Linked Test', 6, 'Mathematics', 2, 'test', 20)`
  ).run(PHONE, setup.blueprintId);
  const linkedRow = _db.prepare(`SELECT blueprint_id FROM assessments WHERE id = ?`).get(linkedAssessment.lastInsertRowid);
  assertEq(linkedRow.blueprint_id, setup.blueprintId, 'linked assessment row reads back the correct blueprint_id');

  console.log('\nTest M29-03: idempotent re-run of CREATE TABLE IF NOT EXISTS is a safe no-op');
  assert((() => {
    try {
      _db.exec(`CREATE TABLE IF NOT EXISTS assessment_blueprints (id INTEGER PRIMARY KEY)`);
      return true;
    } catch (_) {
      return false;
    }
  })(), 're-running the migration does not throw');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 2: createBlueprint() input guards + atomicity
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 2: createBlueprint() input guards + atomicity ───────────');

  console.log('\nTest BP-01: null phoneHash → throws');
  assertThrows(
    () => createBlueprint(null, { title: 'X', subject: 'Mathematics', grade: 6, totalMarks: 10 }, [{ questionNumber: 1, topic: 'Fractions', maxMarks: 10 }]),
    'phoneHash must not be null or empty',
    'null phoneHash throws'
  );

  console.log('\nTest BP-02: missing header fields → throws');
  assertThrows(
    () => createBlueprint(PHONE, { title: 'X', subject: 'Mathematics' }, [{ questionNumber: 1, topic: 'Fractions', maxMarks: 10 }]),
    'header must include',
    'missing grade/totalMarks throws'
  );

  console.log('\nTest BP-03: empty questions array → throws');
  assertThrows(
    () => createBlueprint(PHONE, { title: 'X', subject: 'Mathematics', grade: 6, totalMarks: 10 }, []),
    'questions must be a non-empty array',
    'empty questions array throws'
  );

  console.log('\nTest BP-04: question missing topic → whole transaction rolls back');
  const beforeCount = _db.prepare(`SELECT COUNT(*) as c FROM assessment_blueprints WHERE phone_hash = ?`).get(PHONE).c;
  assertThrows(
    () => createBlueprint(PHONE, { title: 'Bad Test', subject: 'Mathematics', grade: 6, totalMarks: 10 }, [
      { questionNumber: 1, topic: null, maxMarks: 10 },
    ]),
    'every question requires questionNumber, topic, and maxMarks',
    'question missing topic throws before insert'
  );
  const afterCount = _db.prepare(`SELECT COUNT(*) as c FROM assessment_blueprints WHERE phone_hash = ?`).get(PHONE).c;
  assertEq(afterCount, beforeCount, 'no orphaned blueprint header row created on guard failure');

  console.log('\nTest BP-05: valid create returns blueprintId and questionCount');
  const created = createBlueprint(PHONE, { title: 'Decimals Test', subject: 'Mathematics', grade: 6, term: 2, totalMarks: 30 }, [
    { questionNumber: 1, topic: 'Decimals', maxMarks: 15 },
    { questionNumber: 2, topic: 'Fractions', maxMarks: 15 },
  ]);
  assert(created.blueprintId > 0, 'valid create returns a positive blueprintId');
  assertEq(created.questionCount, 2, 'valid create reports correct questionCount');

  console.log('\nTest BP-05b: createBlueprint rejects duplicate question_number in the input set');
  assertThrows(
    () => createBlueprint(PHONE, { title: 'Dup Test', subject: 'Mathematics', grade: 6, totalMarks: 20 }, [
      { questionNumber: 1, topic: 'Fractions', maxMarks: 10 },
      { questionNumber: 1, topic: 'Decimals', maxMarks: 10 },
    ]),
    'duplicate question_number 1',
    'duplicate question_number across two questions in one create call throws'
  );

  console.log('\nTest BP-05c: createBlueprintVersion rejects duplicate question_number in the input set');
  assertThrows(
    () => createBlueprintVersion(created.blueprintId, PHONE, {}, [
      { questionNumber: 1, topic: 'Fractions', maxMarks: 10 },
      { questionNumber: 1, topic: 'Decimals', maxMarks: 10 },
    ]),
    'duplicate question_number 1',
    'duplicate question_number across two questions in one version call throws'
  );

  console.log('\nTest BP-05d: addQuestion rejects a question_number that already exists on the blueprint');
  assertThrows(
    () => addQuestion(created.blueprintId, PHONE, { questionNumber: 1, topic: 'Ratios', maxMarks: 5 }),
    'question_number 1 already exists',
    'addQuestion throws when question_number collides with an existing row'
  );

  console.log('\nTest BP-05e: updateQuestion rejects renumbering into an existing question_number');
  const dupTarget = createBlueprint(PHONE, { title: 'Renumber Test', subject: 'Mathematics', grade: 6, totalMarks: 20 }, [
    { questionNumber: 1, topic: 'Fractions', maxMarks: 10 },
    { questionNumber: 2, topic: 'Decimals', maxMarks: 10 },
  ]);
  const q2Id = getBlueprintById(dupTarget.blueprintId).questions.find((q) => q.questionNumber === 2).id;
  assertThrows(
    () => updateQuestion(q2Id, PHONE, { questionNumber: 1 }),
    'question_number 1 already exists',
    'updateQuestion throws when renumbering collides with a sibling question'
  );

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 3: getBlueprintById() round trip
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 3: getBlueprintById() round trip ─────────────────────────');

  console.log('\nTest BP-06: retrieved blueprint matches what was created');
  const fetched = getBlueprintById(created.blueprintId);
  assertEq(fetched.title, 'Decimals Test', 'title round-trips correctly');
  assertEq(fetched.status, 'draft', 'new blueprint defaults to draft status');
  assertEq(fetched.version, 1, 'new blueprint starts at version 1');
  assertEq(fetched.previousVersionId, null, 'new blueprint has no previous version');
  assertEq(fetched.questions.length, 2, 'both questions retrieved');
  assertEq(fetched.questions[0].questionNumber, 1, 'questions ordered by question_number ASC');

  console.log('\nTest BP-07: nonexistent blueprint returns null');
  assertEq(getBlueprintById(999999), null, 'nonexistent blueprintId returns null, not throw');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 4: listBlueprints() filtering
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 4: listBlueprints() filtering ────────────────────────────');

  console.log('\nTest BP-08: listBlueprints filters by subject');
  createBlueprint(PHONE, { title: 'Reading Comprehension', subject: 'English', grade: 6, totalMarks: 20 }, [
    { questionNumber: 1, topic: 'Comprehension', maxMarks: 20 },
  ]);
  const mathsOnly = listBlueprints(PHONE, { subject: 'Mathematics' });
  assert(mathsOnly.every((b) => b.subject === 'Mathematics'), 'subject filter excludes non-matching blueprints');

  console.log('\nTest BP-09: listBlueprints excludes archived by default');
  const archiveTarget = createBlueprint(PHONE, { title: 'Old Test', subject: 'Mathematics', grade: 6, totalMarks: 10 }, [
    { questionNumber: 1, topic: 'Fractions', maxMarks: 10 },
  ]);
  archiveBlueprint(archiveTarget.blueprintId, PHONE);
  const defaultList = listBlueprints(PHONE);
  assert(!defaultList.some((b) => b.id === archiveTarget.blueprintId), 'archived blueprint excluded from default list');

  console.log('\nTest BP-10: listBlueprints includeArchived surfaces it again');
  const withArchived = listBlueprints(PHONE, { includeArchived: true });
  assert(withArchived.some((b) => b.id === archiveTarget.blueprintId), 'archived blueprint returned when includeArchived is true');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 5: Lifecycle — draft edits, publish lock, ownership
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 5: Lifecycle (draft/published/archived + ownership) ─────');

  console.log('\nTest BP-11: updateBlueprintMetadata works while draft');
  const editable = createBlueprint(PHONE, { title: 'Editable Test', subject: 'Mathematics', grade: 6, totalMarks: 10 }, [
    { questionNumber: 1, topic: 'Fractions', maxMarks: 10 },
  ]);
  updateBlueprintMetadata(editable.blueprintId, PHONE, { title: 'Renamed Test' });
  assertEq(getBlueprintById(editable.blueprintId).title, 'Renamed Test', 'metadata update applies while draft');

  console.log('\nTest BP-12: another teacher cannot update metadata');
  assertThrows(
    () => updateBlueprintMetadata(editable.blueprintId, OTHER_PHONE, { title: 'Hijacked' }),
    "cannot modify another teacher's blueprint",
    "cross-teacher metadata update throws"
  );

  console.log('\nTest BP-13: publishBlueprint locks the blueprint');
  publishBlueprint(editable.blueprintId, PHONE);
  assertEq(getBlueprintById(editable.blueprintId).status, 'published', 'status transitions to published');

  console.log('\nTest BP-14: updateBlueprintMetadata blocked after publish');
  assertThrows(
    () => updateBlueprintMetadata(editable.blueprintId, PHONE, { title: 'Too Late' }),
    'cannot modify a blueprint that is already published',
    'metadata edit blocked once published'
  );

  console.log('\nTest BP-15: addQuestion blocked after publish');
  assertThrows(
    () => addQuestion(editable.blueprintId, PHONE, { questionNumber: 2, topic: 'Decimals', maxMarks: 5 }),
    'cannot modify a blueprint that is already published',
    'addQuestion blocked once published'
  );

  console.log('\nTest BP-16: publishBlueprint blocked on already-published blueprint');
  assertThrows(
    () => publishBlueprint(editable.blueprintId, PHONE),
    'cannot publish a blueprint that is already published',
    're-publishing an already-published blueprint throws'
  );

  console.log('\nTest BP-17: publishBlueprint blocked with zero questions');
  const empty = createBlueprint(PHONE, { title: 'Placeholder', subject: 'Mathematics', grade: 6, totalMarks: 10 }, [
    { questionNumber: 1, topic: 'Fractions', maxMarks: 10 },
  ]);
  deleteQuestion(getBlueprintById(empty.blueprintId).questions[0].id, PHONE);
  assertThrows(
    () => publishBlueprint(empty.blueprintId, PHONE),
    'cannot publish a blueprint with no questions',
    'publishing with zero questions throws'
  );

  console.log('\nTest BP-18: deleteBlueprint blocked once published (must archive instead)');
  assertThrows(
    () => deleteBlueprint(editable.blueprintId, PHONE),
    'cannot modify a blueprint that is already published',
    'hard delete blocked on published blueprint'
  );

  console.log('\nTest BP-19: deleteBlueprint works on a draft');
  const draftToDelete = createBlueprint(PHONE, { title: 'Throwaway', subject: 'Mathematics', grade: 6, totalMarks: 10 }, [
    { questionNumber: 1, topic: 'Fractions', maxMarks: 10 },
  ]);
  deleteBlueprint(draftToDelete.blueprintId, PHONE);
  assertEq(getBlueprintById(draftToDelete.blueprintId), null, 'draft blueprint fully removed after delete');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 6: createBlueprintVersion() revision chain
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 6: createBlueprintVersion() revision chain ───────────────');

  console.log('\nTest BP-20: revising a published blueprint creates a new draft version');
  const revised = createBlueprintVersion(editable.blueprintId, PHONE, {}, [
    { questionNumber: 1, topic: 'Decimals', maxMarks: 10 },
  ]);
  assertEq(revised.version, 2, 'new version is priorVersion + 1');
  assertEq(revised.previousVersionId, editable.blueprintId, 'previousVersionId points at the prior version');

  console.log('\nTest BP-21: prior version is untouched by the revision');
  const priorAfterRevision = getBlueprintById(editable.blueprintId);
  assertEq(priorAfterRevision.status, 'published', 'prior version keeps its published status');
  assertEq(priorAfterRevision.questions[0].topic, 'Fractions', 'prior version keeps its original question data');

  console.log('\nTest BP-22: new version starts as an editable draft');
  const newVersion = getBlueprintById(revised.blueprintId);
  assertEq(newVersion.status, 'draft', 'new version starts in draft status');
  assertEq(newVersion.questions[0].topic, 'Decimals', 'new version carries the corrected question data');

  console.log('\nTest BP-23: another teacher cannot version a blueprint they do not own');
  assertThrows(
    () => createBlueprintVersion(editable.blueprintId, OTHER_PHONE, {}, [{ questionNumber: 1, topic: 'Fractions', maxMarks: 10 }]),
    "cannot version another teacher's blueprint",
    'cross-teacher versioning throws'
  );

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 7: updateQuestion() / deleteQuestion() guards
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 7: updateQuestion()/deleteQuestion() guards ──────────────');

  console.log('\nTest BP-24: updateQuestion works while parent blueprint is draft');
  const qId = newVersion.questions[0].id;
  updateQuestion(qId, PHONE, { maxMarks: 12 });
  assertEq(getBlueprintById(revised.blueprintId).questions[0].maxMarks, 12, 'question update applies while draft');

  console.log('\nTest BP-25: updateQuestion blocked once parent is published');
  publishBlueprint(revised.blueprintId, PHONE);
  assertThrows(
    () => updateQuestion(qId, PHONE, { maxMarks: 99 }),
    'cannot edit a question on a published blueprint',
    'updateQuestion blocked once parent published'
  );

  console.log('\nTest BP-26: deleteQuestion blocked once parent is published');
  assertThrows(
    () => deleteQuestion(qId, PHONE),
    'cannot delete a question on a published blueprint',
    'deleteQuestion blocked once parent published'
  );

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 8: publishBlueprint() CAPS topic validation gate (ADR-005 §7)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 8: publishBlueprint() CAPS topic validation ──────────────');

  console.log('\nTest BP-27: publish blocked on an unresolved (misspelled) topic');
  const badTopic = createBlueprint(PHONE, { title: 'Typo Test', subject: 'Mathematics', grade: 7, term: 1, totalMarks: 10 }, [
    { questionNumber: 1, topic: 'Common fraction', maxMarks: 10 },
  ]);
  assertThrows(
    () => publishBlueprint(badTopic.blueprintId, PHONE),
    'unresolved topic(s) on question(s) 1',
    'publish blocked when a topic does not match the CAPS registry'
  );

  console.log('\nTest BP-28: publish succeeds once the topic is corrected');
  updateQuestion(getBlueprintById(badTopic.blueprintId).questions[0].id, PHONE, { topic: 'Common fractions' });
  const publishedAfterFix = publishBlueprint(badTopic.blueprintId, PHONE);
  assertEq(publishedAfterFix.status, 'published', 'publish succeeds once topic matches the registry exactly');

  console.log('\nTest BP-29: publish is not blocked for a subject with no CAPS registry coverage');
  const uncovered = createBlueprint(PHONE, { title: 'Life Orientation Quiz', subject: 'Life Orientation', grade: 7, term: 1, totalMarks: 10 }, [
    { questionNumber: 1, topic: 'Anything goes here', maxMarks: 10 },
  ]);
  const uncoveredPublish = publishBlueprint(uncovered.blueprintId, PHONE);
  assertEq(uncoveredPublish.status, 'published', 'blueprint for an unregistered subject still publishes');

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`Migration 029 / Blueprint Repository Results: ${passed} passed, ${failed} failed`);

  testDb.cleanup();

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
