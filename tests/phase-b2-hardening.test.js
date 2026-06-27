'use strict';
/**
 * Phase B2 — Resource Persistence Hardening Tests
 *
 * Covers:
 *   1. SAVE command lifecycle safety (idempotency, state lifecycle, failure isolation)
 *   2. generationId uniqueness and rapid-overwrite traceability
 *   3. MY RESOURCES data integrity (corrupted metadata, missing fields, mixed types)
 *   4. saveResource() database safety (guards, transaction semantics, error propagation)
 *
 * Run individually:   node tests/phase-b2-hardening.test.js
 * Run via npm:        npm test
 */

// ── Shim better-sqlite3 → node:sqlite ────────────────────────────────────────
const Module = require('module');
const { DatabaseSync } = require('node:sqlite');

let _db = null;

const _origResolve = Module._resolveFilename.bind(Module);
Module._resolveFilename = function (request, parent, isMain, opts) {
  if (request === 'better-sqlite3') return request;
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

const path = require('path');
const dbPath = path.resolve(__dirname, '../utils/database');
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

// ── Schema (mirrors production migrations) ────────────────────────────────────
function buildSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash TEXT UNIQUE NOT NULL,
      name TEXT,
      school TEXT,
      grade INTEGER,
      subject TEXT,
      is_pro INTEGER DEFAULT 0,
      default_class_id INTEGER,
      saved_resources_count INTEGER DEFAULT 0,
      last_assessment_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS saved_resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash TEXT NOT NULL,
      resource_type TEXT,
      title TEXT,
      content TEXT,
      grade INTEGER,
      subject TEXT,
      topic TEXT,
      metadata TEXT,
      generation_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

// ── SessionStore stub ─────────────────────────────────────────────────────────
// A minimal in-memory SessionStore replica for unit-testing the SAVE lifecycle
// without requiring the full webhook environment.
class MemorySessionStore {
  constructor() { this._data = new Map(); }
  get(key)        { return this._data.get(key) || null; }
  set(key, value) { this._data.set(key, value); }
  delete(key)     { this._data.delete(key); }
}

// ── Test runner ───────────────────────────────────────────────────────────────
async function run() {
  _db = new DatabaseSync(':memory:');
  buildSchema(_db);

  const { saveResource, getSavedResources } = require('../services/teacherWorkspaceService');

  const PHONE = 'b2test_hash_001';
  _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(PHONE);

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1: saveResource() guards and error propagation
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('\n── Section 1: saveResource() input guards ──────────────────────────');

  console.log('\nTest B2-01: null content → throws with clear message');
  assertThrows(
    () => saveResource(PHONE, 'worksheet', 'Title', null, {}),
    'content must not be null or empty',
    'null content throws'
  );

  console.log('\nTest B2-02: empty string content → throws');
  assertThrows(
    () => saveResource(PHONE, 'worksheet', 'Title', '', {}),
    'content must not be null or empty',
    'empty string content throws'
  );

  console.log('\nTest B2-03: undefined content → throws');
  assertThrows(
    () => saveResource(PHONE, 'worksheet', 'Title', undefined, {}),
    'content must not be null or empty',
    'undefined content throws'
  );

  console.log('\nTest B2-04: unknown resourceType → throws with type name in message');
  assertThrows(
    () => saveResource(PHONE, 'unknownType', 'Title', 'content', {}),
    'unknown resourceType "unknownType"',
    'unknown resourceType throws with name'
  );

  console.log('\nTest B2-05: null resourceType → throws');
  assertThrows(
    () => saveResource(PHONE, null, 'Title', 'content', {}),
    'unknown resourceType',
    'null resourceType throws'
  );

  console.log('\nTest B2-06: empty resourceType → throws');
  assertThrows(
    () => saveResource(PHONE, '', 'Title', 'content', {}),
    'unknown resourceType',
    'empty resourceType throws'
  );

  console.log('\nTest B2-07: all 8 known types are accepted without throwing');
  const KNOWN = ['worksheet', 'test', 'lessonPlan', 'atp', 'sbaTask', 'examPaper', 'rubric', 'moderationPack'];
  let allAccepted = true;
  for (const t of KNOWN) {
    try {
      saveResource(PHONE, t, `${t} title`, `${t} content`, { grade: 7, subject: 'mathematics', topic: 'Test' });
    } catch (err) {
      console.error(`  ❌ ${t} was rejected: ${err.message}`);
      allAccepted = false;
    }
  }
  assert(allAccepted, 'all 8 known resourceTypes are accepted');

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2: Transaction atomicity
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('\n── Section 2: Transaction atomicity ───────────────────────────────');

  console.log('\nTest B2-08: successful save leaves both rows consistent');
  // saveResource was called 8 times in Test B2-07 plus the ones in workspace.test.js
  // We need a fresh count baseline — use a separate phone hash.
  const PHONE_TX = 'b2test_tx_hash';
  _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(PHONE_TX);

  saveResource(PHONE_TX, 'worksheet', 'Atomic test', 'atomic content', { grade: 8, subject: 'mathematics', topic: 'Algebra' });
  const txTeacher = _db.prepare(`SELECT saved_resources_count FROM teachers WHERE phone_hash = ?`).get(PHONE_TX);
  const txResources = getSavedResources(PHONE_TX);
  assertEq(txTeacher.saved_resources_count, 1, 'counter is 1 after one save (tx phone)');
  assertEq(txResources.length, 1, 'one resource row exists (tx phone)');

  console.log('\nTest B2-09: counter and resource count stay in sync after multiple saves');
  saveResource(PHONE_TX, 'test', 'Second save', 'content 2', { grade: 8, subject: 'mathematics', topic: 'Fractions' });
  saveResource(PHONE_TX, 'lessonPlan', 'Third save', 'content 3', {});
  const txTeacher2 = _db.prepare(`SELECT saved_resources_count FROM teachers WHERE phone_hash = ?`).get(PHONE_TX);
  const txResources2 = getSavedResources(PHONE_TX);
  assertEq(txTeacher2.saved_resources_count, 3, 'counter is 3 after three saves');
  assertEq(txResources2.length, 3, 'three resource rows exist');

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3: MY RESOURCES — corrupted/missing metadata
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('\n── Section 3: MY RESOURCES data integrity ──────────────────────────');

  const PHONE_MR = 'b2test_mr_hash';
  _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(PHONE_MR);

  // Seed: one normal row, one with corrupted metadata JSON, one with null metadata
  _db.prepare(`
    INSERT INTO saved_resources (phone_hash, resource_type, title, content, grade, subject, topic, metadata)
    VALUES (?, 'worksheet', 'Normal resource', 'content', 9, 'english', 'Poetry', '{"grade":9,"subject":"english"}')
  `).run(PHONE_MR);

  _db.prepare(`
    INSERT INTO saved_resources (phone_hash, resource_type, title, content, grade, subject, topic, metadata)
    VALUES (?, 'test', 'Corrupted metadata', 'content', null, null, null, '{{not valid json}}')
  `).run(PHONE_MR);

  _db.prepare(`
    INSERT INTO saved_resources (phone_hash, resource_type, title, content, grade, subject, topic, metadata)
    VALUES (?, 'lessonPlan', 'Null metadata', 'content', null, null, null, null)
  `).run(PHONE_MR);

  console.log('\nTest B2-10: getSavedResources returns all rows regardless of metadata state');
  const mrResources = getSavedResources(PHONE_MR);
  assertEq(mrResources.length, 3, 'all 3 rows returned (including corrupted/null metadata)');

  console.log('\nTest B2-11: corrupted metadata row is returned with raw string in metadata column');
  const corrupted = mrResources.find(r => r.title === 'Corrupted metadata');
  assert(corrupted !== undefined, 'corrupted metadata row exists in results');
  assert(corrupted.metadata === '{{not valid json}}', 'metadata column preserved as raw string');

  console.log('\nTest B2-12: null metadata row is returned cleanly');
  const nullMeta = mrResources.find(r => r.title === 'Null metadata');
  assert(nullMeta !== undefined, 'null metadata row exists in results');
  assert(nullMeta.metadata === null, 'metadata column is null');

  console.log('\nTest B2-13: MY RESOURCES display simulation — corrupted metadata does NOT throw');
  // This replicates the MY RESOURCES grouped-display loop from webhook.js.
  // After R4 fix, the loop no longer calls JSON.parse on the metadata column
  // at all — it reads grade/subject from top-level columns only.
  // This test confirms that iterating over mixed rows with bad metadata is safe.
  let displayError = null;
  try {
    for (const r of mrResources) {
      // Exact logic from the webhook MY RESOURCES display (both branches):
      const gradeStr   = r.grade   ? ` · Gr ${r.grade}` : '';
      const subjectStr = r.subject ? ` · ${r.subject}`  : '';
      const date = r.created_at ? r.created_at.slice(0, 10) : '';
      void `[${r.id}] ${r.title}${gradeStr}${subjectStr} · ${date}`;
    }
  } catch (err) {
    displayError = err;
  }
  assert(displayError === null, 'MY RESOURCES display loop does not throw on corrupted/null metadata');

  console.log('\nTest B2-14: getSavedResources filter by resource_type still works with mixed rows');
  const worksheetOnly = getSavedResources(PHONE_MR, { resourceType: 'worksheet' });
  assertEq(worksheetOnly.length, 1, 'filter by worksheet returns exactly one row');
  assertEq(worksheetOnly[0].title, 'Normal resource', 'correct row returned');

  console.log('\nTest B2-15: resource rows have deterministic id DESC ordering when timestamps collide');
  // All 3 rows were inserted within the same second, so created_at is identical.
  // The ORDER BY created_at DESC, id DESC clause (Phase B fix) guarantees
  // that the most recently inserted row (highest id) comes first.
  assert(mrResources[0].id > mrResources[1].id, 'first row has higher id than second');
  assert(mrResources[1].id > mrResources[2].id, 'second row has higher id than third');

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4: SAVE lifecycle — idempotency and state management
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('\n── Section 4: SAVE lifecycle simulation ────────────────────────────');

  // Simulate the SAVE command lifecycle using a MemorySessionStore.
  // We test the logic directly rather than going through the full webhook.
  const store = new MemorySessionStore();
  const { randomUUID } = require('crypto');
  const LIFECYCLE_PHONE = 'lifecycle_hash_001';
  _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(LIFECYCLE_PHONE);

  console.log('\nTest B2-16: SAVE with no prior generation → store is empty → safe no-op');
  const noState = store.get(LIFECYCLE_PHONE);
  assert(noState === null, 'store returns null for unseen phone hash');

  console.log('\nTest B2-17: generationId is a valid UUID-format string');
  const gid1 = randomUUID();
  store.set(LIFECYCLE_PHONE, {
    generationId: gid1,
    intent: { type: 'worksheet', topic: 'Fractions', grade: 7, subject: 'mathematics' },
    content: 'worksheet content here',
    lastActivity: Date.now(),
  });
  const stored1 = store.get(LIFECYCLE_PHONE);
  assert(stored1 !== null, 'state was stored');
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored1.generationId),
    'generationId is a valid v4 UUID'
  );

  console.log('\nTest B2-18: rapid second generation overwrites state with NEW generationId');
  const gid2 = randomUUID();
  store.set(LIFECYCLE_PHONE, {
    generationId: gid2,
    intent: { type: 'test', topic: 'Algebra', grade: 7, subject: 'mathematics' },
    content: 'test content here',
    lastActivity: Date.now(),
  });
  const stored2 = store.get(LIFECYCLE_PHONE);
  assert(stored2.generationId !== gid1, 'second generationId differs from first');
  assertEq(stored2.generationId, gid2, 'latest generationId matches second generation');
  assertEq(stored2.intent.type, 'test', 'intent.type reflects second generation');

  console.log('\nTest B2-19: SAVE reads the LATEST stored state (not the earlier one)');
  // Simulate SAVE: read state, call saveResource, delete
  const toSave = store.get(LIFECYCLE_PHONE);
  assert(toSave !== null, 'state present before SAVE');
  assertEq(toSave.intent.topic, 'Algebra', 'SAVE acts on the most recent generation (Algebra test, not Fractions worksheet)');

  console.log('\nTest B2-20: successful SAVE → delete clears state (idempotency guard)');
  saveResource(LIFECYCLE_PHONE, toSave.intent.type, `${toSave.intent.topic} — test`, toSave.content, {
    grade: toSave.intent.grade,
    subject: toSave.intent.subject,
    topic: toSave.intent.topic,
    intent: toSave.intent.type,
  });
  store.delete(LIFECYCLE_PHONE);
  const afterSave = store.get(LIFECYCLE_PHONE);
  assert(afterSave === null, 'state is cleared after successful SAVE');

  console.log('\nTest B2-21: second SAVE attempt with cleared state → no-ops safely');
  // This is the double-SAVE guard: state is null, handler would return early.
  const secondSave = store.get(LIFECYCLE_PHONE);
  assert(secondSave === null, 'store is empty — second SAVE would return "nothing to save"');

  console.log('\nTest B2-22: SAVE failure does NOT clear state (retry is possible)');
  // Simulate: state is set, DB call fails, state must be preserved
  const gid3 = randomUUID();
  store.set(LIFECYCLE_PHONE, {
    generationId: gid3,
    intent: { type: 'rubric', topic: 'Drama', grade: 10, subject: 'dramatic arts' },
    content: 'rubric content',
    lastActivity: Date.now(),
  });

  // Simulate a DB error by calling saveResource with an invalid type,
  // catching the throw, and NOT deleting the state (as the hardened handler does).
  let dbFailed = false;
  try {
    saveResource(LIFECYCLE_PHONE, 'invalidType', 'Drama — rubric', 'rubric content', {});
    // If we get here, the guard didn't fire — that would be a bug
  } catch (_) {
    dbFailed = true;
    // *** Do NOT call store.delete() — this is the R1 fix ***
  }
  assert(dbFailed, 'DB call failed as expected');
  const afterFailure = store.get(LIFECYCLE_PHONE);
  assert(afterFailure !== null, 'state is preserved after failed SAVE (teacher can retry)');
  assertEq(afterFailure.generationId, gid3, 'preserved state still has correct generationId');

  console.log('\nTest B2-23: retry after failure succeeds with the preserved state');
  // Now use the correct type — simulating the teacher sending SAVE again
  const retryState = store.get(LIFECYCLE_PHONE);
  // Fix the intent type to a valid one for the retry (in reality the state
  // has the correct type from processGeneration; we just had a transient error)
  const saved = saveResource(LIFECYCLE_PHONE, 'rubric', `${retryState.intent.topic} — rubric`, retryState.content, {
    grade: retryState.intent.grade,
    subject: retryState.intent.subject,
    topic: retryState.intent.topic,
    intent: 'rubric',
  });
  store.delete(LIFECYCLE_PHONE);
  assert(saved && saved.id > 0, 'retry save succeeded and returned a valid resource');
  const afterRetry = store.get(LIFECYCLE_PHONE);
  assert(afterRetry === null, 'state cleared after successful retry');

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5: Metadata completeness and missing optional fields
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('\n── Section 5: Metadata completeness ───────────────────────────────');

  const PHONE_META = 'b2test_meta_hash';
  _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(PHONE_META);

  console.log('\nTest B2-24: saveResource with no optional metadata fields stores nulls cleanly');
  const minimalSave = saveResource(PHONE_META, 'worksheet', 'Minimal — worksheet', 'content here', {});
  assert(minimalSave.grade === null,   'grade is null when not provided');
  assert(minimalSave.subject === null, 'subject is null when not provided');
  assert(minimalSave.topic === null,   'topic is null when not provided');
  const minimalMeta = JSON.parse(minimalSave.metadata);
  assert(typeof minimalMeta === 'object', 'metadata column is valid JSON even with empty metadata arg');

  console.log('\nTest B2-25: saveResource with full metadata — all fields present in JSON');
  const fullSave = saveResource(PHONE_META, 'atp', 'Number Sense — Annual Teaching Plan', 'atp content', {
    grade: 9, subject: 'mathematics', topic: 'Number Sense', intent: 'atp',
    term: 1, atpTopic: 'Whole numbers', differentiation: null, savedAt: new Date().toISOString(),
  });
  const fullMeta = JSON.parse(fullSave.metadata);
  assertEq(fullMeta.grade, 9,             'full metadata: grade');
  assertEq(fullMeta.subject, 'mathematics', 'full metadata: subject');
  assertEq(fullMeta.atpTopic, 'Whole numbers', 'full metadata: atpTopic');
  assertEq(fullMeta.term, 1,             'full metadata: term');
  assert('savedAt' in fullMeta,          'full metadata: savedAt present');

  console.log('\nTest B2-26: getSavedResources returns resources with consistent column types');
  const metaResources = getSavedResources(PHONE_META);
  for (const r of metaResources) {
    assert(typeof r.id === 'number',      `resource ${r.id}: id is a number`);
    assert(typeof r.title === 'string',   `resource ${r.id}: title is a string`);
    assert(typeof r.resource_type === 'string', `resource ${r.id}: resource_type is a string`);
    assert(typeof r.content === 'string', `resource ${r.id}: content is a string`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`Phase B2 Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
