/**
 * services/learnerIdentityService.js
 *
 * PR 2 — learner identity resolution.
 *
 * Public API: resolveLearner() is the ONLY function application code
 * (observationRepository, assessment write paths, etc.) should call.
 * createLearner() is exported under __internal solely so tests can exercise
 * it in isolation — it must not be called directly from elsewhere.
 *
 * Matching behaviour follows the deterministic identity rules established
 * by ADR-003 (Decision, Option B). Future matching enhancements (fuzzy
 * matching, merge policies, confidence scoring) are intentionally
 * deferred to ADR-004.
 *
 * Matching rules:
 *   - Match only within the same teacher (phone_hash).
 *   - If classId is known, match only within that class.
 *   - If classId is null, match only against learners with class_id IS NULL.
 *   - Never widen the search across classes automatically.
 *   - Never perform fuzzy matching in Phase 1.
 *   - Never move a learner between classes automatically — a learner
 *     created with class_id = NULL and later resolved with a real classId
 *     is left as-is; class reconciliation is out of scope until ADR-004.
 *
 * Concurrency:
 *   Two partial unique indexes (migration 026) are the actual guard against
 *   duplicate identities, not application-level locking:
 *     idx_learners_identity_classed   (phone_hash, class_id, normalized_name) WHERE class_id IS NOT NULL
 *     idx_learners_identity_unclassed (phone_hash, normalized_name)           WHERE class_id IS NULL
 *   resolveLearner() follows find -> insert -> catch UNIQUE violation -> re-find.
 *   Requires migration 026 to be applied; without it, the race window PR 2's
 *   review flagged (two concurrent calls both miss the find, both insert)
 *   is only closed by those indexes existing in the real database.
 */

const { getDb } = require('../utils/database');

function normalizeName(name) {
  if (typeof name !== 'string') return '';
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function isUniqueConstraintError(err) {
  return !!err && (
    err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    /UNIQUE constraint failed/.test(err.message || '')
  );
}

function findByIdentity({ phoneHash, classId, learnerName }) {
  const db = getDb();
  const normalized = normalizeName(learnerName);

  if (classId != null) {
    return db.prepare(`
      SELECT * FROM learners
      WHERE phone_hash = ? AND class_id = ? AND normalized_name = ?
    `).get(phoneHash, classId, normalized) || null;
  }

  return db.prepare(`
    SELECT * FROM learners
    WHERE phone_hash = ? AND class_id IS NULL AND normalized_name = ?
  `).get(phoneHash, normalized) || null;
}

// INTERNAL — do not call outside this module/tests. Use resolveLearner().
function createLearner({ phoneHash, classId, learnerName }) {
  const db = getDb();
  const normalized = normalizeName(learnerName);
  const now = new Date().toISOString();

  const result = db.prepare(`
    INSERT INTO learners (phone_hash, class_id, canonical_name, normalized_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(phoneHash, classId ?? null, learnerName, normalized, now, now);

  return db.prepare(`SELECT * FROM learners WHERE id = ?`).get(result.lastInsertRowid);
}

/**
 * Read-only counterpart to resolveLearner(). Advisory only — see ADR-003
 * Implementation Addendum, Principle 2. Never writes to the database.
 * Callers MUST only invoke this on rows that have already passed field
 * validation (a malformed/empty learnerName should never reach this
 * function — that is validation's job, not identity resolution's).
 *
 * The result is a snapshot, not a reservation: another concurrent request
 * may create the matching learner between this call and a later commit.
 * Only resolveLearner(), called at commit time inside the caller's
 * transaction, provides the actual correctness guarantee.
 *
 * @returns {{ status: 'existing', learnerId: number } | { status: 'new' }}
 */
function previewLearnerResolution({ phoneHash, classId, learnerName }) {
  const existing = findByIdentity({ phoneHash, classId, learnerName });
  return existing
    ? { status: 'existing', learnerId: existing.id }
    : { status: 'new' };
}

// Cycle 17 fix: findByIdentity() matches on (phone_hash, class_id,
// normalized_name) alone — it has no removed_at filter, and can't
// reasonably have one, because idx_learners_identity_classed /
// idx_learners_identity_unclassed (Migration 026) are themselves not
// scoped by removed_at. A soft-removed learner permanently occupies
// their identity slot; a genuinely new INSERT for the same
// (teacher, class, name) is rejected by that unique index regardless of
// removed_at, so "match the removed row" is the only outcome the schema
// allows here — never "create a fresh, distinct learner".
//
// learnerRosterService.js's setRoster()/addLearner() already knew this
// and un-remove (removed_at = NULL) whatever resolveLearner() hands
// back before using it, specifically so a re-pasted or re-added name
// reappears on the active roster instead of silently staying hidden.
// But every OTHER resolveLearner() caller — observationRepository.js's
// saveObservationSubmission() and diagnosticWorkflowService.js's
// learner_results insertion — took the returned row as-is, with no
// revival. A teacher who removes a learner via the dashboard (or
// WhatsApp REMOVE LEARNER) and then later logs a WhatsApp observation
// or captures assessment marks for the same name silently attaches
// that new evidence to the removed learner's identity: it never
// reappears in GET /learners, the class roster, or classDetailService's
// active-roster views, yet keeps accumulating fresh records the teacher
// has no ordinary way to find. Centralizing the revival here (rather
// than requiring every future caller to remember the roster-service
// pattern) closes the gap for all four call sites uniformly.
function reviveIfRemoved(learner) {
  if (!learner || !learner.removed_at) return learner;
  const db = getDb();
  db.prepare(`UPDATE learners SET removed_at = NULL, updated_at = datetime('now') WHERE id = ?`).run(learner.id);
  return { ...learner, removed_at: null };
}

function resolveLearner({ phoneHash, classId, learnerName }) {
  const existing = findByIdentity({ phoneHash, classId, learnerName });
  if (existing) return reviveIfRemoved(existing);

  try {
    return createLearner({ phoneHash, classId, learnerName });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      const refetched = findByIdentity({ phoneHash, classId, learnerName });
      if (refetched) return reviveIfRemoved(refetched);
    }
    throw err;
  }
}

module.exports = {
  resolveLearner,
  previewLearnerResolution,
  findByIdentity,
  normalizeName,
  __internal: { createLearner, isUniqueConstraintError },
};
