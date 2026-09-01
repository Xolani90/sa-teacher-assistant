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

// Periodic cleanup: every 60 seconds, delete expired entries.
// .unref() so this module-scope timer (which starts the moment anything
// requires this file) never by itself keeps a process alive — e.g. a
// script or test that requires server.js transitively requires this file
// and would otherwise hang after its own work is done.
setInterval(() => {
  const now = Date.now();
  for (const [id, expiresAt] of cache) {
    if (expiresAt <= now) {
      cache.delete(id);
    }
  }
}, 60 * 1000).unref();

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

  // If the cache is still over capacity after purging expired entries (e.g. a
  // sustained burst of unique messages within the TTL window), evict the
  // oldest entries by insertion order until back under MAX_ENTRIES. Map
  // iteration order is insertion order, so this is a correct oldest-first
  // eviction with no extra bookkeeping.
  while (cache.size > MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
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
