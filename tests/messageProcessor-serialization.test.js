'use strict';
// Regression test for the Cycle 11 fix to core/messageProcessor.js:
// per-phoneHash serialization of processMessage().
//
// Bug: two separate webhook deliveries for the SAME teacher (phoneHash),
// arriving close together, ran fully concurrently. Any flow that reads
// session state, does real async work (AI generation, outbound sends),
// then writes session state back — e.g. flows/reportCommentFlow.js's
// batch loop — was vulnerable to a lost-update race: message B reads the
// same pre-message-A session state during message A's async gap, and
// whichever call's final state write lands last silently overwrites the
// other's, discarding already-quota-charged teacher work.
//
// This exercises the real, unmodified core/messageProcessor.js exported
// processMessage() — not a reimplementation of the serialization logic —
// via the document/image dispatch branch, which reaches a real, awaited
// dependency call (deps.handleAssessmentFlow) after only a few earlier
// dependencies (isDuplicate/getTeacherByPhone/encryptPhone/
// updateTeacherProfile/hashPhone/dataAssessmentState.get), giving a
// realistic, controllable async gap to prove the fix against.
//
// Proves:
//   1. Two calls for the SAME phoneHash never overlap in time.
//   2. Two calls for DIFFERENT phoneHashes DO run concurrently (the fix
//      must not become an accidental global lock).
//   3. The legitimate re-entrant call pattern (a handler that calls
//      processMessage() again for the same phoneHash from inside an
//      already-in-flight call, as mainMenuFlow's reDispatchAsText does)
//      completes without deadlocking.

const assert = require('assert');
const { processMessage } = require('../core/messageProcessor');

function later(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeDeps({ onHandleAssessmentFlow }) {
  return {
    isDuplicate: () => false,
    getTeacherByPhone: () => null, // no opted_out branch taken
    updateTeacherProfile: () => {},
    encryptPhone: () => 'enc',
    hashPhone: (from) => `hash:${from}`,
    dataAssessmentState: { get: () => ({ some: 'state' }) }, // truthy -> enters handleAssessmentFlow
    handleAssessmentFlow: onHandleAssessmentFlow,
    buildAssessmentDeps: () => ({}),
    async safeSendMessage() {},
  };
}

function docMessage(from, id) {
  return { from, id, type: 'document' };
}

async function run() {
  // ── Test 1: same phoneHash calls do not overlap ──────────────────────
  {
    const events = [];
    const deps = makeDeps({
      onHandleAssessmentFlow: async () => {
        events.push('start');
        await later(30);
        events.push('end');
        return true; // claimed — short-circuits processMessage
      },
    });

    await Promise.all([
      processMessage(docMessage('27821111111', 'a1'), deps),
      processMessage(docMessage('27821111111', 'a2'), deps),
    ]);

    assert.deepStrictEqual(
      events,
      ['start', 'end', 'start', 'end'],
      `same-phoneHash calls must not interleave, got: ${JSON.stringify(events)}`
    );
  }

  // ── Test 2: different phoneHash calls DO run concurrently ────────────
  {
    const events = [];
    const deps = makeDeps({
      onHandleAssessmentFlow: async () => {
        events.push('start');
        await later(30);
        events.push('end');
        return true;
      },
    });

    await Promise.all([
      processMessage(docMessage('27821111111', 'b1'), deps),
      processMessage(docMessage('27822222222', 'b2'), deps),
    ]);

    assert.deepStrictEqual(
      events,
      ['start', 'start', 'end', 'end'],
      `different-phoneHash calls must run concurrently, got: ${JSON.stringify(events)}`
    );
  }

  // ── Test 3: legitimate re-entrant call does not deadlock ─────────────
  {
    let reentered = false;
    const deps = makeDeps({
      onHandleAssessmentFlow: async () => {
        if (!reentered) {
          reentered = true;
          // Re-enter processMessage() for the SAME phoneHash, exactly as
          // mainMenuFlow's reDispatchAsText() does from inside a live call.
          await processMessage(docMessage('27823333333', 'reentrant'), deps);
        }
        return true;
      },
    });

    // If this hangs, the test runner's own timeout will fail the test —
    // that failure mode IS the deadlock this case guards against.
    await processMessage(docMessage('27823333333', 'outer'), deps);
    assert.strictEqual(reentered, true, 'expected the re-entrant path to have run');
  }

  console.log('✅ messageProcessor-serialization.test.js — all 3 cases passed');
}

run().catch((err) => {
  console.error('❌ messageProcessor-serialization.test.js FAILED:', err.message);
  process.exitCode = 1;
});
