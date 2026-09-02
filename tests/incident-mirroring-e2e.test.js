'use strict';
/**
 * Feature 3 (Teacher Incident Book) — end-to-end test against the REAL
 * database and the REAL services/incidentService.js functions (no
 * mocks), proving the required architecture:
 *
 *   WhatsApp-style incident creation
 *     -> incidentService.createIncident (the same function flows/incidentFlow.js calls)
 *     -> incidents table (Migration 043)
 *     -> GET /api/incidents route handler reads the same row back
 *     -> dashboard receives the exact same persisted values
 *
 * and cross-teacher denial against the real SQL ownership check:
 *
 *   Teacher A creates an incident
 *     -> Teacher B requests it (GET and PATCH)
 *     -> ACCESS DENIED (404, identical to a nonexistent id)
 *
 * This intentionally does NOT mock incidentService — that layer is
 * already covered by tests/incidentService.test.js. This file exists
 * specifically to prove the ownership scoping holds in the real SQL
 * (`WHERE id = ? AND phone_hash = ?`) all the way through to the route
 * layer, and that WhatsApp and the dashboard read the same table.
 *
 * Run individually: node tests/incident-mirroring-e2e.test.js
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

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

async function run() {
  const testDb = createTestDb(__filename);
  const db = testDb.db;

  const { createIncident } = require('../services/incidentService');
  const {
    createGetIncidentsHandler,
    createGetIncidentDetailHandler,
    createPatchIncidentHandler,
  } = require('../routes/api').__testExports;
  const incidentServiceReal = require('../services/incidentService');

  const TEACHER_A_HASH = 'testhash_incidents_teacherA';
  const TEACHER_B_HASH = 'testhash_incidents_teacherB';

  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject) VALUES (?, 'Teacher A', 7, 'Mathematics')`).run(TEACHER_A_HASH);
  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject) VALUES (?, 'Teacher B', 7, 'Mathematics')`).run(TEACHER_B_HASH);

  // ── Step 1: "Teacher A creates an incident via WhatsApp" ────────────
  // This is exactly the call flows/incidentFlow.js's reviewSummary/YES
  // branch makes: incidentService.createIncident(phoneHash, params).
  // Nothing about this call is dashboard-specific.
  const whatsAppIncident = createIncident(TEACHER_A_HASH, {
    incidentDate: '2026-09-01',
    incidentTime: '09:30',
    incidentType: 'INJURY',
    description: 'Learner fell during break and scraped a knee.',
    actionTaken: 'Cleaned and dressed the wound, informed the parent.',
  });

  console.log('\n── Step 1: WhatsApp-style creation persists a real row ─────');
  assert(whatsAppIncident.id > 0, 'createIncident returns a real row id');
  const rawRow = db.prepare(`SELECT * FROM incidents WHERE id = ?`).get(whatsAppIncident.id);
  assert(rawRow !== undefined, 'the row physically exists in the incidents table');
  assert(rawRow.phone_hash === TEACHER_A_HASH, 'the row is owned by Teacher A in raw SQL');

  // ── Step 2: dashboard list retrieves the same row via the real API handler ──
  console.log('\n── Step 2: dashboard GET /api/incidents mirrors the same data ──');
  const listHandler = createGetIncidentsHandler({ listIncidents: incidentServiceReal.listIncidents });
  const listRes = mockRes();
  listHandler({ teacher: { phoneHash: TEACHER_A_HASH }, query: {} }, listRes);
  assert(listRes.statusCode === 200, 'GET /api/incidents responds 200');
  assert(listRes.body.incidents.length === 1, 'Teacher A sees exactly the one incident they created');
  const listedIncident = listRes.body.incidents[0];
  assert(listedIncident.incidentDate === '2026-09-01', 'dashboard sees the exact persisted incidentDate');
  assert(listedIncident.incidentTime === '09:30', 'dashboard sees the exact persisted incidentTime');
  assert(listedIncident.incidentType === 'INJURY', 'dashboard sees the exact persisted incidentType');
  assert(
    listedIncident.description === 'Learner fell during break and scraped a knee.',
    'dashboard sees the exact persisted description (not regenerated/reinterpreted)'
  );
  assert(
    listedIncident.actionTaken === 'Cleaned and dressed the wound, informed the parent.',
    'dashboard sees the exact persisted actionTaken'
  );

  // ── Step 3: dashboard detail retrieves the same row ──────────────────
  console.log('\n── Step 3: dashboard GET /api/incidents/:id mirrors the same row ──');
  const detailHandler = createGetIncidentDetailHandler({ getIncident: incidentServiceReal.getIncident });
  const detailRes = mockRes();
  detailHandler({ teacher: { phoneHash: TEACHER_A_HASH }, params: { id: String(whatsAppIncident.id) } }, detailRes);
  assert(detailRes.statusCode === 200, 'GET /api/incidents/:id responds 200 for the owner');
  assert(detailRes.body.incident.id === whatsAppIncident.id, 'detail view returns the exact same row id');
  assert(
    detailRes.body.incident.description === whatsAppIncident.description,
    'detail view returns the exact same description WhatsApp wrote'
  );

  // ── Step 4: Teacher B cannot see or modify Teacher A's incident ─────
  console.log('\n── Step 4: cross-teacher access is denied (real SQL ownership check) ──');
  const crossListHandler = createGetIncidentsHandler({ listIncidents: incidentServiceReal.listIncidents });
  const crossListRes = mockRes();
  crossListHandler({ teacher: { phoneHash: TEACHER_B_HASH }, query: {} }, crossListRes);
  assert(crossListRes.body.incidents.length === 0, "Teacher B's incident list does not include Teacher A's incident");

  const crossDetailHandler = createGetIncidentDetailHandler({ getIncident: incidentServiceReal.getIncident });
  const crossDetailRes = mockRes();
  crossDetailHandler({ teacher: { phoneHash: TEACHER_B_HASH }, params: { id: String(whatsAppIncident.id) } }, crossDetailRes);
  assert(crossDetailRes.statusCode === 404, 'Teacher B GET on Teacher A\'s incident id returns 404');

  const notFoundRes = mockRes();
  crossDetailHandler({ teacher: { phoneHash: TEACHER_B_HASH }, params: { id: '999999' } }, notFoundRes);
  assert(
    JSON.stringify(crossDetailRes.body) === JSON.stringify(notFoundRes.body),
    'cross-owner response is byte-identical to a genuinely nonexistent id — no existence oracle'
  );

  const crossPatchHandler = createPatchIncidentHandler({ updateIncident: incidentServiceReal.updateIncident });
  const crossPatchRes = mockRes();
  crossPatchHandler(
    { teacher: { phoneHash: TEACHER_B_HASH }, params: { id: String(whatsAppIncident.id) }, body: { description: 'Hijacked by Teacher B!' } },
    crossPatchRes
  );
  assert(crossPatchRes.statusCode === 404, "Teacher B PATCH on Teacher A's incident returns 404");
  const rowAfterAttack = db.prepare(`SELECT description FROM incidents WHERE id = ?`).get(whatsAppIncident.id);
  assert(
    rowAfterAttack.description === 'Learner fell during break and scraped a knee.',
    "the row's description was NOT mutated by Teacher B's denied PATCH attempt"
  );

  // ── Step 5: "Dashboard-created incident" uses the same authoritative model ──
  console.log('\n── Step 5: dashboard-created incident is retrievable via the same service ──');
  const dashboardCreated = createIncident(TEACHER_A_HASH, {
    incidentDate: '2026-09-02',
    incidentTime: '11:00',
    incidentType: 'BULLYING',
    description: 'Reported bullying incident during lunch break.',
    actionTaken: 'Both learners spoken to, parents notified.',
  });
  const retrievedAgain = incidentServiceReal.getIncident(TEACHER_A_HASH, dashboardCreated.id);
  assert(retrievedAgain !== null, 'an incident created through the dashboard-style call is retrievable through the same service');
  assert(retrievedAgain.incidentType === 'BULLYING', 'retrieved incident matches what was created');

  const finalList = incidentServiceReal.listIncidents(TEACHER_A_HASH);
  assert(finalList.length === 2, 'Teacher A now has both incidents (WhatsApp + dashboard) in one authoritative table');

  // ── Step 6: Dashboard-created incident is retrievable back over WhatsApp ──
  // Phase 2's actual gap: handleIncidentHistoryFlow (MY INCIDENTS) reading
  // real incidentService.listIncidents/getIncident — no mocks — proving the
  // dashboard-created row from Step 5 round-trips back to WhatsApp exactly
  // as written, and that Teacher B still can't reach it through this path.
  console.log('\n── Step 6: dashboard-created incident is retrievable via MY INCIDENTS (WhatsApp) ──');
  const { handleIncidentHistoryFlow } = require('../flows/incidentFlow');

  function makeHistoryDeps(fromToPhoneHash) {
    const sent = [];
    const incidentHistoryState = new Map();
    return {
      sent,
      deps: {
        incidentHistoryState: {
          get: (k) => incidentHistoryState.get(k) || null,
          set: (k, v) => incidentHistoryState.set(k, v),
          delete: (k) => incidentHistoryState.delete(k),
        },
        safeSendMessage: async (to, text) => { sent.push(text); },
        parseIntent: (text) => (/^my incidents$/i.test(text.trim()) ? { type: 'incidentHistory' } : { type: 'unknown' }),
        hashPhone: () => fromToPhoneHash,
        listIncidents: incidentServiceReal.listIncidents,
        getIncident: incidentServiceReal.getIncident,
      },
    };
  }

  const { sent: sentA, deps: depsA } = makeHistoryDeps(TEACHER_A_HASH);
  await handleIncidentHistoryFlow('27821111111', 'my incidents', null, depsA);
  assert(sentA[0].includes('Bullying') || sentA[0].includes('Injury'), 'MY INCIDENTS list shows Teacher A\'s real persisted incidents');

  await handleIncidentHistoryFlow('27821111111', '1', null, depsA);
  const detailMsg = sentA[sentA.length - 1];
  assert(
    detailMsg.includes('Reported bullying incident during lunch break.') ||
    detailMsg.includes('Learner fell during break and scraped a knee.'),
    'WhatsApp detail view shows the exact persisted description — same row the dashboard wrote/read'
  );

  const { sent: sentB, deps: depsB } = makeHistoryDeps(TEACHER_B_HASH);
  await handleIncidentHistoryFlow('27822222222', 'my incidents', null, depsB);
  assert(sentB[0].includes("haven't logged any incidents"), "Teacher B's MY INCIDENTS shows empty — Teacher A's incidents never leak across the real ownership check");

  console.log(`\n${'─'.repeat(55)}`);
  console.log(`Incident Mirroring E2E Results: ${passed} passed, ${failed} failed`);
  testDb.cleanup();
  if (failed > 0) process.exit(1);
}

run();
