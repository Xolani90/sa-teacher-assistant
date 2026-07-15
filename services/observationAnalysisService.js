'use strict';

/**
 * Observation analysis service (Foundation Phase).
 *
 * Combines the role of itemAnalysisService.js and errorAnalysisService.js
 * for the numeric pipeline into a single service, per the architecture
 * document's "Proposed Components" section. Produces developmental
 * summaries — no percentage or mark-based calculations.
 *
 * DEVIATION FROM PHASE 1 SKELETON: the original skeleton signature was
 * analyzeObservations(observationAssessmentId) — a DB-lookup signature.
 * Observation storage (observation_assessments / observation_records
 * tables) is deliberately deferred to a later phase (see
 * observationWorkflowService.js), so there is nothing to look up yet.
 * This phase instead operates directly on the records array produced by
 * parseObservation() (utils/observationParser.js) — the same shape that
 * will eventually be persisted and re-fetched. When storage lands, the
 * workflow service is expected to fetch rows and pass them here, so this
 * function's contract does not need to change at that point.
 *
 * See: docs/foundation-phase-observation-pipeline.md
 */

const STATUS_KEYS = {
  Achieved: 'achieved',
  Developing: 'developing',
  'Not Yet': 'notYet',
};

/**
 * Analyzes parsed observation records and produces a developmental
 * summary (NOT a percentage-based analysis).
 *
 * "Observations of concern" surfaced here are:
 *   - every record with developmentalStatus === 'Not Yet' (these
 *     represent learners requiring intervention, whether or not the
 *     teacher left notes)
 *   - every record with developmentalStatus === 'Developing' that also
 *     has non-null notes (the notes usually identify a specific support
 *     need worth following up)
 * 'Achieved' records are never surfaced as concerns. A future reporting
 * requirement may want a separate "strengths/highlights" view of
 * Achieved records — that is out of scope here.
 *
 * @param {Array<{
 *   learnerName: string,
 *   domain: string,
 *   developmentalStatus: string,
 *   notes: string|null
 * }>} records - Output of parseObservation().records
 * @returns {{
 *   totalLearners: number,
 *   domainSummaries: Array<{
 *     domain: string,
 *     achieved: number,
 *     developing: number,
 *     notYet: number
 *   }>,
 *   observationsOfConcern: Array<{
 *     learnerName: string,
 *     domain: string,
 *     developmentalStatus: string,
 *     notes: string|null
 *   }>
 * }}
 */
function analyzeObservations(records) {
  if (!Array.isArray(records)) {
    throw new Error('analyzeObservations() requires an array of records.');
  }

  const learnerNamesLower = new Set();
  // Preserve first-seen domain order for stable, teacher-predictable output.
  const domainOrder = [];
  const domainTallies = new Map(); // domain -> { achieved, developing, notYet }
  const observationsOfConcern = [];

  for (const record of records) {
    if (!record || typeof record !== 'object') continue;

    const { learnerName, domain, developmentalStatus, notes } = record;

    if (learnerName) {
      learnerNamesLower.add(String(learnerName).trim().toLowerCase());
    }

    if (domain) {
      if (!domainTallies.has(domain)) {
        domainTallies.set(domain, { achieved: 0, developing: 0, notYet: 0 });
        domainOrder.push(domain);
      }
      const tallyKey = STATUS_KEYS[developmentalStatus];
      if (tallyKey) {
        domainTallies.get(domain)[tallyKey] += 1;
      }
    }

    const isNotYet = developmentalStatus === 'Not Yet';
    const isDevelopingWithNotes =
      developmentalStatus === 'Developing' && notes !== null && notes !== undefined && notes !== '';

    if (isNotYet || isDevelopingWithNotes) {
      observationsOfConcern.push({
        learnerName,
        domain,
        developmentalStatus,
        notes: notes ?? null,
      });
    }
  }

  const domainSummaries = domainOrder.map((domain) => ({
    domain,
    ...domainTallies.get(domain),
  }));

  return {
    totalLearners: learnerNamesLower.size,
    domainSummaries,
    observationsOfConcern,
  };
}

/**
 * Produces a narrative developmental summary suitable for teacher-facing
 * reports (mirrors the descriptive role of error analysis, without
 * numeric framing — no percentages, no marks).
 *
 * @param {object} analysis - Output of analyzeObservations().
 * @returns {string}
 */
function generateDevelopmentalSummary(analysis) {
  if (!analysis || typeof analysis !== 'object') {
    throw new Error('generateDevelopmentalSummary() requires an analysis object.');
  }

  const { totalLearners, domainSummaries, observationsOfConcern } = analysis;

  const lines = [];

  lines.push(
    totalLearners === 1
      ? 'This summary covers 1 learner.'
      : `This summary covers ${totalLearners} learners.`
  );
  lines.push('');

  if (!domainSummaries || domainSummaries.length === 0) {
    lines.push('No developmental domains were recorded.');
  } else {
    lines.push('Developmental domains:');
    for (const summary of domainSummaries) {
      lines.push(
        `- ${summary.domain}: ${summary.achieved} Achieved, ${summary.developing} Developing, ${summary.notYet} Not Yet`
      );
    }
  }

  lines.push('');

  if (!observationsOfConcern || observationsOfConcern.length === 0) {
    lines.push('No observations currently need follow-up.');
  } else {
    lines.push('Observations needing follow-up:');
    for (const obs of observationsOfConcern) {
      const notesPart = obs.notes ? ` — ${obs.notes}` : '';
      lines.push(`- ${obs.learnerName} (${obs.domain}, ${obs.developmentalStatus})${notesPart}`);
    }
  }

  return lines.join('\n');
}

module.exports = {
  analyzeObservations,
  generateDevelopmentalSummary,
};
