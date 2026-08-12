'use strict';
/**
 * PR22B WhatsApp OTP Authentication Flow Tests (ADR-008 PR22B).
 *
 * Tests the complete WhatsApp OTP login flow:
 *   - POST /api/auth/request-code
 *   - POST /api/auth/verify-code
 *
 * Covers:
 *   1. request-code: valid teacher, unknown phone, invalid phone, sendMessage failure
 *   2. request-code: generic success response, repository interaction
 *   3. verify-code: valid OTP, invalid OTP, expired OTP, consumed OTP
 *   4. verify-code: max attempts reached, unknown phone, JWT issued correctly
 *   5. verify-code: JWT contains only sub, expiresIn = 1 hour
 *
 * Run individually:   node tests/pr22-whatsapp-otp.test.js
 * Run via npm:       npm test
 */

// ── Shared real-migrations test DB helper (see docs/TSE_SCHOOL_CALENDAR_TEST_GAP.md) ──
const { createTestDb } = require('./helpers/createTestDb');

let _db = null;

// ── Environment setup ─────────────────────────────────────────────────────────
process.env.TEACHER_JWT_SECRET = 'test-teacher-jwt-secret';
process.env.PII_SECRET = 'test-pii-secret-for-otp-hashing';

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

function resetDb() {
  // whatsapp_delivery_events.auth_code_id has a FOREIGN KEY REFERENCES
  // auth_codes(id) (Migration 041, ADR-XXX §5) — must be cleared before
  // auth_codes or the DELETE below violates the FK constraint. Also clear
  // auth_phone_state (Migration 041, §4.1) so phone-level lockout/cooldown
  // state doesn't leak between sections the way auth_codes rows used to.
  _db.exec('DELETE FROM whatsapp_delivery_events; DELETE FROM auth_phone_state; DELETE FROM auth_codes; DELETE FROM teachers;');
  // The original resetDb() created a brand-new in-memory db each time, so
  // autoincrement ids always restarted at 1. DELETE alone doesn't reset
  // sqlite's internal sequence counter, and some sections below rely on
  // insertTeacher() reproducing the same id a prior section captured
  // (e.g. VC-08 reuses validTeacherId from VC-01) — so reset the sequence
  // too, to keep that "fresh db" behavior intact.
  _db.exec(`DELETE FROM sqlite_sequence WHERE name IN ('teachers', 'auth_codes', 'whatsapp_delivery_events', 'auth_phone_state')`);
}

function insertTeacher(phoneHash, name = null) {
  const info = _db.prepare('INSERT INTO teachers (phone_hash, name) VALUES (?, ?)').run(phoneHash, name);
  return Number(info.lastInsertRowid);
}

// Minimal req/res double
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

// ── Test runner ─────────────────────────────────────────────────────────────
async function run() {
  console.log('\nPR22B WhatsApp OTP Authentication Flow Tests');
  console.log('='.repeat(75));

  const testDb = createTestDb(__filename);
  _db = testDb.db;

  resetDb();

  const {
    generateOtp,
    hashOtp,
    handleRequestCode,
    handleVerifyCode,
  } = require('../routes/auth').__testExports;

  const { getTeacherByPhone, hashPhone } = require('../utils/usageTracker');
  const { createAuthCode, getActiveAuthCode, incrementAttempts, consumeAuthCode, getPhoneAuthState, recordFailedAttempt } = require('../services/authCodeRepository');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 1: Helper functions
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 1: Helper functions ───────────────────────────────────');

  console.log('\nTest HF-01: generateOtp returns 6-digit string');
  const otp = generateOtp();
  assert(typeof otp === 'string' && otp.length === 6, 'OTP is 6-character string');
  assert(/^\d{6}$/.test(otp), 'OTP contains only digits');

  console.log('\nTest HF-02: generateOtp values are in valid range');
  const otpNum = parseInt(otp, 10);
  assert(otpNum >= 100000 && otpNum <= 999999, 'OTP is between 100000 and 999999');

  console.log('\nTest HF-03: hashOtp produces consistent hashes');
  const hash1 = hashOtp('123456');
  const hash2 = hashOtp('123456');
  assertEq(hash1, hash2, 'same OTP produces same hash');

  console.log('\nTest HF-04: hashOtp produces different hashes for different OTPs');
  const hash3 = hashOtp('123456');
  const hash4 = hashOtp('654321');
  assert(hash3 !== hash4, 'different OTPs produce different hashes');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 2: POST /api/auth/request-code
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 2: POST /api/auth/request-code ───────────────────────────');

  console.log('\nTest RC-01: valid teacher receives OTP');
  resetDb();
  const testPhone = '+27821234567';
  const testPhoneHash = hashPhone(testPhone);
  const teacherId = insertTeacher(testPhoneHash, 'Test Teacher');
  
  // Mock sendMessage to avoid actual WhatsApp calls
  const originalSendMessage = require('../services/whatsappService').sendMessage;
  let sentMessage = null;
  require('../services/whatsappService').sendMessage = async (to, text) => {
    sentMessage = { to, text };
  };

  const { req: req1, res: res1 } = makeReqRes({ phone: testPhone });
  await handleRequestCode(req1, res1);

  assertEq(res1.statusCode, 200, 'returns 200');
  assertEq(res1.body && res1.body.success, true, 'returns success: true');
  assert(sentMessage !== null, 'sendMessage was called');
  assert(sentMessage && sentMessage.to === testPhone, 'message sent to correct phone');
  assert(sentMessage && sentMessage.text.includes('verification code'), 'message contains verification code');

  // Restore original sendMessage
  require('../services/whatsappService').sendMessage = originalSendMessage;

  console.log('\nTest RC-02: unknown phone returns generic success (no enumeration)');
  resetDb();
  const unknownPhone = '+27829998888';
  const { req: req2, res: res2 } = makeReqRes({ phone: unknownPhone });
  
  // Mock sendMessage
  require('../services/whatsappService').sendMessage = async () => {};
  
  await handleRequestCode(req2, res2);

  assertEq(res2.statusCode, 200, 'returns 200 for unknown phone');
  assertEq(res2.body, { success: true }, 'returns generic success for unknown phone');

  require('../services/whatsappService').sendMessage = originalSendMessage;

  console.log('\nTest RC-03: invalid phone returns 400');
  const { req: req3, res: res3 } = makeReqRes({ phone: '' });
  await handleRequestCode(req3, res3);
  assertEq(res3.statusCode, 400, 'returns 400 for empty phone');

  console.log('\nTest RC-04: missing phone returns 400');
  const { req: req4, res: res4 } = makeReqRes({});
  await handleRequestCode(req4, res4);
  assertEq(res4.statusCode, 400, 'returns 400 for missing phone');

  console.log('\nTest RC-05: sendMessage failure does not affect response');
  resetDb();
  insertTeacher(hashPhone(testPhone), 'Test Teacher');
  
  require('../services/whatsappService').sendMessage = async () => {
    throw new Error('WhatsApp API error');
  };

  const { req: req5, res: res5 } = makeReqRes({ phone: testPhone });
  await handleRequestCode(req5, res5);

  assertEq(res5.statusCode, 200, 'still returns 200 even if sendMessage fails');
  assertEq(res5.body && res5.body.success, true, 'still returns success even if sendMessage fails');

  require('../services/whatsappService').sendMessage = originalSendMessage;

  console.log('\nTest RC-06: expired code is retired (superseded), not deleted, when a new one is requested');
  console.log('(RC1-H-003: physical deletion was removed from this hot path because');
  console.log('whatsapp_delivery_events references auth_codes by FK with no ON DELETE');
  console.log('clause — deleting a row with delivery history caused a 500. The old');
  console.log('expired row is now retired via broadened supersession instead, so it');
  console.log('remains in the table but is no longer active.)');
  resetDb();
  insertTeacher(hashPhone(testPhone), 'Test Teacher');

  // Insert an expired code
  const pastExp = _db.prepare(`SELECT datetime('now', '-5 minutes') AS ts`).get().ts;
  const oldCode = createAuthCode(hashPhone(testPhone), 'old_hash', pastExp);

  const expiredCountBefore = _db.prepare(`SELECT COUNT(*) AS c FROM auth_codes WHERE phone_hash = ?`).get(hashPhone(testPhone)).c;
  assert(expiredCountBefore === 1, 'expired code exists before request');

  require('../services/whatsappService').sendMessage = async () => {};

  const { req: req6, res: res6 } = makeReqRes({ phone: testPhone });
  await handleRequestCode(req6, res6);

  const rowCountAfter = _db.prepare(`SELECT COUNT(*) AS c FROM auth_codes WHERE phone_hash = ?`).get(hashPhone(testPhone)).c;
  assert(rowCountAfter === 2, 'both the old (retired) and new code now exist — nothing was deleted');

  const oldRowAfter = _db.prepare(`SELECT superseded_at, consumed_at FROM auth_codes WHERE id = ?`).get(oldCode.id);
  assert(oldRowAfter !== undefined, 'the old expired row still exists (was not physically deleted)');
  assert(oldRowAfter.superseded_at !== null, 'the old expired row is now superseded/retired');
  assertEq(oldRowAfter.consumed_at, null, 'the old expired row was never consumed');

  const activeAfterRequest = getActiveAuthCode(hashPhone(testPhone));
  assert(activeAfterRequest !== null, 'a new active code exists after the request');
  assert(activeAfterRequest.id !== oldCode.id, 'the active code is the newly-generated one, not the old expired one');

  require('../services/whatsappService').sendMessage = originalSendMessage;

  console.log('\nTest RC1H3-PROD-01: RC1-H-003 production contract — expired OTP with');
  console.log('delivery-event history → POST /api/auth/request-code → HTTP 200');
  console.log('{"success":true} → new OTP exists → old delivery event survives.');
  console.log('This is the externally observable regression the defect report was');
  console.log('written against: prior to the fix, this exact sequence produced a 500');
  console.log('(deleteExpiredCodes() colliding with the whatsapp_delivery_events FK).');
  resetDb();
  insertTeacher(hashPhone(testPhone), 'Test Teacher');

  const { recordSendResult } = require('../services/deliveryEventRepository');

  // Expired OTP that ALREADY has delivery-event history, exactly as
  // RC1-H-003 describes: a phone whose most recent OTP expired after a
  // successful (or attempted) WhatsApp send.
  const prodPastExp = _db.prepare(`SELECT datetime('now', '-5 minutes') AS ts`).get().ts;
  const oldProdCode = createAuthCode(hashPhone(testPhone), 'prod_old_hash', prodPastExp);
  recordSendResult({
    phoneHash: hashPhone(testPhone),
    authCodeId: oldProdCode.id,
    providerMessageId: 'wamid.rc1h003-prod-test-001',
    eventStatus: 'send_accepted',
  });

  const deliveryEventsBefore = _db
    .prepare(`SELECT id FROM whatsapp_delivery_events WHERE auth_code_id = ?`)
    .all(oldProdCode.id);
  assert(deliveryEventsBefore.length === 1, 'sanity: old OTP has exactly one delivery event before the request');

  require('../services/whatsappService').sendMessage = async () => {};

  // This is the literal externally observable contract: hit the same
  // handler routes/auth.js wires to POST /api/auth/request-code.
  const { req: reqProd, res: resProd } = makeReqRes({ phone: testPhone });
  let requestThrew = false;
  try {
    await handleRequestCode(reqProd, resProd);
  } catch (err) {
    requestThrew = true;
    console.error(`     unexpected throw (this is the pre-fix RC1-H-003 failure mode): ${err.message}`);
  }
  assertEq(requestThrew, false, 'request-code handler does not throw for a phone with an expired OTP + delivery history');
  assertEq(resProd.statusCode, 200, 'POST /api/auth/request-code returns HTTP 200 (not 500)');
  assertEq(resProd.body && resProd.body.success, true, 'response body has success:true');

  const newActive = getActiveAuthCode(hashPhone(testPhone));
  assert(newActive !== null, 'a new active OTP exists after the request');
  assert(newActive.id !== oldProdCode.id, 'the new active OTP is a different row from the old expired one');

  const deliveryEventsAfter = _db
    .prepare(`SELECT id, event_status FROM whatsapp_delivery_events WHERE auth_code_id = ?`)
    .all(oldProdCode.id);
  assertEq(deliveryEventsAfter.length, 1, 'the old OTP\'s delivery event still exists after the request (not deleted/orphaned)');
  assertEq(
    deliveryEventsAfter[0] && deliveryEventsAfter[0].event_status,
    'send_accepted',
    'the surviving delivery event is unmodified (still send_accepted)'
  );

  const oldProdRowAfter = _db.prepare(`SELECT superseded_at, consumed_at FROM auth_codes WHERE id = ?`).get(oldProdCode.id);
  assert(oldProdRowAfter !== undefined, 'the old expired auth_codes row itself still exists');
  assert(oldProdRowAfter.superseded_at !== null, 'the old expired row is retired (superseded_at populated)');
  assertEq(oldProdRowAfter.consumed_at, null, 'the old expired row was never consumed');

  require('../services/whatsappService').sendMessage = originalSendMessage;

  console.log('\nTest RC-07: OTP is stored hashed, never plaintext');
  resetDb();
  insertTeacher(hashPhone(testPhone), 'Test Teacher');
  
  require('../services/whatsappService').sendMessage = async (to, text) => {
    sentMessage = { to, text };
  };

  const { req: req7, res: res7 } = makeReqRes({ phone: testPhone });
  await handleRequestCode(req7, res7);

  const authCode = getActiveAuthCode(hashPhone(testPhone));
  assert(authCode !== null, 'auth code was created');
  assert(authCode.codeHash !== sentMessage.text, 'stored hash is not the plaintext OTP');
  assert(!authCode.codeHash.includes(sentMessage.text.slice(-6)), 'hash does not contain plaintext OTP');

  require('../services/whatsappService').sendMessage = originalSendMessage;

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 3: POST /api/auth/verify-code
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 3: POST /api/auth/verify-code ─────────────────────────────');

  console.log('\nTest VC-01: valid OTP issues JWT');
  resetDb();
  const validPhone = '+27821112222';
  const validPhoneHash = hashPhone(validPhone);
  const validTeacherId = insertTeacher(validPhoneHash, 'Valid Teacher');
  const validOtp = '123456';
  const validOtpHash = hashOtp(validOtp);
  const futureExp = _db.prepare(`SELECT datetime('now', '+5 minutes') AS ts`).get().ts;
  const validAuthCode = createAuthCode(validPhoneHash, validOtpHash, futureExp);

  const { req: req8, res: res8 } = makeReqRes({ phone: validPhone, code: validOtp });
  await handleVerifyCode(req8, res8);

  assertEq(res8.statusCode, 200, 'returns 200 for valid OTP');
  assert(res8.body.accessToken !== undefined, 'returns accessToken');
  assertEq(res8.body.tokenType, 'Bearer', 'tokenType is Bearer');
  assertEq(res8.body.expiresIn, 3600, 'expiresIn is 3600');
  assertEq(res8.body.teacher.id, validTeacherId, 'teacher.id matches');
  assertEq(res8.body.teacher.name, 'Valid Teacher', 'teacher.name matches');

  console.log('\nTest VC-02: invalid OTP returns 401');
  resetDb();
  insertTeacher(validPhoneHash, 'Valid Teacher');
  createAuthCode(validPhoneHash, validOtpHash, futureExp);

  const { req: req9, res: res9 } = makeReqRes({ phone: validPhone, code: '999999' });
  await handleVerifyCode(req9, res9);

  assertEq(res9.statusCode, 401, 'returns 401 for invalid OTP');

  console.log('\nTest VC-03: expired OTP returns 401');
  resetDb();
  insertTeacher(validPhoneHash, 'Valid Teacher');
  const pastExpVc = _db.prepare(`SELECT datetime('now', '-5 minutes') AS ts`).get().ts;
  createAuthCode(validPhoneHash, validOtpHash, pastExpVc);

  const { req: req10, res: res10 } = makeReqRes({ phone: validPhone, code: validOtp });
  await handleVerifyCode(req10, res10);

  assertEq(res10.statusCode, 401, 'returns 401 for expired OTP');

  console.log('\nTest VC-04: consumed OTP returns 401 (replay protection)');
  resetDb();
  insertTeacher(validPhoneHash, 'Valid Teacher');
  const freshAuthCode = createAuthCode(validPhoneHash, validOtpHash, futureExp);
  consumeAuthCode(freshAuthCode.id);

  const { req: req11, res: res11 } = makeReqRes({ phone: validPhone, code: validOtp });
  await handleVerifyCode(req11, res11);

  assertEq(res11.statusCode, 401, 'returns 401 for consumed OTP');

  console.log('\nTest VC-05: max attempts reached returns 401 (phone-level lockout, ADR-XXX §4.1/§4.2)');
  resetDb();
  insertTeacher(validPhoneHash, 'Valid Teacher');
  const maxAttemptsCode = createAuthCode(validPhoneHash, validOtpHash, futureExp);

  // auth_codes.attempts is no longer authoritative (§4.2) — the 5-failure
  // lockout is driven entirely by auth_phone_state via recordFailedAttempt().
  // incrementAttempts() (legacy, non-authoritative) is deliberately NOT
  // called here, to prove the lockout doesn't depend on it.
  for (let i = 0; i < 5; i++) {
    recordFailedAttempt(validPhoneHash);
  }

  const { req: req12, res: res12 } = makeReqRes({ phone: validPhone, code: validOtp });
  await handleVerifyCode(req12, res12);

  assertEq(res12.statusCode, 401, 'returns 401 when max attempts reached (locked out), even with the correct OTP');

  console.log('\nTest VC-06: unknown phone returns 401');
  resetDb();
  const { req: req13, res: res13 } = makeReqRes({ phone: '+27829999999', code: '123456' });
  await handleVerifyCode(req13, res13);

  assertEq(res13.statusCode, 401, 'returns 401 for unknown phone');

  console.log('\nTest VC-07: invalid request body returns 400');
  const { req: req14, res: res14 } = makeReqRes({ phone: validPhone });
  await handleVerifyCode(req14, res14);
  assertEq(res14.statusCode, 400, 'returns 400 for missing code');

  console.log('\nTest VC-08: JWT contains only expected claims (sub, iat, exp)');
  resetDb();
  insertTeacher(validPhoneHash, 'Valid Teacher');
  const jwtAuthCode = createAuthCode(validPhoneHash, validOtpHash, futureExp);

  const { req: req15, res: res15 } = makeReqRes({ phone: validPhone, code: validOtp });
  await handleVerifyCode(req15, res15);

  const jwt = require('jsonwebtoken');
  const decoded = jwt.decode(res15.body.accessToken);
  assert(
    Object.keys(decoded).sort().join(',') === 'exp,iat,sub',
    'JWT has exactly sub, iat, and exp claims'
  );
  assert(decoded.sub === validTeacherId, 'sub claim is teacher.id');
  assert(decoded.iat !== undefined, 'iat claim is present');

  console.log('\nTest VC-09: JWT expiresIn is 1 hour');
  resetDb();
  insertTeacher(validPhoneHash, 'Valid Teacher');
  const jwtExpiryCode = createAuthCode(validPhoneHash, validOtpHash, futureExp);

  const { req: req16, res: res16 } = makeReqRes({ phone: validPhone, code: validOtp });
  await handleVerifyCode(req16, res16);

  const decodedExpiry = jwt.decode(res16.body.accessToken);
  const now = Math.floor(Date.now() / 1000);
  const expiryTime = decodedExpiry.exp;
  const duration = expiryTime - now;
  assert(duration >= 3590 && duration <= 3610, 'JWT expires in approximately 1 hour');

  console.log('\nTest VC-10: failed verification increments the phone-level counter (ADR-XXX §4.1/§4.2)');
  resetDb();
  insertTeacher(validPhoneHash, 'Valid Teacher');
  const attemptsCode = createAuthCode(validPhoneHash, validOtpHash, futureExp);

  const { req: req17, res: res17 } = makeReqRes({ phone: validPhone, code: '999999' });
  await handleVerifyCode(req17, res17);

  // auth_codes.attempts is deliberately NOT touched by verify-code anymore
  // (§4.2) — assert it stays at its default 0 to prove non-authority, and
  // assert the real, authoritative counter (auth_phone_state) incremented.
  const unchangedCode = getActiveAuthCode(validPhoneHash);
  assertEq(unchangedCode.attempts, 0, 'auth_codes.attempts is untouched (non-authoritative, §4.2)');
  const phoneState = getPhoneAuthState(validPhoneHash);
  assertEq(phoneState.failedAttempts, 1, 'auth_phone_state.failed_attempts incremented after failed verification');

  console.log('\nTest VC-11: successful verification consumes the code');
  resetDb();
  insertTeacher(validPhoneHash, 'Valid Teacher');
  const consumeCode = createAuthCode(validPhoneHash, validOtpHash, futureExp);

  const { req: req18, res: res18 } = makeReqRes({ phone: validPhone, code: validOtp });
  await handleVerifyCode(req18, res18);

  const afterConsume = getActiveAuthCode(validPhoneHash);
  assert(afterConsume === null, 'code is consumed after successful verification');

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`PR22B WhatsApp OTP Results: ${passed} passed, ${failed} failed`);

  testDb.cleanup();

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
