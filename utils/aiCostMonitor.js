'use strict';

/**
 * Lightweight AI cost monitor.
 *
 * Tracks AI call counts per intent type in memory with daily rollover.
 * Does NOT persist across restarts (intentional — Render deploys reset it,
 * which is fine since we're watching for intraday spikes, not monthly totals).
 *
 * Emits structured log lines at two thresholds:
 *   WARN_THRESHOLD  — advisory: call volume is higher than typical
 *   HARD_CEILING    — critical: something may be wrong (retry loop, abuse)
 *
 * Both thresholds default to env vars so they can be adjusted without a
 * deploy:
 *   AI_WARN_CALLS_PER_DAY   (default: 500)
 *   AI_CEILING_CALLS_PER_DAY (default: 2000)
 *
 * Optionally sends a WhatsApp alert to ADMIN_ALERT_PHONE when the hard
 * ceiling is first crossed. Only one alert fires per ceiling breach per
 * day, not one per call — no alert storm.
 */

// ── Thresholds ──────────────────────────────────────────────────────────────
const WARN_THRESHOLD = parseInt(process.env.AI_WARN_CALLS_PER_DAY  || '500',  10);
const HARD_CEILING   = parseInt(process.env.AI_CEILING_CALLS_PER_DAY || '2000', 10);

// ── State ───────────────────────────────────────────────────────────────────
// Key: intentType string. Value: count for today.
const dailyCounts  = new Map();
let   dayKey       = _todayKey();
let   ceilingAlertFired = false; // reset daily

function _todayKey() {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

/**
 * Rolls over the counters if we've crossed midnight since the last call.
 */
function _maybeRollover() {
  const today = _todayKey();
  if (today !== dayKey) {
    dailyCounts.clear();
    dayKey = today;
    ceilingAlertFired = false;
    console.log(`[AI-MONITOR] Daily rollover — counters reset for ${today}`);
  }
}

/**
 * Returns the total AI calls across all intent types today.
 */
function totalToday() {
  _maybeRollover();
  let total = 0;
  for (const count of dailyCounts.values()) total += count;
  return total;
}

/**
 * Records one AI call for the given intentType and checks thresholds.
 * Call this immediately before (or immediately after) each generateContent()
 * call — the exact position doesn't matter since we're tracking volume,
 * not billing precision.
 *
 * @param {string} intentType
 */
function recordCall(intentType) {
  _maybeRollover();
  const prev = dailyCounts.get(intentType) || 0;
  dailyCounts.set(intentType, prev + 1);

  const total = totalToday();

  // ── Structured log — always emitted so Render's log tail is searchable ──
  if (total % 100 === 0) {
    // Log a summary every 100 calls to keep noise low but progress visible
    const breakdown = [...dailyCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}:${v}`)
      .join(', ');
    console.log(`[AI-MONITOR] ${total} AI calls today (${dayKey}) — breakdown: ${breakdown}`);
  }

  if (total === WARN_THRESHOLD) {
    console.warn(`[AI-MONITOR] ⚠  WARNING: ${total} AI calls today (${dayKey}) — approaching ceiling of ${HARD_CEILING}. Check for unusual activity.`);
  }

  if (total >= HARD_CEILING && !ceilingAlertFired) {
    ceilingAlertFired = true;
    const msg = `[AI-MONITOR] 🚨 CEILING REACHED: ${total} AI calls today (${dayKey}) — ceiling is ${HARD_CEILING}. Bot continues with regex fallback for new classifier calls. Investigate immediately.`;
    console.error(msg);

    // Optional WhatsApp alert to admin — only fires once per day per ceiling breach
    const adminPhone = process.env.ADMIN_ALERT_PHONE;
    if (adminPhone) {
      // Lazy-require to avoid circular dep at module load time
      setImmediate(() => {
        try {
          const { sendMessage } = require('../services/whatsappService');
          sendMessage(adminPhone,
            `🚨 *SA Teacher Assistant — Cost Alert*\n\n` +
            `AI call ceiling reached: *${total} calls today* (ceiling: ${HARD_CEILING}).\n\n` +
            `The classifier has switched to regex fallback for new calls. Bot is still working — just less accurate on unusual phrasings.\n\n` +
            `Check Render logs for unusual patterns. Today: ${dayKey}.`
          ).catch(err => console.error('[AI-MONITOR] Failed to send admin alert:', err.message));
        } catch (err) {
          console.error('[AI-MONITOR] Failed to send admin alert:', err.message);
        }
      });
    }
  }
}

/**
 * Returns true if the daily ceiling has been reached.
 * Used by the classifier rate limiter to switch to regex when cost is too high.
 */
function isCeilingReached() {
  _maybeRollover();
  return totalToday() >= HARD_CEILING;
}

/**
 * Returns the current daily call breakdown as a plain object.
 * Exposed for the /admin/stats endpoint or debugging.
 */
function getStats() {
  _maybeRollover();
  return {
    date:    dayKey,
    total:   totalToday(),
    ceiling: HARD_CEILING,
    warn:    WARN_THRESHOLD,
    counts:  Object.fromEntries(dailyCounts),
  };
}

module.exports = { recordCall, isCeilingReached, getStats, totalToday };
