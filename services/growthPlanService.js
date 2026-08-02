'use strict';

/**
 * QMS Growth Plans service (PR29, ADR-011 §2/§7/§9).
 *
 * Persistence layer over qms_growth_plans (Migration 038). Mirrors
 * reflectionService.js's shape: plain prepared statements, no
 * db.transaction() (compatibility with both better-sqlite3 in
 * production and the node:sqlite test shim used elsewhere in this
 * suite).
 *
 * Scope note: schema and fields here are frozen exactly as ADR-011's
 * Data Model section specifies — phone_hash, term, goal_text,
 * target_area, status, timestamps, deleted_at. No reflection_id
 * linkage and no extra planning fields (planned_actions,
 * success_criteria, target_date) — those were explicitly deferred to a
 * future ADR (see PR29 discussion) rather than added silently here.
 *
 * Ownership: phone_hash, not teacher_id — same rationale as
 * reflectionService.js (ADR-011 §2).
 *
 * Status lifecycle (ADR-011 §2): active -> in_progress -> completed,
 * or abandoned as a terminal state. This service validates status
 * against that fixed set but does not enforce transition order (e.g.
 * it does not block active -> completed directly) — ADR-011 explicitly
 * left exact transition rules as an implementation detail, not frozen.
 *
 * Deletion: soft delete only (deleted_at), never a hard DELETE —
 * ADR-011 §7, same rationale as reflections (a portfolio snapshot may
 * already reference this row).
 */

const { getDb } = require('../utils/database');

const VALID_STATUSES = ['active', 'in_progress', 'completed', 'abandoned'];

/**
 * Serializes a raw qms_growth_plans row into the shape callers expect
 * — camelCase field names.
 *
 * @param {object} row
 * @returns {object}
 */
function serializeGrowthPlan(row) {
  return {
    id: row.id,
    phoneHash: row.phone_hash,
    term: row.term,
    goalText: row.goal_text,
    targetArea: row.target_area,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

/**
 * Creates a new growth plan.
 *
 * @param {string} phoneHash
 * @param {object} params
 * @param {string} params.goalText - required, non-empty.
 * @param {number} [params.term] - defaults to null (unscoped) if omitted.
 * @param {string} [params.targetArea] - optional free-text focus area.
 * @param {string} [params.status='active'] - must be one of VALID_STATUSES.
 * @returns {object} the created growth plan, serialized.
 */
function createGrowthPlan(phoneHash, { goalText, term = null, targetArea = null, status = 'active' } = {}) {
  if (!phoneHash || typeof phoneHash !== 'string') {
    throw new Error('createGrowthPlan: phoneHash is required');
  }
  if (!goalText || typeof goalText !== 'string' || !goalText.trim()) {
    throw new Error('createGrowthPlan: goalText is required');
  }
  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`createGrowthPlan: status must be one of ${VALID_STATUSES.join(', ')}`);
  }

  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO qms_growth_plans
         (phone_hash, term, goal_text, target_area, status)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(phoneHash, term, goalText.trim(), targetArea, status);

  return getGrowthPlan(phoneHash, Number(result.lastInsertRowid));
}

/**
 * Returns a single growth plan by id, scoped to phoneHash. Excludes
 * soft-deleted rows.
 *
 * @param {string} phoneHash
 * @param {number} id
 * @returns {object|null}
 */
function getGrowthPlan(phoneHash, id) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM qms_growth_plans
       WHERE id = ? AND phone_hash = ? AND deleted_at IS NULL`
    )
    .get(id, phoneHash);

  return row ? serializeGrowthPlan(row) : null;
}

/**
 * Lists a teacher's growth plans, most recent first. Excludes
 * soft-deleted rows. Optionally scoped to a single term and/or status.
 *
 * @param {string} phoneHash
 * @param {object} [options]
 * @param {number} [options.term]
 * @param {string} [options.status]
 * @returns {object[]}
 */
function listGrowthPlans(phoneHash, { term = null, status = null } = {}) {
  const db = getDb();

  let sql = `SELECT * FROM qms_growth_plans WHERE phone_hash = ? AND deleted_at IS NULL`;
  const args = [phoneHash];

  if (term != null) {
    sql += ` AND term = ?`;
    args.push(term);
  }
  if (status != null) {
    sql += ` AND status = ?`;
    args.push(status);
  }
  sql += ` ORDER BY id DESC`;

  const rows = db.prepare(sql).all(...args);
  return rows.map(serializeGrowthPlan);
}

/**
 * Updates an existing growth plan's editable fields. Scoped to
 * phoneHash. No-op (returns null) if the row doesn't exist, isn't
 * owned by this phoneHash, or is already soft-deleted.
 *
 * @param {string} phoneHash
 * @param {number} id
 * @param {object} params
 * @param {string} [params.goalText]
 * @param {string} [params.targetArea]
 * @param {string} [params.status]
 * @returns {object|null} the updated growth plan, serialized, or null.
 */
function updateGrowthPlan(phoneHash, id, { goalText, targetArea, status } = {}) {
  const existing = getGrowthPlan(phoneHash, id);
  if (!existing) return null;

  const nextGoalText = goalText !== undefined ? goalText : existing.goalText;
  if (!nextGoalText || typeof nextGoalText !== 'string' || !nextGoalText.trim()) {
    throw new Error('updateGrowthPlan: goalText cannot be empty');
  }

  const nextTargetArea = targetArea !== undefined ? targetArea : existing.targetArea;

  let nextStatus = existing.status;
  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) {
      throw new Error(`updateGrowthPlan: status must be one of ${VALID_STATUSES.join(', ')}`);
    }
    nextStatus = status;
  }

  const db = getDb();
  db.prepare(
    `UPDATE qms_growth_plans
     SET goal_text = ?, target_area = ?, status = ?, updated_at = datetime('now')
     WHERE id = ? AND phone_hash = ? AND deleted_at IS NULL`
  ).run(nextGoalText.trim(), nextTargetArea, nextStatus, id, phoneHash);

  return getGrowthPlan(phoneHash, id);
}

/**
 * Convenience wrapper for the common "mark as completed" transition.
 * Scoped to phoneHash. No-op (returns null) if the row doesn't exist,
 * isn't owned by this phoneHash, or is already soft-deleted.
 *
 * @param {string} phoneHash
 * @param {number} id
 * @returns {object|null} the updated growth plan, serialized, or null.
 */
function completeGrowthPlan(phoneHash, id) {
  return updateGrowthPlan(phoneHash, id, { status: 'completed' });
}

/**
 * Soft-deletes a growth plan (ADR-011 §7 — never a hard delete, since
 * a portfolio snapshot may already reference this row). Scoped to
 * phoneHash. No-op if the row doesn't exist, isn't owned by this
 * phoneHash, or is already deleted.
 *
 * @param {string} phoneHash
 * @param {number} id
 * @returns {boolean} true if this call performed the deletion.
 */
function deleteGrowthPlan(phoneHash, id) {
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE qms_growth_plans SET deleted_at = datetime('now')
       WHERE id = ? AND phone_hash = ? AND deleted_at IS NULL`
    )
    .run(id, phoneHash);

  return result.changes > 0;
}

module.exports = {
  VALID_STATUSES,
  createGrowthPlan,
  getGrowthPlan,
  listGrowthPlans,
  updateGrowthPlan,
  completeGrowthPlan,
  deleteGrowthPlan,
};
