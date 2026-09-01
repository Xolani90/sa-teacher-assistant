'use strict';

/**
 * Teacher Incident Book service (Feature 3).
 *
 * Persistence layer over the `incidents` table (utils/database.js,
 * Migration 043). Mirrors growthPlanService.js / reflectionService.js's
 * shape: plain prepared statements, no db.transaction() (compatibility
 * with both better-sqlite3 in production and the node:sqlite test shim
 * used elsewhere in this suite).
 *
 * Ownership: phone_hash, not teacher_id — same rationale as every other
 * teacher-scoped service in this codebase (ADR-011 §2). Every read here
 * takes phoneHash as a required argument and scopes its WHERE clause on
 * it directly (never "find then check in the caller") — this is the
 * actual enforcement point Feature 3's authorization requirement relies
 * on. Callers (routes/api.js, flows/incidentFlow.js) must always pass
 * the SERVER-RESOLVED phoneHash (from req.teacher.phoneHash / hashPhone(from)),
 * never anything a client supplied.
 *
 * Incident type validation delegates entirely to utils/incidentTypes.js
 * — this service does not maintain its own list, matching how
 * growthPlanService.js delegates topicId validation to utils/qmsTopics.js.
 *
 * Text bounds: this codebase's existing free-text services
 * (reflectionService.js, growthPlanService.js) impose no length cap at
 * all. Feature 3 explicitly asks for "excessively long description"
 * handling, and no prior convention exists to reuse, so this service
 * introduces one: description and action_taken are each capped at a
 * generous but bounded length (see MAX_DESCRIPTION_LENGTH /
 * MAX_ACTION_LENGTH below) — long enough for a real incident narrative,
 * short enough to rule out abuse/accidental paste of an entire document.
 */

const { getDb } = require('../utils/database');
const { isValidIncidentType } = require('../utils/incidentTypes');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_ACTION_LENGTH = 1000;

/**
 * Validates a YYYY-MM-DD date string is both correctly formatted AND a
 * real calendar date (rejects e.g. 2026-02-30) — matching the strictness
 * a teacher's dashboard date picker would already guarantee, so the
 * WhatsApp free-text path is held to the same bar.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isValidIncidentDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * Validates a 24-hour HH:MM time string.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isValidIncidentTime(value) {
  return typeof value === 'string' && TIME_RE.test(value);
}

/**
 * Serializes a raw incidents row into the shape callers expect —
 * camelCase field names, matching every other service in this codebase
 * (growthPlanService.serializeGrowthPlan, teacherWorkspaceService's
 * resource mapping, etc.).
 *
 * @param {object} row
 * @returns {object}
 */
function serializeIncident(row) {
  return {
    id: row.id,
    phoneHash: row.phone_hash,
    incidentDate: row.incident_date,
    incidentTime: row.incident_time,
    incidentType: row.incident_type,
    description: row.description,
    actionTaken: row.action_taken,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Validates the create/update-shared fields. Throws with a message
 * prefixed `createIncident:` or `updateIncident:` (caller-supplied)
 * matching this codebase's existing convention (routes/api.js's
 * reflection routes distinguish 400s from 500s by that exact prefix —
 * see createPostReflectionHandler in routes/api.js).
 *
 * @param {string} prefix - 'createIncident' or 'updateIncident'
 * @param {object} fields
 */
function validateFields(prefix, { incidentDate, incidentTime, incidentType, description, actionTaken }) {
  if (!isValidIncidentDate(incidentDate)) {
    throw new Error(`${prefix}: incidentDate must be a valid YYYY-MM-DD date`);
  }
  if (!isValidIncidentTime(incidentTime)) {
    throw new Error(`${prefix}: incidentTime must be a valid 24-hour HH:MM time`);
  }
  if (!isValidIncidentType(incidentType)) {
    throw new Error(`${prefix}: incidentType must be a known incident type`);
  }
  if (!description || typeof description !== 'string' || !description.trim()) {
    throw new Error(`${prefix}: description is required`);
  }
  if (description.trim().length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(`${prefix}: description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer`);
  }
  if (!actionTaken || typeof actionTaken !== 'string' || !actionTaken.trim()) {
    throw new Error(`${prefix}: actionTaken is required`);
  }
  if (actionTaken.trim().length > MAX_ACTION_LENGTH) {
    throw new Error(`${prefix}: actionTaken must be ${MAX_ACTION_LENGTH} characters or fewer`);
  }
}

/**
 * Creates a new incident record. Used identically by the WhatsApp
 * incident flow (flows/incidentFlow.js) and the dashboard create form
 * (routes/api.js POST /incidents) — one authoritative write path, per
 * Feature 3's mirroring requirement.
 *
 * @param {string} phoneHash
 * @param {object} params
 * @param {string} params.incidentDate - YYYY-MM-DD, required.
 * @param {string} params.incidentTime - HH:MM (24h), required.
 * @param {string} params.incidentType - a valid utils/incidentTypes.js id, required.
 * @param {string} params.description - required, non-empty, bounded.
 * @param {string} params.actionTaken - required, non-empty, bounded.
 * @returns {object} the created incident, serialized.
 */
function createIncident(phoneHash, params = {}) {
  if (!phoneHash || typeof phoneHash !== 'string') {
    throw new Error('createIncident: phoneHash is required');
  }
  validateFields('createIncident', params);

  const { incidentDate, incidentTime, incidentType, description, actionTaken } = params;

  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO incidents
         (phone_hash, incident_date, incident_time, incident_type, description, action_taken)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(phoneHash, incidentDate, incidentTime, incidentType, description.trim(), actionTaken.trim());

  return getIncident(phoneHash, Number(result.lastInsertRowid));
}

/**
 * Returns a single incident by id, scoped to phoneHash. This is the
 * actual ownership enforcement point (Feature 3's authorization
 * requirement) — the WHERE clause checks id AND phone_hash together,
 * so a wrong-owner id returns null exactly like a non-existent id does,
 * same pattern as teacherWorkspaceService.getSavedResource().
 *
 * @param {string} phoneHash
 * @param {number} id
 * @returns {object|null}
 */
function getIncident(phoneHash, id) {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM incidents WHERE id = ? AND phone_hash = ?`)
    .get(id, phoneHash);

  return row ? serializeIncident(row) : null;
}

/**
 * Lists a teacher's incidents, most recent first. Optionally filtered
 * by incident type and/or a date range — matching Feature 3's
 * "search/filter by incident type / date range" dashboard requirement,
 * same optional-filter convention as
 * teacherWorkspaceService.getSavedResources()'s filters object.
 *
 * @param {string} phoneHash
 * @param {object} [filters]
 * @param {string} [filters.incidentType]
 * @param {string} [filters.fromDate] - YYYY-MM-DD, inclusive.
 * @param {string} [filters.toDate] - YYYY-MM-DD, inclusive.
 * @returns {object[]}
 */
function listIncidents(phoneHash, filters = {}) {
  const db = getDb();

  let sql = `SELECT * FROM incidents WHERE phone_hash = ?`;
  const args = [phoneHash];

  if (filters.incidentType) {
    sql += ` AND incident_type = ?`;
    args.push(filters.incidentType);
  }
  if (filters.fromDate) {
    sql += ` AND incident_date >= ?`;
    args.push(filters.fromDate);
  }
  if (filters.toDate) {
    sql += ` AND incident_date <= ?`;
    args.push(filters.toDate);
  }

  sql += ` ORDER BY incident_date DESC, incident_time DESC, id DESC`;

  const rows = db.prepare(sql).all(...args);
  return rows.map(serializeIncident);
}

/**
 * Updates an existing incident's editable fields. Scoped to phoneHash.
 * No-op (returns null) if the row doesn't exist or isn't owned by this
 * phoneHash — same "identical to not found" convention as
 * growthPlanService.updateGrowthPlan().
 *
 * All fields are required on update (not a partial patch at the
 * validation level) — mirrors createIncident's full-record validation,
 * since an incident with (e.g.) a missing description after an edit
 * would be a worse data-quality regression than requiring the caller to
 * resend the full record. routes/api.js's PATCH handler is still a
 * conventional partial PATCH from the HTTP caller's point of view — it
 * merges the existing row's values in before calling this, same pattern
 * as updateGrowthPlan's field-by-field defaulting.
 *
 * @param {string} phoneHash
 * @param {number} id
 * @param {object} params - same shape as createIncident's params.
 * @returns {object|null} the updated incident, serialized, or null.
 */
function updateIncident(phoneHash, id, params = {}) {
  const existing = getIncident(phoneHash, id);
  if (!existing) return null;

  const merged = {
    incidentDate: params.incidentDate !== undefined ? params.incidentDate : existing.incidentDate,
    incidentTime: params.incidentTime !== undefined ? params.incidentTime : existing.incidentTime,
    incidentType: params.incidentType !== undefined ? params.incidentType : existing.incidentType,
    description: params.description !== undefined ? params.description : existing.description,
    actionTaken: params.actionTaken !== undefined ? params.actionTaken : existing.actionTaken,
  };
  validateFields('updateIncident', merged);

  const db = getDb();
  db.prepare(
    `UPDATE incidents
     SET incident_date = ?, incident_time = ?, incident_type = ?, description = ?, action_taken = ?,
         updated_at = datetime('now')
     WHERE id = ? AND phone_hash = ?`
  ).run(
    merged.incidentDate,
    merged.incidentTime,
    merged.incidentType,
    merged.description.trim(),
    merged.actionTaken.trim(),
    id,
    phoneHash
  );

  return getIncident(phoneHash, id);
}

module.exports = {
  MAX_DESCRIPTION_LENGTH,
  MAX_ACTION_LENGTH,
  isValidIncidentDate,
  isValidIncidentTime,
  createIncident,
  getIncident,
  listIncidents,
  updateIncident,
};