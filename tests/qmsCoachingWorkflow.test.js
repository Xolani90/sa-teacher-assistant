'use strict';
/**
 * qmsCoachingWorkflow.test.js — PR35
 *
 * End-to-end workflow test for the coaching feature, driven through the
 * REAL flow handlers (reflectionFlow.js -> growthPlanFlow.js -> qmsFlow.js)
 * over a real, throwaway, file-backed SQLite DB via runMigrations() — same
 * node:sqlite shim convention as tests/roster-flow.test.js.
 *
 * Unlike reflectionFlow.test.js / growthPlanFlow.test.js / qmsFlow.test.js
 * (which mock createReflection/createGrowthPlan/getCoachingInsights to
 * isolate each flow's own state machine) and coachingEngineService.test.js
 * (which exercises the engine directly against seeded rows), this file
 * wires the real services underneath the real flows and drives the whole
 * thing via simulated WhatsApp messages — the same shape a teacher's
 * actual conversation takes. This is deliberately the top of the test
 * pyramid: it catches wiring bugs (missing deps, wrong flow invoked,
 * command not registered, response composition) that unit/flow-level
 * mocks cannot, at the cost of being slower and coarser-grained than
 * either layer beneath it.
 *
 * Run individually: node tests/qmsCoachingWorkflow.test.js
 * Run via npm:       npm test
 */

const path = require('path');
const fs = require('fs');

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

process.env.DB_PATH = path.join(__dirname, '..', 'qms-coaching-workflow-test.db');
if (fs.existsSync(process.env.DB_PATH)) fs.unlinkSync(process.env.DB_PATH);
_db = new DatabaseSync(process.env.DB_PATH);

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

function assertIncludes(haystack, needle, label) {
  assert(typeof haystack === 'string' && haystack.includes(needle), label);
}

async function run() {
  const { getDb, runMigrations } = require('../utils/database');
  runMigrations();
  const db = getDb();

  const { SessionStore } = require('../utils/sessionStore');
  const { handleReflectionFlow } = require('../flows/reflectionFlow');
  const { handleGrowthPlanFlow } = require('../flows/growthPlanFlow');
  const { handleQmsFlow } = require('../flows/qmsFlow');

  const { createReflection } = require('../services/reflectionService');
  const { createGrowthPlan } = require('../services/growthPlanService');
  const { getCoachingInsights } = require('../services/coachingEngineService');
  const { getLatestTrend } = require('../services/coachingTrendService');
  const { getSummary, getGrowthPlanSummary, getCommonFocusAreas } = require('../services/qmsAnalyticsService');
  const { listReflections } = require('../services/reflectionService');

  // ── Fixtures shared across scenarios ──────────────────────────────────

  const hashPhone = (from) => `hash_${from}`;

  // Deliberately a plain fixture, not the real intentParser — same
  // convention as tests/roster-flow.test.js: isolates this workflow test's
  // job (does the wiring work end-to-end) from the intent-classification
  // logic, which already has its own dedicated coverage
  // (intentParser-shortcuts.test.js).
  function parseIntent(text) {
    const upper = text.trim().toUpperCase();
    if (upper === 'REFLECT') return { type: 'reflection' };
    if (upper === 'NEW GOAL') return { type: 'growth_plan' };
    return { type: 'unknown' };
  }

  const CURRENT_TERM = 2;
  const getCurrentTerm = () => CURRENT_TERM;

  function seedTeacher(phone) {
    const phoneHash = hashPhone(phone);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO teachers (phone_hash, created_at, updated_at) VALUES (?, ?, ?)`)
      .run(phoneHash, now, now);
    return phoneHash;
  }

  function getTeacherByPhoneFixture(phone) {
    const phoneHash = hashPhone(phone);
    const row = db.prepare(`SELECT id FROM teachers WHERE phone_hash = ?`).get(phoneHash);
    return row ? { id: row.id, phoneHash } : null;
  }

  // Distinct SessionStore instances per scenario/phone so runs don't leak
  // into each other, matching the isolation qmsFlow.test.js Section 5/6
  // already verifies at the mocked-deps level.
  function buildDeps(phone) {
    const sentMessages = [];
    const safeSendMessage = async (to, text) => { sentMessages.push({ to, text }); };

    const reflectionState = new SessionStore(`reflection_${phone}`, 30 * 60 * 1000);
    const growthPlanState = new SessionStore(`growthPlan_${phone}`, 30 * 60 * 1000);

    const reflectionDeps = {
      reflectionState,
      safeSendMessage,
      parseIntent,
      hashPhone,
      createReflection,
      getCurrentTerm,
    };

    const growthPlanDeps = {
      growthPlanState,
      safeSendMessage,
      parseIntent,
      hashPhone,
      createGrowthPlan,
      getCurrentTerm,
    };

    const qmsDeps = {
      hashPhone,
      getTeacherByPhone: getTeacherByPhoneFixture,
      safeSendMessage,
      getSummary,
      getGrowthPlanSummary,
      getCommonFocusAreas,
      listReflections,
      getCurrentTerm,
      getCoachingInsights,
    };

    return { sentMessages, reflectionDeps, growthPlanDeps, qmsDeps };
  }

  // Drives a full REFLECT conversation: lesson -> went well -> improvement
  // -> topic (numeric reply) -> YES. Returns the sent messages.
  async function submitReflection(phone, deps, { lesson, wentWell, improvement, topicReply }) {
    await handleReflectionFlow(phone, 'REFLECT', null, deps.reflectionDeps);
    await handleReflectionFlow(phone, lesson, null, deps.reflectionDeps);
    await handleReflectionFlow(phone, wentWell, null, deps.reflectionDeps);
    await handleReflectionFlow(phone, improvement, null, deps.reflectionDeps);
    await handleReflectionFlow(phone, topicReply, null, deps.reflectionDeps);
    return handleReflectionFlow(phone, 'YES', null, deps.reflectionDeps);
  }

  // Drives a full NEW GOAL conversation: goal -> topic (numeric reply) -> YES.
  async function submitGrowthPlan(phone, deps, { goal, topicReply }) {
    await handleGrowthPlanFlow(phone, 'NEW GOAL', null, deps.growthPlanDeps);
    await handleGrowthPlanFlow(phone, goal, null, deps.growthPlanDeps);
    await handleGrowthPlanFlow(phone, topicReply, null, deps.growthPlanDeps);
    return handleGrowthPlanFlow(phone, 'YES', null, deps.growthPlanDeps);
  }

  // "1" = TOPIC_CLASSROOM_MANAGEMENT, "2" = TOPIC_ASSESSMENT — matches the
  // ascending-order numbering verified in tests/qmsTopicSelection.test.js.
  const TOPIC_1_REPLY = '1';
  const TOPIC_2_REPLY = '2';

  // ═══════════════════════════════════════════════════════════════════
  // W-01: reflection -> growth plan -> MY COACHING -> recommendation
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── W-01: full happy-path workflow ──────────────────────');
  {
    const PHONE = '+27831110001';
    seedTeacher(PHONE);
    const deps = buildDeps(PHONE);

    // 3 reflections on the same topic — meets MIN_REFLECTIONS_FOR_SUFFICIENT_DATA.
    for (let i = 0; i < 3; i++) {
      await submitReflection(PHONE, deps, {
        lesson: `Lesson ${i}`,
        wentWell: `Went well ${i}`,
        improvement: `Improvement ${i}`,
        topicReply: TOPIC_1_REPLY,
      });
    }

    // 1 active growth plan on the same topic — meets
    // MIN_ACTIVE_GROWTH_PLANS_FOR_SUFFICIENT_DATA.
    await submitGrowthPlan(PHONE, deps, {
      goal: 'Improve classroom routines',
      topicReply: TOPIC_1_REPLY,
    });

    deps.sentMessages.length = 0; // clear noise from the setup turns above
    const handled = await handleQmsFlow(PHONE, 'MY COACHING', deps.qmsDeps);

    assert(handled === true, 'MY COACHING is handled');
    assert(deps.sentMessages.length === 1, 'exactly one WhatsApp reply sent');
    const reply = deps.sentMessages[0].text;
    assertIncludes(reply, 'Classroom Management', 'recommendation names the correct topic');
    assertIncludes(reply, 'Confidence:', 'recommendation includes a confidence label');
    assertIncludes(reply, 'NEW GOAL', 'reply points teacher toward NEW GOAL');

    // Persistence sanity: the underlying rows actually exist with the
    // expected topic_id, not just an in-memory illusion.
    const reflectionCount = db.prepare(
      `SELECT COUNT(*) AS n FROM qms_reflections WHERE phone_hash = ? AND topic_id = 'TOPIC_CLASSROOM_MANAGEMENT'`
    ).get(hashPhone(PHONE)).n;
    assert(reflectionCount === 3, 'all 3 reflections persisted with the correct topic_id');

    const growthPlanCount = db.prepare(
      `SELECT COUNT(*) AS n FROM qms_growth_plans WHERE phone_hash = ? AND topic_id = 'TOPIC_CLASSROOM_MANAGEMENT' AND status = 'active'`
    ).get(hashPhone(PHONE)).n;
    assert(growthPlanCount === 1, 'the active growth plan persisted with the correct topic_id');

    // Trend classification (ADR-016/PR39): the 3 same-topic reflections
    // above each trigger recordSnapshotsForTeacher() on creation, so by
    // the time MY COACHING runs, a prior snapshot already exists for
    // TOPIC_CLASSROOM_MANAGEMENT. getLatestTrend() should therefore
    // return status:'trend' (not 'baseline') for this call — this
    // proves the real MY COACHING -> qmsFlow -> coachingEngineService ->
    // coachingTrendService integration actually reached trend
    // classification, not just that the machinery executed unchecked.
    // Deliberately calling getLatestTrend() with the same real DB state
    // MY COACHING just read, rather than re-deriving the math here (that
    // belongs to coachingTrendService.test.js) — this only confirms the
    // integration's resulting state matches what the reply implied.
    const trendAfterCoaching = getLatestTrend(hashPhone(PHONE), 'TOPIC_CLASSROOM_MANAGEMENT');
    assert(trendAfterCoaching.status === 'trend', 'MY COACHING ran with a prior snapshot in place, so trend classification (not baseline) was reached');
    assert(
      ['rising', 'falling', 'flat'].includes(trendAfterCoaching.trendDirection),
      'a concrete trend direction was computed, not left undefined'
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // W-02: insufficient evidence -> MY COACHING returns insufficient-data
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── W-02: insufficient evidence ──────────────────────────');
  {
    const PHONE = '+27831110002';
    seedTeacher(PHONE);
    const deps = buildDeps(PHONE);

    // Only 2 reflections — one short of MIN_REFLECTIONS_FOR_SUFFICIENT_DATA.
    for (let i = 0; i < 2; i++) {
      await submitReflection(PHONE, deps, {
        lesson: `Lesson ${i}`,
        wentWell: `Went well ${i}`,
        improvement: `Improvement ${i}`,
        topicReply: TOPIC_1_REPLY,
      });
    }

    deps.sentMessages.length = 0;
    const handled = await handleQmsFlow(PHONE, 'MY COACHING', deps.qmsDeps);

    assert(handled === true, 'MY COACHING is still handled with too little data');
    assertIncludes(deps.sentMessages[0].text, 'Not enough tagged reflections', 'insufficient-data guidance shown');
  }

  // ═══════════════════════════════════════════════════════════════════
  // W-03: multiple reflections on the same topic increase confidence
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── W-03: more evidence -> higher confidence ─────────────');
  {
    const PHONE_FEW = '+27831110003';
    const PHONE_MANY = '+27831110004';
    seedTeacher(PHONE_FEW);
    seedTeacher(PHONE_MANY);
    const depsFew = buildDeps(PHONE_FEW);
    const depsMany = buildDeps(PHONE_MANY);

    // Minimum viable: 3 reflections + 1 active growth plan.
    for (let i = 0; i < 3; i++) {
      await submitReflection(PHONE_FEW, depsFew, {
        lesson: `Lesson ${i}`, wentWell: `Went well ${i}`, improvement: `Improvement ${i}`,
        topicReply: TOPIC_1_REPLY,
      });
    }
    await submitGrowthPlan(PHONE_FEW, depsFew, { goal: 'Goal', topicReply: TOPIC_1_REPLY });

    // More evidence: 6 reflections + 1 active growth plan, same topic.
    for (let i = 0; i < 6; i++) {
      await submitReflection(PHONE_MANY, depsMany, {
        lesson: `Lesson ${i}`, wentWell: `Went well ${i}`, improvement: `Improvement ${i}`,
        topicReply: TOPIC_1_REPLY,
      });
    }
    await submitGrowthPlan(PHONE_MANY, depsMany, { goal: 'Goal', topicReply: TOPIC_1_REPLY });

    const insightsFew = getCoachingInsights(hashPhone(PHONE_FEW));
    const insightsMany = getCoachingInsights(hashPhone(PHONE_MANY));

    assert(insightsFew.status === 'ok' && insightsMany.status === 'ok', 'both teachers clear the guard');
    assert(
      insightsMany.recommendations[0].confidence >= insightsFew.recommendations[0].confidence,
      'more supporting evidence never produces a lower confidence score'
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // W-04: stale/retired topic_id is ignored end-to-end
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── W-04: stale topic_id ignored end-to-end ──────────────');
  {
    const PHONE = '+27831110005';
    const phoneHash = seedTeacher(PHONE);
    const deps = buildDeps(PHONE);

    for (let i = 0; i < 3; i++) {
      await submitReflection(PHONE, deps, {
        lesson: `Lesson ${i}`, wentWell: `Went well ${i}`, improvement: `Improvement ${i}`,
        topicReply: TOPIC_1_REPLY,
      });
    }
    await submitGrowthPlan(PHONE, deps, { goal: 'Goal', topicReply: TOPIC_1_REPLY });

    // Directly insert a row with a topicId that no longer exists in the
    // active taxonomy (simulating a retired topic on old data), bypassing
    // createReflection()'s own validation since that's the whole point —
    // this row predates the taxonomy change.
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO qms_reflections (phone_hash, term, content, topic_id, ai_assisted, evidence_link_ids, created_at, updated_at)
      VALUES (?, ?, ?, 'TOPIC_RETIRED_DOES_NOT_EXIST', 0, '[]', ?, ?)
    `).run(phoneHash, CURRENT_TERM, 'Stale-topic reflection', now, now);

    deps.sentMessages.length = 0;
    const handled = await handleQmsFlow(PHONE, 'MY COACHING', deps.qmsDeps);

    assert(handled === true, 'MY COACHING resolves normally despite the stale row');
    assertIncludes(deps.sentMessages[0].text, 'Classroom Management', 'the real, validly-tagged topic still surfaces');
    assert(!deps.sentMessages[0].text.includes('TOPIC_RETIRED_DOES_NOT_EXIST'), 'the stale topicId itself never leaks into the reply');
  }

  // ═══════════════════════════════════════════════════════════════════
  // W-05: ownership isolation between two teachers
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── W-05: ownership isolation ─────────────────────────────');
  {
    const PHONE_A = '+27831110006';
    const PHONE_B = '+27831110007';
    seedTeacher(PHONE_A);
    seedTeacher(PHONE_B);
    const depsA = buildDeps(PHONE_A);
    const depsB = buildDeps(PHONE_B);

    for (let i = 0; i < 3; i++) {
      await submitReflection(PHONE_A, depsA, {
        lesson: `A Lesson ${i}`, wentWell: `A Went well ${i}`, improvement: `A Improvement ${i}`,
        topicReply: TOPIC_1_REPLY,
      });
    }
    await submitGrowthPlan(PHONE_A, depsA, { goal: 'A Goal', topicReply: TOPIC_1_REPLY });
    // Teacher B has zero reflections/growth plans of their own.

    depsA.sentMessages.length = 0;
    depsB.sentMessages.length = 0;

    await handleQmsFlow(PHONE_A, 'MY COACHING', depsA.qmsDeps);
    await handleQmsFlow(PHONE_B, 'MY COACHING', depsB.qmsDeps);

    assertIncludes(depsA.sentMessages[0].text, 'Classroom Management', "teacher A sees their own recommendation");
    assertIncludes(depsB.sentMessages[0].text, 'Not enough tagged reflections', "teacher B is not handed teacher A's data");
  }

  // ═══════════════════════════════════════════════════════════════════
  // W-06: repeated workflow remains deterministic
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── W-06: repeated MY COACHING calls are deterministic ────');
  {
    const PHONE = '+27831110008';
    seedTeacher(PHONE);
    const deps = buildDeps(PHONE);

    for (let i = 0; i < 3; i++) {
      await submitReflection(PHONE, deps, {
        lesson: `Lesson ${i}`, wentWell: `Went well ${i}`, improvement: `Improvement ${i}`,
        topicReply: TOPIC_1_REPLY,
      });
    }
    await submitGrowthPlan(PHONE, deps, { goal: 'Goal', topicReply: TOPIC_1_REPLY });

    deps.sentMessages.length = 0;
    await handleQmsFlow(PHONE, 'MY COACHING', deps.qmsDeps);
    await handleQmsFlow(PHONE, 'MY COACHING', deps.qmsDeps);
    await handleQmsFlow(PHONE, 'MY COACHING', deps.qmsDeps);

    assert(deps.sentMessages.length === 3, 'three replies sent, one per call');
    const [first, second, third] = deps.sentMessages.map((m) => m.text);
    assert(first === second && second === third, 'repeated calls against unchanged data produce byte-identical replies');
  }

  // ═══════════════════════════════════════════════════════════════════
  // W-07: recommendation ordering is deterministic regardless of
  // reflection/growth-plan insertion order across topics
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── W-07: cross-topic ordering is deterministic ───────────');
  {
    const PHONE_ORDER_A = '+27831110009';
    const PHONE_ORDER_B = '+27831110010';
    seedTeacher(PHONE_ORDER_A);
    seedTeacher(PHONE_ORDER_B);
    const depsA = buildDeps(PHONE_ORDER_A);
    const depsB = buildDeps(PHONE_ORDER_B);

    // Teacher A: topic 1 first (more evidence), then topic 2 (less evidence).
    for (let i = 0; i < 4; i++) {
      await submitReflection(PHONE_ORDER_A, depsA, {
        lesson: `T1 Lesson ${i}`, wentWell: `T1 Went well ${i}`, improvement: `T1 Improvement ${i}`,
        topicReply: TOPIC_1_REPLY,
      });
    }
    await submitGrowthPlan(PHONE_ORDER_A, depsA, { goal: 'T1 Goal', topicReply: TOPIC_1_REPLY });
    for (let i = 0; i < 3; i++) {
      await submitReflection(PHONE_ORDER_A, depsA, {
        lesson: `T2 Lesson ${i}`, wentWell: `T2 Went well ${i}`, improvement: `T2 Improvement ${i}`,
        topicReply: TOPIC_2_REPLY,
      });
    }
    await submitGrowthPlan(PHONE_ORDER_A, depsA, { goal: 'T2 Goal', topicReply: TOPIC_2_REPLY });

    // Teacher B: identical evidence counts, but topic 2 entered first.
    for (let i = 0; i < 3; i++) {
      await submitReflection(PHONE_ORDER_B, depsB, {
        lesson: `T2 Lesson ${i}`, wentWell: `T2 Went well ${i}`, improvement: `T2 Improvement ${i}`,
        topicReply: TOPIC_2_REPLY,
      });
    }
    await submitGrowthPlan(PHONE_ORDER_B, depsB, { goal: 'T2 Goal', topicReply: TOPIC_2_REPLY });
    for (let i = 0; i < 4; i++) {
      await submitReflection(PHONE_ORDER_B, depsB, {
        lesson: `T1 Lesson ${i}`, wentWell: `T1 Went well ${i}`, improvement: `T1 Improvement ${i}`,
        topicReply: TOPIC_1_REPLY,
      });
    }
    await submitGrowthPlan(PHONE_ORDER_B, depsB, { goal: 'T1 Goal', topicReply: TOPIC_1_REPLY });

    const insightsA = getCoachingInsights(hashPhone(PHONE_ORDER_A));
    const insightsB = getCoachingInsights(hashPhone(PHONE_ORDER_B));

    const orderA = insightsA.recommendations.map((r) => r.topicId);
    const orderB = insightsB.recommendations.map((r) => r.topicId);

    assert(orderA.length === 2 && orderB.length === 2, 'both teachers have two topics with evidence');
    assert(
      JSON.stringify(orderA) === JSON.stringify(orderB),
      'recommendation ordering depends only on the evidence itself, not the order it was entered in'
    );
    assert(orderA[0] === 'TOPIC_CLASSROOM_MANAGEMENT', 'the topic with more supporting evidence ranks first');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`qmsCoachingWorkflow.test.js Results: ${passed} passed, ${failed} failed`);

  try { db.close(); } catch (_) {}
  try {
    if (fs.existsSync(process.env.DB_PATH)) fs.unlinkSync(process.env.DB_PATH);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[test cleanup] could not remove ${process.env.DB_PATH}: ${err.code}`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
