'use strict';

/**
 * In-memory message deduplication cache.
 *
 * WhatsApp Cloud API can deliver the same message more than once if your webhook
 * is slow to respond (Meta retries on timeout or 5xx). Without dedup, a teacher
 * gets duplicate AI responses and you pay twice for the same AI call.
 *
 * We store the last N message IDs with a TTL. An in-memory Map is sufficient
 * for MVP (single process). When you move to multiple dynos, replace this with
 * a Redis SET with TTL — the interface stays identical.
 *
 * Storage: ~100 bytes per entry × 1000 entries = ~100KB — negligible.
 */

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES = 1000;

// Map<messageId, expiresAt>
const cache = new Map();

// Periodic cleanup: every 60 seconds, delete expired entries
setInterval(() => {
  const now = Date.now();
  for (const [id, expiresAt] of cache) {
    if (expiresAt <= now) {
      cache.delete(id);
    }
  }
}, 60 * 1000);

/**
 * Returns true if this message ID has been seen before (duplicate).
 * Returns false and records the ID if it's new.
 *
 * @param {string} messageId - WhatsApp message ID (e.g. "wamid.xxx")
 * @returns {boolean} true = duplicate, skip processing
 */
function isDuplicate(messageId) {
  if (!messageId) return false;

  const now = Date.now();

  // Purge expired entries periodically to prevent memory leak
  if (cache.size > MAX_ENTRIES) {
    for (const [id, expiresAt] of cache) {
      if (expiresAt <= now) cache.delete(id);
    }
  }

  if (cache.has(messageId)) {
    // Check if still within TTL
    if (cache.get(messageId) > now) {
      return true; // Duplicate — already processed
    }
    // Expired — treat as new
  }

  cache.set(messageId, now + CACHE_TTL_MS);
  return false;
}

module.exports = { isDuplicate };