'use strict';
/**
 * Observation feature — END-TO-END SMOKE TEST
 *
 * Unlike the other three observation test files, this one does not mock
 * anything at the flow/repository boundary and does not hand-build
 * assessment objects. It drives the REAL flows/observationFlow.js exactly
 * the way routes/webhook.js does (buildObservationDeps()-equivalent, real
 * intent objects, real multi-turn SessionStore-backed state), against:
 *
 *   - the REAL parser (utils/observationParser.js)
 *   - the REAL workflow orchestrator (utils/observationWorkflowService.js)
 *   - the REAL analysis service (services/observationAnalysisService.js)
 *   - the REAL repository (services/observationRepository.js)
 *   - the REAL persistent session store (utils/sessionStore.js)
 *   - a REAL in-memory SQLite db (node:sqlite shim)
 *
 * This is the thing none of the other three suites can catch: a
 * boundary-shape mismatch between two real modules (e.g. flow passes a
 * field name the repository doesn't expect) that a fake repository or a
 * hand-built assessment object would never surface, because both sides
 * of a fake agree with each other by construction.
 *
 * It plays out one continuous teacher session:
 *   1. Record an observation across TWO messages (incremental entry)
 *   2. DONE — save
 *   3. MY OBSERVATIONS — view history, open the detail view
 *   4. ADD NOTE on one record
 *   5. CORRECT the whole assessment — send a corrected version, DONE
 *   6. View history again — confirm the original is hidden, correction shown
 *   7. RESOLVE one record in the correction
 *   8. DELETE the correction, with CONFIRM
 *   9. View history again — confirm it's gone
 *
 * Run: node tests/observation-smoke-test.js
 */

// ── Shim better-sqlite3 → node:sqlite (same convention as phase-6 /
//    observationRepository-corrections-delete-resolve) ─────────────────────
const Module = require('module');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const crypto = require('crypto');

let _db = null;
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

// ── Helpers ──────────────────────────────────────────────────────────────
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

// ── Schema ───────────────────────────────────────────────────────────────
function buildSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY,
      phone_hash TEXT NOT NULL,
      name TEXT,
      grade INTEGER,
      subject TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (phone_hash) REFERENCES teachers(phone_hash)
    );
    CREATE TABLE IF NOT EXISTS learners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash TEXT NOT NULL,
      class_id INTEGER,
      canonical_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (phone_hash) REFERENCES teachers(phone_hash),
      FOREIGN KEY (class_id) REFERENCES classes(id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_learners_identity_classed
      ON learners(phone_hash, class_id, normalized_name) WHERE class_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_learners_identity_unclassed
      ON learners(phone_hash, normalized_name) WHERE class_id IS NULL;

    CREATE TABLE IF NOT EXISTS observation_assessments (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash                TEXT    NOT NULL,
      grade                     TEXT,
      subject                   TEXT,
      assessment_name           TEXT,
      class_id                  INTEGER,
      corrects_assessment_id    INTEGER REFERENCES observation_assessments(id),
      created_at                TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (phone_hash) REFERENCES teachers(phone_hash),
      FOREIGN KEY (class_id) REFERENCES classes(id)
    );

    CREATE TABLE IF NOT EXISTS observation_records (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      assessment_id         INTEGER NOT NULL,
      learner_name          TEXT    NOT NULL,
      domain                TEXT    NOT NULL,
      developmental_status  TEXT    NOT NULL,
      notes                 TEXT,
      learner_id            INTEGER,
      resolved              INTEGER NOT NULL DEFAULT 0,
      created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (assessment_id) REFERENCES observation_assessments(id)
    );

    CREATE INDEX IF NOT EXISTS idx_observation_assessments_phone
      ON observation_assessments(phone_hash);
    CREATE INDEX IF NOT EXISTS idx_observation_assessments_corrects
      ON observation_assessments(corrects_assessment_id);
    CREATE INDEX IF NOT EXISTS idx_observation_records_assessment
      ON observation_records(assessment_id);

    -- Required by utils/sessionStore.js (real module, used unmocked here)
    CREATE TABLE IF NOT EXISTS sessions (
      phone_hash    TEXT    NOT NULL,
      session_type  TEXT    NOT NULL,
      state         TEXT    NOT NULL,
      updated_at    REAL    NOT NULL,
      PRIMARY KEY (phone_hash, session_type)
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at);
  `);
}

async function run() {
  _db = new DatabaseSync(':memory:');
  buildSchema(_db);

  // ── Real modules, wired the same way routes/webhook.js does ────────────
  const { handleObservationFlow, handleObservationHistoryFlow } = require('../flows/observationFlow');
  const { processObservationSubmission } = require('../utils/observationWorkflowService');
  const { getObservationFormatHelpText } = require('../utils/observationParser');
  const { analyzeObservations } = require('../services/observationAnalysisService');
  const { getTeacherClasses } = require('../services/teacherWorkspaceService');
  const { formatClassSelectionPrompt, matchClassSelection } = require('../utils/classContext');
  const { SessionStore } = require('../utils/sessionStore');
  const {
    saveObservationSubmission,
    getObservationHistory,
    getObservationAssessment,
    appendObservationNote,
    deleteObservationAssessment,
    resolveObservationRecord,
  } = require('../services/observationRepository');

  const observationState        = new SessionStore('smoke_observation', 30 * 60 * 1000);
  const observationHistoryState = new SessionStore('smoke_observationHistory', 15 * 60 * 1000);

  const PHONE = '+27821234567';
  function hashPhone(phone) {
    return crypto.createHash('sha256').update(phone).digest('hex');
  }
  const phoneHash = hashPhone(PHONE);
  _db.prepare(`INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)`).run(phoneHash);

  function gradeLabel(grade) {
    return grade === 0 || grade === '0' ? 'Grade R' : `Grade ${grade}`;
  }

  const sentMessages = [];
  async function safeSendMessage(to, text) {
    sentMessages.push({ to, text });
  }
  function lastMessage() {
    return sentMessages[sentMessages.length - 1]?.text || '';
  }

  const deps = {
    observationState,
    observationHistoryState,
    safeSendMessage,
    parseIntent: () => ({ type: 'unknown' }), // preClassifiedIntent is always passed explicitly below, mirroring webhook.js
    gradeLabel,
    hashPhone,
    processObservationSubmission,
    getObservationFormatHelpText,
    saveObservationSubmission,
    getObservationHistory,
    getObservationAssessment,
    analyzeObservations,
    appendObservationNote,
    deleteObservationAssessment,
    resolveObservationRecord,
    getTeacherClasses,
    formatClassSelectionPrompt,
    matchClassSelection,
  };

  async function send(text, intentType) {
    const intent = intentType ? { type: intentType } : null;
    const handled =
      (await handleObservationFlow(PHONE, text, intent, deps)) ||
      (await handleObservationHistoryFlow(PHONE, text, intent, deps));
    return handled;
  }

  console.log('\n── Step 1: start an observation (zero classes → unclassed, no class prompt) ──');
  let handled = await send('Grade 0 Life Skills observation', 'observation');
  assert(handled === true, 'S01: observation intent is handled');
  assert(lastMessage().includes('Record an Observation'), 'S02: prompts for observation format');

  console.log('\n── Step 2: send first block of learners (incremental entry, message 1 of 2) ──');
  const block1 = [
    'Assessment: Term 2 Play Observation',
    'Grade: R',
    'Subject: Life Skills',
    '',
    'Learner: Sipho',
    'Domain: Oral Language',
    'Status: Not Yet',
    'Notes: Struggles to answer in full sentences',
  ].join('\n');
  handled = await send(block1);
  assert(handled === true, 'S03: first block is parsed and accepted');
  assert(lastMessage().includes('1 record so far'), 'S04: confirms 1 record collected, still open for more');

  console.log('\n── Step 3: send second block (message 2 of 2, same session) ──');
  const block2 = [
    'Learner: Ayanda',
    'Domain: Fine Motor',
    'Status: Achieved',
  ].join('\n');
  handled = await send(block2);
  assert(handled === true, 'S05: second block merges into the same in-progress observation');
  assert(lastMessage().includes('Total so far: 2'), 'S06: total record count reflects both messages combined');

  console.log('\n── Step 4: DONE — persists via the REAL saveObservationSubmission() ──');
  handled = await send('DONE');
  assert(handled === true, 'S07: DONE is handled');
  assert(lastMessage().includes('Observation saved successfully'), 'S08: save confirmation sent');
  assert(lastMessage().includes('2 records for 2 learners'), 'S09: confirmation reflects correct counts');

  const dbAssessments = _db.prepare(`SELECT * FROM observation_assessments WHERE phone_hash = ?`).all(phoneHash);
  assert(dbAssessments.length === 1, 'S10: exactly one assessment row actually landed in the real db');
  const originalAssessmentId = dbAssessments[0].id;
  const dbRecords = _db.prepare(`SELECT * FROM observation_records WHERE assessment_id = ?`).all(originalAssessmentId);
  assert(dbRecords.length === 2, 'S11: both records actually landed in the real db');

  console.log('\n── Step 5: MY OBSERVATIONS — real history query, real formatting ──');
  handled = await send('MY OBSERVATIONS', 'observationHistory');
  assert(handled === true, 'S12: observationHistory intent handled');
  assert(lastMessage().includes('My Observations'), 'S13: history list header shown');
  assert(lastMessage().includes('Life Skills'), 'S14: the saved assessment appears in the list');

  console.log('\n── Step 6: open detail view (number "1") ──');
  handled = await send('1');
  assert(handled === true, 'S15: numeric selection opens detail view');
  assert(lastMessage().includes('Sipho'), 'S16: detail view shows the Not Yet learner');
  assert(lastMessage().includes('Needs follow-up'), 'S17: follow-up section present (Sipho is Not Yet)');
  assert(!lastMessage().split('Needs follow-up:')[1].split('*Records:*')[0].includes('Ayanda'),
    'S18: Ayanda (Achieved) is correctly excluded from the follow-up section');

  console.log('\n── Step 7: ADD NOTE on record #1 (Sipho) ──');
  handled = await send('ADD NOTE');
  assert(handled === true && lastMessage().includes('Which record'), 'S19: prompts for record selection');
  handled = await send('1');
  assert(handled === true && lastMessage().includes('What would you like to note'), 'S20: prompts for note text');
  handled = await send('Follow-up scheduled with parent for next week.');
  assert(handled === true && lastMessage().includes('Note added'), 'S21: note saved');

  const noteRow = _db.prepare(`SELECT notes FROM observation_records WHERE assessment_id = ? AND learner_name = 'Sipho'`).get(originalAssessmentId);
  assert(noteRow.notes.includes('Follow-up scheduled with parent'), 'S22: note actually persisted in the real db');

  console.log('\n── Step 8: CORRECT the whole assessment ──');
  handled = await send('MY OBSERVATIONS', 'observationHistory'); // session ended after ADD NOTE — re-enter via the list
  handled = await send('1');
  assert(lastMessage().includes('Sipho'), 'S23: reopened the same detail view');
  handled = await send('CORRECT');
  assert(handled === true && lastMessage().includes('Correcting this observation'), 'S24: hands off into correction mode');

  const correctedBlock = [
    'Assessment: Term 2 Play Observation',
    'Grade: R',
    'Subject: Life Skills',
    '',
    'Learner: Sipho',
    'Domain: Oral Language',
    'Status: Developing',
    'Notes: Reassessed after extra support — improving.',
    '',
    'Learner: Ayanda',
    'Domain: Fine Motor',
    'Status: Achieved',
  ].join('\n');
  handled = await send(correctedBlock);
  assert(handled === true, 'S25: corrected block parsed and accepted');
  handled = await send('DONE');
  assert(handled === true, 'S26: DONE saves the correction');
  assert(lastMessage().includes('replaces the earlier version'), 'S27: confirms this was saved as a correction');

  const allAssessments = _db.prepare(`SELECT * FROM observation_assessments WHERE phone_hash = ?`).all(phoneHash);
  assert(allAssessments.length === 2, 'S28: original + correction both exist in the real db (insert-only, nothing overwritten)');
  const correctionRow = allAssessments.find(a => a.id !== originalAssessmentId);
  assert(correctionRow.corrects_assessment_id === originalAssessmentId, 'S29: correction row really points back at the original in the real db');

  console.log('\n── Step 9: MY OBSERVATIONS again — original must be hidden, correction shown ──');
  handled = await send('MY OBSERVATIONS', 'observationHistory');
  const historyMsg = lastMessage();
  const historyCount = (historyMsg.match(/Life Skills/g) || []).length;
  assert(historyCount === 1, 'S30: only ONE Life Skills entry shown (superseded original hidden, real query)');

  console.log('\n── Step 10: RESOLVE a record on the correction ──');
  handled = await send('1');
  assert(lastMessage().includes('Developing'), 'S31: opened the correction (shows the reassessed status)');
  handled = await send('RESOLVE');
  assert(handled === true && lastMessage().includes('Which record'), 'S32: prompts for record selection');
  handled = await send('1');
  assert(handled === true && lastMessage().includes('Marked as resolved'), 'S33: resolve confirmed');

  const resolvedRow = _db.prepare(`SELECT resolved FROM observation_records WHERE assessment_id = ? AND learner_name = 'Sipho'`).get(correctionRow.id);
  assert(resolvedRow.resolved === 1, 'S34: resolved flag actually flipped in the real db');

  console.log('\n── Step 11: re-open detail — resolved record must drop out of follow-up ──');
  handled = await send('MY OBSERVATIONS', 'observationHistory');
  handled = await send('1');
  const detailAfterResolve = lastMessage();
  assert(detailAfterResolve.includes('No follow-up needed') || !detailAfterResolve.split('Needs follow-up:')[1],
    'S35: resolved Sipho record no longer appears under Needs follow-up');
  assert(detailAfterResolve.includes('resolved'), 'S36: the Records list still shows Sipho, tagged resolved (not hidden entirely)');

  console.log('\n── Step 12: DELETE the correction, with CONFIRM ──');
  handled = await send('DELETE');
  assert(handled === true && lastMessage().includes("can't be undone"), 'S37: asks for confirmation before deleting');
  handled = await send('CONFIRM');
  assert(handled === true && lastMessage().includes('Observation deleted'), 'S38: delete confirmed');

  const afterDelete = _db.prepare(`SELECT * FROM observation_assessments WHERE id = ?`).get(correctionRow.id);
  assert(afterDelete === undefined, 'S39: correction assessment actually gone from the real db');
  const afterDeleteRecords = _db.prepare(`SELECT * FROM observation_records WHERE assessment_id = ?`).all(correctionRow.id);
  assert(afterDeleteRecords.length === 0, 'S40: its records are gone too');

  console.log('\n── Step 13: MY OBSERVATIONS one more time — the ORIGINAL legitimately reappears ──');
  // This is correct, not a bug: deleting the correction clears its
  // corrects_assessment_id link back to the original (see OR-11 in
  // observationRepository-corrections-delete-resolve.test.js), so the
  // original is no longer "superseded" and reappears in history — it was
  // never deleted, only hidden while a correction existed.
  handled = await send('MY OBSERVATIONS', 'observationHistory');
  const finalHistory = lastMessage();
  assert(finalHistory.includes('Life Skills'), "S41: the original observation reappears once its correction is gone (un-superseded, not deleted)");
  handled = await send('1');
  const reopenedOriginal = lastMessage();
  assert(reopenedOriginal.includes('Sipho — Oral Language: Not Yet'), 'S42: reopened assessment shows its OWN original status (Not Yet) — the correction\'s "Developing" never touched this row');
  assert(reopenedOriginal.includes('Follow-up scheduled with parent for next week'), 'S43: the note added back in Step 7 is still attached to the original — untouched by the correction/delete cycle');
  assert(!reopenedOriginal.includes('This is a correction'), 'S44: no longer shows a stale correction banner');
  assert(!reopenedOriginal.includes('has since been corrected'), 'S45: no longer shows a stale superseded banner');

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`Observation Smoke Test Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFull transcript (for debugging a failure):');
    sentMessages.forEach((m, i) => console.log(`\n[${i + 1}] →\n${m.text}`));
    process.exit(1);
  }
  // utils/sessionStore.js (real, unmocked module) registers a setInterval
  // for its hourly prune sweep — without an explicit exit here the process
  // would otherwise hang open after a successful run.
  process.exit(0);
}

run().catch(err => {
  console.error('Unexpected smoke test error:', err);
  process.exit(1);
});
