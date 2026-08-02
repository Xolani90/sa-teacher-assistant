'use strict';

const { parseIntent } = require('../utils/intentParser');
const { handleReflectionFlow } = require('../flows/reflectionFlow');
const { handleGrowthPlanFlow } = require('../flows/growthPlanFlow');

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    console.log(`  ✅ PASS: ${label}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

async function run() {
  // --- REFLECT reaches reflectionFlow and prompts for lesson content ---
  {
    const reflectionState = new Map();
    const sent = [];
    const deps = {
      reflectionState,
      safeSendMessage: async (to, msg) => { sent.push({ to, msg }); },
      parseIntent,
      hashPhone: (p) => p,
      createReflection: async () => { throw new Error('should not be called'); },
      getCurrentTerm: () => 1,
    };

    const handled = await handleReflectionFlow('27821110001', 'REFLECT', null, deps);

    console.log('📋 TEST 1: bare REFLECT reaches reflectionFlow');
    check('REFLECT is handled (returns true)', handled === true);
    check('a session was started for this phone', reflectionState.has('27821110001'));
    check('session step is awaitingLesson (fresh entry, not mid-flow)', reflectionState.get('27821110001').step === 'awaitingLesson');
    check('exactly one message sent', sent.length === 1);
    check('reply asks for lesson content, not a silent save', /lesson/i.test(sent[0].msg));
    check('reply does NOT indicate anything was saved', !/saved|logged successfully/i.test(sent[0].msg));
  }

  // --- NEW GOAL reaches growthPlanFlow and prompts for goal content ---
  {
    const growthPlanState = new Map();
    const sent = [];
    const deps = {
      growthPlanState,
      safeSendMessage: async (to, msg) => { sent.push({ to, msg }); },
      parseIntent,
      hashPhone: (p) => p,
      createGrowthPlan: async () => { throw new Error('should not be called'); },
      getCurrentTerm: () => 1,
    };

    const handled = await handleGrowthPlanFlow('27821110002', 'NEW GOAL', null, deps);

    console.log('📋 TEST 2: bare NEW GOAL reaches growthPlanFlow');
    check('NEW GOAL is handled (returns true)', handled === true);
    check('a session was started for this phone', growthPlanState.has('27821110002'));
    check('session step is awaitingGoal (fresh entry, not mid-flow)', growthPlanState.get('27821110002').step === 'awaitingGoal');
    check('exactly one message sent', sent.length === 1);
    check('reply asks for the goal, not a silent save', /goal/i.test(sent[0].msg));
    check('reply does NOT indicate anything was saved', !/saved|created successfully/i.test(sent[0].msg));
  }

  // --- Equivalence at the flow level: REFLECT and "reflect on my lesson" produce identical first prompts ---
  {
    const stateA = new Map();
    const stateB = new Map();
    const sentA = [];
    const sentB = [];
    const baseDeps = {
      parseIntent,
      hashPhone: (p) => p,
      createReflection: async () => { throw new Error('should not be called'); },
      getCurrentTerm: () => 1,
    };

    await handleReflectionFlow('27821110003', 'REFLECT', null, {
      ...baseDeps, reflectionState: stateA, safeSendMessage: async (to, msg) => sentA.push(msg),
    });
    await handleReflectionFlow('27821110004', 'reflect on my lesson', null, {
      ...baseDeps, reflectionState: stateB, safeSendMessage: async (to, msg) => sentB.push(msg),
    });

    console.log('📋 TEST 3: REFLECT and natural phrasing produce the identical first prompt');
    check('both produce exactly one message', sentA.length === 1 && sentB.length === 1);
    check('the prompts are byte-identical', sentA[0] === sentB[0]);
  }

  console.log('─────────────────────────────────');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('─────────────────────────────────');

  if (failed > 0) process.exit(1);
}

run();
