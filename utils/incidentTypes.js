'use strict';

/**
 * Incident Type Taxonomy (Feature 3 — Teacher Incident Book).
 *
 * Sole source of truth for the controlled incident-type vocabulary.
 * services/incidentService.js and flows/incidentFlow.js both derive
 * validation and the WhatsApp menu directly from this module — neither
 * maintains an independent list. Mirrors the taxonomy-file pattern
 * already established by utils/qmsTopics.js for QMS topics, so adding a
 * new incident category later means adding one entry here, not a schema
 * migration or a code change anywhere else — incidents.incident_type is
 * a plain TEXT column (see utils/database.js Migration 043) with no DB
 * CHECK constraint, deliberately, for exactly this reason.
 *
 * `id` is the only value ever persisted (incidents.incident_type).
 * `label`/`order` may change freely; `id` changing would orphan
 * historical rows already using the old id, so treat renames the same
 * way qmsTopics.js treats topicId renames — deliberately, not casually.
 */

/**
 * @typedef {object} IncidentType
 * @property {string} id - stable, persisted, not renamed casually.
 * @property {string} label - human-readable, shown in WhatsApp menu and dashboard.
 * @property {number} order - WhatsApp menu / dashboard filter display order.
 */

/** @type {IncidentType[]} */
const INCIDENT_TYPES = [
  { id: 'INJURY', label: 'Injury', order: 1 },
  { id: 'BULLYING', label: 'Bullying', order: 2 },
  { id: 'DISCIPLINE', label: 'Discipline / Behaviour', order: 3 },
  { id: 'PROPERTY_DAMAGE', label: 'Property Damage', order: 4 },
  { id: 'HEALTH', label: 'Health / Illness', order: 5 },
  { id: 'SAFETY', label: 'Safety Concern', order: 6 },
  { id: 'OTHER', label: 'Other', order: 7 },
];

const TYPES_BY_ID = new Map(INCIDENT_TYPES.map((t) => [t.id, t]));
const VALID_TYPE_IDS = new Set(INCIDENT_TYPES.map((t) => t.id));

/**
 * @param {*} typeId
 * @returns {boolean}
 */
function isValidIncidentType(typeId) {
  return typeof typeId === 'string' && VALID_TYPE_IDS.has(typeId);
}

/**
 * @param {*} typeId
 * @returns {IncidentType|null}
 */
function getIncidentTypeById(typeId) {
  if (typeof typeId !== 'string') return null;
  return TYPES_BY_ID.get(typeId) || null;
}

/**
 * Returns all incident types sorted by ascending `order` — the same
 * order rendered in the WhatsApp numbered menu and the dashboard filter.
 *
 * @returns {IncidentType[]}
 */
function listIncidentTypesOrdered() {
  return [...INCIDENT_TYPES].sort((a, b) => a.order - b.order);
}

module.exports = {
  INCIDENT_TYPES,
  isValidIncidentType,
  getIncidentTypeById,
  listIncidentTypesOrdered,
};