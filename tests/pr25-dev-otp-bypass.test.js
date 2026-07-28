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

// ── Shim better-sqlite3 → node:sqlite (mirrors tests/pr22-whatsapp-otp.test.js) ──
const Module = require('module');
const { DatabaseSync } = require('node:sqlite');

let _db = null;

const path = require('path');
const dbPath = path.resolve(__dirname, '../utils/database');

const _origResolve = Module._resolveFilename.bind(Module);
Module._resolveFilename = function (request, parent, isMain, opts) {
  if (request === 'better-sqlite3') return request;
  if (request === '../utils/database' || request === './database') return dbPath;
  return _origResolve(request, parent, isMain, opts);
};
require.cache['better-sqlite3'] = {
  id: 'better-sqlite3',
  filename: 'better-sqlite3',
  loaded: true,
  exports: function Database() {
    if (!_db.pragma) _db.pragma = () => {};
    return _db;
  },
};

require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { getDb: () => _db },
};

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

function buildSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash TEXT UNIQUE NOT NULL,
      name TEXT
    );
    CREATE TABLE IF NOT EXISTS auth_codes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash    TEXT    NOT NULL,
      code_hash     TEXT    NOT NULL,
      expires_at    TEXT    NOT NULL,
      attempts      INTEGER NOT NULL DEFAULT 0,
      consumed_at   TEXT,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_auth_codes_phone
      ON auth_codes(phone_hash);
    CREATE INDEX IF NOT EXISTS idx_auth_codes_lookup
      ON auth_codes(phone_hash, expires_at);
  `);
}

function resetDb() {
  _db = new DatabaseSync(':memory:');
  buildSchema(_db);
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

function hasDevOtp(body) {
  return !!body && Object.prototype.hasOwnProperty.call(body, 'devOtp');
}

// ── Test runner ──────────────────────────────────────────────────────────
async function run() {
  console.log('\nPR25 Dev-Only OTP Bypass Tests');
  console.log('='.repeat(75));

  resetDb();

  const { handleRequestCode } = require('../routes/auth').__testExports;
  const { hashPhone } = require('../utils/usageTracker');

  const REGISTERED_PHONE = '27821112222';
  const UNKNOWN_PHONE = '27899999999';
  insertTeacher(hashPhone(REGISTERED_PHONE), 'Dev Bypass Teacher');

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

  if (failed > 0) {
    process.exitCode = 1;
  }
}

run();
