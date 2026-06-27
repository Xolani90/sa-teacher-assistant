'use strict';

/**
 * Persistent multi-turn session store backed by SQLite.
 *
 * Replaces the five in-memory Maps in webhook.js so that active conversations
 * survive process restarts and Render deploys.  Each Map becomes a
 * SessionStore instance with the same .get() / .set() / .delete() interface,
 * so call-sites in webhook.js require no structural changes — just swap the
 * constructor.
 *
 * TTL is enforced on read (stale sessions are treated as absent and deleted)
 * and via a periodic cleanup sweep so the table never grows unbounded.
 *
 * Serialisation: state objects are JSON-encoded.  The `lastActivity` field
 * (Unix ms timestamp) that each flow already stores is used as the TTL
 * anchor — no separate column required.
 */

const { getDb } = require('./database');

// Housekeeping: remove sessions untouched for more than 2 hours, regardless
// of per-session TTL.  Runs once per process at startup, then hourly.
const GLOBAL_TTL_MS = 2 * 60 * 60 * 1000;

function pruneExpiredSessions() {
  try {
    const cutoff = Date.now() - GLOBAL_TTL_MS;
    const { changes } = getDb()
      .prepare(`DELETE FROM sessions WHERE updated_at < ?`)
      .run(cutoff);
    if (changes > 0) {
      console.log(`[SESSION] Pruned ${changes} expired session(s)`);
    }
  } catch (err) {
    console.error('[SESSION] Prune error:', err.message);
  }
}

pruneExpiredSessions();
setInterval(pruneExpiredSessions, 60 * 60 * 1000);

/**
 * A persistent Map-like session store for a single session type
 * (e.g. 'reportComment', 'parentMessage', …).
 *
 * @param {string} sessionType - Unique key scoping this store in the DB.
 * @param {number} ttlMs       - Per-session TTL in milliseconds (default: 30 min).
 */
class SessionStore {
  constructor(sessionType, ttlMs = 30 * 60 * 1000) {
    this.type  = sessionType;
    this.ttlMs = ttlMs;
  }

  /**
   * Returns the session state for phoneHash, or undefined if absent / expired.
   * Expired sessions are deleted from the DB on read.
   *
   * @param {string} phoneHash
   * @returns {object|undefined}
   */
  get(phoneHash) {
    try {
      const row = getDb()
        .prepare(`SELECT state, updated_at FROM sessions WHERE phone_hash = ? AND session_type = ?`)
        .get(phoneHash, this.type);

      if (!row) return undefined;

      const state = JSON.parse(row.state);

      // Honour per-session TTL (the flow stores lastActivity in the state blob)
      const lastActivity = state.lastActivity ?? row.updated_at;
      if (Date.now() - lastActivity > this.ttlMs) {
        this.delete(phoneHash);
        return undefined;
      }

      return state;
    } catch (err) {
      console.error(`[SESSION:${this.type}] get error for ${phoneHash.slice(-8)}:`, err.message);
      return undefined;
    }
  }

  /**
   * Upserts session state for phoneHash.
   *
   * @param {string} phoneHash
   * @param {object} state
   */
  set(phoneHash, state) {
    try {
      getDb()
        .prepare(`
          INSERT INTO sessions (phone_hash, session_type, state, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(phone_hash, session_type) DO UPDATE
          SET state = excluded.state, updated_at = excluded.updated_at
        `)
        .run(phoneHash, this.type, JSON.stringify(state), Date.now());
    } catch (err) {
      console.error(`[SESSION:${this.type}] set error for ${phoneHash.slice(-8)}:`, err.message);
    }
  }

  /**
   * Removes the session for phoneHash.
   *
   * @param {string} phoneHash
   */
  delete(phoneHash) {
    try {
      getDb()
        .prepare(`DELETE FROM sessions WHERE phone_hash = ? AND session_type = ?`)
        .run(phoneHash, this.type);
    } catch (err) {
      console.error(`[SESSION:${this.type}] delete error for ${phoneHash.slice(-8)}:`, err.message);
    }
  }

  /**
   * Removes ALL sessions of this type for phoneHash.
   * Matches the clearAllSessions() pattern in webhook.js.
   *
   * @param {string} phoneHash
   */
  deleteAll(phoneHash) {
    this.delete(phoneHash);
  }
}

/**
 * Deletes every session (across all types) for a phone hash.
 * Used by clearAllSessions() in webhook.js (triggered by STOP command).
 *
 * @param {string} phoneHash
 */
function clearAllSessionsForHash(phoneHash) {
  try {
    getDb()
      .prepare(`DELETE FROM sessions WHERE phone_hash = ?`)
      .run(phoneHash);
  } catch (err) {
    console.error(`[SESSION] clearAll error for ${phoneHash.slice(-8)}:`, err.message);
  }
}

module.exports = { SessionStore, clearAllSessionsForHash };
