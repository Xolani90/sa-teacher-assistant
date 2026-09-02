'use strict';
/**
 * Feature 2 — TRUE end-to-end journey test.
 *
 * Closes the one remaining coverage gap identified after inspecting Feature 2
 * (86791a3, 78015fc): tests/resources-dashboard-e2e.test.js proves persistence
 * -> dashboard read, but calls services/teacherWorkspaceService.js#saveResource
 * directly rather than the real SAVE dispatch path. tests/rc1-lessonplan-dispatch.test.js
 * proves generation -> WhatsApp delivery (including a real, but generic,
 * *HOMEWORK* section) through the real dispatch chain, but never saves or
 * reads back through the dashboard.
 *
 * This file exercises the ONE complete chain neither existing file covers:
 *
 *   real dispatch (routes/webhook.js::processMessage(), same entry point as
 *   the production webhook)
 *   -> core/commandHandler.js's LESSONPLAN follow-up command
 *   -> topic resolution through the REAL ATP lookup
 *      (services/curriculumIntelligenceService.js::resolveCurrentTopic(),
 *      exercised indirectly exactly as Scenario 3 of
 *      rc1-lessonplan-dispatch.test.js already proves it — same frozen date,
 *      same grade/subject, same expected topic, so this file inherits that
 *      already-verified real ATP data rather than asserting anything new
 *      about the ATP lookup itself)
 *   -> core/generationPipeline.js::triggerGeneration() (real pipeline; only
 *      the AI boundary is stubbed, and the stub echoes the SAME topic the
 *      prompt was actually built with, so a same-topic assertion below is
 *      checking real prompt-to-output plumbing, not a test fixture coincidence)
 *   -> utils/lessonPlanHomework.js's REAL hasUsableHomework()/extractHomeworkSection()
 *      (imported and called directly here — not reimplemented)
 *   -> WhatsApp delivery (stubbed send, captured)
 *   -> real SAVE command dispatched as an actual inbound message (NOT a
 *      direct saveResource() call)
 *   -> core/commandHandler.js's SAVE branch (real; persists metadata.homework)
 *   -> routes/api.js's REAL GET /api/resources and GET /api/resources/:id
 *      handlers (via __testExports, same pattern as
 *      tests/resources-dashboard-e2e.test.js), reading the SAME row SAVE
 *      just wrote
 *   -> ownership scoping against the real SQL WHERE clause
 *
 * No production code is touched by this file. Only the AI boundary
 * (services/aiService.js) and WhatsApp send (services/whatsappService.js)
 * are stubbed, exactly as in tests/rc1-lessonplan-dispatch.test.js. No
 * network calls, no real LLM calls, no new DB schema.
 *
 * Run individually: node tests/feature2-lessonplan-homework-e2e-journey.test.js
 * Run via npm:       npm test
 */

process.env.PII_SECRET = 'test-secret-key-32-bytes-long!!';
process.env.FREE_LIMIT = '10';
process.env.APP_URL    = 'https://example.test';
process.env.PDF_SECRET = 'pdf-secret';
process.env.PRO_PRICE_ZAR = '99';

const Module = require('module');
const path = require('path');

let passed = 0;
let failed = 0;
function check(condition, label, extra) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else {
    console.error(`  ❌ FAIL: ${label}${extra !== undefined ? ' -- ' + extra : ''}`);
    failed++;
  }
}

// ── Clock-freeze helper — identical to tests/rc1-lessonplan-dispatch.test.js's
// Scenario 3, reused verbatim so the same real ATP resolution
// (Grade 7 Mathematics, 2026-08-05 -> "Geometric constructions") applies here.
const RealDate = Date;
function freezeDate(fixedIso) {
  class FrozenDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) return new RealDate(fixedIso);
      return new RealDate(...args);
    }
    static now() { return new RealDate(fixedIso).getTime(); }
  }
  global.Date = FrozenDate;
}
function unfreezeDate() {
  global.Date = RealDate;
}

// createTestDb must be required first — see its own header comment for why
// (it monkeypatches better-sqlite3 resolution before any service/repository
// module is required).
const { createTestDb } = require('./helpers/createTestDb');
const testDb = createTestDb(__filename);
const db = testDb.db;

// ── Stub WhatsApp send only — capture text sends, same as
// rc1-lessonplan-dispatch.test.js. ──
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

// ── Stub the AI boundary only. Unlike rc1-lessonplan-dispatch.test.js's
// generic fixture, this stub reads the ACTUAL topic prompts/lessonPlan.js
// embedded in the prompt ("- Topic: <topic>") and echoes that same string
// into both the lesson body and the *HOMEWORK* section — so the
// same-topic assertion below is proving real prompt plumbing (the prompt
// really was built with the resolved topic, and the stub had no way to
// know that topic except by reading it out of the real prompt text),
// not asserting against a hardcoded fixture that merely happens to match. ──
const aiServicePath = path.resolve(__dirname, '../services/aiService');
require.cache[aiServicePath] = {
  id: aiServicePath, filename: aiServicePath, loaded: true,
  exports: {
    generateContent: async (prompt, intentType) => {
      if (intentType === 'classifier') throw new Error('force regex fallback for deterministic test classification');
      const topicMatch = /-\s*Topic:\s*(.+)/.exec(prompt);
      const topic = topicMatch ? topicMatch[1].trim() : 'Unknown Topic';
      return (
        `*LESSON PLAN: ${topic}*\n` +
        `*Duration: 60 min*\n\n` +
        `*LEARNING OBJECTIVES*\n` +
        `By the end of this lesson, learners will understand ${topic} and apply it to a worked example.\n\n` +
        `*INTRODUCTION (10 min)*\n` +
        `Recap prior knowledge and introduce ${topic} with a relatable example.\n\n` +
        `*MAIN ACTIVITY (35 min)*\n` +
        `Guided practice with worked examples on ${topic}, followed by independent practice questions.\n\n` +
        `*CONCLUSION (10 min)*\n` +
        `Exit-ticket question to check understanding of ${topic}.\n\n` +
        `*HOMEWORK*\n` +
        `Complete five practice problems on ${topic} and bring corrections tomorrow.\n\n` +
        `*RESOURCES NEEDED*\n` +
        `Chalkboard, worksheets, textbook.`
      );
    },
  },
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === './whatsappService' || request === '../services/whatsappService') return whatsappPath;
  if (request === './aiService' || request === '../services/aiService') return aiServicePath;
  return origResolve.call(this, request, ...rest);
};

function insertTeacher(phoneHash, { grade = '9', subject = 'English' } = {}) {
  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject, is_pro) VALUES (?, ?, ?, ?, 0)`)
    .run(phoneHash, 'Test Teacher', grade, subject);
  db.prepare(`
    INSERT INTO onboarding (phone_hash, step, updated_at)
    VALUES (?, 'done', datetime('now'))
    ON CONFLICT(phone_hash) DO UPDATE SET step = 'done'
  `).run(phoneHash);
}

function makeMessage(from, body, id) { return { from, id, type: 'text', text: { body } }; }

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}
function mockReq(phoneHash, params = {}) {
  return { teacher: { id: 1, phoneHash }, query: {}, params };
}

(async () => {
  const {
    hashPhone,
    lastGeneratedState,
    processMessage,
    buildProcessMessageDeps,
  } = require('../routes/webhook').__testExports;
  const pendingIntentState = require('../routes/webhook').__testExports.buildProcessMessageDeps().pendingIntentState;

  const { getSavedResources } = require('../services/teacherWorkspaceService');
  const { createGetResourcesHandler, createGetResourceDetailHandler } = require('../routes/api').__testExports;
  const lessonPlanHomework = require('../utils/lessonPlanHomework');

  let msgCounter = 0;
  async function send(phone, body) {
    msgCounter += 1;
    await processMessage(makeMessage(phone, body, `msg-${msgCounter}`), buildProcessMessageDeps());
  }
  function messagesSince(idx) { return sentMessages.slice(idx); }

  console.log('\n── Feature 2 true end-to-end journey ──\n');

  const TEACHER_A_PHONE = '+27821199001';
  const TEACHER_A_HASH = hashPhone(TEACHER_A_PHONE);
  const TEACHER_B_PHONE = '+27821199002';
  const TEACHER_B_HASH = hashPhone(TEACHER_B_PHONE);

  // Same grade/subject/date combination as rc1-lessonplan-dispatch.test.js's
  // Scenario 3, where "Geometric constructions" is confirmed real ATP data
  // for Grade 7 Mathematics on this frozen date (Term 3, week 3).
  insertTeacher(TEACHER_A_HASH, { grade: '7', subject: 'Mathematics' });
  insertTeacher(TEACHER_B_HASH, { grade: '7', subject: 'Mathematics' });

  // ── Step 1-3: real dispatch, real ATP-driven topic resolution, real
  // generation pipeline (topic genuinely omitted, forcing ATP auto-fill —
  // same technique as Scenario 3). ──
  console.log('── Step 1-3: dispatch LESSONPLAN with no topic -> real ATP auto-fill -> real generation ──');
  pendingIntentState.set(TEACHER_A_HASH, {
    intent: { topic: null, grade: 7, subject: 'mathematics' },
    lastActivity: Date.now(),
  });

  const startIdx = sentMessages.length;
  let threw = false, thrownErr = null, saved;
  let saveThrew = false, saveErr = null;
  let confirmMsg;
  const savingMsgsStart = sentMessages.length;
  // Frozen for both the generation AND the immediate SAVE below, not just
  // the generation call: lastGeneratedState (SessionStore) re-checks its
  // TTL against Date.now() on every .get() call, including the one made
  // deep inside the real SAVE dispatch path — unfreezing between the two
  // sends would make the frozen-past write timestamp look expired against
  // the real (much later) system clock, exactly the class of bug
  // rc1-lessonplan-dispatch.test.js's own freezeDate helper comment warns
  // about, just triggered from a different read site. A teacher saving
  // immediately after generating is also the realistic case being modelled.
  freezeDate('2026-08-05T09:00:00');
  try {
    await send(TEACHER_A_PHONE, 'LESSONPLAN');
    saved = lastGeneratedState.get(TEACHER_A_HASH);
  } catch (err) { threw = true; thrownErr = err; }
  check(!threw, 'no crash in the real dispatch chain', thrownErr?.stack);

  check(!!saved && saved.intent.topic === 'Geometric constructions', 'topic resolved through the real ATP lookup, not teacher-typed', JSON.stringify(saved && saved.intent));
  check(!!saved && saved.intent.atpTopic === true, 'intent.atpTopic confirms this went through ATP auto-fill');

  const msgs = messagesSince(startIdx);
  const contentMsg = msgs.find((m) => /LESSON PLAN/.test(m.text));
  check(!!contentMsg, 'generated lesson plan actually reached WhatsApp send');

  // ── Step 4: homework generated for the SAME resolved topic. ──
  console.log('\n── Step 4: homework grounded in the same resolved topic ──');
  const deliveredContent = contentMsg ? contentMsg.text : '';
  const lessonHeading = /\*LESSON PLAN: (.+)\*/.exec(deliveredContent);
  check(!!lessonHeading && lessonHeading[1] === 'Geometric constructions', 'lesson body itself carries the resolved topic');

  const homeworkSection = lessonPlanHomework.extractHomeworkSection(deliveredContent);
  check(!!homeworkSection, 'a homework section was actually extracted from the delivered content');
  check(!!homeworkSection && homeworkSection.text.includes('Geometric constructions'), 'homework text references the SAME topic as the lesson plan, not a different or generic one');

  // ── Step 5: homework passes the EXISTING deterministic validation
  // (imported directly — not reimplemented here). ──
  console.log('\n── Step 5: homework passes the existing deterministic validation ──');
  check(lessonPlanHomework.hasUsableHomework(deliveredContent), 'hasUsableHomework() (the real production validator) accepts this generated content');

  check(!!saved && saved.intent.homework === (homeworkSection && homeworkSection.text), 'intent.homework set by the real generation pipeline matches the extracted section exactly', JSON.stringify(saved && saved.intent.homework));

  // ── Step 6: the REAL SAVE command, dispatched as an actual inbound
  // message — not a direct saveResource() call. Still inside the frozen
  // window (see comment above). ──
  console.log('\n── Step 6: real SAVE command dispatched through the real handler ──');
  try {
    await send(TEACHER_A_PHONE, 'SAVE');
  } catch (err) { saveThrew = true; saveErr = err; }
  finally { unfreezeDate(); }
  check(!saveThrew, 'SAVE dispatched through the real command handler without crashing', saveErr?.stack);

  const saveMsgs = messagesSince(savingMsgsStart).filter((m) => !msgs.includes(m));
  confirmMsg = saveMsgs.find((m) => /Saved!/.test(m.text));
  check(!!confirmMsg, 'real SAVE handler sent a save confirmation', JSON.stringify(saveMsgs));
  const idMatch = confirmMsg ? /Resource #(\d+)/.exec(confirmMsg.text) : null;
  check(!!idMatch, 'save confirmation names the real persisted resource id');
  const savedResourceId = idMatch ? Number(idMatch[1]) : null;

  check(lastGeneratedState.get(TEACHER_A_HASH) == null, 'lastGeneratedState cleared after a successful real SAVE (SAVED terminal state)');

  // ── Step 7: the saved resource contains the homework in
  // metadata.homework — read via the REAL getSavedResources() service,
  // not a raw SQL peek. ──
  console.log('\n── Step 7: persisted resource carries the homework in metadata.homework ──');
  const listedForA = getSavedResources(TEACHER_A_HASH);
  const listedEntry = listedForA.find((r) => r.id === savedResourceId);
  check(!!listedEntry, 'the SAVE-created resource appears via the real getSavedResources() service');

  // ── Step 8-9: fetch through the REAL dashboard/API read path and
  // confirm it's the exact persisted homework, not a re-generation. ──
  console.log('\n── Step 8-9: real dashboard/API retrieval returns the exact persisted homework ──');
  const listHandler = createGetResourcesHandler({ getSavedResources });
  const { getSavedResource } = require('../services/teacherWorkspaceService');
  const detailHandler = createGetResourceDetailHandler({ getSavedResource });

  const listRes = mockRes();
  listHandler(mockReq(TEACHER_A_HASH), listRes);
  check(listRes.statusCode === 200, 'dashboard list route returns 200');
  check(listRes.body.resources.some((r) => r.id === savedResourceId), 'the real-dispatch-created lesson plan appears in the dashboard list');

  const detailRes = mockRes();
  detailHandler(mockReq(TEACHER_A_HASH, { id: String(savedResourceId) }), detailRes);
  check(detailRes.statusCode === 200, 'dashboard detail route returns 200');
  check(detailRes.body.content === deliveredContent, 'dashboard content is byte-identical to what WhatsApp actually delivered');
  check(
    detailRes.body.homework === (homeworkSection && homeworkSection.text),
    'dashboard homework is the EXACT persisted text extracted at generation time — not a re-generated or re-parsed version',
    JSON.stringify({ dashboard: detailRes.body.homework, expected: homeworkSection && homeworkSection.text })
  );
  check(detailRes.body.topic === 'Geometric constructions', 'dashboard topic matches the real ATP-resolved topic');
  check(detailRes.body.atpTopic === true, 'dashboard surfaces that this topic came from ATP auto-fill, not teacher-typed');

  // ── Step 10: ownership scoping still holds against the real SQL. ──
  console.log('\n── Step 10: ownership scoping ──');
  const intruderRes = mockRes();
  detailHandler(mockReq(TEACHER_B_HASH, { id: String(savedResourceId) }), intruderRes);
  check(intruderRes.statusCode === 404, 'a different teacher gets 404 for the real-dispatch-created resource, not the data');
  check(intruderRes.body.homework === undefined, 'the wrong-owner response carries no homework field at all');

  const intruderListRes = mockRes();
  listHandler(mockReq(TEACHER_B_HASH), intruderListRes);
  check(!intruderListRes.body.resources.some((r) => r.id === savedResourceId), 'the other teacher\'s resource list does not include this lesson plan');

  console.log(`\n📊 Total:  ${passed + failed}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  if (failed > 0) process.exitCode = 1;
})();
