'use strict';

/**
 * Observation repository (Foundation Phase) — Phase 6.
 *
 * Thin persistence layer over observation_assessments / observation_records.
 * Mirrors the shape of teacherWorkspaceService.js's saveResource() /
 * getSavedResource(): manual BEGIN/COMMIT/ROLLBACK (not db.transaction())
 * for compatibility with both better-sqlite3 (production) and the
 * node:sqlite test shim used elsewhere in this test suite.
 *
 * Deliberately minimal: save + retrieve only. No update, delete, search,
 * or listing yet — those are Phase 7+.
 *
 * Callers are expected to pass the header + records shape produced by
 * utils/observationWorkflowService.js's processObservationSubmission()
 * (specifically result.header and result.records) after deciding to
 * persist — this repository never calls the workflow service itself,
 * and the workflow service never calls this repository. Persistence is
 * always an explicit decision made by the caller (e.g. a WhatsApp
 * handler), not a side effect of parsing/analysis.
 *
 * See: docs/foundation-phase-observation-pipeline.md
 */

const { getDb } = require('../utils/database');
const logger = require('../utils/logger').child({ module: 'observationRepository' });

/**
 * Persists one observation assessment and its records atomically.
 * If any record insert fails, the whole transaction (including the
 * assessment header row) is rolled back — no orphaned assessment with
 * zero records.
 *
 * @param {string} phoneHash - Teacher's phone hash
 * @param {{ assessment: string|null, grade: string|null, subject: string|null }} header
 * @param {Array<{ learnerName: string, domain: string, developmentalStatus: string, notes: string|null }>} records
 * @returns {{ assessmentId: number, recordCount: number }}
 */
function saveObservationSubmission(phoneHash, header, records) {
  const db = getDb();

  if (!phoneHash) {
    throw new Error('saveObservationSubmission: phoneHash must not be null or empty');
  }
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('saveObservationSubmission: records must be a non-empty array');
  }

  try {
    let assessmentId;
    try {
      db.prepare('BEGIN').run();

      const assessmentResult = db.prepare(`
        INSERT INTO observation_assessments (phone_hash, grade, subject, assessment_name)
        VALUES (?, ?, ?, ?)
      `).run(
        phoneHash,
        header?.grade ?? null,
        header?.subject ?? null,
        header?.assessment ?? null
      );

      assessmentId = assessmentResult.lastInsertRowid;

      const insertRecord = db.prepare(`
        INSERT INTO observation_records (assessment_id, learner_name, domain, developmental_status, notes)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const record of records) {
        insertRecord.run(
          assessmentId,
          record.learnerName,
          record.domain,
          record.developmentalStatus,
          record.notes ?? null
        );
      }

      db.prepare('COMMIT').run();
    } catch (txErr) {
      try { db.prepare('ROLLBACK').run(); } catch (_) { /* best-effort */ }
      throw txErr;
    }

    logger.info('Observation submission saved', {
      phoneHash,
      assessmentId,
      recordCount: records.length,
    });

    return { assessmentId, recordCount: records.length };
  } catch (err) {
    logger.error('Failed to save observation submission', { phoneHash, error: err.message });
    throw err;
  }
}

/**
 * Retrieves one observation assessment and all its records.
 *
 * @param {number} assessmentId
 * @returns {{
 *   id: number,
 *   phoneHash: string,
 *   grade: string|null,
 *   subject: string|null,
 *   assessmentName: string|null,
 *   createdAt: string,
 *   records: Array<{ learnerName: string, domain: string, developmentalStatus: string, notes: string|null }>
 * }|null}
 */
function getObservationAssessment(assessmentId) {
  const db = getDb();

  try {
    const assessmentRow = db.prepare(`
      SELECT * FROM observation_assessments WHERE id = ?
    `).get(assessmentId);

    if (!assessmentRow) return null;

    const recordRows = db.prepare(`
      SELECT * FROM observation_records WHERE assessment_id = ? ORDER BY id ASC
    `).all(assessmentId);

    return {
      id: assessmentRow.id,
      phoneHash: assessmentRow.phone_hash,
      grade: assessmentRow.grade,
      subject: assessmentRow.subject,
      assessmentName: assessmentRow.assessment_name,
      createdAt: assessmentRow.created_at,
      records: recordRows.map((r) => ({
        learnerName: r.learner_name,
        domain: r.domain,
        developmentalStatus: r.developmental_status,
        notes: r.notes,
      })),
    };
  } catch (err) {
    logger.error('Failed to retrieve observation assessment', { assessmentId, error: err.message });
    throw err;
  }
}

/**
 * Retrieves a teacher's observation assessment history, most recent first.
 * Phase 7. Teacher (phoneHash) is the primary axis — "by learner" and
 * "by assessment" are both just filters on top of this, not separate
 * repository methods, since observation_records has no phone_hash of its
 * own (it's scoped to a teacher only via its parent observation_assessments
 * row). Mirrors teacherWorkspaceService.js's getAssessmentHistory() in
 * query-building style (dynamic WHERE clauses + params array).
 *
 * @param {string} phoneHash - Teacher's phone hash
 * @param {{ grade?: string, subject?: string, learnerName?: string, limit?: number }} [filters]
 *   learnerName is matched case-insensitively, consistent with
 *   observationGroupingService.js's groupByLearner() dedup convention —
 *   "sipho" and "Sipho" are the same learner throughout this pipeline.
 * @returns {Array<{
 *   id: number,
 *   phoneHash: string,
 *   grade: string|null,
 *   subject: string|null,
 *   assessmentName: string|null,
 *   createdAt: string,
 *   recordCount: number,
 *   learnerCount: number
 * }>}
 */
function getObservationHistory(phoneHash, filters = {}) {
  const db = getDb();

  if (!phoneHash) {
    throw new Error('getObservationHistory: phoneHash must not be null or empty');
  }

  try {
    let query = `
      SELECT
        a.*,
        COUNT(r.id) as record_count,
        COUNT(DISTINCT r.learner_name) as learner_count
      FROM observation_assessments a
      LEFT JOIN observation_records r ON a.id = r.assessment_id
      WHERE a.phone_hash = ?
    `;
    const params = [phoneHash];

    if (filters.grade) {
      query += ` AND a.grade = ?`;
      params.push(filters.grade);
    }

    if (filters.subject) {
      query += ` AND a.subject = ?`;
      params.push(filters.subject);
    }

    // Subquery rather than filtering the LEFT JOIN directly — filtering the
    // join itself would silently drop this assessment's OTHER learners'
    // record_count/learner_count from the aggregate once WHERE narrows the
    // joined rows before GROUP BY runs. This keeps the counts accurate for
    // the whole assessment while still only returning assessments that
    // actually contain the named learner.
    if (filters.learnerName) {
      query += ` AND a.id IN (
        SELECT assessment_id FROM observation_records
        WHERE LOWER(learner_name) = LOWER(?)
      )`;
      params.push(filters.learnerName);
    }

    // id DESC tiebreak alongside created_at DESC: datetime('now') has
    // second-resolution, so two assessments saved within the same second
    // get identical created_at values and ordering by created_at alone is
    // non-deterministic on ties. Same fix already applied to saved_resources
    // — see phase-b2-hardening.test.js "B2-15: resource rows have
    // deterministic id DESC ordering when timestamps collide".
    query += ` GROUP BY a.id ORDER BY a.created_at DESC, a.id DESC`;

    if (filters.limit) {
      query += ` LIMIT ?`;
      params.push(filters.limit);
    }

    const rows = db.prepare(query).all(...params);

    const history = rows.map((row) => ({
      id: row.id,
      phoneHash: row.phone_hash,
      grade: row.grade,
      subject: row.subject,
      assessmentName: row.assessment_name,
      createdAt: row.created_at,
      recordCount: row.record_count,
      learnerCount: row.learner_count,
    }));

    logger.debug('Retrieved observation history', { phoneHash, count: history.length, filters });

    return history;
  } catch (err) {
    logger.error('Failed to retrieve observation history', { phoneHash, error: err.message });
    throw err;
  }
}

module.exports = {
  saveObservationSubmission,
  getObservationAssessment,
  getObservationHistory,
};
