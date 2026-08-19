// Test suite for validateEnv.js — REQUIRED key enforcement + AI_KEYS OR-check
// (RC1 Phase B Security, Row 4)
//
// validateEnv() calls process.exit() directly, so each case runs in its own
// child process with an explicitly constructed, allowlisted environment and
// we assert on the exit code and stderr content. This mirrors the pattern
// established by tests/validateEnv-yoco.test.js, which already validated
// that this real-child-process approach is sound for this file.
//
// Environment isolation: the child environment is built ONLY from
// FULL_VALID_ENV below (plus PATH, which Node needs to resolve on some
// systems). We never spread process.env into the child, so a developer's
// .env file, shell exports, or CI/host environment cannot silently
// resurrect a key a given case intends to remove. The child invocation
// requires utils/validateEnv.js directly via `node -e` — it never touches
// server.js, so dotenv.config() is never called and no .env file on disk
// can leak values into the child process.
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');

// A complete, explicit environment satisfying every REQUIRED key plus one
// AI key. Each case below starts from this object and either deletes one
// key (REQUIRED cases) or overrides the AI-key pair (AI_KEYS cases).
const FULL_VALID_ENV = {
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

const REQUIRED_KEYS = [
  'WHATSAPP_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'VERIFY_TOKEN',
  'PDF_SECRET',
  'META_APP_SECRET',
  'PII_SECRET',
  'APP_URL',
  'ADMIN_SECRET',
  'TEACHER_JWT_SECRET',
];

// Builds a child env from FULL_VALID_ENV, explicitly deleting `omitKey` if
// given, and applying any additional overrides. No process.env spreading.
function buildEnv(omitKey, overrides) {
  const env = { ...FULL_VALID_ENV };
  if (omitKey) delete env[omitKey];
  if (overrides) {
    for (const k of Object.keys(overrides)) {
      if (overrides[k] === undefined) {
        delete env[k];
      } else {
        env[k] = overrides[k];
      }
    }
  }
  return env;
}

function runValidateEnv(env) {
  return spawnSync(
    process.execPath,
    ['-e', "require('./utils/validateEnv').validateEnv();"],
    { cwd: PROJECT_ROOT, env, encoding: 'utf8' }
  );
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

console.log('=== validateEnv REQUIRED-list + AI_KEYS OR-check test suite ===\n');

// Sanity check: the fully valid baseline env must itself pass, or every
// subsequent "removing one key causes failure" case would be meaningless.
{
  const res = runValidateEnv(buildEnv(null));
  check(
    'baseline FULL_VALID_ENV (nothing removed) → startup succeeds',
    res.status === 0,
    `exit=${res.status} stderr=${res.stderr}`
  );
}

// REQUIRED list — 9 cases: remove exactly one required key at a time.
for (const key of REQUIRED_KEYS) {
  const res = runValidateEnv(buildEnv(key));
  check(
    `missing ${key} → exit 1 with matching error text`,
    res.status === 1 && res.stderr.includes(`Missing ${key}`),
    `exit=${res.status} stderr=${res.stderr}`
  );
}

// AI_KEYS OR-check — 3 cases.
{
  const res = runValidateEnv(buildEnv(null, { ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: undefined }));
  check(
    'neither AI key present → exit 1 with AI-key error',
    res.status === 1 && /Missing AI key/.test(res.stderr),
    `exit=${res.status} stderr=${res.stderr}`
  );
}
{
  const res = runValidateEnv(buildEnv(null, { ANTHROPIC_API_KEY: 'test-anthropic-key', OPENAI_API_KEY: undefined }));
  check(
    'ANTHROPIC_API_KEY only → startup succeeds',
    res.status === 0,
    `exit=${res.status} stderr=${res.stderr}`
  );
}
{
  const res = runValidateEnv(buildEnv(null, { ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: 'test-openai-key' }));
  check(
    'OPENAI_API_KEY only → startup succeeds',
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
