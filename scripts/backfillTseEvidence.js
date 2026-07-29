#!/usr/bin/env node
'use strict';

/**
 * One-time backfill for the TSE Evidence Engine (Migration 034, Sprint 1).
 *
 * Tags evidence for every pre-existing row in the six source tables that
 * predates the Evidence Engine (i.e. rows saved before tagEvidence() was
 * wired into the live write paths). Safe to re-run: tagEvidence() is
 * idempotent via tse_evidence_links' UNIQUE(source_table, source_id,
 * category) constraint, so running this twice (or after new live rows
 * have already been tagged) produces zero duplicate rows.
 *
 * Usage:
 *   node scripts/backfillTseEvidence.js --dry-run   # report only, no writes
 *   node scripts/backfillTseEvidence.js              # actually tag
 *
 * Requires DB_PATH to be set the same way the running app is configured
 * (see utils/database.js) — this script uses the same getDb().
 */

const { getDb } = require('../utils/database');
const { tagEvidence } = require('../services/tseEvidenceService');

const DRY_RUN = process.argv.includes('--dry-run');

function backfillTable({ table, category, phoneHashColumn = 'phone_hash', termColumn = 'term' }) {
  const db = getDb();
  const hasTermColumn = db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((col) => col.name === termColumn);

  const rows = db.prepare(`SELECT id, ${phoneHashColumn} AS phone_hash${hasTermColumn ? `, ${termColumn} AS term` : ''} FROM ${table}`).all();

  let tagged = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row.phone_hash) { skipped++; continue; }

    if (DRY_RUN) {
      // Dry run: check whether a row would be inserted (i.e. doesn't already exist)
      // without writing anything.
      const existing = db
        .prepare(
          `SELECT 1 FROM tse_evidence_links WHERE source_table = ? AND source_id = ? AND category = ?`
        )
        .get(table, row.id, category);
      if (!existing) tagged++;
      else skipped++;
      continue;
    }

    const inserted = tagEvidence(row.phone_hash, category, table, row.id, hasTermColumn ? row.term : null);
    if (inserted) tagged++;
    else skipped++;
  }

  console.log(`  ${table.padEnd(24)} → ${String(tagged).padStart(5)} tagged, ${String(skipped).padStart(5)} already present/skipped`);
  return { tagged, skipped };
}

function run() {
  console.log(`TSE Evidence Engine backfill${DRY_RUN ? ' (DRY RUN — no writes)' : ''}`);
  console.log('─'.repeat(60));

  const targets = [
    { table: 'saved_resources', category: 'resource' },
    { table: 'assessments', category: 'assessment' },
    { table: 'reports', category: 'assessment' },
    { table: 'intervention_plans', category: 'intervention' },
    { table: 'curriculum_coverage', category: 'curriculum' },
    { table: 'observation_assessments', category: 'observation' },
  ];

  let totalTagged = 0;
  let totalSkipped = 0;

  for (const target of targets) {
    const { tagged, skipped } = backfillTable(target);
    totalTagged += tagged;
    totalSkipped += skipped;
  }

  console.log('─'.repeat(60));
  console.log(`Total: ${totalTagged} tagged, ${totalSkipped} skipped`);
  if (DRY_RUN) {
    console.log('\nThis was a dry run — no rows were written. Re-run without --dry-run to apply.');
  }
}

if (require.main === module) {
  run();
}

module.exports = { run, backfillTable };
