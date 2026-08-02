'use strict';
/**
 * qmsFlow.test.js
 *
 * Tests flows/qmsFlow.js — the stateless, single-message QMS command
 * group (MY STATS, MY STATS ALL, MY GOALS, MY REFLECTIONS). Mirrors
 * workspaceFlow-classIntervention.test.js's shape: no DB, no session
 * state, mocked deps only, since qmsFlow.js does zero aggregation or
 * persistence of its own — every number displayed comes straight from
 * the injected qmsAnalyticsService/reflectionService functions.
 *
 * Run individually:   node tests/qmsFlow.test.js
 * Run via npm:         npm test
 */

const { handleQmsFlow } = require('../flows/qmsFlow');

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

// ── Mock deps builder ─────────────────────────────────────────────────

function buildDeps(overrides = {}) {
  const sentMessages = [];

  const deps = {
    hashPhone: (from) => `hash_${from}`,
    getTeacherByPhone: (from) => ({ id: 1, name: 'Test Teacher', phone: from }),
    safeSendMessage: async (from, text) => {
      sentMessages.push({ from, text });
    },
    getSummary: () => ({
      reflectionCount: 0,
      growthPlanCountsByStatus: {},
      latestActivity: null,
    }),
    getGrowthPlanSummary: () => ({
      countsByStatus: {},
      recentPlans: [],
    }),
    getCommonFocusAreas: () => [],
    listReflections: () => [],
    getCurrentTerm: () => 2,
    ...overrides,
  };

  return { deps, sentMessages };
}

async function run() {
  // ═══════════════════════════════════════════════════════════════════
  // SECTION 0: routing / fallthrough
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 0: routing ──────────────────────────────────');

  {
    const { deps, sentMessages } = buildDeps();
    const handled = await handleQmsFlow('27821110000', 'HELLO', deps);
    assert(handled === false, 'non-QMS text is not handled');
    assert(sentMessages.length === 0, 'no message sent for unhandled text');
  }

  {
    const { deps } = buildDeps();
    for (const cmd of ['MY STATS', 'my stats', ' My Stats ', 'MY STATS ALL', 'MY GOALS', 'MY REFLECTIONS']) {
      const handled = await handleQmsFlow('27821110000', cmd, deps);
      assert(handled === true, `"${cmd}" is handled (case/whitespace insensitive)`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 1: teacher-not-found guard
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 1: teacher-not-found guard ──────────────────');

  {
    const { deps, sentMessages } = buildDeps({ getTeacherByPhone: () => null });
    const handled = await handleQmsFlow('27821110000', 'MY STATS', deps);
    assert(handled === true, 'MY STATS still reports handled for unknown teacher');
    assert(sentMessages.length === 1, 'exactly one message sent');
    assertIncludes(sentMessages[0].text, 'setup first', 'setup guidance shown for unknown teacher');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 2: MY STATS
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 2: MY STATS ──────────────────────────────────');

  {
    const { deps, sentMessages } = buildDeps({
      getSummary: () => ({ reflectionCount: 0, growthPlanCountsByStatus: {}, latestActivity: null }),
    });
    await handleQmsFlow('27821110000', 'MY STATS', deps);
    assertIncludes(sentMessages[0].text, 'No reflections or growth plans recorded yet', 'empty-state message shown');
    assertIncludes(sentMessages[0].text, 'REFLECT', 'empty-state points at REFLECT');
    assertIncludes(sentMessages[0].text, 'NEW GOAL', 'empty-state points at NEW GOAL');
  }

  {
    const { deps, sentMessages } = buildDeps({
      getSummary: () => ({
        reflectionCount: 4,
        growthPlanCountsByStatus: { active: 2, completed: 1 },
        latestActivity: '2026-07-15 10:00:00',
      }),
    });
    await handleQmsFlow('27821110000', 'MY STATS', deps);
    const msg = sentMessages[0].text;
    assertIncludes(msg, 'Reflections: 4', 'reflection count shown');
    assertIncludes(msg, '2 active', 'active growth plan count shown');
    assertIncludes(msg, '1 completed', 'completed growth plan count shown');
    assertIncludes(msg, '2026-07-15', 'latestActivity date shown (time stripped)');
    assertIncludes(msg, 'MY STATS ALL', 'plain MY STATS suggests MY STATS ALL for more detail');
  }

  {
    const { deps, sentMessages } = buildDeps({
      getSummary: () => ({
        reflectionCount: 1,
        growthPlanCountsByStatus: {},
        latestActivity: null,
      }),
    });
    await handleQmsFlow('27821110000', 'MY STATS', deps);
    assertIncludes(sentMessages[0].text, 'Growth plans: none yet', 'no-growth-plans branch shown when reflections exist but plans do not');
  }

  // ── MY STATS ALL ──
  {
    let calledFocusAreas = false;
    const { deps, sentMessages } = buildDeps({
      getSummary: () => ({
        reflectionCount: 2,
        growthPlanCountsByStatus: { active: 1 },
        latestActivity: null,
      }),
      getCommonFocusAreas: () => {
        calledFocusAreas = true;
        return [
          { label: 'Classroom management', count: 3 },
          { label: 'Questioning technique', count: 1 },
        ];
      },
    });
    await handleQmsFlow('27821110000', 'MY STATS ALL', deps);
    assert(calledFocusAreas, 'getCommonFocusAreas is called for MY STATS ALL');
    const msg = sentMessages[0].text;
    assertIncludes(msg, 'Common focus areas', 'focus areas section header shown');
    assertIncludes(msg, 'Classroom management (3)', 'first focus area shown with count');
    assertIncludes(msg, 'Questioning technique (1)', 'second focus area shown with count');
    assert(!msg.includes('MY STATS ALL'), 'MY STATS ALL response does not suggest itself again');
  }

  {
    const { deps, sentMessages } = buildDeps({
      getSummary: () => ({ reflectionCount: 1, growthPlanCountsByStatus: {}, latestActivity: null }),
      getCommonFocusAreas: () => [],
    });
    await handleQmsFlow('27821110000', 'MY STATS ALL', deps);
    assert(!sentMessages[0].text.includes('Common focus areas'), 'no focus-areas section when there are none');
  }

  {
    const { deps, sentMessages } = buildDeps({
      getSummary: () => { throw new Error('boom'); },
    });
    const handled = await handleQmsFlow('27821110000', 'MY STATS', deps);
    assert(handled === true, 'a thrown error from getSummary is still handled, not an uncaught exception');
    assertIncludes(sentMessages[0].text, "Couldn't load your QMS stats", 'friendly error message shown on failure');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 3: MY GOALS
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 3: MY GOALS ──────────────────────────────────');

  {
    const { deps, sentMessages } = buildDeps({
      getGrowthPlanSummary: () => ({ countsByStatus: {}, recentPlans: [] }),
    });
    await handleQmsFlow('27821110000', 'MY GOALS', deps);
    assertIncludes(sentMessages[0].text, "haven't logged any growth plans yet", 'empty-state message shown');
    assertIncludes(sentMessages[0].text, 'NEW GOAL', 'empty-state points at NEW GOAL');
  }

  {
    let receivedOptions = null;
    const { deps, sentMessages } = buildDeps({
      getGrowthPlanSummary: (hash, opts) => {
        receivedOptions = opts;
        return {
          countsByStatus: { active: 2, completed: 1 },
          recentPlans: [
            { goalText: 'Improve questioning technique', targetArea: 'Pedagogy', status: 'active' },
            { goalText: 'Reduce marking turnaround', targetArea: null, status: 'completed' },
          ],
        };
      },
    });
    await handleQmsFlow('27821110000', 'MY GOALS', deps);
    assert(receivedOptions && receivedOptions.recentLimit === 5, 'getGrowthPlanSummary called with recentLimit: 5');
    const msg = sentMessages[0].text;
    assertIncludes(msg, '2 active', 'status counts shown');
    assertIncludes(msg, '1 completed', 'status counts shown (second status)');
    assertIncludes(msg, 'Improve questioning technique (Pedagogy) — active', 'plan with targetArea rendered correctly');
    assertIncludes(msg, 'Reduce marking turnaround — completed', 'plan without targetArea omits the parens');
  }

  {
    const { deps, sentMessages } = buildDeps({
      getGrowthPlanSummary: () => { throw new Error('boom'); },
    });
    const handled = await handleQmsFlow('27821110000', 'MY GOALS', deps);
    assert(handled === true, 'a thrown error from getGrowthPlanSummary is still handled');
    assertIncludes(sentMessages[0].text, "Couldn't load your growth plans", 'friendly error message shown on failure');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 4: MY REFLECTIONS
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 4: MY REFLECTIONS ────────────────────────────');

  {
    const { deps, sentMessages } = buildDeps({
      getCurrentTerm: () => 2,
      listReflections: () => [],
    });
    await handleQmsFlow('27821110000', 'MY REFLECTIONS', deps);
    assertIncludes(sentMessages[0].text, 'No reflections logged for Term 2 yet', 'empty-state mentions the resolved term');
    assertIncludes(sentMessages[0].text, 'REFLECT', 'empty-state points at REFLECT');
  }

  {
    const { deps, sentMessages } = buildDeps({
      getCurrentTerm: () => null,
      listReflections: (hash, opts) => {
        assert(!('term' in opts), 'listReflections called without a term filter when getCurrentTerm() is null');
        return [];
      },
    });
    await handleQmsFlow('27821110000', 'MY REFLECTIONS', deps);
    assertIncludes(sentMessages[0].text, 'No reflections logged yet', 'empty-state has no term suffix when term is null');
  }

  {
    let receivedOptions = null;
    const { deps, sentMessages } = buildDeps({
      getCurrentTerm: () => 3,
      listReflections: (hash, opts) => {
        receivedOptions = opts;
        return [
          { content: 'Short reflection.', createdAt: '2026-07-20 09:00:00' },
          { content: 'A'.repeat(120), createdAt: '2026-07-18 09:00:00' },
        ];
      },
    });
    await handleQmsFlow('27821110000', 'MY REFLECTIONS', deps);
    assert(receivedOptions && receivedOptions.term === 3, 'listReflections called with the resolved term');
    const msg = sentMessages[0].text;
    assertIncludes(msg, 'Term 3', 'header shows the term');
    assertIncludes(msg, '(2 total)', 'header shows the total count');
    assertIncludes(msg, 'Short reflection.', 'short content shown in full');
    assertIncludes(msg, '2026-07-20', 'date shown for first entry');
    assert(msg.includes('…'), 'long content is truncated with an ellipsis');
    assert(!msg.includes('A'.repeat(120)), 'long content is not shown in full');
  }

  {
    const { deps, sentMessages } = buildDeps({
      getCurrentTerm: () => 1,
      listReflections: () => Array.from({ length: 7 }, (_, i) => ({
        content: `Reflection ${i + 1}`,
        createdAt: '2026-07-01 09:00:00',
      })),
    });
    await handleQmsFlow('27821110000', 'MY REFLECTIONS', deps);
    const msg = sentMessages[0].text;
    assertIncludes(msg, '(7 total)', 'total count reflects all 7, not just the shown 5');
    assertIncludes(msg, 'Reflection 5', 'fifth (last shown) reflection present');
    assert(!msg.includes('Reflection 6'), 'sixth reflection not individually listed');
    assertIncludes(msg, '...and 2 more', 'overflow count shown for remaining reflections');
  }

  {
    const { deps, sentMessages } = buildDeps({
      getCurrentTerm: () => 2,
      listReflections: () => { throw new Error('boom'); },
    });
    const handled = await handleQmsFlow('27821110000', 'MY REFLECTIONS', deps);
    assert(handled === true, 'a thrown error from listReflections is still handled');
    assertIncludes(sentMessages[0].text, "Couldn't load your reflections", 'friendly error message shown on failure');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 5: isolation between commands (no cross-talk)
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Section 5: no cross-command leakage ──────────────────');

  {
    let getSummaryCalled = false;
    let getGrowthPlanSummaryCalled = false;
    let listReflectionsCalled = false;
    const { deps } = buildDeps({
      getSummary: () => { getSummaryCalled = true; return { reflectionCount: 0, growthPlanCountsByStatus: {}, latestActivity: null }; },
      getGrowthPlanSummary: () => { getGrowthPlanSummaryCalled = true; return { countsByStatus: {}, recentPlans: [] }; },
      listReflections: () => { listReflectionsCalled = true; return []; },
    });
    await handleQmsFlow('27821110000', 'MY GOALS', deps);
    assert(getGrowthPlanSummaryCalled, 'MY GOALS calls getGrowthPlanSummary');
    assert(!getSummaryCalled, 'MY GOALS does not call getSummary');
    assert(!listReflectionsCalled, 'MY GOALS does not call listReflections');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`qmsFlow.test.js Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
