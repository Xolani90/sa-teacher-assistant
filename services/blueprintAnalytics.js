'use strict';

/**
 * Blueprint Assessment Analytics (ADR-005 Section 8a, step 5 —
 * Deterministic analytics).
 *
 * Computes topic totals, learner totals/percentages, class averages,
 * topic averages, and strongest/weakest topics for a blueprint-backed
 * assessment.
 *
 * Per ADR-005's Deterministic Reproducibility Principle (Section 3):
 * "Every deterministic calculation must be reproducible from the
 * database without AI." Accordingly this module is a pure read/compute
 * layer — it queries assessments/learner_results/blueprint_questions
 * and derives everything via arithmetic, nothing is cached or persisted.
 * Re-running it against the same rows always produces the same numbers,
 * and it needs no AI service to be available.
 *
 * Scope note: this is deliberately separate from itemAnalysisService.js.
 * That module computes per-question psychometrics (facility value,
 * discrimination index, item quality) for ANY assessment, blueprint or
 * not, from a `question_data` shape of `{ mark, maxMark, topic }` per
 * question. Blueprint-backed assessments store `question_data` as plain
 * `{ questionNumber: marksAwarded }` (see blueprintMarksImport.js /
 * diagnosticWorkflowService.js) — topic and maxMarks are not repeated
 * per learner, they live once on the blueprint's locked question list.
 * This module joins that plain mark data against blueprint_questions to
 * get topic/maxMarks, then aggregates by topic — a different question
 * (spreadsheet-parity topic totals/averages) than item analysis answers
 * (question-level psychometrics).
 */

const { getDb } = require('../utils/database');
const { getBlueprintById } = require('./blueprintRepository');

/**
 * Computes deterministic topic/class analytics for a blueprint-backed
 * assessment.
 *
 * @param {number} assessmentId
 * @returns {{
 *   assessmentId: number,
 *   blueprintId: number,
 *   blueprintTitle: string,
 *   blueprintVersion: number,
 *   totalMarks: number,
 *   learnerCount: number,
 *   classAverage: { mark: number, percentage: number },
 *   topics: Array<{
 *     topic: string,
 *     maxMarks: number,
 *     classAverageMark: number,
 *     classAveragePercentage: number
 *   }>,
 *   strongestTopics: Array<{ topic: string, classAveragePercentage: number }>,
 *   weakestTopics: Array<{ topic: string, classAveragePercentage: number }>,
 *   learners: Array<{
 *     learnerName: string,
 *     mark: number,
 *     totalMarks: number,
 *     percentage: number,
 *     topics: Array<{ topic: string, marksAwarded: number, maxMarks: number, percentage: number }>
 *   }>
 * } | { error: string }}
 */
function getBlueprintAssessmentAnalytics(assessmentId) {
  const db = getDb();

  const assessment = db.prepare(`SELECT * FROM assessments WHERE id = ?`).get(assessmentId);
  if (!assessment) {
    return { error: `No assessment found with id ${assessmentId}` };
  }
  if (!assessment.blueprint_id) {
    return {
      error: 'This assessment was not created from a Blueprint — topic-level analytics require blueprint_questions to resolve each question\'s topic and maxMarks. Use itemAnalysisService for question-level stats on free-form assessments.',
    };
  }

  const blueprint = getBlueprintById(assessment.blueprint_id);
  if (!blueprint) {
    // Should not happen under normal FK usage, but the blueprint could
    // in principle be hard-deleted (deleteBlueprint only allows this
    // while still a draft, before any instance could reference it — so
    // this branch is a defensive guard, not an expected path).
    return { error: `Blueprint ${assessment.blueprint_id} referenced by assessment ${assessmentId} no longer exists` };
  }

  const learnerRows = db.prepare(`SELECT * FROM learner_results WHERE assessment_id = ?`).all(assessmentId);
  if (learnerRows.length === 0) {
    return { error: 'No learner results found for this assessment' };
  }

  // Group blueprint questions by topic once, up front — a topic can span
  // multiple question numbers (e.g. three separate fractions questions),
  // and a topic's maxMarks is the SUM of every question tagged with it,
  // fixed by the blueprint regardless of what any individual learner
  // attempted.
  const topicsByName = new Map(); // topic -> { maxMarks, questionNumbers: Set }
  for (const q of blueprint.questions) {
    if (!topicsByName.has(q.topic)) {
      topicsByName.set(q.topic, { maxMarks: 0, questionNumbers: new Set() });
    }
    const entry = topicsByName.get(q.topic);
    entry.maxMarks += q.maxMarks;
    entry.questionNumbers.add(q.questionNumber);
  }

  // Per-learner topic breakdown, and running class-level topic totals.
  const classTopicTotals = new Map(); // topic -> sum of marksAwarded across all learners
  const learners = [];

  for (const row of learnerRows) {
    let questionData = {};
    try {
      questionData = JSON.parse(row.question_data || '{}');
    } catch (_) {
      questionData = {}; // malformed JSON — treat as no per-question data, not a hard failure
    }

    const learnerTopics = [];
    for (const [topic, { maxMarks, questionNumbers }] of topicsByName.entries()) {
      let marksAwarded = 0;
      for (const qNum of questionNumbers) {
        const raw = questionData[String(qNum)];
        const marks = Number(raw);
        // A question the learner's row has no entry for (or a non-numeric
        // entry) contributes 0, not a thrown error — matches
        // blueprintMarksImport's "missing question is not itself a
        // validation error" stance; the fixed maxMarks denominator still
        // reflects the full blueprint.
        if (Number.isFinite(marks)) marksAwarded += marks;
      }

      learnerTopics.push({
        topic,
        marksAwarded,
        maxMarks,
        percentage: maxMarks > 0 ? (marksAwarded / maxMarks) * 100 : 0,
      });

      classTopicTotals.set(topic, (classTopicTotals.get(topic) || 0) + marksAwarded);
    }

    learners.push({
      learnerName: row.learner_name,
      mark: row.mark,
      totalMarks: row.total_marks,
      percentage: row.percentage,
      topics: learnerTopics,
    });
  }

  const learnerCount = learners.length;

  const classAverageMark = learners.reduce((sum, l) => sum + l.mark, 0) / learnerCount;
  const classAveragePercentage = learners.reduce((sum, l) => sum + l.percentage, 0) / learnerCount;

  const topics = Array.from(topicsByName.entries()).map(([topic, { maxMarks }]) => {
    const classAverageMarkForTopic = (classTopicTotals.get(topic) || 0) / learnerCount;
    const classAveragePercentageForTopic = maxMarks > 0 ? (classAverageMarkForTopic / maxMarks) * 100 : 0;
    return {
      topic,
      maxMarks,
      classAverageMark: classAverageMarkForTopic,
      classAveragePercentage: classAveragePercentageForTopic,
    };
  });

  // Rank topics by class average percentage. Ties keep blueprint
  // question-number order (Array.sort is stable in Node), so results are
  // reproducible rather than depending on Map iteration happenstance.
  const rankedTopics = [...topics].sort((a, b) => b.classAveragePercentage - a.classAveragePercentage);
  const strongestTopics = rankedTopics.slice(0, 3).map(({ topic, classAveragePercentage }) => ({ topic, classAveragePercentage }));
  const weakestTopics = rankedTopics.slice(-3).reverse().map(({ topic, classAveragePercentage }) => ({ topic, classAveragePercentage }));

  return {
    assessmentId,
    blueprintId: blueprint.id,
    blueprintTitle: blueprint.title,
    blueprintVersion: blueprint.version,
    totalMarks: assessment.total_marks,
    learnerCount,
    classAverage: {
      mark: classAverageMark,
      percentage: classAveragePercentage,
    },
    topics,
    strongestTopics,
    weakestTopics,
    learners,
  };
}

module.exports = {
  getBlueprintAssessmentAnalytics,
};
