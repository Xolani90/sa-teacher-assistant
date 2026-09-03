'use strict';

// Integration tests for the assessment weighting engine wired into
// blueprintAuthoringFlow (RC1-H-001 + ADR-005 extension).
//
// Scope: this file only exercises the flow-level wiring — HEADER_GRADE
// branching to HEADER_PAPER, HEADER_TOTAL_MARKS triggering
// computeBlueprint(), the CUSTOM_WEIGHTING_INPUT step, and the REVIEW
// summary reflecting whatever weighting (if any) was resolved. It does
// NOT re-test computeBlueprint()'s own allocation math — that's fully
// covered by assessment-weighting-engine.test.js (49 tests). Mirrors
// the harness in blueprintAuthoringFlow.test.js exactly so both files
// read as one family.

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

// Same FlowDefinition registration as blueprintAuthoringFlow.test.js —
// kept in sync deliberately, see that file's comment for rationale.
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

// Same fake repository as blueprintAuthoringFlow.test.js — this file
// never needs unresolved-topic scripting, so unresolvedTopicsFor is
// always left null.
function createFakeBlueprintRepository() {
  let nextId = 1;
  const blueprints = new Map();
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

  const publishBlueprint = createMockFn((blueprintId) => {
    const bp = blueprints.get(blueprintId);
    if (!bp) throw new Error('publishBlueprint: blueprint does not exist');
    bp.status = 'published';
    return { blueprintId, status: 'published' };
  });

  return { createBlueprint, getBlueprintById, updateQuestion, publishBlueprint, __blueprints: blueprints };
}

function createDeps(overrides = {}) {
  const blueprintAuthoringState = createSessionStore();
  const safeSendMessage = createMockFn(() => Promise.resolve(undefined));
  const hashPhone = createMockFn((from) => `hash:${from}`);
  const repo = createFakeBlueprintRepository();

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

function lastMessage(deps) {
  return deps.safeSendMessage.calls[deps.safeSendMessage.calls.length - 1][1];
}

async function run() {
  console.log('blueprintAuthoringFlow weighting integration tests');
  console.log('='.repeat(60));

  console.log('\n── FET grade (10-12) branches through HEADER_PAPER ──');
  {
    const deps = createDeps();
    const from = '+27000000301';
    const phoneHash = 'hash:+27000000301';

    await handleBlueprintAuthoringFlow(from, 'NEW BLUEPRINT', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Term 2 Exam', null, null, deps); // title
    await handleBlueprintAuthoringFlow(from, 'Mathematics', null, null, deps); // subject
    await handleBlueprintAuthoringFlow(from, '10', null, null, deps); // grade

    let state = deps.blueprintAuthoringState.get(phoneHash);
    assertEqual(state.step, 'headerPaper', 'Grade 10 routes to HEADER_PAPER instead of HEADER_TERM');
    assertContains(lastMessage(deps), 'Which paper', 'prompts for paper');

    await handleBlueprintAuthoringFlow(from, 'nonsense', null, null, deps);
    assertEqual(deps.blueprintAuthoringState.get(phoneHash).step, 'headerPaper', 'invalid paper reply does not advance');

    await handleBlueprintAuthoringFlow(from, '1', null, null, deps);
    state = deps.blueprintAuthoringState.get(phoneHash);
    assertEqual(state.paper, 'Paper 1', 'paper "1" is normalised to "Paper 1"');
    assertEqual(state.step, 'headerTerm', 'moves on to HEADER_TERM after a valid paper reply');
  }

  console.log('\n── non-FET grade skips HEADER_PAPER entirely ──');
  {
    const deps = createDeps();
    const from = '+27000000302';
    const phoneHash = 'hash:+27000000302';

    await handleBlueprintAuthoringFlow(from, 'NEW BLUEPRINT', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Fractions Test', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Mathematics', null, null, deps);
    await handleBlueprintAuthoringFlow(from, '6', null, null, deps);

    const state = deps.blueprintAuthoringState.get(phoneHash);
    assertEqual(state.step, 'headerTerm', 'Grade 6 goes straight to HEADER_TERM');
    assert(state.paper === undefined, 'no paper is set for a non-FET grade');
  }

  console.log('\n── verified CAPS rule (Grade 10 Maths Paper 1) is applied automatically ──');
  {
    const deps = createDeps();
    const from = '+27000000303';
    const phoneHash = 'hash:+27000000303';

    await handleBlueprintAuthoringFlow(from, 'NEW BLUEPRINT', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Term 2 Exam', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Mathematics', null, null, deps);
    await handleBlueprintAuthoringFlow(from, '10', null, null, deps);
    await handleBlueprintAuthoringFlow(from, '1', null, null, deps); // paper 1
    await handleBlueprintAuthoringFlow(from, 'SKIP', null, null, deps); // term
    await handleBlueprintAuthoringFlow(from, '100', null, null, deps); // total marks

    const state = deps.blueprintAuthoringState.get(phoneHash);
    assertEqual(state.step, 'addQuestion', 'moves to ADD_QUESTION once weighting is resolved');
    assert(state.weighting != null, 'a weighting result is stored on state');
    assertEqual(state.weighting.weightingSource, 'CAPS', 'weighting is sourced from CAPS, not teacher input');
    assertEqual(state.weighting.ruleId, 'FET-MATH-G10-P1', 'the correct CAPS rule was matched');

    const marksMsg = lastMessage(deps);
    assertContains(marksMsg, 'CAPS-derived weighting', 'total-marks response names the CAPS source');
    assertContains(marksMsg, 'Algebra and Equations', 'allocation lists a topic from the matched rule');
    assertContains(marksMsg, 'Question 1', 'still prompts for the first question after showing the allocation');

    // Sanity: allocation should sum to the requested total (100 in, 100 out).
    const sum = state.weighting.allocation.reduce((s, a) => s + a.marks, 0);
    assertEqual(sum, 100, 'allocation marks sum to the requested total marks');
  }

  console.log('\n── unverified weighting (Grade 6 Maths) proceeds unweighted, offers CUSTOM ──');
  {
    const deps = createDeps();
    const from = '+27000000304';
    const phoneHash = 'hash:+27000000304';

    await handleBlueprintAuthoringFlow(from, 'NEW BLUEPRINT', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Fractions Test', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Mathematics', null, null, deps);
    await handleBlueprintAuthoringFlow(from, '6', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'SKIP', null, null, deps); // term
    await handleBlueprintAuthoringFlow(from, '20', null, null, deps); // total marks

    const state = deps.blueprintAuthoringState.get(phoneHash);
    assertEqual(state.step, 'addQuestion', 'still reaches ADD_QUESTION with no verified weighting');
    assert(state.weighting === undefined, 'no weighting is stored when unverified');

    const marksMsg = lastMessage(deps);
    assertContains(marksMsg, 'No verified CAPS weighting found', 'explains why no weighting was applied');
    assertContains(marksMsg, 'CUSTOM', 'offers the CUSTOM command as an alternative');

    // The flow must not silently block progress just because there's
    // no verified rule — the teacher can go straight to adding questions.
    await handleBlueprintAuthoringFlow(from, 'Common Fractions | 20', null, null, deps);
    assertEqual(deps.blueprintAuthoringState.get(phoneHash).questions.length, 1, 'question entry works normally with no weighting');
  }

  console.log('\n── CUSTOM at ADD_QUESTION collects teacher-supplied percentages ──');
  {
    const deps = createDeps();
    const from = '+27000000305';
    const phoneHash = 'hash:+27000000305';

    await handleBlueprintAuthoringFlow(from, 'NEW BLUEPRINT', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Fractions Test', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Mathematics', null, null, deps);
    await handleBlueprintAuthoringFlow(from, '6', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'SKIP', null, null, deps);
    await handleBlueprintAuthoringFlow(from, '20', null, null, deps);

    await handleBlueprintAuthoringFlow(from, 'CUSTOM', null, null, deps);
    let state = deps.blueprintAuthoringState.get(phoneHash);
    assertEqual(state.step, 'customWeightingInput', 'CUSTOM moves to CUSTOM_WEIGHTING_INPUT');

    // Percentages that don't sum to 100 are rejected without advancing.
    await handleBlueprintAuthoringFlow(from, 'Common Fractions 40\nWhole Numbers 40', null, null, deps);
    state = deps.blueprintAuthoringState.get(phoneHash);
    assertEqual(state.step, 'customWeightingInput', 'invalid percentage total does not advance');
    assertContains(lastMessage(deps), 'sum to exactly 100', 'explains the percentage-sum requirement');

    // Valid percentages resolve the weighting and return to ADD_QUESTION.
    await handleBlueprintAuthoringFlow(from, 'Common Fractions 40\nWhole Numbers 60', null, null, deps);
    state = deps.blueprintAuthoringState.get(phoneHash);
    assertEqual(state.step, 'addQuestion', 'valid custom weighting returns to ADD_QUESTION');
    assert(state.weighting != null, 'custom weighting is stored on state');
    assertEqual(state.weighting.weightingSource, 'TEACHER_CUSTOM', 'weighting is labelled as teacher-custom, never CAPS');

    const allocation = state.weighting.allocation;
    const fractionsMarks = allocation.find((a) => a.topic === 'Common Fractions').marks;
    const wholeNumbersMarks = allocation.find((a) => a.topic === 'Whole Numbers').marks;
    assertEqual(fractionsMarks, 8, '40% of 20 marks allocated to Common Fractions');
    assertEqual(wholeNumbersMarks, 12, '60% of 20 marks allocated to Whole Numbers');

    assertContains(lastMessage(deps), 'Your custom weighting', 'confirmation names the custom source, not CAPS');
  }

  console.log('\n── REVIEW screen reflects the resolved weighting ──');
  {
    const deps = createDeps();
    const from = '+27000000306';
    const phoneHash = 'hash:+27000000306';

    await handleBlueprintAuthoringFlow(from, 'NEW BLUEPRINT', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Term 2 Exam', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Mathematics', null, null, deps);
    await handleBlueprintAuthoringFlow(from, '10', null, null, deps);
    await handleBlueprintAuthoringFlow(from, '2', null, null, deps); // paper 2
    await handleBlueprintAuthoringFlow(from, 'SKIP', null, null, deps);
    await handleBlueprintAuthoringFlow(from, '100', null, null, deps);
    // Matches the resolved FET-MATH-G10-P2 allocation exactly (Statistics
    // 15, Analytical Geometry 15, Trigonometry 40, Euclidean Geometry and
    // Measurement 30 — see data/caps-weighting/evidence-inventory.json),
    // so this also doubles as the "valid assessment" fixture for the
    // validator-wiring PUBLISH below.
    await handleBlueprintAuthoringFlow(from, 'Statistics | 15', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Analytical Geometry | 15', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Trigonometry | 40', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Euclidean Geometry and Measurement | 30', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'DONE', null, null, deps);

    const state = deps.blueprintAuthoringState.get(phoneHash);
    assertEqual(state.step, 'review', 'reaches REVIEW with the weighting still attached');
    assertContains(lastMessage(deps), 'CAPS-derived weighting', 'REVIEW summary surfaces the weighting source');

    // Publishing must still work unchanged — weighting is advisory only,
    // never a publish gate (matches computeBlueprint's own contract that
    // it never blocks question authoring). A valid, matching assessment
    // must still publish once validateAssessment() is wired in below.
    await handleBlueprintAuthoringFlow(from, 'PUBLISH', null, null, deps);
    assert(deps.createBlueprint.callCount() === 1, 'PUBLISH still creates the blueprint with a weighting attached');
    assertEqual(deps.blueprintAuthoringState.get(phoneHash).step, 'publishedMenu', 'reaches PUBLISHED_MENU normally');
  }

  console.log('\n── validateAssessment() wiring: valid allocation publishes ──');
  {
    const deps = createDeps();
    const from = '+27000000308';
    const phoneHash = 'hash:+27000000308';

    await handleBlueprintAuthoringFlow(from, 'NEW BLUEPRINT', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Term 2 Exam', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Mathematics', null, null, deps);
    await handleBlueprintAuthoringFlow(from, '10', null, null, deps);
    await handleBlueprintAuthoringFlow(from, '2', null, null, deps); // paper 2
    await handleBlueprintAuthoringFlow(from, 'SKIP', null, null, deps);
    await handleBlueprintAuthoringFlow(from, '100', null, null, deps);
    // Matches FET-MATH-G10-P2 exactly (see above).
    await handleBlueprintAuthoringFlow(from, 'Statistics | 15', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Analytical Geometry | 15', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Trigonometry | 40', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Euclidean Geometry and Measurement | 30', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'DONE', null, null, deps);

    await handleBlueprintAuthoringFlow(from, 'PUBLISH', null, null, deps);
    assertEqual(deps.blueprintAuthoringState.get(phoneHash).step, 'publishedMenu', 'a valid generated assessment matching the resolved blueprint publishes');
    assert(deps.publishBlueprint.callCount() === 1, 'publishBlueprint was actually called for the matching assessment');
  }

  console.log('\n── validateAssessment() wiring: materially incorrect allocation is rejected before publication ──');
  {
    const deps = createDeps();
    const from = '+27000000309';
    const phoneHash = 'hash:+27000000309';

    await handleBlueprintAuthoringFlow(from, 'NEW BLUEPRINT', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Term 2 Exam', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Mathematics', null, null, deps);
    await handleBlueprintAuthoringFlow(from, '10', null, null, deps);
    await handleBlueprintAuthoringFlow(from, '2', null, null, deps); // paper 2
    await handleBlueprintAuthoringFlow(from, 'SKIP', null, null, deps);
    await handleBlueprintAuthoringFlow(from, '100', null, null, deps);
    // Deliberately wrong: a single 50-mark question covering only one of
    // the four required topics, far outside tolerance on every count.
    await handleBlueprintAuthoringFlow(from, 'Euclidean Geometry and Measurement | 50', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'DONE', null, null, deps);

    await handleBlueprintAuthoringFlow(from, 'PUBLISH', null, null, deps);
    const state = deps.blueprintAuthoringState.get(phoneHash);
    assertEqual(state.step, 'review', 'a materially incorrect allocation stays on REVIEW instead of publishing');
    assertEqual(deps.createBlueprint.callCount(), 0, 'createBlueprint is never called for a materially incorrect allocation');
    assertEqual(deps.publishBlueprint.callCount(), 0, 'publishBlueprint is never called for a materially incorrect allocation');
    assertContains(lastMessage(deps), "don't match the resolved weighting allocation", 'explains the allocation mismatch to the teacher');
    assertContains(lastMessage(deps), 'Statistics', 'names a specific topic that is short of its required marks');
  }

  console.log('\n── validateAssessment() wiring: CUSTOM weighting is still validated and still publishes ──');
  {
    const deps = createDeps();
    const from = '+27000000310';
    const phoneHash = 'hash:+27000000310';

    await handleBlueprintAuthoringFlow(from, 'NEW BLUEPRINT', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Fractions Test', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Mathematics', null, null, deps);
    await handleBlueprintAuthoringFlow(from, '6', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'SKIP', null, null, deps);
    await handleBlueprintAuthoringFlow(from, '20', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'CUSTOM', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Common Fractions 40\nWhole Numbers 60', null, null, deps);
    // Matches the 40/60 custom split exactly: 8 and 12 marks.
    await handleBlueprintAuthoringFlow(from, 'Common Fractions | 8', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Whole Numbers | 12', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'DONE', null, null, deps);

    await handleBlueprintAuthoringFlow(from, 'PUBLISH', null, null, deps);
    const state = deps.blueprintAuthoringState.get(phoneHash);
    assertEqual(state.step, 'publishedMenu', 'CUSTOM weighting matching the teacher-set split still publishes');
    assert(deps.publishBlueprint.callCount() === 1, 'publishBlueprint was called once for the matching custom-weighted assessment');
  }

  console.log('\n── validateAssessment() wiring: WEIGHTING_UNVERIFIED still invents nothing and never blocks publish ──');
  {
    const deps = createDeps();
    const from = '+27000000311';
    const phoneHash = 'hash:+27000000311';

    await handleBlueprintAuthoringFlow(from, 'NEW BLUEPRINT', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Fractions Test', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Mathematics', null, null, deps);
    await handleBlueprintAuthoringFlow(from, '6', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'SKIP', null, null, deps);
    await handleBlueprintAuthoringFlow(from, '20', null, null, deps);

    assert(deps.blueprintAuthoringState.get(phoneHash).weighting === undefined, 'no weighting is invented for an unverified grade');

    // Wildly "wrong" by any topic-allocation standard, but there is no
    // resolved blueprint to check against, so this must publish freely —
    // the validator must never be invoked when weighting is unresolved.
    await handleBlueprintAuthoringFlow(from, 'Whatever Topic | 3', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'DONE', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'PUBLISH', null, null, deps);

    const state = deps.blueprintAuthoringState.get(phoneHash);
    assertEqual(state.step, 'publishedMenu', 'WEIGHTING_UNVERIFIED sessions still publish — validator is never invoked without a resolved blueprint');
    assert(deps.publishBlueprint.callCount() === 1, 'publishBlueprint was called despite no weighting ever being resolved');
  }

  console.log('\n── regression: existing STATUS/CANCEL still work mid-weighting-flow ──');
  {
    const deps = createDeps();
    const from = '+27000000307';
    const phoneHash = 'hash:+27000000307';

    await handleBlueprintAuthoringFlow(from, 'NEW BLUEPRINT', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Term 2 Exam', null, null, deps);
    await handleBlueprintAuthoringFlow(from, 'Mathematics', null, null, deps);
    await handleBlueprintAuthoringFlow(from, '11', null, null, deps); // FET grade -> HEADER_PAPER

    await handleBlueprintAuthoringFlow(from, 'STATUS', null, null, deps);
    assertContains(lastMessage(deps), 'waiting for the paper', 'STATUS describes the new HEADER_PAPER step correctly');

    await handleBlueprintAuthoringFlow(from, 'CANCEL', null, null, deps);
    assertEqual(deps.blueprintAuthoringState.get(phoneHash), null, 'CANCEL clears session state from HEADER_PAPER same as any other step');
  }

  console.log('\n' + '─'.repeat(55));
  console.log(`blueprintAuthoringFlow-weighting-integration.test.js Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
