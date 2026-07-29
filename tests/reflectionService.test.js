'use strict';
/**
 * Migration 037 + reflectionService Tests (PR27, ADR-011)
 *
 * Covers:
 *   1. Migration 037 verification — qms_reflections table shape/defaults
 *   2. createReflection() input guards + round-trip insert
 *   3. getReflection() — phone_hash scoping, excludes soft-deleted rows
 *   4. listReflections() — ordering, term scoping, excludes soft-deleted
 *   5. updateReflection() — editable fields, ownership scoping, no-op cases
 *   6. deleteReflection() — soft delete semantics (never a hard DELETE)
 *   7. Reflection without evidence (ADR-011 §7 — must be allowed)
 *   8. ai_assisted flag round-trips as a real boolean
 *
 * Run individually:   node tests/reflectionService.test.js
 * Run via npm:         npm test
 */

// ── Shim better-sqlite3 → node:sqlite ────────────────────────────────────────
const Module = require('module');
const { DatabaseSync } = require('node:sqlite');

let _db = null;

const path = require('path');
const dbPath = path.resolve(__dirname, '../utils/database');

const _origResolve = Module._resolveFilename.bind(Module);
Module._resolveFilename = function (request, parent, isMain, opts) {
  if (request === 'better-sqlite3') return request;
  if (request === '../utils/database' || request === './database') return dbPath;
  return _origResolve(request, parent, isMain, opts);
};
require.cache['better-sqlite3'] = {
  id: 'better-sqlite3',
  filename: 'better-sqlite3',
  loaded: true,
  exports: function Database() {
    if (!_db.pragma) _db.pragma = () => {};
    return _db;
  },
};

require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { getDb: () => _db },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

function assertEq(a, b, label) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    console.error(`     expected: ${JSON.stringify(b)}`);
    console.error(`     got:      ${JSON.stringify(a)}`);
    failed++;
  }
}

function assertThrows(fn, expectedMsg, label) {
  try {
    fn();
    console.error(`  ❌ FAIL: ${label} — expected throw, got no error`);
    failed++;
  } catch (err) {
    if (expectedMsg && !err.message.includes(expectedMsg)) {
      console.error(`  ❌ FAIL: ${label}`);
      console.error(`     expected message to include: "${expectedMsg}"`);
      console.error(`     got: "${err.message}"`);
      failed++;
    } else {
      console.log(`  ✅ ${label}`);
      passed++;
    }
  }
}

// ── Schema (mirrors Migration 037 exactly) ───────────────────────────────────
function buildSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS qms_reflections (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash         TEXT    NOT NULL,
      term               INTEGER,
      content            TEXT    NOT NULL,
      ai_assisted        INTEGER NOT NULL DEFAULT 0,
      evidence_link_ids  TEXT,
      created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
      deleted_at         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_qms_reflections_phone_term
      ON qms_reflections(phone_hash, term);
  `);
}

// ── Test runner ───────────────────────────────────────────────────────────────
async function run() {
  _db = new DatabaseSync(':memory:');
  buildSchema(_db);

  const {
    createReflection,
    getReflection,
    listReflections,
    updateReflection,
    deleteReflection,
  } = require('../services/reflectionService');

  const PHONE = 'reflection_test_hash_001';
  const OTHER_PHONE = 'reflection_test_hash_002';

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 1: Migration 037 verification
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 1: Migration 037 verification ───────────────────────────');

  console.log('\nTest M37-01: qms_reflections row defaults ai_assisted=0, deleted_at NULL');
  const rawInsert = _db
    .prepare(`INSERT INTO qms_reflections (phone_hash, content) VALUES (?, ?)`)
    .run(PHONE, 'raw insert for defaults check');
  const rawRow = _db.prepare(`SELECT * FROM qms_reflections WHERE id = ?`).get(Number(rawInsert.lastInsertRowid));
  assertEq(rawRow.ai_assisted, 0, 'ai_assisted defaults to 0');
  assertEq(rawRow.deleted_at, null, 'deleted_at defaults to NULL');
  assertEq(rawRow.term, null, 'term defaults to NULL (unscoped) when omitted');
  _db.exec(`DELETE FROM qms_reflections`);

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 2: createReflection()
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 2: createReflection() ────────────────────────────────────');

  console.log('\nTest C-01: rejects missing phoneHash');
  assertThrows(() => createReflection(null, { content: 'x' }), 'phoneHash is required', 'throws without phoneHash');

  console.log('\nTest C-02: rejects missing content');
  assertThrows(() => createReflection(PHONE, {}), 'content is required', 'throws without content');

  console.log('\nTest C-03: rejects whitespace-only content');
  assertThrows(() => createReflection(PHONE, { content: '   ' }), 'content is required', 'throws on whitespace-only content');

  console.log('\nTest C-04: rejects non-array evidenceLinkIds');
  assertThrows(
    () => createReflection(PHONE, { content: 'x', evidenceLinkIds: 'not-an-array' }),
    'evidenceLinkIds must be an array',
    'throws on non-array evidenceLinkIds'
  );

  console.log('\nTest C-05: round-trip insert with all fields');
  const created = createReflection(PHONE, {
    content: 'Learners struggled with fractions. I switched to visual models.',
    term: 2,
    aiAssisted: true,
    evidenceLinkIds: [12, 15, 22],
  });
  assert(typeof created.id === 'number', 'created reflection has a numeric id');
  assertEq(created.phoneHash, PHONE, 'phoneHash round-trips');
  assertEq(created.term, 2, 'term round-trips');
  assertEq(created.content, 'Learners struggled with fractions. I switched to visual models.', 'content round-trips');
  assertEq(created.aiAssisted, true, 'aiAssisted round-trips as real boolean true');
  assertEq(created.evidenceLinkIds, [12, 15, 22], 'evidenceLinkIds round-trips as a real array');
  assertEq(created.deletedAt, null, 'new reflection is not soft-deleted');

  console.log('\nTest C-06: content is trimmed on insert');
  const trimmed = createReflection(PHONE, { content: '  padded content  ' });
  assertEq(trimmed.content, 'padded content', 'leading/trailing whitespace stripped');

  _db.exec(`DELETE FROM qms_reflections`);

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 3: Reflection without evidence (ADR-011 §7)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 3: reflection without evidence (ADR-011 §7) ──────────────');

  console.log('\nTest NE-01: reflection can be created with no evidenceLinkIds at all');
  const noEvidence = createReflection(PHONE, { content: 'General reflection on a hard term.' });
  assertEq(noEvidence.evidenceLinkIds, [], 'evidenceLinkIds defaults to an empty array, not an error');

  console.log('\nTest NE-02: reflection can be created with explicit empty evidenceLinkIds');
  const explicitEmpty = createReflection(PHONE, { content: 'Another general reflection.', evidenceLinkIds: [] });
  assertEq(explicitEmpty.evidenceLinkIds, [], 'explicit [] is preserved, not rejected');

  _db.exec(`DELETE FROM qms_reflections`);

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 4: getReflection() — ownership scoping + soft-delete exclusion
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 4: getReflection() ───────────────────────────────────────');

  const owned = createReflection(PHONE, { content: 'Owned by PHONE' });

  console.log('\nTest G-01: fetches an owned reflection');
  const fetched = getReflection(PHONE, owned.id);
  assert(fetched !== null, 'returns the reflection');
  assertEq(fetched.id, owned.id, 'returns the correct id');

  console.log('\nTest G-02: returns null for another teacher\'s reflection (ownership scoping)');
  const wrongOwner = getReflection(OTHER_PHONE, owned.id);
  assertEq(wrongOwner, null, 'a teacher cannot fetch another teacher\'s reflection by id');

  console.log('\nTest G-03: returns null for a nonexistent id');
  assertEq(getReflection(PHONE, 999999), null, 'nonexistent id returns null, not a throw');

  console.log('\nTest G-04: returns null after soft delete');
  deleteReflection(PHONE, owned.id);
  assertEq(getReflection(PHONE, owned.id), null, 'soft-deleted reflection is excluded from getReflection');

  _db.exec(`DELETE FROM qms_reflections`);

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 5: listReflections() — ordering, term scoping, soft-delete exclusion
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 5: listReflections() ─────────────────────────────────────');

  const first = createReflection(PHONE, { content: 'First', term: 1 });
  const second = createReflection(PHONE, { content: 'Second', term: 2 });
  const third = createReflection(PHONE, { content: 'Third', term: 2 });
  createReflection(OTHER_PHONE, { content: 'Someone else entirely', term: 2 });

  console.log('\nTest L-01: lists only the requesting teacher\'s reflections');
  const all = listReflections(PHONE);
  assertEq(all.length, 3, 'only PHONE\'s 3 reflections are returned, not OTHER_PHONE\'s');

  console.log('\nTest L-02: most recent first');
  assertEq(all[0].id, third.id, 'newest reflection appears first');
  assertEq(all[2].id, first.id, 'oldest reflection appears last');

  console.log('\nTest L-03: scoped to a single term when requested');
  const termTwo = listReflections(PHONE, { term: 2 });
  assertEq(termTwo.length, 2, 'only term-2 reflections returned');
  assert(termTwo.every((r) => r.term === 2), 'every returned reflection is term 2');

  console.log('\nTest L-04: excludes soft-deleted reflections');
  deleteReflection(PHONE, second.id);
  const afterDelete = listReflections(PHONE);
  assertEq(afterDelete.length, 2, 'soft-deleted reflection is excluded from the list');
  assert(!afterDelete.some((r) => r.id === second.id), 'the deleted id specifically is absent');

  _db.exec(`DELETE FROM qms_reflections`);

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 6: updateReflection()
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 6: updateReflection() ────────────────────────────────────');

  const toUpdate = createReflection(PHONE, {
    content: 'Original content',
    aiAssisted: false,
    evidenceLinkIds: [1, 2],
  });

  console.log('\nTest U-01: updates content');
  const updatedContent = updateReflection(PHONE, toUpdate.id, { content: 'Revised content' });
  assertEq(updatedContent.content, 'Revised content', 'content is updated');
  assertEq(updatedContent.aiAssisted, false, 'aiAssisted unchanged when not passed');
  assertEq(updatedContent.evidenceLinkIds, [1, 2], 'evidenceLinkIds unchanged when not passed');

  console.log('\nTest U-02: updates aiAssisted independently');
  const updatedAi = updateReflection(PHONE, toUpdate.id, { aiAssisted: true });
  assertEq(updatedAi.aiAssisted, true, 'aiAssisted flips to true');
  assertEq(updatedAi.content, 'Revised content', 'content unaffected by an aiAssisted-only update');

  console.log('\nTest U-03: updates evidenceLinkIds independently, including clearing to empty');
  const updatedEvidence = updateReflection(PHONE, toUpdate.id, { evidenceLinkIds: [] });
  assertEq(updatedEvidence.evidenceLinkIds, [], 'evidenceLinkIds can be cleared to empty array');

  console.log('\nTest U-04: rejects clearing content to empty');
  assertThrows(
    () => updateReflection(PHONE, toUpdate.id, { content: '   ' }),
    'content cannot be empty',
    'throws when attempting to update content to whitespace-only'
  );

  console.log('\nTest U-05: returns null for another teacher\'s reflection (ownership scoping)');
  const wrongOwnerUpdate = updateReflection(OTHER_PHONE, toUpdate.id, { content: 'hijack attempt' });
  assertEq(wrongOwnerUpdate, null, 'cannot update another teacher\'s reflection');
  assertEq(getReflection(PHONE, toUpdate.id).content, 'Revised content', 'original content untouched by the failed cross-owner update');

  console.log('\nTest U-06: returns null for a nonexistent id');
  assertEq(updateReflection(PHONE, 999999, { content: 'x' }), null, 'nonexistent id returns null, not a throw');

  console.log('\nTest U-07: returns null when attempting to update a soft-deleted reflection');
  deleteReflection(PHONE, toUpdate.id);
  assertEq(updateReflection(PHONE, toUpdate.id, { content: 'resurrect?' }), null, 'cannot update a soft-deleted reflection');

  _db.exec(`DELETE FROM qms_reflections`);

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 7: deleteReflection() — soft delete semantics (ADR-011 §7)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Section 7: deleteReflection() ────────────────────────────────────');

  const toDelete = createReflection(PHONE, { content: 'Will be soft-deleted' });

  console.log('\nTest D-01: soft-deletes successfully');
  const deleteResult = deleteReflection(PHONE, toDelete.id);
  assertEq(deleteResult, true, 'deleteReflection returns true on success');

  console.log('\nTest D-02: row still exists in the table (never a hard DELETE)');
  const rawAfterDelete = _db.prepare(`SELECT * FROM qms_reflections WHERE id = ?`).get(toDelete.id);
  assert(rawAfterDelete !== undefined, 'the row is still physically present in qms_reflections');
  assert(rawAfterDelete.deleted_at !== null, 'deleted_at is set to a non-null timestamp');

  console.log('\nTest D-03: deleting an already-deleted reflection is a safe no-op');
  const doubleDelete = deleteReflection(PHONE, toDelete.id);
  assertEq(doubleDelete, false, 'a second delete call returns false, not an error');

  console.log('\nTest D-04: returns false for another teacher\'s reflection (ownership scoping)');
  const another = createReflection(PHONE, { content: 'Owned by PHONE, attacked by OTHER_PHONE' });
  const wrongOwnerDelete = deleteReflection(OTHER_PHONE, another.id);
  assertEq(wrongOwnerDelete, false, 'cannot delete another teacher\'s reflection');
  assert(getReflection(PHONE, another.id) !== null, 'the reflection survives the failed cross-owner delete attempt');

  console.log('\nTest D-05: returns false for a nonexistent id');
  assertEq(deleteReflection(PHONE, 999999), false, 'nonexistent id returns false, not a throw');

  _db.exec(`DELETE FROM qms_reflections`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`Migration 037 / reflectionService Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
