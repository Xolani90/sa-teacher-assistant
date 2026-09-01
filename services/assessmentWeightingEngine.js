'use strict';

/**
 * Assessment Weighting Engine (ADR-005 extension).
 *
 * Deterministic content/topic mark-allocation engine. Given a grade,
 * subject, assessment type/paper and a total mark count, this module
 * computes a CAPS-derived mark allocation per topic — WITHOUT ever
 * asking an LLM to decide the weighting.
 *
 * Evidence source: data/caps-weighting/evidence-inventory.json, which
 * records exactly which CAPS document/section each rule came from and
 * classifies it as one of:
 *
 *   EXPLICIT_CAPS_WEIGHTING     - CAPS states a percentage/mark table.
 *                                 Only this classification is ever
 *                                 auto-applied as an assessment weighting.
 *   EXPLICIT_CAPS_DISTRIBUTION  - CAPS gives a distribution that is not
 *                                 expressed as a mark/percentage table.
 *   CURRICULUM_CONTENT_WEIGHTING- Teaching-time allocation only. Must
 *                                 NOT be auto-converted into assessment
 *                                 marks.
 *   UNVERIFIED                  - No authoritative source found.
 *
 * If no EXPLICIT_CAPS_WEIGHTING rule matches the request, this engine
 * returns { status: 'WEIGHTING_UNVERIFIED', ... } rather than inventing
 * a percentage. This is a hard invariant — see computeBlueprint().
 *
 * This module does NOT replace assessment_blueprints / blueprint_
 * questions / blueprintRepository.js. Its output (a topic -> marks
 * allocation) is intended to be passed into the existing blueprint
 * creation flow as the question-generation constraint.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger').child({ module: 'assessmentWeightingEngine' });

const EVIDENCE_PATH = path.join(__dirname, '..', 'data', 'caps-weighting', 'evidence-inventory.json');

let _evidenceCache = null;

/**
 * Loads and caches the evidence inventory from disk. Exposed (not
 * purely internal) so tests can call reloadEvidence() after mutating
 * the fixture file, and so governance tooling can inspect the raw
 * evidence set without re-implementing the read.
 */
function loadEvidence() {
  if (_evidenceCache) return _evidenceCache;
  const raw = fs.readFileSync(EVIDENCE_PATH, 'utf8');
  _evidenceCache = JSON.parse(raw);
  return _evidenceCache;
}

function reloadEvidence() {
  _evidenceCache = null;
  return loadEvidence();
}

/**
 * Finds the applicable EXPLICIT_CAPS_WEIGHTING rule for a given
 * grade/subject/paper combination. Returns null if none exists —
 * callers must treat null as "no authoritative rule", never as "use
 * some default".
 *
 * @param {{grade:number, subject:string, paper?:string, assessmentType?:string}} query
 */
function findRule(query) {
  const evidence = loadEvidence();
  const subjectNorm = String(query.subject || '').trim().toLowerCase();
  const paperNorm = query.paper ? String(query.paper).trim().toLowerCase() : null;

  const match = evidence.rules.find((rule) => {
    if (rule.classification !== 'EXPLICIT_CAPS_WEIGHTING') return false;
    if (rule.grade !== query.grade) return false;
    if (String(rule.subject).trim().toLowerCase() !== subjectNorm) return false;
    if (paperNorm && rule.paper && String(rule.paper).trim().toLowerCase() !== paperNorm) {
      return false;
    }
    return true;
  });

  return match || null;
}

/**
 * Rounds a set of proportional marks to whole-number marks that sum
 * exactly to totalMarks, using the largest-remainder method. This
 * keeps every topic's allocation as close as possible to its CAPS
 * target while guaranteeing marks add up exactly (unlike naive
 * per-topic Math.round(), which can over/under-shoot the total).
 *
 * @param {Array<{topic:string, targetMarks:number, tolerance:number}>} topicWeights
 * @param {number} sourceTotalMarks - the total the CAPS table's targetMarks were expressed against (e.g. 100 or 150)
 * @param {number} requestedTotalMarks - the total marks the teacher actually requested
 */
function allocateMarks(topicWeights, sourceTotalMarks, requestedTotalMarks) {
  const scale = requestedTotalMarks / sourceTotalMarks;
  const raw = topicWeights.map((tw) => ({
    topic: tw.topic,
    exact: tw.targetMarks * scale,
  }));

  const floored = raw.map((r) => ({ topic: r.topic, marks: Math.floor(r.exact), remainder: r.exact - Math.floor(r.exact) }));
  let allocated = floored.reduce((sum, f) => sum + f.marks, 0);
  let remaining = requestedTotalMarks - allocated;

  // Distribute remaining marks to the topics with the largest fractional remainder.
  const order = [...floored].sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; i < order.length && remaining > 0; i++) {
    order[i].marks += 1;
    remaining -= 1;
  }

  return floored.map((f) => ({ topic: f.topic, marks: f.marks }));
}

/**
 * Computes a deterministic assessment blueprint (topic -> marks) for
 * a grade/subject/paper/total-marks request.
 *
 * @param {{grade:number, subject:string, paper?:string, assessmentType?:string, totalMarks:number, customWeighting?: Array<{topic:string, percentage:number}>}} request
 * @returns {{status:'OK'|'WEIGHTING_UNVERIFIED', weightingSource:'CAPS'|'TEACHER_CUSTOM'|null, ruleId?:string, allocation?:Array<{topic:string,marks:number}>, reason?:string}}
 */
function computeBlueprint(request) {
  if (!request || request.grade == null || !request.subject || !request.totalMarks) {
    throw new Error('computeBlueprint: grade, subject and totalMarks are required');
  }

  // Phase 7: explicit teacher custom weighting always takes priority
  // and is NEVER labelled as CAPS weighting.
  if (request.customWeighting) {
    return computeCustomBlueprint(request);
  }

  const rule = findRule(request);
  if (!rule) {
    logger.info('No verified CAPS weighting rule found', { grade: request.grade, subject: request.subject, paper: request.paper });
    return {
      status: 'WEIGHTING_UNVERIFIED',
      weightingSource: null,
      reason: `No EXPLICIT_CAPS_WEIGHTING rule found for grade ${request.grade} ${request.subject}${request.paper ? ' ' + request.paper : ''}. Refusing to invent a weighting — see data/caps-weighting/evidence-inventory.json "unverified" section for what was checked.`,
    };
  }

  const allocation = allocateMarks(rule.topicWeights, rule.totalMarks, request.totalMarks);

  return {
    status: 'OK',
    weightingSource: 'CAPS',
    ruleId: rule.id,
    capsDocument: rule.capsDocument,
    pageSection: rule.pageSection,
    totalMarks: request.totalMarks,
    allocation,
  };
}

/**
 * Phase 7: teacher custom weighting. Percentages must sum to exactly
 * 100 (integer percentages only, to avoid floating-point ambiguity in
 * what "exactly 100%" means). Never classified as CAPS.
 */
function computeCustomBlueprint(request) {
  const weights = request.customWeighting;
  if (!Array.isArray(weights) || weights.length === 0) {
    throw new Error('customWeighting must be a non-empty array of {topic, percentage}');
  }

  const total = weights.reduce((sum, w) => sum + Number(w.percentage), 0);
  // Guard against floating point noise (e.g. 33.33+33.33+33.34) while
  // still rejecting genuinely invalid totals.
  if (Math.round(total * 100) / 100 !== 100) {
    return {
      status: 'INVALID_CUSTOM_WEIGHTING',
      weightingSource: 'TEACHER_CUSTOM',
      reason: `Custom weighting percentages must sum to exactly 100. Got ${total}.`,
    };
  }

  const topicWeights = weights.map((w) => ({ topic: w.topic, targetMarks: Number(w.percentage) }));
  const allocation = allocateMarks(topicWeights, 100, request.totalMarks);

  return {
    status: 'OK',
    weightingSource: 'TEACHER_CUSTOM',
    totalMarks: request.totalMarks,
    allocation,
  };
}

module.exports = {
  computeBlueprint,
  findRule,
  allocateMarks,
  loadEvidence,
  reloadEvidence,
  EVIDENCE_PATH,
};
