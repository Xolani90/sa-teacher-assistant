'use strict';

const { handleGrowthPlanFlow } = require('../flows/growthPlanFlow');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.log(`  ❌ FAILED: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    console.log(`     expected: ${JSON.stringify(expected)}`);
    console.log(`     actual:   ${JSON.stringify(actual)}`);
  }
  assert(ok, message);
}

function assertMatch(str, regex, message) {
  assert(typeof str === 'string' && regex.test(str), message);
}

/**
 * Minimal mock function tracker — replaces jest.fn() for plain-node execution.
 * Records calls and supports a fixed return value or a custom implementation.
 */
function createMockFn(implementation) {
  const calls = [];
  const fn = (...args) => {
    calls.push(args);
    return implementation ? implementation(...args) : undefined;
  };
  fn.calls = calls;
  fn.callCount = () => calls.length;
  return fn;
}

/**
 * Minimal in-memory SessionStore stand-in — mirrors the get/set/delete
 * shape growthPlanFlow.js expects, with per-phoneHash isolation.
 */
function createSessionStore() {
  const store = new Map();
  return {
    get: (phoneHash) => store.get(phoneHash) || null,
    set: (phoneHash, value) => store.set(phoneHash, value),
    delete: (phoneHash) => store.delete(phoneHash),
    __raw: store,
  };
}

function createDeps(overrides = {}) {
  const growthPlanState = createSessionStore();
  const safeSendMessage = createMockFn(() => Promise.resolve(undefined));
  const parseIntent = createMockFn(() => ({ type: 'growth_plan' }));
  const hashPhone = createMockFn((from) => `hash:${from}`);
  const createGrowthPlan = createMockFn(() => ({ id: 1 }));
  const getCurrentTerm = createMockFn(() => 2);

  return {
    growthPlanState,
    safeSendMessage,
    parseIntent,
    hashPhone,
    createGrowthPlan,
    getCurrentTerm,
    ...overrides,
  };
}

async function runHappyPathUpTo(deps, from, step) {
  // 'GROWTH PLAN' triggers entry (parseIntent mocked to return growth_plan)
  await handleGrowthPlanFlow(from, 'GROWTH PLAN', null, deps);
  if (step === 'entry') return;

  await handleGrowthPlanFlow(from, 'Improve questioning technique', null, deps); // goal
  if (step === 'awaitingTopic') return;

  await handleGrowthPlanFlow(from, '1', null, deps); // topicId -> reviewSummary
}

async function run() {
  console.log('growthPlanFlow tests');
  console.log('='.repeat(60));

  // ── happy path ─────────────────────────────────────────────
  console.log('\n── happy path ──');
  {
    const deps = createDeps();
    const from = '+27000000001';

    await runHappyPathUpTo(deps, from, 'reviewSummary');
    await handleGrowthPlanFlow(from, 'YES', null, deps);

    assert(deps.createGrowthPlan.callCount() === 1, 'collects both fields and calls createGrowthPlan exactly once on YES');
    const [phoneHash, payload] = deps.createGrowthPlan.calls[0];

    assertEqual(phoneHash, 'hash:+27000000001', 'phoneHash passed to createGrowthPlan is correct');
    assertEqual(payload.term, 2, 'term is carried through from getCurrentTerm');
    assertEqual(payload.status, 'active', 'status defaults to active on creation');
    assertEqual(payload.goalText, 'Improve questioning technique', 'goalText is the collected goal field');
    assertEqual(payload.topicId, 'TOPIC_CLASSROOM_MANAGEMENT', 'topicId is the resolved topic selection');

    assert(deps.growthPlanState.get('hash:+27000000001') === null, 'state is cleared after save');
  }

  // ── correction path ────────────────────────────────────────
  console.log('\n── correction path ──');
  {
    const deps = createDeps();
    const from = '+27000000002';

    await runHappyPathUpTo(deps, from, 'reviewSummary');
    await handleGrowthPlanFlow(from, 'NO', null, deps); // -> awaitingCorrectionChoice
    await handleGrowthPlanFlow(from, '1', null, deps); // choose Goal -> awaitingGoal (correcting)
    await handleGrowthPlanFlow(from, 'Improve questioning technique (corrected)', null, deps); // -> back to reviewSummary
    await handleGrowthPlanFlow(from, 'YES', null, deps);

    assert(deps.createGrowthPlan.callCount() === 1, 'saves exactly once after a correction');
    const [, payload] = deps.createGrowthPlan.calls[0];

    assertEqual(payload.goalText, 'Improve questioning technique (corrected)', 'goalText reflects the corrected value');
    assertEqual(payload.topicId, 'TOPIC_CLASSROOM_MANAGEMENT', 'topicId field untouched by the correction');
  }

  // ── cancel ─────────────────────────────────────────────────
  console.log('\n── cancel ──');
  const cancelSteps = [
    {
      name: 'awaitingGoal',
      drive: async (deps, from) => {
        await handleGrowthPlanFlow(from, 'GROWTH PLAN', null, deps);
      },
    },
    {
      name: 'awaitingTopic',
      drive: async (deps, from) => {
        await handleGrowthPlanFlow(from, 'GROWTH PLAN', null, deps);
        await handleGrowthPlanFlow(from, 'Goal text', null, deps);
      },
    },
    {
      name: 'reviewSummary',
      drive: async (deps, from) => {
        await runHappyPathUpTo(deps, from, 'reviewSummary');
      },
    },
    {
      name: 'awaitingCorrectionChoice',
      drive: async (deps, from) => {
        await runHappyPathUpTo(deps, from, 'reviewSummary');
        await handleGrowthPlanFlow(from, 'NO', null, deps);
      },
    },
  ];

  for (const { name, drive } of cancelSteps) {
    const deps = createDeps();
    const from = '+27000000003';

    await drive(deps, from);
    await handleGrowthPlanFlow(from, 'CANCEL', null, deps);

    assert(deps.createGrowthPlan.callCount() === 0, `cancels cleanly from ${name} without ever saving`);
    assert(deps.growthPlanState.get('hash:+27000000003') === null, `state is cleared after CANCEL from ${name}`);
  }

  // ── timeout ────────────────────────────────────────────────
  console.log('\n── timeout ──');
  {
    const deps = createDeps();
    const from = '+27000000004';
    const phoneHash = 'hash:+27000000004';

    deps.growthPlanState.set(phoneHash, {
      step: 'awaitingGoal',
      goalText: 'Improve questioning technique', // proves the discarded state, not just its shell, is stale
      lastActivity: Date.now() - 31 * 60 * 1000,
    });

    const handled = await handleGrowthPlanFlow(from, 'some text', null, deps);

    assert(handled === false, 'drops stale state and does not treat the message as handled');
    assert(deps.growthPlanState.get(phoneHash) === null, 'stale state is removed');
    assert(deps.createGrowthPlan.callCount() === 0, 'never persists anything when dropping a stale session');
    assert(deps.safeSendMessage.callCount() === 0, 'sends nothing back to the teacher when dropping a stale session');
  }

  console.log('\n── timeout boundary ──');
  {
    // Exactly at the threshold should NOT be treated as stale — the
    // check is strictly greater-than, so equal elapsed time must pass through.
    const deps = createDeps();
    const from = '+27000000009';
    const phoneHash = 'hash:+27000000009';

    deps.growthPlanState.set(phoneHash, {
      step: 'awaitingGoal',
      lastActivity: Date.now() - 30 * 60 * 1000,
    });

    const handled = await handleGrowthPlanFlow(from, 'Improve questioning technique', null, deps);

    assert(handled === true, 'treats a session exactly at the 30-minute boundary as still active');
    const state = deps.growthPlanState.get(phoneHash);
    assert(state !== null, 'state at the exact boundary is not dropped');
    assertEqual(state && state.step, 'awaitingTopic', 'session at the boundary continues to advance normally');
  }

  console.log('\n── fresh session after timeout ──');
  {
    // After a stale session is dropped (handled === false), the caller's
    // normal routing re-invokes with the same message so intent parsing
    // runs again and a brand-new session starts cleanly.
    const deps = createDeps();
    const from = '+27000000010';
    const phoneHash = 'hash:+27000000010';

    deps.growthPlanState.set(phoneHash, {
      step: 'reviewSummary',
      goalText: 'Old stale goal',
      topicId: 'TOPIC_OLD_STALE',
      lastActivity: Date.now() - 45 * 60 * 1000,
    });

    const droppedHandled = await handleGrowthPlanFlow(from, 'GROWTH PLAN', null, deps);
    assert(droppedHandled === false, 'first call on a stale session only drops it and reports unhandled');

    const restartHandled = await handleGrowthPlanFlow(from, 'GROWTH PLAN', null, deps);
    assert(restartHandled === true, 'a subsequent call starts a brand-new session');

    const state = deps.growthPlanState.get(phoneHash);
    assertEqual(state && state.step, 'awaitingGoal', 'new session starts at awaitingGoal, not mid-flow');
    assert(!('goalText' in (state || {})), 'no leftover fields survive from the stale session');
  }

  // ── session isolation ──────────────────────────────────────
  console.log('\n── session isolation ──');
  {
    const deps = createDeps();
    const teacherA = '+27000000005';
    const teacherB = '+27000000006';

    await handleGrowthPlanFlow(teacherA, 'GROWTH PLAN', null, deps);
    await handleGrowthPlanFlow(teacherA, 'Teacher A goal', null, deps);

    await handleGrowthPlanFlow(teacherB, 'GROWTH PLAN', null, deps);
    await handleGrowthPlanFlow(teacherB, 'Teacher B goal', null, deps);

    const stateA = deps.growthPlanState.get('hash:+27000000005');
    const stateB = deps.growthPlanState.get('hash:+27000000006');

    assertEqual(stateA.goalText, 'Teacher A goal', "teacher A's in-progress goal is correct");
    assertEqual(stateB.goalText, 'Teacher B goal', "teacher B's in-progress goal is correct");
    assert(stateA.goalText !== stateB.goalText, "keeps two teachers' in-progress growth plans independent");
  }

  // ── term unavailable ───────────────────────────────────────
  console.log('\n── term unavailable ──');
  {
    const deps = createDeps({ getCurrentTerm: createMockFn(() => null) });
    const from = '+27000000007';

    await runHappyPathUpTo(deps, from, 'reviewSummary');
    await handleGrowthPlanFlow(from, 'YES', null, deps);

    assert(deps.createGrowthPlan.callCount() === 0, 'does not save when getCurrentTerm returns null');
    assert(deps.growthPlanState.get('hash:+27000000007') === null, 'state is cleared even though the save was blocked');

    const lastCall = deps.safeSendMessage.calls[deps.safeSendMessage.calls.length - 1];
    const lastMessage = lastCall[1];
    assertMatch(lastMessage, /couldn't determine the current school term/i, 'tells the teacher the term could not be determined');
  }

  // ── invalid confirmation reply ─────────────────────────────
  console.log('\n── invalid confirmation reply ──');
  {
    const deps = createDeps();
    const from = '+27000000008';

    await runHappyPathUpTo(deps, from, 'reviewSummary');
    await handleGrowthPlanFlow(from, 'maybe', null, deps);

    assert(deps.createGrowthPlan.callCount() === 0, 'an unrecognised confirmation reply does not save');

    const state = deps.growthPlanState.get('hash:+27000000008');
    assertEqual(state.step, 'reviewSummary', 'stays on reviewSummary after an invalid reply');
    assertEqual(state.goalText, 'Improve questioning technique', 'goalText field is preserved');
    assertEqual(state.topicId, 'TOPIC_CLASSROOM_MANAGEMENT', 'topicId field is preserved');
  }

  // ── invalid topic selection reply ──────────────────────────
  console.log('\n── invalid topic selection reply ──');
  {
    const deps = createDeps();
    const from = '+27000000012';
    const phoneHash = 'hash:+27000000012';

    await handleGrowthPlanFlow(from, 'GROWTH PLAN', null, deps);
    await handleGrowthPlanFlow(from, 'Improve questioning technique', null, deps); // -> awaitingTopic
    await handleGrowthPlanFlow(from, '99', null, deps); // out-of-range reply

    const state = deps.growthPlanState.get(phoneHash);
    assertEqual(state.step, 'awaitingTopic', 'stays on awaitingTopic after an out-of-range reply');
    assert(deps.createGrowthPlan.callCount() === 0, 'does not save on an invalid topic reply');

    await handleGrowthPlanFlow(from, '1', null, deps); // now valid
    const advanced = deps.growthPlanState.get(phoneHash);
    assertEqual(advanced.step, 'reviewSummary', 'advances to reviewSummary once a valid topic reply is sent');
    assertEqual(advanced.topicId, 'TOPIC_CLASSROOM_MANAGEMENT', 'valid reply resolves to the correct topicId');
  }

  // ── save failure ───────────────────────────────────────────
  console.log('\n── save failure ──');
  {
    const deps = createDeps({
      createGrowthPlan: createMockFn(() => {
        throw new Error('db unavailable');
      }),
    });
    const from = '+27000000011';

    await runHappyPathUpTo(deps, from, 'reviewSummary');
    await handleGrowthPlanFlow(from, 'YES', null, deps);

    assert(deps.growthPlanState.get('hash:+27000000011') === null, 'state is cleared even though the save failed');

    const lastCall = deps.safeSendMessage.calls[deps.safeSendMessage.calls.length - 1];
    const lastMessage = lastCall[1];
    assertMatch(lastMessage, /couldn't save that growth plan/i, 'tells the teacher the save failed');
  }

  console.log('\n' + '─'.repeat(55));
  console.log(`growthPlanFlow.test.js Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error('Unexpected test runner error:', err);
  process.exitCode = 1;
});
