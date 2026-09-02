'use strict';
/**
 * Reflections dashboard integration — end-to-end test against the REAL
 * database and the REAL services/reflectionService.js functions (no
 * mocks), covering the completion requirement:
 *
 *   Teacher creates a reflection via WhatsApp (REFLECT)
 *   -> reflection persisted in qms_reflections
 *   -> authenticated teacher opens the dashboard
 *   -> same reflection appears in the dashboard list
 *   -> teacher edits it from the dashboard
 *   -> the SAME row is updated, not a second copy
 *   -> teacher deletes it from the dashboard (soft delete)
 *   -> another teacher can never see, edit, or delete it
 *   -> a reflection created directly from the dashboard is immediately
 *      visible to WhatsApp's own read path (listReflections)
 *
 * This intentionally does NOT mock reflectionService's functions —
 * tests/api-reflections-write.test.js already covers the route layer
 * with mocks. This file exists specifically to prove the ownership
 * scoping actually holds in the real SQL (`WHERE id = ? AND
 * phone_hash = ?`), which a mocked test can't verify, and that
 * WhatsApp's createReflection call (flows/reflectionFlow.js) and the
 * dashboard's routes read/write the exact same qms_reflections row —
 * no second, dashboard-only storage model.
 *
 * NOTE on scope: unlike growth plans, the reflections API has no
 * GET /reflections/:id detail route (ReflectionPanel.jsx works off the
 * list only) — this is a pre-existing, deliberate surface, not
 * something this test introduces or treats as a gap. Detail-level
 * assertions below are made against the list response instead.
 *
 * Uses the real migration chain (tests/helpers/createTestDb.js), same
 * convention as tests/growth-plans-dashboard-e2e.test.js and
 * tests/resources-dashboard-e2e.test.js.
 *
 * Run individually: node tests/reflections-dashboard-e2e.test.js
 * Run via npm:       npm test
 */

const { createTestDb } = require('./helpers/createTestDb');

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

function run() {
  const testDb = createTestDb(__filename);
  const db = testDb.db;

  const {
    createReflection,
    getReflection,
    listReflections,
    updateReflection,
    deleteReflection,
  } = require('../services/reflectionService');
  const {
    createGetReflectionsHandler,
    createPostReflectionHandler,
    createPatchReflectionHandler,
    createDeleteReflectionHandler,
  } = require('../routes/api').__testExports;

  const TEACHER_A_HASH = 'testhash_reflections_teacherA';
  const TEACHER_B_HASH = 'testhash_reflections_teacherB';

  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject) VALUES (?, 'Teacher A', 7, 'Mathematics')`).run(TEACHER_A_HASH);
  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject) VALUES (?, 'Teacher B', 7, 'Mathematics')`).run(TEACHER_B_HASH);

  // ── Step 1: "Teacher creates a reflection via WhatsApp (REFLECT)" ────
  // This is exactly what flows/reflectionFlow.js calls after the
  // conversational REFLECT flow completes — same function, same
  // metadata shape (term/topicId/aiAssisted/evidenceLinkIds). Nothing
  // about this call is dashboard-specific.
  console.log('\n── Step 1: WhatsApp-side persistence (flows/reflectionFlow.js\'s createReflection call) ──');
  const created = createReflection(TEACHER_A_HASH, {
    content: 'Lesson went well overall, but pacing on the worked examples was too slow for the top group.',
    term: 2,
    topicId: 'TOPIC_DIFFERENTIATION',
  });
  assert(created && created.id > 0, 'reflection persisted via the same createReflection() WhatsApp uses');
  assert(created.aiAssisted === false, 'new reflection defaults to aiAssisted=false');

  // ── Step 2: "authenticated teacher opens the dashboard" ──────────────
  console.log('\n── Step 2: dashboard list retrieval (GET /api/reflections) ──');
  const listHandler = createGetReflectionsHandler({ listReflections });
  const listRes = mockRes();
  listHandler(mockReq(TEACHER_A_HASH), listRes);
  assert(listRes.statusCode === 200, 'list route returns 200');
  const listed = listRes.body.reflections.find(r => r.id === created.id);
  assert(!!listed, 'the WhatsApp-created reflection appears in Teacher A\'s dashboard list');
  assert(listed.content === 'Lesson went well overall, but pacing on the worked examples was too slow for the top group.', 'dashboard displays the exact same persisted content WhatsApp created');
  assert(listed.topicId === 'TOPIC_DIFFERENTIATION', 'topic visible');
  assert(listed.term === 2, 'term context visible');
  assert(!!listed.createdAt, 'created date/time visible');

  // ── Step 3: "teacher edits it from the dashboard" — same row updated ─
  console.log('\n── Step 3: dashboard edit (PATCH /api/reflections/:id) updates the SAME row ──');
  const patchHandler = createPatchReflectionHandler({ updateReflection });
  const editRes = mockRes();
  patchHandler(mockReq(TEACHER_A_HASH, { id: String(created.id) }, { content: 'Lesson went well overall; slowed the worked examples down further for the top group next time.' }), editRes);
  assert(editRes.statusCode === 200, 'edit route returns 200');
  assert(editRes.body.reflection.id === created.id, 'the edit updated the same row (same id), not a new one');

  const countAfterEdit = db.prepare(`SELECT COUNT(*) AS c FROM qms_reflections WHERE phone_hash = ?`).get(TEACHER_A_HASH).c;
  assert(countAfterEdit === 1, 'exactly one row exists for Teacher A after the edit — no duplicate created');

  const rawAfterEdit = getReflection(TEACHER_A_HASH, created.id);
  assert(rawAfterEdit.content === 'Lesson went well overall; slowed the worked examples down further for the top group next time.', 'the real DB row itself reflects the dashboard edit, not just the response');

  // ── Step 4: "another teacher cannot see, edit, or delete it" — real SQL
  console.log('\n── Step 4: cross-teacher isolation (real SQL, not a mock) ──');
  assert(getReflection(TEACHER_B_HASH, created.id) === null, 'getReflection() itself — the real WHERE id=? AND phone_hash=? query — returns null for a different teacher\'s id');

  const intruderListRes = mockRes();
  listHandler(mockReq(TEACHER_B_HASH), intruderListRes);
  assert(!intruderListRes.body.reflections.some(r => r.id === created.id), 'Teacher B\'s reflections list does not include Teacher A\'s reflection');

  const intruderPatchRes = mockRes();
  patchHandler(mockReq(TEACHER_B_HASH, { id: String(created.id) }, { content: 'Overwritten by an intruder.' }), intruderPatchRes);
  assert(intruderPatchRes.statusCode === 404, 'Teacher B cannot edit Teacher A\'s reflection (404, not a silent no-op success)');
  assert(getReflection(TEACHER_A_HASH, created.id).content !== 'Overwritten by an intruder.', 'the real DB row was genuinely untouched by the intruder\'s edit attempt');

  const deleteHandler = createDeleteReflectionHandler({ deleteReflection });
  const intruderDeleteRes = mockRes();
  deleteHandler(mockReq(TEACHER_B_HASH, { id: String(created.id) }), intruderDeleteRes);
  assert(intruderDeleteRes.statusCode === 404, 'Teacher B cannot delete Teacher A\'s reflection');
  assert(getReflection(TEACHER_A_HASH, created.id) !== null, 'the real DB row still exists after the intruder\'s delete attempt');

  // ── Step 5: "teacher deletes it from the dashboard" — soft delete ────
  console.log('\n── Step 5: dashboard delete (DELETE /api/reflections/:id), by its real owner ──');
  const ownerDeleteRes = mockRes();
  deleteHandler(mockReq(TEACHER_A_HASH, { id: String(created.id) }), ownerDeleteRes);
  assert(ownerDeleteRes.statusCode === 204, 'owner delete returns 204');
  assert(getReflection(TEACHER_A_HASH, created.id) === null, 'the reflection no longer resolves via getReflection() (soft-deleted, deleted_at set)');

  const rawRowAfterDelete = db.prepare(`SELECT * FROM qms_reflections WHERE id = ?`).get(created.id);
  assert(rawRowAfterDelete !== undefined, 'the row still physically exists in the table (soft delete, per ADR-011 §7 — never a hard DELETE)');
  assert(rawRowAfterDelete.deleted_at !== null, 'deleted_at is set on the real row');

  const listAfterDeleteRes = mockRes();
  listHandler(mockReq(TEACHER_A_HASH), listAfterDeleteRes);
  assert(!listAfterDeleteRes.body.reflections.some(r => r.id === created.id), 'the deleted reflection no longer appears in Teacher A\'s own dashboard list');

  // ── Step 6: "no second, dashboard-only reflection storage model" ─────
  // A reflection created directly from the dashboard (POST) lands in the
  // exact same table WhatsApp's REFLECT flow writes to, and is
  // immediately visible to a subsequent WhatsApp-side read
  // (listReflections, the same function flows/qmsFlow.js's MY
  // REFLECTIONS command calls).
  console.log('\n── Step 6: dashboard-created reflection is visible to the WhatsApp-side read path too ──');
  const postHandler = createPostReflectionHandler({ createReflection });
  const dashboardCreateRes = mockRes();
  postHandler(mockReq(TEACHER_A_HASH, {}, { content: 'Dashboard-authored reflection: retaught fractions using fraction bars.', topicId: 'TOPIC_CURRICULUM_COVERAGE' }), dashboardCreateRes);
  assert(dashboardCreateRes.statusCode === 201, 'dashboard create route returns 201');

  const dashboardCreatedId = dashboardCreateRes.body.reflection.id;
  const whatsAppSideList = listReflections(TEACHER_A_HASH);
  assert(
    whatsAppSideList.some(r => r.id === dashboardCreatedId && r.content === 'Dashboard-authored reflection: retaught fractions using fraction bars.'),
    'a reflection created via the dashboard POST route is immediately visible via the same listReflections() WhatsApp\'s MY REFLECTIONS would read from'
  );

  console.log(`\n📊 Total:  ${passed + failed}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    sent: false,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    send() { this.sent = true; return this; },
  };
}

function mockReq(phoneHash, params = {}, body = {}) {
  return { teacher: { id: 1, phoneHash }, query: {}, params, body };
}

run();
