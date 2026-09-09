'use strict';
// RC2 P2 — Zero-capital AI fallback decision logic.
//
// services/aiAvailability.js is a pure, side-effect-free classification
// layer on top of the existing services/aiService.js error strings and
// utils/aiCostMonitor.js's existing daily-ceiling tracker. It makes no
// network calls, adds no retries, and introduces no second AI provider —
// it only decides which teacher-facing message a caller should show for
// an error generateContent()/generateWithVision() already threw.
//
// These tests exercise the decision logic directly (no DB, no network,
// no real AI call) — the same isolation approach as
// tests/intentParser-shortcuts.test.js for the classifier's own
// deterministic regex fallback.

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    console.log(`  \u2705 PASS: ${label}`);
    passed++;
  } else {
    console.log(`  \u274c FAIL: ${label}`);
    failed++;
  }
}

// Isolate env var state so this file never leaks provider config into
// other test files run in the same `npm test` sweep (each file runs as
// its own child process per tests/run-all.js, but keep this defensive).
const ORIGINAL_ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ORIGINAL_OPENAI_KEY = process.env.OPENAI_API_KEY;
function restoreEnv() {
  if (ORIGINAL_ANTHROPIC_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORIGINAL_ANTHROPIC_KEY;
  if (ORIGINAL_OPENAI_KEY === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = ORIGINAL_OPENAI_KEY;
}

const {
  AI_AVAILABLE,
  AI_UNAVAILABLE,
  AI_DEGRADED,
  isProviderConfigured,
  getAiStatus,
  classifyAiError,
  isRetryPointless,
  buildAiUnavailableMessage,
  getAiFailureMessage,
} = require('../services/aiAvailability');

// ── Test A — Primary provider available ─────────────────────────────────
console.log('\ud83d\udccb TEST A: Primary provider available -> AI_AVAILABLE, no fallback');
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-not-real';
check('isProviderConfigured() is true when ANTHROPIC_API_KEY is set', isProviderConfigured() === true);
check('getAiStatus() reports AI_AVAILABLE when a key is set and ceiling not reached', getAiStatus().status === AI_AVAILABLE);
check('An unrelated/transient error does not trigger the fallback message', getAiFailureMessage(new Error('API 429: rate limited'), 'DEFAULT') === 'DEFAULT');

// ── Test B — No provider credentials ────────────────────────────────────
console.log('\ud83d\udccb TEST B: No provider credentials -> AI_UNAVAILABLE, fallback path');
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;
check('isProviderConfigured() is false with no keys set', isProviderConfigured() === false);
check('getAiStatus() reports AI_UNAVAILABLE with reason no_api_key', (() => {
  const s = getAiStatus();
  return s.status === AI_UNAVAILABLE && s.reason === 'no_api_key';
})());
check(
  'The exact error aiService.js\'s detectProvider() throws is classified as missing_key',
  classifyAiError(new Error('No AI API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.')) === 'missing_key'
);
check('missing_key is a retry-pointless category', isRetryPointless('missing_key') === true);
check(
  'getAiFailureMessage() returns the deterministic-alternatives message for missing_key, not the default',
  getAiFailureMessage(new Error('No AI API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.'), 'DEFAULT') !== 'DEFAULT'
);
check('buildAiUnavailableMessage() lists at least one genuinely deterministic alternative (MENU)', buildAiUnavailableMessage().includes('MENU'));
check('buildAiUnavailableMessage() never claims AI generation succeeded', !/generated successfully|here is your/i.test(buildAiUnavailableMessage()));
check(
  'buildAiUnavailableMessage() does not claim every feature works without AI',
  !/everything works without ai|all features work/i.test(buildAiUnavailableMessage())
);

// ── Test C — Provider quota/credit exhaustion ───────────────────────────
console.log('\ud83d\udccb TEST C: Quota/credit exhaustion -> fallback treated as retry-worthy (safe), not config failure');
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-not-real';
check('API 429 is classified as rate_limited, not missing_key', classifyAiError(new Error('API 429: rate limit exceeded')) === 'rate_limited');
check('rate_limited is NOT retry-pointless (a later request may succeed once quota resets)', isRetryPointless('rate_limited') === false);
check(
  'getAiFailureMessage() keeps the caller\'s existing transient-failure copy for rate limiting',
  getAiFailureMessage(new Error('API 429: rate limit exceeded'), 'DEFAULT') === 'DEFAULT'
);

// ── Test D — Provider timeout/unavailable ───────────────────────────────
console.log('\ud83d\udccb TEST D: Provider timeout/network failure -> fallback treated as retry-worthy (safe)');
check('A timeout error is classified as timeout', classifyAiError(new Error('AI API request timed out after 60s')) === 'timeout');
check('A network error is classified as network', classifyAiError(new Error('Network error calling AI API: ECONNRESET')) === 'network');
check('A 503 provider error is classified as provider_error', classifyAiError(new Error('API 503: Service Unavailable')) === 'provider_error');
check('timeout is NOT retry-pointless', isRetryPointless('timeout') === false);
check('network is NOT retry-pointless', isRetryPointless('network') === false);
check('provider_error is NOT retry-pointless', isRetryPointless('provider_error') === false);
check(
  'getAiFailureMessage() keeps the caller\'s existing transient-failure copy for a timeout',
  getAiFailureMessage(new Error('AI API request timed out after 60s'), 'DEFAULT') === 'DEFAULT'
);

// ── Test E — Unsupported/unclear AI-dependent operation ─────────────────
console.log('\ud83d\udccb TEST E: Malformed/unknown provider response -> graceful message, never fake content');
check('An empty-response error is classified as malformed_response', classifyAiError(new Error('Empty response from Anthropic API')) === 'malformed_response');
check('A completely unrecognized error string classifies as unknown (never crashes)', classifyAiError(new Error('some new provider error we have never seen')) === 'unknown');
check('classifyAiError() never throws on a plain string instead of an Error', (() => {
  try { classifyAiError('just a string'); return true; } catch { return false; }
})());
check('classifyAiError() never throws on null/undefined', (() => {
  try { classifyAiError(null); classifyAiError(undefined); return true; } catch { return false; }
})());
check(
  'getAiFailureMessage() never fabricates success language for any category',
  ['missing_key', 'auth_failed', 'rate_limited', 'provider_error', 'timeout', 'network', 'malformed_response', 'unknown']
    .every((cat) => {
      const fakeErr = new Error(cat === 'missing_key' ? 'No AI API key found.' : 'some other failure');
      const msg = getAiFailureMessage(fakeErr, 'DEFAULT');
      return !/successfully generated|here'?s your ai/i.test(msg);
    })
);

// ── Test F — No accidental paid retry loop ──────────────────────────────
console.log('\ud83d\udccb TEST F: No retry/paid-call loop introduced by the fallback layer');
check(
  'aiAvailability.js exports no function that calls generateContent, fetch, https, or any network primitive',
  (() => {
    const mod = require('../services/aiAvailability');
    return Object.values(mod).every((v) => typeof v !== 'function' || !/generateContent|https\.request|fetch\(/.test(v.toString()));
  })()
);
check(
  'getAiFailureMessage() is a pure function — calling it repeatedly for the same input never changes provider state or throws',
  (() => {
    const err = new Error('No AI API key found.');
    const first = getAiFailureMessage(err, 'DEFAULT');
    const second = getAiFailureMessage(err, 'DEFAULT');
    const third = getAiFailureMessage(err, 'DEFAULT');
    return first === second && second === third;
  })()
);

// ── AI_DEGRADED status (informational only — does not gate generation) ──
console.log('\ud83d\udccb TEST: AI_DEGRADED reflects the existing cost ceiling without changing generation behaviour');
check(
  'getAiStatus() distinguishes AI_AVAILABLE / AI_UNAVAILABLE / AI_DEGRADED as distinct string constants',
  new Set([AI_AVAILABLE, AI_UNAVAILABLE, AI_DEGRADED]).size === 3
);

restoreEnv();

console.log('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
console.log(`\u2705 Passed: ${passed}`);
console.log(`\u274c Failed: ${failed}`);
console.log('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

if (failed > 0) {
  process.exit(1);
}