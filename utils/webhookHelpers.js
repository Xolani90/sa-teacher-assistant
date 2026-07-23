'use strict';

/**
 * Shared webhook helper utilities.
 *
 * Extracted verbatim from routes/webhook.js — no behavioral changes.
 * These are small, widely-reused helpers (usage rollback, rate limiting,
 * session clearing, safe message sending, intent labeling) that were
 * previously defined inline in the webhook route file.
 */

const { getTeacherByPhone, hashPhone } = require('./usageTracker');
const { sendMessage } = require('../services/whatsappService');
const { clearAllSessionsForHash } = require('./sessionStore');

/**
 * Rolls back a usage_events row created by checkAndIncrementUsage() when
 * the generation that consumed it subsequently fails. Deletes the EXACT
 * row this request created (quota.insertedRowId), never a MAX(id)-based
 * guess — a second, unrelated request for the same teacher/month can
 * insert its own row in the meantime, since no per-teacher serialization
 * exists across separate webhook deliveries (see
 * tests/phase-e-usage-rollback.test.js).
 *
 * No-ops for Pro-tier teachers (checkAndIncrementUsage never sets
 * insertedRowId for Pro-tier calls) and for any quota result missing
 * insertedRowId.
 *
 * @param {{isPro?: boolean, insertedRowId?: number}} quota
 * @param {string} from - teacher's WhatsApp number, for logging only
 */
function rollbackUsage(quota, from) {
  if (quota && quota.isPro) return;
  if (!quota || typeof quota.insertedRowId !== 'number') {
    console.warn(`[WEBHOOK] Usage rollback skipped — no insertedRowId on quota result for ...${String(from).slice(-4)}`);
    return;
  }
  try {
    const db = require('./database').getDb();
    const result = db.prepare(`DELETE FROM usage_events WHERE id = ?`).run(quota.insertedRowId);
    if (result.changes === 1) {
      console.log(`[WEBHOOK] Rolled back usage increment (row id=${quota.insertedRowId}) for free-tier teacher ...${String(from).slice(-4)}`);
    } else {
      console.warn(`[WEBHOOK] Usage rollback found no row to delete (id=${quota.insertedRowId}, already removed?) for ...${String(from).slice(-4)}`);
    }
  } catch (rollbackErr) {
    console.error('[WEBHOOK] Failed to roll back usage increment:', rollbackErr.message);
  }
}

// ── Per-phone rate limiters (SQLite-backed) ─────────────────────────────────
// Backlog Item 4 fix: previously in-memory Maps (aiCallTimestamps /
// classifierCallTimestamps), which reset on every Render restart/redeploy —
// a teacher near the ceiling effectively got a free reset on every deploy.
// Now persisted in rate_limit_events (see utils/database.js Migration 023).
// Each write opportunistically deletes that phone's own stale rows for the
// same limiter, so no separate cleanup interval is needed.
const AI_RATE_LIMIT             = 5;      // max AI calls
const AI_RATE_WINDOW_MS         = 60_000; // per 60 seconds
const CLASSIFIER_RATE_LIMIT     = 20;     // max classification calls
const CLASSIFIER_RATE_WINDOW_MS = 60_000; // per 60 seconds

function checkAndRecordRateLimit(from, limiterType, limit, windowMs) {
  const db     = require('./database').getDb();
  const hash   = hashPhone(from);
  const cutoff = `-${Math.floor(windowMs / 1000)} seconds`;

  return db.transaction(() => {
    const { count } = db.prepare(`
      SELECT COUNT(*) as count FROM rate_limit_events
      WHERE phone_hash = ? AND limiter_type = ?
        AND created_at > datetime('now', ?)
    `).get(hash, limiterType, cutoff);

    if (count >= limit) return true;

    db.prepare(`
      INSERT INTO rate_limit_events (phone_hash, limiter_type)
      VALUES (?, ?)
    `).run(hash, limiterType);

    // Opportunistic cleanup of this phone's own stale rows for this limiter —
    // keeps the table bounded without a separate background job.
    db.prepare(`
      DELETE FROM rate_limit_events
      WHERE phone_hash = ? AND limiter_type = ?
        AND created_at <= datetime('now', ?)
    `).run(hash, limiterType, cutoff);

    return false;
  })();
}

// Prevents a single teacher from firing many AI calls in a short burst
// (e.g. rapidly typing 5 messages before any respond). Separate from the
// monthly quota.
function isAiRateLimited(from) {
  return checkAndRecordRateLimit(from, 'ai', AI_RATE_LIMIT, AI_RATE_WINDOW_MS);
}

// Every incoming text message now triggers an AI classification call (the
// new understanding step), unlike the old purely-synchronous regex parser.
// A real back-and-forth conversation legitimately sends many messages per
// minute, so this ceiling is deliberately much higher than the generation
// rate limit above — it exists only to stop a degenerate flood (bug, retry
// loop, abuse) from running up API costs with no limit at all. When this
// limit is hit, classification silently falls back to the regex parser
// instead of blocking the teacher's message entirely — there is no
// equivalent of the "please wait" message here because the teacher should
// never feel blocked just for chatting quickly.
function isClassifierRateLimited(from) {
  return checkAndRecordRateLimit(from, 'classifier', CLASSIFIER_RATE_LIMIT, CLASSIFIER_RATE_WINDOW_MS);
}

// ── Clear all session states for a teacher ─────────────────────────────────
function clearAllSessions(from) {
  clearAllSessionsForHash(hashPhone(from));
}

// ── Safe sendMessage wrapper (checks opted_out) ───────────────────────────
async function safeSendMessage(from, text) {
  const teacher = getTeacherByPhone(from);
  if (teacher && teacher.opted_out === 1) {
    console.log(`[WEBHOOK] Skipping message to opted-out teacher ...${String(from).slice(-4)}`);
    return;
  }
  await sendMessage(from, text);
}

function intentLabel(type) {
  const labels = {
    worksheet:   'worksheet',
    test:        'test & memorandum',
    examPaper:   'exam paper & memorandum',
    rubric:      'marking rubric',
    sbaTask:     'SBA task',
    lessonPlan:  'lesson plan',
    explanation: 'explanation',
    atp:         'Annual Teaching Plan',
    assessmentAnalysis: 'assessment analysis',
    dataAssessment:     'data-driven assessment analysis',
    interventionPlan:   'intervention plan',
    moderationPack:     'moderation pack',
    curriculumQuery:    'curriculum intelligence query',
  };
  return labels[type] || 'content';
}

function FREE_LIMIT_DISPLAY() {
  return process.env.FREE_LIMIT || '10';
}

module.exports = {
  rollbackUsage,
  checkAndRecordRateLimit,
  isAiRateLimited,
  isClassifierRateLimited,
  clearAllSessions,
  safeSendMessage,
  intentLabel,
  FREE_LIMIT_DISPLAY,
};
