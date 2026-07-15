'use strict';

/**
 * Observation grouping service (Foundation Phase).
 *
 * Pure data-layer service: reshapes parsed observation records
 * (utils/observationParser.js) into two grouped views, without ever
 * dropping fields. Presentation-layer callers (WhatsApp summaries, PDF
 * reports, future dashboards) decide what to display; this service just
 * regroups the same full records two different ways.
 *
 * Two exported functions, mirroring the two things a teacher actually
 * asks after an observation round:
 *
 *   groupByDomainAndStatus(records)
 *     "Who's Not Yet in Number Recognition?" — clusters learners by
 *     (domain, status) so the teacher can pull a small group for a
 *     focused activity. Mirrors how the numeric pipeline's intervention
 *     report clusters learners by shared weak topic.
 *
 *   groupByLearner(records)
 *     "How is Sipho doing overall?" — one profile per learner across all
 *     domains. Mirrors a report-card view.
 *
 * Both functions return arrays of full original record objects
 * (learnerName, domain, developmentalStatus, notes) inside each group —
 * nothing is stripped or summarized. Grouping order follows first-seen
 * order in the input, for stable, teacher-predictable output (same
 * convention as observationAnalysisService.js).
 *
 * Learner names are grouped case-insensitively in groupByLearner(), same
 * dedup rule as parseObservation()/analyzeObservations() — "Sipho" and
 * "sipho" are the same learner. The canonical display name used is
 * whichever casing appeared first in the input.
 *
 * See: docs/foundation-phase-observation-pipeline.md
 */

/**
 * Groups records by (domain, developmentalStatus) pair.
 *
 * @param {Array<{
 *   learnerName: string,
 *   domain: string,
 *   developmentalStatus: string,
 *   notes: string|null
 * }>} records - Output of parseObservation().records
 * @returns {Array<{
 *   domain: string,
 *   developmentalStatus: string,
 *   learners: Array<{
 *     learnerName: string,
 *     domain: string,
 *     developmentalStatus: string,
 *     notes: string|null
 *   }>
 * }>}
 */
function groupByDomainAndStatus(records) {
  if (!Array.isArray(records)) {
    throw new Error('groupByDomainAndStatus() requires an array of records.');
  }

  const groupOrder = [];
  const groups = new Map(); // key: "domain::status" -> group object

  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    const { domain, developmentalStatus } = record;
    if (!domain || !developmentalStatus) continue;

    const key = `${domain}::${developmentalStatus}`;
    if (!groups.has(key)) {
      groups.set(key, { domain, developmentalStatus, learners: [] });
      groupOrder.push(key);
    }
    groups.get(key).learners.push({ ...record });
  }

  return groupOrder.map((key) => groups.get(key));
}

/**
 * Groups records by learner, case-insensitively.
 *
 * @param {Array<{
 *   learnerName: string,
 *   domain: string,
 *   developmentalStatus: string,
 *   notes: string|null
 * }>} records - Output of parseObservation().records
 * @returns {Array<{
 *   learnerName: string,
 *   records: Array<{
 *     learnerName: string,
 *     domain: string,
 *     developmentalStatus: string,
 *     notes: string|null
 *   }>
 * }>}
 */
function groupByLearner(records) {
  if (!Array.isArray(records)) {
    throw new Error('groupByLearner() requires an array of records.');
  }

  const nameOrder = [];
  const groups = new Map(); // key: lowercased trimmed name -> group object

  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    const { learnerName } = record;
    if (!learnerName) continue;

    const key = String(learnerName).trim().toLowerCase();
    if (!groups.has(key)) {
      // First-seen casing becomes the canonical display name.
      groups.set(key, { learnerName, records: [] });
      nameOrder.push(key);
    }
    groups.get(key).records.push({ ...record });
  }

  return nameOrder.map((key) => groups.get(key));
}

module.exports = {
  groupByDomainAndStatus,
  groupByLearner,
};
