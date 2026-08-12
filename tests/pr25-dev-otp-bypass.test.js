'use strict';
/**
 * PR25: Dev-only OTP bypass regression tests (ADR-008 follow-up).
 *
 * routes/auth.js's handleRequestCode attaches a `devOtp` field to its
 * response whenever process.env.NODE_ENV !== 'production', so local
 * development/testing isn't blocked on a working WhatsApp OTP message
 * template (e.g. while business verification / template approval is
 * pending with Meta).
 *
 * These tests guard the one property that actually matters: devOtp must
 * NEVER appear in the response when NODE_ENV is 'production', under any
 * circumstance covered here.
 *
 * Run individually: node tests/pr25-dev-otp-bypass.test.js
 * Run via npm:      npm test
 */

// ── Shared real-migrations test DB helper (see docs/TSE_SCHOOL_CALENDAR_TEST_GAP.md) ──
const { createTestDb } = require('./helpers/createTestDb');

// ── Environment setup ─────────────────────────────────────────────────────
process.env.TEACHER_JWT_SECRET = 'test-teacher-jwt-secret';
process.env.PII_SECRET = 'test-pii-secret-for-otp-hashing';

// ── Helpers ────────────────────────────────────────────────────────────────
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

function insertTeacher(db, phoneHash, name = null) {
  const info = db.prepare('INSERT INTO teachers (phone_hash, name) VALUES (?, ?)').run(phoneHash, name);
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

// Clears auth_phone_state and auth_codes for a phone_hash so each case
// below gets a fresh, un-cooled-down phone (ADR-XXX §4.3 introduced a
// 60-second resend cooldown after every successful OTP-generation
// transaction — several cases in this file deliberately call
// handleRequestCode for the SAME phone back-to-back to test the
// NODE_ENV gate in isolation, which is orthogonal to cooldown behavior).
function clearAuthState(db, phoneHash) {
  db.prepare('DELETE FROM whatsapp_delivery_events WHERE phone_hash = ?').run(phoneHash);
  db.prepare('DELETE FROM auth_phone_state WHERE phone_hash = ?').run(phoneHash);
  db.prepare('DELETE FROM auth_codes WHERE phone_hash = ?').run(phoneHash);
}

function hasDevOtp(body) {
  return !!body && Object.prototype.hasOwnProperty.call(body, 'devOtp');
}

// ── Test runner ──────────────────────────────────────────────────────────
async function run() {
  console.log('\nPR25 Dev-Only OTP Bypass Tests');
  console.log('='.repeat(75));

  const testDb = createTestDb(__filename);
  const db = testDb.db;

  const { handleRequestCode } = require('../routes/auth').__testExports;
  const { hashPhone } = require('../utils/usageTracker');

  const REGISTERED_PHONE = '27821112222';
  const UNKNOWN_PHONE = '27899999999';
  insertTeacher(db, hashPhone(REGISTERED_PHONE), 'Dev Bypass Teacher');

  // Stub sendMessage so no real WhatsApp call is attempted during this test.
  const whatsappService = require('../services/whatsappService');
  const originalSendMessage = whatsappService.sendMessage;
  const originalNodeEnv = process.env.NODE_ENV;

  try {
    whatsappService.sendMessage = async () => {};

    // --- Case 1: NODE_ENV=production must NEVER return devOtp ---
    process.env.NODE_ENV = 'production';
    {
      const { req, res } = makeReqRes({ phone: REGISTERED_PHONE });
      await handleRequestCode(req, res);
      assert(res.statusCode === 200, 'production: responds 200');
      assert(res.body && res.body.success === true, 'production: success is true');
      assert(!hasDevOtp(res.body), 'production: devOtp is NEVER present in the response body');
    }

    // --- Case 2: development (non-production) MAY return devOtp ---
    process.env.NODE_ENV = 'development';
    clearAuthState(db, hashPhone(REGISTERED_PHONE));
    {
      const { req, res } = makeReqRes({ phone: REGISTERED_PHONE });
      await handleRequestCode(req, res);
      assert(res.statusCode === 200, 'development: responds 200');
      assert(res.body && res.body.success === true, 'development: success is true');
      assert(hasDevOtp(res.body), 'development: devOtp IS present in the response body');
      assert(
        res.body && /^\d{6}$/.test(String(res.body.devOtp)),
        'development: devOtp is a 6-digit numeric string'
      );
    }

    // --- Case 3: NODE_ENV unset (common local default) behaves like dev ---
    delete process.env.NODE_ENV;
    clearAuthState(db, hashPhone(REGISTERED_PHONE));
    {
      const { req, res } = makeReqRes({ phone: REGISTERED_PHONE });
      await handleRequestCode(req, res);
      assert(
        hasDevOtp(res.body),
        'NODE_ENV unset: devOtp IS present (treated as non-production)'
      );
    }

    // --- Case 4: unknown phone never gets devOtp, even outside production ---
    process.env.NODE_ENV = 'development';
    {
      const { req, res } = makeReqRes({ phone: UNKNOWN_PHONE });
      await handleRequestCode(req, res);
      assert(res.statusCode === 200, 'unknown phone: still responds 200 (no enumeration)');
      assert(res.body && res.body.success === true, 'unknown phone: success is true');
      assert(
        !hasDevOtp(res.body),
        'unknown phone: devOtp is absent even in development (no teacher, no OTP generated)'
      );
    }

    // --- Case 5: staging-like values other than 'production' still get devOtp ---
    // (documents current behaviour: the gate is an equality check against
    // 'production', not an allowlist — anything else is treated as dev)
    process.env.NODE_ENV = 'staging';
    clearAuthState(db, hashPhone(REGISTERED_PHONE));
    {
      const { req, res } = makeReqRes({ phone: REGISTERED_PHONE });
      await handleRequestCode(req, res);
      assert(
        hasDevOtp(res.body),
        'NODE_ENV=staging: devOtp is present — confirms the gate checks only for the literal string "production"'
      );
    }
  } finally {
    whatsappService.sendMessage = originalSendMessage;
    process.env.NODE_ENV = originalNodeEnv;
  }

  console.log('\n─────────────────────────────────────────────────────');
  console.log(`PR25 Dev OTP Bypass Results: ${passed} passed, ${failed} failed`);
  console.log('─────────────────────────────────────────────────────');

  testDb.cleanup();

  if (failed > 0) {
    process.exitCode = 1;
  }
}

run();
