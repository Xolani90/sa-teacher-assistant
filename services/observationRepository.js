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

module.exports = {
  saveObservationSubmission,
  getObservationAssessment,
};
