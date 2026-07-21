'use strict';

/**
 * Blueprint marks validation (ADR-005 Section 8a, step 4 — Import
 * pipeline).
 *
 * This is the piece MIGRATION-029-assessment-blueprints.md's
 * "Backwards compatibility" section flagged as explicit future work:
 * "Passing a blueprint_id through storeAssessment() is new, optional
 * behavior to be added in the BlueprintRepository/import work that
 * follows this migration." It plugs a published Blueprint's question
 * list into processAssessmentData() (diagnosticWorkflowService.js) so
 * marks entry is validated against the blueprint's max_marks per
 * question, rather than accepted as free-form question_data.
 *
 * Scope: this module is pure validation/computation — it does not
 * itself read or write learner_results/assessments. Mirrors
 * blueprintTopicValidation.js sitting stateless in front of
 * blueprintRepository.js: that module validates topics before
 * publishBlueprint(); this module validates marks before
 * storeLearnerResults(). storeAssessment()/storeLearnerResults() in
 * diagnosticWorkflowService.js remain the only writers.
 *
 * Deliberately NOT re-implemented here: totals/percentages once marks
 * are accepted. That stays in storeLearnerResults() exactly as it
 * works today (percentage = mark / totalMarks * 100) — this module only
 * decides what the per-question marks resolve to and whether they're
 * valid, matching ADR-005 Section 8's "deterministic, non-AI
 * calculations only" scope.
 *
 * See: docs/adr/ADR-005-intermediate-phase-assessment-intelligence.md
 *      MIGRATION-029-assessment-blueprints.md
 */

const { getBlueprintById } = require('./blueprintRepository');

/**
 * Validates one learner's per-question marks against a blueprint's
 * question list and totals the accepted marks.
 *
 * @param {Object} blueprint - result of getBlueprintById() (must include
 *   a `questions` array of { questionNumber, maxMarks, ... })
 * @param {Object<string|number, number>} questionData - e.g.
 *   { "1": 8, "2": 5, "3": 10 } — question_number -> marks awarded,
 *   matching the exact shape already stored in
 *   learner_results.question_data (see diagnosticWorkflowService.js).
 * @returns {{
 *   valid: boolean,
 *   total: number,
 *   errors: Array<{ questionNumber: number, message: string }>
 * }}
 *   total is the sum of only the marks that passed validation — callers
 *   that require every blueprint question to be answered before
 *   accepting a total should check that separately (see
 *   missingQuestions below); a question the learner's data omits
 *   entirely is not itself a validation error here, matching the
 *   existing "skip the malformed row, don't block everything else"
 *   philosophy already used in storeLearnerResults() for the free-form
 *   (non-blueprint) path.
 */
function validateMarksAgainstBlueprint(blueprint, questionData = {}) {
  if (!blueprint) {
    throw new Error('validateMarksAgainstBlueprint: blueprint is required');
  }

  const questionsByNumber = new Map(blueprint.questions.map((q) => [q.questionNumber, q]));
  const errors = [];
  let total = 0;

  for (const [rawKey, rawMarks] of Object.entries(questionData || {})) {
    const questionNumber = Number(rawKey);
    const question = questionsByNumber.get(questionNumber);

    // A published blueprint's question list is locked (ADR-005 Section
    // 5), so a question number that doesn't resolve is far more likely
    // a mis-keyed column (e.g. an OCR/import misread) than a legitimate
    // extra question — reject rather than silently accept it uncounted.
    if (!question) {
      errors.push({ questionNumber, message: `Question ${rawKey} is not on this blueprint` });
      continue;
    }

    const marks = Number(rawMarks);
    if (!Number.isFinite(marks) || marks < 0) {
      errors.push({ questionNumber, message: `Question ${questionNumber}: marks must be a non-negative number` });
      continue;
    }
    if (marks > question.maxMarks) {
      errors.push({
        questionNumber,
        message: `Question ${questionNumber}: ${marks} exceeds max marks (${question.maxMarks})`,
      });
      continue;
    }

    total += marks;
  }

  const missingQuestions = blueprint.questions
    .map((q) => q.questionNumber)
    .filter((n) => !(String(n) in (questionData || {})));

  return {
    valid: errors.length === 0,
    total,
    errors,
    missingQuestions,
  };
}

/**
 * Validates every learner's questionData against a blueprint in one
 * pass — the shape processAssessmentData()/storeLearnerResults()
 * already iterate over (assessmentData.learnerResults).
 *
 * Requires the blueprint to already be published: ADR-005 Section 5
 * locks a blueprint's questions as soon as the first AssessmentInstance
 * references it, so marks can only ever be validated against a fixed,
 * known question list — never against a draft that could still change
 * underneath the import.
 *
 * @param {number} blueprintId
 * @param {Array<{ learnerName: string, questionData: Object }>} learnerResults
 * @returns {{
 *   blueprint: Object,
 *   results: Array<{ learnerName: string, valid: boolean, total: number, errors: Array, missingQuestions: number[] }>
 * }}
 */
function validateLearnerResultsAgainstBlueprint(blueprintId, learnerResults = []) {
  const blueprint = getBlueprintById(blueprintId);
  if (!blueprint) {
    throw new Error(`validateLearnerResultsAgainstBlueprint: blueprint ${blueprintId} does not exist`);
  }
  if (blueprint.status !== 'published') {
    throw new Error(
      `validateLearnerResultsAgainstBlueprint: blueprint ${blueprintId} must be published before marks can be imported against it (current status: ${blueprint.status})`
    );
  }

  const results = learnerResults.map((result) => ({
    learnerName: result.learnerName,
    ...validateMarksAgainstBlueprint(blueprint, result.questionData || {}),
  }));

  return { blueprint, results };
}

module.exports = {
  validateMarksAgainstBlueprint,
  validateLearnerResultsAgainstBlueprint,
};
