'use strict';

const crypto = require('crypto');
const { getDb } = require('./database');

/**
 * Returns the free limit from environment at call time.
 * This prevents divergence between enforcement and display when FREE_LIMIT is changed.
 *
 * @returns {number}
 */
function getFreeLimit() {
  const val = parseInt(process.env.FREE_LIMIT || '10', 10);
  if (isNaN(val) || val < 1) return 10;
  return Math.min(val, 1000);
}

/**
 * Hashes a phone number with HMAC-SHA256 before storage.
 * Phone numbers are PII — POPIA (South Africa) requires they be protected.
 * Hashing means even if the database is leaked, phone numbers cannot be recovered.
 *
 * @param {string} phone
 * @returns {string} hex hash
 */
function hashPhone(phone) {
  // Strip leading + so that "+27821234567" and "27821234567" hash to the same value.
  // Meta's Cloud API delivers phone numbers WITHOUT the + prefix in webhook payloads,
  // but callers like the admin grant-pro endpoint may include it. Normalizing here
  // means both sides always produce the same HMAC regardless of how the number arrived.
  const normalized = phone.trim().replace(/^\+/, '');
  return crypto
    .createHmac('sha256', process.env.PII_SECRET)
    .update(normalized)
    .digest('hex');
}

/**
 * Returns current month key like "2025-07".
 * @returns {string}
 */
function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Ensures a teacher record exists in the database.
 * Safe to call multiple times — uses INSERT OR IGNORE.
 *
 * @param {string} phoneHash
 */
function ensureTeacher(phoneHash) {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)
  `).run(phoneHash);
}

/**
 * Returns the teacher record for a given phone hash.
 * Returns null if not found.
 *
 * @param {string} phoneHash
 * @returns {{ phone_hash, name, grade, subject, is_pro, pro_expires } | null}
 */
function getTeacher(phoneHash) {
  return getDb().prepare(`
    SELECT * FROM teachers WHERE phone_hash = ?
  `).get(phoneHash) || null;
}

/**
 * Returns the teacher record for a raw phone number (hashes internally).
 *
 * @param {string} phone - Raw phone number
 * @returns {{ phone_hash, name, grade, subject, is_pro, pro_expires } | null}
 */
function getTeacherByPhone(phone) {
  return getTeacher(hashPhone(phone));
}

/**
 * Checks if a teacher's Pro subscription is still active.
 * Pro is active if: is_pro = 1 AND (pro_expires IS NULL OR pro_expires > today).
 *
 * @param {{ is_pro: number, pro_expires: string|null }} teacher
 * @returns {boolean}
 */
function isProActive(teacher) {
  if (!teacher || !teacher.is_pro) return false;
  if (!teacher.pro_expires) return true; // No expiry = permanent
  return new Date(teacher.pro_expires) > new Date();
}

/**
 * Read-only usage check — does NOT increment the counter.
 * Use this BEFORE the AI call; call incrementUsage() only on success.
 *
 * @param {string} phoneNumber
 * @returns {{ allowed: boolean, isPro: boolean, count: number, limit: number }}
 */
function checkUsageOnly(phoneNumber) {
  const db    = getDb();
  const hash  = hashPhone(phoneNumber);
  const month = currentMonthKey();

  ensureTeacher(hash);
  const teacher = getTeacher(hash);
  const isPro   = isProActive(teacher);

  if (isPro) {
    return { allowed: true, isPro: true, count: 0, limit: null };
  }

  const { count } = db.prepare(`
    SELECT COUNT(*) as count FROM usage_events
    WHERE phone_hash = ? AND month_key = ?
  `).get(hash, month);

  return {
    allowed: count < getFreeLimit(),
    isPro:   false,
    count,
    limit:   getFreeLimit(),
  };
}

/**
 * Increments usage after a SUCCESSFUL AI generation.
 * Must only be called after generateContent() resolves with real content.
 *
 * @param {string} phoneNumber
 * @param {string} intentType
 * @returns {{ isPro: boolean, usedCount: number, limit: number }}
 */
function incrementUsage(phoneNumber, intentType = 'unknown') {
  const db    = getDb();
  const hash  = hashPhone(phoneNumber);
  const month = currentMonthKey();

  ensureTeacher(hash);
  const teacher = getTeacher(hash);
  const isPro   = isProActive(teacher);

  db.prepare(`
    INSERT INTO usage_events (phone_hash, month_key, intent_type)
    VALUES (?, ?, ?)
  `).run(hash, month, intentType);

  if (isPro) {
    return { isPro: true, usedCount: null, limit: null };
  }

  const { count } = db.prepare(`
    SELECT COUNT(*) as count FROM usage_events
    WHERE phone_hash = ? AND month_key = ?
  `).get(hash, month);

  return { isPro: false, usedCount: count, limit: getFreeLimit() };
}

/**
 * Atomically checks quota AND increments.
 * This is the primary usage checking function — it prevents TOCTOU race conditions.
 *
 * @param {string} phoneNumber
 * @param {string} intentType
 * @returns {{ allowed: boolean, isPro: boolean, usedCount: number, limit: number, insertedRowId?: number }}
 *   insertedRowId is present only on the free-tier increment path (the only
 *   path a caller ever needs to roll back), so it can be used to delete the
 *   exact row this call created, rather than guessing via MAX(id).
 */
function checkAndIncrementUsage(phoneNumber, intentType = 'unknown') {
  const db    = getDb();
  const hash  = hashPhone(phoneNumber);
  const month = currentMonthKey();

  const result = db.transaction(() => {
    ensureTeacher(hash);
    const teacher = getTeacher(hash);
    const isPro   = isProActive(teacher);

    if (isPro) {
      db.prepare(`
        INSERT INTO usage_events (phone_hash, month_key, intent_type)
        VALUES (?, ?, ?)
      `).run(hash, month, intentType);
      return { allowed: true, isPro: true, usedCount: null, limit: null };
    }

    const { count } = db.prepare(`
      SELECT COUNT(*) as count FROM usage_events
      WHERE phone_hash = ? AND month_key = ?
    `).get(hash, month);

    if (count >= getFreeLimit()) {
      return { allowed: false, isPro: false, usedCount: count, limit: getFreeLimit() };
    }

    const insertResult = db.prepare(`
      INSERT INTO usage_events (phone_hash, month_key, intent_type)
      VALUES (?, ?, ?)
    `).run(hash, month, intentType);

    return {
      allowed: true,
      isPro: false,
      usedCount: count + 1,
      limit: getFreeLimit(),
      // Phase E fix: exact row ID for this specific increment, so a caller
      // that needs to roll back on a later failure (e.g. AI generation
      // failing) can delete THIS row precisely, rather than guessing via
      // MAX(id) — which deletes the wrong row whenever a second, unrelated
      // request for the same teacher/month has inserted its own row in the
      // meantime (a real, reachable race; see routes/webhook.js rollback
      // call site and tests/phase-e-usage-rollback.test.js).
      insertedRowId: Number(insertResult.lastInsertRowid),
    };
  })();

  return result;
}

/**
 * Returns usage info for a phone number (for STATUS command messages).
 *
 * @param {string} phoneNumber
 * @returns {{ count: number, isPro: boolean, limit: number, remaining: number }}
 */
function getUsageInfo(phoneNumber) {
  const db    = getDb();
  const hash  = hashPhone(phoneNumber);
  const month = currentMonthKey();

  ensureTeacher(hash);
  const teacher = getTeacher(hash);
  const isPro   = isProActive(teacher);

  const { count } = db.prepare(`
    SELECT COUNT(*) as count FROM usage_events
    WHERE phone_hash = ? AND month_key = ?
  `).get(hash, month);

  return {
    count,
    isPro,
    limit:     isPro ? null : getFreeLimit(),
    remaining: isPro ? null : Math.max(0, getFreeLimit() - count),
    name:      teacher?.name    || null,
    grade:     teacher?.grade   ?? null,
    subject:   teacher?.subject || null,
  };
}

/**
 * Updates a teacher's profile fields.
 * Only updates fields that are explicitly provided.
 *
 * @param {string} phoneNumber
 * @param {{ name?, grade?, subject?, language?, school?, phone_enc? }} fields
 */
function updateTeacherProfile(phoneNumber, fields) {
  const db   = getDb();
  const hash = hashPhone(phoneNumber);
  ensureTeacher(hash);

  const allowed = ['name', 'grade', 'subject', 'language', 'school', 'phone_enc', 'opted_out', 'last_intent', 'last_assessment_id'];
  const updates = [];
  const values  = [];

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      updates.push(`${key} = ?`);
      // ROOT CAUSE FIX: `grade` is a TEXT column, but parseGradeInput() and
      // other callers pass a raw JS integer (e.g. 7). better-sqlite3 binds
      // a JS number to a TEXT column by coercing it through its string
      // representation *as a float*, which for an integer produces "7.0"
      // rather than "7" (confirmed empirically). That "7.0" then leaks into
      // every PDF header/footer/filename downstream. Explicitly stringify
      // integer-like values here so TEXT columns always get a clean string.
      let value = fields[key];
      if (key === 'grade' && typeof value === 'number' && Number.isInteger(value)) {
        value = String(value);
      }
      values.push(value);
    }
  }

  if (updates.length === 0) return;

  updates.push("updated_at = datetime('now')");
  values.push(hash);

  db.prepare(`
    UPDATE teachers SET ${updates.join(', ')} WHERE phone_hash = ?
  `).run(...values);
}

/**
 * Returns all teachers whose Pro subscription expires within `days` days
 * AND who have not yet been sent a renewal reminder in the last 24 hours.
 *
 * @param {number} days
 * @returns {Array<{ phone_hash: string, phone_enc: string|null, name: string|null, pro_expires: string }>}
 */
function getTeachersExpiringWithin(days) {
  return getDb().prepare(`
    SELECT phone_hash, phone_enc, name, pro_expires
    FROM teachers
    WHERE is_pro = 1
      AND pro_expires IS NOT NULL
      AND pro_expires > datetime('now')
      AND pro_expires <= datetime('now', '+' || ? || ' days')
      AND opted_out = 0
      AND (
        renewal_reminder_sent_at IS NULL
        OR renewal_reminder_sent_at < datetime('now', '-24 hours')
      )
  `).all(days);
}

/**
 * Records that a renewal reminder was sent to a teacher.
 * Prevents duplicate reminders within a 24-hour window.
 *
 * @param {string} phoneHash
 */
function markRenewalReminderSent(phoneHash) {
  getDb().prepare(`
    UPDATE teachers
    SET renewal_reminder_sent_at = datetime('now')
    WHERE phone_hash = ?
  `).run(phoneHash);
}

/**
 * Manually marks a teacher as Pro for a specified number of days.
 * Used for gifted subscriptions, support tickets, or manual Pro grants.
 *
 * @param {string} phoneNumber - Raw phone number (will be hashed)
 * @param {number} daysValid - Number of days the Pro subscription should be valid (default: 31)
 * @returns {Date} The expiry date of the Pro subscription
 */
function markUserAsPro(phoneNumber, daysValid = 31) {
  const db   = getDb();
  const hash = hashPhone(phoneNumber);
  ensureTeacher(hash);
  const before = getTeacher(hash);
  db.prepare(`
    UPDATE teachers
    SET is_pro = 1,
        pro_expires = datetime(
          MAX(COALESCE(pro_expires, datetime('now')), datetime('now')),
          '+' || ? || ' days'
        ),
        renewal_reminder_sent_at = NULL,
        updated_at = datetime('now')
    WHERE phone_hash = ?
  `).run(daysValid, hash);
  const teacher = getTeacher(hash);
  console.log(
    `[ADMIN] Pro grant`,
    {
      teacher: `...${hash.slice(-8)}`,
      daysAdded: daysValid,
      before: before?.pro_expires ?? null,
      after: teacher.pro_expires
    }
  );
  return {
    previousExpiry: before?.pro_expires ?? null,
    newExpiry: teacher.pro_expires,
    expiresAt: new Date(teacher.pro_expires),
    daysAdded: daysValid
  };
}

module.exports = {
  hashPhone,
  currentMonthKey,
  checkAndIncrementUsage,
  getUsageInfo,
  getTeacherByPhone,
  updateTeacherProfile,
  isProActive,
  getTeachersExpiringWithin,
  markRenewalReminderSent,
  markUserAsPro,
};
