'use strict';

/**
 * services/learnerRosterService.js
 *
 * ADR-006 PR2.5 — Class Roster Management.
 *
 * Sits directly on top of ADR-003 learner identity (resolveLearner) and
 * the existing `classes` table (Migration 012). There is no separate
 * "roster" table: a class's roster is simply the set of `learners` rows
 * for that (phone_hash, class_id), ordered by id (i.e. the order they
 * were first added in — see setRoster()).
 *
 * This closes the gap flagged at the end of PR2: assessment capture had
 * to ask for every learner's name, every single assessment, because
 * classes only ever stored a learner_count. Once a roster exists,
 * assessmentSessionFlow.js can prefill capture from it instead
 * (see assessmentCaptureService.initCapture's `roster` param).
 *
 * Deliberately excluded from this PR (same "keep it small" discipline
 * as PR2): no reordering, no rename/merge UI, no removing a learner
 * once added — those are natural follow-ups once this is in daily use.
 */

const { getDb } = require('../utils/database');
const { resolveLearner } = require('./learnerIdentityService');

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
    WHERE phone_hash = ? AND class_id = ?
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
 * @returns {{ roster: Array<{id:number,name:string}>, added: number, matched: number }}
 */
function setRoster(phoneHash, classId, names) {
  const cleanNames = names.map((n) => String(n).trim()).filter((n) => n.length >= 2);
  if (cleanNames.length === 0) {
    throw new Error('setRoster: at least one valid learner name is required');
  }

  const before = new Set(getRoster(phoneHash, classId).map((l) => l.id));

  let added = 0;
  let matched = 0;
  for (const name of cleanNames) {
    const learner = resolveLearner({ phoneHash, classId, learnerName: name });
    if (before.has(learner.id)) {
      matched += 1;
    } else {
      added += 1;
      before.add(learner.id);
    }
  }

  const roster = getRoster(phoneHash, classId);

  const db = getDb();
  db.prepare(`UPDATE classes SET learner_count = ?, updated_at = datetime('now') WHERE id = ? AND phone_hash = ?`)
    .run(roster.length, classId, phoneHash);

  return { roster, added, matched };
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
  setRoster,
  parseRosterPaste,
  formatRosterList,
};
