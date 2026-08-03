'use strict';

/**
 * QMS Reflections service (PR27, ADR-011 §2/§3/§4/§7).
 *
 * Persistence layer over qms_reflections (Migration 037). Mirrors
 * authCodeRepository.js / observationRepository.js's shape: plain
 * prepared statements, no db.transaction() (compatibility with both
 * better-sqlite3 in production and the node:sqlite test shim used
 * elsewhere in this suite).
 *
 * This is the first QMS-owned entity. It is deliberately narrow in
 * scope for PR27: no WhatsApp command, no dashboard route, no
 * portfolio compilation. Just create/read/update/soft-delete against
 * the ADR-011-frozen schema, so growth plans (PR28) and portfolio
 * snapshots (PR29) have a working pattern to follow.
 *
 * Ownership: phone_hash, not teacher_id — ADR-011 §2 explicitly
 * decided against introducing a second teacher-identity column.
 *
 * Evidence linking: evidence_link_ids is stored as a JSON array of
 * tse_evidence_links.id values (ADR-011 §3) — this service does not
 * validate that those ids actually exist in tse_evidence_links; that
 * would require a cross-table check on every write for a column whose
 * only consumer today is display purposes. If/when a join-table
 * migration happens (ADR-011 §3's stated triggers), FK integrity
 * becomes real at the schema level instead.
 *
 * Deletion: soft delete only (deleted_at), never a hard DELETE —
 * ADR-011 §7. getReflection()/listReflections() exclude soft-deleted
 * rows by default; there is no "restore" function in PR27 because
 * ADR-011 didn't decide restore semantics were needed yet. Add one
 * later if a real requirement shows up rather than guessing now.
 *
 * topicId (PR32, ADR-013 §4.3): every new reflection must be tagged with
 * a validated topicId from utils/qmsTopics.js — the closed taxonomy that
 * replaces free-text categorization. Pre-PR32 rows have topic_id IS NULL
 * (Migration 039, ADR-013 §4.5) and are never backfilled.
 */

const { getDb } = require('../utils/database');
const { isValidTopicId } = require('../utils/qmsTopics');

/**
 * Serializes a raw qms_reflections row into the shape callers expect —
 * camelCase, evidence_link_ids parsed back into an array, ai_assisted
 * coerced to a real boolean (SQLite stores it as 0/1).
 *
 * @param {object} row
 * @returns {object}
 */
function serializeReflection(row) {
  let evidenceLinkIds = [];
  if (row.evidence_link_ids) {
    try {
      const parsed = JSON.parse(row.evidence_link_ids);
      if (Array.isArray(parsed)) evidenceLinkIds = parsed;
    } catch (_) {
      // Malformed JSON should never happen (this service is the only
      // writer), but don't let a corrupt row throw for callers that
      // just want to read content/term/etc.
      evidenceLinkIds = [];
    }
  }

  return {
    id: row.id,
    phoneHash: row.phone_hash,
    term: row.term,
    content: row.content,
    topicId: row.topic_id,
    aiAssisted: !!row.ai_assisted,
    evidenceLinkIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

/**
 * Creates a new reflection.
 *
 * @param {string} phoneHash
 * @param {object} params
 * @param {string} params.content - required, non-empty.
 * @param {string} params.topicId - required. Must be a valid taxonomy id
 *   (utils/qmsTopics.js) — ADR-013 §3.3: new application writes must
 *   always provide a valid topicId; null is reserved exclusively for
 *   pre-PR32 legacy rows, never a valid value for a new write.
 * @param {number} [params.term] - defaults to null (unscoped) if omitted.
 * @param {boolean} [params.aiAssisted=false]
 * @param {number[]} [params.evidenceLinkIds=[]] - tse_evidence_links.id
 *   values this reflection relates to. May be empty — ADR-011 §7
 *   explicitly allows a reflection to exist without any linked evidence.
 * @returns {object} the created reflection, serialized.
 */
function createReflection(phoneHash, { content, topicId, term = null, aiAssisted = false, evidenceLinkIds = [] } = {}) {
  if (!phoneHash || typeof phoneHash !== 'string') {
    throw new Error('createReflection: phoneHash is required');
  }
  if (!content || typeof content !== 'string' || !content.trim()) {
    throw new Error('createReflection: content is required');
  }
  if (!Array.isArray(evidenceLinkIds)) {
    throw new Error('createReflection: evidenceLinkIds must be an array');
  }
  if (!isValidTopicId(topicId)) {
    throw new Error(`createReflection: topicId must be a valid QMS topic id, got "${topicId}"`);
  }

  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO qms_reflections
         (phone_hash, term, content, topic_id, ai_assisted, evidence_link_ids)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(phoneHash, term, content.trim(), topicId, aiAssisted ? 1 : 0, JSON.stringify(evidenceLinkIds));

  const created = getReflection(phoneHash, Number(result.lastInsertRowid));

  // PR37, ADR-016 §2/§9 invariant 1: a reflection save is an evidence
  // change, so it triggers a coaching snapshot. Required lazily (not at
  // module top) to avoid a load-order cycle — coachingSnapshotService
  // requires coachingEngineService, which itself requires this module.
  // This call must never throw the write itself off course: a snapshot
  // failure is logged, not propagated, since the reflection is already
  // durably committed by this point.
  try {
    require('./coachingSnapshotService').recordSnapshotsForTeacher(phoneHash);
  } catch (err) {
    console.error('[coachingSnapshotService] snapshot write failed after createReflection:', err);
  }

  return created;
}

/**
 * Returns a single reflection by id, scoped to phoneHash (a teacher
 * can never fetch another teacher's reflection by guessing an id).
 * Excludes soft-deleted rows.
 *
 * @param {string} phoneHash
 * @param {number} id
 * @returns {object|null}
 */
function getReflection(phoneHash, id) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM qms_reflections
       WHERE id = ? AND phone_hash = ? AND deleted_at IS NULL`
    )
    .get(id, phoneHash);

  return row ? serializeReflection(row) : null;
}

/**
 * Lists a teacher's reflections, most recent first. Excludes
 * soft-deleted rows. Optionally scoped to a single term.
 *
 * @param {string} phoneHash
 * @param {object} [options]
 * @param {number} [options.term] - if provided, only reflections for this term.
 * @returns {object[]}
 */
function listReflections(phoneHash, { term = null } = {}) {
  const db = getDb();

  const rows = term == null
    ? db
        .prepare(
          `SELECT * FROM qms_reflections
           WHERE phone_hash = ? AND deleted_at IS NULL
           ORDER BY id DESC`
        )
        .all(phoneHash)
    : db
        .prepare(
          `SELECT * FROM qms_reflections
           WHERE phone_hash = ? AND term = ? AND deleted_at IS NULL
           ORDER BY id DESC`
        )
        .all(phoneHash, term);

  return rows.map(serializeReflection);
}

/**
 * Updates an existing reflection's editable fields. Scoped to
 * phoneHash — cannot update another teacher's reflection. No-op
 * (returns null) if the row doesn't exist, isn't owned by this
 * phoneHash, or is already soft-deleted.
 *
 * @param {string} phoneHash
 * @param {number} id
 * @param {object} params
 * @param {string} [params.content]
 * @param {string} [params.topicId] - if provided, must be a valid
 *   taxonomy id (ADR-013 §3.3). Omitting it leaves the existing value
 *   (possibly a legacy null) untouched.
 * @param {boolean} [params.aiAssisted]
 * @param {number[]} [params.evidenceLinkIds]
 * @returns {object|null} the updated reflection, serialized, or null.
 */
function updateReflection(phoneHash, id, { content, topicId, aiAssisted, evidenceLinkIds } = {}) {
  const existing = getReflection(phoneHash, id);
  if (!existing) return null;

  const nextContent = content !== undefined ? content : existing.content;
  if (!nextContent || typeof nextContent !== 'string' || !nextContent.trim()) {
    throw new Error('updateReflection: content cannot be empty');
  }

  let nextTopicId = existing.topicId;
  if (topicId !== undefined) {
    if (!isValidTopicId(topicId)) {
      throw new Error(`updateReflection: topicId must be a valid QMS topic id, got "${topicId}"`);
    }
    nextTopicId = topicId;
  }

  const nextAiAssisted = aiAssisted !== undefined ? !!aiAssisted : existing.aiAssisted;

  let nextEvidenceLinkIds = existing.evidenceLinkIds;
  if (evidenceLinkIds !== undefined) {
    if (!Array.isArray(evidenceLinkIds)) {
      throw new Error('updateReflection: evidenceLinkIds must be an array');
    }
    nextEvidenceLinkIds = evidenceLinkIds;
  }

  const topicChanged = topicId !== undefined && nextTopicId !== existing.topicId;

  const db = getDb();
  db.prepare(
    `UPDATE qms_reflections
     SET content = ?, topic_id = ?, ai_assisted = ?, evidence_link_ids = ?, updated_at = datetime('now')
     WHERE id = ? AND phone_hash = ? AND deleted_at IS NULL`
  ).run(nextContent.trim(), nextTopicId, nextAiAssisted ? 1 : 0, JSON.stringify(nextEvidenceLinkIds), id, phoneHash);

  // PR37, ADR-016 §2 (revised, evidence-event philosophy): content/
  // aiAssisted/evidenceLinkIds don't feed buildTopicContexts() (evidence
  // is grouped and scored by topicId + createdAt only — see
  // coachingEngineService.gatherEvidenceByTopic), so editing those alone
  // is not a trigger. A topicId reassignment moves this reflection's
  // evidence from one topic's evidenceScore/recencyScore/consistencyScore
  // to another's, so it is. Required lazily to avoid a load-order cycle
  // (coachingSnapshotService -> coachingEngineService -> this module).
  if (topicChanged) {
    try {
      require('./coachingSnapshotService').recordSnapshotsForTeacher(phoneHash);
    } catch (err) {
      console.error('[coachingSnapshotService] snapshot write failed after updateReflection:', err);
    }
  }

  return getReflection(phoneHash, id);
}

/**
 * Soft-deletes a reflection (ADR-011 §7 — never a hard delete, since a
 * portfolio snapshot may already reference this row). Scoped to
 * phoneHash. No-op if the row doesn't exist, isn't owned by this
 * phoneHash, or is already deleted.
 *
 * @param {string} phoneHash
 * @param {number} id
 * @returns {boolean} true if this call performed the deletion.
 */
function deleteReflection(phoneHash, id) {
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE qms_reflections SET deleted_at = datetime('now')
       WHERE id = ? AND phone_hash = ? AND deleted_at IS NULL`
    )
    .run(id, phoneHash);

  // PR37, ADR-016 §2 (revised, evidence-event philosophy): a soft-deleted
  // reflection drops out of getTaggedReflections() and therefore out of
  // evidenceScore/recencyScore/consistencyScore for its topic — a genuine
  // evidence change, so it triggers a snapshot the same as a create.
  // Only fires if this call actually deleted something. Required lazily
  // to avoid a load-order cycle (coachingSnapshotService ->
  // coachingEngineService -> this module).
  if (result.changes > 0) {
    try {
      require('./coachingSnapshotService').recordSnapshotsForTeacher(phoneHash);
    } catch (err) {
      console.error('[coachingSnapshotService] snapshot write failed after deleteReflection:', err);
    }
  }

  return result.changes > 0;
}

module.exports = {
  createReflection,
  getReflection,
  listReflections,
  updateReflection,
  deleteReflection,
};
