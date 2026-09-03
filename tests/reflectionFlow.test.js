'use strict';

const { handleReflectionFlow } = require('../flows/reflectionFlow');
const navigationService = require('../services/navigationService');

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

function createSessionStore() {
  const store = new Map();
  return {
    get: (phoneHash) => store.get(phoneHash) || null,
    set: (phoneHash, value) => store.set(phoneHash, value),
    delete: (phoneHash) => store.delete(phoneHash),
    __raw: store,
  };
}

// Mirrors the reflection FlowDefinition registered in routes/webhook.js
// (id, capabilities, menus, hooks). Kept byte-for-byte in sync with that
// registration per ADR-019's "Known technical debt" section — until
// registration is extracted into shared infrastructure, this duplication
// is intentional and any change to one side must be mirrored in the other.
//
// registerFlow() is idempotent (re-registering an id overwrites the
// previous definition), so calling this once per test — each with its
// own fresh reflectionState — safely rebinds hooks.cleanup/describeStatus
// to that test's own state instance without leaking between tests.
function registerReflectionFlow(reflectionState) {
  function describeReflectionStatus(phoneHash) {
    const state = reflectionState.get(phoneHash);
    if (!state) return null;

    const stepLabels = {
      awaitingLesson: 'waiting for the lesson',
      awaitingWentWell: 'waiting for what went well',
      awaitingImprovement: 'waiting for what you would improve',
      awaitingTopic: 'waiting for the topic',
      reviewSummary: 'reviewing before save',
      awaitingCorrectionChoice: 'choosing what to correct',
    };
    const stepLabel = stepLabels[state.step] || state.step;

    return (
      `📝 *Reflection in progress* — ${stepLabel}.\n` +
      `Reply *CANCEL* to discard, or continue where you left off.`
    );
  }

  navigationService.registerFlow({
    id: 'reflection',
    commands: [],
    capabilities: { status: true, cancel: true, back: false, menus: true },
    menus: {
      correctionChoice: ['Lesson', 'What went well', 'What I would improve', 'Topic', 'Cancel'],
    },
    hooks: {
      cleanup: (phoneHash) => reflectionState.delete(phoneHash),
      describeStatus: describeReflectionStatus,
    },
  });
}

function createDeps(overrides = {}) {
  const reflectionState = createSessionStore();
  const safeSendMessage = createMockFn(() => Promise.resolve(undefined));
  const parseIntent = createMockFn(() => ({ type: 'reflection' }));
  const hashPhone = createMockFn((from) => `hash:${from}`);
  const createReflection = createMockFn(() => ({ id: 1 }));
  const getCurrentTerm = createMockFn(() => 2);

  // Without this, NavigationService's registry is empty under test and
  // reflectionFlow.js's unguarded `getFlowDefinition('reflection').hooks.*`
  // calls throw "Cannot read properties of null (reading 'hooks')" the
  // moment CANCEL or STATUS is exercised (same fix as growthPlanFlow.test.js).
  registerReflectionFlow(reflectionState);

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
  await handleReflectionFlow(from, 'REFLECT', null, deps);
  if (step === 'entry') return;

  await handleReflectionFlow(from, 'Fractions Grade 6', null, deps); // lesson
  if (step === 'awaitingWentWell') return;

  await handleReflectionFlow(from, 'Learners understood equivalent fractions.', null, deps); // went well
  if (step === 'awaitingImprovement') return;

  await handleReflectionFlow(from, 'More practical examples.', null, deps); // improvement -> awaitingTopic
  if (step === 'awaitingTopic') return;

  await handleReflectionFlow(from, '1', null, deps); // topic -> reviewSummary
}

async function run() {
  console.log('reflectionFlow tests');
  console.log('='.repeat(60));

  console.log('\n── PR31a regression: first-prompt equivalence ──');
  {
    const depsA = createDeps();
    const depsB = createDeps();

    await handleReflectionFlow('+27000000101', 'REFLECT', null, depsA);
    await handleReflectionFlow('+27000000102', 'reflect on my lesson', null, depsB);

    const messageA = depsA.safeSendMessage.calls[0][1];
    const messageB = depsB.safeSendMessage.calls[0][1];

    assertEqual(messageA, messageB, 'REFLECT and "reflect on my lesson" produce identical first prompts');
    assertMatch(messageA, /what lesson is this reflection about/i, 'first prompt is the lesson prompt, unaffected by topic insertion');

    const stateA = depsA.reflectionState.get('hash:+27000000101');
    assertEqual(stateA.step, 'awaitingLesson', 'reflection still begins at awaitingLesson, no topic prompt beforehand');
  }

  console.log('\n── happy path ──');
  {
    const deps = createDeps();
    const from = '+27000000001';

    await runHappyPathUpTo(deps, from, 'reviewSummary');
    await handleReflectionFlow(from, 'YES', null, deps);

    assert(deps.createReflection.callCount() === 1, 'collects all fields and calls createReflection exactly once on YES');
    const [phoneHash, payload] = deps.createReflection.calls[0];

    assertEqual(phoneHash, 'hash:+27000000001', 'phoneHash passed to createReflection is correct');
    assertEqual(payload.term, 2, 'term is carried through from getCurrentTerm');
    assertEqual(payload.aiAssisted, false, 'aiAssisted defaults to false');
    assertEqual(payload.evidenceLinkIds, [], 'evidenceLinkIds defaults to empty array');
    assertEqual(payload.topicId, 'TOPIC_CLASSROOM_MANAGEMENT', 'topicId is the resolved topic selection');
    assertContains(payload.content, 'Lesson:\nFractions Grade 6', 'content includes the lesson field');
    assertContains(payload.content, 'What went well:\nLearners understood equivalent fractions.', 'content includes the went-well field');
    assertContains(payload.content, 'What I would improve:\nMore practical examples.', 'content includes the improvement field');

    assert(deps.reflectionState.get('hash:+27000000001') === null, 'state is cleared after save');
  }

  console.log('\n── awaitingTopic follows awaitingImprovement ──');
  {
    const deps = createDeps();
    const from = '+27000000013';

    await runHappyPathUpTo(deps, from, 'awaitingTopic');
    const state = deps.reflectionState.get('hash:+27000000013');
    assertEqual(state.step, 'awaitingTopic', 'flow reaches awaitingTopic immediately after improvement is collected');

    const lastMessage = deps.safeSendMessage.calls[deps.safeSendMessage.calls.length - 1][1];
    assertMatch(lastMessage, /which coaching area/i, 'awaitingTopic prompt asks for a coaching area');
  }

  console.log('\n── review summary displays selected topic ──');
  {
    const deps = createDeps();
    const from = '+27000000014';

    await runHappyPathUpTo(deps, from, 'reviewSummary');
    const lastMessage = deps.safeSendMessage.calls[deps.safeSendMessage.calls.length - 1][1];
    assertContains(lastMessage, 'Classroom Management', 'review summary displays the selected topic label');
  }

  console.log('\n── invalid topic selection reply ──');
  {
    const deps = createDeps();
    const from = '+27000000015';
    const phoneHash = 'hash:+27000000015';

    await runHappyPathUpTo(deps, from, 'awaitingTopic');
    await handleReflectionFlow(from, '99', null, deps); // out-of-range

    let state = deps.reflectionState.get(phoneHash);
    assertEqual(state.step, 'awaitingTopic', 'stays on awaitingTopic after an out-of-range reply');
    assert(deps.createReflection.callCount() === 0, 'does not save on an invalid topic reply');

    await handleReflectionFlow(from, '1', null, deps); // now valid
    state = deps.reflectionState.get(phoneHash);
    assertEqual(state.step, 'reviewSummary', 'advances to reviewSummary once a valid topic reply is sent');
    assertEqual(state.topicId, 'TOPIC_CLASSROOM_MANAGEMENT', 'valid reply resolves to the correct topicId');
  }

  console.log('\n── correction path (content field) ──');
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
    assertEqual(payload.topicId, 'TOPIC_CLASSROOM_MANAGEMENT', 'topic survives a correction cycle on a different field');
  }

  console.log('\n── correction path (topic field) ──');
  {
    const deps = createDeps();
    const from = '+27000000016';
    const phoneHash = 'hash:+27000000016';

    await runHappyPathUpTo(deps, from, 'reviewSummary');
    await handleReflectionFlow(from, 'NO', null, deps); // -> awaitingCorrectionChoice

    const menuMessage = deps.safeSendMessage.calls[deps.safeSendMessage.calls.length - 1][1];
    assertContains(menuMessage, '4. Topic', 'correction menu shows Topic as option 4');
    assertContains(menuMessage, '5. Cancel', 'correction menu shows Cancel as option 5');

    await handleReflectionFlow(from, '4', null, deps); // choose Topic -> awaitingTopic (correcting)
    let state = deps.reflectionState.get(phoneHash);
    assertEqual(state.step, 'awaitingTopic', 'selecting Topic returns to awaitingTopic');

    await handleReflectionFlow(from, '2', null, deps); // pick a different topic
    state = deps.reflectionState.get(phoneHash);
    assertEqual(state.step, 'reviewSummary', 'returns to reviewSummary after correcting the topic');
    assertEqual(state.topicId, 'TOPIC_ASSESSMENT', 'topicId reflects the corrected selection');
    assertEqual(state.lesson, 'Fractions Grade 6', 'other fields untouched by a topic-only correction');

    await handleReflectionFlow(from, 'YES', null, deps);
    const [, payload] = deps.createReflection.calls[0];
    assertEqual(payload.topicId, 'TOPIC_ASSESSMENT', 'corrected topicId is what gets persisted');
  }

  console.log('\n── correction menu: Cancel now option 5 ──');
  {
    const deps = createDeps();
    const from = '+27000000017';
    const phoneHash = 'hash:+27000000017';

    await runHappyPathUpTo(deps, from, 'reviewSummary');
    await handleReflectionFlow(from, 'NO', null, deps);

    await handleReflectionFlow(from, '4', null, deps);
    assert(deps.reflectionState.get(phoneHash) !== null, 'replying "4" no longer cancels — session is still active');
    assertEqual(deps.reflectionState.get(phoneHash).step, 'awaitingTopic', 'replying "4" now routes to Topic correction');

    await handleReflectionFlow(from, '1', null, deps);
    await handleReflectionFlow(from, 'NO', null, deps);
    await handleReflectionFlow(from, '5', null, deps);
    assert(deps.reflectionState.get(phoneHash) === null, 'replying "5" cancels the reflection');
    assert(deps.createReflection.callCount() === 0, 'cancelling never saves');
  }

  console.log('\n── cancel ──');
  const cancelSteps = [
    { name: 'awaitingLesson', drive: async (deps, from) => { await handleReflectionFlow(from, 'REFLECT', null, deps); } },
    { name: 'awaitingWentWell', drive: async (deps, from) => {
      await handleReflectionFlow(from, 'REFLECT', null, deps);
      await handleReflectionFlow(from, 'Lesson text', null, deps);
    } },
    { name: 'awaitingImprovement', drive: async (deps, from) => {
      await handleReflectionFlow(from, 'REFLECT', null, deps);
      await handleReflectionFlow(from, 'Lesson text', null, deps);
      await handleReflectionFlow(from, 'Went well text', null, deps);
    } },
    { name: 'awaitingTopic', drive: async (deps, from) => { await runHappyPathUpTo(deps, from, 'awaitingTopic'); } },
    { name: 'reviewSummary', drive: async (deps, from) => { await runHappyPathUpTo(deps, from, 'reviewSummary'); } },
    { name: 'awaitingCorrectionChoice', drive: async (deps, from) => {
      await runHappyPathUpTo(deps, from, 'reviewSummary');
      await handleReflectionFlow(from, 'NO', null, deps);
    } },
  ];

  for (const { name, drive } of cancelSteps) {
    const deps = createDeps();
    const from = '+27000000003';

    await drive(deps, from);
    await handleReflectionFlow(from, 'CANCEL', null, deps);

    assert(deps.createReflection.callCount() === 0, `cancels cleanly from ${name} without ever saving`);
    assert(deps.reflectionState.get('hash:+27000000003') === null, `state is cleared after CANCEL from ${name}`);
  }

  console.log('\n── timeout ──');
  {
    const deps = createDeps();
    const from = '+27000000004';
    const phoneHash = 'hash:+27000000004';

    deps.reflectionState.set(phoneHash, {
      step: 'awaitingLesson',
      lesson: 'Fractions Grade 6',
      lastActivity: Date.now() - 31 * 60 * 1000,
    });

    const handled = await handleReflectionFlow(from, 'some text', null, deps);

    assert(handled === false, 'drops stale state and does not treat the message as handled');
    assert(deps.reflectionState.get(phoneHash) === null, 'stale state is removed');
    assert(deps.createReflection.callCount() === 0, 'never persists anything when dropping a stale session');
    assert(deps.safeSendMessage.callCount() === 0, 'sends nothing back to the teacher when dropping a stale session');
  }

  console.log('\n── timeout boundary ──');
  {
    const deps = createDeps();
    const from = '+27000000009';
    const phoneHash = 'hash:+27000000009';

    // Deterministic clock: the production check does
    // `Date.now() - state.lastActivity > 30 * 60 * 1000`, and real
    // execution time separates the two Date.now() reads (setup here vs.
    // the check inside handleReflectionFlow). Left unmocked, "exactly 30
    // minutes ago" at setup is always *more* than 30 minutes by the time
    // the check runs, making this test flake depending on machine/I-O
    // speed (fails on slower/DB-backed environments, passes on fast
    // in-memory ones). Freeze Date.now() for the setup + call so the
    // elapsed delta is deterministically exactly 30 * 60 * 1000, not
    // 30 * 60 * 1000 + jitter.
    const FIXED_NOW = Date.now();
    const realDateNow = Date.now;
    Date.now = () => FIXED_NOW;
    try {
      deps.reflectionState.set(phoneHash, {
        step: 'awaitingLesson',
        lastActivity: FIXED_NOW - 30 * 60 * 1000,
      });

      const handled = await handleReflectionFlow(from, 'Fractions Grade 6', null, deps);

      assert(handled === true, 'treats a session exactly at the 30-minute boundary as still active');
      const state = deps.reflectionState.get(phoneHash);
      assert(state !== null, 'state at the exact boundary is not dropped');
      assertEqual(state && state.step, 'awaitingWentWell', 'session at the boundary continues to advance normally');
    } finally {
      Date.now = realDateNow;
    }
  }

  console.log('\n── fresh session after timeout ──');
  {
    const deps = createDeps();
    const from = '+27000000010';
    const phoneHash = 'hash:+27000000010';

    deps.reflectionState.set(phoneHash, {
      step: 'awaitingImprovement',
      lesson: 'Old stale lesson',
      wentWell: 'Old stale went-well',
      lastActivity: Date.now() - 45 * 60 * 1000,
    });

    const droppedHandled = await handleReflectionFlow(from, 'REFLECT', null, deps);
    assert(droppedHandled === false, 'first call on a stale session only drops it and reports unhandled');

    const restartHandled = await handleReflectionFlow(from, 'REFLECT', null, deps);
    assert(restartHandled === true, 'a subsequent call starts a brand-new session');

    const state = deps.reflectionState.get(phoneHash);
    assertEqual(state && state.step, 'awaitingLesson', 'new session starts at awaitingLesson, not mid-flow');
    assert(!('lesson' in (state || {})), 'no leftover fields survive from the stale session');
  }

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
    assertEqual(state.topicId, 'TOPIC_CLASSROOM_MANAGEMENT', 'topicId field is preserved');
  }

  // Cycle 10: a save failure must not discard the teacher's already
  // fully-composed reflection (three multi-turn free-text answers) —
  // state now stays at reviewSummary so a YES retries the save instead
  // of forcing complete re-entry.
  console.log('\n── save failure ──');
  {
    let shouldFail = true;
    const deps = createDeps({
      createReflection: createMockFn(() => {
        if (shouldFail) throw new Error('db unavailable');
        return { id: 1 };
      }),
    });
    const from = '+27000000011';
    const phoneHash = 'hash:+27000000011';

    await runHappyPathUpTo(deps, from, 'reviewSummary');
    await handleReflectionFlow(from, 'YES', null, deps);

    const state = deps.reflectionState.get(phoneHash);
    assert(state !== null, 'session is NOT cleared after a save failure — the composed reflection is not lost');
    assertEqual(state && state.step, 'reviewSummary', 'session stays on reviewSummary so a retry does not require re-entering fields');

    const lastCall = deps.safeSendMessage.calls[deps.safeSendMessage.calls.length - 1];
    const lastMessage = lastCall[1];
    assertMatch(lastMessage, /couldn't save that reflection/i, 'tells the teacher the save failed');
    assertMatch(lastMessage, /nothing was lost/i, 'reassures the teacher their input is preserved');

    // Retry: same YES reply, this time the save succeeds.
    shouldFail = false;
    await handleReflectionFlow(from, 'YES', null, deps);
    assert(deps.createReflection.callCount() === 2, 'retry calls createReflection again without re-entering fields');
    assert(deps.reflectionState.get(phoneHash) === null, 'state is cleared once the retried save succeeds');
    const retryLastCall = deps.safeSendMessage.calls[deps.safeSendMessage.calls.length - 1];
    assertMatch(retryLastCall[1], /saved successfully/i, 'retry succeeds and confirms the save');
  }

  console.log('\n' + '─'.repeat(55));
  console.log(`reflectionFlow.test.js Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error('Unexpected test runner error:', err);
  process.exitCode = 1;
});
