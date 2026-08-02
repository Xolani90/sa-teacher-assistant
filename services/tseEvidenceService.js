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
 *
 * TSE Phase 4 (services/tseGrowthInsightService.js): getStatusSnapshot()
 * additionally attaches the rule-based evidence-gap layer — gaps,
 * strength, suggestedAction — computed from the real assessments /
 * curriculum_coverage / intervention_plans / observation_assessments
 * FK relationships. Same non-fatal convention as tagEvidence(): a
 * failure in the insight layer must never break the snapshot itself,
 * since getStatusSnapshot() already has real callers (MY GROWTH,
 * GET /api/tse/status) that need to keep working even if this newer,
 * smaller piece has a bug.
 */

const { getDb } = require('../utils/database');
const { getCurrentTerm } = require('./schoolCalendarRepository');
const { getGrowthInsights } = require('./tseGrowthInsightService');

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
    // Never let evidence tagging break the caller's primary write — but
    // don't let a genuine bug hide behind the same catch block as a
    // missing-table condition either (see PR C,
    // docs/TSE_SCHOOL_CALENDAR_TEST_GAP.md). A missing table is expected
    // in some test setups and stays a quiet, non-fatal skip; anything
    // else is a real defect and gets rethrown under NODE_ENV=test so it
    // can't be silently swallowed in the suite that's supposed to catch it.
    const isMissingTable = err.code === 'SQLITE_ERROR' && /no such table/i.test(err.message);
    if (isMissingTable) {
      console.error('[TSE] tagEvidence: schema not ready (missing table), skipping:', err.message);
    } else {
      console.error('[TSE] tagEvidence failed (non-fatal):', err.message);
      if (process.env.NODE_ENV === 'test') throw err;
    }
    return false;
  }
}

/**
 * Returns a teacher's evidence snapshot — category counts plus the
 * most recent items per category, plus (Phase 4) a rule-based
 * evidence-gap layer. Powers both GET /api/tse/status and the WhatsApp
 * MY GROWTH command.
 *
 * @param {string} phoneHash
 * @returns {{
 *   counts: Record<string, number>,
 *   latest: Record<string, Array<{sourceId:number, sourceTable:string, createdAt:string, term:number|null}>>,
 *   missingCategories: string[],
 *   gaps: Array<{ type: string, message: string, count: number }>,
 *   strength: string|null,
 *   suggestedAction: string|null
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

  // Phase 4: rule-based evidence-gap layer. Never let a bug here take
  // down the snapshot itself — same convention as tagEvidence() above.
  let gaps = [];
  let strength = null;
  let suggestedAction = null;
  try {
    const insights = getGrowthInsights(phoneHash);
    gaps = insights.gaps;
    strength = insights.strength;
    suggestedAction = insights.suggestedAction;
  } catch (err) {
    console.error('[TSE] getGrowthInsights failed (non-fatal):', err.message);
  }

  return { counts, latest, missingCategories, gaps, strength, suggestedAction };
}

module.exports = {
  VALID_CATEGORIES,
  tagEvidence,
  getStatusSnapshot,
};
