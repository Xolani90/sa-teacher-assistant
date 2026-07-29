#!/usr/bin/env node
'use strict';

/**
 * Reconciliation for classes.learner_count vs the live roster.
 *
 * classes.learner_count is a write-time cache (see
 * services/learnerRosterService.js's syncLearnerCount) — it's only
 * updated when a class's roster is written to through that module
 * (setRoster/addLearner/removeLearner/clearRoster). Two classes of
 * class end up stale:
 *
 *   1. Legacy classes created via the WhatsApp "NEW CLASS <name> |
 *      <count>" flow (flows/workspaceFlow.js) before a roster was ever
 *      captured — the stored count is a declared capacity, not a real
 *      headcount, and stays that way until ADD LEARNER / ROSTER runs.
 *   2. Any class whose cache simply drifted from a bug, a direct DB
 *      edit, or a migration that touched `learners` without going
 *      through learnerRosterService.
 *
 * The dashboard (GET /api/classes, GET /api/classes/:id/detail) no
 * longer reads classes.learner_count at all — both routes now compute
 * the live count from `learners` directly (see
 * learnerRosterService.getActiveRosterCounts). This script exists to
 * (a) surface how much drift exists across the fleet, for visibility,
 * and (b) optionally repair the cache itself so any code path that
 * still legitimately reads classes.learner_count as a capacity/cache
 * (WhatsApp's assessment-capture slot count, "NEW CLASS" confirmation,
 * etc.) has an accurate number too.
 *
 * Usage:
 *   node scripts/reconcile-learner-counts.js              # report only
 *   node scripts/reconcile-learner-counts.js --fix         # report + repair
 *
 * Requires DB_PATH to be set the same way the running app is
 * configured (see utils/database.js) — this script uses the same
 * getDb().
 */

const { getDb } = require('../utils/database');

const FIX = process.argv.includes('--fix');

function main() {
  const db = getDb();

  const classes = db.prepare(`SELECT id, phone_hash, name, learner_count FROM classes`).all();

  const liveCounts = new Map(
    db
      .prepare(
        `SELECT class_id AS classId, COUNT(*) AS count
         FROM learners
         WHERE class_id IS NOT NULL AND removed_at IS NULL
         GROUP BY class_id`
      )
      .all()
      .map((row) => [row.classId, row.count])
  );

  const drifted = [];

  for (const cls of classes) {
    const actual = liveCounts.get(cls.id) || 0;
    if (actual !== cls.learner_count) {
      drifted.push({ ...cls, actual });
    }
  }

  console.log(`Checked ${classes.length} class(es). ${drifted.length} disagree with the live roster.\n`);

  if (drifted.length === 0) {
    console.log('Nothing to do — classes.learner_count matches the roster everywhere.');
    return;
  }

  for (const d of drifted) {
    const status = d.actual === 0 ? 'Needs roster capture' : 'Stale cache';
    console.log(
      `${d.name} (id=${d.id})\n  Stored:  ${d.learner_count}\n  Actual:  ${d.actual}\n  Status:  ${status}\n`
    );
  }

  if (!FIX) {
    console.log('Dry run — no writes made. Re-run with --fix to repair classes.learner_count.');
    return;
  }

  const update = db.prepare(
    `UPDATE classes SET learner_count = ?, updated_at = datetime('now') WHERE id = ?`
  );
  const applyFixes = db.transaction((rows) => {
    for (const d of rows) update.run(d.actual, d.id);
  });
  applyFixes(drifted);

  console.log(`Repaired ${drifted.length} class(es). classes.learner_count now matches the live roster.`);
}

main();
