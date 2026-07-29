'use strict';

/**
 * services/learnerRosterService.js
 *
 * ADR-006 PR2.5 — Class Roster Management (read/prefill), extended by
 * PR3 — WhatsApp roster management (ADD/REMOVE/CLEAR/REPLACE-or-MERGE).
 *
 * Sits directly on top of ADR-003 learner identity (resolveLearner) and
 * the existing `classes` table (Migration 012). There is no separate
 * "roster" table: a class's roster is simply the set of `learners` rows
 * for that (phone_hash, class_id) with removed_at IS NULL, ordered by id
 * (i.e. the order they were first added in — see setRoster()).
 *
 * This closes the gap flagged at the end of PR2: assessment capture had
 * to ask for every learner's name, every single assessment, because
 * classes only ever stored a learner_count. Once a roster exists,
 * assessmentSessionFlow.js can prefill capture from it instead
 * (see assessmentCaptureService.initCapture's `roster` param).
 *
 * PR2.5 deliberately excluded reordering, rename/merge UI, and removing
 * a learner once added. PR3 closes the "removing a learner" gap:
 *
 * Removal is soft (removed_at, Migration 031) rather than a DELETE or a
 * class_id change: learner_id is referenced by learner_results and
 * observation_records (Migration 025) and must survive roster cleanup.
 * Deliberately NOT modeled as class_id = NULL ("unclassed"): that would
 * collide with idx_learners_identity_unclassed (Migration 026) the
 * moment two different classes each remove a same-named learner. A
 * dedicated nullable timestamp sidesteps that class of bug entirely
 * rather than catching the constraint violation after the fact. It also
 * means re-adding a previously-removed learner (matched by identity via
 * resolveLearner) simply un-removes them — their history in
 * learner_results / observation_records was never touched.
 */

const { getDb } = require('../utils/database');
const { resolveLearner } = require('./learnerIdentityService');

function normalizeName(name) {
  if (typeof name !== 'string') return '';
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

// Keeps classes.learner_count in sync with the *active* roster (excludes
// soft-removed learners) after any write in this module.
function syncLearnerCount(db, phoneHash, classId) {
  const { count } = db.prepare(`
    SELECT COUNT(*) AS count FROM learners
    WHERE phone_hash = ? AND class_id = ? AND removed_at IS NULL
  `).get(phoneHash, classId);
  db.prepare(`UPDATE classes SET learner_count = ?, updated_at = datetime('now') WHERE id = ? AND phone_hash = ?`)
    .run(count, classId, phoneHash);
  return count;
}

/**
 * Returns the live, active-roster learner count for every one of a
 * teacher's classes in a single query, keyed by class_id.
 *
 * Exists because `classes.learner_count` (see syncLearnerCount above) is
 * a *cache* — it is only updated on writes that go through this module
 * (setRoster/addLearner/removeLearner/clearRoster). A class created via
 * the legacy WhatsApp "NEW CLASS <name> | <count>" flow (or one whose
 * cache simply drifted) can carry a stored count that disagrees with
 * what's actually in the `learners` table. Any surface that needs to
 * show teachers a number they can trust — the dashboard class list and
 * Class Detail command center in particular — must read this function's
 * result, not `classes.learner_count`, directly. See
 * scripts/reconcile-learner-counts.js for a one-off audit/repair of the
 * cached column itself.
 *
 * @param {string} phoneHash
 * @returns {Map<number, number>} classId -> active learner count
 */
function getActiveRosterCounts(phoneHash) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT class_id AS classId, COUNT(*) AS count
    FROM learners
    WHERE phone_hash = ? AND class_id IS NOT NULL AND removed_at IS NULL
    GROUP BY class_id
  `).all(phoneHash);

  const counts = new Map();
  for (const row of rows) counts.set(row.classId, row.count);
  return counts;
}

/**
 * Returns a class's roster in stable order (oldest-added first).
 *
 * @param {string} phoneHash
 * @param {number} classId
 * @returns {Array<{ id: number, name: string }>}
 */
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

/**
 * Adds (or reconciles) a list of learner names into a class's roster.
 * Each name is resolved via resolveLearner(), so re-running this with a
 * name that's already in the roster is a safe no-op for that name (it
 * matches the existing row rather than duplicating it) — same identity
 * guarantee assessment capture already relies on.
 *
 * Also keeps classes.learner_count in sync with the resulting roster
 * size, so existing learner_count-based UI (e.g. "Learners: 38" in the
 * assessment flow) stays correct even before ACTIVE capture reads the
 * roster directly.
 *
 * @param {string} phoneHash
 * @param {number} classId
 * @param {string[]} names - raw, order-preserving list of learner names
 * @param {{ mode?: 'replace'|'merge' }} [options] - 'merge' (default,
 *   PR2.5-compatible): adds/matches every name, removes nothing. Any
 *   caller that omits options keeps the exact PR2.5 behaviour.
 *   'replace': after adding/matching every pasted name, any *other*
 *   active roster member not present in the pasted list is soft-removed
 *   (removed_at) — used when a teacher re-pastes a full class list.
 * @returns {{ roster: Array<{id:number,name:string}>, added: number, matched: number, removed: number }}
 */
function setRoster(phoneHash, classId, names, { mode = 'merge' } = {}) {
  const cleanNames = names.map((n) => String(n).trim()).filter((n) => n.length >= 2);
  if (cleanNames.length === 0) {
    throw new Error('setRoster: at least one valid learner name is required');
  }

  const db = getDb();
  const beforeIds = new Set(getRoster(phoneHash, classId).map((l) => l.id));
  const resolvedIds = new Set();

  let added = 0;
  let matched = 0;
  for (const name of cleanNames) {
    const learner = resolveLearner({ phoneHash, classId, learnerName: name });

    // Re-pasting a name that matches a previously-removed learner
    // (identity match via resolveLearner) un-removes them rather than
    // creating a duplicate row.
    if (learner.removed_at) {
      db.prepare(`UPDATE learners SET removed_at = NULL, updated_at = datetime('now') WHERE id = ?`).run(learner.id);
    }

    resolvedIds.add(learner.id);
    if (beforeIds.has(learner.id)) {
      matched += 1;
    } else {
      added += 1;
    }
  }

  let removed = 0;
  if (mode === 'replace') {
    const now = new Date().toISOString();
    try {
      db.prepare('BEGIN').run();
      for (const id of beforeIds) {
        if (!resolvedIds.has(id)) {
          db.prepare(`UPDATE learners SET removed_at = ?, updated_at = datetime('now') WHERE id = ? AND phone_hash = ?`)
            .run(now, id, phoneHash);
          removed += 1;
        }
      }
      db.prepare('COMMIT').run();
    } catch (err) {
      try { db.prepare('ROLLBACK').run(); } catch (_) { /* best-effort */ }
      throw err;
    }
  }

  const roster = getRoster(phoneHash, classId);
  syncLearnerCount(db, phoneHash, classId);

  return { roster, added, matched, removed };
}

/**
 * Adds a single learner to a class's roster (WhatsApp "ADD LEARNER
 * <name>"). Identity-matched via resolveLearner, same as setRoster, so
 * adding a name already on the roster is a safe no-op rather than a
 * duplicate. Adding a name that matches a previously soft-removed
 * learner un-removes them.
 *
 * @param {string} phoneHash
 * @param {number} classId
 * @param {string} name
 * @returns {{ learner: {id:number,name:string}, alreadyOnRoster: boolean, rosterSize: number }}
 */
function addLearner(phoneHash, classId, name) {
  const trimmedName = String(name || '').trim();
  if (trimmedName.length < 2) {
    throw new Error('addLearner: name must be at least 2 characters');
  }

  const db = getDb();
  const alreadyOnRoster = getRoster(phoneHash, classId)
    .some((l) => normalizeName(l.name) === normalizeName(trimmedName));

  const learner = resolveLearner({ phoneHash, classId, learnerName: trimmedName });
  if (learner.removed_at) {
    db.prepare(`UPDATE learners SET removed_at = NULL, updated_at = datetime('now') WHERE id = ?`).run(learner.id);
  }

  const rosterSize = syncLearnerCount(db, phoneHash, classId);

  return {
    learner: { id: learner.id, name: learner.canonical_name },
    alreadyOnRoster,
    rosterSize,
  };
}

/**
 * Soft-removes a single learner from a class's roster by exact
 * (normalized) name match against the *active* roster — deliberately no
 * fuzzy matching, same determinism rule as ADR-003 identity resolution.
 * Their learner_results / observation_records rows are untouched.
 *
 * @param {string} phoneHash
 * @param {number} classId
 * @param {string} name
 * @returns {{ removed: boolean, learner: {id:number,name:string}|null, rosterSize: number }}
 */
function removeLearner(phoneHash, classId, name) {
  const db = getDb();
  const normalized = normalizeName(name);

  const learner = db.prepare(`
    SELECT id, canonical_name AS name
    FROM learners
    WHERE phone_hash = ? AND class_id = ? AND normalized_name = ? AND removed_at IS NULL
  `).get(phoneHash, classId, normalized) || null;

  if (!learner) {
    return { removed: false, learner: null, rosterSize: getRoster(phoneHash, classId).length };
  }

  db.prepare(`UPDATE learners SET removed_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND phone_hash = ?`)
    .run(learner.id, phoneHash);

  const rosterSize = syncLearnerCount(db, phoneHash, classId);

  return { removed: true, learner, rosterSize };
}

/**
 * Soft-removes every active learner on a class's roster (WhatsApp
 * "CLEAR ROSTER"). Their history is kept — only removed_at is set —
 * so re-adding any of them later (ADD LEARNER or a future ROSTER paste)
 * un-removes the same identity rather than creating a duplicate.
 *
 * @param {string} phoneHash
 * @param {number} classId
 * @returns {{ clearedCount: number }}
 */
function clearRoster(phoneHash, classId) {
  const db = getDb();
  const roster = getRoster(phoneHash, classId);
  const now = new Date().toISOString();

  try {
    db.prepare('BEGIN').run();
    for (const learner of roster) {
      db.prepare(`UPDATE learners SET removed_at = ?, updated_at = datetime('now') WHERE id = ? AND phone_hash = ?`)
        .run(now, learner.id, phoneHash);
    }
    db.prepare('COMMIT').run();
  } catch (err) {
    try { db.prepare('ROLLBACK').run(); } catch (_) { /* best-effort */ }
    throw err;
  }

  syncLearnerCount(db, phoneHash, classId);

  return { clearedCount: roster.length };
}

/**
 * Splits a pasted block of text into raw lines, 1:1 with the original
 * line numbers (no lines dropped or trimmed away) so validateRosterNames
 * can report errors against the line the teacher actually sees in their
 * WhatsApp client. A single trailing newline (the common case when a
 * phone keyboard appends one) is trimmed first so it doesn't surface as
 * a spurious "blank line" error at the end of an otherwise-clean paste.
 *
 * @param {string} text
 * @returns {string[]}
 */
function splitRosterLines(text) {
  return String(text).replace(/\r/g, '').replace(/\n+$/, '').split('\n');
}

/**
 * Strict paste validation for the WhatsApp ROSTER command's PASTE step.
 * Unlike parseRosterPaste() (kept unchanged below for its existing
 * caller), blank lines, too-short names, and duplicate names are
 * reported with line numbers rather than silently dropped — a bad paste
 * should never partially or silently succeed.
 *
 * @param {string} text
 * @returns {{ valid: boolean, names: string[], errors: Array<{line:number, message:string}> }}
 */
function validateRosterNames(text) {
  const rawLines = splitRosterLines(text);
  const errors = [];
  const names = [];
  const seen = new Map(); // normalized name -> first line number it appeared on

  rawLines.forEach((rawLine, i) => {
    const lineNo = i + 1;
    const withoutNumbering = rawLine.trim().replace(/^\d+[.)]\s*/, '').trim();

    if (withoutNumbering.length === 0) {
      errors.push({ line: lineNo, message: 'Blank line' });
      return;
    }
    if (withoutNumbering.length < 2) {
      errors.push({ line: lineNo, message: `Name too short: "${withoutNumbering}"` });
      return;
    }

    const normalized = normalizeName(withoutNumbering);
    if (seen.has(normalized)) {
      errors.push({ line: lineNo, message: `Duplicate of line ${seen.get(normalized)}: "${withoutNumbering}"` });
      return;
    }

    seen.set(normalized, lineNo);
    names.push(withoutNumbering);
  });

  return { valid: errors.length === 0, names, errors };
}

/**
 * Splits a pasted block of text (one learner name per line) into a
 * clean name list, dropping blank lines and stripping optional leading
 * numbering ("1. Sipho Dlamini" / "1) Sipho Dlamini" -> "Sipho Dlamini")
 * so teachers can paste a numbered list straight from wherever they kept
 * it without reformatting first.
 *
 * @param {string} text
 * @returns {string[]}
 */
function parseRosterPaste(text) {
  return String(text)
    .split('\n')
    .map((line) => line.replace(/\r$/, '').trim())
    .map((line) => line.replace(/^\d+[.)]\s*/, ''))
    .filter((line) => line.length >= 2);
}

/**
 * Formats a roster for display, e.g. after ROSTER is set or via STATUS.
 * @param {Array<{ name: string }>} roster
 * @returns {string}
 */
function formatRosterList(roster) {
  return roster.map((l, i) => `${i + 1}. ${l.name}`).join('\n');
}

module.exports = {
  getRoster,
  getActiveRosterCounts,
  setRoster,
  addLearner,
  removeLearner,
  clearRoster,
  parseRosterPaste,
  splitRosterLines,
  validateRosterNames,
  formatRosterList,
};
