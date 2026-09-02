'use strict';
/**
 * Assessment Blueprint dashboard mirroring — end-to-end test against the
 * REAL database and the REAL services/blueprintRepository.js functions
 * (no mocks), covering Phase 1 of the platform-wide WhatsApp ↔ Dashboard
 * Mirroring requirement:
 *
 *   Teacher authors a blueprint via WhatsApp (blueprintAuthoringFlow.js)
 *   -> blueprint + questions persisted in assessment_blueprints /
 *      blueprint_questions (Migration 029)
 *   -> authenticated teacher opens the dashboard
 *   -> the SAME persisted blueprint + weighting appears in the list and
 *      detail views
 *   -> another teacher can never see it
 *
 * This intentionally does NOT mock blueprintRepository's functions —
 * tests/api-blueprints.test.js already covers the route layer with
 * mocks. This file exists specifically to prove the ownership check
 * (route-level phoneHash comparison, since getBlueprintById() has no
 * per-teacher variant) actually holds against a real row, and that
 * routes/webhook.js's WhatsApp-side createBlueprint() call and the
 * dashboard's GET routes read the exact same assessment_blueprints
 * table — no second, dashboard-only storage model.
 *
 * Uses the real migration chain (tests/helpers/createTestDb.js), same
 * convention as tests/growth-plans-dashboard-e2e.test.js.
 *
 * Run individually: node tests/blueprints-dashboard-e2e.test.js
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

  const { createBlueprint, getBlueprintById, listBlueprints } = require('../services/blueprintRepository');
  const {
    createGetBlueprintsHandler,
    createGetBlueprintDetailHandler,
  } = require('../routes/api').__testExports;

  const TEACHER_A_HASH = 'testhash_blueprints_teacherA';
  const TEACHER_B_HASH = 'testhash_blueprints_teacherB';

  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject) VALUES (?, 'Teacher A', 7, 'Mathematics')`).run(TEACHER_A_HASH);
  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject) VALUES (?, 'Teacher B', 7, 'Mathematics')`).run(TEACHER_B_HASH);

  // ── Step 1: "Teacher authors a blueprint via WhatsApp" ───────────────
  // This is exactly the persistence call flows/blueprintAuthoringFlow.js
  // makes once the conversational blueprint-authoring flow completes —
  // same function, same header/questions shape. Nothing about this call
  // is dashboard-specific.
  console.log('\n── Step 1: WhatsApp-side persistence (flows/blueprintAuthoringFlow.js\'s createBlueprint call) ──');
  const created = createBlueprint(
    TEACHER_A_HASH,
    { title: 'Term 2 Fractions Test', subject: 'Mathematics', grade: 7, term: 2, totalMarks: 50 },
    [
      { questionNumber: 1, topic: 'Fractions', maxMarks: 20 },
      { questionNumber: 2, topic: 'Ratio and Proportion', maxMarks: 30 },
    ]
  );
  assert(created && created.blueprintId > 0, 'blueprint persisted via the same createBlueprint() WhatsApp uses');
  assert(created.questionCount === 2, 'both questions persisted');

  // ── Step 2: "authenticated teacher opens the dashboard" ──────────────
  console.log('\n── Step 2: dashboard list retrieval (GET /api/blueprints) ──');
  const listHandler = createGetBlueprintsHandler({ listBlueprints });
  const listRes = mockRes();
  listHandler(mockReq(TEACHER_A_HASH), listRes);
  assert(listRes.statusCode === 200, 'list route returns 200');
  assert(listRes.body.blueprints.some(b => b.id === created.blueprintId), 'the WhatsApp-authored blueprint appears in Teacher A\'s dashboard list');

  const listedRow = listRes.body.blueprints.find(b => b.id === created.blueprintId);
  assert(listedRow.totalMarks === 50, 'total marks visible in the list view');
  assert(listedRow.questionCount === 2, 'question count visible in the list view');

  console.log('\n── Step 3: dashboard detail retrieval (GET /api/blueprints/:id) ──');
  const detailHandler = createGetBlueprintDetailHandler({ getBlueprintById });
  const detailRes = mockRes();
  detailHandler(mockReq(TEACHER_A_HASH, { id: String(created.blueprintId) }), detailRes);
  assert(detailRes.statusCode === 200, 'detail route returns 200');
  assert(detailRes.body.blueprint.title === 'Term 2 Fractions Test', 'dashboard displays the exact same persisted title WhatsApp created');
  assert(detailRes.body.blueprint.questions.length === 2, 'both persisted questions are visible');
  const marksSum = detailRes.body.blueprint.questions.reduce((sum, q) => sum + q.maxMarks, 0);
  assert(marksSum === detailRes.body.blueprint.totalMarks, 'the persisted question marks sum to the persisted total — the exact canonical weighting, not a recalculated value');
  assert(detailRes.body.blueprint.questions.find(q => q.topic === 'Fractions').maxMarks === 20, 'per-topic weighting matches exactly what WhatsApp persisted');

  // ── Step 4: "another teacher can never see it" — real ownership check
  console.log('\n── Step 4: cross-teacher isolation (real SQL row, route-level ownership check) ──');
  const rawBlueprint = getBlueprintById(created.blueprintId);
  assert(rawBlueprint.phoneHash === TEACHER_A_HASH, 'the real DB row itself is scoped to Teacher A (sanity check on the raw repository read)');

  const intruderDetailRes = mockRes();
  detailHandler(mockReq(TEACHER_B_HASH, { id: String(created.blueprintId) }), intruderDetailRes);
  assert(intruderDetailRes.statusCode === 404, 'Teacher B requesting Teacher A\'s blueprint by id gets 404, not the data');
  assert(intruderDetailRes.body.blueprint === undefined, 'no blueprint data is leaked to Teacher B');

  const intruderListRes = mockRes();
  listHandler(mockReq(TEACHER_B_HASH), intruderListRes);
  assert(!intruderListRes.body.blueprints.some(b => b.id === created.blueprintId), 'Teacher B\'s blueprint list does not include Teacher A\'s blueprint (listBlueprints() itself is phone_hash-scoped SQL)');

  // ── Step 5: "no second, dashboard-only blueprint storage model" ──────
  // A second blueprint authored via the same WhatsApp-side function is
  // immediately visible to the dashboard read path, and archived
  // blueprints are excluded by default from the list — same
  // "insert-only, nothing destructively lost" convention as
  // listGrowthPlans()'s deletedAt handling.
  console.log('\n── Step 5: a second WhatsApp-authored blueprint is immediately visible on the dashboard ──');
  const secondCreated = createBlueprint(
    TEACHER_A_HASH,
    { title: 'Term 3 Geometry Test', subject: 'Mathematics', grade: 7, term: 3, totalMarks: 40 },
    [{ questionNumber: 1, topic: 'Geometry', maxMarks: 40 }]
  );
  const listAfterSecondRes = mockRes();
  listHandler(mockReq(TEACHER_A_HASH), listAfterSecondRes);
  assert(
    listAfterSecondRes.body.blueprints.some(b => b.id === secondCreated.blueprintId) &&
      listAfterSecondRes.body.blueprints.some(b => b.id === created.blueprintId),
    'both WhatsApp-authored blueprints appear on the dashboard, most recently updated first'
  );
  assert(listAfterSecondRes.body.blueprints[0].id === secondCreated.blueprintId, 'the most recently created/updated blueprint sorts first');

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
