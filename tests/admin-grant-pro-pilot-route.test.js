'use strict';
/**
 * /admin/grant-pro { pilot: true } route-level test.
 *
 * Spawns the real Express app in-process (not a child process) against
 * the createTestDb shim, so it exercises the actual route handler,
 * requireAdminSecret, adminLimiter, and grantPilotPro() together — not a
 * hand-rolled req/res stub of just the inner function.
 *
 * Run individually: node tests/admin-grant-pro-pilot-route.test.js
 * Run via npm:       npm test
 */

process.env.PII_SECRET = 'test-pii-secret-for-pilot-route';
process.env.ADMIN_SECRET = 'test-admin-secret-for-pilot-route';
process.env.TEACHER_JWT_SECRET = 'test-teacher-jwt-secret';
process.env.YOCO_SECRET_KEY = 'test-yoco-secret';
process.env.YOCO_PUBLIC_KEY = 'test-yoco-public';
process.env.YOCO_WEBHOOK_SECRET = 'whsec_test-yoco-webhook-secret';
process.env.PRO_PRICE_ZAR = '99';
process.env.APP_URL = 'https://example.test';
process.env.WHATSAPP_TOKEN = 'test-whatsapp-token';
process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-number-id';
process.env.VERIFY_TOKEN = 'test-verify-token';
process.env.PDF_SECRET = 'test-pdf-secret';
process.env.META_APP_SECRET = 'test-meta-app-secret';
process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
process.env.NODE_ENV = 'test';

const http = require('http');

// MUST be required before server.js (which transitively requires
// utils/database.js -> better-sqlite3) — see createTestDb.js's own
// "Why this must be required first" note.
const { createTestDb } = require('./helpers/createTestDb');
const testDb = createTestDb(__filename);
const db = testDb.db;

let passed = 0;
let failed = 0;
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
function assert(cond, label) {
  if (cond) { console.log(`  \u2705 ${label}`); passed++; }
  else { console.error(`  \u274c FAIL: ${label}`); failed++; }
}

function post(port, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(raw); } catch { /* leave null */ }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function run() {
  console.log('\n/admin/grant-pro { pilot: true } route-level test');
  console.log('='.repeat(75));

  const app = require('../server');
  const server = app.listen(0);
  const port = server.address().port;
  const { hashPhone } = require('../utils/usageTracker');
  const authHeader = { Authorization: process.env.ADMIN_SECRET };

  try {
    // ── Case 1: pilot grant for a brand-new teacher succeeds ──
    {
      const phone = '+27821119001';
      const res = await post(port, '/admin/grant-pro', { phone, pilot: true }, authHeader);
      assertEq(res.status, 200, 'new teacher pilot grant: HTTP 200');
      assertEq(res.body?.success, true, 'new teacher pilot grant: success true');
      assertEq(res.body?.pilot, true, 'response echoes pilot: true');
      assert(!!res.body?.expiresAt, 'response includes expiresAt');

      const hash = hashPhone(phone);
      const row = db.prepare('SELECT * FROM teachers WHERE phone_hash = ?').get(hash);
      assertEq(row.is_pilot_account, 1, 'DB: is_pilot_account = 1 after pilot grant');
      assertEq(row.is_pro, 1, 'DB: is_pro = 1 after pilot grant');
    }

    // ── Case 2: teacher with active normal Pro is rejected via HTTP 400 ──
    {
      const phone = '+27821119002';
      const hash = hashPhone(phone);
      const future = new Date(Date.now() + 10 * 86400000).toISOString().replace('T', ' ').slice(0, 19);
      db.prepare('INSERT INTO teachers (phone_hash) VALUES (?)').run(hash);
      db.prepare('UPDATE teachers SET is_pro = 1, is_pilot_account = 0, pro_expires = ? WHERE phone_hash = ?').run(future, hash);

      const res = await post(port, '/admin/grant-pro', { phone, pilot: true }, authHeader);
      assertEq(res.status, 400, 'active normal Pro + pilot grant: HTTP 400');
      assertEq(res.body?.error, 'Pilot grant rejected', 'error message present');
      assertEq(res.body?.reason, 'active_non_pilot_pro', 'rejection reason surfaced in response body');

      const row = db.prepare('SELECT * FROM teachers WHERE phone_hash = ?').get(hash);
      assertEq(row.pro_expires, future, 'DB: pro_expires untouched by rejected pilot grant');
    }

    // ── Case 3: missing admin auth is rejected before reaching pilot logic ──
    {
      const res = await post(port, '/admin/grant-pro', { phone: '+27821119003', pilot: true }, {});
      assert(res.status === 401 || res.status === 403, 'missing admin auth: rejected (401/403)');
    }

    // ── Case 4: non-pilot path (no pilot flag) still works as before ──
    {
      const phone = '+27821119004';
      const res = await post(port, '/admin/grant-pro', { phone }, authHeader);
      assertEq(res.status, 200, 'non-pilot grant: HTTP 200 (unchanged behavior)');
      assertEq(res.body?.pilot, undefined, 'non-pilot response has no pilot field');
    }
  } finally {
    server.close();
  }

  console.log('\n' + '='.repeat(75));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  testDb.cleanup();
  if (failed > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
