'use strict';

/**
 * Deterministic post-generation validator (ADR-005 extension, Phase 6).
 *
 * Compares a set of *generated* questions (each carrying topic + marks
 * metadata) against a blueprint allocation produced by
 * assessmentWeightingEngine.computeBlueprint(), and reports whether the
 * generated assessment actually satisfies it.
 *
 * This module performs NO generation and NO LLM calls — it is pure
 * arithmetic over question metadata that the generation pipeline must
 * supply (question_id, topic, marks, cognitive_level, curriculum_reference).
 */

const DEFAULT_TOLERANCE_MARKS = 2; // rounding tolerance per topic, in raw marks

/**
 * @param {Array<{allocation:Array<{topic:string,marks:number}>, totalMarks:number}>} blueprint - output of computeBlueprint()
 * @param {Array<{question_id:string|number, topic:string, marks:number, cognitive_level?:string}>} generatedQuestions
 * @param {{toleranceMarks?: number}} [options]
 */
function validateAssessment(blueprint, generatedQuestions, options = {}) {
  if (!blueprint || blueprint.status !== 'OK') {
    throw new Error('validateAssessment: blueprint must be a successful computeBlueprint() result (status: OK)');
  }
  if (!Array.isArray(generatedQuestions)) {
    throw new Error('validateAssessment: generatedQuestions must be an array');
  }

  const tolerance = options.toleranceMarks != null ? options.toleranceMarks : DEFAULT_TOLERANCE_MARKS;

  const totalMarksGenerated = generatedQuestions.reduce((sum, q) => sum + Number(q.marks || 0), 0);

  const marksPerTopic = {};
  const countPerTopic = {};
  for (const q of generatedQuestions) {
    const topic = q.topic || 'UNKNOWN';
    marksPerTopic[topic] = (marksPerTopic[topic] || 0) + Number(q.marks || 0);
    countPerTopic[topic] = (countPerTopic[topic] || 0) + 1;
  }

  const missingRequirements = [];
  const excessRequirements = [];
  const perTopicComparison = [];

  for (const req of blueprint.allocation) {
    const actual = marksPerTopic[req.topic] || 0;
    const deviation = actual - req.marks;
    perTopicComparison.push({
      topic: req.topic,
      requiredMarks: req.marks,
      actualMarks: actual,
      deviation,
      questionCount: countPerTopic[req.topic] || 0,
      withinTolerance: Math.abs(deviation) <= tolerance,
    });
    if (deviation < -tolerance) {
      missingRequirements.push({ topic: req.topic, shortBy: Math.abs(deviation) });
    } else if (deviation > tolerance) {
      excessRequirements.push({ topic: req.topic, excessBy: deviation });
    }
  }

  // Topics present in the generated assessment but not in the blueprint at all.
  const blueprintTopics = new Set(blueprint.allocation.map((a) => a.topic));
  for (const topic of Object.keys(marksPerTopic)) {
    if (!blueprintTopics.has(topic)) {
      excessRequirements.push({ topic, excessBy: marksPerTopic[topic], note: 'topic not in blueprint' });
    }
  }

  const totalMarksDeviation = totalMarksGenerated - blueprint.totalMarks;
  const totalMarksOk = Math.abs(totalMarksDeviation) <= tolerance;

  const passed = totalMarksOk && missingRequirements.length === 0 && excessRequirements.length === 0;

  return {
    passed,
    totalMarksExpected: blueprint.totalMarks,
    totalMarksGenerated,
    totalMarksDeviation,
    perTopicComparison,
    missingRequirements,
    excessRequirements,
  };
}

module.exports = {
  validateAssessment,
  DEFAULT_TOLERANCE_MARKS,
};
