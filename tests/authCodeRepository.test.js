'use strict';
/**
 * Migration 032 + authCodeRepository Tests (ADR-008 PR22A)
 *
 * Covers:
 *   1. Migration 032 verification — auth_codes table shape, defaults,
 *      indexes usable via the queries the repository issues.
 *   2. createAuthCode() input guards + round-trip insert
 *   3. getActiveAuthCode() — expiry filtering, consumed filtering,
 *      "most recent" ordering when multiple rows exist
 *   4. incrementAttempts() counter behavior
 *   5. consumeAuthCode() one-time-use / replay-protection semantics
 *   6. deleteExpiredCodes() opportunistic cleanup scope (single phone_hash,
 *      doesn't touch other phones' rows, doesn't touch active rows)
 *
 * Run individually:   node tests/authCodeRepository.test.js
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
    createAuthCode,
    getActiveAuthCode,
    incrementAttempts,
    consumeAuthCode,
    deleteExpiredCodes,
  } = require('../services/authCodeRepository');

  const PHONE = 'authcode_test_hash_001';
  const OTHER_PHONE = 'authcode_test_hash_002';

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 1: Migration 032 verification
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 1: Migration 032 verification ───────────────────────────');

  console.log('\nTest M32-01: auth_codes row defaults attempts=0, consumed_at NULL');
  const rawInsert = _db
    .prepare(`INSERT INTO auth_codes (phone_hash, code_hash, expires_at) VALUES (?, ?, datetime('now', '+5 minutes'))`)
    .run(PHONE, 'raw_hash_for_defaults_check');
  const rawRow = _db.prepare(`SELECT * FROM auth_codes WHERE id = ?`).get(rawInsert.lastInsertRowid);
  assertEq(rawRow.attempts, 0, 'attempts defaults to 0');
  assertEq(rawRow.consumed_at, null, 'consumed_at defaults to NULL');
  assert(typeof rawRow.created_at === 'string' && rawRow.created_at.length > 0, 'created_at auto-populated');
  _db.prepare(`DELETE FROM auth_codes WHERE id = ?`).run(rawInsert.lastInsertRowid);

  console.log('\nTest M32-02: phone_hash and code_hash are required (NOT NULL enforced)');
  assertThrows(
    () => _db.prepare(`INSERT INTO auth_codes (code_hash, expires_at) VALUES (?, datetime('now'))`).run('x'),
    null,
    'insert without phone_hash throws (NOT NULL constraint)'
  );

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 2: createAuthCode()
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 2: createAuthCode() ──────────────────────────────────────');

  console.log('\nTest AC-01: createAuthCode requires phoneHash');
  assertThrows(() => createAuthCode(null, 'hash', '2026-01-01 00:00:00'), 'phoneHash is required', 'throws without phoneHash');

  console.log('\nTest AC-02: createAuthCode requires codeHash');
  assertThrows(() => createAuthCode(PHONE, null, '2026-01-01 00:00:00'), 'codeHash is required', 'throws without codeHash');

  console.log('\nTest AC-03: createAuthCode requires expiresAt');
  assertThrows(() => createAuthCode(PHONE, 'hash', null), 'expiresAt is required', 'throws without expiresAt');

  console.log('\nTest AC-04: createAuthCode inserts and returns an id');
  const someExpiry = _db.prepare(`SELECT datetime('now', '+5 minutes') AS ts`).get().ts;
  const created = createAuthCode(PHONE, 'hmac_hash_abc123', someExpiry);
  assert(Number.isInteger(created.id) && created.id > 0, 'returns a positive integer id');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 3: getActiveAuthCode()
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 3: getActiveAuthCode() ───────────────────────────────────');

  console.log('\nTest GA-01: returns null when no rows exist for phone_hash');
  assertEq(getActiveAuthCode('nonexistent_phone_hash'), null, 'null for unknown phone_hash');

  console.log('\nTest GA-02: returns an active (unexpired, unconsumed) code');
  _db.exec(`DELETE FROM auth_codes`); // clean slate for this section
  const futureExp = _db.prepare(`SELECT datetime('now', '+5 minutes') AS ts`).get().ts;
  const active = createAuthCode(PHONE, 'active_code_hash', futureExp);
  const fetched = getActiveAuthCode(PHONE);
  assert(fetched !== null, 'active code found');
  assertEq(fetched.id, active.id, 'returns the correct row id');
  assertEq(fetched.codeHash, 'active_code_hash', 'codeHash round-trips correctly');
  assertEq(fetched.attempts, 0, 'attempts starts at 0');
  assertEq(fetched.consumedAt, null, 'consumedAt is null');

  console.log('\nTest GA-03: expired codes are not returned');
  const pastExp = _db.prepare(`SELECT datetime('now', '-5 minutes') AS ts`).get().ts;
  _db.exec(`DELETE FROM auth_codes`);
  createAuthCode(PHONE, 'expired_code_hash', pastExp);
  assertEq(getActiveAuthCode(PHONE), null, 'expired code excluded');

  console.log('\nTest GA-04: consumed codes are not returned');
  _db.exec(`DELETE FROM auth_codes`);
  const consumedSetup = createAuthCode(PHONE, 'consumed_code_hash', futureExp);
  consumeAuthCode(consumedSetup.id);
  assertEq(getActiveAuthCode(PHONE), null, 'consumed code excluded even though unexpired');

  console.log('\nTest GA-05: when multiple active codes exist, returns the most recent');
  _db.exec(`DELETE FROM auth_codes`);
  const older = createAuthCode(PHONE, 'older_hash', futureExp);
  const newer = createAuthCode(PHONE, 'newer_hash', futureExp);
  const mostRecent = getActiveAuthCode(PHONE);
  assertEq(mostRecent.id, newer.id, 'returns the newer row, not the older one');
  assert(older.id !== newer.id, 'sanity: two distinct rows were created');

  console.log('\nTest GA-06: does not leak another phone_hash\'s active code');
  _db.exec(`DELETE FROM auth_codes`);
  createAuthCode(OTHER_PHONE, 'other_phone_hash_code', futureExp);
  assertEq(getActiveAuthCode(PHONE), null, 'no cross-phone leakage');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 4: incrementAttempts()
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 4: incrementAttempts() ───────────────────────────────────');

  console.log('\nTest IA-01: increments from 0 to 1');
  _db.exec(`DELETE FROM auth_codes`);
  const forAttempts = createAuthCode(PHONE, 'attempts_hash', futureExp);
  const afterFirst = incrementAttempts(forAttempts.id);
  assertEq(afterFirst, 1, 'attempts is 1 after first increment');

  console.log('\nTest IA-02: increments cumulatively across calls');
  incrementAttempts(forAttempts.id);
  const afterThird = incrementAttempts(forAttempts.id);
  assertEq(afterThird, 3, 'attempts is 3 after three total increments');

  console.log('\nTest IA-03: returns -1 for a non-existent row');
  assertEq(incrementAttempts(999999), -1, 'unknown id returns -1');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 5: consumeAuthCode()
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 5: consumeAuthCode() ─────────────────────────────────────');

  console.log('\nTest CA-01: consuming an active code succeeds and sets consumed_at');
  _db.exec(`DELETE FROM auth_codes`);
  const toConsume = createAuthCode(PHONE, 'consume_me_hash', futureExp);
  const consumeResult = consumeAuthCode(toConsume.id);
  assertEq(consumeResult, true, 'consumeAuthCode returns true on success');
  const rowAfterConsume = _db.prepare(`SELECT consumed_at FROM auth_codes WHERE id = ?`).get(toConsume.id);
  assert(rowAfterConsume.consumed_at !== null, 'consumed_at is populated');

  console.log('\nTest CA-02: consuming an already-consumed code is a no-op (replay protection)');
  const secondConsume = consumeAuthCode(toConsume.id);
  assertEq(secondConsume, false, 'second consumeAuthCode call returns false');

  console.log('\nTest CA-03: consuming a non-existent id returns false');
  assertEq(consumeAuthCode(999999), false, 'unknown id returns false, does not throw');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 6: deleteExpiredCodes()
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 6: deleteExpiredCodes() ──────────────────────────────────');

  console.log('\nTest DE-01: deletes expired rows for the given phone_hash');
  _db.exec(`DELETE FROM auth_codes`);
  createAuthCode(PHONE, 'expired_1', pastExp);
  createAuthCode(PHONE, 'expired_2', pastExp);
  const deletedCount = deleteExpiredCodes(PHONE);
  assertEq(deletedCount, 2, 'deletes both expired rows');
  assertEq(getActiveAuthCode(PHONE), null, 'no active codes remain');

  console.log('\nTest DE-02: does not delete still-active rows');
  _db.exec(`DELETE FROM auth_codes`);
  const stillActive = createAuthCode(PHONE, 'still_active_hash', futureExp);
  const deletedNone = deleteExpiredCodes(PHONE);
  assertEq(deletedNone, 0, 'active row not deleted');
  assertEq(getActiveAuthCode(PHONE).id, stillActive.id, 'active row still retrievable');

  console.log('\nTest DE-03: also deletes consumed rows (even if not expired)');
  _db.exec(`DELETE FROM auth_codes`);
  const consumedButActive = createAuthCode(PHONE, 'consumed_not_expired', futureExp);
  consumeAuthCode(consumedButActive.id);
  const deletedConsumed = deleteExpiredCodes(PHONE);
  assertEq(deletedConsumed, 1, 'consumed row is swept up too');

  console.log('\nTest DE-04: scoped to one phone_hash — does not touch another phone\'s rows');
  _db.exec(`DELETE FROM auth_codes`);
  createAuthCode(PHONE, 'phone_a_expired', pastExp);
  createAuthCode(OTHER_PHONE, 'phone_b_expired', pastExp);
  const deletedScoped = deleteExpiredCodes(PHONE);
  assertEq(deletedScoped, 1, 'only deletes the target phone_hash\'s row');
  const otherRow = _db.prepare(`SELECT COUNT(*) AS c FROM auth_codes WHERE phone_hash = ?`).get(OTHER_PHONE);
  assertEq(otherRow.c, 1, 'other phone_hash\'s expired row is untouched');

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`Migration 032 / authCodeRepository Results: ${passed} passed, ${failed} failed`);

  testDb.cleanup();

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
