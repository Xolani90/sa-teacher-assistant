'use strict';
/**
 * AI provider failover — Anthropic primary, OpenAI one-attempt backup.
 *
 * Bug: production Render logs showed Anthropic returning
 * "API 400: Your credit balance is too low to access the Anthropic API..."
 * on credit exhaustion. Before this change, services/aiService.js's
 * generateContent() had no fallback logic at all — any Anthropic failure
 * (rate limit, 5xx, timeout, credit exhaustion, anything) was thrown
 * straight to the caller, even with OPENAI_API_KEY configured as a
 * standing backup.
 *
 * Fix: generateContent() now attempts exactly one OpenAI backup call, but
 * only when (a) Anthropic is the primary provider, (b) OPENAI_API_KEY is
 * configured, and (c) services/aiAvailability.js's classifyAiError()
 * classifies the failure as a provider-availability problem — rate limit,
 * 5xx, timeout, network, malformed response, or (newly) a 400 whose
 * message explicitly names credit/quota/billing exhaustion. A generic 400,
 * a 401/403, or an unrecognized error still throws immediately, exactly as
 * before.
 *
 * This test mocks the `https` module only — no real network calls, no
 * real API keys. It reloads services/aiService.js fresh for every
 * scenario (via jest-free manual require-cache clearing) so detectProvider()'s
 * internal cache and MODEL_CONFIG lookups never leak between scenarios.
 *
 * Run individually: node tests/ai-provider-failover.test.js
 */

const https = require('https');
const { EventEmitter } = require('events');

let passed = 0;
let failed = 0;
function assert(condition, label) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ FAIL: ${label}`); failed++; }
}

const originalRequest = https.request;
const AI_SERVICE_PATH = require.resolve('../services/aiService.js');
const AI_AVAILABILITY_PATH = require.resolve('../services/aiAvailability.js');

/**
 * Fresh require of aiService.js with detectProvider()'s module-level cache
 * cleared, so each scenario's env vars (ANTHROPIC_API_KEY / OPENAI_API_KEY)
 * are re-read from scratch.
 */
function freshAiService() {
  delete require.cache[AI_SERVICE_PATH];
  delete require.cache[AI_AVAILABILITY_PATH];
  return require('../services/aiService.js');
}

/**
 * Mocks https.request to respond per-hostname according to `plan`, a map
 * of hostname -> { type: 'success'|'httpError'|'timeout'|'network'|'malformed', status?, message? }.
 * Tracks how many times each hostname was called.
 */
function mockProviders(plan) {
  const callCounts = { 'api.anthropic.com': 0, 'api.openai.com': 0, 'generativelanguage.googleapis.com': 0 };

  https.request = function mockRequest(options, callback) {
    const host = options.hostname;
    callCounts[host] = (callCounts[host] || 0) + 1;
    const behavior = plan[host] || { type: 'success' };

    const req = new EventEmitter();
    req.setTimeout = (ms, onTimeout) => {
      if (behavior.type === 'timeout') setImmediate(onTimeout);
    };
    req.destroy = (err) => {
      if (err) setImmediate(() => req.emit('error', err));
    };
    req.write = () => {};
    req.end = () => {
      if (behavior.type === 'timeout') return; // only the setTimeout callback fires
      if (behavior.type === 'network') {
        setImmediate(() => req.emit('error', new Error(behavior.message || 'ECONNRESET')));
        return;
      }
      setImmediate(() => {
        const res = new EventEmitter();
        callback(res);
        res.statusCode = behavior.status || 200;
        setImmediate(() => {
          if (behavior.type === 'malformed') {
            res.emit('data', 'not-json{{{');
          } else if (behavior.type === 'httpError') {
            res.emit('data', JSON.stringify({ error: { message: behavior.message || 'Provider error' } }));
          } else {
            // success — shape matches each provider's own response parser
            if (host === 'api.anthropic.com') {
              res.emit('data', JSON.stringify({ content: [{ text: behavior.text || 'anthropic content' }], usage: { input_tokens: 10, output_tokens: 20 } }));
            } else if (host === 'api.openai.com') {
              res.emit('data', JSON.stringify({ choices: [{ message: { content: behavior.text || 'openai content' } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }));
            } else {
              res.emit('data', JSON.stringify({ candidates: [{ content: { parts: [{ text: behavior.text || 'gemini content' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 } }));
            }
          }
          res.emit('end');
        });
      });
    };
    return req;
  };

  return callCounts;
}

function restoreHttps() {
  https.request = originalRequest;
}

async function run() {
  // ── A. Anthropic success → OpenAI not called ──────────────────────────
  {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    const counts = mockProviders({ 'api.anthropic.com': { type: 'success', text: 'worksheet content' } });
    const aiService = freshAiService();
    const result = await aiService.generateContent('prompt', 'worksheet');
    assert(result === 'worksheet content', 'A: Anthropic success returns Anthropic content');
    assert(counts['api.anthropic.com'] === 1, 'A: Anthropic called once');
    assert((counts['api.openai.com'] || 0) === 0, 'A: OpenAI not called on Anthropic success');
    restoreHttps();
  }

  // ── B. Anthropic 429 → OpenAI called exactly once, succeeds ───────────
  {
    const counts = mockProviders({
      'api.anthropic.com': { type: 'httpError', status: 429, message: 'Rate limit exceeded' },
      'api.openai.com': { type: 'success', text: 'openai backup content' },
    });
    const aiService = freshAiService();
    const result = await aiService.generateContent('prompt', 'worksheet');
    assert(result === 'openai backup content', 'B: 429 falls back to OpenAI content');
    assert(counts['api.anthropic.com'] === 1, 'B: Anthropic attempted once');
    assert(counts['api.openai.com'] === 1, 'B: OpenAI attempted exactly once');
    restoreHttps();
  }

  // ── C. Anthropic credit exhaustion (exact production message) → fallback ──
  {
    const counts = mockProviders({
      'api.anthropic.com': {
        type: 'httpError',
        status: 400,
        message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
      },
      'api.openai.com': { type: 'success', text: 'openai backup content' },
    });
    const aiService = freshAiService();
    const result = await aiService.generateContent('prompt', 'worksheet');
    assert(result === 'openai backup content', 'C: production-style credit exhaustion falls back to OpenAI');
    assert(counts['api.anthropic.com'] === 1, 'C: Anthropic attempted once');
    assert(counts['api.openai.com'] === 1, 'C: OpenAI attempted exactly once');
    restoreHttps();
  }

  // ── D. Quota/billing exhaustion wording variants → fallback ────────────
  {
    const variants = [
      'insufficient quota to complete this request',
      'quota exceeded for this billing period',
      'billing balance exhausted, please add funds',
      'you are out of credits',
      'usage limit reached for this account',
    ];
    for (const message of variants) {
      const counts = mockProviders({
        'api.anthropic.com': { type: 'httpError', status: 400, message },
        'api.openai.com': { type: 'success', text: 'openai backup content' },
      });
      const aiService = freshAiService();
      const result = await aiService.generateContent('prompt', 'worksheet');
      assert(result === 'openai backup content' && counts['api.openai.com'] === 1, `D: wording variant "${message}" falls back to OpenAI`);
      restoreHttps();
    }
  }

  // ── E. Anthropic 5xx → OpenAI called exactly once ──────────────────────
  {
    const counts = mockProviders({
      'api.anthropic.com': { type: 'httpError', status: 503, message: 'Service unavailable' },
      'api.openai.com': { type: 'success', text: 'openai backup content' },
    });
    const aiService = freshAiService();
    const result = await aiService.generateContent('prompt', 'worksheet');
    assert(result === 'openai backup content', 'E: 5xx falls back to OpenAI content');
    assert(counts['api.anthropic.com'] === 1 && counts['api.openai.com'] === 1, 'E: exactly one attempt per provider');
    restoreHttps();
  }

  // ── F. Anthropic timeout → OpenAI called exactly once ───────────────────
  {
    const counts = mockProviders({
      'api.anthropic.com': { type: 'timeout' },
      'api.openai.com': { type: 'success', text: 'openai backup content' },
    });
    const aiService = freshAiService();
    const result = await aiService.generateContent('prompt', 'worksheet');
    assert(result === 'openai backup content', 'F: timeout falls back to OpenAI content');
    assert(counts['api.anthropic.com'] === 1 && counts['api.openai.com'] === 1, 'F: exactly one attempt per provider');
    restoreHttps();
  }

  // ── G. Anthropic network failure → OpenAI called exactly once ──────────
  {
    const counts = mockProviders({
      'api.anthropic.com': { type: 'network', message: 'ECONNRESET' },
      'api.openai.com': { type: 'success', text: 'openai backup content' },
    });
    const aiService = freshAiService();
    const result = await aiService.generateContent('prompt', 'worksheet');
    assert(result === 'openai backup content', 'G: network failure falls back to OpenAI content');
    assert(counts['api.anthropic.com'] === 1 && counts['api.openai.com'] === 1, 'G: exactly one attempt per provider');
    restoreHttps();
  }

  // ── H. Anthropic malformed response → OpenAI called exactly once ───────
  {
    const counts = mockProviders({
      'api.anthropic.com': { type: 'malformed' },
      'api.openai.com': { type: 'success', text: 'openai backup content' },
    });
    const aiService = freshAiService();
    const result = await aiService.generateContent('prompt', 'worksheet');
    assert(result === 'openai backup content', 'H: malformed response falls back to OpenAI content');
    assert(counts['api.anthropic.com'] === 1 && counts['api.openai.com'] === 1, 'H: exactly one attempt per provider');
    restoreHttps();
  }

  // ── I. Generic Anthropic 400 → OpenAI NOT called ────────────────────────
  {
    const counts = mockProviders({
      'api.anthropic.com': { type: 'httpError', status: 400, message: 'Invalid request: max_tokens must be positive' },
      'api.openai.com': { type: 'success', text: 'openai backup content' },
    });
    const aiService = freshAiService();
    let threw = false;
    try {
      await aiService.generateContent('prompt', 'worksheet');
    } catch (err) {
      threw = true;
      assert(/API 400/.test(err.message), 'I: original Anthropic 400 error propagates unchanged');
    }
    assert(threw, 'I: generic 400 throws instead of returning fallback content');
    assert(counts['api.anthropic.com'] === 1, 'I: Anthropic attempted once');
    assert((counts['api.openai.com'] || 0) === 0, 'I: OpenAI NOT called for generic 400');
    restoreHttps();
  }

  // ── J. Anthropic 401 → OpenAI NOT called ────────────────────────────────
  {
    const counts = mockProviders({
      'api.anthropic.com': { type: 'httpError', status: 401, message: 'Invalid API key' },
      'api.openai.com': { type: 'success', text: 'openai backup content' },
    });
    const aiService = freshAiService();
    let threw = false;
    try {
      await aiService.generateContent('prompt', 'worksheet');
    } catch {
      threw = true;
    }
    assert(threw, 'J: 401 throws instead of falling back');
    assert((counts['api.openai.com'] || 0) === 0, 'J: OpenAI NOT called for 401');
    restoreHttps();
  }

  // ── K. Anthropic 403 → OpenAI NOT called ────────────────────────────────
  {
    const counts = mockProviders({
      'api.anthropic.com': { type: 'httpError', status: 403, message: 'Forbidden' },
      'api.openai.com': { type: 'success', text: 'openai backup content' },
    });
    const aiService = freshAiService();
    let threw = false;
    try {
      await aiService.generateContent('prompt', 'worksheet');
    } catch {
      threw = true;
    }
    assert(threw, 'K: 403 throws instead of falling back');
    assert((counts['api.openai.com'] || 0) === 0, 'K: OpenAI NOT called for 403');
    restoreHttps();
  }

  // ── L. Unknown/application error → OpenAI NOT called ────────────────────
  {
    const counts = mockProviders({
      'api.anthropic.com': { type: 'httpError', status: 422, message: 'Unprocessable entity: totally unrecognized shape' },
      'api.openai.com': { type: 'success', text: 'openai backup content' },
    });
    const aiService = freshAiService();
    let threw = false;
    try {
      await aiService.generateContent('prompt', 'worksheet');
    } catch {
      threw = true;
    }
    assert(threw, 'L: unrecognized error throws instead of falling back');
    assert((counts['api.openai.com'] || 0) === 0, 'L: OpenAI NOT called for unrecognized error category');
    restoreHttps();
  }

  // ── M. Both providers fail → exactly two attempts, controlled failure ──
  {
    const counts = mockProviders({
      'api.anthropic.com': { type: 'httpError', status: 429, message: 'Rate limit exceeded' },
      'api.openai.com': { type: 'httpError', status: 503, message: 'OpenAI also down' },
    });
    const aiService = freshAiService();
    let threw = false;
    let errMessage = '';
    try {
      await aiService.generateContent('prompt', 'worksheet');
    } catch (err) {
      threw = true;
      errMessage = err.message;
    }
    assert(threw, 'M: both providers failing throws (no silent success)');
    assert(counts['api.anthropic.com'] === 1, 'M: exactly one Anthropic attempt');
    assert(counts['api.openai.com'] === 1, 'M: exactly one OpenAI attempt (no loop back to Anthropic)');
    assert(/503|OpenAI also down/.test(errMessage), 'M: the backup provider error is what propagates');
    restoreHttps();
  }

  // ── N. OpenAI fallback success matches existing Promise<string> contract ──
  {
    const counts = mockProviders({
      'api.anthropic.com': { type: 'httpError', status: 500, message: 'Internal error' },
      'api.openai.com': { type: 'success', text: 'a complete worksheet document' },
    });
    const aiService = freshAiService();
    const result = await aiService.generateContent('prompt', 'worksheet');
    assert(typeof result === 'string' && result.length > 0, 'N: fallback result is a non-empty string, same contract as primary path');
    assert(counts['api.openai.com'] === 1, 'N: single OpenAI attempt');
    restoreHttps();
  }

  // ── O. Provider neutrality: no OpenAI key configured → no fallback attempted ──
  {
    delete process.env.OPENAI_API_KEY;
    const counts = mockProviders({
      'api.anthropic.com': { type: 'httpError', status: 429, message: 'Rate limit exceeded' },
    });
    const aiService = freshAiService();
    let threw = false;
    try {
      await aiService.generateContent('prompt', 'worksheet');
    } catch {
      threw = true;
    }
    assert(threw, 'O: without OPENAI_API_KEY configured, eligible failure still throws (no backup available)');
    assert((counts['api.openai.com'] || 0) === 0, 'O: OpenAI never attempted when not configured');
    process.env.OPENAI_API_KEY = 'test-openai-key';
    restoreHttps();
  }

  // ── P. Anthropic + OpenAI eligible failure → Gemini success (3-provider chain) ──
  {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    const counts = mockProviders({
      'api.anthropic.com': { type: 'httpError', status: 429, message: 'Rate limit exceeded' },
      'api.openai.com': { type: 'httpError', status: 503, message: 'OpenAI also unavailable' },
      'generativelanguage.googleapis.com': { type: 'success', text: 'gemini backup content' },
    });
    const aiService = freshAiService();
    const result = await aiService.generateContent('prompt', 'worksheet');
    assert(result === 'gemini backup content', 'P: Anthropic+OpenAI failure falls back to Gemini content');
    assert(counts['api.anthropic.com'] === 1, 'P: Anthropic attempted once');
    assert(counts['api.openai.com'] === 1, 'P: OpenAI attempted once');
    assert(counts['generativelanguage.googleapis.com'] === 1, 'P: Gemini attempted exactly once');
    restoreHttps();
  }

  // ── Q. All three providers fail → exactly 3 attempts, no loop, no 4th attempt ──
  {
    const counts = mockProviders({
      'api.anthropic.com': { type: 'httpError', status: 500, message: 'Anthropic down' },
      'api.openai.com': { type: 'httpError', status: 429, message: 'OpenAI rate limited' },
      'generativelanguage.googleapis.com': { type: 'httpError', status: 503, message: 'Gemini down' },
    });
    const aiService = freshAiService();
    let threw = false;
    let errMessage = '';
    try {
      await aiService.generateContent('prompt', 'worksheet');
    } catch (err) {
      threw = true;
      errMessage = err.message;
    }
    assert(threw, 'Q: all three providers failing throws (final AI-unavailable path)');
    assert(counts['api.anthropic.com'] === 1, 'Q: Anthropic <= 1 attempt');
    assert(counts['api.openai.com'] === 1, 'Q: OpenAI <= 1 attempt');
    assert(counts['generativelanguage.googleapis.com'] === 1, 'Q: Gemini <= 1 attempt (no loop, no 4th attempt)');
    assert(/Gemini down/.test(errMessage), 'Q: the final (Gemini) provider error is what propagates');
    restoreHttps();
  }

  // ── R. Gemini 429 → no further attempt, final failure path ─────────────
  {
    const counts = mockProviders({
      'api.anthropic.com': { type: 'httpError', status: 429, message: 'Rate limit exceeded' },
      'api.openai.com': { type: 'httpError', status: 429, message: 'Rate limit exceeded' },
      'generativelanguage.googleapis.com': { type: 'httpError', status: 429, message: 'Gemini rate limited' },
    });
    const aiService = freshAiService();
    let threw = false;
    try { await aiService.generateContent('prompt', 'worksheet'); } catch { threw = true; }
    assert(threw, 'R: Gemini 429 still ends in final failure (no fourth provider to try)');
    assert(counts['generativelanguage.googleapis.com'] === 1, 'R: Gemini attempted exactly once');
    restoreHttps();
  }

  // ── S. Gemini 5xx → no further attempt, final failure path ─────────────
  {
    const counts = mockProviders({
      'api.anthropic.com': { type: 'httpError', status: 500, message: 'down' },
      'api.openai.com': { type: 'httpError', status: 500, message: 'down' },
      'generativelanguage.googleapis.com': { type: 'httpError', status: 503, message: 'Gemini overloaded' },
    });
    const aiService = freshAiService();
    let threw = false;
    try { await aiService.generateContent('prompt', 'worksheet'); } catch { threw = true; }
    assert(threw, 'S: Gemini 5xx still ends in final failure');
    assert(counts['generativelanguage.googleapis.com'] === 1, 'S: Gemini attempted exactly once');
    restoreHttps();
  }

  // ── T. Gemini timeout/network failure → final failure path, no loop ────
  {
    const timeoutCounts = mockProviders({
      'api.anthropic.com': { type: 'httpError', status: 429, message: 'Rate limit exceeded' },
      'api.openai.com': { type: 'httpError', status: 429, message: 'Rate limit exceeded' },
      'generativelanguage.googleapis.com': { type: 'timeout' },
    });
    let aiService = freshAiService();
    let threw = false;
    try { await aiService.generateContent('prompt', 'worksheet'); } catch { threw = true; }
    assert(threw, 'T: Gemini timeout ends in final failure');
    assert(timeoutCounts['generativelanguage.googleapis.com'] === 1, 'T: Gemini attempted exactly once on timeout');
    restoreHttps();

    const networkCounts = mockProviders({
      'api.anthropic.com': { type: 'httpError', status: 429, message: 'Rate limit exceeded' },
      'api.openai.com': { type: 'httpError', status: 429, message: 'Rate limit exceeded' },
      'generativelanguage.googleapis.com': { type: 'network', message: 'ECONNRESET' },
    });
    aiService = freshAiService();
    threw = false;
    try { await aiService.generateContent('prompt', 'worksheet'); } catch { threw = true; }
    assert(threw, 'T: Gemini network failure ends in final failure');
    assert(networkCounts['generativelanguage.googleapis.com'] === 1, 'T: Gemini attempted exactly once on network failure');
    restoreHttps();
  }

  // ── U. Gemini malformed response → classified as provider failure, final failure path ──
  {
    const counts = mockProviders({
      'api.anthropic.com': { type: 'httpError', status: 429, message: 'Rate limit exceeded' },
      'api.openai.com': { type: 'httpError', status: 429, message: 'Rate limit exceeded' },
      'generativelanguage.googleapis.com': { type: 'malformed' },
    });
    const aiService = freshAiService();
    let threw = false;
    try { await aiService.generateContent('prompt', 'worksheet'); } catch { threw = true; }
    assert(threw, 'U: Gemini malformed response ends in final failure');
    assert(counts['generativelanguage.googleapis.com'] === 1, 'U: Gemini attempted exactly once');
    restoreHttps();
  }

  // ── V. Maximum-attempt guarantee across the full chain ──────────────────
  {
    const counts = mockProviders({
      'api.anthropic.com': { type: 'httpError', status: 500, message: 'down' },
      'api.openai.com': { type: 'httpError', status: 500, message: 'down' },
      'generativelanguage.googleapis.com': { type: 'httpError', status: 500, message: 'down' },
    });
    const aiService = freshAiService();
    try { await aiService.generateContent('prompt', 'worksheet'); } catch { /* expected */ }
    assert(counts['api.anthropic.com'] <= 1, 'V: Anthropic attempts <= 1');
    assert(counts['api.openai.com'] <= 1, 'V: OpenAI attempts <= 1');
    assert(counts['generativelanguage.googleapis.com'] <= 1, 'V: Gemini attempts <= 1');
    restoreHttps();
  }

  // ── W. Provider-neutral output parity: Gemini success matches the same contract ──
  {
    const counts = mockProviders({
      'api.anthropic.com': { type: 'httpError', status: 429, message: 'Rate limit exceeded' },
      'api.openai.com': { type: 'httpError', status: 429, message: 'Rate limit exceeded' },
      'generativelanguage.googleapis.com': { type: 'success', text: 'a complete worksheet document from gemini' },
    });
    const aiService = freshAiService();
    const result = await aiService.generateContent('prompt', 'worksheet');
    assert(typeof result === 'string' && result.length > 0, 'W: Gemini fallback result is a non-empty string — identical Promise<string> contract, no provider-specific downstream shape');
    assert(counts['generativelanguage.googleapis.com'] === 1, 'W: single Gemini attempt');
    restoreHttps();
  }

  // ── X. Gemini not configured → chain stops at OpenAI, no crash ──────────
  {
    delete process.env.GEMINI_API_KEY;
    const counts = mockProviders({
      'api.anthropic.com': { type: 'httpError', status: 429, message: 'Rate limit exceeded' },
      'api.openai.com': { type: 'httpError', status: 429, message: 'Rate limit exceeded' },
    });
    const aiService = freshAiService();
    let threw = false;
    try { await aiService.generateContent('prompt', 'worksheet'); } catch { threw = true; }
    assert(threw, 'X: without GEMINI_API_KEY, chain stops after OpenAI (no crash, no Gemini attempt)');
    assert((counts['generativelanguage.googleapis.com'] || 0) === 0, 'X: Gemini never attempted when not configured');
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    restoreHttps();
  }

  // ── Y. Gemini authentication: key sent via x-goog-api-key header, never in URL ──
  {
    let capturedPath = null;
    let capturedHeaders = null;

    mockProviders({
      'api.anthropic.com': { type: 'httpError', status: 429, message: 'Rate limit exceeded' },
      'api.openai.com': { type: 'httpError', status: 429, message: 'Rate limit exceeded' },
      'generativelanguage.googleapis.com': { type: 'success', text: 'gemini via header auth' },
    });
    // Wrap the mock (installed by mockProviders) to inspect the exact
    // options passed to https.request for the Gemini call, without
    // changing its response behavior.
    const underlyingMock = https.request;
    https.request = function inspectingRequest(options, callback) {
      if (options.hostname === 'generativelanguage.googleapis.com') {
        capturedPath = options.path;
        capturedHeaders = options.headers;
      }
      return underlyingMock(options, callback);
    };

    const aiService = freshAiService();
    const result = await aiService.generateContent('prompt', 'worksheet');

    assert(result === 'gemini via header auth', 'Y: Gemini request still succeeds after switching to header auth');
    assert(capturedPath === '/v1beta/models/gemini-3.6-flash:generateContent', 'Y: request path has no query string / no key in URL');
    assert(!/key=/.test(capturedPath || ''), 'Y: URL does not contain "key=" anywhere');
    assert(!(capturedPath || '').includes('test-gemini-key'), 'Y: URL does not contain the literal Gemini key');
    assert(capturedHeaders && capturedHeaders['x-goog-api-key'] === 'test-gemini-key', 'Y: key is sent via x-goog-api-key header');
    restoreHttps();
  }

  // ── Z. Gemini key never appears in a thrown error message ───────────────
  {
    const counts = mockProviders({
      'api.anthropic.com': { type: 'httpError', status: 429, message: 'Rate limit exceeded' },
      'api.openai.com': { type: 'httpError', status: 429, message: 'Rate limit exceeded' },
      'generativelanguage.googleapis.com': { type: 'httpError', status: 500, message: 'Gemini internal error' },
    });
    const aiService = freshAiService();
    let errMessage = '';
    try {
      await aiService.generateContent('prompt', 'worksheet');
    } catch (err) {
      errMessage = err.message;
    }
    assert(!errMessage.includes('test-gemini-key'), 'Z: thrown error message never contains the Gemini API key');
    assert(!/key=/.test(errMessage), 'Z: thrown error message contains no "key=" fragment');
    restoreHttps();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  restoreHttps();
  console.error('Test harness error:', err);
  process.exit(1);
});
