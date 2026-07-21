'use strict';

/**
 * CAPS topic validation for Assessment Blueprints (ADR-005 Section 7).
 *
 * Topics entered against a blueprint_questions row (Path C — teacher-
 * authored — and Path B — spreadsheet import, on import) must resolve
 * against the existing CAPS Topic Registry already used elsewhere in the
 * bot (curriculumIntelligenceService.js's CAPS_TOPICS — the same table
 * that grounds ATP pacing and curriculum coverage), not be accepted as
 * free text.
 *
 *   Teacher enters "Fractions"  → exact match, accepted
 *   Teacher enters "Fraction"   → no exact match
 *                               → "Did you mean: Fractions / Decimal Fractions?"
 *
 * This is deliberately a thin, stateless module sitting IN FRONT OF
 * blueprintRepository.js — the repository itself stores whatever topic
 * string it's given (see blueprintRepository.js's own scope note) and
 * does not import this module. Wiring this into a WhatsApp-facing flow
 * or an import pipeline is the caller's job; this module only answers
 * "is this topic valid for this grade/subject/term, and if not, what
 * did the teacher probably mean?"
 *
 * Coverage gap: CAPS_TOPICS currently only has entries for mathematics,
 * english, and natural_sciences (see curriculumIntelligenceService.js).
 * A grade/subject/term combination with no registry data returns
 * { valid: true, dataAvailable: false } rather than rejecting the
 * topic outright — same "don't block the teacher on missing registry
 * coverage" pattern already used by curriculumCoverageService.js's
 * dataAvailable flag. Once a subject IS covered, validation is strict.
 */

const { getTermTopics, CAPS_TOPICS } = require('./curriculumIntelligenceService');

const SUGGESTION_LIMIT = 3;

/**
 * Normalizes a subject string to a CAPS_TOPICS key, matching
 * curriculumIntelligenceService.js's own normalization exactly (kept in
 * sync deliberately rather than re-exported, since that function is not
 * itself exported).
 */
function subjectKey(subject) {
  return String(subject || '').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z_]/g, '');
}

function normalizeTopic(topic) {
  return String(topic || '').trim().toLowerCase();
}

/**
 * Levenshtein edit distance — used only to rank "did you mean"
 * suggestions, not to silently auto-accept a near-miss. A near-miss is
 * always surfaced back to the teacher for confirmation (ADR-005 Section
 * 7), never auto-corrected.
 */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost // substitution
      );
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

/**
 * Returns every topic known for a grade/subject, across all terms if
 * `term` is omitted or not found — a Blueprint's `term` field is
 * nullable (Migration 029), so validation must still work for a
 * termless blueprint by checking the union of the year's topics rather
 * than refusing to validate at all.
 *
 * @returns {string[]}
 */
function topicsForGradeSubject(grade, subject, term) {
  if (term != null) {
    const termTopics = getTermTopics(grade, subject, term);
    if (termTopics.length > 0) return termTopics;
  }

  // Fall back to the union across all four terms for this grade/subject.
  const key = subjectKey(subject);
  const subjectData = CAPS_TOPICS[key];
  if (!subjectData || !subjectData[grade]) return [];

  const seen = new Set();
  const all = [];
  for (const t of Object.values(subjectData[grade])) {
    for (const topic of t) {
      if (!seen.has(topic)) {
        seen.add(topic);
        all.push(topic);
      }
    }
  }
  return all;
}

/**
 * Validates a single topic string against the CAPS Topic Registry.
 *
 * @param {number} grade
 * @param {string} subject
 * @param {number|null} term
 * @param {string} topic
 * @returns {{
 *   valid: boolean,
 *   dataAvailable: boolean,
 *   matchedTopic: string|null,
 *   suggestions: string[]
 * }}
 *   valid: true means either an exact match was found, or no registry
 *     data exists for this grade/subject (dataAvailable: false) — in
 *     which case the topic is accepted as-is since there is nothing to
 *     validate against.
 *   matchedTopic: the exact registry string when valid via exact match
 *     (case-insensitive), useful for normalizing "fractions" →
 *     "Fractions" before storage.
 *   suggestions: up to 3 near-miss topics, closest first, only
 *     populated when dataAvailable is true and there is no exact match.
 */
function validateTopic(grade, subject, term, topic) {
  const registryTopics = topicsForGradeSubject(grade, subject, term);

  if (registryTopics.length === 0) {
    return { valid: true, dataAvailable: false, matchedTopic: null, suggestions: [] };
  }

  const normalizedInput = normalizeTopic(topic);
  const exact = registryTopics.find((t) => normalizeTopic(t) === normalizedInput);

  if (exact) {
    return { valid: true, dataAvailable: true, matchedTopic: exact, suggestions: [] };
  }

  const ranked = registryTopics
    .map((t) => ({ topic: t, distance: levenshtein(normalizedInput, normalizeTopic(t)) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, SUGGESTION_LIMIT)
    .map((r) => r.topic);

  return { valid: false, dataAvailable: true, matchedTopic: null, suggestions: ranked };
}

/**
 * Validates every question in a blueprint-shaped question list at once
 * — the check `publishBlueprint()`'s caller should run before invoking
 * blueprintRepository.publishBlueprint(), per ADR-005 Section 7: "A
 * Blueprint cannot move from Draft to Published while it contains any
 * unresolved topic."
 *
 * @param {number} grade
 * @param {string} subject
 * @param {number|null} term
 * @param {Array<{ questionNumber: number, topic: string }>} questions
 * @returns {{ allValid: boolean, results: Array<{ questionNumber: number, topic: string, valid: boolean, dataAvailable: boolean, matchedTopic: string|null, suggestions: string[] }> }}
 */
function validateBlueprintTopics(grade, subject, term, questions) {
  const results = questions.map((q) => ({
    questionNumber: q.questionNumber,
    topic: q.topic,
    ...validateTopic(grade, subject, term, q.topic),
  }));

  return {
    allValid: results.every((r) => r.valid),
    results,
  };
}

module.exports = {
  validateTopic,
  validateBlueprintTopics,
};
