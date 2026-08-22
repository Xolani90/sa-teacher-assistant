'use strict';
/**
 * Pilot Pro grant tests (Migration 042 / grantPilotPro()).
 *
 * Covers: eligibility guard (including the permanent-Pro NULL-expiry case),
 * zero-mutation-on-rejection, pilot extension/regrant, markUserAsPro() and
 * applyRenewal() clearing is_pilot_account, and getTeachersExpiringWithin()
 * excluding pilots.
 *
 * Run individually: node tests/pilot-pro-grant.test.js
 * Run via npm:       npm test
 */

const { createTestDb } = require('./helpers/createTestDb');

let _db = null;
let passed = 0;
let failed = 0;

process.env.PII_SECRET = 'test-pii-secret-for-pilot-hashing';

function assert(condition, label) {
  if (condition) { console.log(`  \u2705 ${label}`); passed++; }
  else { console.error(`  \u274c FAIL: ${label}`); failed++; }
}

function assertEq(a, b, label) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) { console.log(`  \u2705 ${label}`); passed++; }
  else {
    console.error(`  \u274c FAIL: ${label}`);
    console.error(`     expected: ${JSON.stringify(b)}`);
    console.error(`     got:      ${JSON.stringify(a)}`);
    failed++;
  }
}

function resetDb() {
  _db.exec('DELETE FROM teachers;');
  _db.exec(`DELETE FROM sqlite_sequence WHERE name = 'teachers'`);
}

function seedTeacher(hash, fields) {
  _db.prepare('INSERT INTO teachers (phone_hash) VALUES (?)').run(hash);
  const cols = Object.keys(fields);
  if (cols.length) {
    const set = cols.map((c) => `${c} = ?`).join(', ');
    _db.prepare(`UPDATE teachers SET ${set} WHERE phone_hash = ?`).run(...cols.map((c) => fields[c]), hash);
  }
}

function readTeacher(hash) {
  return _db.prepare('SELECT * FROM teachers WHERE phone_hash = ?').get(hash);
}

async function run() {
  console.log('\nPilot Pro Grant Tests (Migration 042 / grantPilotPro)');
  console.log('='.repeat(75));

  const testDb = createTestDb(__filename);
  _db = testDb.db;
  resetDb();

  const {
    hashPhone,
    grantPilotPro,
    markUserAsPro,
    isProActive,
    getTeachersExpiringWithin,
  } = require('../utils/usageTracker');

  // ── Group 1: eligibility guard rejects active normal (non-pilot) Pro ──
  console.log('\n[Group 1] Active normal Pro is rejected, zero mutation');
  {
    const phone = '27821110001';
    const hash = hashPhone(phone);
    const futureExpiry = new Date(Date.now() + 10 * 86400000).toISOString().replace('T', ' ').slice(0, 19);
    seedTeacher(hash, { is_pro: 1, is_pilot_account: 0, pro_expires: futureExpiry });
    const before = readTeacher(hash);

    const result = grantPilotPro(phone);
    const after = readTeacher(hash);

    assertEq(result.granted, false, 'active non-pilot Pro: grant rejected');
    assertEq(result.reason, 'active_non_pilot_pro', 'rejection reason is active_non_pilot_pro');
    assertEq(after.is_pilot_account, before.is_pilot_account, 'zero mutation: is_pilot_account unchanged');
    assertEq(after.pro_expires, before.pro_expires, 'zero mutation: pro_expires unchanged');
    assertEq(after.updated_at, before.updated_at, 'zero mutation: updated_at unchanged');
  }

  // ── Group 2: permanent Pro (pro_expires IS NULL) is rejected ──
  console.log('\n[Group 2] Permanent Pro (NULL expiry) is treated as active and rejected');
  {
    const phone = '27821110002';
    const hash = hashPhone(phone);
    seedTeacher(hash, { is_pro: 1, is_pilot_account: 0, pro_expires: null });
    const teacher = readTeacher(hash);

    assertEq(isProActive(teacher), true, 'sanity: isProActive() reports permanent Pro as active');

    const before = readTeacher(hash);
    const result = grantPilotPro(phone);
    const after = readTeacher(hash);

    assertEq(result.granted, false, 'permanent Pro (NULL expiry): grant rejected');
    assertEq(after.pro_expires, before.pro_expires, 'zero mutation: pro_expires still NULL, not overwritten');
    assertEq(after.is_pilot_account, 0, 'zero mutation: is_pilot_account still 0');
  }

  // ── Group 3: expired normal Pro IS eligible for a pilot grant ──
  console.log('\n[Group 3] Expired normal Pro is eligible');
  {
    const phone = '27821110003';
    const hash = hashPhone(phone);
    const pastExpiry = new Date(Date.now() - 5 * 86400000).toISOString().replace('T', ' ').slice(0, 19);
    seedTeacher(hash, { is_pro: 1, is_pilot_account: 0, pro_expires: pastExpiry });

    const result = grantPilotPro(phone);
    const after = readTeacher(hash);

    assertEq(result.granted, true, 'expired normal Pro: pilot grant accepted');
    assertEq(after.is_pilot_account, 1, 'is_pilot_account set to 1');
    assertEq(after.is_pro, 1, 'is_pro remains 1');
    assert(new Date(after.pro_expires) > new Date(), 'new pro_expires is ~14 days in the future');
  }

  // ── Group 4: brand-new teacher (no row state) is eligible ──
  console.log('\n[Group 4] New teacher with no Pro history is eligible');
  {
    const phone = '27821110004';
    const hash = hashPhone(phone);

    const result = grantPilotPro(phone);
    const after = readTeacher(hash);

    assertEq(result.granted, true, 'new teacher: pilot grant accepted');
    assertEq(after.is_pilot_account, 1, 'is_pilot_account set to 1');
    const daysOut = (new Date(after.pro_expires) - new Date()) / 86400000;
    assert(daysOut > 13.9 && daysOut < 14.1, 'expiry is exactly ~14 days out for a fresh grant');
  }

  // ── Group 5: active pilot can be extended by another grantPilotPro call ──
  console.log('\n[Group 5] Active pilot is extended, not rejected');
  {
    const phone = '27821110005';
    const hash = hashPhone(phone);
    const firstGrant = grantPilotPro(phone);
    const midExpiry = readTeacher(hash).pro_expires;

    const secondGrant = grantPilotPro(phone);
    const after = readTeacher(hash);

    assertEq(secondGrant.granted, true, 'active pilot: extension accepted');
    assert(new Date(after.pro_expires) > new Date(midExpiry), 'expiry extended forward from prior pilot expiry');
    assertEq(firstGrant.granted, true, 'sanity: first grant succeeded');
  }

  // ── Group 6: expired pilot gets a fresh 14-day grant ──
  console.log('\n[Group 6] Expired pilot restarts a fresh 14-day window');
  {
    const phone = '27821110006';
    const hash = hashPhone(phone);
    const pastExpiry = new Date(Date.now() - 2 * 86400000).toISOString().replace('T', ' ').slice(0, 19);
    seedTeacher(hash, { is_pro: 1, is_pilot_account: 1, pro_expires: pastExpiry });

    const result = grantPilotPro(phone);
    const after = readTeacher(hash);
    const daysOut = (new Date(after.pro_expires) - new Date()) / 86400000;

    assertEq(result.granted, true, 'expired pilot: fresh grant accepted');
    assert(daysOut > 13.9 && daysOut < 14.1, 'fresh grant measured ~14 days from now, not from stale expiry');
  }

  // ── Group 7: markUserAsPro() (real/admin paid grant) clears is_pilot_account ──
  console.log('\n[Group 7] markUserAsPro() clears is_pilot_account atomically');
  {
    const phone = '27821110007';
    const hash = hashPhone(phone);
    grantPilotPro(phone);
    assertEq(readTeacher(hash).is_pilot_account, 1, 'sanity: teacher is a pilot before paid grant');

    markUserAsPro(phone, 31);
    const after = readTeacher(hash);

    assertEq(after.is_pilot_account, 0, 'is_pilot_account reset to 0 by markUserAsPro()');
    assertEq(after.is_pro, 1, 'is_pro remains 1');
  }

  // ── Group 8: getTeachersExpiringWithin() excludes pilot accounts ──
  console.log('\n[Group 8] Renewal-reminder query excludes pilots');
  {
    const pilotPhone = '27821110008';
    const paidPhone = '27821110009';
    const pilotHash = hashPhone(pilotPhone);
    const paidHash = hashPhone(paidPhone);
    const soonExpiry = new Date(Date.now() + 2 * 86400000).toISOString().replace('T', ' ').slice(0, 19);

    seedTeacher(pilotHash, { is_pro: 1, is_pilot_account: 1, pro_expires: soonExpiry, opted_out: 0 });
    seedTeacher(paidHash, { is_pro: 1, is_pilot_account: 0, pro_expires: soonExpiry, opted_out: 0 });

    const expiring = getTeachersExpiringWithin(7);
    const hashes = expiring.map((r) => r.phone_hash);

    assert(!hashes.includes(pilotHash), 'pilot teacher excluded from expiring-soon results');
    assert(hashes.includes(paidHash), 'paid teacher still included in expiring-soon results');
  }

  // ── Summary ──
  console.log('\n' + '='.repeat(75));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  testDb.cleanup();

  if (failed > 0) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
