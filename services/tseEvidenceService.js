'use strict';

/**
 * TSE (Teacher Support Evidence) Evidence Engine (Migration 034, rebuilt
 * Sprint 1 — see docs/SA_Teacher_Evidence_Engine_Spec.md).
 *
 * Six existing write paths call tagEvidence() after a successful save,
 * so every piece of teaching activity a teacher already produces
 * (worksheets, assessments, reports, intervention plans, curriculum
 * coverage, observations) is silently indexed into one queryable table
 * without duplicating any of that data.
 *
 * Categories (fixed vocabulary — MY GROWTH / dashboard both key off
 * these exact strings):
 *   'curriculum'   — curriculum_coverage rows (markTopicCovered)
 *   'assessment'   — assessments rows (storeAssessment) + reports rows
 *                    (saveReport, for diagnostic/hod/parent reports)
 *   'intervention' — intervention_plans rows (saveInterventionPlan)
 *   'observation'  — observation_assessments rows (saveObservationSubmission)
 *   'resource'     — saved_resources rows (saveResource) — worksheets,
 *                    lesson plans, etc.; kept separate from 'assessment'
 *                    since a worksheet isn't assessment evidence.
 *
 * Design choices:
 *   - tagEvidence() never throws to its caller. Evidence tagging is a
 *     secondary effect of a write that already succeeded; a bug here
 *     must not roll back or fail the primary save. Errors are logged
 *     and swallowed.
 *   - Idempotent by construction: tse_evidence_links has a
 *     UNIQUE(source_table, source_id, category) constraint (Migration
 *     034), and tagEvidence() uses INSERT OR IGNORE, so calling it
 *     twice for the same row (e.g. live hook + backfill re-run) is safe.
 */

const { getDb } = require('../utils/database');
const { getCurrentTerm } = require('./schoolCalendarRepository');

const VALID_CATEGORIES = [
  'curriculum',
  'assessment',
  'intervention',
  'observation',
  'resource',
];

/**
 * Tags one source row as evidence. Safe to call more than once for the
 * same (sourceTable, sourceId, category) — later calls are no-ops.
 *
 * @param {string} phoneHash
 * @param {string} category - one of VALID_CATEGORIES
 * @param {string} sourceTable - e.g. 'assessments', 'curriculum_coverage'
 * @param {number} sourceId - the row id in sourceTable
 * @param {number|null} [term] - defaults to the current term (school_calendar)
 * @returns {boolean} true if a new row was inserted, false otherwise
 *   (including on any internal error — never throws)
 */
function tagEvidence(phoneHash, category, sourceTable, sourceId, term = null) {
  try {
    if (!phoneHash || !sourceTable || sourceId == null) {
      console.error('[TSE] tagEvidence: missing required field, skipping', {
        phoneHash: !!phoneHash,
        sourceTable,
        sourceId,
      });
      return false;
    }
    if (!VALID_CATEGORIES.includes(category)) {
      console.error(`[TSE] tagEvidence: unknown category "${category}", skipping`);
      return false;
    }

    const resolvedTerm = term ?? getCurrentTerm();
    const db = getDb();
    const result = db
      .prepare(
        `INSERT OR IGNORE INTO tse_evidence_links
           (phone_hash, category, source_table, source_id, term)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(phoneHash, category, sourceTable, sourceId, resolvedTerm);

    return result.changes > 0;
  } catch (err) {
    // Never let evidence tagging break the caller's primary write.
    console.error('[TSE] tagEvidence failed (non-fatal):', err.message);
    return false;
  }
}

/**
 * Returns a teacher's evidence snapshot — category counts plus the
 * most recent items per category. Powers both GET /api/tse/status and
 * the WhatsApp MY GROWTH command.
 *
 * @param {string} phoneHash
 * @returns {{
 *   counts: Record<string, number>,
 *   latest: Record<string, Array<{sourceId:number, sourceTable:string, createdAt:string, term:number|null}>>,
 *   missingCategories: string[]
 * }}
 */
function getStatusSnapshot(phoneHash) {
  const db = getDb();

  const countRows = db
    .prepare(
      `SELECT category, COUNT(*) as count
       FROM tse_evidence_links
       WHERE phone_hash = ?
       GROUP BY category`
    )
    .all(phoneHash);

  const counts = {};
  for (const cat of VALID_CATEGORIES) counts[cat] = 0;
  for (const row of countRows) counts[row.category] = row.count;

  const latest = {};
  for (const cat of VALID_CATEGORIES) {
    latest[cat] = db
      .prepare(
        `SELECT source_table, source_id, term, created_at
         FROM tse_evidence_links
         WHERE phone_hash = ? AND category = ?
         ORDER BY id DESC
         LIMIT 5`
      )
      .all(phoneHash, cat)
      .map((r) => ({
        sourceTable: r.source_table,
        sourceId: r.source_id,
        term: r.term,
        createdAt: r.created_at,
      }));
  }

  const missingCategories = VALID_CATEGORIES.filter((cat) => counts[cat] === 0);

  return { counts, latest, missingCategories };
}

module.exports = {
  VALID_CATEGORIES,
  tagEvidence,
  getStatusSnapshot,
};
