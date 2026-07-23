'use strict';

const express = require('express');
const router  = express.Router();

const { parseIntent }            = require('../utils/intentParser');
const { classifyIntent }         = require('../services/intentClassifier');
const { buildPrompt }            = require('../services/promptService');
const { generateContent }        = require('../services/aiService');
const { sendMessage, sendDocument, downloadMedia } = require('../services/whatsappService');
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
const { generatePdf, generateReportSummaryPdf } = require('../services/pdfService');
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
  checkAndRecordRateLimit,
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
const rosterState             = new SessionStore('roster',              30 * 60 * 1000); // ADR-006 PR3 — ROSTER/ADD/REMOVE/CLEAR
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
const { handleAssessmentSessionFlow } = require('../flows/assessmentSessionFlow');
const { listBlueprints, getBlueprintById } = require('../services/blueprintRepository');
const { getRoster: getClassRoster } = require('../services/learnerRosterService');

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
/**
 * Parses the AI intervention response into step sections.
 * @param {string} text
 * @returns {{ step6, step7, step8, step9, step10 }}
 */
function parseInterventionSections(text) {
  const result = {};
  const delimiters = {
    step6:  /===\s*STEP\s*6[^=]*===/i,
    step7:  /===\s*STEP\s*7[^=]*===/i,
    step8:  /===\s*STEP\s*8[^=]*===/i,
    step9:  /===\s*STEP\s*9[^=]*===/i,
    step10: /===\s*STEP\s*10[^=]*===/i,
  };
  const keys = ['step6', 'step7', 'step8', 'step9', 'step10'];

  // Find positions of each delimiter
  const positions = [];
  for (const key of keys) {
    const match = text.match(delimiters[key]);
    if (match) {
      positions.push({ key, index: text.indexOf(match[0]), length: match[0].length });
    }
  }
  positions.sort((a, b) => a.index - b.index);

  for (let i = 0; i < positions.length; i++) {
    const { key, index, length } = positions[i];
    const start = index + length;
    const end = i + 1 < positions.length ? positions[i + 1].index : text.length;
    result[key] = text.slice(start, end).trim();
  }

  return result;
}

// ── Curriculum Query Flow Handler ─────────────────────────────────────────────
/**
 * Handles teacher questions about curriculum position, ATP topics, coverage, pacing.
 * Uses curriculumIntelligenceService for local (instant) responses.
 * Returns true if handled.
 *
 * @param {string} from
 * @param {string} text
 * @param {Object} intent
 * @returns {Promise<boolean>}
 */
async function handleCurriculumQueryFlow(from, text, intent) {
  if (!intent || intent.type !== 'curriculumQuery') return false;

  const profile = getTeacherByPhone(from) || {};
  const response = handleCurriculumQuery(text, profile);

  await safeSendMessage(from, response);
  return true;
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
    rosterState,
    handleObservationFlow,
    buildObservationDeps,
    handleObservationHistoryFlow,
    handleAssessmentSessionFlow,
    buildAssessmentSessionDeps,
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

    // Ignore status updates (delivered, read receipts) — only process messages
    if (value?.statuses) return;

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
};