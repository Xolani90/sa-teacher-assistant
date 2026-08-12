'use strict';
/**
 * ADR-XXX §5 WhatsApp delivery-observability tests:
 *   - provider message ID capture on successful send
 *   - explicit send-failure diagnostic event (no message ID)
 *   - webhook status persistence
 *   - non-coupling: a failed send / failed delivery webhook never
 *     invalidates, expires, consumes, or otherwise affects an OTP
 *   - idempotency: duplicate webhook delivery of the same logical event
 *     is a no-op, not a duplicate row
 *   - the early-arrival race: a status webhook arriving BEFORE the
 *     send-result row is persisted must be retained and later reconciled
 *     to the correct auth_code_id, with no OTP regeneration/invalidation
 *
 * Run individually:  node tests/whatsappDeliveryObservability.test.js
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
  console.log('\nADR-XXX §5 WhatsApp Delivery Observability Tests');
  console.log('='.repeat(75));

  const testDb = createTestDb(__filename);
  _db = testDb.db;
  resetDb();

  const { handleRequestCode, handleVerifyCode } = require('../routes/auth').__testExports;
  const { hashPhone } = require('../utils/usageTracker');
  const { getActiveAuthCode } = require('../services/authCodeRepository');
  const {
    recordSendResult,
    getEventsByAuthCodeId,
    getEventsByProviderMessageId,
  } = require('../services/deliveryEventRepository');

  const whatsappService = require('../services/whatsappService');
  const originalSendMessage = whatsappService.sendMessage;

  const PHONE = '27821112222';
  const PHONE_HASH = hashPhone(PHONE);

  const webhookRouter = require('../routes/webhook');
  const { processStatusWebhooks } = webhookRouter.__testExports;

  async function postWebhook(statuses) {
    processStatusWebhooks(statuses);
  }

  try {
    // ═══════════════════════════════════════════════════════════════════
    // SECTION 1: successful send captures the provider message ID
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n── Section 1: successful send (§5) ──');
    resetDb();
    insertTeacher(PHONE_HASH, 'Teacher A');
    whatsappService.sendMessage = async () => ({ messages: [{ id: 'wamid.SUCCESS1' }] });

    console.log('\nTest D-01: a successful send records a send_accepted event with the provider message ID');
    {
      const { req, res } = makeReqRes({ phone: PHONE });
      await handleRequestCode(req, res);
      const authCode = getActiveAuthCode(PHONE_HASH);
      const events = getEventsByAuthCodeId(authCode.id);
      assertEq(events.length, 1, 'exactly one delivery event recorded for this auth_code_id');
      assertEq(events[0].eventStatus, 'send_accepted', 'event_status is send_accepted');
      assertEq(events[0].providerMessageId, 'wamid.SUCCESS1', 'provider_message_id captured from the Graph API response');
      assertEq(events[0].providerError, null, 'provider_error is null on success');
    }

    // ═══════════════════════════════════════════════════════════════════
    // SECTION 2: explicit send-failure diagnostic event
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n── Section 2: send failure — no message ID (§5) ──');
    resetDb();
    insertTeacher(PHONE_HASH, 'Teacher A');
    whatsappService.sendMessage = async () => { throw new Error('Graph API 500: simulated outage'); };

    console.log('\nTest D-02: a send failure with no message ID still produces a persisted diagnostic event');
    {
      const { req, res } = makeReqRes({ phone: PHONE });
      await handleRequestCode(req, res);
      assertEq(res.statusCode, 200, 'request-code still returns 200 despite the send failure');

      const authCode = getActiveAuthCode(PHONE_HASH);
      assert(!!authCode, 'the OTP itself still exists and is active — send failure did not roll it back');

      const events = getEventsByAuthCodeId(authCode.id);
      assertEq(events.length, 1, 'exactly one diagnostic event recorded');
      assertEq(events[0].eventStatus, 'send_failed', 'event_status is send_failed');
      assertEq(events[0].providerMessageId, null, 'provider_message_id is NULL — none was ever issued');
      assert(!!events[0].providerError, 'provider_error captures the failure reason');
    }

    console.log('\nTest D-03: OTP generated during a send failure remains fully valid');
    {
      const authCode = getActiveAuthCode(PHONE_HASH);
      assert(authCode.consumedAt === null, 'consumed_at is still null');
      assert(authCode.supersededAt === null, 'superseded_at is still null');
    }

    // ═══════════════════════════════════════════════════════════════════
    // SECTION 3: webhook persistence, normal order (send-result first)
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n── Section 3: webhook arrives AFTER send-result (normal order) ──');
    resetDb();
    insertTeacher(PHONE_HASH, 'Teacher A');
    whatsappService.sendMessage = async () => ({ messages: [{ id: 'wamid.NORMAL1' }] });

    console.log('\nTest D-04: a delivered webhook is correlated to the correct auth_code_id via provider_message_id');
    {
      const { req, res } = makeReqRes({ phone: PHONE });
      await handleRequestCode(req, res);
      const authCode = getActiveAuthCode(PHONE_HASH);

      await postWebhook([{ id: 'wamid.NORMAL1', status: 'delivered', timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: PHONE }]);

      const events = getEventsByAuthCodeId(authCode.id);
      const delivered = events.find(e => e.eventStatus === 'delivered');
      assert(!!delivered, 'a delivered event exists for this auth_code_id');
      assertEq(delivered.providerMessageId, 'wamid.NORMAL1', 'correlated via the correct provider_message_id');
    }

    // ═══════════════════════════════════════════════════════════════════
    // SECTION 4: idempotency — duplicate webhook delivery
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n── Section 4: duplicate webhook delivery is idempotent (§5) ──');

    console.log('\nTest D-05: Meta re-delivering the identical (message ID, status) event does not create a duplicate row');
    {
      const before = getEventsByProviderMessageId('wamid.NORMAL1');
      await postWebhook([{ id: 'wamid.NORMAL1', status: 'delivered', timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: PHONE }]);
      const after = getEventsByProviderMessageId('wamid.NORMAL1');
      assertEq(after.length, before.length, 'no new row was created for the duplicate delivered event');
    }

    console.log('\nTest D-06: a DIFFERENT status for the same message ID (read after delivered) IS recorded as a new logical event');
    {
      const before = getEventsByProviderMessageId('wamid.NORMAL1');
      await postWebhook([{ id: 'wamid.NORMAL1', status: 'read', timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: PHONE }]);
      const after = getEventsByProviderMessageId('wamid.NORMAL1');
      assertEq(after.length, before.length + 1, 'a new row is added for the new logical (message_id, status) pair');
      assert(after.some(e => e.eventStatus === 'read'), 'the read event is present');
    }

    // ═══════════════════════════════════════════════════════════════════
    // SECTION 5: the early-arrival race — webhook BEFORE send-result
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n── Section 5: early-arrival race (§5 acceptance criterion) ──');
    resetDb();
    insertTeacher(PHONE_HASH, 'Teacher A');

    console.log('\nTest D-07: a webhook for a not-yet-correlated message ID is retained with auth_code_id = NULL');
    {
      await postWebhook([{ id: 'wamid.EARLY1', status: 'sent', timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: PHONE }]);
      const events = getEventsByProviderMessageId('wamid.EARLY1');
      assertEq(events.length, 1, 'the early webhook event was retained, not dropped');
      assertEq(events[0].authCodeId, null, 'auth_code_id is NULL — correlation does not exist yet');
      assertEq(events[0].eventStatus, 'sent', 'event_status is sent, as delivered by the webhook');
    }

    console.log('\nTest D-08: recordSendResult() for the same message ID reconciles the earlier row (backfills auth_code_id)');
    let d08AuthCodeId;
    {
      const { req, res } = makeReqRes({ phone: PHONE });
      whatsappService.sendMessage = async () => ({ messages: [{ id: 'wamid.PLACEHOLDER_UNUSED' }] });
      await handleRequestCode(req, res);
      const authCode = getActiveAuthCode(PHONE_HASH);
      d08AuthCodeId = authCode.id;

      // Directly exercises reconciliation deterministically, simulating
      // the send path resolving to the SAME message ID the early webhook
      // already reported (the real race this proves the codebase handles).
      recordSendResult({
        authCodeId: authCode.id,
        phoneHash: PHONE_HASH,
        providerMessageId: 'wamid.EARLY1',
        eventStatus: 'send_accepted',
      });

      const events = getEventsByProviderMessageId('wamid.EARLY1');
      const sentEvent = events.find(e => e.eventStatus === 'sent');
      const sendAcceptedEvent = events.find(e => e.eventStatus === 'send_accepted');
      assert(!!sentEvent, 'the original early "sent" webhook row still exists');
      assertEq(sentEvent.authCodeId, authCode.id, 'the early "sent" row is reconciled — auth_code_id backfilled to the correct OTP');
      assert(!!sendAcceptedEvent, 'the send_accepted row from recordSendResult exists');
      assertEq(sendAcceptedEvent.authCodeId, authCode.id, 'the send_accepted row itself is correctly correlated');
      assertEq(events.length, 2, 'exactly two distinct logical events for this message id — no duplicates from reconciliation');
    }

    console.log('\nTest D-09: a LATER webhook for an already-correlated message ID is attributed immediately');
    {
      await postWebhook([{ id: 'wamid.EARLY1', status: 'delivered', timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: PHONE }]);
      const events = getEventsByProviderMessageId('wamid.EARLY1');
      const deliveredEvent = events.find(e => e.eventStatus === 'delivered');
      assert(!!deliveredEvent, 'the delivered event was recorded');
      assertEq(deliveredEvent.authCodeId, d08AuthCodeId, 'auth_code_id is set immediately on insert, correctly');
    }

    console.log('\nTest D-10: none of the above webhook activity invalidated, expired, consumed, or superseded the OTP');
    {
      const authCode = getActiveAuthCode(PHONE_HASH);
      assert(!!authCode, 'the OTP generated in D-08 is still active and retrievable');
      assert(authCode.consumedAt === null, 'still unconsumed');
      assert(authCode.supersededAt === null, 'still unsuperseded');
    }

    // ═══════════════════════════════════════════════════════════════════
    // SECTION 6: a failed delivery webhook never invalidates the OTP
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n── Section 6: non-coupling — delivery failure webhook (§5.1) ──');
    resetDb();
    insertTeacher(PHONE_HASH, 'Teacher A');
    whatsappService.sendMessage = async () => ({ messages: [{ id: 'wamid.WILLFAIL' }] });

    console.log('\nTest D-11: a "failed" status webhook is recorded but verification still succeeds');
    {
      const { req, res } = makeReqRes({ phone: PHONE });
      await handleRequestCode(req, res);
      const otp = res.body.devOtp;
      const authCode = getActiveAuthCode(PHONE_HASH);

      await postWebhook([{
        id: 'wamid.WILLFAIL', status: 'failed',
        timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: PHONE,
        errors: [{ code: 131047, title: 'Re-engagement message' }],
      }]);

      const events = getEventsByAuthCodeId(authCode.id);
      const failedEvent = events.find(e => e.eventStatus === 'failed');
      assert(!!failedEvent, 'the failed delivery event was persisted');
      assert(!!failedEvent.providerError, 'the provider error detail was captured');

      const stillActive = getActiveAuthCode(PHONE_HASH);
      assert(!!stillActive, 'the OTP is still active after the failed-delivery webhook');
      assertEq(stillActive.id, authCode.id, 'it is the same, unaltered row');

      const { req: vReq, res: vRes } = makeReqRes({ phone: PHONE, code: otp });
      await handleVerifyCode(vReq, vRes);
      assertEq(vRes.statusCode, 200, 'verification with the correct code STILL succeeds despite the failed delivery webhook');
    }
  } finally {
    whatsappService.sendMessage = originalSendMessage;
  }

  console.log(`\n${'─'.repeat(55)}`);
  console.log(`ADR-XXX §5 Delivery Observability Results: ${passed} passed, ${failed} failed`);
  console.log('─'.repeat(55));

  testDb.cleanup();
  if (failed > 0) process.exitCode = 1;
}

run().catch(err => {
  console.error('Unexpected test error:', err);
  process.exitCode = 1;
});
