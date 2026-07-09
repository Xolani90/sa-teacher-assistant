#!/usr/bin/env node
'use strict';

/**
 * scripts/smoke-test.js
 *
 * Runs 6 checks against the live deployment to confirm the server is healthy
 * before onboarding real teachers.
 *
 * Usage:
 *   APP_URL=https://sa-teacher-assistant.onrender.com \
 *   ADMIN_SECRET=your-secret \
 *   VERIFY_TOKEN=your-verify-token \
 *   node scripts/smoke-test.js
 */

const https = require('https');
const http  = require('http');
const url   = require('url');

const APP_URL      = process.env.APP_URL;
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

if (!APP_URL || !ADMIN_SECRET || !VERIFY_TOKEN) {
  console.error('Missing required env vars: APP_URL, ADMIN_SECRET, VERIFY_TOKEN');
  process.exit(1);
}

console.log(`🔍  Smoke-testing ${APP_URL}\n`);

let passed = 0;
let failed = 0;

function check(name, ok, detail) {
  if (ok) {
    console.log(`  ✅  ${name}`);
    passed++;
  } else {
    console.log(`  ❌  ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function request(options, body) {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(options.url || APP_URL + options.path);
    const lib    = parsed.protocol === 'https:' ? https : http;
    const start  = Date.now();

    const req = lib.request({
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.path,
      method:   options.method || 'GET',
      headers:  options.headers || {},
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data, ms: Date.now() - start });
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function runChecks() {
  // 1. Health check
  console.log('📋  1. Health check');
  try {
    const r = await request({ path: '/' });
    check(`HTTP 200 — ${r.ms}ms`, r.status === 200);
    check('status=ok in response body', r.body.includes('"status"') && r.body.includes('ok'));
    check(`Response under 5s — ${r.ms}ms`, r.ms < 5000);
  } catch (e) {
    check('Health check reachable', false, e.message);
    check('status=ok in response body', false);
    check('Response under 5s', false);
  }

  // 2. PDF route security — unsigned request must be rejected
  console.log('📋  2. PDF route security');
  try {
    const r = await request({ path: '/pdf/00000000-0000-0000-0000-000000000000' });
    check(`Unsigned PDF request rejected (403) — got ${r.status}`, r.status === 403);
  } catch (e) {
    check('PDF route security', false, e.message);
  }

  // 3. Admin endpoint security — unauthenticated must be 401
  console.log('📋  3. Admin endpoint security');
  try {
    const body = JSON.stringify({ phone: '+27821234567' });
    const r = await request({
      path: '/admin/grant-pro',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, body);
    check(`Unauthenticated admin request rejected (401) — got ${r.status}`, r.status === 401);
  } catch (e) {
    check('Admin security', false, e.message);
  }

  // 4. Admin /grant-pro with correct secret
  console.log('📋  4. Admin /grant-pro');
  try {
    const body = JSON.stringify({ phone: '+27821234567' });
    const r = await request({
      path: '/admin/grant-pro',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Authorization: ADMIN_SECRET,
      },
    }, body);
    let parsed = {};
    try { parsed = JSON.parse(r.body); } catch (_) {}
    check(`Returns 200 — got ${r.status}`, r.status === 200);
    check('Body has success=true', parsed.success === true);
    check('Body includes expiresAt', !!parsed.expiresAt);
  } catch (e) {
    check('Admin /grant-pro', false, e.message);
    check('Body has success=true', false);
    check('Body includes expiresAt', false);
  }

  // 5. WhatsApp webhook verification
  console.log('📋  5. WhatsApp webhook verification');
  try {
    const challenge = 'smoke_test_challenge_123';
    const qs = `?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=${challenge}`;
    const r = await request({ path: `/webhook${qs}` });
    check(`Verification returns 200 — got ${r.status}`, r.status === 200);
    check('Challenge echoed back correctly', r.body.includes(challenge));
  } catch (e) {
    check('Webhook verification', false, e.message);
    check('Challenge echoed back', false);
  }

  // 6. 404 handler
  console.log('📋  6. 404 handler');
  try {
    const r = await request({ path: '/nonexistent-route-xyz' });
    check(`404 returns 404 — got ${r.status}`, r.status === 404);
  } catch (e) {
    check('404 handler', false, e.message);
  }

  // Summary
  console.log('─────────────────────────────────');
  console.log(`✅  Passed: ${passed}`);
  console.log(`❌  Failed: ${failed}`);
  console.log('─────────────────────────────────');

  if (failed > 0) {
    console.log('\nFix the failures above before onboarding teachers.');
    process.exit(1);
  } else {
    console.log('\nAll checks passed — safe to onboard beta teachers. 🎓');
  }
}

runChecks().catch(e => {
  console.error('Smoke test crashed:', e);
  process.exit(1);
});
