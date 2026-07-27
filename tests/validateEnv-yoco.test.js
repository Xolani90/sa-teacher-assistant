// Test suite for validateEnv.js — Yoco webhook secret validation
//
// validateEnv() calls process.exit() directly, so each case runs in its own
// child process with a controlled environment and we assert on the exit
// code (0 = startup succeeded, 1 = startup correctly refused).
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');

// Minimal env satisfying every OTHER required key, so failures in these
// tests can only be attributed to the Yoco-specific validation logic.
const BASE_ENV = {
  PATH: process.env.PATH,
  WHATSAPP_TOKEN: 'test-token',
  WHATSAPP_PHONE_NUMBER_ID: 'test-phone-id',
  VERIFY_TOKEN: 'test-verify-token',
  PDF_SECRET: 'test-pdf-secret',
  META_APP_SECRET: 'test-meta-secret',
  PII_SECRET: 'test-pii-secret',
  APP_URL: 'https://example.onrender.com',
  ADMIN_SECRET: 'test-admin-secret',
  TEACHER_JWT_SECRET: 'test-teacher-jwt-secret',
  ANTHROPIC_API_KEY: 'test-anthropic-key',
};

function runValidateEnv(extraEnv) {
  const env = { ...BASE_ENV, ...extraEnv };
  const res = spawnSync(
    process.execPath,
    ['-e', "require('./utils/validateEnv').validateEnv();"],
    { cwd: PROJECT_ROOT, env, encoding: 'utf8' }
  );
  return res;
}

const results = [];

function check(name, condition, detail) {
  if (condition) {
    console.log(`PASS: ${name}`);
    results.push(true);
  } else {
    console.error(`FAIL: ${name}${detail ? ' — ' + detail : ''}`);
    results.push(false);
  }
}

console.log('=== validateEnv Yoco webhook secret test suite ===\n');

// 1. No Yoco config at all → startup succeeds (dev environments unaffected)
{
  const res = runValidateEnv({});
  check('no Yoco config → startup succeeds', res.status === 0, `exit=${res.status} stderr=${res.stderr}`);
}

// 2. YOCO_SECRET_KEY only, no webhook secret → startup fails
{
  const res = runValidateEnv({ YOCO_SECRET_KEY: 'sk_test_xxx' });
  check(
    'YOCO_SECRET_KEY without YOCO_WEBHOOK_SECRET → startup fails',
    res.status === 1 && /YOCO_WEBHOOK_SECRET is missing/.test(res.stderr),
    `exit=${res.status} stderr=${res.stderr}`
  );
}

// 3. YOCO_SECRET_KEY + webhook secret missing whsec_ prefix → startup fails
{
  const res = runValidateEnv({
    YOCO_SECRET_KEY: 'sk_test_xxx',
    YOCO_WEBHOOK_SECRET: 'dGVzdHNlY3JldA==', // valid base64, but no whsec_ prefix
  });
  check(
    'malformed webhook secret (no whsec_ prefix) → startup fails',
    res.status === 1 && /must start with 'whsec_'/.test(res.stderr),
    `exit=${res.status} stderr=${res.stderr}`
  );
}

// 4. YOCO_SECRET_KEY + whsec_ prefix but empty/invalid base64 payload → startup fails
{
  const res = runValidateEnv({
    YOCO_SECRET_KEY: 'sk_test_xxx',
    YOCO_WEBHOOK_SECRET: 'whsec_', // prefix only, decodes to empty bytes
  });
  check(
    'whsec_ prefix with empty payload → startup fails',
    res.status === 1 && /invalid Base64 payload/.test(res.stderr),
    `exit=${res.status} stderr=${res.stderr}`
  );
}

// 5. Valid API key + valid, well-formed webhook secret → startup succeeds
{
  const res = runValidateEnv({
    YOCO_SECRET_KEY: 'sk_test_xxx',
    YOCO_WEBHOOK_SECRET: 'whsec_' + Buffer.from('a-real-looking-secret').toString('base64'),
  });
  check(
    'valid YOCO_SECRET_KEY + valid YOCO_WEBHOOK_SECRET → startup succeeds',
    res.status === 0,
    `exit=${res.status} stderr=${res.stderr}`
  );
}

// 6. Webhook secret configured without the API key — not the failure mode we
//    guard against (nothing charges without YOCO_SECRET_KEY), so this must
//    not be blocked by the conditional check. It's still validated for format
//    since it's present.
{
  const res = runValidateEnv({
    YOCO_WEBHOOK_SECRET: 'whsec_' + Buffer.from('a-real-looking-secret').toString('base64'),
  });
  check(
    'YOCO_WEBHOOK_SECRET without YOCO_SECRET_KEY (valid format) → startup succeeds',
    res.status === 0,
    `exit=${res.status} stderr=${res.stderr}`
  );
}

const passed = results.filter(Boolean).length;
const total = results.length;
console.log(`\n=== Results: ${passed}/${total} tests passed ===`);

if (passed === total) {
  console.log('All tests passed!');
  process.exit(0);
} else {
  console.log('Some tests failed.');
  process.exit(1);
}
