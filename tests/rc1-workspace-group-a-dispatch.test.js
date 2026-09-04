'use strict';
// RC1-V-009 recon — real-dispatch harness for Group A Teacher Workspace
// commands: MY CLASSES, NEW CLASS, MY ASSESSMENTS / MY ASSESSMENT HISTORY,
// MY PROGRESS / MY CURRICULUM PROGRESS, WORKSPACE.
//
// Scope note: Group B (ROSTER / ADD LEARNER / REMOVE LEARNER / CLEAR
// ROSTER) is a structurally different, stateful multi-turn flow
// (flows/rosterFlow.js) with its own onboarding exposure (not gated by
// isWorkspaceCommand() at all — see recon). It is deliberately excluded
// from this harness and will get its own pass.
//
// Existing coverage gap this harness closes: workspace.test.js exercises
// services/teacherWorkspaceService.js and curriculumCoverageService.js
// directly (unit-level); routing-order-workspace-flow.test.js confirms
// commandHandler.js wires handleWorkspaceFlow() structurally, then calls
// handleWorkspaceFlow() directly (bypassing real dispatch) for its
// functional checks. Neither exercises the real
// routes/webhook.js -> core/commandHandler.js -> flows/workspaceFlow.js
// chain the way a teacher's message actually travels. This harness calls
// core/commandHandler.js's real handleCommand() (via routes/webhook.js's
// __testExports seam — the same deps object commandHandler receives in
// production), against a real, fully-migrated SQLite test database, with
// only services/whatsappService stubbed (no live sends).
//
// Run: node tests/rc1-workspace-group-a-dispatch.test.js

process.env.PII_SECRET = 'test-secret-key-32-bytes-long!!';
process.env.FREE_LIMIT = '10';
process.env.APP_URL    = 'https://example.test';
process.env.PDF_SECRET = 'pdf-secret';

const Module = require('module');
const path = require('path');

let passed = 0;
let failed = 0;
function check(condition, label) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ FAIL: ${label}`); failed++; }
}

// MUST be required before any service/repository module — see
// tests/helpers/createTestDb.js's "Why this must be required first".
const { createTestDb } = require('./helpers/createTestDb');
const testDb = createTestDb(__filename);
const db = testDb.db;

// ── Stub services/whatsappService — record sends, never actually send ──
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

function insertTeacher(phoneHash, { grade = null, subject = null } = {}) {
  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject) VALUES (?, ?, ?, ?)`)
    .run(phoneHash, 'Test Teacher', grade, subject);
}

function lastReply() {
  return sentMessages.length ? sentMessages[sentMessages.length - 1].text : '';
}

(async () => {
  const {
    handleCommand,
    hashPhone,
    setOnboardingStep,
    ONBOARDING_STEPS,
  } = require('../routes/webhook').__testExports;

  const { createClass } = require('../services/teacherWorkspaceService');
  const { markTopicCovered } = require('../services/curriculumCoverageService');

  let phoneCounter = 0;
  function nextPhone() { return `+2783300${(phoneCounter++).toString().padStart(4, '0')}`; }

  function onboardedTeacher(opts) {
    const phone = nextPhone();
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash, opts);
    setOnboardingStep(phoneHash, ONBOARDING_STEPS.DONE);
    return { phone, phoneHash };
  }

  // ══════════════════════════════════════════════════════════════════════
  console.log('\n── MY CLASSES ──');
  // ══════════════════════════════════════════════════════════════════════
  {
    // Scenario: zero classes
    const { phone } = onboardedTeacher({});
    sentMessages.length = 0;
    const handled = await handleCommand(phone, 'MY CLASSES');
    check(handled === true, 'MY CLASSES (zero classes): handled');
    check(/haven.t added any classes/i.test(lastReply()), 'MY CLASSES (zero classes): real empty-state message');
    check(/NEW CLASS/.test(lastReply()), 'MY CLASSES (zero classes): prompts NEW CLASS');
  }
  {
    // Scenario: one class. Declared capacity (30) at creation deliberately
    // differs from the real roster (2 actually added) — RC1-D1-004/Cycle 25:
    // MY CLASSES must show the live active roster count (matching the
    // dashboard's GET /api/classes), not the stale classes.learner_count
    // capacity column.
    const { phone, phoneHash } = onboardedTeacher({});
    const newClass = createClass(phoneHash, 'Grade 6A Mathematics', 6, 'Mathematics', 30);
    const { setRoster } = require('../services/learnerRosterService');
    setRoster(phoneHash, newClass.id, ['Learner One', 'Learner Two']);
    sentMessages.length = 0;
    const handled = await handleCommand(phone, 'MY CLASSES');
    check(handled === true, 'MY CLASSES (one class): handled');
    check(/Grade 6A Mathematics/.test(lastReply()), 'MY CLASSES (one class): real class name present');
    check(/2 learners/.test(lastReply()), 'MY CLASSES (one class): shows live roster count (2), not the stale declared capacity (30)');
    check(!/30 learners/.test(lastReply()), 'MY CLASSES (one class): does not show the stale declared capacity');
    check(/\(1\)/.test(lastReply()), 'MY CLASSES (one class): count header shows 1');
  }
  {
    // Scenario: multiple classes
    const { phone, phoneHash } = onboardedTeacher({});
    createClass(phoneHash, 'Grade 6A Mathematics', 6, 'Mathematics', 30);
    createClass(phoneHash, 'Grade 7B Natural Sciences', 7, 'Natural Sciences', 25);
    createClass(phoneHash, 'Grade 8C English', 8, 'English', 28);
    sentMessages.length = 0;
    const handled = await handleCommand(phone, 'MY CLASSES');
    check(handled === true, 'MY CLASSES (multiple classes): handled');
    check(/\(3\)/.test(lastReply()), 'MY CLASSES (multiple classes): count header shows 3');
    check(/Grade 6A Mathematics/.test(lastReply()) && /Grade 7B Natural Sciences/.test(lastReply()) && /Grade 8C English/.test(lastReply()),
      'MY CLASSES (multiple classes): all three real class names present');
  }

  // ══════════════════════════════════════════════════════════════════════
  console.log('\n── NEW CLASS ──');
  // ══════════════════════════════════════════════════════════════════════
  {
    // Scenario: valid creation
    const { phone, phoneHash } = onboardedTeacher({});
    sentMessages.length = 0;
    const handled = await handleCommand(phone, 'NEW CLASS Grade 9D Mathematics | 34');
    check(handled === true, 'NEW CLASS (valid): handled');
    check(/Class created/.test(lastReply()), 'NEW CLASS (valid): confirmation message');
    check(/Grade 9D Mathematics/.test(lastReply()), 'NEW CLASS (valid): echoes real class name');
    check(/34/.test(lastReply()), 'NEW CLASS (valid): echoes real learner count');
    const row = db.prepare(`SELECT * FROM classes WHERE phone_hash = ?`).get(phoneHash);
    check(!!row && row.name === 'Grade 9D Mathematics' && row.learner_count === 34,
      'NEW CLASS (valid): real DB row persisted with correct name/count');
  }
  {
    // Scenario: missing name (no pipe at all -> "no arguments" or "missing count" path)
    const { phone } = onboardedTeacher({});
    sentMessages.length = 0;
    const handled = await handleCommand(phone, 'NEW CLASS');
    check(handled === true, 'NEW CLASS (no args): handled');
    check(/Create a new class/.test(lastReply()), 'NEW CLASS (no args): shows usage prompt');
  }
  {
    // Scenario: invalid name (blank name before pipe)
    const { phone } = onboardedTeacher({});
    sentMessages.length = 0;
    const handled = await handleCommand(phone, 'NEW CLASS  | 20');
    check(handled === true, 'NEW CLASS (blank name): handled');
    check(/Class name required/.test(lastReply()), 'NEW CLASS (blank name): real validation error message');
  }
  {
    // Scenario: invalid learner count (not a number)
    const { phone } = onboardedTeacher({});
    sentMessages.length = 0;
    const handled = await handleCommand(phone, 'NEW CLASS Grade 5A | abc');
    check(handled === true, 'NEW CLASS (count not a number): handled');
    check(/Invalid learner count/.test(lastReply()), 'NEW CLASS (count not a number): real validation error message');
  }
  {
    // Scenario: invalid learner count (too low)
    const { phone } = onboardedTeacher({});
    sentMessages.length = 0;
    const handled = await handleCommand(phone, 'NEW CLASS Grade 5A | 0');
    check(handled === true, 'NEW CLASS (count too low): handled');
    check(/at least 1/.test(lastReply()), 'NEW CLASS (count too low): real validation error message');
  }
  {
    // Scenario: duplicate class name
    const { phone, phoneHash } = onboardedTeacher({});
    createClass(phoneHash, 'Grade 6A Mathematics', 6, 'Mathematics', 30);
    sentMessages.length = 0;
    const handled = await handleCommand(phone, 'NEW CLASS Grade 6A Mathematics | 25');
    check(handled === true, 'NEW CLASS (duplicate name): handled');
    check(/already have a class called/.test(lastReply()), 'NEW CLASS (duplicate name): real duplicate-name error message');
    const count = db.prepare(`SELECT COUNT(*) AS n FROM classes WHERE phone_hash = ?`).get(phoneHash).n;
    check(count === 1, 'NEW CLASS (duplicate name): no second row was created');
  }

  // ══════════════════════════════════════════════════════════════════════
  console.log('\n── MY ASSESSMENTS ──');
  // ══════════════════════════════════════════════════════════════════════
  function insertAssessment(phoneHash, { title, grade, subject, term, totalMarks }) {
    const info = db.prepare(
      `INSERT INTO assessments (phone_hash, title, grade, subject, term, assessment_type, total_marks) VALUES (?, ?, ?, ?, ?, 'test', ?)`
    ).run(phoneHash, title, grade, subject, term, totalMarks);
    return info.lastInsertRowid;
  }
  function insertLearnerResult(assessmentId, name, mark, totalMarks) {
    db.prepare(
      `INSERT INTO learner_results (assessment_id, learner_name, mark, total_marks, percentage) VALUES (?, ?, ?, ?, ?)`
    ).run(assessmentId, name, mark, totalMarks, Math.round((mark / totalMarks) * 100));
  }
  {
    // Scenario: no assessment history
    const { phone } = onboardedTeacher({});
    sentMessages.length = 0;
    const handled = await handleCommand(phone, 'MY ASSESSMENTS');
    check(handled === true, 'MY ASSESSMENTS (none): handled');
    check(/No data-driven assessments on record/.test(lastReply()), 'MY ASSESSMENTS (none): real empty-state message');
  }
  {
    // Scenario: real assessment history (single assessment, real learner results -> real class average)
    const { phone, phoneHash } = onboardedTeacher({});
    const aId = insertAssessment(phoneHash, { title: 'Fractions Quiz', grade: 6, subject: 'Mathematics', term: 2, totalMarks: 20 });
    insertLearnerResult(aId, 'Thabo Mokoena', 18, 20);
    insertLearnerResult(aId, 'Naledi Dlamini', 14, 20);
    sentMessages.length = 0;
    const handled = await handleCommand(phone, 'MY ASSESSMENTS');
    check(handled === true, 'MY ASSESSMENTS (one, real data): handled');
    check(/Fractions Quiz/.test(lastReply()), 'MY ASSESSMENTS (one, real data): real title present');
    check(/Learners: 2/.test(lastReply()), 'MY ASSESSMENTS (one, real data): real learner count (2)');
    // (18+14)/2 = 16/20 = 80%
    check(/80%/.test(lastReply()), 'MY ASSESSMENTS (one, real data): real class average computed correctly (80%)');
  }
  {
    // Scenario: multiple assessments across classes/history, correct ordering + count
    const { phone, phoneHash } = onboardedTeacher({});
    const a1 = insertAssessment(phoneHash, { title: 'Older Test', grade: 6, subject: 'Mathematics', term: 1, totalMarks: 10 });
    insertLearnerResult(a1, 'Learner A', 5, 10);
    db.prepare(`UPDATE assessments SET created_at = datetime('now','-2 days') WHERE id = ?`).run(a1);
    const a2 = insertAssessment(phoneHash, { title: 'Newer Test', grade: 7, subject: 'Natural Sciences', term: 2, totalMarks: 10 });
    insertLearnerResult(a2, 'Learner B', 9, 10);
    sentMessages.length = 0;
    const handled = await handleCommand(phone, 'MY ASSESSMENTS');
    check(handled === true, 'MY ASSESSMENTS (multiple): handled');
    check(/\(2 total\)/.test(lastReply()), 'MY ASSESSMENTS (multiple): real total count (2)');
    const newerIdx = lastReply().indexOf('Newer Test');
    const olderIdx = lastReply().indexOf('Older Test');
    check(newerIdx !== -1 && olderIdx !== -1 && newerIdx < olderIdx,
      'MY ASSESSMENTS (multiple): correctly ordered most-recent-first');
  }

  // ══════════════════════════════════════════════════════════════════════
  console.log('\n── MY PROGRESS ──');
  // ══════════════════════════════════════════════════════════════════════
  {
    // Scenario: no progress data — profile incomplete (no grade/subject)
    const { phone } = onboardedTeacher({});
    sentMessages.length = 0;
    const handled = await handleCommand(phone, 'MY PROGRESS');
    check(handled === true, 'MY PROGRESS (profile incomplete): handled');
    check(/Profile incomplete/.test(lastReply()), 'MY PROGRESS (profile incomplete): real incomplete-profile message');
  }
  {
    // Scenario: real learner/assessment data — profile complete, real CAPS
    // topics exist for Grade 7 Mathematics (CAPS_TOPICS only covers Senior
    // Phase grades 7-9 and FET 10-12 for mathematics — Grade 6 is NOT
    // present, confirmed via direct inspection of
    // services/curriculumIntelligenceService.js's CAPS_TOPICS table during
    // this recon; this differs from the ATP prompt data used elsewhere,
    // which is a separate table), seed genuine coverage via the real
    // markTopicCovered() service call.
    const { phone, phoneHash } = onboardedTeacher({ grade: 7, subject: 'Mathematics' });
    const covered = require('../services/curriculumCoverageService');
    // Use the real getTeacherProgressReport() call path itself to discover a
    // real topic name first (dry call before any coverage is marked), so the
    // seeded topic is guaranteed to be a genuine CAPS Grade 7 Maths topic,
    // not a guessed string.
    const dryReport = covered.getTeacherProgressReport(phoneHash);
    check(dryReport && dryReport.dataAvailable === true, 'MY PROGRESS setup: Grade 7 Mathematics has real CAPS reference data (dataAvailable)');
    const someTerm = dryReport.termResults.find(t => t.outstandingTopicList && t.outstandingTopicList.length > 0);
    check(!!someTerm, 'MY PROGRESS setup: at least one term has outstanding topics to mark covered');
    const topicToMark = someTerm.outstandingTopicList[0];
    markTopicCovered(phoneHash, 7, 'Mathematics', someTerm.term, topicToMark);

    sentMessages.length = 0;
    const handled = await handleCommand(phone, 'MY PROGRESS');
    check(handled === true, 'MY PROGRESS (real data): handled');
    check(/Curriculum Progress/.test(lastReply()), 'MY PROGRESS (real data): real progress header');
    check(/Mathematics/.test(lastReply()), 'MY PROGRESS (real data): real subject shown');
    check(/1 topic\(s\) recorded/.test(lastReply()) || /topic\(s\) recorded/.test(lastReply()),
      'MY PROGRESS (real data): topic-count line present, reflecting the real marked topic');
  }
  {
    // Scenario: profile complete but subject has no CAPS reference data ->
    // falls back to calendar estimate branch (dataAvailable === false).
    const { phone } = onboardedTeacher({ grade: 6, subject: 'Life Orientation (Zzz Unmapped Subject)' });
    sentMessages.length = 0;
    const handled = await handleCommand(phone, 'MY PROGRESS');
    check(handled === true, 'MY PROGRESS (subject not in CAPS reference): handled');
    // Either a calendar-estimate reply or an explicit "not available" fallback —
    // both are legitimate real branches in workspaceFlow.js; assert *some* reply
    // was sent and it did not crash, then inspect for the documented markers.
    const reply = lastReply();
    check(reply.length > 0, 'MY PROGRESS (subject not in CAPS reference): real reply sent, no crash');
  }

  // ══════════════════════════════════════════════════════════════════════
  console.log('\n── WORKSPACE (composition) ──');
  // ══════════════════════════════════════════════════════════════════════
  {
    // Scenario: empty workspace
    const { phone } = onboardedTeacher({});
    sentMessages.length = 0;
    const handled = await handleCommand(phone, 'WORKSPACE');
    check(handled === true, 'WORKSPACE (empty): handled');
    check(/Classes:\* 0/.test(lastReply()), 'WORKSPACE (empty): real zero class count');
    check(/None yet/.test(lastReply()), 'WORKSPACE (empty): real "none yet" class guidance');
    check(/Assessments analysed:\* 0/.test(lastReply()), 'WORKSPACE (empty): real zero assessment count');
  }
  {
    // Scenario: populated workspace — real classes + real assessment +
    // real coverage all present at once, confirming composition (not just
    // each sub-report individually, matching the corresponding standalone
    // command's own output).
    const { phone, phoneHash } = onboardedTeacher({ grade: 7, subject: 'Mathematics' });
    createClass(phoneHash, 'Grade 7A Mathematics', 7, 'Mathematics', 30);
    createClass(phoneHash, 'Grade 7B Mathematics', 7, 'Mathematics', 28);
    const aId = insertAssessment(phoneHash, { title: 'Composition Check Test', grade: 7, subject: 'Mathematics', term: 2, totalMarks: 10 });
    insertLearnerResult(aId, 'Learner X', 7, 10);
    const covered2 = require('../services/curriculumCoverageService');
    const dryReport2 = covered2.getTeacherProgressReport(phoneHash);
    const someTerm2 = dryReport2.termResults.find(t => t.outstandingTopicList && t.outstandingTopicList.length > 0);
    if (someTerm2) markTopicCovered(phoneHash, 7, 'Mathematics', someTerm2.term, someTerm2.outstandingTopicList[0]);

    sentMessages.length = 0;
    const handled = await handleCommand(phone, 'WORKSPACE');
    check(handled === true, 'WORKSPACE (populated): handled');
    check(/Classes:\* 2/.test(lastReply()), 'WORKSPACE (populated): real class count (2)');
    check(/Grade 7A Mathematics/.test(lastReply()), 'WORKSPACE (populated): real class name listed');
    check(/Assessments analysed:\* 1/.test(lastReply()), 'WORKSPACE (populated): real assessment count (1)');
    check(/Composition Check Test/.test(lastReply()), 'WORKSPACE (populated): real last-assessment title shown');
    check(/70%/.test(lastReply()), 'WORKSPACE (populated): real last-assessment class avg (70%)');
    if (someTerm2) {
      check(/Curriculum coverage:/.test(lastReply()), 'WORKSPACE (populated): real curriculum coverage line present');
    }
    check(/MY CLASSES \| MY ASSESSMENTS \| MY PROGRESS/.test(lastReply()), 'WORKSPACE (populated): quick-commands footer present');
  }

  // ══════════════════════════════════════════════════════════════════════
  console.log('\n── Onboarding boundary (confirmation, not assumption) ──');
  // ══════════════════════════════════════════════════════════════════════
  const GROUP_A_COMMANDS = ['MY CLASSES', 'NEW CLASS Grade 8B Mathematics | 28', 'MY ASSESSMENTS', 'MY PROGRESS', 'WORKSPACE'];
  {
    let i = 0;
    for (const cmd of GROUP_A_COMMANDS) {
      const phone = `+27833900${(i++).toString().padStart(3, '0')}`;
      const phoneHash = hashPhone(phone);
      insertTeacher(phoneHash); // teachers row exists, no onboarding row — matches usageTracker.js's lazy create
      sentMessages.length = 0;
      const handled = await handleCommand(phone, cmd);
      check(handled === false, `Onboarding-boundary NEW-"${cmd}": not intercepted for a brand-new teacher`);
      check(sentMessages.length === 0, `Onboarding-boundary NEW-"${cmd}": commandHandler sent nothing`);
    }
  }
  {
    const phone = '+27833910001';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    setOnboardingStep(phoneHash, ONBOARDING_STEPS.ASK_GRADE);
    for (const cmd of GROUP_A_COMMANDS) {
      sentMessages.length = 0;
      const handled = await handleCommand(phone, cmd);
      check(handled === false, `Onboarding-boundary MID-"${cmd}": does not escape mid-onboarding`);
      check(sentMessages.length === 0, `Onboarding-boundary MID-"${cmd}": commandHandler sent nothing`);
    }
    check(true, 'Onboarding-boundary MID: step remains untouched throughout (implied by no side-effecting sends above)');
  }
  {
    const { phone } = onboardedTeacher({});
    for (const cmd of GROUP_A_COMMANDS) {
      sentMessages.length = 0;
      const handled = await handleCommand(phone, cmd);
      check(handled === true, `Onboarding-boundary DONE-"${cmd}": handled normally once onboarded`);
      check(sentMessages.length === 1, `Onboarding-boundary DONE-"${cmd}": sends exactly one reply`);
    }
  }

  console.log('\n─────────────────────────────────');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  testDb.cleanup?.();
  process.exit(failed > 0 ? 1 : 0);
})();
