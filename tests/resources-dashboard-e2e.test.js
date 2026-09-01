'use strict';
/**
 * Feature 2 dashboard integration — end-to-end test against the REAL
 * database and the REAL services/teacherWorkspaceService.js functions
 * (no mocks), covering the completion requirement:
 *
 *   Teacher creates lesson plan via WhatsApp
 *   -> lesson plan + homework persisted
 *   -> authenticated teacher opens dashboard
 *   -> same lesson plan appears
 *   -> same homework appears
 *   -> another teacher cannot see it
 *
 * This intentionally does NOT mock getSavedResource/getSavedResources —
 * tests/api-resources.test.js already covers the route layer with mocks.
 * This file exists specifically to prove the ownership scoping actually
 * holds in the real SQL (`WHERE id = ? AND phone_hash = ?`), which a
 * mocked test can't verify — a mock that "forgets" to check phoneHash
 * would still pass a mocked test.
 *
 * Uses the real migration chain (tests/helpers/createTestDb.js), same
 * convention as tests/workspace.test.js.
 *
 * Run individually: node tests/resources-dashboard-e2e.test.js
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

  const { saveResource, getSavedResources, getSavedResource } = require('../services/teacherWorkspaceService');
  const { createGetResourcesHandler, createGetResourceDetailHandler } = require('../routes/api').__testExports;

  const TEACHER_A_HASH = 'testhash_resources_teacherA';
  const TEACHER_B_HASH = 'testhash_resources_teacherB';

  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject) VALUES (?, 'Teacher A', 7, 'Mathematics')`).run(TEACHER_A_HASH);
  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject) VALUES (?, 'Teacher B', 7, 'Mathematics')`).run(TEACHER_B_HASH);

  // ── Step 1: "Teacher creates lesson plan via WhatsApp" ──────────────
  // This is exactly what core/commandHandler.js's SAVE handler does
  // after a Feature 2 lesson-plan generation — same function, same
  // metadata shape (term/atpTopic/differentiation/homework), same
  // resourceType. Nothing about this call is dashboard-specific.
  const generatedContent =
    '*LESSON PLAN: Fractions — Grade 7 Mathematics*\n' +
    '*LEARNING OBJECTIVES*\nLearners will add and subtract fractions with like denominators.\n\n' +
    '*HOMEWORK*\nComplete Exercise 4B, questions 1–10, on adding fractions with like denominators.\n\n' +
    '*DIFFERENTIATION*\n• Support: fewer questions';

  console.log('\n── Step 1: WhatsApp-side persistence (core/commandHandler.js\'s SAVE path) ──');
  const saved = saveResource(
    TEACHER_A_HASH,
    'lessonPlan',
    'Fractions — Grade 7 Mathematics',
    generatedContent,
    {
      grade: 7,
      subject: 'Mathematics',
      topic: 'Fractions',
      term: 2,
      atpTopic: true,
      homework: 'Complete Exercise 4B, questions 1–10, on adding fractions with like denominators.',
    }
  );
  assert(saved && saved.id > 0, 'lesson plan + homework persisted via the same saveResource() WhatsApp uses');

  // ── Step 2: "authenticated teacher opens dashboard" ─────────────────
  console.log('\n── Step 2: dashboard list retrieval (GET /api/resources) ──');
  const listHandler = createGetResourcesHandler({ getSavedResources });
  const listRes = mockRes();
  listHandler(mockReq(TEACHER_A_HASH), listRes);
  assert(listRes.statusCode === 200, 'list route returns 200');
  assert(listRes.body.resources.some(r => r.id === saved.id), 'the WhatsApp-created lesson plan appears in Teacher A\'s dashboard list');

  console.log('\n── Step 3: dashboard detail retrieval (GET /api/resources/:id) ──');
  const detailHandler = createGetResourceDetailHandler({ getSavedResource });
  const detailRes = mockRes();
  detailHandler(mockReq(TEACHER_A_HASH, { id: String(saved.id) }), detailRes);
  assert(detailRes.statusCode === 200, 'detail route returns 200');
  assert(detailRes.body.content === generatedContent, 'dashboard displays the exact same persisted lesson-plan content WhatsApp delivered');
  assert(
    detailRes.body.homework === 'Complete Exercise 4B, questions 1–10, on adding fractions with like denominators.',
    'dashboard displays the EXACT persisted homework — not a re-generated version'
  );
  assert(detailRes.body.topic === 'Fractions', 'topic visible');
  assert(detailRes.body.grade === 7, 'grade visible');
  assert(detailRes.body.term === 2, 'term context visible');
  assert(!!detailRes.body.createdAt, 'created date/time visible');

  // ── Step 4: "another teacher cannot see it" — against the REAL query ─
  console.log('\n── Step 4: cross-teacher isolation (real SQL, not a mock) ──');
  const rawServiceResult = getSavedResource(saved.id, TEACHER_B_HASH);
  assert(rawServiceResult === null, 'getSavedResource() itself — the real WHERE id=? AND phone_hash=? query — returns null for a different teacher\'s id');

  const intruderDetailRes = mockRes();
  detailHandler(mockReq(TEACHER_B_HASH, { id: String(saved.id) }), intruderDetailRes);
  assert(intruderDetailRes.statusCode === 404, 'Teacher B requesting Teacher A\'s lesson plan by id gets 404, not the data');
  assert(intruderDetailRes.body.homework === undefined, 'Teacher B\'s response contains no homework field at all');

  const intruderListRes = mockRes();
  const listHandlerB = createGetResourcesHandler({ getSavedResources });
  listHandlerB(mockReq(TEACHER_B_HASH), intruderListRes);
  assert(
    !intruderListRes.body.resources.some(r => r.id === saved.id),
    'Teacher B\'s resource list does not include Teacher A\'s lesson plan'
  );

  // ── Step 5: direct-access bypass attempt — a forged/wrong id can never
  // substitute for real ownership, since the identity source is
  // req.teacher.phoneHash (server-resolved from the JWT elsewhere in
  // utils/teacherAuth.js), not anything in params/query/body. Simulate
  // an attacker who knows the real resourceId but has only their own
  // (genuinely authenticated) session.
  console.log('\n── Step 5: direct API access cannot bypass ownership ──');
  const bypassAttempt = mockRes();
  detailHandler({ teacher: { id: 2, phoneHash: TEACHER_B_HASH }, params: { id: String(saved.id) } }, bypassAttempt);
  assert(bypassAttempt.statusCode === 404, 'a genuinely authenticated but non-owning session cannot retrieve another teacher\'s resource by id');

  console.log(`\n📊 Total:  ${passed + failed}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function mockReq(phoneHash, params = {}) {
  return { teacher: { id: 1, phoneHash }, query: {}, params };
}

run();
