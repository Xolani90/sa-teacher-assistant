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
 *   deleteExpiredCodes()→ physical-deletion cleanup of old rows for one
 *                         phone_hash. RC1-H-003: no longer called from
 *                         the request-code hot path (routes/auth.js) —
 *                         whatsapp_delivery_events references auth_codes
 *                         by FK with no ON DELETE clause, so deleting a
 *                         row with delivery history caused a 500.
 *                         generateAuthCodeTransactionally()'s supersession
 *                         step now retires old rows (active or expired)
 *                         instead. This function is left defined but
 *                         unused/uncalled in production — retained in
 *                         case a future, deliberately-scoped retention/
 *                         archival decision (see RC2 Backlog) needs it.
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
      `SELECT id, phone_hash, code_hash, expires_at, attempts, consumed_at, superseded_at, created_at
       FROM auth_codes
       WHERE phone_hash = ?
         AND consumed_at IS NULL
         AND expires_at > datetime('now')
         AND superseded_at IS NULL
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
    supersededAt: row.superseded_at,
    createdAt: row.created_at,
  };
}

/**
 * Generates a new OTP for a phone as a single atomic transaction
 * (ADR-XXX §3.1): retires (supersedes) the phone's previous non-consumed
 * OTP row — whether still active or already expired (RC1-H-003 broadened
 * this from "previously active" to also cover already-expired rows, so
 * that OTP generation itself vacates idx_auth_codes_active_backstop
 * instead of relying on physical deletion; see the supersession UPDATE
 * below for the full rationale) — inserts the new row, and starts the
 * resend cooldown, all-or-nothing.
 *
 * Delivery must NOT be attempted inside this function or its caller's
 * transaction scope — this function only covers generation (§3.1's
 * "everything up to and including transaction commit"). The caller
 * attempts delivery only after this function returns successfully.
 *
 * Does not itself check lockout/cooldown eligibility — the caller
 * (routes/auth.js) must call isLockedOut()/isInCooldown() first and only
 * invoke this function when both checks pass, so that lockout takes
 * precedence over cooldown per §4.3.
 *
 * @param {string} phoneHash
 * @param {string} codeHash
 * @param {string} expiresAt - SQLite datetime string
 * @param {number} cooldownSeconds - length of the resend cooldown to start (§4.3)
 * @returns {{id: number, cooldownUntil: string}}
 */
function generateAuthCodeTransactionally(phoneHash, codeHash, expiresAt, cooldownSeconds = 60) {
  if (!phoneHash || typeof phoneHash !== 'string') {
    throw new Error('generateAuthCodeTransactionally: phoneHash is required');
  }
  if (!codeHash || typeof codeHash !== 'string') {
    throw new Error('generateAuthCodeTransactionally: codeHash is required');
  }
  if (!expiresAt || typeof expiresAt !== 'string') {
    throw new Error('generateAuthCodeTransactionally: expiresAt is required');
  }

  const db = getDb();

  // Manual BEGIN/COMMIT/ROLLBACK, not db.transaction() — compatibility
  // with both better-sqlite3 (production) and the node:sqlite test shim,
  // matching the convention already used in observationRepository.js and
  // blueprintRepository.js.
  try {
    db.prepare('BEGIN').run();

    // Retire (supersede) the previous OTP for this phone, if any (§3.1:
    // "a new OTP invalidates the previous active OTP"), whether that row
    // was still active or had already expired.
    //
    // RC1-H-003: this WHERE clause was originally `consumed_at IS NULL
    // AND expires_at > datetime('now') AND superseded_at IS NULL` — i.e.
    // it only ever superseded a row getActiveAuthCode() would still treat
    // as active, and deliberately left already-expired rows untouched
    // (relying on a separate deleteExpiredCodes() call in routes/auth.js
    // to physically delete them before this INSERT ran). That deletion
    // was removed because whatsapp_delivery_events references auth_codes
    // by FK with no ON DELETE clause, so deleting a row with delivery
    // history caused a 500. Removing the deletion without a replacement
    // left an expired-but-not-yet-superseded row occupying the one slot
    // idx_auth_codes_active_backstop allows per phone_hash, so the INSERT
    // below then failed with a UNIQUE constraint violation instead.
    //
    // The fix: broaden this clause to also retire an already-expired,
    // not-yet-superseded row, not only a still-active one. This makes
    // OTP generation itself responsible for vacating the backstop slot.
    // superseded_at's meaning is correspondingly widened from "an active
    // OTP was replaced by a newer OTP" to "an OTP ceased to be eligible
    // as the current OTP because a newer OTP generation retired it,
    // whether or not it had already expired." This is a strict, additive
    // broadening: every row that was superseded under the old clause is
    // still superseded for the same reason under this one; the only
    // change is that expired rows are no longer skipped. Confirmed (2026-
    // 08-12 read-only analysis) that no other code reads superseded_at to
    // distinguish these two cases — getActiveAuthCode() independently
    // requires expires_at > datetime('now'), so an expired row is already
    // excluded from "active" regardless of superseded_at; consumeAuthCode(),
    // lockout, and cooldown never read or write this column at all.
    db.prepare(
      `UPDATE auth_codes
       SET superseded_at = datetime('now')
       WHERE phone_hash = ?
         AND consumed_at IS NULL
         AND superseded_at IS NULL`
    ).run(phoneHash);

    const insertResult = db
      .prepare(
        `INSERT INTO auth_codes (phone_hash, code_hash, expires_at, attempts, consumed_at, superseded_at)
         VALUES (?, ?, ?, 0, NULL, NULL)`
      )
      .run(phoneHash, codeHash, expiresAt);

    const cooldownUntil = db
      .prepare(`SELECT datetime('now', '+${cooldownSeconds} seconds') AS ts`)
      .get().ts;

    // Cooldown start is defined as the commit timestamp of THIS
    // transaction (§4.3), independent of delivery outcome — set here,
    // inside the same transaction as generation, not after a delivery
    // attempt that hasn't happened yet.
    upsertPhoneState(db, phoneHash, { cooldownUntil });

    db.prepare('COMMIT').run();

    return { id: Number(insertResult.lastInsertRowid), cooldownUntil };
  } catch (txErr) {
    try { db.prepare('ROLLBACK').run(); } catch (_) { /* best-effort */ }
    throw txErr;
  }
}

/**
 * Internal helper: insert-or-update a phone's auth_phone_state row,
 * merging only the fields provided. Used inside generateAuthCodeTransactionally()
 * (must run on the same `db` handle so it participates in the open
 * transaction) and by the standalone phone-state functions below.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} phoneHash
 * @param {{failedAttempts?: number, lockoutUntil?: string|null, cooldownUntil?: string|null}} fields
 */
function upsertPhoneState(db, phoneHash, fields) {
  const existing = db
    .prepare(`SELECT id FROM auth_phone_state WHERE phone_hash = ?`)
    .get(phoneHash);

  if (!existing) {
    db.prepare(
      `INSERT INTO auth_phone_state (phone_hash, failed_attempts, lockout_until, cooldown_until, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    ).run(
      phoneHash,
      fields.failedAttempts ?? 0,
      fields.lockoutUntil ?? null,
      fields.cooldownUntil ?? null
    );
    return;
  }

  const sets = ['updated_at = datetime(\'now\')'];
  const params = [];
  if ('failedAttempts' in fields) { sets.push('failed_attempts = ?'); params.push(fields.failedAttempts); }
  if ('lockoutUntil' in fields) { sets.push('lockout_until = ?'); params.push(fields.lockoutUntil); }
  if ('cooldownUntil' in fields) { sets.push('cooldown_until = ?'); params.push(fields.cooldownUntil); }
  params.push(phoneHash);

  db.prepare(`UPDATE auth_phone_state SET ${sets.join(', ')} WHERE phone_hash = ?`).run(...params);
}

/**
 * Reads a phone's authentication state. Returns a default (all-clear)
 * shape if no row exists yet — a phone with no prior auth activity is
 * neither locked out nor in cooldown.
 *
 * @param {string} phoneHash
 * @returns {{failedAttempts:number, lockoutUntil:string|null, cooldownUntil:string|null}}
 */
function getPhoneAuthState(phoneHash) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT failed_attempts AS failedAttempts, lockout_until AS lockoutUntil, cooldown_until AS cooldownUntil
       FROM auth_phone_state WHERE phone_hash = ?`
    )
    .get(phoneHash);

  return row || { failedAttempts: 0, lockoutUntil: null, cooldownUntil: null };
}

/**
 * Whether the phone is currently locked out (§4.1). Lockout expiry is a
 * full reset (not decay) — if the stored lockout_until has passed, this
 * ALSO clears lockout_until and resets failed_attempts to 0 as a side
 * effect, matching §4.1's explicit "lockout expiry resets the
 * failed-attempt counter to zero" rule, so a caller never observes a
 * stale non-zero counter after lockout has naturally expired.
 *
 * @param {string} phoneHash
 * @returns {boolean}
 */
function isLockedOut(phoneHash) {
  const db = getDb();
  const row = db
    .prepare(`SELECT lockout_until AS lockoutUntil FROM auth_phone_state WHERE phone_hash = ?`)
    .get(phoneHash);

  if (!row || !row.lockoutUntil) return false;

  const check = db
    .prepare(`SELECT (datetime('now') < ?) AS locked`)
    .get(row.lockoutUntil);

  if (check.locked) return true;

  // Lockout has expired — full reset per §4.1.
  upsertPhoneState(db, phoneHash, { failedAttempts: 0, lockoutUntil: null });
  return false;
}

/**
 * Whether the phone is currently within the 60-second resend cooldown
 * (§4.3). Independent of lockout — callers must check isLockedOut() too;
 * lockout takes precedence over cooldown (§4.3).
 *
 * @param {string} phoneHash
 * @returns {boolean}
 */
function isInCooldown(phoneHash) {
  const db = getDb();
  const row = db
    .prepare(`SELECT cooldown_until AS cooldownUntil FROM auth_phone_state WHERE phone_hash = ?`)
    .get(phoneHash);

  if (!row || !row.cooldownUntil) return false;

  const check = db.prepare(`SELECT (datetime('now') < ?) AS inCooldown`).get(row.cooldownUntil);
  return !!check.inCooldown;
}

/**
 * Records a failed verification attempt for a phone (§4.1/§4.2 — the
 * SOLE authoritative counter). At the 5th failure, activates a 15-minute
 * lockout. Not reset by requesting a new OTP (this function is only
 * called from the verify path, never from generation).
 *
 * @param {string} phoneHash
 * @param {number} [maxAttempts=5]
 * @param {number} [lockoutMinutes=15]
 * @returns {{failedAttempts: number, lockedOut: boolean}}
 */
function recordFailedAttempt(phoneHash, maxAttempts = 5, lockoutMinutes = 15) {
  const db = getDb();
  const current = getPhoneAuthState(phoneHash);
  const newCount = current.failedAttempts + 1;

  if (newCount >= maxAttempts) {
    const lockoutUntil = db
      .prepare(`SELECT datetime('now', '+${lockoutMinutes} minutes') AS ts`)
      .get().ts;
    upsertPhoneState(db, phoneHash, { failedAttempts: newCount, lockoutUntil });
    return { failedAttempts: newCount, lockedOut: true };
  }

  upsertPhoneState(db, phoneHash, { failedAttempts: newCount });
  return { failedAttempts: newCount, lockedOut: false };
}

/**
 * Resets a phone's failed-attempt counter and clears lockout on
 * successful verification (§4.1's "successful-verification rule" — the
 * entire rule, no other state to touch).
 *
 * @param {string} phoneHash
 */
function resetPhoneAuthState(phoneHash) {
  const db = getDb();
  upsertPhoneState(db, phoneHash, { failedAttempts: 0, lockoutUntil: null });
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
  generateAuthCodeTransactionally,
  getPhoneAuthState,
  isLockedOut,
  isInCooldown,
  recordFailedAttempt,
  resetPhoneAuthState,
};
