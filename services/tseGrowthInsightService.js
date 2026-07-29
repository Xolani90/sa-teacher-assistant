'use strict';

/**
 * services/tseGrowthInsightService.js — TSE Phase 4: rule-based
 * (zero-AI) evidence-gap detection, built against the REAL API on
 * `main` — services/tseEvidenceService.js's tagEvidence()/
 * getStatusSnapshot() and VALID_CATEGORIES = ['curriculum','assessment',
 * 'intervention','observation','resource'] — not the earlier abandoned
 * getGrowthSnapshot()/linkEvidence() build.
 *
 * getStatusSnapshot() already tells a teacher HOW MANY of each evidence
 * type they have. This module adds WHY that matters — it cross-references
 * the real FK relationships already in the schema to surface concrete,
 * actionable gaps:
 *
 *   1. coverage_without_assessment — a curriculum_coverage row marked
 *      covered=1 this term with no assessments row for that
 *      (grade, subject, term) — you taught it, but never checked it landed.
 *   2. assessment_without_intervention — an assessments row this term
 *      with no intervention_plans row pointing at it via assessment_id —
 *      you assessed, but never acted on what the assessment showed.
 *   3. observation_without_followup — at least one observation_assessments
 *      row exists this term, but zero intervention_plans rows exist at
 *      all this term — you observed learners, but nothing downstream
 *      followed up.
 *
 * A fourth pattern from the original spec ("support plans without
 * follow-up evidence") is deliberately NOT implemented — there is no
 * follow-up evidence source in the current schema to compare
 * intervention_plans against (that's tse_reflections, Phase 5, not
 * built yet). Faking it here would mean inventing data; documented as a
 * known gap instead.
 *
 * Design conventions matched to the rest of this codebase:
 *   - Never throws to a WhatsApp/API caller for a bad/missing DB row —
 *     only bad input (missing phoneHash) throws.
 *   - No AI calls, no mastery/coverage computation of its own — reads
 *     existing tables verbatim and only computes existence/absence.
 *   - Self-contained term date-range helper (no dependency on
 *     utils/schoolTerm.js or services/schoolCalendarRepository.js,
 *     since neither's exact current export surface is something this
 *     module should assume — keeps this addition low-risk to wire in).
 */

const { getDb } = require('../utils/database');

const TERM_MONTH_RANGES = { 1: [1, 3], 2: [4, 6], 3: [7, 9], 4: [10, 12] };

function currentTermYear(now = new Date()) {
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  let term = 1;
  if (month >= 10) term = 4;
  else if (month >= 7) term = 3;
  else if (month >= 4) term = 2;
  return { term, year };
}

/**
 * @param {string} phoneHash
 * @param {{ term?: number }} [opts] - defaults to the current term.
 *   (assessments/curriculum_coverage store `term` directly, no year
 *   column, matching the existing schema — so only term is used here.)
 * @returns {{
 *   term: number,
 *   gaps: Array<{ type: string, message: string, count: number }>,
 *   strength: string|null,
 *   suggestedAction: string|null
 * }}
 */
function getGrowthInsights(phoneHash, opts = {}) {
  if (!phoneHash) throw new Error('getGrowthInsights: phoneHash is required');

  const db = getDb();
  const term = opts.term ?? currentTermYear().term;
  const gaps = [];

  try {
    const coveredNoAssessment = db
      .prepare(
        `SELECT cc.topic, cc.grade, cc.subject
         FROM curriculum_coverage cc
         WHERE cc.phone_hash = ? AND cc.term = ? AND cc.covered = 1
           AND NOT EXISTS (
             SELECT 1 FROM assessments a
             WHERE a.phone_hash = cc.phone_hash
               AND a.grade = cc.grade
               AND a.subject = cc.subject
               AND a.term = cc.term
           )`
      )
      .all(phoneHash, term);

    if (coveredNoAssessment.length > 0) {
      gaps.push({
        type: 'coverage_without_assessment',
        count: coveredNoAssessment.length,
        message:
          coveredNoAssessment.length === 1
            ? `You've covered "${coveredNoAssessment[0].topic}" this term but haven't recorded an assessment for it yet.`
            : `You've covered ${coveredNoAssessment.length} topics this term (e.g. "${coveredNoAssessment[0].topic}") with no assessment recorded yet.`,
      });
    }
  } catch (err) {
    console.error('[TSE_INSIGHT] coverage_without_assessment check failed:', err.message);
  }

  try {
    const assessmentsNoIntervention = db
      .prepare(
        `SELECT a.id, a.title
         FROM assessments a
         WHERE a.phone_hash = ? AND a.term = ?
           AND NOT EXISTS (
             SELECT 1 FROM intervention_plans ip WHERE ip.assessment_id = a.id
           )`
      )
      .all(phoneHash, term);

    if (assessmentsNoIntervention.length > 0) {
      gaps.push({
        type: 'assessment_without_intervention',
        count: assessmentsNoIntervention.length,
        message:
          assessmentsNoIntervention.length === 1
            ? `"${assessmentsNoIntervention[0].title}" has no intervention plan linked yet.`
            : `${assessmentsNoIntervention.length} assessments this term (e.g. "${assessmentsNoIntervention[0].title}") have no intervention plan linked yet.`,
      });
    }
  } catch (err) {
    console.error('[TSE_INSIGHT] assessment_without_intervention check failed:', err.message);
  }

  try {
    const observationCountRow = db
      .prepare(
        `SELECT COUNT(*) AS n FROM observation_assessments WHERE phone_hash = ?`
      )
      .get(phoneHash);
    const interventionCountRow = db
      .prepare(`SELECT COUNT(*) AS n FROM intervention_plans WHERE phone_hash = ?`)
      .get(phoneHash);

    const observationCount = observationCountRow ? observationCountRow.n : 0;
    const interventionCount = interventionCountRow ? interventionCountRow.n : 0;

    if (observationCount > 0 && interventionCount === 0) {
      gaps.push({
        type: 'observation_without_followup',
        count: observationCount,
        message: `You've recorded ${observationCount} observation${observationCount === 1 ? '' : 's'} this term but no intervention plan has followed up on any of them.`,
      });
    }
  } catch (err) {
    console.error('[TSE_INSIGHT] observation_without_followup check failed:', err.message);
  }

  const strength =
    gaps.length === 0
      ? 'Your evidence trail is connected this term — coverage, assessment, and follow-up are all linking up.'
      : null;

  const suggestedAction = gaps.length > 0 ? gaps[0].message : null;

  return { term, gaps, strength, suggestedAction };
}

module.exports = { getGrowthInsights };
