'use strict';

const { handleReflectionFlow } = require('../flows/reflectionFlow');

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

function assertContains(haystack, needle, message) {
  assert(typeof haystack === 'string' && haystack.includes(needle), message);
}

function assertNotContains(haystack, needle, message) {
  assert(typeof haystack === 'string' && !haystack.includes(needle), message);
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
 * shape reflectionFlow.js expects, with per-phoneHash isolation.
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
  const reflectionState = createSessionStore();
  const safeSendMessage = createMockFn(() => Promise.resolve(undefined));
  const parseIntent = createMockFn(() => ({ type: 'reflection' }));
  const hashPhone = createMockFn((from) => `hash:${from}`);
  const createReflection = createMockFn(() => ({ id: 1 }));
  const getCurrentTerm = createMockFn(() => 2);

  return {
    reflectionState,
    safeSendMessage,
    parseIntent,
    hashPhone,
    createReflection,
    getCurrentTerm,
    ...overrides,
  };
}

async function runHappyPathUpTo(deps, from, step) {
  // 'REFLECT' triggers entry (parseIntent mocked to return reflection)
  await handleReflectionFlow(from, 'REFLECT', null, deps);
  if (step === 'entry') return;

  await handleReflectionFlow(from, 'Fractions Grade 6', null, deps); // lesson
  if (step === 'awaitingWentWell') return;

  await handleReflectionFlow(from, 'Learners understood equivalent fractions.', null, deps); // went well
  if (step === 'awaitingImprovement') return;

  await handleReflectionFlow(from, 'More practical examples.', null, deps); // improvement -> reviewSummary
}

async function run() {
  console.log('reflectionFlow tests');
  console.log('='.repeat(60));

  // ── happy path ─────────────────────────────────────────────
  console.log('\n── happy path ──');
  {
    const deps = createDeps();
    const from = '+27000000001';

    await runHappyPathUpTo(deps, from, 'reviewSummary');
    await handleReflectionFlow(from, 'YES', null, deps);

    assert(deps.createReflection.callCount() === 1, 'collects all three fields and calls createReflection exactly once on YES');
    const [phoneHash, payload] = deps.createReflection.calls[0];

    assertEqual(phoneHash, 'hash:+27000000001', 'phoneHash passed to createReflection is correct');
    assertEqual(payload.term, 2, 'term is carried through from getCurrentTerm');
    assertEqual(payload.aiAssisted, false, 'aiAssisted defaults to false');
    assertEqual(payload.evidenceLinkIds, [], 'evidenceLinkIds defaults to empty array');
    assertContains(payload.content, 'Lesson:\nFractions Grade 6', 'content includes the lesson field');
    assertContains(payload.content, 'What went well:\nLearners understood equivalent fractions.', 'content includes the went-well field');
    assertContains(payload.content, 'What I would improve:\nMore practical examples.', 'content includes the improvement field');

    assert(deps.reflectionState.get('hash:+27000000001') === null, 'state is cleared after save');
  }

  // ── correction path ────────────────────────────────────────
  console.log('\n── correction path ──');
  {
    const deps = createDeps();
    const from = '+27000000002';

    await runHappyPathUpTo(deps, from, 'reviewSummary');
    await handleReflectionFlow(from, 'NO', null, deps); // -> awaitingCorrectionChoice
    await handleReflectionFlow(from, '1', null, deps); // choose Lesson -> awaitingLesson (correcting)
    await handleReflectionFlow(from, 'Fractions Grade 7 (corrected)', null, deps); // -> back to reviewSummary
    await handleReflectionFlow(from, 'YES', null, deps);

    assert(deps.createReflection.callCount() === 1, 'saves exactly once after a correction');
    const [, payload] = deps.createReflection.calls[0];

    assertContains(payload.content, 'Lesson:\nFractions Grade 7 (corrected)', 'content reflects the corrected lesson field');
    assertContains(payload.content, 'What went well:\nLearners understood equivalent fractions.', 'went-well field untouched by the correction');
    assertContains(payload.content, 'What I would improve:\nMore practical examples.', 'improvement field untouched by the correction');
    assertNotContains(payload.content, 'Fractions Grade 6\n', 'original (pre-correction) lesson text is gone');
  }

  // ── cancel ─────────────────────────────────────────────────
  console.log('\n── cancel ──');
  const cancelSteps = [
    {
      name: 'awaitingLesson',
      drive: async (deps, from) => {
        await handleReflectionFlow(from, 'REFLECT', null, deps);
      },
    },
    {
      name: 'awaitingWentWell',
      drive: async (deps, from) => {
        await handleReflectionFlow(from, 'REFLECT', null, deps);
        await handleReflectionFlow(from, 'Lesson text', null, deps);
      },
    },
    {
      name: 'awaitingImprovement',
      drive: async (deps, from) => {
        await handleReflectionFlow(from, 'REFLECT', null, deps);
        await handleReflectionFlow(from, 'Lesson text', null, deps);
        await handleReflectionFlow(from, 'Went well text', null, deps);
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
        await handleReflectionFlow(from, 'NO', null, deps);
      },
    },
  ];

  for (const { name, drive } of cancelSteps) {
    const deps = createDeps();
    const from = '+27000000003';

    await drive(deps, from);
    await handleReflectionFlow(from, 'CANCEL', null, deps);

    assert(deps.createReflection.callCount() === 0, `cancels cleanly from ${name} without ever saving`);
    assert(deps.reflectionState.get('hash:+27000000003') === null, `state is cleared after CANCEL from ${name}`);
  }

  // ── timeout ────────────────────────────────────────────────
  console.log('\n── timeout ──');
  {
    const deps = createDeps();
    const from = '+27000000004';
    const phoneHash = 'hash:+27000000004';

    deps.reflectionState.set(phoneHash, {
      step: 'awaitingLesson',
      lastActivity: Date.now() - 31 * 60 * 1000,
    });

    const handled = await handleReflectionFlow(from, 'some text', null, deps);

    assert(handled === false, 'drops stale state and does not treat the message as handled');
    assert(deps.reflectionState.get(phoneHash) === null, 'stale state is removed');
  }

  // ── session isolation ──────────────────────────────────────
  console.log('\n── session isolation ──');
  {
    const deps = createDeps();
    const teacherA = '+27000000005';
    const teacherB = '+27000000006';

    await handleReflectionFlow(teacherA, 'REFLECT', null, deps);
    await handleReflectionFlow(teacherA, 'Teacher A lesson', null, deps);

    await handleReflectionFlow(teacherB, 'REFLECT', null, deps);
    await handleReflectionFlow(teacherB, 'Teacher B lesson', null, deps);

    const stateA = deps.reflectionState.get('hash:+27000000005');
    const stateB = deps.reflectionState.get('hash:+27000000006');

    assertEqual(stateA.lesson, 'Teacher A lesson', "teacher A's in-progress lesson is correct");
    assertEqual(stateB.lesson, 'Teacher B lesson', "teacher B's in-progress lesson is correct");
    assert(stateA.lesson !== stateB.lesson, "keeps two teachers' in-progress reflections independent");
  }

  // ── term unavailable ───────────────────────────────────────
  console.log('\n── term unavailable ──');
  {
    const deps = createDeps({ getCurrentTerm: createMockFn(() => null) });
    const from = '+27000000007';

    await runHappyPathUpTo(deps, from, 'reviewSummary');
    await handleReflectionFlow(from, 'YES', null, deps);

    assert(deps.createReflection.callCount() === 0, 'does not save when getCurrentTerm returns null');
    assert(deps.reflectionState.get('hash:+27000000007') === null, 'state is cleared even though the save was blocked');

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
    await handleReflectionFlow(from, 'maybe', null, deps);

    assert(deps.createReflection.callCount() === 0, 'an unrecognised confirmation reply does not save');

    const state = deps.reflectionState.get('hash:+27000000008');
    assertEqual(state.step, 'reviewSummary', 'stays on reviewSummary after an invalid reply');
    assertEqual(state.lesson, 'Fractions Grade 6', 'lesson field is preserved');
    assertEqual(state.wentWell, 'Learners understood equivalent fractions.', 'wentWell field is preserved');
    assertEqual(state.improvement, 'More practical examples.', 'improvement field is preserved');
  }

  console.log('\n' + '─'.repeat(55));
  console.log(`reflectionFlow.test.js Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error('Unexpected test runner error:', err);
  process.exitCode = 1;
});
