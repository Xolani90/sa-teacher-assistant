'use strict';

const express = require('express');
const router  = express.Router();

const { parseIntent }            = require('../utils/intentParser');
const { classifyIntent }         = require('../services/intentClassifier');
const { buildPrompt }            = require('../services/promptService');
const { generateContent }        = require('../services/aiService');
const { sendMessage, sendDocument, downloadMedia } = require('../services/whatsappService');
const { recordStatusWebhook } = require('../services/deliveryEventRepository');
const { parseMarks, extractMarksFromImage, getFormatHelpText } = require('../utils/marksParser');
const { processAssessmentData } = require('../services/diagnosticWorkflowService');
const { generateConversationalResponse, isConversationalIntent } = require('../services/conversationService');
const { generateConversationalReplyAI } = require('../services/conversationalReply');
const {
  checkAndIncrementUsage,
  getUsageInfo,
  getTeacherByPhone,
  updateTeacherProfile,
  isProActive,
  hashPhone,
} = require('../utils/usageTracker');
const { isDuplicate }            = require('../utils/deduplication');
const { handleOnboarding, needsOnboarding } = require('../services/onboardingService');
const { generatePdf, generateReportSummaryPdf, generateBlueprintAssessmentPdf, generateBlueprintPaperPdf } = require('../services/pdfService');
const { getWorksheetTotalMarks } = require('../utils/capsPhase');
const { buildPaymentUrl }        = require('../services/yocoService');
const { encryptPhone }           = require('../utils/encryption');
const { SessionStore } = require('../utils/sessionStore');
const { isCeilingReached } = require('../utils/aiCostMonitor');
const { handleCurriculumQuery } = require('../services/curriculumIntelligenceService');
const { gradeLabel, parseGrade } = require('../utils/capsPhase');
const { buildFullInterventionPlanPrompt } = require('../prompts/fullInterventionPlan');
const { processObservationSubmission } = require('../utils/observationWorkflowService');
const { getObservationFormatHelpText } = require('../utils/observationParser');
const { saveObservationSubmission, getObservationHistory, getObservationAssessment, appendObservationNote, deleteObservationAssessment, resolveObservationRecord } = require('../services/observationRepository');
const { analyzeObservations } = require('../services/observationAnalysisService');
// ADR-004: class-context resolution for assessment/observation flows.
const { getTeacherClasses } = require('../services/teacherWorkspaceService');
const { formatClassSelectionPrompt, matchClassSelection } = require('../utils/classContext');
const {
  rollbackUsage,
  isAiRateLimited,
  isClassifierRateLimited,
  clearAllSessions,
  safeSendMessage,
  intentLabel,
  FREE_LIMIT_DISPLAY,
} = require('../utils/webhookHelpers');

const {
  saveReport,
  getSavedReport,
  generateHodSummary,
  generateParentSummary,
  generateTeacherSummary,
  generateInterventionReport,
} = require('../services/interventionReportsService');

// ── Multi-turn session state (SQLite-backed, survives deploys) ────────────
// Each store is scoped by session type. TTL is enforced on read.
const reportCommentState = new SessionStore('reportComment',  30 * 60 * 1000);
const profileUpdateState = new SessionStore('profileUpdate',  10 * 60 * 1000);
const pendingIntentState = new SessionStore('pendingIntent',  10 * 60 * 1000);
const lastWorksheetState = new SessionStore('lastWorksheet',  30 * 60 * 1000);
const parentMessageState = new SessionStore('parentMessage',  30 * 60 * 1000);
const assessmentAnalysisState = new SessionStore('assessmentAnalysis', 30 * 60 * 1000);
const interventionPlanState   = new SessionStore('interventionPlan',   30 * 60 * 1000);
const dataAssessmentState     = new SessionStore('dataAssessment',     45 * 60 * 1000); // longer TTL — CSV upload may take time
const lastGeneratedState      = new SessionStore('lastGenerated',      30 * 60 * 1000); // SAVE command reads this
const observationState        = new SessionStore('observation',        30 * 60 * 1000);
const observationHistoryState = new SessionStore('observationHistory',  15 * 60 * 1000);
const assessmentSessionState  = new SessionStore('assessmentSession',   24 * 60 * 60 * 1000); // ADR-006 — long TTL: a teacher may resume marks capture the next day

// ADR-019 Step 3, Commit 3: assessmentSessionFlow becomes the first
// production FlowDefinition registered with NavigationService. This is
// registration only — it does not yet change any live routing. HELP/MENU
// and the flow's own STATUS/CANCEL branches (flows/assessmentSessionFlow.js)
// are left completely untouched and continue to own actual runtime
// behaviour; commandHandler's global HELP/MENU/STATUS also remain
// untouched per ADR-019's incremental-rollback plan (Commit 4 removes the
// now-superseded local branches, once this registration has proven out).
require('../services/navigationService').registerFlow({
  id: 'assessmentSession',
  commands: ['NEW TEST', 'PRINT', 'RESUME'],
  // ADR-019 Commit 5 part 2: assessmentSession now opens a scoped menu
  // (the post-completion NEW_ASSESSMENT/PRINT prompt) via
  // navigationService.openMenu() — see flows/assessmentSessionFlow.js.
  // The menus map below is documentation/discoverability only, matching
  // FlowDefinition.menus's documented purpose; it is not itself consulted
  // by openMenu() today.
  capabilities: { status: true, cancel: true, back: false, menus: true },
  menus: {
    complete: ['Start a new assessment', 'Print a blueprint question paper'],
  },
  hooks: {
    cleanup: (phoneHash) => assessmentSessionState.delete(phoneHash),
    describeStatus: (phoneHash) => {
      const state = assessmentSessionState.get(phoneHash);
      return state ? describeAssessmentSessionStatus(state) : null;
    },
  },
});
// RC1-H-001: Blueprint Authoring flow — conversational NEW BLUEPRINT
// creation. Same long-lived-relative-to-a-menu TTL as assessmentSession
// (30 min): building a multi-question blueprint over WhatsApp is a
// slower, more deliberate task than a single-turn menu pick, but doesn't
// need assessmentSession's 24h span since there's no reason a teacher
// would pause mid-authoring overnight the way marks capture might.
const blueprintAuthoringState = new SessionStore('blueprintAuthoring',  30 * 60 * 1000);

require('../services/navigationService').registerFlow({
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
      return state ? describeBlueprintAuthoringStatus(state) : null;
    },
  },
});
const rosterState             = new SessionStore('roster',              30 * 60 * 1000); // ADR-006 PR3 — ROSTER/ADD/REMOVE/CLEAR
const reflectionState          = new SessionStore('reflection',          30 * 60 * 1000);
const growthPlanState          = new SessionStore('growthPlan',          30 * 60 * 1000);
const saveLock = new Set(); // B5-F1: per-phone SAVE in-flight lock (try/finally in SAVE handler)

// ── Observation flow module (extracted from this file) ─────────────────────
const {
  handleObservationFlow,
  handleObservationHistoryFlow,
} = require('../flows/observationFlow');

function buildObservationDeps() {
  return Object.freeze({
    observationState,
    observationHistoryState,
    safeSendMessage,
    parseIntent,
    gradeLabel,
    hashPhone,
    processObservationSubmission,
    getObservationFormatHelpText,
    saveObservationSubmission,
    getObservationHistory,
    getObservationAssessment,
    analyzeObservations,
    appendObservationNote,
    deleteObservationAssessment,
    resolveObservationRecord,
    getTeacherClasses, // ADR-004: class-context resolution
    formatClassSelectionPrompt,
    matchClassSelection,
  });
}

// ── Reflection flow module ──────────────────────────────────────────────────
const { handleReflectionFlow } = require('../flows/reflectionFlow');
const { createReflection } = require('../services/reflectionService');
const { getCurrentTerm } = require('../services/schoolCalendarRepository');

// NavigationService migration, mirroring growthPlanFlow's registration
// above: STATUS is new (reflectionFlow had no local STATUS handling
// before — it previously always fell through to account/quota even with
// an active session), gated behind capabilities.status so it's a pure
// addition, not a behaviour change to anything that already worked.
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

require('../services/navigationService').registerFlow({
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

function buildReflectionDeps() {
  return Object.freeze({
    reflectionState,
    safeSendMessage,
    parseIntent,
    hashPhone,
    createReflection,
    getCurrentTerm,
  });
}

// ── Growth plan flow module ─────────────────────────────────────────────────
const { handleGrowthPlanFlow } = require('../flows/growthPlanFlow');
const { createGrowthPlan } = require('../services/growthPlanService');

// NavigationService migration (Navigation Platform §9 step 2): registration
// only — does not yet change live routing. growthPlanFlow's own CANCEL
// branch (flows/growthPlanFlow.js line ~113) and the awaitingCorrectionChoice
// 1/2/3 prompt continue to own actual runtime behaviour untouched, same
// incremental-rollback approach as ADR-019 Step 3, Commit 3 for Assessment.
// describeStatus is new (growthPlanFlow had no local STATUS handling before
// this — STATUS previously always fell through to account/quota even with
// an active session), gated behind capabilities.status so it's a pure
// addition, not a behaviour change to anything that already worked.
function describeGrowthPlanStatus(phoneHash) {
  const state = growthPlanState.get(phoneHash);
  if (!state) return null;

  const stepLabels = {
    awaitingGoal: 'waiting for the goal',
    awaitingTopic: 'waiting for the topic',
    reviewSummary: 'reviewing before save',
    awaitingCorrectionChoice: 'choosing what to correct',
  };
  const stepLabel = stepLabels[state.step] || state.step;

  return (
    `🎯 *Growth Plan in progress* — ${stepLabel}.\n` +
    `Reply *CANCEL* to discard, or continue where you left off.`
  );
}

require('../services/navigationService').registerFlow({
  id: 'growthPlan',
  commands: [],
  // capabilities.menus documents the awaitingCorrectionChoice 1/2/3 prompt
  // for discoverability, same as assessmentSession's `menus` block — it is
  // not itself consulted by openMenu() yet; growthPlanFlow.js still renders
  // and matches this prompt locally until playbook step 6.
  capabilities: { status: true, cancel: true, back: false, menus: true },
  menus: {
    correctionChoice: ['Goal', 'Topic', 'Cancel'],
  },
  hooks: {
    cleanup: (phoneHash) => growthPlanState.delete(phoneHash),
    describeStatus: describeGrowthPlanStatus,
  },
});

function buildGrowthPlanDeps() {
  return Object.freeze({
    growthPlanState,
    safeSendMessage,
    parseIntent,
    hashPhone,
    createGrowthPlan,
    getCurrentTerm,
  });
}

// ── Worksheet flow module (extracted from this file) ───────────────────────
const {
  handleWorksheetFlow,
  recordWorksheetGeneration,
} = require('../flows/worksheetFlow');

function buildWorksheetDeps() {
  return Object.freeze({
    lastWorksheetState,
    safeSendMessage,
    hashPhone,
    triggerGeneration, // core/generationPipeline.js
  });
}

// ── Assessment flow module (extracted from this file) ──────────────────────
const { handleAssessmentFlow } = require('../flows/assessmentFlow');

// ── Assessment session flow module (ADR-006 — Blueprint Assessment Sessions) ──
const { handleAssessmentSessionFlow, describeStatus: describeAssessmentSessionStatus } = require('../flows/assessmentSessionFlow');
const { listBlueprints, getBlueprintById, createBlueprint, updateQuestion, publishBlueprint } = require('../services/blueprintRepository');
const { getRoster: getClassRoster } = require('../services/learnerRosterService');

// ── Blueprint authoring flow module (RC1-H-001) ─────────────────────────────
const { handleBlueprintAuthoringFlow, describeStatus: describeBlueprintAuthoringStatus } = require('../flows/blueprintAuthoringFlow');

function buildBlueprintAuthoringDeps() {
  return Object.freeze({
    hashPhone,
    safeSendMessage,
    blueprintAuthoringState,
    createBlueprint,
    getBlueprintById,
    updateQuestion,
    publishBlueprint,
    // Optional: lets the post-publish menu (NEW TEST / PRINT) dispatch
    // straight into assessmentSessionFlow rather than just telling the
    // teacher to type the command themselves.
    handleAssessmentSessionFlow,
    buildAssessmentSessionDeps,
  });
}

function buildAssessmentSessionDeps() {
  return Object.freeze({
    hashPhone,
    safeSendMessage,
    assessmentSessionState,
    listBlueprints,
    getBlueprintById,
    getTeacherClasses, // ADR-004: class-context resolution
    processAssessmentData, // ADR-006 PR2: commits captured marks on completion
    getClassRoster, // ADR-006 PR2.5: prefills learner names from the saved roster, if any
    parseMarks, // ADR-006 PR4 Phase 3: bulk-paste capture via submitBulkReply()
    generateBlueprintAssessmentPdf, // ADR-005A: analytics PDF sent on capture completion
    generateBlueprintPaperPdf, // ADR-005B: printable blank question paper
    buildPdfUrl,
    sendDocument,
  });
}

// ── Roster flow module (ADR-006 PR3 — ROSTER/ADD/REMOVE/CLEAR) ─────────────
const { handleRosterFlow } = require('../flows/rosterFlow');

function buildRosterDeps() {
  return Object.freeze({
    hashPhone,
    safeSendMessage,
    rosterState,
    getTeacherClasses, // ADR-004: class-context resolution
    formatClassSelectionPrompt,
    matchClassSelection,
  });
}

// ── Generation pipeline module (extracted from this file) ──────────────────
const { triggerGeneration, buildPdfUrl } = require('../core/generationPipeline');

function buildGenerationDeps() {
  return Object.freeze({
    buildPrompt,
    generateContent,
    generatePdf,
    gradeLabel,
    getWorksheetTotalMarks,
    intentLabel,
    sendDocument,
    safeSendMessage,
    hashPhone,
    getTeacherByPhone,
    isProActive,
    checkAndIncrementUsage,
    rollbackUsage,
    isAiRateLimited,
    FREE_LIMIT_DISPLAY,
    pendingIntentState,
    lastGeneratedState,
    recordWorksheetGeneration,
    buildWorksheetDeps,
    updateTeacherProfile,
  });
}

function buildAssessmentDeps() {
  return Object.freeze({
    hashPhone,
    safeSendMessage,
    gradeLabel,
    isProActive,
    getTeacherByPhone,
    dataAssessmentState,
    parseIntent,
    parseMarks,
    extractMarksFromImage,
    getFormatHelpText,
    processAssessmentData,
    getTeacherClasses, // ADR-004: class-context resolution
    formatClassSelectionPrompt,
    matchClassSelection,
    // --- Stabilization Issue #1: previously referenced in assessmentFlow.js's
    // mark-upload and AI intervention-plan sections but never injected here,
    // causing a ReferenceError at runtime. All 8 already exist in this file. ---
    downloadMedia,
    updateTeacherProfile,
    checkAndIncrementUsage,
    rollbackUsage,
    buildFullInterventionPlanPrompt,
    generateContent,
    saveReport,
    parseInterventionSections,
  });
}

const { handleReportCommentFlow } = require('../flows/reportCommentFlow');

/**
 * Dependencies for the extracted report comment flow
 * (flows/reportCommentFlow.js). See that file's header comment for the
 * expected shape.
 */
function buildReportCommentDeps() {
  return Object.freeze({
    reportCommentState,
    hashPhone,
    parseIntent,
    getTeacherByPhone,
    safeSendMessage,
    checkAndIncrementUsage,
    rollbackUsage,
    buildPrompt,
    generateContent,
    generateReportSummaryPdf,
    buildPdfUrl,
    sendDocument,
    FREE_LIMIT_DISPLAY,
  });
}

const { handleParentMessageFlow } = require('../flows/parentMessageFlow');

/**
 * Dependencies for the extracted parent message flow
 * (flows/parentMessageFlow.js). See that file's header comment for the
 * expected shape.
 */
function buildParentMessageDeps() {
  return Object.freeze({
    parentMessageState,
    hashPhone,
    parseIntent,
    getTeacherByPhone,
    safeSendMessage,
    checkAndIncrementUsage,
    rollbackUsage,
    buildPrompt,
    generateContent,
    FREE_LIMIT_DISPLAY,
  });
}

// ── Data-driven assessment flow handler (Pro feature) ─────────────────────
/**
 * Handles the data-driven assessment flow: collects metadata (grade/subject/title/term),
 * then accepts marks as inline text OR a CSV document upload, runs the full diagnostic
 * pipeline (item analysis → error analysis → learner grouping → intervention plan),
 * and returns a structured PDF report.
 *
 * Runs alongside — and does not replace — the existing conversational assessmentAnalysis
 * flow. Teachers reach this flow via "upload marks", "item analysis", "error analysis",
 * "group learners", etc., or by attaching a CSV document while in this flow's state.
 *
 * Returns true if handled (skip normal processing), false otherwise.
 *
 * @param {string} from
 * @param {string} text           - The teacher's message text (may be empty for documents)
 * @param {object|null} message   - Full WhatsApp message object (for document handling)
 * @param {object|null} preClassifiedIntent
 * @returns {Promise<boolean>}
 */
// ── Intervention output parser (extracted to utils/interventionParser.js) ──
const { parseInterventionSections } = require('../utils/interventionParser');

// ── Curriculum Query Flow (extracted to flows/curriculumQueryFlow.js) ──────
const { handleCurriculumQueryFlow } = require('../flows/curriculumQueryFlow');

/**
 * Dependencies for the extracted curriculum query flow
 * (flows/curriculumQueryFlow.js).
 */
function buildCurriculumQueryDeps() {
  return Object.freeze({
    getTeacherByPhone,
    handleCurriculumQuery,
    safeSendMessage,
  });
}
const { handleAssessmentAnalysisFlow } = require('../flows/assessmentAnalysisFlow');

/**
 * Dependencies for the extracted assessment analysis flow
 * (flows/assessmentAnalysisFlow.js). See that file's header comment for
 * the expected shape.
 */
function buildAssessmentAnalysisDeps() {
  return Object.freeze({
    assessmentAnalysisState,
    hashPhone,
    parseIntent,
    getTeacherByPhone,
    isProActive,
    safeSendMessage,
    parseGrade,
    gradeLabel,
    checkAndIncrementUsage,
    rollbackUsage,
    buildPrompt,
    generateContent,
    generatePdf,
    buildPdfUrl,
    sendDocument,
    FREE_LIMIT_DISPLAY,
  });
}

const { handleInterventionPlanFlow } = require('../flows/interventionPlanFlow');

/**
 * Dependencies for the extracted intervention plan flow
 * (flows/interventionPlanFlow.js). See that file's header comment for
 * the expected shape.
 */
function buildInterventionPlanDeps() {
  return Object.freeze({
    interventionPlanState,
    hashPhone,
    parseIntent,
    getTeacherByPhone,
    isProActive,
    safeSendMessage,
    parseGrade,
    gradeLabel,
    checkAndIncrementUsage,
    rollbackUsage,
    buildPrompt,
    generateContent,
    generatePdf,
    buildPdfUrl,
    sendDocument,
    FREE_LIMIT_DISPLAY,
  });
}

const { handleProfileUpdateFlow } = require('../flows/profileUpdateFlow');

/**
 * Dependencies for the extracted profile update flow
 * (flows/profileUpdateFlow.js). See that file's header comment for the
 * expected shape.
 */
function buildProfileUpdateDeps() {
  return Object.freeze({
    profileUpdateState,
    hashPhone,
    safeSendMessage,
    updateTeacherProfile,
    gradeLabel,
  });
}

// ── Message processor module (extracted from this file) ────────────────────
const { processMessage } = require('../core/messageProcessor');

/**
 * Bundles every collaborator processMessage() needs into a single frozen
 * deps object. Built fresh per incoming message (cheap — just object
 * construction, no I/O) so there's no risk of stale closures.
 */
function buildProcessMessageDeps() {
  return Object.freeze({
    isDuplicate,
    getTeacherByPhone,
    updateTeacherProfile,
    hashPhone,
    safeSendMessage,
    encryptPhone,
    dataAssessmentState,
    handleAssessmentFlow,
    buildAssessmentDeps,
    handleCommand,
    needsOnboarding,
    handleOnboarding,
    pendingIntentState,
    triggerGeneration,
    buildGenerationDeps,
    reportCommentState,
    parentMessageState,
    assessmentAnalysisState,
    interventionPlanState,
    profileUpdateState,
    observationState,
    observationHistoryState,
    assessmentSessionState,
    blueprintAuthoringState,
    rosterState,
    reflectionState,
    growthPlanState,
    handleObservationFlow,
    buildObservationDeps,
    handleObservationHistoryFlow,
    handleReflectionFlow,
    buildReflectionDeps,
    handleGrowthPlanFlow,
    buildGrowthPlanDeps,
    handleAssessmentSessionFlow,
    buildAssessmentSessionDeps,
    handleBlueprintAuthoringFlow,
    buildBlueprintAuthoringDeps,
    handleRosterFlow,
    buildRosterDeps,
    handleReportCommentFlow,
    buildReportCommentDeps,
    handleProfileUpdateFlow,
    buildProfileUpdateDeps,
    handleParentMessageFlow,
    buildParentMessageDeps,
    handleAssessmentAnalysisFlow,
    buildAssessmentAnalysisDeps,
    handleCurriculumQueryFlow,
    buildCurriculumQueryDeps,
    handleInterventionPlanFlow,
    buildInterventionPlanDeps,
    isConversationalIntent,
    generateConversationalResponse,
    generateConversationalReplyAI,
    isAiRateLimited,
    isClassifierRateLimited,
    isCeilingReached,
    parseIntent,
    classifyIntent,
  });
}

// ── Special command handlers ───────────────────────────────────────────────

// ── Command handler module (extracted from this file) ──────────────────────
const { handleCommand: handleCommandImpl } = require('../core/commandHandler');

/**
 * Bundles every collaborator handleCommand() needs into a single frozen
 * deps object. Built fresh per call (cheap — just object construction).
 */
function buildCommandDeps() {
  return Object.freeze({
    FREE_LIMIT_DISPLAY,
    buildGenerationDeps,
    buildPaymentUrl,
    buildPdfUrl,
    buildPrompt,
    buildWorksheetDeps,
    checkAndIncrementUsage,
    clearAllSessions,
    generateContent,
    generateHodSummary,
    generateInterventionReport,
    generateParentSummary,
    generatePdf,
    generateTeacherSummary,
    getTeacherByPhone,
    getUsageInfo,
    gradeLabel,
    handleWorksheetFlow,
    hashPhone,
    intentLabel,
    isProActive,
    lastGeneratedState,
    parentMessageState,
    pendingIntentState,
    profileUpdateState,
    rollbackUsage,
    safeSendMessage,
    saveLock,
    saveReport,
    getSavedReport,
    sendDocument,
    sendMessage,
    triggerGeneration,
    updateTeacherProfile,
    // RC1-H-004: STATUS must not be answered globally (subscription info)
    // while a teacher is mid-flow in a session that owns its own STATUS
    // reply (e.g. blueprintAuthoring, assessmentSession) — see the guard
    // in commandHandler.js's STATUS branch for why these are needed here.
    assessmentSessionState,
    blueprintAuthoringState,
  });
}

/**
 * Handles special keyword commands.
 * Returns true if the command was handled (skip normal processing).
 *
 * @param {string} from
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function handleCommand(from, text) {
  return handleCommandImpl(from, text, buildCommandDeps());
}

/**
 * Persists each entry of a Meta WhatsApp status webhook batch
 * (`value.statuses[]`) as a structured delivery event (ADR-XXX §5).
 *
 * Each entry looks like:
 *   { id: 'wamid...', status: 'sent'|'delivered'|'read'|'failed',
 *     timestamp: '<unix seconds>', recipient_id: '<phone, no +>',
 *     errors: [{ code, title, message, ... }] }
 *
 * recipient_id arrives in the same international-format-without-`+` shape
 * as every other WhatsApp-originated phone value in this codebase
 * (see hashPhone()'s own doc comment) — hashPhone() normalizes it
 * identically to how request-code/verify-code hash inbound phone numbers,
 * so correlation by phone_hash (where used) stays consistent.
 *
 * Idempotent and correlation-safe: deliveryEventRepository handles
 * de-duplication (same message ID + status is a no-op) and the
 * early-arrival race (a status for a message ID not yet linked to an
 * auth_code_id is stored and reconciled once that link exists) — this
 * function does not need its own idempotency logic.
 *
 * Never touches auth_codes — delivery telemetry is observational only
 * (§5.1) and must not affect OTP validity.
 *
 * @param {Array<Object>} statuses
 */
function processStatusWebhooks(statuses) {
  if (!Array.isArray(statuses)) return;

  for (const statusEntry of statuses) {
    if (!statusEntry || !statusEntry.id || !statusEntry.status) continue;

    const providerMessageId = statusEntry.id;
    const eventStatus = statusEntry.status;
    const phoneHash = statusEntry.recipient_id ? hashPhone(statusEntry.recipient_id) : null;
    if (!phoneHash) continue; // can't persist without a phone_hash (NOT NULL column)

    const providerEventAt = statusEntry.timestamp
      // Meta sends unix seconds as a string; store as SQLite datetime text.
      ? new Date(Number(statusEntry.timestamp) * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '')
      : null;

    const providerError = Array.isArray(statusEntry.errors) && statusEntry.errors.length > 0
      ? statusEntry.errors.map(e => e.title || e.message || e.code).filter(Boolean).join('; ')
      : null;

    try {
      recordStatusWebhook({ providerMessageId, phoneHash, eventStatus, providerError, providerEventAt });
    } catch (err) {
      // One malformed entry in a batch must not prevent the rest of the
      // batch from being processed — matches the per-message try/catch
      // convention used for incoming messages below.
      console.error('[WEBHOOK] Failed to persist delivery status event:', err.message);
    }
  }
}

// ── Webhook verification (GET) ─────────────────────────────────────────────

router.get('/', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('[WEBHOOK] Meta verification successful');
    return res.status(200).send(challenge);
  }

  console.warn('[WEBHOOK] Meta verification failed — token mismatch');
  return res.sendStatus(403);
});

// ── Incoming message handler (POST) ───────────────────────────────────────

router.post('/', async (req, res) => {
  // Always respond 200 immediately — Meta requires this within 20 seconds.
  // If we don't, Meta retries the delivery, causing duplicate processing.
  res.sendStatus(200);

  try {
    const body    = req.body;
    if (!body || body.object !== 'whatsapp_business_account') return;

    const entry   = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value   = changes?.value;

    // Delivery-status webhooks (sent/delivered/read/failed) are persisted
    // as structured events (ADR-XXX §5), not discarded and not merely
    // logged. This is diagnostic/observational only (§5.1) — nothing here
    // touches auth_codes; a `failed` status must never invalidate,
    // expire, or otherwise affect OTP validity. Handled and returned
    // before falling through to message processing below.
    if (value?.statuses) {
      try {
        processStatusWebhooks(value.statuses);
      } catch (err) {
        console.error('[WEBHOOK] Delivery-status processing error:', err.message);
      }
      return;
    }

    const messages = value?.messages;
    if (!messages || messages.length === 0) return;

    // Process each message in the batch independently (Meta can batch multiple
    // messages into a single webhook delivery). The try/catch lives INSIDE the
    // loop, per message — previously it wrapped the whole loop, so if message 1
    // threw, messages 2..n in the same batch were silently never processed at
    // all, with no log distinguishing a partial-batch failure from a clean one.
    for (const message of messages) {
      try {
        await processMessage(message, buildProcessMessageDeps());
      } catch (err) {
        console.error(`[WEBHOOK] Failed to process message ${message?.id || '(no id)'}:`, err.message);

        // Previously a failure here meant total silence for the teacher — no
        // error, no retry prompt, nothing. From their side that's indistinguishable
        // from "my message never sent". Best-effort fallback so they at least know
        // to retry, rather than being left wondering. Guarded with its own try/catch
        // since if the original failure was something like a DB outage, this send
        // could fail too — and that must not re-throw and break the rest of the batch.
        try {
          if (message?.from) {
            await safeSendMessage(message.from,
              `I'm sorry — something went wrong on my side while processing that message. Please send it again in a moment. If the problem continues, let me know.`
            );
          }
        } catch (fallbackErr) {
          console.error('[WEBHOOK] Failed to send error fallback message:', fallbackErr.message);
        }
      }
    }

  } catch (err) {
    console.error('[WEBHOOK] Unhandled error:', err.message);
    // We already sent 200 — nothing to do except log
  }
});




// ── Helpers ────────────────────────────────────────────────────────────────



// Session cleanup is handled by SessionStore itself:
//   - TTL is enforced on every .get() call (stale entries return undefined and are deleted)
//   - A periodic prune sweep in sessionStore.js removes all entries older than 2 hours
// No additional cleanup loop is needed here.

module.exports = router;

// Exposed for direct testing only (tests/phase1-delivery-rollback.test.js,
// tests/menu-help-session-reset.test.js, tests/cancel-pending-save.test.js).
// Not part of the public route surface — do not depend on this from
// application code.
module.exports.__testExports = {
  triggerGeneration,
  buildGenerationDeps,
  buildAssessmentDeps,
  rollbackUsage,
  handleCommand,
  hashPhone,
  assessmentSessionState,
  dataAssessmentState,
  lastGeneratedState,
  processStatusWebhooks,
};