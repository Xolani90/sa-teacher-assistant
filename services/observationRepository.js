'use strict';

/**
 * Observation repository (Foundation Phase) — Phase 6.
 *
 * Persistence layer over observation_assessments / observation_records.
 * Mirrors the shape of teacherWorkspaceService.js's saveResource() /
 * getSavedResource(): manual BEGIN/COMMIT/ROLLBACK (not db.transaction())
 * for compatibility with both better-sqlite3 (production) and the
 * node:sqlite test shim used elsewhere in this test suite.
 *
 * Supports: save, retrieve, append-note, correct (insert-only "supersedes"
 * model — see saveObservationSubmission's correctsAssessmentId), delete,
 * and resolve-followup. There is still no true in-place UPDATE of a
 * record's core fields (learner/domain/status) — a correction is always
 * a brand-new assessment row that supersedes the old one, not a mutation
 * of it. This keeps the insert-only audit trail intact.
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
const { resolveLearner } = require('./learnerIdentityService');
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
 * @param {number|null} [classId] - Resolved class context per ADR-004
 *   (0/1/2+ class rule). Null for teachers with 0 classes (zero-class
 *   policy) — the assessment and its learners land in the unclassed
 *   bucket.
 * @param {number|null} [correctsAssessmentId] - If set, this submission
 *   is a correction of an earlier assessment. The original is never
 *   mutated or deleted (insert-only pattern) — it is simply marked as
 *   superseded by virtue of this new row pointing back at it via
 *   corrects_assessment_id. getObservationHistory() hides superseded
 *   assessments by default; getObservationAssessment() on the original
 *   still returns it, with supersededByAssessmentId set, so nothing is
 *   silently lost. Ownership of the original is verified — a teacher
 *   cannot "correct" another teacher's assessment.
 * @returns {{ assessmentId: number, recordCount: number }}
 */
function saveObservationSubmission(phoneHash, header, records, classId = null, correctsAssessmentId = null) {
  const db = getDb();

  if (!phoneHash) {
    throw new Error('saveObservationSubmission: phoneHash must not be null or empty');
  }
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('saveObservationSubmission: records must be a non-empty array');
  }

  if (correctsAssessmentId != null) {
    const original = db.prepare(`
      SELECT id, phone_hash FROM observation_assessments WHERE id = ?
    `).get(correctsAssessmentId);
    if (!original) {
      throw new Error('saveObservationSubmission: corrects_assessment_id does not reference an existing assessment');
    }
    if (original.phone_hash !== phoneHash) {
      throw new Error("saveObservationSubmission: cannot correct another teacher's assessment");
    }
    // Cycle 20 fix: the flow layer (flows/observationFlow.js) only blocks
    // re-correcting an already-superseded assessment using a CACHED
    // supersededByAssessmentId captured when the detail view was shown —
    // that cache goes stale the moment a first correction lands while a
    // second correction of the same original is already in flight (e.g.
    // a duplicate/rapid resend of DONE). Without this check both
    // succeeded, leaving the original with two undistinguished
    // "corrector" rows — the older one silently visible in
    // getObservationHistory() as if it were current, with nothing
    // marking it stale. Re-check here, inside the same authoritative
    // path every caller goes through, rather than trusting the flow's
    // cached read.
    const existingCorrector = db.prepare(`
      SELECT id FROM observation_assessments WHERE corrects_assessment_id = ?
    `).get(correctsAssessmentId);
    if (existingCorrector) {
      throw new Error('saveObservationSubmission: this assessment has already been corrected by another submission');
    }
  }

  try {
    let assessmentId;
    try {
      db.prepare('BEGIN').run();

      const assessmentResult = db.prepare(`
        INSERT INTO observation_assessments (phone_hash, grade, subject, assessment_name, class_id, corrects_assessment_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        phoneHash,
        header?.grade ?? null,
        header?.subject ?? null,
        header?.assessment ?? null,
        classId,
        correctsAssessmentId
      );

      assessmentId = assessmentResult.lastInsertRowid;

      const insertRecord = db.prepare(`
        INSERT INTO observation_records (assessment_id, learner_name, domain, developmental_status, notes, learner_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const record of records) {
        // resolveLearner() runs plain statements against this same `db`
        // connection — it does not open its own transaction, so this
        // insert participates in the BEGIN already open above (ADR-003
        // Implementation Addendum, Principle 3). classId is resolved by
        // the calling flow per ADR-004 (0/1/2+ class rule); null only for
        // teachers with 0 classes (zero-class policy), in which case the
        // learner lands in the unclassed bucket
        // (idx_learners_identity_unclassed).
        const learner = resolveLearner({
          phoneHash,
          classId,
          learnerName: record.learnerName,
        });

        insertRecord.run(
          assessmentId,
          record.learnerName,
          record.domain,
          record.developmentalStatus,
          record.notes ?? null,
          learner.id
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

    // TSE Evidence Engine (Migration 034): tag as 'observation' evidence.
    // Deliberately after COMMIT, not inside the transaction — a tagging
    // failure must not roll back an already-durable observation save.
    try {
      require('./tseEvidenceService').tagEvidence(
        phoneHash,
        'observation',
        'observation_assessments',
        assessmentId
      );
    } catch (evidenceErr) {
      console.error('[TSE] saveObservationSubmission evidence tagging failed:', evidenceErr.message);
    }

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
 *   classId: number|null,
 *   correctsAssessmentId: number|null,
 *   supersededByAssessmentId: number|null,
 *   createdAt: string,
 *   records: Array<{ id: number, learnerName: string, domain: string, developmentalStatus: string, notes: string|null, resolved: boolean }>
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

    // A given assessment can be corrected at most once — enforced in
    // saveObservationSubmission (Cycle 20), not just by the flow's
    // cached check — so this LIMIT 1 is a defensive tiebreak only,
    // not a fallback for a reachable multi-corrector state.
    const supersededByRow = db.prepare(`
      SELECT id FROM observation_assessments WHERE corrects_assessment_id = ? ORDER BY id DESC LIMIT 1
    `).get(assessmentId);

    return {
      id: assessmentRow.id,
      phoneHash: assessmentRow.phone_hash,
      grade: assessmentRow.grade,
      subject: assessmentRow.subject,
      assessmentName: assessmentRow.assessment_name,
      classId: assessmentRow.class_id,
      correctsAssessmentId: assessmentRow.corrects_assessment_id,
      supersededByAssessmentId: supersededByRow ? supersededByRow.id : null,
      createdAt: assessmentRow.created_at,
      records: recordRows.map((r) => ({
        id: r.id,
        learnerName: r.learner_name,
        domain: r.domain,
        developmentalStatus: r.developmental_status,
        notes: r.notes,
        resolved: !!r.resolved,
      })),
    };
  } catch (err) {
    logger.error('Failed to retrieve observation assessment', { assessmentId, error: err.message });
    throw err;
  }
}

/**
 * Appends a timestamped note to an existing observation record.
 * Verifies the record belongs to the calling teacher before writing —
 * a phoneHash mismatch throws rather than silently no-op'ing, since
 * that would indicate either a bug or a cross-teacher data leak attempt.
 *
 * Existing notes are preserved and the new note is appended on a new
 * line with a date stamp, rather than overwritten — a teacher adding a
 * follow-up observation later shouldn't lose what they wrote initially.
 *
 * @param {number} recordId
 * @param {string} phoneHash - Calling teacher's phone hash, for ownership check
 * @param {string} noteText
 * @returns {{ recordId: number, notes: string }|null} null if record not found
 */
function appendObservationNote(recordId, phoneHash, noteText) {
  const db = getDb();

  if (!recordId) {
    throw new Error('appendObservationNote: recordId is required');
  }
  if (!noteText || !noteText.trim()) {
    throw new Error('appendObservationNote: noteText must not be empty');
  }

  try {
    const row = db.prepare(`
      SELECT r.id, r.notes, a.phone_hash
      FROM observation_records r
      JOIN observation_assessments a ON a.id = r.assessment_id
      WHERE r.id = ?
    `).get(recordId);

    if (!row) return null;

    if (row.phone_hash !== phoneHash) {
      throw new Error('appendObservationNote: record does not belong to this teacher');
    }

    const dateStamp = new Date().toISOString().slice(0, 10);
    const addition = `[${dateStamp}] ${noteText.trim()}`;
    const updatedNotes = row.notes ? `${row.notes}\n${addition}` : addition;

    db.prepare(`UPDATE observation_records SET notes = ? WHERE id = ?`).run(updatedNotes, recordId);

    logger.info('Observation note appended', { phoneHash, recordId });

    return { recordId, notes: updatedNotes };
  } catch (err) {
    logger.error('Failed to append observation note', { phoneHash, recordId, error: err.message });
    throw err;
  }
}

/**
 * Permanently deletes an observation assessment and all its records.
 * Ownership is verified before deleting — a phoneHash mismatch throws
 * rather than silently no-op'ing.
 *
 * Note: if this assessment has been corrected by a later one (i.e. some
 * other row's corrects_assessment_id points at this id), deleting it
 * does not touch or remove that linked row — only its
 * corrects_assessment_id link back to this assessment is cleared, in
 * the same transaction, before the delete runs. utils/database.js runs
 * with PRAGMA foreign_keys = ON, so corrects_assessment_id (declared
 * with REFERENCES observation_assessments(id)) is a real, enforced FK —
 * deleting a referenced row without first clearing that link would
 * throw a raw "FOREIGN KEY constraint failed" error rather than the
 * clean, documented "just behaves like no correction found" outcome.
 * Clearing the link explicitly is what actually delivers that intended
 * behavior: getObservationAssessment()/getObservationHistory() resolve
 * correctsAssessmentId/supersededByAssessmentId via a fresh id lookup
 * each time, so once the link is cleared it reads exactly like the
 * correction was always standalone. If this assessment is itself a
 * correction of another one (this row's own corrects_assessment_id is
 * set), that column is simply removed along with the rest of the row —
 * nothing else references it via that FK, so no clearing is needed on
 * that side.
 *
 * @param {number} assessmentId
 * @param {string} phoneHash - Calling teacher's phone hash, for ownership check
 * @returns {{ assessmentId: number, deleted: true }|null} null if not found
 */
function deleteObservationAssessment(assessmentId, phoneHash) {
  const db = getDb();

  if (!assessmentId) {
    throw new Error('deleteObservationAssessment: assessmentId is required');
  }
  if (!phoneHash) {
    throw new Error('deleteObservationAssessment: phoneHash must not be null or empty');
  }

  try {
    const row = db.prepare(`
      SELECT id, phone_hash FROM observation_assessments WHERE id = ?
    `).get(assessmentId);

    if (!row) return null;

    if (row.phone_hash !== phoneHash) {
      throw new Error('deleteObservationAssessment: assessment does not belong to this teacher');
    }

    try {
      db.prepare('BEGIN').run();
      // Clear any forward references to this row BEFORE deleting it —
      // required under PRAGMA foreign_keys = ON (see docstring above).
      db.prepare('UPDATE observation_assessments SET corrects_assessment_id = NULL WHERE corrects_assessment_id = ?').run(assessmentId);
      db.prepare('DELETE FROM observation_records WHERE assessment_id = ?').run(assessmentId);
      db.prepare('DELETE FROM observation_assessments WHERE id = ?').run(assessmentId);
      db.prepare('COMMIT').run();
    } catch (txErr) {
      try { db.prepare('ROLLBACK').run(); } catch (_) { /* best-effort */ }
      throw txErr;
    }

    logger.info('Observation assessment deleted', { phoneHash, assessmentId });

    return { assessmentId, deleted: true };
  } catch (err) {
    logger.error('Failed to delete observation assessment', { phoneHash, assessmentId, error: err.message });
    throw err;
  }
}

/**
 * Marks a single observation record's follow-up as resolved. This is a
 * one-way flag (no "unresolve") — a teacher who marked something
 * resolved by mistake can still see it in the record list (it just
 * carries a "resolved" tag there instead of showing under "Needs
 * follow-up"), so nothing is destructively lost.
 *
 * Ownership is verified before writing — a phoneHash mismatch throws
 * rather than silently no-op'ing.
 *
 * @param {number} recordId
 * @param {string} phoneHash - Calling teacher's phone hash, for ownership check
 * @returns {{ recordId: number, resolved: true }|null} null if record not found
 */
function resolveObservationRecord(recordId, phoneHash) {
  const db = getDb();

  if (!recordId) {
    throw new Error('resolveObservationRecord: recordId is required');
  }
  if (!phoneHash) {
    throw new Error('resolveObservationRecord: phoneHash must not be null or empty');
  }

  try {
    const row = db.prepare(`
      SELECT r.id, a.phone_hash
      FROM observation_records r
      JOIN observation_assessments a ON a.id = r.assessment_id
      WHERE r.id = ?
    `).get(recordId);

    if (!row) return null;

    if (row.phone_hash !== phoneHash) {
      throw new Error('resolveObservationRecord: record does not belong to this teacher');
    }

    db.prepare(`UPDATE observation_records SET resolved = 1 WHERE id = ?`).run(recordId);

    logger.info('Observation record resolved', { phoneHash, recordId });

    return { recordId, resolved: true };
  } catch (err) {
    logger.error('Failed to resolve observation record', { phoneHash, recordId, error: err.message });
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
 * @param {{ grade?: string, subject?: string, learnerName?: string, limit?: number, includeSuperseded?: boolean }} [filters]
 *   learnerName is matched case-insensitively, consistent with
 *   observationGroupingService.js's groupByLearner() dedup convention —
 *   "sipho" and "Sipho" are the same learner throughout this pipeline.
 *   includeSuperseded (default false): an assessment that has since been
 *   corrected (see saveObservationSubmission's correctsAssessmentId) is
 *   excluded from the list by default, since the corrected version is
 *   what the teacher actually wants to see going forward. The original
 *   row is never deleted, so it's still reachable via
 *   getObservationAssessment() directly, or by passing includeSuperseded.
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

    // Excludes assessments that have since been corrected (another row
    // pointing back at this one via corrects_assessment_id) unless the
    // caller explicitly opts in — see filters.includeSuperseded above.
    if (!filters.includeSuperseded) {
      query += ` AND NOT EXISTS (
        SELECT 1 FROM observation_assessments s WHERE s.corrects_assessment_id = a.id
      )`;
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
  appendObservationNote,
  deleteObservationAssessment,
  resolveObservationRecord,
};
