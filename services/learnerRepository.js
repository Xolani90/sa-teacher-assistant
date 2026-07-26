'use strict';

/**
 * Learner repository (ADR-003 Phase 1, PR1).
 *
 * Pure persistence/retrieval layer over `learners`, `learner_results`, and
 * `observation_records`. This module deliberately does NOT perform identity
 * resolution — that responsibility stays in services/learnerIdentityService.js
 * (resolveLearner()). Callers that need to resolve-then-record (e.g. writing
 * a new assessment or observation) should call resolveLearner() themselves
 * and pass the resulting learner_id to whatever insert path they already use
 * (services/diagnosticWorkflowService.js, services/observationRepository.js).
 * This repository is for READS: turning learner_id into history.
 *
 * Important schema note: assessment history and observation history do NOT
 * share a parent table. learner_results.assessment_id -> assessments.id
 * (scoped by assessments.phone_hash), while observation_records.assessment_id
 * -> observation_assessments.id (scoped by observation_assessments.phone_hash).
 * There is no single query that safely joins both without either duplicating
 * rows or silently dropping one side, so getLearnerHistory() runs two
 * separate, focused queries and merges them in application code rather than
 * attempting one combined SQL query. getClassHistory() follows the same
 * principle and returns the two lists separately rather than pre-merging —
 * merging/sorting/normalizing for presentation is left to a future
 * services/learnerTimelineService.js (ADR-003 PR3), not this repository.
 *
 * Observation history here excludes superseded assessments by default
 * (mirrors services/observationRepository.js's getObservationHistory()) —
 * a corrected observation submission is a new insert-only row that points
 * back at the original via corrects_assessment_id, and the original should
 * not double-count in a learner's timeline once superseded.
 *
 * No mastery/trend/analytics logic belongs here — that is explicitly out of
 * scope for this PR (see ADR-003 Phase 1 discussion). Keep this module a
 * thin, well-tested data-access layer.
 */

const { getDb } = require('../utils/database');
const logger = require('../utils/logger').child({ module: 'learnerRepository' });

/**
 * Fetches a single learner by id.
 *
 * @param {number} learnerId
 * @returns {{id:number, phoneHash:string, classId:number|null, canonicalName:string, normalizedName:string, createdAt:string, updatedAt:string}|null}
 */
function getLearnerById(learnerId) {
  if (!learnerId) {
    throw new Error('getLearnerById: learnerId must not be null or empty');
  }

  const db = getDb();

  try {
    const row = db.prepare(`SELECT * FROM learners WHERE id = ?`).get(learnerId);
    if (!row) return null;

    return {
      id: row.id,
      phoneHash: row.phone_hash,
      classId: row.class_id,
      canonicalName: row.canonical_name,
      normalizedName: row.normalized_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch (err) {
    logger.error('Failed to fetch learner by id', { learnerId, error: err.message });
    throw err;
  }
}

/**
 * Chronological assessment (learner_results) history for one learner.
 * Returns [] for a learner with no assessment rows, or an unknown/invalid
 * learnerId — this repository never throws on "no results found", only on
 * missing/invalid arguments or a genuine DB error.
 *
 * @param {number} learnerId
 * @returns {Array<object>} normalized assessment events, newest first
 */
function getAssessmentHistory(learnerId) {
  if (!learnerId) {
    throw new Error('getAssessmentHistory: learnerId must not be null or empty');
  }

  const db = getDb();

  try {
    const rows = db.prepare(`
      SELECT
        lr.id             AS result_id,
        lr.assessment_id  AS assessment_id,
        lr.learner_id     AS learner_id,
        lr.learner_name   AS learner_name,
        lr.mark           AS mark,
        lr.total_marks    AS total_marks,
        lr.percentage     AS percentage,
        lr.created_at     AS created_at,
        a.title           AS title,
        a.grade           AS grade,
        a.subject         AS subject,
        a.term            AS term,
        a.assessment_type AS assessment_type,
        a.blueprint_id    AS blueprint_id,
        a.blueprint_version AS blueprint_version
      FROM learner_results lr
      JOIN assessments a ON a.id = lr.assessment_id
      WHERE lr.learner_id = ?
      ORDER BY lr.created_at DESC, lr.id DESC
    `).all(learnerId);

    return rows.map((row) => ({
      type: 'assessment',
      resultId: row.result_id,
      assessmentId: row.assessment_id,
      learnerId: row.learner_id,
      learnerName: row.learner_name,
      createdAt: row.created_at,
      title: row.title,
      grade: row.grade,
      subject: row.subject,
      term: row.term,
      assessmentType: row.assessment_type,
      mark: row.mark,
      totalMarks: row.total_marks,
      percentage: row.percentage,
      // Additive (non-breaking) field, added alongside CoverageService
      // (ADR-007 §3.2): lets downstream services resolve which CAPS
      // topics an assessment actually covered via
      // blueprintRepository.getBlueprintById(). NULL for assessments not
      // backed by a blueprint — that's a valid, expected state, not an
      // error; such events simply carry no topic-level detail.
      blueprintId: row.blueprint_id,
      blueprintVersion: row.blueprint_version,
    }));
  } catch (err) {
    logger.error('Failed to fetch assessment history', { learnerId, error: err.message });
    throw err;
  }
}

/**
 * Chronological observation history for one learner. Excludes observation
 * assessments that have since been superseded by a correction, unless
 * options.includeSuperseded is true.
 *
 * @param {number} learnerId
 * @param {{includeSuperseded?: boolean}} [options]
 * @returns {Array<object>} normalized observation events, newest first
 */
function getObservationHistory(learnerId, options = {}) {
  if (!learnerId) {
    throw new Error('getObservationHistory: learnerId must not be null or empty');
  }

  const db = getDb();

  try {
    let query = `
      SELECT
        r.id                    AS record_id,
        r.assessment_id         AS assessment_id,
        r.learner_id            AS learner_id,
        r.learner_name          AS learner_name,
        r.domain                AS domain,
        r.developmental_status  AS developmental_status,
        r.notes                 AS notes,
        r.created_at            AS created_at,
        oa.grade                AS grade,
        oa.subject              AS subject,
        oa.assessment_name      AS title
      FROM observation_records r
      JOIN observation_assessments oa ON oa.id = r.assessment_id
      WHERE r.learner_id = ?
    `;

    if (!options.includeSuperseded) {
      query += ` AND NOT EXISTS (
        SELECT 1 FROM observation_assessments s
        WHERE s.corrects_assessment_id = oa.id
      )`;
    }

    query += ` ORDER BY r.created_at DESC, r.id DESC`;

    const rows = db.prepare(query).all(learnerId);

    return rows.map((row) => ({
      type: 'observation',
      recordId: row.record_id,
      assessmentId: row.assessment_id,
      learnerId: row.learner_id,
      learnerName: row.learner_name,
      createdAt: row.created_at,
      title: row.title,
      grade: row.grade,
      subject: row.subject,
      domain: row.domain,
      developmentalStatus: row.developmental_status,
      notes: row.notes,
    }));
  } catch (err) {
    logger.error('Failed to fetch observation history', { learnerId, error: err.message });
    throw err;
  }
}

/**
 * Merged, chronologically sorted history for one learner: assessments and
 * observations combined into a single normalized event list. Composes
 * getAssessmentHistory() and getObservationHistory() rather than issuing
 * its own SQL — see module header for why the two are not joined directly.
 *
 * @param {number} learnerId
 * @param {{includeSuperseded?: boolean, limit?: number}} [options]
 * @returns {Array<object>} merged events, newest first
 */
function getLearnerHistory(learnerId, options = {}) {
  if (!learnerId) {
    throw new Error('getLearnerHistory: learnerId must not be null or empty');
  }

  const assessmentEvents = getAssessmentHistory(learnerId);
  const observationEvents = getObservationHistory(learnerId, {
    includeSuperseded: options.includeSuperseded,
  });

  // Both lists are already individually sorted DESC; a simple merge sort
  // by createdAt (with id as a tiebreak within each type) keeps this cheap
  // and deterministic even when two events share the same second-resolution
  // timestamp across the two source tables.
  const merged = [...assessmentEvents, ...observationEvents].sort((a, b) => {
    if (a.createdAt !== b.createdAt) {
      return a.createdAt < b.createdAt ? 1 : -1;
    }
    // Deterministic tiebreak: assessments before observations, then by id.
    if (a.type !== b.type) return a.type === 'assessment' ? -1 : 1;
    const aId = a.resultId ?? a.recordId;
    const bId = b.resultId ?? b.recordId;
    return bId - aId;
  });

  return typeof options.limit === 'number' ? merged.slice(0, options.limit) : merged;
}

/**
 * Most recent N assessment events for one learner. Thin convenience wrapper
 * over getAssessmentHistory() — kept separate rather than a `limit` option
 * on getAssessmentHistory() itself so the SQL LIMIT applies directly rather
 * than fetching full history and slicing in JS.
 *
 * @param {number} learnerId
 * @param {number} [limit=10]
 * @returns {Array<object>}
 */
function getRecentAssessments(learnerId, limit = 10) {
  if (!learnerId) {
    throw new Error('getRecentAssessments: learnerId must not be null or empty');
  }

  const db = getDb();

  try {
    const rows = db.prepare(`
      SELECT
        lr.id             AS result_id,
        lr.assessment_id  AS assessment_id,
        lr.learner_id     AS learner_id,
        lr.learner_name   AS learner_name,
        lr.mark           AS mark,
        lr.total_marks    AS total_marks,
        lr.percentage     AS percentage,
        lr.created_at     AS created_at,
        a.title           AS title,
        a.grade           AS grade,
        a.subject         AS subject,
        a.term            AS term,
        a.assessment_type AS assessment_type
      FROM learner_results lr
      JOIN assessments a ON a.id = lr.assessment_id
      WHERE lr.learner_id = ?
      ORDER BY lr.created_at DESC, lr.id DESC
      LIMIT ?
    `).all(learnerId, limit);

    return rows.map((row) => ({
      type: 'assessment',
      resultId: row.result_id,
      assessmentId: row.assessment_id,
      learnerId: row.learner_id,
      learnerName: row.learner_name,
      createdAt: row.created_at,
      title: row.title,
      grade: row.grade,
      subject: row.subject,
      term: row.term,
      assessmentType: row.assessment_type,
      mark: row.mark,
      totalMarks: row.total_marks,
      percentage: row.percentage,
    }));
  } catch (err) {
    logger.error('Failed to fetch recent assessments', { learnerId, error: err.message });
    throw err;
  }
}

/**
 * All history for a class, split by type rather than merged — merging is
 * a presentation decision left to services/learnerTimelineService.js
 * (ADR-003 PR3). classId isolation happens via the learners table (each
 * learner row already carries the class_id it was resolved under), so
 * this joins learner_results/observation_records through learners rather
 * than through assessments/observation_assessments, which have no
 * class_id column of their own.
 *
 * @param {number} classId
 * @param {{includeSuperseded?: boolean}} [options]
 * @returns {{assessments: Array<object>, observations: Array<object>}}
 */
function getClassHistory(classId, options = {}) {
  if (!classId) {
    throw new Error('getClassHistory: classId must not be null or empty');
  }

  const db = getDb();

  try {
    const assessmentRows = db.prepare(`
      SELECT
        lr.id             AS result_id,
        lr.assessment_id  AS assessment_id,
        lr.learner_id     AS learner_id,
        lr.learner_name   AS learner_name,
        lr.mark           AS mark,
        lr.total_marks    AS total_marks,
        lr.percentage     AS percentage,
        lr.created_at     AS created_at,
        a.title           AS title,
        a.grade           AS grade,
        a.subject         AS subject,
        a.term            AS term,
        a.assessment_type AS assessment_type
      FROM learner_results lr
      JOIN learners l ON l.id = lr.learner_id
      JOIN assessments a ON a.id = lr.assessment_id
      WHERE l.class_id = ?
      ORDER BY lr.created_at DESC, lr.id DESC
    `).all(classId);

    let observationQuery = `
      SELECT
        r.id                    AS record_id,
        r.assessment_id         AS assessment_id,
        r.learner_id            AS learner_id,
        r.learner_name          AS learner_name,
        r.domain                AS domain,
        r.developmental_status  AS developmental_status,
        r.notes                 AS notes,
        r.created_at            AS created_at,
        oa.grade                AS grade,
        oa.subject              AS subject,
        oa.assessment_name      AS title
      FROM observation_records r
      JOIN learners l ON l.id = r.learner_id
      JOIN observation_assessments oa ON oa.id = r.assessment_id
      WHERE l.class_id = ?
    `;

    if (!options.includeSuperseded) {
      observationQuery += ` AND NOT EXISTS (
        SELECT 1 FROM observation_assessments s
        WHERE s.corrects_assessment_id = oa.id
      )`;
    }

    observationQuery += ` ORDER BY r.created_at DESC, r.id DESC`;

    const observationRows = db.prepare(observationQuery).all(classId);

    return {
      assessments: assessmentRows.map((row) => ({
        type: 'assessment',
        resultId: row.result_id,
        assessmentId: row.assessment_id,
        learnerId: row.learner_id,
        learnerName: row.learner_name,
        createdAt: row.created_at,
        title: row.title,
        grade: row.grade,
        subject: row.subject,
        term: row.term,
        assessmentType: row.assessment_type,
        mark: row.mark,
        totalMarks: row.total_marks,
        percentage: row.percentage,
      })),
      observations: observationRows.map((row) => ({
        type: 'observation',
        recordId: row.record_id,
        assessmentId: row.assessment_id,
        learnerId: row.learner_id,
        learnerName: row.learner_name,
        createdAt: row.created_at,
        title: row.title,
        grade: row.grade,
        subject: row.subject,
        domain: row.domain,
        developmentalStatus: row.developmental_status,
        notes: row.notes,
      })),
    };
  } catch (err) {
    logger.error('Failed to fetch class history', { classId, error: err.message });
    throw err;
  }
}

module.exports = {
  getLearnerById,
  getAssessmentHistory,
  getObservationHistory,
  getLearnerHistory,
  getRecentAssessments,
  getClassHistory,
};
