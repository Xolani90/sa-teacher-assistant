'use strict';

/**
 * Zero-capital AI fallback decision layer.
 *
 * services/aiService.js remains the sole AI abstraction and the sole place
 * that talks to a provider. This module adds no second provider, no local
 * model, and no new network call. It only classifies errors that
 * generateContent()/generateWithVision() already throw, so callers can
 * tell "no provider configured at all" (retrying is pointless) apart from
 * "the provider had a transient problem" (retrying may work) and give the
 * teacher a truthful message instead of always saying "please try again."
 */

const { isCeilingReached } = require('../utils/aiCostMonitor');

const AI_AVAILABLE = 'AI_AVAILABLE';
const AI_UNAVAILABLE = 'AI_UNAVAILABLE';
const AI_DEGRADED = 'AI_DEGRADED';

/**
 * Non-throwing check for whether a provider is configured at all. Mirrors
 * aiService.js's detectProvider() precedence (Anthropic first, then
 * OpenAI) without duplicating provider-selection logic or throwing.
 */
function isProviderConfigured() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
}

/**
 * Point-in-time AI capability status. AI_DEGRADED reflects the existing
 * daily cost ceiling (utils/aiCostMonitor.js). Today that ceiling does not
 * block generateContent() calls at all — it only logs/alerts and is used
 * by services/intentClassifier.js to fall back to the regex parser for
 * intent detection. AI_DEGRADED here is informational/status-only; this
 * module does not use it to change generation behavior.
 */
function getAiStatus() {
  if (!isProviderConfigured()) {
    return { status: AI_UNAVAILABLE, reason: 'no_api_key' };
  }
  if (isCeilingReached()) {
    return { status: AI_DEGRADED, reason: 'daily_cost_ceiling_reached' };
  }
  return { status: AI_AVAILABLE, reason: null };
}

// HTTP 400 is only ever a fallback-eligible provider failure when the
// message clearly identifies provider-side credit/quota/billing exhaustion
// (e.g. Anthropic's "Your credit balance is too low..."). A generic/other
// 400 — malformed request, invalid parameter, application-level mistake —
// must stay classified as 'unknown' (not fallback-eligible) so a bug in
// our own request never silently masks itself as a provider outage.
const CREDIT_EXHAUSTION_400_PATTERN =
  /credit balance is too low|insufficient credit|insufficient quota|quota exceeded|quota exhausted|billing.{0,20}(balance|exhaust)|out of credits|purchase credits|usage limit reached/i;

/**
 * Classifies a rejection from generateContent()/generateWithVision() using
 * the actual error strings services/aiService.js throws today (detectProvider(),
 * httpsPost(), generateWithAnthropic/OpenAI). No new error shapes invented.
 *
 * @param {Error|string} err
 * @returns {'missing_key'|'auth_failed'|'rate_limited'|'provider_error'|'timeout'|'network'|'malformed_response'|'credit_exhausted'|'unknown'}
 */
function classifyAiError(err) {
  const msg = String((err && err.message) || err || '');
  if (/No AI API key found/i.test(msg)) return 'missing_key';
  if (/API (401|403):/i.test(msg)) return 'auth_failed';
  if (/API 429:/i.test(msg)) return 'rate_limited';
  if (/API (500|502|503|504):/i.test(msg)) return 'provider_error';
  if (/timed out/i.test(msg)) return 'timeout';
  if (/Network error/i.test(msg)) return 'network';
  if (/Empty response|Failed to parse API response/i.test(msg)) return 'malformed_response';
  // Checked after the specific 401/403/429/5xx checks above, and only
  // matches 400 responses whose message explicitly names a credit/quota/
  // billing exhaustion condition — never a bare "API 400:".
  if (/API 400:/i.test(msg) && CREDIT_EXHAUSTION_400_PATTERN.test(msg)) return 'credit_exhausted';
  return 'unknown';
}

// Categories that represent the *provider* being unavailable — worth
// attempting a different provider for. Deliberately excludes auth_failed
// (a bad/revoked key won't be fixed by switching providers' request, and
// re-sending the same-shaped request to a second provider on an auth error
// risks masking a real credential problem), missing_key (no provider
// configured — nothing to fail over from), and unknown (generic/invalid
// request or application error — switching providers wouldn't help and
// could mask a real bug).
const FALLBACK_ELIGIBLE_CATEGORIES = new Set([
  'rate_limited',
  'provider_error',
  'timeout',
  'network',
  'malformed_response',
  'credit_exhausted',
]);

/**
 * True when a classified error category represents a provider-availability
 * failure worth attempting a backup provider for, per FALLBACK_ELIGIBLE_CATEGORIES.
 *
 * @param {string} category - result of classifyAiError()
 * @returns {boolean}
 */
function isFallbackEligible(category) {
  return FALLBACK_ELIGIBLE_CATEGORIES.has(category);
}

/**
 * True only when telling the teacher "please try again" would be actively
 * misleading — i.e. no configuration exists for a retry to ever succeed
 * against. Every other category is genuinely worth retrying and keeps the
 * caller's existing copy unchanged.
 */
function isRetryPointless(category) {
  return category === 'missing_key';
}

// Only capabilities genuinely reachable today without an AI call — never a
// claim that every feature works without AI.
const DETERMINISTIC_ALTERNATIVES = [
  'Reply *MENU* to see everything that still works without AI (classes, rosters, saved resources, mark capture, blueprint printing).',
  'Reply *NEW TEST* to capture marks and get real item/error analysis — no AI involved.',
  'Reply *PRINT* to print an existing blueprint question paper.',
  'Reply *MY RESOURCES* to reopen anything you already generated and saved.',
  'Reply *CLASS INTERVENTION* for a data-driven intervention overview from marks already captured.',
];

/**
 * Teacher-facing message for a genuinely pointless-to-retry AI failure
 * (currently: no provider configured). Truthful about what just failed and
 * what still works — never claims AI succeeded, never claims every feature
 * works without AI.
 */
function buildAiUnavailableMessage() {
  const list = DETERMINISTIC_ALTERNATIVES.map((line, i) => `${i + 1}. ${line}`).join('\n');
  return (
    `⚠️ AI generation is currently unavailable because the AI service isn't configured, so I can't create new AI content right now.\n\n` +
    `You can still:\n${list}\n\n` +
    `Nothing you've already saved is affected.`
  );
}

/**
 * Given a caught generateContent()/generateWithVision() error, returns the
 * teacher-facing message a caller should send: the caller's existing
 * transient "please try again" copy for anything genuinely worth retrying,
 * or the truthful unavailable-with-alternatives message when a retry could
 * never succeed. Callers keep their own rollbackUsage() and state handling
 * unchanged — this only decides the message text.
 *
 * @param {Error} err
 * @param {string} defaultMessage - existing transient-failure copy to use
 *   when the failure is worth retrying.
 */
function getAiFailureMessage(err, defaultMessage) {
  const category = classifyAiError(err);
  return isRetryPointless(category) ? buildAiUnavailableMessage() : defaultMessage;
}

module.exports = {
  AI_AVAILABLE,
  AI_UNAVAILABLE,
  AI_DEGRADED,
  isProviderConfigured,
  getAiStatus,
  classifyAiError,
  isFallbackEligible,
  isRetryPointless,
  buildAiUnavailableMessage,
  getAiFailureMessage,
};
