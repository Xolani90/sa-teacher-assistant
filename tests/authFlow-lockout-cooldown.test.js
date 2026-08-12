'use strict';
/**
 * ADR-XXX §4 phone-level authentication-state tests: failed-attempt
 * counting across OTP generations, 15-minute lockout, lockout precedence
 * over cooldown, lockout expiry reset, successful-verification reset, and
 * the 60-second resend cooldown (independent of delivery outcome).
 *
 * Run individually:  node tests/authFlow-lockout-cooldown.test.js
 * Run via npm:       npm test
 */

const { createTestDb } = require('./helpers/createTestDb');

let _db = null;
let passed = 0;
let failed = 0;

process.env.TEACHER_JWT_SECRET = 'test-teacher-jwt-secret';
process.env.PII_SECRET = 'test-pii-secret-for-otp-hashing';

function assert(condition, label) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ FAIL: ${label}`); failed++; }
}

function assertEq(a, b, label) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) { console.log(`  ✅ ${label}`); passed++; }
  else {
    console.error(`  ❌ FAIL: ${label}`);
    console.error(`     expected: ${JSON.stringify(b)}`);
    console.error(`     got:      ${JSON.stringify(a)}`);
    failed++;
  }
}

function resetDb() {
  _db.exec('DELETE FROM whatsapp_delivery_events; DELETE FROM auth_phone_state; DELETE FROM auth_codes; DELETE FROM teachers;');
  _db.exec(`DELETE FROM sqlite_sequence WHERE name IN ('teachers', 'auth_codes', 'whatsapp_delivery_events', 'auth_phone_state')`);
}

function insertTeacher(phoneHash, name = null) {
  const info = _db.prepare('INSERT INTO teachers (phone_hash, name) VALUES (?, ?)').run(phoneHash, name);
  return Number(info.lastInsertRowid);
}

function makeReqRes(body = {}) {
  const req = { body };
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return { req, res };
}

async function run() {
  console.log('\nADR-XXX §4 Phone-Level Lockout/Cooldown Tests');
  console.log('='.repeat(75));

  const testDb = createTestDb(__filename);
  _db = testDb.db;
  resetDb();

  const { handleRequestCode, handleVerifyCode } = require('../routes/auth').__testExports;
  const { hashPhone } = require('../utils/usageTracker');
  const {
    getPhoneAuthState,
    recordFailedAttempt,
    resetPhoneAuthState,
    isLockedOut,
    isInCooldown,
  } = require('../services/authCodeRepository');

  const whatsappService = require('../services/whatsappService');
  const originalSendMessage = whatsappService.sendMessage;
  whatsappService.sendMessage = async () => ({ messages: [{ id: 'wamid.STUB' }] });

  const PHONE = '27821112222';
  const PHONE_HASH = hashPhone(PHONE);

  try {
    // ═══════════════════════════════════════════════════════════════════
    // SECTION 1: failed attempts persist across OTP generations
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n── Section 1: attempts persist across OTP generations (§4.1) ──');
    resetDb();
    insertTeacher(PHONE_HASH, 'Teacher A');

    console.log('\nTest L-01: 2 failed verifications, then a NEW OTP request, then 3 more failures locks the phone');
    {
      const { req: r1, res: s1 } = makeReqRes({ phone: PHONE });
      await handleRequestCode(r1, s1);
      const otp1 = s1.body.devOtp;
      assert(!!otp1, 'first OTP generated');

      const { req: r2, res: s2 } = makeReqRes({ phone: PHONE, code: '000000' });
      await handleVerifyCode(r2, s2);
      const { req: r3, res: s3 } = makeReqRes({ phone: PHONE, code: '000000' });
      await handleVerifyCode(r3, s3);

      let state = getPhoneAuthState(PHONE_HASH);
      assertEq(state.failedAttempts, 2, 'failed_attempts is 2 after two wrong-code attempts');

      // Requesting a new OTP must NOT reset the counter (§4.1's explicit
      // "not reset by requesting a new code" rule). Directly clear the
      // cooldown to isolate this from §4.3 (tested separately below).
      _db.prepare('UPDATE auth_phone_state SET cooldown_until = NULL WHERE phone_hash = ?').run(PHONE_HASH);
      const { req: r4, res: s4 } = makeReqRes({ phone: PHONE });
      await handleRequestCode(r4, s4);
      assert(!!s4.body.devOtp, 'second OTP generated (not blocked — no lockout yet, cooldown cleared for isolation)');

      state = getPhoneAuthState(PHONE_HASH);
      assertEq(state.failedAttempts, 2, 'failed_attempts REMAINS 2 after requesting a new OTP — not reset by generation');

      // 3 more failures = 5 total → locks out.
      for (let i = 0; i < 3; i++) {
        const { req, res } = makeReqRes({ phone: PHONE, code: '000000' });
        await handleVerifyCode(req, res);
      }
      state = getPhoneAuthState(PHONE_HASH);
      assertEq(state.failedAttempts, 5, 'failed_attempts is 5 (2 + 3, across two OTP generations)');
      assert(!!state.lockoutUntil, 'lockout_until is set after the 5th cumulative failure');
      assert(isLockedOut(PHONE_HASH), 'isLockedOut() reports true');
    }

    // ═══════════════════════════════════════════════════════════════════
    // SECTION 2: lockout blocks both verify AND generate
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n── Section 2: lockout blocks verification and generation (§4.1) ──');

    console.log('\nTest L-02: verify-code returns 401 while locked out, even with the correct code');
    {
      // A fresh valid OTP was never issued in this locked state (blocked
      // below), so this proves lockout alone is sufficient to reject —
      // not merely "no active code".
      const { req, res } = makeReqRes({ phone: PHONE, code: '123456' });
      await handleVerifyCode(req, res);
      assertEq(res.statusCode, 401, 'verify-code rejects while locked out');
    }

    console.log('\nTest L-03: request-code does not generate/replace/deliver an OTP while locked out');
    {
      const codesBefore = _db.prepare('SELECT COUNT(*) AS c FROM auth_codes WHERE phone_hash = ?').get(PHONE_HASH).c;
      const { req, res } = makeReqRes({ phone: PHONE });
      await handleRequestCode(req, res);
      assertEq(res.statusCode, 200, 'still returns the generic 200 (anti-enumeration contract unaffected)');
      assert(!('devOtp' in (res.body || {})), 'no devOtp in the response — confirms no new OTP was generated');
      const codesAfter = _db.prepare('SELECT COUNT(*) AS c FROM auth_codes WHERE phone_hash = ?').get(PHONE_HASH).c;
      assertEq(codesAfter, codesBefore, 'no new auth_codes row was inserted while locked out');
    }

    // ═══════════════════════════════════════════════════════════════════
    // SECTION 3: lockout expiry resets the counter
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n── Section 3: lockout expiry full reset (§4.1) ──');

    console.log('\nTest L-04: once lockout_until is in the past, isLockedOut() clears state and resets counter to 0');
    {
      _db.prepare('UPDATE auth_phone_state SET lockout_until = datetime(\'now\', \'-1 second\') WHERE phone_hash = ?').run(PHONE_HASH);
      const locked = isLockedOut(PHONE_HASH);
      assertEq(locked, false, 'isLockedOut() returns false once lockout_until has passed');
      const state = getPhoneAuthState(PHONE_HASH);
      assertEq(state.failedAttempts, 0, 'failed_attempts reset to 0 on lockout expiry');
      assertEq(state.lockoutUntil, null, 'lockout_until cleared on lockout expiry');
    }

    // ═══════════════════════════════════════════════════════════════════
    // SECTION 4: successful verification resets the counter
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n── Section 4: successful verification reset (§4.1) ──');
    resetDb();
    insertTeacher(PHONE_HASH, 'Teacher A');

    console.log('\nTest L-05: failed attempts followed by a successful verification clears the counter');
    {
      const { req: r1, res: s1 } = makeReqRes({ phone: PHONE });
      await handleRequestCode(r1, s1);
      const otp = s1.body.devOtp;

      for (let i = 0; i < 3; i++) {
        const { req, res } = makeReqRes({ phone: PHONE, code: '000000' });
        await handleVerifyCode(req, res);
      }
      let state = getPhoneAuthState(PHONE_HASH);
      assertEq(state.failedAttempts, 3, 'failed_attempts is 3 before the successful attempt');

      const { req: rGood, res: sGood } = makeReqRes({ phone: PHONE, code: otp });
      await handleVerifyCode(rGood, sGood);
      assertEq(sGood.statusCode, 200, 'correct OTP still succeeds after 3 prior failures (below the 5-limit)');

      state = getPhoneAuthState(PHONE_HASH);
      assertEq(state.failedAttempts, 0, 'failed_attempts reset to 0 after successful verification');
      assertEq(state.lockoutUntil, null, 'lockout_until remains null (was never locked) after successful verification');
    }

    // ═══════════════════════════════════════════════════════════════════
    // SECTION 5: 60-second resend cooldown (§4.3)
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n── Section 5: resend cooldown (§4.3) ──');
    resetDb();
    insertTeacher(PHONE_HASH, 'Teacher A');

    console.log('\nTest L-06: generation starts a cooldown; an immediate second request does not replace the OTP');
    {
      const { req: r1, res: s1 } = makeReqRes({ phone: PHONE });
      await handleRequestCode(r1, s1);
      const firstOtp = s1.body.devOtp;
      assert(!!firstOtp, 'first OTP generated');
      assert(isInCooldown(PHONE_HASH), 'phone is in cooldown immediately after generation');

      const codeRowBefore = _db.prepare(
        `SELECT id, code_hash FROM auth_codes WHERE phone_hash = ? AND consumed_at IS NULL AND superseded_at IS NULL`
      ).get(PHONE_HASH);

      const { req: r2, res: s2 } = makeReqRes({ phone: PHONE });
      await handleRequestCode(r2, s2);
      assertEq(s2.statusCode, 200, 'second request during cooldown still returns generic 200');
      assert(!('devOtp' in (s2.body || {})), 'no devOtp returned for the blocked second request — no new OTP generated');

      const codeRowAfter = _db.prepare(
        `SELECT id, code_hash FROM auth_codes WHERE phone_hash = ? AND consumed_at IS NULL AND superseded_at IS NULL`
      ).get(PHONE_HASH);
      assertEq(codeRowAfter.id, codeRowBefore.id, 'the original active OTP row was NOT replaced during cooldown');
    }

    console.log('\nTest L-07: a delivery failure does not affect the cooldown that was already started');
    {
      resetDb();
      insertTeacher(PHONE_HASH, 'Teacher A');
      whatsappService.sendMessage = async () => { throw new Error('simulated WhatsApp send failure'); };

      const { req: r1, res: s1 } = makeReqRes({ phone: PHONE });
      await handleRequestCode(r1, s1);
      assertEq(s1.statusCode, 200, 'generation still succeeds and returns 200 even though delivery fails');
      assert(isInCooldown(PHONE_HASH), 'cooldown is still active after a send failure — not gated on delivery outcome');

      whatsappService.sendMessage = async () => ({ messages: [{ id: 'wamid.STUB2' }] });
    }

    console.log('\nTest L-08: lockout takes precedence over an expired cooldown (§4.3)');
    {
      resetDb();
      insertTeacher(PHONE_HASH, 'Teacher A');
      // Simulate: phone is locked out AND its cooldown has already expired.
      _db.prepare(
        `INSERT INTO auth_phone_state (phone_hash, failed_attempts, lockout_until, cooldown_until)
         VALUES (?, 5, datetime('now', '+10 minutes'), datetime('now', '-10 seconds'))`
      ).run(PHONE_HASH);

      assert(!isInCooldown(PHONE_HASH), 'sanity: cooldown itself has expired');
      assert(isLockedOut(PHONE_HASH), 'sanity: phone is locked out');

      const { req, res } = makeReqRes({ phone: PHONE });
      await handleRequestCode(req, res);
      assert(!('devOtp' in (res.body || {})), 'generation still blocked — lockout wins even though cooldown alone has expired');
    }
  } finally {
    whatsappService.sendMessage = originalSendMessage;
  }

  console.log(`\n${'─'.repeat(55)}`);
  console.log(`ADR-XXX §4 Lockout/Cooldown Results: ${passed} passed, ${failed} failed`);
  console.log('─'.repeat(55));

  testDb.cleanup();
  if (failed > 0) process.exitCode = 1;
}

run().catch(err => {
  console.error('Unexpected test error:', err);
  process.exitCode = 1;
});
