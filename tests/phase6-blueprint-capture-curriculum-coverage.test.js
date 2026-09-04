'use strict';
// Phase 6 regression — blueprint-based NEW TEST captures must advance
// teacher-level curriculum coverage (MY PROGRESS / MY CURRICULUM PROGRESS),
// the same way the legacy CSV/photo data-assessment flow already does.
//
// Bug (found during Phase 6 discovery, cycle 3): flows/assessmentSessionFlow.js
// (the modern, blueprint-driven NEW TEST capture workflow) called
// processAssessmentData() without an `atpTopics` field. storeAssessment()
// (services/diagnosticWorkflowService.js) therefore always persisted
// assessments.atp_topics as '[]' for these assessments, and
// updateCoverageFromAssessment() — called unconditionally right after
// storeAssessment() on every completed assessment — silently marked zero
// topics covered. Only the legacy flows/assessmentFlow.js (CSV/photo upload)
// populated atpTopics correctly (from parseResult.questionTopics).
//
// Net effect: a teacher using the primary, blueprint-based test-capture
// workflow (exercised by the large rc1-* test suite) never saw their
// curriculum-coverage tracking advance, even though they were actively
// testing against ATP-aligned, CAPS-registry-validated blueprint topics.
//
// This is NOT the same system as services/coverageService.js (ADR-007),
// which is a separate, learner-level, already-blueprint-aware system
// feeding MasteryService/ClassAnalyticsService — untouched by this bug and
// untouched by this fix. This test is scoped strictly to the teacher-level
// system (services/curriculumCoverageService.js's atp_topics /
// getTeacherProgressReport(), surfaced via MY PROGRESS / MY CURRICULUM
// PROGRESS in flows/workspaceFlow.js).
//
// Fix: flows/assessmentSessionFlow.js now derives atpTopics from the
// blueprint's own (CAPS-registry-validated at publish time) per-question
// topics already present in capture state, and passes them through to
// processAssessmentData() — mirroring exactly what the legacy flow already
// does.
//
// This test drives a REAL NEW TEST capture to completion through the real
// dispatch chain (processMessage -> commandHandler -> assessmentSessionFlow
// -> processAssessmentData -> updateCoverageFromAssessment), then asserts
// against the real curriculumCoverageService.getTeacherProgressReport()
// output — no mocking of the coverage pipeline itself.
//
// Run: node tests/phase6-blueprint-capture-curriculum-coverage.test.js

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

// ── Stub WhatsApp send only — real dispatch chain otherwise untouched ──────
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

function insertTeacher(phoneHash, { grade = '7', subject = 'Mathematics' } = {}) {
  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject, is_pro) VALUES (?, ?, ?, ?, 1)`)
    .run(phoneHash, 'Test Teacher', grade, subject);
  db.prepare(`
    INSERT INTO onboarding (phone_hash, step, updated_at)
    VALUES (?, 'done', datetime('now'))
    ON CONFLICT(phone_hash) DO UPDATE SET step = 'done'
  `).run(phoneHash);
}

function insertClass(phoneHash, { name = 'Class A', grade = 7, subject = 'Mathematics', learnerCount = 0 } = {}) {
  return db.prepare(
    `INSERT INTO classes (phone_hash, name, grade, subject, learner_count) VALUES (?, ?, ?, ?, ?)`
  ).run(phoneHash, name, grade, subject, learnerCount).lastInsertRowid;
}

function makeMessage(from, body, id) { return { from, id, type: 'text', text: { body } }; }

(async () => {
  const {
    createBlueprint,
    publishBlueprint,
  } = require('../services/blueprintRepository');

  const {
    getTeacherProgressReport,
  } = require('../services/curriculumCoverageService');

  const {
    hashPhone,
    processMessage,
    buildProcessMessageDeps,
    assessmentSessionState,
  } = require('../routes/webhook').__testExports;

  let msgCounter = 0;
  async function send(phone, body) {
    msgCounter += 1;
    await processMessage(makeMessage(phone, body, `msg-${msgCounter}`), buildProcessMessageDeps());
  }

  function publishedBlueprint(phoneHash, { title, grade = 7, subject = 'Mathematics', term = 1, questions } = {}) {
    const result = createBlueprint(
      phoneHash,
      { title, subject, grade, term, totalMarks: questions.reduce((s, q) => s + q.maxMarks, 0) || 1 },
      questions
    );
    publishBlueprint(result.blueprintId, phoneHash);
    return result.blueprintId;
  }

  // Drives a genuine NEW TEST capture to completion through real dispatch —
  // same pattern used by tests/rc1-classintervention-dispatch.test.js.
  async function captureRealAssessment(phone, { blueprintListPosition, classListPosition, learnerName, marks }) {
    await send(phone, 'NEW TEST');
    await send(phone, String(blueprintListPosition));
    await send(phone, String(classListPosition));
    await send(phone, learnerName);
    for (const mark of marks) {
      await send(phone, String(mark));
    }
  }

  console.log('\n── Phase 6: blueprint-capture curriculum-coverage regression ──\n');

  // A real CAPS Grade 7 Mathematics Term 1 topic (services/curriculumIntelligenceService.js),
  // so getTeacherProgressReport()'s dataAvailable/expectedTopics is real, not
  // a fixture. "Common fractions" is one of five expected Term 1 topics.
  const CAPS_TOPIC = 'Common fractions';

  console.log('── Scenario: NEW TEST capture with a CAPS-aligned blueprint topic ──');
  {
    const phone = '+27821299201';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    insertClass(phoneHash, { name: 'Coverage Class', learnerCount: 1 });

    const blueprintId = publishedBlueprint(phoneHash, {
      title: 'Coverage Regression Test',
      grade: 7,
      subject: 'Mathematics',
      term: 1,
      questions: [{ questionNumber: 1, topic: CAPS_TOPIC, maxMarks: 10 }],
    });
    check(!!blueprintId, 'setup: real published blueprint created with a CAPS-aligned topic');

    // Baseline: before capture, the topic is not yet covered.
    // getTeacherProgressReport() returns ONE object (per the teacher's own
    // grade/subject profile) with a termResults[] array covering terms 1-4 —
    // not an array of per-subject reports.
    const before = getTeacherProgressReport(phoneHash);
    check(!!before && before.dataAvailable === true, 'baseline: CAPS reference data is genuinely available for Grade 7 Mathematics', JSON.stringify(before));
    const beforeTerm1 = before && (before.termResults || []).find(t => t.term === 1);
    check(!!beforeTerm1, 'baseline: a Term 1 result exists before capture');
    check(!!beforeTerm1 && Array.isArray(beforeTerm1.coveredTopicList) && !beforeTerm1.coveredTopicList.includes(CAPS_TOPIC),
      'baseline: the target topic is NOT yet marked covered before any capture', JSON.stringify(beforeTerm1));

    let threw = false, thrownErr = null;
    try {
      await captureRealAssessment(phone, {
        blueprintListPosition: 1,
        classListPosition: 1,
        learnerName: 'Coverage Learner',
        marks: [8],
      });
    } catch (err) { threw = true; thrownErr = err; }
    check(!threw, 'no crash driving a real NEW TEST capture to completion', thrownErr?.stack);

    const stateAtCompletion = assessmentSessionState.get(phoneHash);
    check(!!stateAtCompletion && stateAtCompletion.step === 'completeMenu',
      'real capture session reached COMPLETE_MENU (genuine completion, not seeded)', JSON.stringify(stateAtCompletion));

    // ── The regression assertion: coverage must now reflect the capture ──
    const after = getTeacherProgressReport(phoneHash);
    const afterTerm1 = after && (after.termResults || []).find(t => t.term === 1);
    check(!!afterTerm1, 'a Term 1 result still exists after capture');
    check(!!afterTerm1 && Array.isArray(afterTerm1.coveredTopicList) && afterTerm1.coveredTopicList.includes(CAPS_TOPIC),
      'THE FIX: the blueprint-captured topic is now marked covered — this is exactly what was broken before',
      JSON.stringify(afterTerm1));
    check(!!afterTerm1 && !!beforeTerm1 && afterTerm1.coveragePercentage > beforeTerm1.coveragePercentage,
      'coveragePercentage increased as a direct result of the blueprint-based capture',
      `before=${beforeTerm1 && beforeTerm1.coveragePercentage} after=${afterTerm1 && afterTerm1.coveragePercentage}`);
    check(after.totalCovered > before.totalCovered,
      'overall totalCovered (across all terms) increased as a direct result of the blueprint-based capture');

    // Confirm at the raw-DB level too — atp_topics on the stored assessment
    // itself must actually contain the topic, not just an indirect effect.
    const assessmentRow = db.prepare(
      `SELECT atp_topics FROM assessments WHERE phone_hash = ? AND blueprint_id = ? ORDER BY id DESC LIMIT 1`
    ).get(phoneHash, blueprintId);
    check(!!assessmentRow, 'the completed assessment row exists in the real db');
    const storedTopics = assessmentRow ? JSON.parse(assessmentRow.atp_topics || '[]') : [];
    check(storedTopics.includes(CAPS_TOPIC),
      'assessments.atp_topics was actually populated for a blueprint-based capture (was always "[]" before the fix)',
      assessmentRow ? assessmentRow.atp_topics : 'no row');
  }

  console.log('\n── Control: multiple blueprint questions sharing one topic are deduped, not double-counted ──');
  {
    // publishBlueprint() itself validates every question topic against the
    // CAPS registry at publish time (blueprintTopicValidation.js) — an
    // off-registry topic can structurally never reach a published
    // blueprint, so there is no "junk topic leaks into coverage" case to
    // test here. The real edge case worth covering is the dedup this fix
    // introduces ([...new Set(...)]): a blueprint where two questions
    // share the same CAPS topic must still only mark it covered once, not
    // error or produce a duplicate-laden atp_topics array.
    const phone = '+27821299202';
    const phoneHash = hashPhone(phone);
    insertTeacher(phoneHash);
    insertClass(phoneHash, { name: 'Dedup Class', learnerCount: 1 });

    const blueprintId = publishedBlueprint(phoneHash, {
      title: 'Dedup Topic Test',
      grade: 7,
      subject: 'Mathematics',
      term: 1,
      questions: [
        { questionNumber: 1, topic: CAPS_TOPIC, maxMarks: 5 },
        { questionNumber: 2, topic: CAPS_TOPIC, maxMarks: 5 },
        // "Integers" is a Term 2 (not Term 1) Grade 7 Mathematics ATP topic
        // — see Cycle 33 CAPS_TOPICS.mathematics[7] correction in
        // curriculumIntelligenceService.js. Use "Whole numbers", a real
        // Term 1 topic, so this stays a valid same-term dedup scenario.
        { questionNumber: 3, topic: 'Whole numbers', maxMarks: 5 },
      ],
    });

    await captureRealAssessment(phone, {
      blueprintListPosition: 1,
      classListPosition: 1,
      learnerName: 'Dedup Learner',
      marks: [4, 4, 4],
    });

    const report = getTeacherProgressReport(phoneHash);
    const term1 = report && (report.termResults || []).find(t => t.term === 1);
    check(!!term1, 'a progress result exists for the dedup capture');
    check(!!term1 && term1.coveredTopicList.includes(CAPS_TOPIC) && term1.coveredTopicList.includes('Whole numbers'),
      'both distinct topics are marked covered', JSON.stringify(term1));

    const assessmentRow = db.prepare(
      `SELECT atp_topics FROM assessments WHERE phone_hash = ? AND blueprint_id = ? ORDER BY id DESC LIMIT 1`
    ).get(phoneHash, blueprintId);
    const storedTopics = assessmentRow ? JSON.parse(assessmentRow.atp_topics || '[]') : [];
    check(storedTopics.filter(t => t === CAPS_TOPIC).length === 1,
      'the shared topic appears exactly once in atp_topics, not twice — dedup works',
      JSON.stringify(storedTopics));
    check(storedTopics.length === 2,
      '3 questions with 2 distinct topics produce exactly 2 stored atp_topics entries',
      JSON.stringify(storedTopics));
  }

  console.log('\n── Regression guard: legacy CSV/photo data-assessment flow is unaffected ──');
  {
    // Sanity check that this fix did not touch flows/assessmentFlow.js's
    // (the legacy CSV/photo path's) own atpTopics wiring.
    const legacyFlowSrc = require('fs').readFileSync(
      path.resolve(__dirname, '../flows/assessmentFlow.js'), 'utf8'
    );
    check(legacyFlowSrc.includes('atpTopics: Object.values(parseResult.questionTopics'),
      'legacy CSV/photo flow\'s atpTopics wiring is untouched by this fix');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:', failures.join(', '));
    process.exitCode = 1;
  }

  Module._resolveFilename = origResolve;
  testDb.cleanup();
})();