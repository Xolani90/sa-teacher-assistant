'use strict';

/**
 * QMS Topic Taxonomy (PR32, ADR-013 §3/§4.1).
 *
 * Sole source of truth for the controlled QMS topic vocabulary. No other
 * file may define topic constants or maintain an independent list of
 * valid topic ids — reflectionService.js, growthPlanService.js, and
 * qmsTopicSelection.js all derive validation directly from this module.
 *
 * `id` is the only value ever persisted (qms_reflections.topic_id,
 * qms_growth_plans.topic_id). `label`/`description`/`order` may change
 * freely without a migration; `id` changing requires one (ADR-013 §3.2).
 *
 * `order` is schema-free but not behavior-free: it is a direct input to
 * the coaching engine's recommendation tie-break (ADR-013 §6.4). Changing
 * `order` is a behavioral change to future coaching output, not a
 * cosmetic UI edit, and should go through the same review as any other
 * change affecting recommendation ranking.
 *
 * Changes to this list (adding, removing, or renaming a topicId) require
 * their own ADR or explicit architectural review — not an unreviewed edit
 * to this file (ADR-013 §3.1).
 */

/**
 * @typedef {object} QmsTopic
 * @property {string} id - stable, persisted, never renamed without a migration.
 * @property {string} label - human-readable, may change freely.
 * @property {string} description - for future onboarding UI.
 * @property {number} order - display/tie-break ordering (ADR-013 §6.4). Expected
 *   unique; the coaching engine's tie-break also falls back to topicId, so
 *   a duplicate here degrades gracefully rather than being load-bearing.
 */

/** @type {QmsTopic[]} */
const QMS_TOPICS = [
  {
    id: 'TOPIC_CLASSROOM_MANAGEMENT',
    label: 'Classroom Management',
    description: 'Managing learner behaviour, transitions, and routines.',
    order: 1,
  },
  {
    id: 'TOPIC_ASSESSMENT',
    label: 'Assessment',
    description: 'Formative and summative assessment practice.',
    order: 2,
  },
  {
    id: 'TOPIC_LEARNER_ENGAGEMENT',
    label: 'Learner Engagement',
    description: 'Motivation, participation, and active learning.',
    order: 3,
  },
  {
    id: 'TOPIC_DIFFERENTIATION',
    label: 'Differentiation',
    description: 'Adapting instruction for varied learner needs.',
    order: 4,
  },
  {
    id: 'TOPIC_CURRICULUM_COVERAGE',
    label: 'Curriculum Coverage',
    description: 'Pacing and coverage against the CAPS curriculum.',
    order: 5,
  },
  {
    id: 'TOPIC_PROFESSIONAL_PRACTICE',
    label: 'Professional Practice',
    description: 'General professional growth not covered by another topic.',
    order: 6,
  },
];

// Frozen so a caller with a reference to QMS_TOPICS (or one of its entries)
// cannot mutate the shared list at runtime — this is static application
// configuration, not admin-editable state (ADR-013 §3.2).
Object.freeze(QMS_TOPICS);
QMS_TOPICS.forEach(Object.freeze);

/** @type {Set<string>} */
const VALID_TOPIC_IDS = new Set(QMS_TOPICS.map((t) => t.id));

/** @type {Map<string, QmsTopic>} */
const TOPICS_BY_ID = new Map(QMS_TOPICS.map((t) => [t.id, t]));

/**
 * Returns true if topicId is a member of the current active taxonomy.
 * This is the single validation entry point — services and the selection
 * helper call this rather than re-deriving a valid-ids list of their own.
 *
 * @param {*} topicId
 * @returns {boolean}
 */
function isValidTopicId(topicId) {
  return typeof topicId === 'string' && VALID_TOPIC_IDS.has(topicId);
}

/**
 * Returns the taxonomy entry for a topicId, or null if topicId is not in
 * the active taxonomy (including null/undefined/malformed input). Callers
 * needing resilience against stale persisted values (ADR-013 §6.1) should
 * treat a null return here the same way they treat a null topic_id.
 *
 * @param {*} topicId
 * @returns {QmsTopic|null}
 */
function getTopicById(topicId) {
  if (typeof topicId !== 'string') return null;
  return TOPICS_BY_ID.get(topicId) || null;
}

/**
 * Returns all topics sorted by ascending `order`. Callers rendering a
 * topic list (e.g. qmsTopicSelection.js) must use this rather than
 * iterating QMS_TOPICS directly, since module declaration order is an
 * implementation detail and not a guaranteed ordering (ADR-013 §4.2).
 *
 * @returns {QmsTopic[]}
 */
function listTopicsOrdered() {
  return [...QMS_TOPICS].sort((a, b) => a.order - b.order);
}

module.exports = {
  QMS_TOPICS,
  isValidTopicId,
  getTopicById,
  listTopicsOrdered,
};
