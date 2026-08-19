'use strict';
// RC1 recon harness — OBSERVATIONS (Phase A, five-row group): real-dispatch
// coverage audit.
//
// PURPOSE: tests/observation-smoke-test.js already gives strong, real-DB,
// real-flow, end-to-end coverage of all five Phase A Observations rows
// (Observation capture, MY OBSERVATIONS / detail view, ADD NOTE,
// CORRECT / DELETE / RESOLVE, Follow-up summary) — 45/45 assertions,
// currently green. What it does NOT prove is the production routing
// boundary: it calls handleObservationFlow()/handleObservationHistoryFlow()
// directly and hand-supplies preClassifiedIntent ({type:'observation'} /
// {type:'observationHistory'}), bypassing real intent classification
// entirely. Same class of gap the project has already found once
// (Defect B / RC1-H-013 — a classifier routing gap for reflection/
// growth_plan intents).
//
// This harness does NOT re-prove the business logic already covered by
// the smoke test. It exists solely to prove that realistic WhatsApp text,
// sent through the REAL core/messageProcessor.js::processMessage() router,
// reaches the real observation flows via real intent classification (or
// its real, already-existing deterministic fallback), with the same
// downstream behavior the smoke test already established.
//
// ── Classifier handling (read before changing this file) ───────────────
// deps.classifyIntent is a REAL Anthropic API call in production
// (services/intentClassifier.js). This harness does NOT stub it and does
// NOT hand-inject a fake intent. Instead it uses a real, already-existing
// production mechanism to force the real, already-existing deterministic
// fallback path: core/messageProcessor.js already falls back to
// deps.parseIntent(text) (utils/intentParser.js's regex parser, which has
// explicit patterns for both 'observation' and 'observationHistory')
// whenever deps.isClassifierRateLimited(from) is true. isClassifierRateLimited
// is DB-backed (rate_limit_events table, real migration) — this harness
// pre-inserts 20 real rows for each test phone's 'classifier' limiter
// before sending its trigger message, which legitimately and
// deterministically trips the REAL rate limiter already in production.
// This is not a mock: it exercises the real regex parser against real
// text, the same way a live rate-limited or AI-outage teacher's message
// would actually be classified in production.
//
// Only services/whatsappService (network I/O) is stubbed, same as every
// other RC1 dispatch harness (see rc1-classintervention-dispatch.test.js).
//
// Scope:
//   1. Observation capture — real text "Record an observation" through
//      real processMessage(), forced-fallback classification, real DB
//      persistence (matches smoke test Steps 1-4).
//   2. MY OBSERVATIONS — real text "MY OBSERVATIONS" through real
//      processMessage(), forced-fallback classification, detail view.
//   3. ADD NOTE — reply inside the active observationHistory session,
//      reached via processMessage()'s alreadyMidFlow path (intent=null,
//      exactly as production routes an in-session reply).
//   4. CORRECT — same alreadyMidFlow path, real persisted correction.
//   5. DELETE — same alreadyMidFlow path, real CONFIRM, real deletion.
//   6. RESOLVE — same alreadyMidFlow path, real persisted resolved flag.
//   7. Follow-up summary — asserted as part of the detail-view responses
//      above (it is not an independent entry point — confirmed in recon).
//
// Explicitly NOT in scope: onboarding-boundary behavior for observation
// commands (not tested here — flagged separately in recon, not claimed).
// Re-deriving business-logic assertions the smoke test already owns.
//
// This is diagnostic/verification only. No production code is touched.
// If a defect is found, it is reported and classified, not fixed.
//
// Run: node tests/rc1-observations-dispatch.test.js

process.env.PII_SECRET = 'test-secret-key-32-bytes-long!!';
process.env.FREE_LIMIT = '10';
process.env.APP_URL    = 'https://example.test';
process.env.PDF_SECRET = 'pdf-secret';
process.env.PRO_PRICE_ZAR = '99';

const Module = require('module');
const path = require('path');

let passed = 0;
let failed = 0;
const failures = [];
function check(condition, label, extra) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else {
    console.error(`  ❌ FAIL: ${label}${extra !== undefined ? ' -- ' + extra : ''}`);
    failed++;
    failures.push(label);
  }
}

const { createTestDb } = require('./helpers/createTestDb');
const testDb = createTestDb(__filename);
const db = testDb.db;

// ── Stub WhatsApp send only — capture text sends ────────────────────────
const sentMessages = [];
const whatsappPath = path.resolve(__dirname, '../services/whatsappService');
require.cache[whatsappPath] = {
  id: whatsappPath, filename: whatsappPath, loaded: true,
  exports: {
    sendMessage: async (phone, text) => { sentMessages.push({ phone, text }); return true; },
    sendDocument: async () => true,
    downloadMedia: async () => null,
    chunkMessage: (t) => [t],
  },
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === './whatsappService' || request === '../services/whatsappService') return whatsappPath;
  return origResolve.call(this, request, ...rest);
};

function insertTeacher(phoneHash, { grade = '6', subject = 'Mathematics' } = {}) {
  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject, is_pro) VALUES (?, ?, ?, ?, 1)`)
    .run(phoneHash, 'Test Teacher', grade, subject);
  db.prepare(`
    INSERT INTO onboarding (phone_hash, step, updated_at)
    VALUES (?, 'done', datetime('now'))
    ON CONFLICT(phone_hash) DO UPDATE SET step = 'done'
  `).run(phoneHash);
}

// Real mechanism, not a stub: pre-fill this phone's 'classifier'
// rate_limit_events so core/messageProcessor.js's own
// isClassifierRateLimited() check returns true, forcing the real
// deterministic parseIntent() fallback instead of an AI call.
function forceClassifierFallback(phoneHash) {
  const insert = db.prepare(`INSERT INTO rate_limit_events (phone_hash, limiter_type) VALUES (?, 'classifier')`);
  for (let i = 0; i < 20; i++) insert.run(phoneHash);
}

function makeMessage(from, body, id) { return { from, id, type: 'text', text: { body } }; }

(async () => {
  const {
    hashPhone,
    processMessage,
    buildProcessMessageDeps,
  } = require('../routes/webhook').__testExports;

  let msgCounter = 0;
  async function send(phone, body) {
    msgCounter += 1;
    await processMessage(makeMessage(phone, body, `msg-${msgCounter}`), buildProcessMessageDeps());
  }
  function messagesSince(idx) { return sentMessages.slice(idx); }
  function lastMessage() { return sentMessages[sentMessages.length - 1]?.text || ''; }

  console.log('\n── RC1 recon: OBSERVATIONS real-dispatch audit ──\n');

  const PHONE = '+27821299201';
  const phoneHash = hashPhone(PHONE);
  insertTeacher(phoneHash);
  forceClassifierFallback(phoneHash);

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 1 — Observation capture: real text -> real processMessage()
  // ═══════════════════════════════════════════════════════════════════
  console.log('── Scenario 1: Observation capture (real dispatch, forced-fallback classification) ──');
  {
    let idx = sentMessages.length;
    let threw = false, thrownErr = null;
    try { await send(PHONE, 'Record an observation'); }
    catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'D01: no crash on real dispatch for observation trigger text', thrownErr?.stack);
    check(lastMessage().includes('Record an Observation'), 'D02: real routing reached the observation flow (format-help prompt)');

    const block = [
      'Assessment: Term 3 Dispatch Verification',
      'Grade: R',
      'Subject: Life Skills',
      '',
      'Learner: Thandi',
      'Domain: Oral Language',
      'Status: Not Yet',
      'Notes: Needs support with sentence structure',
    ].join('\n');
    await send(PHONE, block);
    check(lastMessage().includes('Total so far') || lastMessage().includes('1 record so far'),
      'D03: observation text is parsed and accepted through real dispatch');

    await send(PHONE, 'DONE');
    check(lastMessage().includes('Observation saved successfully'), 'D04: DONE persists through real dispatch');

    const dbRows = db.prepare(`SELECT * FROM observation_assessments WHERE phone_hash = ?`).all(phoneHash);
    check(dbRows.length === 1, 'D05: exactly one assessment row landed in the real db via real dispatch');
  }

  const originalAssessment = db.prepare(`SELECT * FROM observation_assessments WHERE phone_hash = ?`).get(phoneHash);
  const originalAssessmentId = originalAssessment.id;

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 2 — MY OBSERVATIONS: real text -> real processMessage()
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 2: MY OBSERVATIONS (real dispatch, forced-fallback classification) ──');
  {
    let threw = false, thrownErr = null;
    try { await send(PHONE, 'MY OBSERVATIONS'); }
    catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'D06: no crash on real dispatch for MY OBSERVATIONS', thrownErr?.stack);
    check(lastMessage().includes('My Observations'), 'D07: real routing reached the observation-history flow');
    check(lastMessage().includes('Life Skills'), 'D08: the just-saved assessment appears via real dispatch');

    await send(PHONE, '1');
    check(lastMessage().includes('Thandi'), 'D09: numeric selection opens the real detail view');
    check(lastMessage().includes('Needs follow-up'), 'D10: Follow-up summary section renders from real observation data (Thandi is Not Yet)');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 3 — ADD NOTE: alreadyMidFlow path (intent=null, as production)
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 3: ADD NOTE (real dispatch, mid-session alreadyMidFlow path) ──');
  {
    let threw = false, thrownErr = null;
    try { await send(PHONE, 'ADD NOTE'); }
    catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'D11: no crash on real dispatch for ADD NOTE', thrownErr?.stack);
    check(lastMessage().includes('Which record'), 'D12: real routing reached the add-note record-selection step');

    await send(PHONE, '1');
    check(lastMessage().includes('What would you like to note'), 'D13: real dispatch prompts for note text');

    await send(PHONE, 'Verified via real dispatch harness.');
    check(lastMessage().includes('Note added'), 'D14: note save confirmed through real dispatch');

    const noteRow = db.prepare(
      `SELECT notes FROM observation_records WHERE assessment_id = ? AND learner_name = 'Thandi'`
    ).get(originalAssessmentId);
    check(!!noteRow && noteRow.notes.includes('Verified via real dispatch harness'), 'D15: note actually persisted in the real db via real dispatch');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 4 — CORRECT: alreadyMidFlow path, real persisted correction
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 4: CORRECT (real dispatch) ──');
  {
    // Session ended after ADD NOTE — re-enter via the list, same as
    // production requires (matches smoke test's own re-entry pattern).
    await send(PHONE, 'MY OBSERVATIONS');
    await send(PHONE, '1');
    check(lastMessage().includes('Thandi'), 'D16: reopened the real detail view via real dispatch');

    await send(PHONE, 'CORRECT');
    check(lastMessage().includes('Correcting this observation'), 'D17: real dispatch hands off into correction mode');

    const correctedBlock = [
      'Assessment: Term 3 Dispatch Verification',
      'Grade: R',
      'Subject: Life Skills',
      '',
      'Learner: Thandi',
      'Domain: Oral Language',
      'Status: Developing',
      'Notes: Reassessed via dispatch harness — improving.',
    ].join('\n');
    await send(PHONE, correctedBlock);
    await send(PHONE, 'DONE');
    check(lastMessage().includes('replaces the earlier version'), 'D18: correction save confirmed through real dispatch');

    const allAssessments = db.prepare(`SELECT * FROM observation_assessments WHERE phone_hash = ?`).all(phoneHash);
    check(allAssessments.length === 2, 'D19: original + correction both exist in the real db (insert-only)');
  }

  const correctionRow = db.prepare(
    `SELECT * FROM observation_assessments WHERE phone_hash = ? AND id != ?`
  ).get(phoneHash, originalAssessmentId);

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 5 — RESOLVE: alreadyMidFlow path, real persisted resolution
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 5: RESOLVE (real dispatch) ──');
  {
    await send(PHONE, 'MY OBSERVATIONS');
    await send(PHONE, '1');
    check(lastMessage().includes('Developing'), 'D20: opened the correction via real dispatch (shows reassessed status)');

    await send(PHONE, 'RESOLVE');
    check(lastMessage().includes('Which record'), 'D21: real dispatch prompts for record selection to resolve');

    await send(PHONE, '1');
    check(lastMessage().includes('Marked as resolved'), 'D22: resolve confirmed through real dispatch');

    const resolvedRow = db.prepare(
      `SELECT resolved FROM observation_records WHERE assessment_id = ? AND learner_name = 'Thandi'`
    ).get(correctionRow.id);
    check(!!resolvedRow && resolvedRow.resolved === 1, 'D23: resolved flag actually flipped in the real db via real dispatch');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 6 — DELETE: alreadyMidFlow path, real CONFIRM, real deletion
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Scenario 6: DELETE (real dispatch) ──');
  {
    await send(PHONE, 'MY OBSERVATIONS');
    await send(PHONE, '1');
    await send(PHONE, 'DELETE');
    check(lastMessage().includes("can't be undone"), 'D24: real dispatch asks for delete confirmation');

    await send(PHONE, 'CONFIRM');
    check(lastMessage().includes('Observation deleted'), 'D25: delete confirmed through real dispatch');

    const afterDelete = db.prepare(`SELECT * FROM observation_assessments WHERE id = ?`).get(correctionRow.id);
    check(afterDelete === undefined, 'D26: correction assessment actually gone from the real db via real dispatch');
  }

  // ── Summary ──────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`RC1 Observations Real-Dispatch Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(`  - ${f}`));
    testDb.cleanup();
    process.exit(1);
  }
  testDb.cleanup();
  process.exit(0);
})().catch(err => {
  console.error('Unexpected harness error:', err);
  process.exit(1);
});
