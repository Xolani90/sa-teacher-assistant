'use strict';

const { handleBlueprintAuthoringFlow } = require('../flows/blueprintAuthoringFlow');
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

// Mirrors the blueprintAuthoring FlowDefinition registered in
// routes/webhook.js (id, capabilities, menus, hooks). Kept in sync with
// that registration deliberately — see reflectionFlow.test.js /
// growthPlanFlow.test.js for the same pattern and rationale.
function registerBlueprintAuthoringFlow(blueprintAuthoringState) {
  const { describeStatus } = require('../flows/blueprintAuthoringFlow');

  navigationService.registerFlow({
    id: 'blueprintAuthoring',
    commands: ['NEW BLUEPRINT'],
    capabilities: { status: true, cancel: true, back: false, menus: true },
    menus: {
      published: ['Start a new assessment', 'Print a blueprint question paper'],
    },
    hooks: {
      cleanup: (phoneHash) => blueprintAuthoringState.delete(phoneHash),
      describeStatus: (phoneHash) => {
        const state = blueprintAuthoringState.get(phoneHash);
        return state ? describeStatus(state) : null;
      },
    },
  });
}

// In-memory fake standing in for services/blueprintRepository.js. Good
// enough for flow-layer tests — the repository itself already has 26
// tests of its own in migration-029-blueprint-repository.test.js, so
// this fake only needs to be faithful to the contract the flow depends
// on (createBlueprint/getBlueprintById/updateQuestion/publishBlueprint),
// not re-prove the repository's own persistence behaviour.
function createFakeBlueprintRepository({ unresolvedTopicsFor = null } = {}) {
  let nextId = 1;
  const blueprints = new Map(); // id -> { header, questions: [{id, questionNumber, topic, maxMarks}], status }
  let nextQuestionId = 1;

  const createBlueprint = createMockFn((phoneHash, header, questions) => {
    const id = nextId++;
    blueprints.set(id, {
      phoneHash,
      header,
      status: 'draft',
      questions: questions.map((q) => ({ id: nextQuestionId++, ...q })),
    });
    return { blueprintId: id, questionCount: questions.length };
  });

  const getBlueprintById = createMockFn((id) => {
    const bp = blueprints.get(id);
    if (!bp) return null;
    return { id, ...bp.header, status: bp.status, questions: bp.questions };
  });

  const updateQuestion = createMockFn((questionId, phoneHash, updates) => {
    for (const bp of blueprints.values()) {
      const q = bp.questions.find((qq) => qq.id === questionId);
      if (q) {
        Object.assign(q, updates);
        return { questionId, updated: true };
      }
    }
    throw new Error('updateQuestion: question not found');
  });

  // unresolvedTopicsFor: a function (blueprintId, questions) -> unresolved[]|null
  // lets individual tests script exactly one, two, or zero publish
  // failures without a real CAPS registry.
  const publishBlueprint = createMockFn((blueprintId, phoneHash) => {
    const bp = blueprints.get(blueprintId);
    if (!bp) throw new Error('publishBlueprint: blueprint does not exist');

    const unresolved = unresolvedTopicsFor ? unresolvedTopicsFor(blueprintId, bp.questions) : null;
    if (unresolved && unresolved.length > 0) {
      const err = new Error(`publishBlueprint: cannot publish - unresolved topic(s) on question(s) ${unresolved.map((r) => r.questionNumber).join(', ')}`);
      err.unresolvedTopics = unresolved;
      throw err;
    }

    bp.status = 'published';
    return { blueprintId, status: 'published' };
  });

  return { createBlueprint, getBlueprintById, updateQuestion, publishBlueprint, __blueprints: blueprints };
}

function createDeps(overrides = {}) {
  const blueprintAuthoringState = createSessionStore();
  const safeSendMessage = createMockFn(() => Promise.resolve(undefined));
  const hashPhone = createMockFn((from) => `hash:${from}`);
  const repo = createFakeBlueprintRepository(overrides.repoOptions);

  registerBlueprintAuthoringFlow(blueprintAuthoringState);

  return {
    blueprintAuthoringState,
    safeSendMessage,
    hashPhone,
    createBlueprint: repo.createBlueprint,
    getBlueprintById: repo.getBlueprintById,
    updateQuestion: repo.updateQuestion,
    publishBlueprint: repo.publishBlueprint,
    __repo: repo,
    ...overrides,
  };
}

async function runHappyPathToReview(deps, from) {
  await handleBlueprintAuthoringFlow(from, 'NEW BLUEPRINT', null, null, deps);
  await handleBlueprintAuthoringFlow(from, 'Fractions Test', null, null, deps); // title
  await handleBlueprintAuthoringFlow(from, 'Mathematics', null, null, deps); // subject
  await handleBlueprintAuthoringFlow(from, '6', null, null, deps); // grade
  await handleBlueprintAuthoringFlow(from, '2', null, null, deps); // term
  await handleBlueprintAuthoringFlow(from, '20', null, null, deps); // total marks
  await handleBlueprintAuthoringFlow(from, 'Common Fractions | 5', null, null, deps); // Q1
  await handleBlueprintAuthoringFlow(from, 'Whole Numbers | 5', null, null, deps); // Q2
  await handleBlueprintAuthoringFlow(from, 'DONE', null, null, deps);
}

async function run() {
  console.log('blueprintAuthoringFlow tests');
  console.log('='.repeat(60));

  console.log('\n── happy path: full flow through publish ──');
  {
    const deps = createDeps();
    const from = '+27000000201';
    const phoneHash = 'hash:+27000000201';

    await runHappyPathToReview(deps, from);

    let state = deps.blueprintAuthoringState.get(phoneHash);
    assertEqual(state.step, 'review', 'reaches REVIEW after DONE with 2 questions');
    assertEqual(state.questions.length, 2, 'both questions are held in state');

    const reviewMessage = deps.safeSendMessage.calls[deps.safeSendMessage.calls.length - 1][1];
    assertContains(reviewMessage, 'Fractions Test', 'review summary includes the title');
    assertContains(reviewMessage, 'Q1. Common Fractions — 5', 'review summary lists Q1');
    assertContains(reviewMessage, 'Q2. Whole Numbers — 5', 'review summary lists Q2');

    assert(deps.createBlueprint.callCount() === 0, 'createBlueprint is not called before PUBLISH');

    await handleBlueprintAuthoringFlow(from, 'PUBLISH', null, null, deps);

    assert(deps.createBlueprint.callCount() === 1, 'createBlueprint is called exactly once on PUBLISH');
    assert(deps.publishBlueprint.callCount() === 1, 'publishBlueprint is called exactly once on PUBLISH');

    const [phoneHashArg, header, questions] = deps.createBlueprint.calls[0];
    assertEqual(phoneHashArg, phoneHash, 'createBlueprint receives the correct phoneHash');
    assertEqual(header, { title: 'Fractions Test', subject: 'Mathematics', grade: 6, term: 2, totalMarks: 20 }, 'createBlueprint receives the assembled header');
    assertEqual(questions, [
      { questionNumber: 1, topic: 'Common Fractions', maxMarks: 5 },
      { questionNumber: 2, topic: 'Whole Numbers', maxMarks: 5 },
    ], 'createBlueprint receives both questions');

    state = deps.blueprintAuthoringState.get(phoneHash);
    assertEqual(state.step, 'publishedMenu', 'moves to PUBLISHED_MENU after a successful publish');

    const publishedMessage = deps.safeSendMessage.calls[deps.safeSendMessage.calls.length - 1][1];
    assertContains(publishedMessage, '✅ Published!', 'sends a published confirmation');
    assertContains(publishedMessage, 'Fractions Test', 'confirmation names the blueprint');
  }

  console.log('\n── invalid input at each header step re-prompts, does not advance ──');
  {
    const deps = createDeps();
    const from = '+27000000202';
    const phoneHash = 'hash:+27000000202';

    await handleBlueprintAuthoringFlow(from, 'NEW BLUEPRINT', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'My Test', null, null, deps); // title -> subject
    await handleBlueprintAuthoringFlow(from, 'Mathematics', null, null, deps); // subject -> grade

    await handleBlueprintAuthoringFlow(from, 'not a grade', null, null, deps);
    let state = deps.blueprintAuthoringState.get(phoneHash);
    assertEqual(state.step, 'headerGrade', 'invalid grade reply does not advance past HEADER_GRADE');

    await handleBlueprintAuthoringFlow(from, '6', null, null, deps); // grade -> term
    await handleBlueprintAuthoringFlow(from, 'not a term', null, null, deps);
    state = deps.blueprintAuthoringState.get(phoneHash);
    assertEqual(state.step, 'headerTerm', 'invalid term reply does not advance past HEADER_TERM');

    await handleBlueprintAuthoringFlow(from, 'SKIP', null, null, deps); // term -> total marks
    await handleBlueprintAuthoringFlow(from, 'not a number', null, null, deps);
    state = deps.blueprintAuthoringState.get(phoneHash);
    assertEqual(state.step, 'headerTotalMarks', 'invalid total-marks reply does not advance past HEADER_TOTAL_MARKS');
    assertEqual(state.term, null, 'SKIP on term stores null');

    await handleBlueprintAuthoringFlow(from, '20', null, null, deps); // -> add question
    await handleBlueprintAuthoringFlow(from, 'not formatted right', null, null, deps);
    state = deps.blueprintAuthoringState.get(phoneHash);
    assertEqual(state.step, 'addQuestion', 'invalid question reply does not advance past ADD_QUESTION');
    assertEqual(state.questions.length, 0, 'no question is added on invalid input');
  }

  console.log('\n── CANCEL mid-flow clears session, zero DB rows created ──');
  {
    const deps = createDeps();
    const from = '+27000000203';
    const phoneHash = 'hash:+27000000203';

    await handleBlueprintAuthoringFlow(from, 'NEW BLUEPRINT', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'My Test', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Mathematics', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'CANCEL', null, null, deps);

    assert(deps.blueprintAuthoringState.get(phoneHash) === null, 'session state is cleared after CANCEL');
    assert(deps.createBlueprint.callCount() === 0, 'CANCEL before PUBLISH never calls createBlueprint — zero DB rows');

    const lastMessage = deps.safeSendMessage.calls[deps.safeSendMessage.calls.length - 1][1];
    assertContains(lastMessage, 'cancelled', 'confirms cancellation');
    assertContains(lastMessage, 'Nothing was saved', 'tells the teacher nothing was saved when no draft row exists yet');
  }

  console.log('\n── STATUS mid-flow describes current step ──');
  {
    const deps = createDeps();
    const from = '+27000000204';

    await handleBlueprintAuthoringFlow(from, 'NEW BLUEPRINT', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'My Test', null, null, deps); // -> subject

    await handleBlueprintAuthoringFlow(from, 'STATUS', null, null, deps);
    const statusMessage = deps.safeSendMessage.calls[deps.safeSendMessage.calls.length - 1][1];
    assertMatch(statusMessage, /subject/i, 'STATUS describes waiting-for-subject step');
    assertContains(statusMessage, 'My Test', 'STATUS includes the title already captured');
  }

  console.log('\n── publish rejected by CAPS validation (unresolvedTopics) ──');
  {
    const deps = createDeps({
      repoOptions: {
        // Simulates a CAPS registry that only recognises "Common
        // Fractions" — Q1's original "Common Fractions" topic in
        // runHappyPathToReview is deliberately spelled to fail here
        // ("Common Fractions" is what Q1 IS in the happy path, so use a
        // registry that rejects anything else) so the FIX-then-retry
        // path below has something real to fix.
        unresolvedTopicsFor: (blueprintId, questions) => {
          const q1 = questions.find((q) => q.questionNumber === 1);
          if (!q1 || q1.topic === 'Fractions (CAPS)') return null;
          return [{ questionNumber: 1, topic: q1.topic, valid: false, dataAvailable: true, matchedTopic: null, suggestions: ['Fractions (CAPS)'] }];
        },
      },
    });
    const from = '+27000000205';
    const phoneHash = 'hash:+27000000205';

    await runHappyPathToReview(deps, from);
    await handleBlueprintAuthoringFlow(from, 'PUBLISH', null, null, deps);

    let state = deps.blueprintAuthoringState.get(phoneHash);
    assertEqual(state.step, 'review', 'stays on REVIEW when publish fails on unresolved topics');
    assert(state.blueprintId != null, 'a draft blueprint row is retained (createBlueprint already ran)');
    assertEqual(state.unresolvedTopics.length, 1, 'unresolved topic detail is stored on state');

    const failMessage = deps.safeSendMessage.calls[deps.safeSendMessage.calls.length - 1][1];
    assertContains(failMessage, 'Q1', 'failure message names the failing question');
    assertContains(failMessage, 'FIX', 'failure message tells the teacher how to retry');

    // Retype just the affected question's topic without restarting.
    await handleBlueprintAuthoringFlow(from, 'FIX 1 Fractions (CAPS)', null, null, deps);
    state = deps.blueprintAuthoringState.get(phoneHash);
    assertEqual(state.unresolvedTopics.length, 0, 'FIX clears the resolved question from unresolvedTopics');
    assertEqual(state.questions[0].topic, 'Fractions (CAPS)', 'FIX updates the topic in session state');
    assert(deps.updateQuestion.callCount() === 1, 'FIX also persists the corrected topic via updateQuestion');

    await handleBlueprintAuthoringFlow(from, 'PUBLISH', null, null, deps);
    assert(deps.createBlueprint.callCount() === 1, 'retrying PUBLISH does not call createBlueprint a second time');
    assert(deps.publishBlueprint.callCount() === 2, 'retrying PUBLISH calls publishBlueprint again');

    state = deps.blueprintAuthoringState.get(phoneHash);
    assertEqual(state.step, 'publishedMenu', 'second publish attempt succeeds once the topic is fixed');
  }

  console.log('\n── zero-questions DONE is rejected ──');
  {
    const deps = createDeps();
    const from = '+27000000206';
    const phoneHash = 'hash:+27000000206';

    await handleBlueprintAuthoringFlow(from, 'NEW BLUEPRINT', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Empty Test', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Mathematics', null, null, deps);
    await handleBlueprintAuthoringFlow(from, '6', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'SKIP', null, null, deps);
    await handleBlueprintAuthoringFlow(from, '20', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'DONE', null, null, deps);

    const state = deps.blueprintAuthoringState.get(phoneHash);
    assertEqual(state.step, 'addQuestion', 'DONE with zero questions stays on ADD_QUESTION');

    const lastMessage = deps.safeSendMessage.calls[deps.safeSendMessage.calls.length - 1][1];
    assertMatch(lastMessage, /at least one question/i, 'explains at least one question is required');
  }

  console.log('\n── session survives a simulated restart (reload from store) ──');
  {
    const deps = createDeps();
    const from = '+27000000207';
    const phoneHash = 'hash:+27000000207';

    await runHappyPathToReview(deps, from);
    const savedState = deps.blueprintAuthoringState.get(phoneHash);

    // Simulate a process restart: a fresh deps object (new mock
    // safeSendMessage/repo), but the SAME underlying session state,
    // exactly like SessionStore's SQLite-backed persistence would hand
    // back after a redeploy.
    const revivedDeps = createDeps();
    revivedDeps.blueprintAuthoringState.set(phoneHash, savedState);

    await handleBlueprintAuthoringFlow(from, 'PUBLISH', null, null, revivedDeps);

    assert(revivedDeps.createBlueprint.callCount() === 1, 'the revived session can still publish using its restored state');
    const state = revivedDeps.blueprintAuthoringState.get(phoneHash);
    assertEqual(state.step, 'publishedMenu', 'revived session reaches PUBLISHED_MENU on publish');
  }

  console.log('\n' + '─'.repeat(55));
  console.log(`blueprintAuthoringFlow.test.js Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error('Unexpected test runner error:', err);
  process.exitCode = 1;
});
