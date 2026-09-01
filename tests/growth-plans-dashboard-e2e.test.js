'use strict';
/**
 * Growth Plans dashboard integration — end-to-end test against the REAL
 * database and the REAL services/growthPlanService.js functions (no
 * mocks), covering the completion requirement:
 *
 *   Teacher creates a growth plan via WhatsApp (NEW GOAL)
 *   -> growth plan persisted in qms_growth_plans
 *   -> authenticated teacher opens the dashboard
 *   -> same growth plan appears in the list and detail views
 *   -> teacher edits it from the dashboard
 *   -> the SAME row is updated, not a second copy
 *   -> teacher marks it complete from the dashboard
 *   -> teacher deletes it from the dashboard (soft delete)
 *   -> another teacher can never see, edit, or delete it
 *
 * This intentionally does NOT mock growthPlanService's functions —
 * tests/api-growth-plans.test.js already covers the route layer with
 * mocks. This file exists specifically to prove the ownership scoping
 * actually holds in the real SQL (`WHERE id = ? AND phone_hash = ?`),
 * which a mocked test can't verify, and that WhatsApp's createGrowthPlan
 * call (flows/growthPlanFlow.js) and the dashboard's routes read/write
 * the exact same qms_growth_plans row — no second, dashboard-only
 * storage model.
 *
 * Uses the real migration chain (tests/helpers/createTestDb.js), same
 * convention as tests/resources-dashboard-e2e.test.js.
 *
 * Run individually: node tests/growth-plans-dashboard-e2e.test.js
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
    createGrowthPlan,
    getGrowthPlan,
    listGrowthPlans,
    updateGrowthPlan,
    deleteGrowthPlan,
  } = require('../services/growthPlanService');
  const {
    createGetGrowthPlansHandler,
    createGetGrowthPlanDetailHandler,
    createPostGrowthPlanHandler,
    createPatchGrowthPlanHandler,
    createDeleteGrowthPlanHandler,
  } = require('../routes/api').__testExports;

  const TEACHER_A_HASH = 'testhash_growthplans_teacherA';
  const TEACHER_B_HASH = 'testhash_growthplans_teacherB';

  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject) VALUES (?, 'Teacher A', 7, 'Mathematics')`).run(TEACHER_A_HASH);
  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject) VALUES (?, 'Teacher B', 7, 'Mathematics')`).run(TEACHER_B_HASH);

  // ── Step 1: "Teacher creates a growth plan via WhatsApp (NEW GOAL)" ──
  // This is exactly what flows/growthPlanFlow.js calls after the
  // conversational NEW GOAL flow completes — same function, same
  // metadata shape (term/topicId/status). Nothing about this call is
  // dashboard-specific.
  console.log('\n── Step 1: WhatsApp-side persistence (flows/growthPlanFlow.js\'s createGrowthPlan call) ──');
  const created = createGrowthPlan(TEACHER_A_HASH, {
    goalText: 'Give more specific written feedback on fractions homework.',
    term: 2,
    topicId: 'TOPIC_ASSESSMENT',
  });
  assert(created && created.id > 0, 'growth plan persisted via the same createGrowthPlan() WhatsApp uses');
  assert(created.status === 'active', 'new growth plan defaults to active status');

  // ── Step 2: "authenticated teacher opens the dashboard" ──────────────
  console.log('\n── Step 2: dashboard list retrieval (GET /api/growth-plans) ──');
  const listHandler = createGetGrowthPlansHandler({ listGrowthPlans });
  const listRes = mockRes();
  listHandler(mockReq(TEACHER_A_HASH), listRes);
  assert(listRes.statusCode === 200, 'list route returns 200');
  assert(listRes.body.growthPlans.some(g => g.id === created.id), 'the WhatsApp-created growth plan appears in Teacher A\'s dashboard list');

  console.log('\n── Step 3: dashboard detail retrieval (GET /api/growth-plans/:id) ──');
  const detailHandler = createGetGrowthPlanDetailHandler({ getGrowthPlan });
  const detailRes = mockRes();
  detailHandler(mockReq(TEACHER_A_HASH, { id: String(created.id) }), detailRes);
  assert(detailRes.statusCode === 200, 'detail route returns 200');
  assert(detailRes.body.growthPlan.goalText === 'Give more specific written feedback on fractions homework.', 'dashboard displays the exact same persisted goal text WhatsApp created');
  assert(detailRes.body.growthPlan.topicId === 'TOPIC_ASSESSMENT', 'topic visible');
  assert(detailRes.body.growthPlan.term === 2, 'term context visible');
  assert(!!detailRes.body.growthPlan.createdAt, 'created date/time visible');

  // ── Step 4: "teacher edits it from the dashboard" — same row updated ─
  console.log('\n── Step 4: dashboard edit (PATCH /api/growth-plans/:id) updates the SAME row ──');
  const patchHandler = createPatchGrowthPlanHandler({ updateGrowthPlan });
  const editRes = mockRes();
  patchHandler(mockReq(TEACHER_A_HASH, { id: String(created.id) }, { goalText: 'Give more specific written feedback on fractions AND decimals homework.' }), editRes);
  assert(editRes.statusCode === 200, 'edit route returns 200');
  assert(editRes.body.growthPlan.id === created.id, 'the edit updated the same row (same id), not a new one');

  const countAfterEdit = db.prepare(`SELECT COUNT(*) AS c FROM qms_growth_plans WHERE phone_hash = ?`).get(TEACHER_A_HASH).c;
  assert(countAfterEdit === 1, 'exactly one row exists for Teacher A after the edit — no duplicate created');

  const rawAfterEdit = getGrowthPlan(TEACHER_A_HASH, created.id);
  assert(rawAfterEdit.goalText === 'Give more specific written feedback on fractions AND decimals homework.', 'the real DB row itself reflects the dashboard edit, not just the response');

  // ── Step 5: "teacher marks it complete from the dashboard" ───────────
  console.log('\n── Step 5: dashboard status update (PATCH status=completed) ──');
  const completeRes = mockRes();
  patchHandler(mockReq(TEACHER_A_HASH, { id: String(created.id) }, { status: 'completed' }), completeRes);
  assert(completeRes.statusCode === 200, 'status-update route returns 200');
  assert(completeRes.body.growthPlan.status === 'completed', 'dashboard-driven completion is reflected in the response');
  assert(getGrowthPlan(TEACHER_A_HASH, created.id).status === 'completed', 'the real DB row itself is marked completed');

  // ── Step 6: "another teacher cannot see, edit, or delete it" — real SQL
  console.log('\n── Step 6: cross-teacher isolation (real SQL, not a mock) ──');
  assert(getGrowthPlan(TEACHER_B_HASH, created.id) === null, 'getGrowthPlan() itself — the real WHERE id=? AND phone_hash=? query — returns null for a different teacher\'s id');

  const intruderDetailRes = mockRes();
  detailHandler(mockReq(TEACHER_B_HASH, { id: String(created.id) }), intruderDetailRes);
  assert(intruderDetailRes.statusCode === 404, 'Teacher B requesting Teacher A\'s growth plan by id gets 404, not the data');

  const intruderListRes = mockRes();
  listHandler(mockReq(TEACHER_B_HASH), intruderListRes);
  assert(!intruderListRes.body.growthPlans.some(g => g.id === created.id), 'Teacher B\'s growth plan list does not include Teacher A\'s goal');

  const intruderPatchRes = mockRes();
  patchHandler(mockReq(TEACHER_B_HASH, { id: String(created.id) }, { goalText: 'Overwritten by an intruder.' }), intruderPatchRes);
  assert(intruderPatchRes.statusCode === 404, 'Teacher B cannot edit Teacher A\'s growth plan (404, not a silent no-op success)');
  assert(getGrowthPlan(TEACHER_A_HASH, created.id).goalText !== 'Overwritten by an intruder.', 'the real DB row was genuinely untouched by the intruder\'s edit attempt');

  const deleteHandler = createDeleteGrowthPlanHandler({ deleteGrowthPlan });
  const intruderDeleteRes = mockRes();
  deleteHandler(mockReq(TEACHER_B_HASH, { id: String(created.id) }), intruderDeleteRes);
  assert(intruderDeleteRes.statusCode === 404, 'Teacher B cannot delete Teacher A\'s growth plan');
  assert(getGrowthPlan(TEACHER_A_HASH, created.id) !== null, 'the real DB row still exists after the intruder\'s delete attempt');

  // ── Step 7: "teacher deletes it from the dashboard" — soft delete ────
  console.log('\n── Step 7: dashboard delete (DELETE /api/growth-plans/:id), by its real owner ──');
  const ownerDeleteRes = mockRes();
  deleteHandler(mockReq(TEACHER_A_HASH, { id: String(created.id) }), ownerDeleteRes);
  assert(ownerDeleteRes.statusCode === 204, 'owner delete returns 204');
  assert(getGrowthPlan(TEACHER_A_HASH, created.id) === null, 'the growth plan no longer resolves via getGrowthPlan() (soft-deleted, deleted_at set)');

  const rawRowAfterDelete = db.prepare(`SELECT * FROM qms_growth_plans WHERE id = ?`).get(created.id);
  assert(rawRowAfterDelete !== undefined, 'the row still physically exists in the table (soft delete, per ADR-011 §7 — never a hard DELETE)');
  assert(rawRowAfterDelete.deleted_at !== null, 'deleted_at is set on the real row');

  const listAfterDeleteRes = mockRes();
  listHandler(mockReq(TEACHER_A_HASH), listAfterDeleteRes);
  assert(!listAfterDeleteRes.body.growthPlans.some(g => g.id === created.id), 'the deleted growth plan no longer appears in Teacher A\'s own dashboard list');

  // ── Step 8: "no second, dashboard-only growth plan storage model" ────
  // A growth plan created directly from the dashboard (POST) lands in the
  // exact same table WhatsApp's NEW GOAL writes to, and is immediately
  // visible to a subsequent WhatsApp-side read (listGrowthPlans, the same
  // function flows/growthPlanFlow.js could call).
  console.log('\n── Step 8: dashboard-created growth plan is visible to the WhatsApp-side read path too ──');
  const postHandler = createPostGrowthPlanHandler({ createGrowthPlan });
  const dashboardCreateRes = mockRes();
  postHandler(mockReq(TEACHER_A_HASH, {}, { goalText: 'Dashboard-authored goal: build a Term 3 fractions unit.', topicId: 'TOPIC_CURRICULUM_COVERAGE' }), dashboardCreateRes);
  assert(dashboardCreateRes.statusCode === 201, 'dashboard create route returns 201');

  const dashboardCreatedId = dashboardCreateRes.body.growthPlan.id;
  const whatsAppSideList = listGrowthPlans(TEACHER_A_HASH);
  assert(
    whatsAppSideList.some(g => g.id === dashboardCreatedId && g.goalText === 'Dashboard-authored goal: build a Term 3 fractions unit.'),
    'a growth plan created via the dashboard POST route is immediately visible via the same listGrowthPlans() WhatsApp would read from'
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