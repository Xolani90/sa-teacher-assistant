'use strict';
/**
 * CLASS INTERVENTION command tests (ADR-009, PR12).
 *
 * flows/workspaceFlow.js's CLASS INTERVENTION handler is pure orchestration
 * (parse selector -> resolve class -> call
 * ClassInterventionService.getClassInterventionPlan() -> format reply), so
 * this suite mocks getClassInterventionPlan and getTeacherClasses directly
 * via deps injection — same isolation discipline as
 * tests/routing-order-workspace-flow.test.js and
 * tests/classInterventionService.test.js (which already covers the
 * aggregation logic itself; this file does not re-test that logic).
 *
 * Run individually:   node tests/workspaceFlow-classIntervention.test.js
 * Run via npm:         npm test
 */

const { handleWorkspaceFlow } = require('../flows/workspaceFlow');

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

const PHONE = '+27831234567';

function makeBaseDeps(overrides = {}) {
  let sent = [];
  const deps = {
    hashPhone: (p) => `hash_${p}`,
    getTeacherByPhone: () => ({ grade: 7, subject: 'Mathematics' }),
    safeSendMessage: async (from, text) => { sent.push({ from, text }); },
    gradeLabel: (g) => `Grade ${g}`,
    getTeacherClasses: () => ([]),
    getActiveRosterCounts: () => new Map(),
    createClass: () => ({}),
    getAssessmentHistory: () => ([]),
    validateNewClassInput: () => ({ valid: true }),
    getTeacherProgressReport: () => ({ dataAvailable: false }),
    calendarQuery: async () => '',
    searchLearnersByName: () => ([]),
    getLearnerInterventionPlan: () => ([]),
    getClassInterventionPlan: () => { throw new Error('getClassInterventionPlan should not be called in this test'); },
    ...overrides,
  };
  return { deps, getSent: () => sent };
}

function emptyClassPlan(classId, overrides = {}) {
  return {
    classId,
    summary: { totalLearners: 0, evaluatedLearners: 0, insufficientData: 0, erroredLearners: 0 },
    priorityCounts: { high: 0, medium: 0, low: 0 },
    commonFocusTopics: [],
    priorityLearners: { high: [], medium: [], low: [] },
    errors: [],
    ...overrides,
  };
}

async function run() {
  console.log('CLASS INTERVENTION command tests');
  console.log('='.repeat(75));

  // ── Section 1: zero classes ──
  console.log('\n── Section 1: zero classes ──');
  {
    const { deps, getSent } = makeBaseDeps({ getTeacherClasses: () => ([]) });
    const handled = await handleWorkspaceFlow(PHONE, 'CLASS INTERVENTION', deps);
    assert(handled === true, '"CLASS INTERVENTION" is handled');
    const sent = getSent();
    assert(sent.length > 0 && /No classes yet/.test(sent[0].text), 'zero classes tells the teacher to create one first');
    assert(sent.length > 0 && /NEW CLASS/.test(sent[0].text), 'zero-class reply points at NEW CLASS');
  }

  // ── Section 2: exactly one class — auto-resolves, no selector needed ──
  console.log('\n── Section 2: exactly one class ──');
  {
    let capturedArgs = null;
    const { deps, getSent } = makeBaseDeps({
      getTeacherClasses: () => ([{ id: 5, name: 'Grade 7A Mathematics' }]),
      getClassInterventionPlan: (hash, classId) => {
        capturedArgs = { hash, classId };
        return emptyClassPlan(classId, {
          summary: { totalLearners: 3, evaluatedLearners: 2, insufficientData: 1, erroredLearners: 0 },
          priorityCounts: { high: 1, medium: 1, low: 0 },
          priorityLearners: {
            high: [{ learnerId: 1, learnerName: 'Amahle', overallPriority: 'high', subjectPlans: [] }],
            medium: [{ learnerId: 2, learnerName: 'Bongani', overallPriority: 'medium', subjectPlans: [] }],
            low: [],
          },
          commonFocusTopics: [{ subject: 'Mathematics', topic: 'Fractions', affectedLearners: 2, percentage: 0.67 }],
        });
      },
    });
    const handled = await handleWorkspaceFlow(PHONE, 'CLASS INTERVENTION', deps);
    assert(handled === true, '"CLASS INTERVENTION" with one class is handled');
    assert(capturedArgs && capturedArgs.classId === 5, 'auto-resolves the sole class and passes its id to the service');
    assert(capturedArgs && capturedArgs.hash === 'hash_+27831234567', 'passes the hashed phone through to the service');

    const sent = getSent();
    assert(sent.length > 0 && sent[0].text.includes('Grade 7A Mathematics'), 'reply names the class');
    assert(sent[0].text.includes('3 learner(s)'), 'reply includes total learner count');
    assert(sent[0].text.includes('2 evaluated'), 'reply includes evaluated count');
    assert(sent[0].text.includes('1 awaiting data'), 'reply includes insufficient-data count');
    assert(sent[0].text.includes('High: 1'), 'reply includes high priority count');
    assert(sent[0].text.includes('Medium: 1'), 'reply includes medium priority count');
    assert(sent[0].text.includes('Amahle'), 'reply lists the high-priority learner by name');
    assert(sent[0].text.includes('Bongani'), 'reply lists the medium-priority learner by name');
    assert(sent[0].text.includes('Fractions'), 'reply lists the common focus topic');
    assert(sent[0].text.includes('67%'), 'reply includes the common-topic percentage');
    assert(sent[0].text.includes('LEARNER PROGRESS'), 'reply points at LEARNER PROGRESS for individual follow-up');
  }

  // ── Section 3: 2+ classes, no selector — prompts, does not call the service ──
  console.log('\n── Section 3: 2+ classes, no selector ──');
  {
    let serviceCalled = false;
    const { deps, getSent } = makeBaseDeps({
      getTeacherClasses: () => ([
        { id: 1, name: 'Grade 7A Mathematics' },
        { id: 2, name: 'Grade 8B Mathematics' },
      ]),
      getClassInterventionPlan: () => { serviceCalled = true; return emptyClassPlan(1); },
    });
    const handled = await handleWorkspaceFlow(PHONE, 'CLASS INTERVENTION', deps);
    assert(handled === true, '"CLASS INTERVENTION" with 2+ classes and no selector is handled');
    assert(serviceCalled === false, 'the service is not called when the class is still ambiguous');
    const sent = getSent();
    assert(sent.length > 0 && /Which class/.test(sent[0].text), 'prompts the teacher to choose a class');
    assert(sent[0].text.includes('Grade 7A Mathematics') && sent[0].text.includes('Grade 8B Mathematics'), 'lists both candidate classes');
    assert(sent[0].text.includes('1.') && sent[0].text.includes('2.'), 'numbers the classes for selection');
  }

  // ── Section 4: 2+ classes, numeric selector ──
  console.log('\n── Section 4: 2+ classes, numeric selector ──');
  {
    let capturedClassId = null;
    const { deps, getSent } = makeBaseDeps({
      getTeacherClasses: () => ([
        { id: 1, name: 'Grade 7A Mathematics' },
        { id: 2, name: 'Grade 8B Mathematics' },
      ]),
      getClassInterventionPlan: (hash, classId) => { capturedClassId = classId; return emptyClassPlan(classId); },
    });
    const handled = await handleWorkspaceFlow(PHONE, 'CLASS INTERVENTION 2', deps);
    assert(handled === true, '"CLASS INTERVENTION 2" is handled');
    assert(capturedClassId === 2, 'numeric selector resolves to the correct class by position');
    const sent = getSent();
    assert(sent.length > 0 && sent[0].text.includes('Grade 8B Mathematics'), 'reply names the selected class');
  }

  // ── Section 5: 2+ classes, name selector ──
  console.log('\n── Section 5: 2+ classes, name selector ──');
  {
    let capturedClassId = null;
    const { deps, getSent } = makeBaseDeps({
      getTeacherClasses: () => ([
        { id: 1, name: 'Grade 7A Mathematics' },
        { id: 2, name: 'Grade 8B Mathematics' },
      ]),
      getClassInterventionPlan: (hash, classId) => { capturedClassId = classId; return emptyClassPlan(classId); },
    });
    const handled = await handleWorkspaceFlow(PHONE, 'CLASS INTERVENTION 8B', deps);
    assert(handled === true, '"CLASS INTERVENTION 8B" is handled');
    assert(capturedClassId === 2, 'substring name selector resolves to the correct class');
    const sent = getSent();
    assert(sent.length > 0 && sent[0].text.includes('Grade 8B Mathematics'), 'reply names the selected class');
  }

  // ── Section 6: 2+ classes, unmatched selector ──
  console.log('\n── Section 6: 2+ classes, unmatched selector ──');
  {
    let serviceCalled = false;
    const { deps, getSent } = makeBaseDeps({
      getTeacherClasses: () => ([
        { id: 1, name: 'Grade 7A Mathematics' },
        { id: 2, name: 'Grade 8B Mathematics' },
      ]),
      getClassInterventionPlan: () => { serviceCalled = true; return emptyClassPlan(1); },
    });
    const handled = await handleWorkspaceFlow(PHONE, 'CLASS INTERVENTION Grade 9', deps);
    assert(handled === true, 'unmatched selector is still handled (no crash)');
    assert(serviceCalled === false, 'the service is not called for an unmatched selector');
    const sent = getSent();
    assert(sent.length > 0 && /couldn't match/i.test(sent[0].text), 'tells the teacher the selector did not match');
    assert(sent[0].text.includes('Grade 7A Mathematics') && sent[0].text.includes('Grade 8B Mathematics'), 're-lists the candidate classes');
  }

  // ── Section 7: empty class (zero learners) ──
  console.log('\n── Section 7: class with zero learners ──');
  {
    const { deps, getSent } = makeBaseDeps({
      getTeacherClasses: () => ([{ id: 9, name: 'New Class' }]),
      getClassInterventionPlan: (hash, classId) => emptyClassPlan(classId),
    });
    const handled = await handleWorkspaceFlow(PHONE, 'CLASS INTERVENTION', deps);
    assert(handled === true, 'a class with zero learners is handled');
    const sent = getSent();
    assert(sent.length > 0 && /no learners recorded/i.test(sent[0].text), 'graceful message for an empty roster, not a crash or empty report');
  }

  // ── Section 8: service throws — fault isolation, no crash ──
  console.log('\n── Section 8: service error ──');
  {
    const { deps, getSent } = makeBaseDeps({
      getTeacherClasses: () => ([{ id: 9, name: 'Grade 7A Mathematics' }]),
      getClassInterventionPlan: () => { throw new Error('boom'); },
    });
    const handled = await handleWorkspaceFlow(PHONE, 'CLASS INTERVENTION', deps);
    assert(handled === true, 'a thrown error from the service is still handled, not an uncaught exception');
    const sent = getSent();
    assert(sent.length > 0 && /couldn't load the class intervention report/i.test(sent[0].text), 'teacher gets a friendly error message');
  }

  // ── Section 9: priority learner list capped at 8 with overflow note ──
  console.log('\n── Section 9: long priority list is capped ──');
  {
    const manyHigh = Array.from({ length: 10 }, (_, i) => ({
      learnerId: i + 1, learnerName: `Learner${i + 1}`, overallPriority: 'high', subjectPlans: [],
    }));
    const { deps, getSent } = makeBaseDeps({
      getTeacherClasses: () => ([{ id: 9, name: 'Grade 7A Mathematics' }]),
      getClassInterventionPlan: (hash, classId) => emptyClassPlan(classId, {
        summary: { totalLearners: 10, evaluatedLearners: 10, insufficientData: 0, erroredLearners: 0 },
        priorityCounts: { high: 10, medium: 0, low: 0 },
        priorityLearners: { high: manyHigh, medium: [], low: [] },
      }),
    });
    await handleWorkspaceFlow(PHONE, 'CLASS INTERVENTION', deps);
    const sent = getSent();
    assert(sent.length > 0 && sent[0].text.includes('Learner1') && sent[0].text.includes('Learner8'), 'shows the first 8 learners in the bucket');
    assert(!sent[0].text.includes('Learner9') && !sent[0].text.includes('Learner10'), 'does not show learners beyond the display cap inline');
    assert(/and 2 more/.test(sent[0].text), 'notes how many additional learners were truncated');
  }

  // ── Section 10: existing commands still work (no regression) ──
  console.log('\n── Section 10: no regression to existing commands ──');
  {
    const { deps, getSent } = makeBaseDeps({
      getTeacherClasses: () => ([{ id: 1, name: 'Grade 7A Mathematics', grade: 7, subject: 'Mathematics', learner_count: 30 }]),
    });
    for (const cmd of ['MY CLASSES', 'WORKSPACE', 'MY ASSESSMENTS', 'MY PROGRESS']) {
      const sent = getSent();
      sent.length = 0;
      const handled = await handleWorkspaceFlow(PHONE, cmd, deps);
      assert(handled === true, `"${cmd}" still handled after adding CLASS INTERVENTION`);
      assert(getSent().length > 0, `"${cmd}" still produces a reply`);
    }
  }

  // ── Section 11: non-workspace text still falls through ──
  console.log('\n── Section 11: fallthrough unaffected ──');
  {
    const { deps, getSent } = makeBaseDeps();
    const handled = await handleWorkspaceFlow(PHONE, 'HELLO', deps);
    assert(handled === false, '"HELLO" still falls through to normal processing');
    assert(getSent().length === 0, 'no reply sent for non-workspace text');
  }

  console.log(`\n${'─'.repeat(60)}\nCLASS INTERVENTION Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
