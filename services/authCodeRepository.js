'use strict';

/**
 * WhatsApp OTP auth-code repository (ADR-008 PR22A).
 *
 * Persistence layer over auth_codes (Migration 032). Mirrors
 * blueprintRepository.js / observationRepository.js's shape: plain
 * prepared statements, no db.transaction() (compatibility with both
 * better-sqlite3 in production and the node:sqlite test shim used
 * elsewhere in this suite).
 *
 * Scope note: this is a pure persistence layer. It does NOT:
 *   - generate the 6-digit code itself, or decide delivery (sendMessage())
 *     — that's routes/auth.js's job (PR22B).
 *   - hash the code — callers pass in an already-computed codeHash
 *     (HMAC-SHA256 of the code, keyed with a server secret). This keeps
 *     the repository agnostic to which secret/algorithm is used, same
 *     as hashPhone() living in utils/usageTracker.js rather than here.
 *   - enforce a max-attempts cutoff — incrementAttempts() only records
 *     the count; the caller (PR22B) decides when that count is too high
 *     and forces a fresh code request.
 *
 * Lifecycle:
 *   createAuthCode()    → insert a fresh row, phone_hash + code_hash +
 *                         expires_at, attempts=0, consumed_at=NULL.
 *   getActiveAuthCode() → the most recent NOT-expired, NOT-yet-consumed
 *                         row for a phone_hash. "Active" = both
 *                         consumed_at IS NULL and expires_at is still in
 *                         the future, checked directly in SQL via
 *                         datetime('now') (no JS Date/timezone parsing,
 *                         consistent with other time-sensitive queries
 *                         in this codebase — see utils/dateUtils.js's
 *                         parseSqliteUtc() bug history for why that
 *                         matters).
 *   incrementAttempts() → bump attempts by 1 for a given row id.
 *   consumeAuthCode()   → set consumed_at, making the code single-use.
 *                         A no-op (returns false) if the row is already
 *                         consumed or does not exist, so callers can't
 *                         double-consume via a race.
 *   deleteExpiredCodes()→ opportunistic cleanup of old rows for one
 *                         phone_hash, mirroring rate_limit_events'
 *                         inline-cleanup-on-write pattern (Migration
 *                         023) rather than a separate cron job.
 *
 * See: utils/database.js Migration 032, routes/auth.js (PR22B).
 */

const { getDb } = require('../utils/database');

/**
 * Inserts a new auth code row.
 *
 * @param {string} phoneHash
 * @param {string} codeHash - HMAC-SHA256(code, secret), computed by the caller.
 * @param {string} expiresAt - SQLite datetime string (e.g. via
 *   `datetime('now', '+5 minutes')` computed by the caller, or an
 *   ISO-ish `YYYY-MM-DD HH:MM:SS` string) marking when this code expires.
 * @returns {{id: number}}
 */
function createAuthCode(phoneHash, codeHash, expiresAt) {
  if (!phoneHash || typeof phoneHash !== 'string') {
    throw new Error('createAuthCode: phoneHash is required');
  }
  if (!codeHash || typeof codeHash !== 'string') {
    throw new Error('createAuthCode: codeHash is required');
  }
  if (!expiresAt || typeof expiresAt !== 'string') {
    throw new Error('createAuthCode: expiresAt is required');
  }

  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO auth_codes (phone_hash, code_hash, expires_at, attempts, consumed_at)
       VALUES (?, ?, ?, 0, NULL)`
    )
    .run(phoneHash, codeHash, expiresAt);

  return { id: Number(result.lastInsertRowid) };
}

/**
 * Returns the most recent still-active (unexpired, unconsumed) auth
 * code row for a phone_hash, or null if none exists.
 *
 * @param {string} phoneHash
 * @returns {{id:number, phoneHash:string, codeHash:string, expiresAt:string,
 *            attempts:number, consumedAt:string|null, createdAt:string}|null}
 */
function getActiveAuthCode(phoneHash) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, phone_hash, code_hash, expires_at, attempts, consumed_at, created_at
       FROM auth_codes
       WHERE phone_hash = ?
         AND consumed_at IS NULL
         AND expires_at > datetime('now')
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(phoneHash);

  if (!row) return null;

  return {
    id: row.id,
    phoneHash: row.phone_hash,
    codeHash: row.code_hash,
    expiresAt: row.expires_at,
    attempts: row.attempts,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
  };
}

/**
 * Increments the attempts counter for a given auth_codes row.
 *
 * @param {number} id
 * @returns {number} the new attempts count, or -1 if no row matched.
 */
function incrementAttempts(id) {
  const db = getDb();
  db.prepare(`UPDATE auth_codes SET attempts = attempts + 1 WHERE id = ?`).run(id);

  const row = db.prepare(`SELECT attempts FROM auth_codes WHERE id = ?`).get(id);
  return row ? row.attempts : -1;
}

/**
 * Marks an auth code as consumed (one-time-use / replay protection).
 * No-op if the row doesn't exist or is already consumed.
 *
 * @param {number} id
 * @returns {boolean} true if this call performed the consumption,
 *   false if the row was missing or already consumed.
 */
function consumeAuthCode(id) {
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE auth_codes SET consumed_at = datetime('now')
       WHERE id = ? AND consumed_at IS NULL`
    )
    .run(id);

  return result.changes > 0;
}

/**
 * Opportunistic cleanup: deletes expired rows for a single phone_hash.
 * Mirrors the rate_limit_events inline-cleanup-on-write pattern
 * (Migration 023) — called alongside createAuthCode() by the caller,
 * not on a separate schedule.
 *
 * @param {string} phoneHash
 * @returns {number} number of rows deleted.
 */
function deleteExpiredCodes(phoneHash) {
  const db = getDb();
  const result = db
    .prepare(
      `DELETE FROM auth_codes
       WHERE phone_hash = ?
         AND (expires_at <= datetime('now') OR consumed_at IS NOT NULL)`
    )
    .run(phoneHash);

  return result.changes;
}

module.exports = {
  createAuthCode,
  getActiveAuthCode,
  incrementAttempts,
  consumeAuthCode,
  deleteExpiredCodes,
};
