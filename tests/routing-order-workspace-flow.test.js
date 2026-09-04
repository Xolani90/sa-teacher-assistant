'use strict';
/**
 * Workspace flow wiring + routing-order regression test.
 *
 * Companion to tests/routing-order-assessment-session-priority.test.js and
 * tests/routing-order-observation-priority.test.js. Written after manually
 * confirming (in a live debugging session) that flows/workspaceFlow.js —
 * extracted from routes/webhook.js — is genuinely wired into
 * core/commandHandler.js and reachable via processMessage(). That
 * confirmation is only useful once unless it's captured here.
 *
 * Covers two things:
 *
 * 1. STRUCTURAL: handleWorkspaceFlow() is actually required and called by
 *    core/commandHandler.js, and handleCommand() (which owns it) runs
 *    before the alreadyMidFlow / session-state gate in
 *    core/messageProcessor.js — the same tier as STOP. This is source-level,
 *    matching the style of the existing routing-order tests.
 *
 * 2. FUNCTIONAL: handleWorkspaceFlow() itself, called directly, correctly
 *    handles MY CLASSES / NEW CLASS / MY ASSESSMENTS / MY PROGRESS /
 *    WORKSPACE, falls through on non-workspace text, and — critically —
 *    does NOT touch or clear assessmentSessionState / observationState.
 *    Workspace commands are a global "peek" utility, not a session-ending
 *    command like CANCEL: an active capture session must survive
 *    untouched underneath a workspace command, exactly like it survives
 *    underneath STOP being *unrelated* text. If a future change makes
 *    workspaceFlow reach into session state and clear it, this test fails.
 *
 * Run individually: node tests/routing-order-workspace-flow.test.js
 * Run via npm:       npm test
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (!cond) {
    console.log(`  ❌ ${label}`);
    failed++;
  } else {
    console.log(`  ✅ ${label}`);
    passed++;
  }
}

console.log('Workspace flow wiring + routing-order regression');
console.log('='.repeat(75));

// ── Part 1: structural — source-level wiring checks ────────────────────
{
  const COMMAND_HANDLER_PATH = path.join(__dirname, '..', 'core', 'commandHandler.js');
  const MESSAGE_PROCESSOR_PATH = path.join(__dirname, '..', 'core', 'messageProcessor.js');
  const commandHandlerSource = fs.readFileSync(COMMAND_HANDLER_PATH, 'utf8');
  const messageProcessorSource = fs.readFileSync(MESSAGE_PROCESSOR_PATH, 'utf8');

  assert(
    commandHandlerSource.includes("require('../flows/workspaceFlow')"),
    'core/commandHandler.js requires flows/workspaceFlow.js'
  );
  assert(
    commandHandlerSource.includes('handleWorkspaceFlow(from, text, buildWorkspaceDeps())'),
    'core/commandHandler.js actually calls handleWorkspaceFlow()'
  );

  // handleCommand() (which owns workspace routing) must be called before the
  // alreadyMidFlow gate — this is a deliberate design choice (workspace
  // commands are global utility commands, same tier as STOP), not an
  // oversight. This assertion documents and locks in that choice.
  const commandCallSite = messageProcessorSource.indexOf('deps.handleCommand(from, text)');
  const midFlowGate = messageProcessorSource.indexOf('const alreadyMidFlow');
  assert(commandCallSite !== -1, 'handleCommand() call site found in messageProcessor.js');
  assert(midFlowGate !== -1, 'alreadyMidFlow gate found in messageProcessor.js');
  assert(
    commandCallSite !== -1 && midFlowGate !== -1 && commandCallSite < midFlowGate,
    'handleCommand() (and therefore workspace routing) runs before the alreadyMidFlow session gate — global-utility tier, same as STOP'
  );
}

// ── Part 2: functional — handleWorkspaceFlow() behaviour ───────────────
async function runFunctional() {
  const { handleWorkspaceFlow } = require('../flows/workspaceFlow');

  // Real DB-backed SessionStore, same pattern as
  // tests/assessment-session-flow.test.js, so "does it touch session
  // state" is a real assertion against the real SessionStore, not a mock.
  const dbPath = path.resolve(__dirname, '../utils/database');
  const Module = require('module');
  const _origResolve = Module._resolveFilename.bind(Module);
  Module._resolveFilename = function (request, parent, isMain, opts) {
    if (request === 'better-sqlite3') return request;
    if (request === '../utils/database' || request === './database') return dbPath;
    return _origResolve(request, parent, isMain, opts);
  };
  const _db = new DatabaseSync(':memory:');
  require.cache['better-sqlite3'] = {
    id: 'better-sqlite3', filename: 'better-sqlite3', loaded: true,
    exports: function Database() { if (!_db.pragma) _db.pragma = () => {}; return _db; },
  };
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getDb: () => _db } };
  _db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      phone_hash    TEXT    NOT NULL,
      session_type  TEXT    NOT NULL,
      state         TEXT    NOT NULL,
      updated_at    REAL    NOT NULL,
      PRIMARY KEY (phone_hash, session_type)
    );
  `);

  const { SessionStore } = require('../utils/sessionStore');
  const assessmentSessionState = new SessionStore('assessmentSession', 24 * 60 * 60 * 1000);
  const observationState = new SessionStore('observation', 24 * 60 * 60 * 1000);

  const PHONE = '+27831234567';
  const hashPhone = (p) => `hash_${p}`;
  const phoneHash = hashPhone(PHONE);

  let sent = [];
  const deps = {
    hashPhone,
    getTeacherByPhone: () => ({ grade: 7, subject: 'Mathematics' }),
    safeSendMessage: async (from, text) => { sent.push({ from, text }); },
    gradeLabel: (g) => `Grade ${g}`,
    getTeacherClasses: () => ([{ id: 1, name: 'Grade 7A', grade: 7, subject: 'Mathematics', learner_count: 30 }]),
    getActiveRosterCounts: () => new Map([[1, 30]]),
    createClass: () => ({ id: 2, name: 'New Class' }),
    getAssessmentHistory: () => ([]),
    validateNewClassInput: () => ({ valid: true, name: 'New Class', count: 25 }),
    getTeacherProgressReport: () => ({ dataAvailable: false }),
    calendarQuery: async () => 'calendar summary',
    searchLearnersByName: () => ([{ id: 1, canonicalName: 'Sipho Dlamini' }]),
    getLearnerInterventionPlan: () => ([{
      learnerId: 1,
      subject: 'Mathematics',
      priority: 'medium',
      focusTopics: ['Fractions'],
      recommendedActions: ['Continue monitoring — performance is developing steadily.'],
      evidence: {
        mastery: {
          learnerId: 1,
          subject: 'Mathematics',
          masteryLevel: 'developing',
          confidence: 0.6,
          evidence: { progress: { trend: 'rising' }, coverage: { dataAvailable: true, averagePercentage: 72 }, timeline: { eventCount: 5 } },
          strengths: ['Number Patterns'],
          concerns: ['Geometry'],
        },
        progress: { trend: 'rising' },
        coverage: { dataAvailable: true, averagePercentage: 72 },
      },
    }]),
  };

  console.log('\n── Section 1: each documented workspace command routes correctly ──');
  const workspaceCommands = ['MY CLASSES', 'WORKSPACE', 'MY ASSESSMENTS', 'MY PROGRESS', 'NEW CLASS Test Class, 25', 'LEARNER PROGRESS Sipho'];
  for (const cmd of workspaceCommands) {
    sent = [];
    const handled = await handleWorkspaceFlow(PHONE, cmd, deps);
    assert(handled === true, `"${cmd}" is handled by handleWorkspaceFlow`);
    assert(sent.length > 0, `"${cmd}" produces a reply to the teacher`);
  }

  console.log('\n── Section 2: non-workspace text falls through ──');
  {
    sent = [];
    const handled = await handleWorkspaceFlow(PHONE, 'HELLO', deps);
    assert(handled === false, '"HELLO" is not handled by handleWorkspaceFlow');
    assert(sent.length === 0, '"HELLO" produces no reply from workspaceFlow');
  }

  console.log('\n── Section 3: workspace commands do not clobber an active assessment session ──');
  {
    assessmentSessionState.set(phoneHash, { step: 'ACTIVE', learnerIndex: 1, questionIndex: 0 });
    sent = [];
    const handled = await handleWorkspaceFlow(PHONE, 'MY CLASSES', deps);
    assert(handled === true, 'MY CLASSES is still handled while a capture session is active');
    const stillActive = assessmentSessionState.get(phoneHash);
    assert(
      Boolean(stillActive) && stillActive.step === 'ACTIVE' && stillActive.learnerIndex === 1,
      'the active assessment session survives untouched underneath a workspace command'
    );
    assessmentSessionState.delete(phoneHash);
  }

  console.log('\n── Section 4: workspace commands do not clobber an active observation session ──');
  {
    observationState.set(phoneHash, { records: [{ learnerName: 'Sipho' }] });
    sent = [];
    const handled = await handleWorkspaceFlow(PHONE, 'WORKSPACE', deps);
    assert(handled === true, 'WORKSPACE is still handled while an observation capture is active');
    const stillActive = observationState.get(phoneHash);
    assert(
      Boolean(stillActive) && Array.isArray(stillActive.records) && stillActive.records.length === 1,
      'the active observation session survives untouched underneath a workspace command'
    );
    observationState.delete(phoneHash);
  }

  console.log('\n── Section 5: LEARNER PROGRESS <name> branches ──');
  {
    sent = [];
    await handleWorkspaceFlow(PHONE, 'LEARNER PROGRESS', deps);
    assert(sent.length > 0 && /Format/.test(sent[0].text), 'bare "LEARNER PROGRESS" (no name) shows usage prompt');

    sent = [];
    const noMatchDeps = { ...deps, searchLearnersByName: () => ([]) };
    await handleWorkspaceFlow(PHONE, 'LEARNER PROGRESS Zzz', noMatchDeps);
    assert(sent.length > 0 && /No learner matching/.test(sent[0].text), 'no match tells the teacher rather than erroring');

    sent = [];
    const multiMatchDeps = { ...deps, searchLearnersByName: () => ([{ id: 1, canonicalName: 'Sipho Dlamini' }, { id: 2, canonicalName: 'Sipho Nkosi' }]) };
    await handleWorkspaceFlow(PHONE, 'LEARNER PROGRESS Sipho', multiMatchDeps);
    assert(sent.length > 0 && /Multiple learners match/.test(sent[0].text), 'multiple matches asks the teacher to narrow down');
    assert(sent[0].text.includes('Sipho Dlamini') && sent[0].text.includes('Sipho Nkosi'), 'ambiguous-match reply lists both candidate names');

    sent = [];
    await handleWorkspaceFlow(PHONE, 'LEARNER PROGRESS Sipho Dlamini', deps);
    assert(sent.length > 0 && sent[0].text.includes('Sipho Dlamini'), 'single match resolves and names the learner');
    assert(sent[0].text.includes('Mathematics'), 'reply includes the subject from the MasteryReport');
    assert(/Developing/.test(sent[0].text), 'reply includes the human-readable mastery level');
    assert(sent[0].text.includes('Improving'), 'reply includes the progress trend label');
    assert(sent[0].text.includes('72%'), 'reply includes the coverage percentage');
    assert(sent[0].text.includes('Number Patterns'), 'reply includes strengths');
    assert(sent[0].text.includes('Geometry'), 'reply includes concerns/focus areas');
    assert(sent[0].text.includes('Intervention'), 'reply includes the new Intervention section');
    assert(sent[0].text.includes('Priority: Medium'), 'reply includes the intervention priority');
    assert(sent[0].text.includes('Continue monitoring — performance is developing steadily.'), 'reply includes the recommended action(s)');

    sent = [];
    const noEvidenceDeps = { ...deps, getLearnerInterventionPlan: () => ([]) };
    await handleWorkspaceFlow(PHONE, 'LEARNER PROGRESS Sipho Dlamini', noEvidenceDeps);
    assert(sent.length > 0 && /No assessment or observation data/.test(sent[0].text), 'a resolved learner with zero InterventionPlans gets a graceful message, not a crash');

    sent = [];
    const insufficientDataDeps = {
      ...deps,
      getLearnerInterventionPlan: () => ([{
        learnerId: 1,
        subject: 'Mathematics',
        priority: 'medium',
        focusTopics: [],
        recommendedActions: ['Gather more assessment or observation evidence before planning an intervention.'],
        evidence: {
          mastery: { learnerId: 1, subject: 'Mathematics', masteryLevel: 'insufficient-data', confidence: 0, evidence: {}, strengths: [], concerns: [] },
          progress: {},
          coverage: { dataAvailable: false, averagePercentage: null },
        },
      }]),
    };
    await handleWorkspaceFlow(PHONE, 'LEARNER PROGRESS Sipho Dlamini', insufficientDataDeps);
    assert(sent.length > 0 && !sent[0].text.includes('Intervention'), 'an insufficient-data subject shows no redundant Intervention block');
  }

  console.log(`\n${'─'.repeat(60)}\nWorkspace Flow Routing Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runFunctional();