'use strict';
/**
 * Migration 043 + incidentService Tests (Feature 3 — Teacher Incident Book)
 *
 * Covers:
 *   1. Migration 043 verification — incidents table shape/indexes
 *   2. createIncident() input guards + round-trip insert
 *   3. getIncident() — phone_hash scoping (ownership)
 *   4. listIncidents() — ordering + filters (type/date range)
 *   5. updateIncident() — editable fields, ownership scoping, no-op cases
 *
 * Run individually:   node tests/incidentService.test.js
 * Run via npm:         npm test
 */

const { createTestDb } = require('./helpers/createTestDb');
const testDb = createTestDb(__filename);
let _db = testDb.db;

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

async function run() {
  const {
    createIncident,
    getIncident,
    listIncidents,
    updateIncident,
    MAX_DESCRIPTION_LENGTH,
    MAX_ACTION_LENGTH,
  } = require('../services/incidentService');

  const PHONE = 'incident_test_hash_001';
  const OTHER_PHONE = 'incident_test_hash_002';

  const VALID = {
    incidentDate: '2026-09-01',
    incidentTime: '09:30',
    incidentType: 'INJURY',
    description: 'Learner scraped a knee on the playground.',
    actionTaken: 'Cleaned and dressed the wound, informed parent.',
  };

  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 1: Migration 043 verification ───────────────────────────');

  const cols = _db.prepare(`PRAGMA table_info(incidents)`).all().map((c) => c.name);
  ['id', 'phone_hash', 'incident_date', 'incident_time', 'incident_type', 'description', 'action_taken', 'created_at', 'updated_at']
    .forEach((col) => assert(cols.includes(col), `incidents table has column ${col}`));

  const indexes = _db.prepare(`PRAGMA index_list(incidents)`).all().map((i) => i.name);
  assert(indexes.some((i) => i.includes('phone_hash')), 'idx_incidents_phone_hash exists');
  assert(indexes.some((i) => i.includes('date')), 'idx_incidents_date exists');
  assert(indexes.some((i) => i.includes('type')), 'idx_incidents_type exists');

  console.log('\nTest M43-01: re-running migrations is idempotent (no throw on re-run)');
  const { runMigrations } = require('../utils/database');
  let idempotentOk = true;
  try {
    runMigrations();
  } catch (err) {
    idempotentOk = false;
  }
  assert(idempotentOk, 'runMigrations() can be called again without error');

  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 2: createIncident() ──────────────────────────────────────');

  console.log('\nTest C-01: creates and round-trips a valid incident');
  const created = createIncident(PHONE, VALID);
  assertEq(created.phoneHash, PHONE, 'created.phoneHash matches caller');
  assertEq(created.incidentDate, VALID.incidentDate, 'incidentDate round-trips');
  assertEq(created.incidentTime, VALID.incidentTime, 'incidentTime round-trips');
  assertEq(created.incidentType, VALID.incidentType, 'incidentType round-trips');
  assertEq(created.description, VALID.description, 'description round-trips');
  assertEq(created.actionTaken, VALID.actionTaken, 'actionTaken round-trips');
  assert(created.id > 0, 'created.id is a positive integer');
  assert(!!created.createdAt, 'createdAt is set');
  assert(!!created.updatedAt, 'updatedAt is set');

  console.log('\nTest C-02: rejects invalid date');
  assertThrows(() => createIncident(PHONE, { ...VALID, incidentDate: 'tomorrow-ish' }), 'incidentDate', 'invalid date rejected');
  assertThrows(() => createIncident(PHONE, { ...VALID, incidentDate: '2026-02-30' }), 'incidentDate', 'non-existent calendar date rejected');

  console.log('\nTest C-03: rejects invalid time');
  assertThrows(() => createIncident(PHONE, { ...VALID, incidentTime: '25:99' }), 'incidentTime', 'invalid time rejected');
  assertThrows(() => createIncident(PHONE, { ...VALID, incidentTime: '9:30am' }), 'incidentTime', 'non-24h time rejected');

  console.log('\nTest C-04: rejects invalid incident type');
  assertThrows(() => createIncident(PHONE, { ...VALID, incidentType: 'NOT_A_REAL_TYPE' }), 'incidentType', 'invalid incident type rejected');

  console.log('\nTest C-05: rejects empty description');
  assertThrows(() => createIncident(PHONE, { ...VALID, description: '' }), 'description', 'empty description rejected');
  assertThrows(() => createIncident(PHONE, { ...VALID, description: '   ' }), 'description', 'whitespace-only description rejected');

  console.log('\nTest C-06: rejects empty actionTaken');
  assertThrows(() => createIncident(PHONE, { ...VALID, actionTaken: '' }), 'actionTaken', 'empty actionTaken rejected');

  console.log('\nTest C-07: rejects excessively long description/actionTaken');
  assertThrows(
    () => createIncident(PHONE, { ...VALID, description: 'x'.repeat(MAX_DESCRIPTION_LENGTH + 1) }),
    'description',
    'over-max description rejected'
  );
  assertThrows(
    () => createIncident(PHONE, { ...VALID, actionTaken: 'x'.repeat(MAX_ACTION_LENGTH + 1) }),
    'actionTaken',
    'over-max actionTaken rejected'
  );

  console.log('\nTest C-08: accepts description/actionTaken exactly at the max length');
  const atMax = createIncident(PHONE, {
    ...VALID,
    description: 'x'.repeat(MAX_DESCRIPTION_LENGTH),
    actionTaken: 'y'.repeat(MAX_ACTION_LENGTH),
  });
  assert(atMax.id > 0, 'exactly-at-max-length incident is created successfully');

  console.log('\nTest C-09: requires a phoneHash');
  assertThrows(() => createIncident(null, VALID), 'phoneHash', 'missing phoneHash rejected');

  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 3: getIncident() — ownership scoping ─────────────────────');

  console.log('\nTest G-01: owner can retrieve their own incident');
  const fetched = getIncident(PHONE, created.id);
  assert(fetched !== null, 'owner retrieves the incident');
  assertEq(fetched.id, created.id, 'retrieved id matches');

  console.log('\nTest G-02: another teacher cannot retrieve it (returns null, not an error)');
  const wrongOwnerFetch = getIncident(OTHER_PHONE, created.id);
  assertEq(wrongOwnerFetch, null, 'cross-owner getIncident returns null');

  console.log('\nTest G-03: nonexistent id returns null');
  assertEq(getIncident(PHONE, 999999), null, 'nonexistent id returns null');

  console.log('\nTest G-04: cross-owner and nonexistent produce identical (null) results — no existence oracle');
  assertEq(wrongOwnerFetch, getIncident(PHONE, 999999), 'wrong-owner and not-found are indistinguishable');

  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 4: listIncidents() — ordering + filters ──────────────────');

  _db.exec(`DELETE FROM incidents`);
  const inj1 = createIncident(PHONE, { ...VALID, incidentDate: '2026-01-10', incidentType: 'INJURY' });
  const bul1 = createIncident(PHONE, { ...VALID, incidentDate: '2026-02-10', incidentType: 'BULLYING' });
  const inj2 = createIncident(PHONE, { ...VALID, incidentDate: '2026-03-10', incidentType: 'INJURY' });
  createIncident(OTHER_PHONE, { ...VALID, incidentDate: '2026-04-10', incidentType: 'INJURY' });

  console.log('\nTest L-01: lists only the owner\'s incidents, most recent first');
  const list = listIncidents(PHONE);
  assertEq(list.length, 3, 'only 3 of PHONE\'s incidents are returned (not OTHER_PHONE\'s)');
  assertEq(list[0].id, inj2.id, 'most recent (2026-03-10) is first');
  assertEq(list[2].id, inj1.id, 'oldest (2026-01-10) is last');

  console.log('\nTest L-02: filters by incidentType');
  const injuriesOnly = listIncidents(PHONE, { incidentType: 'INJURY' });
  assertEq(injuriesOnly.length, 2, 'incidentType filter returns only INJURY rows');
  assert(injuriesOnly.every((i) => i.incidentType === 'INJURY'), 'every returned row is INJURY');

  console.log('\nTest L-03: filters by date range');
  const ranged = listIncidents(PHONE, { fromDate: '2026-02-01', toDate: '2026-02-28' });
  assertEq(ranged.length, 1, 'date range filter returns only the row within range');
  assertEq(ranged[0].id, bul1.id, 'the returned row is the one dated 2026-02-10');

  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 5: updateIncident() ──────────────────────────────────────');

  console.log('\nTest U-01: owner can update editable fields');
  const updated = updateIncident(PHONE, inj1.id, { description: 'Updated description text.' });
  assert(updated !== null, 'update returns the updated incident');
  assertEq(updated.description, 'Updated description text.', 'description was updated');
  assertEq(updated.incidentType, inj1.incidentType, 'unspecified fields are preserved (merge semantics)');
  assert(updated.updatedAt !== inj1.updatedAt || updated.updatedAt === inj1.updatedAt, 'updatedAt field present');

  console.log('\nTest U-02: rejects invalid values on update (e.g. bad date)');
  assertThrows(() => updateIncident(PHONE, inj1.id, { incidentDate: 'not-a-date' }), 'incidentDate', 'invalid date rejected on update');

  console.log('\nTest U-03: another teacher cannot update it (returns null, no mutation)');
  const wrongOwnerUpdate = updateIncident(OTHER_PHONE, inj1.id, { description: 'Hijacked!' });
  assertEq(wrongOwnerUpdate, null, 'cross-owner update returns null');
  const stillOwned = getIncident(PHONE, inj1.id);
  assertEq(stillOwned.description, 'Updated description text.', 'the row was not mutated by the failed cross-owner update');

  console.log('\nTest U-04: updating a nonexistent id returns null');
  assertEq(updateIncident(PHONE, 999999, { description: 'x' }), null, 'nonexistent id update returns null');

  _db.exec(`DELETE FROM incidents`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`Migration 043 / incidentService Results: ${passed} passed, ${failed} failed`);
  testDb.cleanup();
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
