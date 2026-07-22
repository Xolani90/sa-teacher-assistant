'use strict';

/**
 * services/learnerRosterService.js
 *
 * ADR-006 PR2.5 — Class Roster Management (read/prefill).
 * ADR-006 PR3   — Roster maintenance: validation, add/remove one learner,
 *                  clear, and MERGE/REPLACE semantics for a re-pasted list.
 *
 * Sits directly on top of ADR-003 learner identity (resolveLearner) and
 * the existing `classes` table (Migration 012). There is no separate
 * "roster" table: a class's roster is simply the set of `learners` rows
 * for that (phone_hash, class_id) that have not been soft-removed —
 * see removed_at (Migration 031) — ordered by id (i.e. the order they
 * were first added in — see setRoster()).
 *
 * Removal is always soft (removed_at set, row kept) rather than a DELETE
 * or a class_id change. learner_id is referenced by learner_results and
 * observation_records (Migration 025) and must survive a teacher tidying
 * up their class list, and reusing class_id = NULL for "removed" would
 * collide with idx_learners_identity_unclassed the moment two different
 * classes each remove a same-named learner — see Migration 031's comment
 * for the full reasoning.
 */

const { getDb } = require('../utils/database');
const { resolveLearner, normalizeName } = require('./learnerIdentityService');

function getRoster(phoneHash, classId) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, canonical_name AS name
    FROM learners
    WHERE phone_hash = ? AND class_id = ? AND removed_at IS NULL
    ORDER BY id ASC
  `).all(phoneHash, classId);
  return rows;
}

function resolveAndReviveInClass(phoneHash, classId, name) {
  const db = getDb();
  const learner = resolveLearner({ phoneHash, classId, learnerName: name });
  if (learner.removed_at) {
    db.prepare(`UPDATE learners SET removed_at = NULL, updated_at = datetime('now') WHERE id = ?`)
      .run(learner.id);
  }
  return learner;
}

function syncLearnerCount(phoneHash, classId) {
  const db = getDb();
  const roster = getRoster(phoneHash, classId);
  db.prepare(`UPDATE classes SET learner_count = ?, updated_at = datetime('now') WHERE id = ? AND phone_hash = ?`)
    .run(roster.length, classId, phoneHash);
  return roster;
}

function setRoster(phoneHash, classId, names, opts = {}) {
  const mode = opts.mode === 'replace' ? 'replace' : 'merge';
  const cleanNames = names.map((n) => String(n).trim()).filter((n) => n.length >= 2);
  if (cleanNames.length === 0) {
    throw new Error('setRoster: at least one valid learner name is required');
  }

  const beforeIds = new Set(getRoster(phoneHash, classId).map((l) => l.id));

  let added = 0;
  let matched = 0;
  const keptIds = new Set();
  for (const name of cleanNames) {
    const learner = resolveAndReviveInClass(phoneHash, classId, name);
    keptIds.add(learner.id);
    if (beforeIds.has(learner.id)) {
      matched += 1;
    } else {
      added += 1;
    }
  }

  let removed = 0;
  if (mode === 'replace') {
    const db = getDb();
    for (const id of beforeIds) {
      if (!keptIds.has(id)) {
        db.prepare(`UPDATE learners SET removed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(id);
        removed += 1;
      }
    }
  }

  const roster = syncLearnerCount(phoneHash, classId);
  return { roster, added, matched, removed };
}

function addLearner(phoneHash, classId, name) {
  const clean = String(name).trim();
  if (clean.length < 2) {
    throw new Error('addLearner: name must be at least 2 characters');
  }

  const beforeIds = new Set(getRoster(phoneHash, classId).map((l) => l.id));
  const learner = resolveAndReviveInClass(phoneHash, classId, clean);
  const wasNew = !beforeIds.has(learner.id);

  const roster = syncLearnerCount(phoneHash, classId);
  return { roster, learner: { id: learner.id, name: learner.canonical_name }, wasNew };
}

function removeLearner(phoneHash, classId, learnerId) {
  const db = getDb();
  const row = db.prepare(`
    SELECT id FROM learners
    WHERE id = ? AND phone_hash = ? AND class_id = ? AND removed_at IS NULL
  `).get(learnerId, phoneHash, classId);

  if (!row) {
    return { roster: getRoster(phoneHash, classId), removed: false };
  }

  db.prepare(`UPDATE learners SET removed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
    .run(learnerId);

  const roster = syncLearnerCount(phoneHash, classId);
  return { roster, removed: true };
}

function clearRoster(phoneHash, classId) {
  const db = getDb();
  const current = getRoster(phoneHash, classId);
  for (const learner of current) {
    db.prepare(`UPDATE learners SET removed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
      .run(learner.id);
  }
  const roster = syncLearnerCount(phoneHash, classId);
  return { roster, removed: current.length };
}

function parseRosterPaste(text) {
  return splitRosterLines(text).filter((line) => line.length >= 2);
}

function splitRosterLines(text) {
  return String(text)
    .split('\n')
    .map((line) => line.replace(/\r$/, '').trim())
    .map((line) => line.replace(/^\d+[.)]\s*/, ''));
}

function validateRosterNames(lines) {
  const errors = [];
  const seen = new Map();

  lines.forEach((line, i) => {
    const lineNo = i + 1;
    if (line.length === 0) {
      errors.push(`Line ${lineNo}: blank line detected.`);
      return;
    }
    if (line.length < 2) {
      errors.push(`Line ${lineNo}: "${line}" is too short to be a name.`);
      return;
    }
    const norm = normalizeName(line);
    if (seen.has(norm)) {
      errors.push(`Line ${lineNo}: duplicate learner "${line}" (already listed on line ${seen.get(norm)}).`);
      return;
    }
    seen.set(norm, lineNo);
  });

  return { valid: errors.length === 0, errors, names: lines };
}

function formatRosterList(roster) {
  return roster.map((l, i) => `${i + 1}. ${l.name}`).join('\n');
}

module.exports = {
  getRoster,
  setRoster,
  addLearner,
  removeLearner,
  clearRoster,
  parseRosterPaste,
  splitRosterLines,
  validateRosterNames,
  formatRosterList,
};
