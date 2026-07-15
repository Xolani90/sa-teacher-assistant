'use strict';

const { parseObservation, getObservationFormatHelpText } = require('./observationParser');
const { analyzeObservations, generateDevelopmentalSummary } = require('../services/observationAnalysisService');
const { groupByDomainAndStatus, groupByLearner } = require('../services/observationGroupingService');

/**
 * Observation workflow service (Foundation Phase).
 *
 * Transport-agnostic orchestrator: wires parseObservation() ->
 * analyzeObservations() -> groupByDomainAndStatus()/groupByLearner()
 * into a single call, and returns a structured result object.
 *
 * DELIBERATELY DOES NOT:
 *   - generate WhatsApp (or any other channel's) message text. Message
 *     formatting belongs to the caller (a WhatsApp handler, an API
 *     response formatter, a future dashboard, etc.) so this orchestrator
 *     stays reusable across transports.
 *   - persist anything to a database. Observation storage
 *     (observation_assessments / observation_records tables) is
 *     deliberately deferred to a later phase. When storage lands, the
 *     natural integration point is right after a successful
 *     processObservationSubmission() call — the caller persists
 *     result.records (and, once storage exists, is expected to derive
 *     result.analysis / result.domainStatusGroups / result.learnerGroups
 *     from re-fetched rows rather than from this in-memory result, the
 *     same pattern already established in observationAnalysisService.js).
 *
 * FAIL-FAST CONTRACT: if parsing does not succeed, this function returns
 * immediately with the parser's errors/warnings/help text and does NOT
 * call analyzeObservations() or the grouping functions. Analysis and
 * grouping only ever run against a fully successful, internally
 * consistent parse. There is currently no "best effort" partial-parse
 * mode; if one is needed later it should be an explicit, separate
 * option rather than the default behavior.
 *
 * See: docs/foundation-phase-observation-pipeline.md
 */

/**
 * Runs the full Foundation Phase observation pipeline against raw
 * teacher-submitted text.
 *
 * @param {string} input - Raw teacher-submitted observation text.
 * @returns {{
 *   success: boolean,
 *   header: { assessment: string|null, grade: string|null, subject: string|null },
 *   metadata: {
 *     assessment: string|null,
 *     grade: string|null,
 *     subject: string|null,
 *     learnerCount: number,
 *     recordCount: number
 *   },
 *   records: Array<object>|null,
 *   analysis: object|null,
 *   developmentalSummary: string|null,
 *   domainStatusGroups: Array<object>|null,
 *   learnerGroups: Array<object>|null,
 *   errors: string[],
 *   warnings: string[],
 *   helpText: string|null
 * }}
 */
function processObservationSubmission(input) {
  const parseResult = parseObservation(input);

  if (!parseResult.success) {
    return {
      success: false,
      header: parseResult.header,
      metadata: parseResult.metadata,
      records: null,
      analysis: null,
      developmentalSummary: null,
      domainStatusGroups: null,
      learnerGroups: null,
      errors: parseResult.errors,
      warnings: parseResult.warnings,
      helpText: getObservationFormatHelpText(),
    };
  }

  const analysis = analyzeObservations(parseResult.records);
  const developmentalSummary = generateDevelopmentalSummary(analysis);
  const domainStatusGroups = groupByDomainAndStatus(parseResult.records);
  const learnerGroups = groupByLearner(parseResult.records);

  return {
    success: true,
    header: parseResult.header,
    metadata: parseResult.metadata,
    records: parseResult.records,
    analysis,
    developmentalSummary,
    domainStatusGroups,
    learnerGroups,
    errors: parseResult.errors, // always [] here, since success === true
    warnings: parseResult.warnings,
    helpText: null,
  };
}

module.exports = {
  processObservationSubmission,
};
