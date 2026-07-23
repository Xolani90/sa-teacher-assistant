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
const { validateAtpWeeks } = require('../utils/atpWeekValidator');
const { getWorksheetTotalMarks } = require('../utils/capsPhase');
const { buildPaymentUrl }        = require('../services/yocoService');
const { encryptPhone }           = require('../utils/encryption');
const { SessionStore, clearAllSessionsForHash } = require('../utils/sessionStore');
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

/**
 * Rolls back a usage_events row created by checkAndIncrementUsage() when
 * the generation that consumed it subsequently fails. Deletes the EXACT
 * row this request created (quota.insertedRowId), never a MAX(id)-based
 * guess — a second, unrelated request for the same teacher/month can
 * insert its own row in the meantime, since no per-teacher serialization
 * exists across separate webhook deliveries (see
 * tests/phase-e-usage-rollback.test.js).
 *
 * No-ops for Pro-tier teachers (checkAndIncrementUsage never sets
 * insertedRowId for Pro-tier calls) and for any quota result missing
 * insertedRowId.
 *
 * @param {{isPro?: boolean, insertedRowId?: number}} quota
 * @param {string} from - teacher's WhatsApp number, for logging only
 */
function rollbackUsage(quota, from) {
  if (quota && quota.isPro) return;
  if (!quota || typeof quota.insertedRowId !== 'number') {
    console.warn(`[WEBHOOK] Usage rollback skipped — no insertedRowId on quota result for ...${String(from).slice(-4)}`);
    return;
  }
  try {
    const db = require('../utils/database').getDb();
    const result = db.prepare(`DELETE FROM usage_events WHERE id = ?`).run(quota.insertedRowId);
    if (result.changes === 1) {
      console.log(`[WEBHOOK] Rolled back usage increment (row id=${quota.insertedRowId}) for free-tier teacher ...${String(from).slice(-4)}`);
    } else {
      console.warn(`[WEBHOOK] Usage rollback found no row to delete (id=${quota.insertedRowId}, already removed?) for ...${String(from).slice(-4)}`);
    }
  } catch (rollbackErr) {
    console.error('[WEBHOOK] Failed to roll back usage increment:', rollbackErr.message);
  }
}


const {
  saveReport,
  getSavedReport,
  generateHodSummary,
  generateParentSummary,
  generateTeacherSummary,
  generateInterventionReport,
} = require('../services/interventionReportsService');

// ── Per-phone rate limiters (SQLite-backed) ─────────────────────────────────
// Backlog Item 4 fix: previously in-memory Maps (aiCallTimestamps /
// classifierCallTimestamps), which reset on every Render restart/redeploy —
// a teacher near the ceiling effectively got a free reset on every deploy.
// Now persisted in rate_limit_events (see utils/database.js Migration 023).
// Each write opportunistically deletes that phone's own stale rows for the
// same limiter, so no separate cleanup interval is needed.
const AI_RATE_LIMIT             = 5;      // max AI calls
const AI_RATE_WINDOW_MS         = 60_000; // per 60 seconds
const CLASSIFIER_RATE_LIMIT     = 20;     // max classification calls
const CLASSIFIER_RATE_WINDOW_MS = 60_000; // per 60 seconds

function checkAndRecordRateLimit(from, limiterType, limit, windowMs) {
  const db     = require('../utils/database').getDb();
  const hash   = hashPhone(from);
  const cutoff = `-${Math.floor(windowMs / 1000)} seconds`;

  return db.transaction(() => {
    const { count } = db.prepare(`
      SELECT COUNT(*) as count FROM rate_limit_events
      WHERE phone_hash = ? AND limiter_type = ?
        AND created_at > datetime('now', ?)
    `).get(hash, limiterType, cutoff);

    if (count >= limit) return true;

    db.prepare(`
      INSERT INTO rate_limit_events (phone_hash, limiter_type)
      VALUES (?, ?)
    `).run(hash, limiterType);

    // Opportunistic cleanup of this phone's own stale rows for this limiter —
    // keeps the table bounded without a separate background job.
    db.prepare(`
      DELETE FROM rate_limit_events
      WHERE phone_hash = ? AND limiter_type = ?
        AND created_at <= datetime('now', ?)
    `).run(hash, limiterType, cutoff);

    return false;
  })();
}

// Prevents a single teacher from firing many AI calls in a short burst
// (e.g. rapidly typing 5 messages before any respond). Separate from the
// monthly quota.
function isAiRateLimited(from) {
  return checkAndRecordRateLimit(from, 'ai', AI_RATE_LIMIT, AI_RATE_WINDOW_MS);
}

// Every incoming text message now triggers an AI classification call (the
// new understanding step), unlike the old purely-synchronous regex parser.
// A real back-and-forth conversation legitimately sends many messages per
// minute, so this ceiling is deliberately much higher than the generation
// rate limit above — it exists only to stop a degenerate flood (bug, retry
// loop, abuse) from running up API costs with no limit at all. When this
// limit is hit, classification silently falls back to the regex parser
// instead of blocking the teacher's message entirely — there is no
// equivalent of the "please wait" message here because the teacher should
// never feel blocked just for chatting quickly.
function isClassifierRateLimited(from) {
  return checkAndRecordRateLimit(from, 'classifier', CLASSIFIER_RATE_LIMIT, CLASSIFIER_RATE_WINDOW_MS);
}

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

// ── Clear all session states for a teacher ─────────────────────────────────
function clearAllSessions(from) {
  clearAllSessionsForHash(hashPhone(from));
}

// ── Safe sendMessage wrapper (checks opted_out) ───────────────────────────
async function safeSendMessage(from, text) {
  const teacher = getTeacherByPhone(from);
  if (teacher && teacher.opted_out === 1) {
    console.log(`[WEBHOOK] Skipping message to opted-out teacher ...${String(from).slice(-4)}`);
    return;
  }
  await sendMessage(from, text);
}

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

// ── Special command handlers ───────────────────────────────────────────────

/**
 * Handles special keyword commands.
 * Returns true if the command was handled (skip normal processing).
 *
 * @param {string} from
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function handleCommand(from, text) {
  const upper = text.toUpperCase().trim();

  // ── STOP (opt-out) ───────────────────────────────────────────
  if (upper === 'STOP') {
    updateTeacherProfile(from, { opted_out: 1 });
    const db = require('../utils/database').getDb();
    // Record the exact time of opt-out for reliable re-activation detection.
    // opted_out_at is always set on STOP and cleared on re-activation — unlike
    // renewal_reminder_sent_at which is managed independently by Pro billing logic.
    db.prepare(`UPDATE teachers SET opted_out_at = datetime('now') WHERE phone_hash = ?`).run(hashPhone(from));
    clearAllSessions(from);
    await sendMessage(from,
      `Got it — you've been unsubscribed. Send me any message whenever you'd like to start again. 👋`
    );
    console.log(`[WEBHOOK] Teacher ...${String(from).slice(-4)} opted out via STOP`);
    return true;
  }

  // ── PRO upgrade ──────────────────────────────────────────────
  if (upper === 'PRO' || upper === 'UPGRADE') {
    try {
      const teacher    = getTeacherByPhone(from);
      const teacherName = teacher?.name || '';
      const { redirectUrl: url } = await buildPaymentUrl(from, teacherName);

      await safeSendMessage(from,
        `🌟 *Pro — R${process.env.PRO_PRICE_ZAR || 99}/month*\n\n` +
        `✅ Unlimited generations, no monthly cap\n` +
        `✅ Annual Teaching Plans for any grade & subject\n` +
        `✅ Worksheets, tests, lesson plans, explanations\n` +
        `✅ PDF download for every document\n` +
        `✅ Cancel any time\n\n` +
        `👇 *Tap to pay securely via Yoco:*\n${url}\n\n` +
        `_Activates the moment payment goes through._`
      );
    } catch (err) {
      console.error('[WEBHOOK] Failed to build payment URL:', err.message);
      await safeSendMessage(from,
        `Something went wrong generating your payment link. Give it another try in a moment — sorry about that!`
      );
    }
    return true;
  }

  // ── Usage / status ────────────────────────────────────────────
  if (upper === 'STATUS' || upper === 'USAGE' || upper === 'BALANCE') {
    const info = getUsageInfo(from);
    const teacher = getTeacherByPhone(from);
    if (info.isPro) {
      const expiryDate = teacher?.pro_expires ? new Date(teacher.pro_expires) : null;
      const formattedExpiry = expiryDate ? expiryDate.toLocaleDateString('en-ZA', {
        day: 'numeric', month: 'long', year: 'numeric',
      }) : 'No expiry';
      await safeSendMessage(from,
        `✅ *Pro* — unlimited generations until ${formattedExpiry} 🎓\n\nYou're all set — just ask for anything you need.`
      );
    } else {
      const remaining = info.remaining ?? 0;
      const reset = new Date();
      reset.setMonth(reset.getMonth() + 1, 1);
      const resetStr = reset.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });
      await safeSendMessage(from,
        `📊 *This month* — ${info.count} of ${info.limit} free generations used, ${remaining} left. Resets ${resetStr}.\n\n` +
        (remaining === 0
          ? `You've used up your free generations for the month.\n\nReply *PRO* to go unlimited (R${process.env.PRO_PRICE_ZAR || 99}/month). 🚀`
          : `Reply *PRO* to go unlimited for R${process.env.PRO_PRICE_ZAR || 99}/month.`
        )
      );
    }
    return true;
  }

  // ── Help menu ─────────────────────────────────────────────────
  if (upper === 'HELP' || upper === 'MENU' || upper === 'HI' || upper === 'HELLO') {
    // MENU/HELP must behave like an implicit CANCEL for any in-progress flow.
    // Previously this branch returned early without touching session state,
    // so an abandoned flow (e.g. mid data-assessment) stayed alive. The next
    // unrelated message (e.g. "Upload marks" sent again) would then either
    // get swallowed by the stale flow's step handler, or — once that state
    // finally expired/desynced — get misclassified by the generic intent
    // parser (which has no notion of "was mid data-assessment"). Clearing
    // sessions here, same as STOP already does, ensures MENU always returns
    // the teacher to a clean slate.
    clearAllSessions(from);

    const teacher = getTeacherByPhone(from);
    const name    = teacher?.name || 'there';
    await safeSendMessage(from,
      `👋 Hey ${name}! Here's what I can do:\n\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `📝 *1. CREATE A RESOURCE*\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `Just describe what you need, e.g.:\n` +
      `_"Grade 7 Maths worksheet on fractions"_\n` +
      `_"30-mark test on photosynthesis, Grade 9"_\n` +
      `_"Lesson plan, Grade 10 Accounting"_\n` +
      `_"Rubric for persuasive essay"_\n` +
      `_"Quick quiz on the water cycle"_\n` +
      `_"Explain long division simply"_\n` +
      `_"Parent message: Thabo absent 3 days"_\n` +
      `_"Report comment for Lindiwe, Term 2"_\n\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `📊 *2. SUBMIT & ANALYSE MARKS*\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `_"Upload marks"_ — submit a mark sheet (type, photo, CSV or Excel) for full item analysis, error analysis & learner grouping\n` +
      `_"How did my class do?"_ — quick assessment analysis\n` +
      `_"Intervention plan for my strugglers"_\n` +
      `_"Moderation pack for HOD sign-off"_\n\n` +
      `After uploading, reply:\n` +
      `*REPORT* — full diagnostic PDF\n` +
      `*HOD REPORT* — for department submission\n` +
      `*PARENT REPORT* — for one learner or class\n\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `👁️ *3. CLASSROOM OBSERVATIONS*\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `_"Observe my class"_ — start a play-based / structured observation\n` +
      `*MY OBSERVATIONS* — view your observation history\n\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `📅 *4. CURRICULUM & PLANNING*\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `_"Annual teaching plan for Grade 8 Maths"_ — CAPS ATP\n` +
      `_"Am I behind on the curriculum?"_ — pacing check\n\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `🏫 *5. YOUR WORKSPACE*\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `*WORKSPACE* — classes, assessments & progress\n` +
      `*MY CLASSES* — list classes (NEW CLASS to add)\n` +
      `*MY ASSESSMENTS* — history with averages\n` +
      `*MY PROGRESS* — CAPS curriculum coverage\n\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `👤 *6. YOUR ACCOUNT*\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `*STATUS* — usage & plan\n` +
      `*PRO* — upgrade to Pro (unlocks ATP, analysis, intervention plans & moderation packs)\n` +
      `*PROFILE* — view your defaults\n` +
      `*UPDATE* — change your defaults\n\n` +
      `💡 _After a worksheet, reply_ *EASIER · HARDER · VISUAL · ORAL* _to adapt it._\n\n` +
      `Type anything to get started, or reply *MENU* any time to see this again. 😊`
    );
    return true;
  }

  // ── Profile view ──────────────────────────────────────────────
  if (upper.startsWith('PROFILE')) {
    const info    = getUsageInfo(from);
    const teacher = getTeacherByPhone(from);
    await safeSendMessage(from,
      `👤 *Your Profile*\n\n` +
      `Name: ${teacher?.name || 'Not set'}\n` +
      `Grade: ${teacher?.grade != null ? gradeLabel(teacher.grade) : 'Not set'}\n` +
      `Subject: ${teacher?.subject || 'Not set'}\n` +
      `Language: ${teacher?.language || 'Not set'}\n` +
      `School: ${teacher?.school || 'Not set'}\n` +
      `Plan: ${info.isPro ? '⭐ Pro' : `Free (${info.remaining} remaining)`}\n\n` +
      `_I use your grade and subject as defaults when you don't specify them._\n\n` +
      `Reply *UPDATE* to change any of these.`
    );
    return true;
  }

  // ── UPDATE profile ──────────────────────────────────────────────
  if (upper === 'UPDATE') {
    const phoneHash = hashPhone(from);
    profileUpdateState.set(phoneHash, {
      step: 'ask_field',
      lastActivity: Date.now(),
    });
    await safeSendMessage(from,
      `Sure — what would you like to update?\n\n` +
      `1️⃣ Grade\n` +
      `2️⃣ Subject\n` +
      `3️⃣ School\n` +
      `4️⃣ Language\n\n` +
      `Just reply with the number.`
    );
    return true;
  }

  // ── RETRY last generation ─────────────────────────────────────────
  if (upper === 'RETRY') {
    const teacher = getTeacherByPhone(from);
    if (!teacher || !teacher.last_intent) {
      await safeSendMessage(from, `No previous generation to retry. Send me a request to generate something new.`);
      return true;
    }

    try {
      const lastIntent = JSON.parse(teacher.last_intent);
      // If it's a quick quiz, add a flag to generate different questions
      if (lastIntent.type === 'quickQuiz') {
        lastIntent.regenerate = true;
      }
      await safeSendMessage(from, `🔄 Regenerating your last request...`);
      await triggerGeneration({ from, intent: lastIntent, deps: buildGenerationDeps() });
    } catch (err) {
      console.error('[WEBHOOK] Failed to parse last_intent:', err.message);
      await safeSendMessage(from, `I couldn't find your last request to regenerate — try sending it again from scratch.`);
    }
    return true;
  }

  // ── Teacher Workspace commands ─────────────────────────────────────────────
  // MY CLASSES  — list the teacher's classes; NEW CLASS creates one
  // MY ASSESSMENTS — recent assessment history with class averages
  // MY PROGRESS  — curriculum coverage from real persisted data (or calendar estimate)
  // WORKSPACE   — brief summary combining all three
  //
  // These are read-only views of data that already exists in the DB (written by the
  // data-driven assessment flow). No Pro gate — useful to any registered teacher.
  const { handleWorkspaceFlow } = require('../flows/workspaceFlow');

  function buildWorkspaceDeps() {
    const {
      getTeacherClasses,
      createClass,
      getAssessmentHistory,
      validateNewClassInput,
    } = require('../services/teacherWorkspaceService');
    const { getTeacherProgressReport } = require('../services/curriculumCoverageService');
    const { handleCurriculumQuery: calendarQuery } = require('../services/curriculumIntelligenceService');

    return Object.freeze({
      hashPhone,
      getTeacherByPhone,
      safeSendMessage,
      gradeLabel,
      getTeacherClasses,
      createClass,
      getAssessmentHistory,
      validateNewClassInput,
      getTeacherProgressReport,
      calendarQuery,
    });
  }

  if (await handleWorkspaceFlow(from, text, buildWorkspaceDeps())) return true;

  // ── CANCEL a pending SAVE prompt ────────────────────────────────────────
  // lastGeneratedState isn't in the `alreadyMidFlow` set (it's not a
  // multi-step conversation, just a one-shot "reply SAVE to keep this")
  // so a bare "Cancel" after generation previously fell straight through
  // to generic classification, which has no idea a save prompt exists and
  // responded with a confusing "did you mean to cancel something?" check-in.
  // Recognize it explicitly here, same as every other CANCEL-able flow.
  if (upper === 'CANCEL') {
    const phoneHash = hashPhone(from);
    const last = lastGeneratedState.get(phoneHash);
    if (last && last.saveState === 'GENERATED') {
      lastGeneratedState.delete(phoneHash);
      await safeSendMessage(from, `👍 No problem — not saved. What else can I help you with?`);
      return true;
    }
  }

  const isWorkspaceCmd =
    upper === 'MY RESOURCES' ||
    upper === 'SAVE';

  if (isWorkspaceCmd) {
    const {
      saveResource,
      getSavedResources,
      getSavedResourceByGenerationId,
    } = require('../services/teacherWorkspaceService');

    // ── SAVE ──────────────────────────────────────────────────────────────────
    if (upper === 'SAVE') {
      const phoneHash = hashPhone(from);
      const last = lastGeneratedState.get(phoneHash);

      if (!last) {
        await safeSendMessage(from,
          `Nothing to save yet — generate a resource first (worksheet, test, lesson plan, etc.), then reply *SAVE* immediately after.`
        );
        return true;
      }

      // B5-F1 (R2) / C2-F1: per-phone saveLock — checked before BOTH the
      // RECOVERABLE retry path and the GENERATED→INSERT path below, since
      // the RECOVERABLE branch also awaits a WhatsApp send and must not be
      // re-entered by a second SAVE landing in that window. Released
      // unconditionally in the finally block of the GENERATED path; the
      // RECOVERABLE path below releases it manually since it returns before
      // reaching that try/finally.
      if (saveLock.has(phoneHash)) {
        console.warn(`[Workspace] SAVE: in-flight lock active for ${phoneHash.slice(-6)} -- rejecting concurrent call.`);
        await safeSendMessage(from, `Your save is already in progress -- please wait a moment and try again.`);
        return true;
      }

      // ── Idempotency check (B3-F5 / B4-F4): use explicit saveState tag rather
      // than property-presence inference (B4-R1 fix).
      // RECOVERABLE = DB committed, WhatsApp delivery failed.  Reconstruct
      // the confirmation from session state without issuing a second INSERT.
      if (last.saveState === 'RECOVERABLE') {
        saveLock.add(phoneHash);
        const gradeStr2   = last.intent.grade != null                                  ? ` · ${gradeLabel(last.intent.grade)}`   : '';
        const subjectStr2 = last.intent.subject && last.intent.subject !== 'general'   ? ` · ${last.intent.subject}`       : '';
        const topicPart2  = last.intent.topic ? last.intent.topic : 'Untitled';
        const typeLabel2  = intentLabel(last.intent.type);
        const title2      = `${topicPart2} — ${typeLabel2}`;
        try {
          await safeSendMessage(from,
            `✅ *Saved!*\n\n📄 *${title2}*${gradeStr2}${subjectStr2}\n\nReply *MY RESOURCES* to see all your saved resources.\n_Resource #${last.lastSavedId}_`
          );
          lastGeneratedState.delete(phoneHash);
          console.log(`[Workspace] Resource #${last.lastSavedId} re-confirmed on retry (generationId: ${last.generationId || 'n/a'})`);
        } catch (sendErr) {
          // WhatsApp still down — keep RECOVERABLE state for next retry attempt.
          console.error('[Workspace] retry confirmation send failed:', sendErr.message);
        } finally {
          saveLock.delete(phoneHash);
        }
        return true;
      }

      // B4-R3 / F5: malformed state guard
      if (!last.generationId) {
        console.warn('[Workspace] SAVE: malformed state (no generationId) -- clearing and treating as IDLE.');
        lastGeneratedState.delete(phoneHash);
        await safeSendMessage(from,
          `Nothing to save yet -- generate a resource first (worksheet, test, lesson plan, etc.), then reply *SAVE* immediately after.`
        );
        return true;
      }

      // B5-F3 (R3): Illegal transition guard.
      // Only GENERATED state is a valid origin for the INSERT path.
      if (last.saveState !== 'GENERATED') {
        console.warn(`[Workspace] SAVE: illegal transition from state '${last.saveState}' -- clearing state.`);
        lastGeneratedState.delete(phoneHash);
        await safeSendMessage(from,
          `Nothing to save yet -- generate a resource first (worksheet, test, lesson plan, etc.), then reply *SAVE* immediately after.`
        );
        return true;
      }

      // B5-F1 (R2): saveLock already checked above (covers both RECOVERABLE
      // and GENERATED paths) — no second check needed here.

      // Build title
      const typeLabel = intentLabel(last.intent.type);
      const topicPart = last.intent.topic ? last.intent.topic : 'Untitled';
      const title = topicPart + ' — ' + typeLabel;

      // Build rich metadata
      const meta = {
        grade:           last.intent.grade ?? null,
        subject:         last.intent.subject  !== 'general' ? last.intent.subject : null,
        topic:           last.intent.topic    || null,
        intent:          last.intent.type,
        term:            last.intent.term     || null,
        atpTopic:        last.intent.atpTopic || null,
        differentiation: last.intent.differentiation || null,
        savedAt:         new Date().toISOString(),
      };

      saveLock.add(phoneHash);
      try {
        // B5-F2 (R4): CAS re-read before INSERT.
        // The path from `last = get()` to here is synchronous for a GENERATED state,
        // so this guard will not fire today. It exists to prevent silent stale-content
        // saves if a future await is added before this point.
        const current = lastGeneratedState.get(phoneHash);
        if (!current || current.generationId !== last.generationId) {
          console.warn(
            `[Workspace] SAVE: CAS mismatch -- state was overwritten while SAVE was running. ` +
            `captured=${last.generationId}, current=${current ? current.generationId : 'null'}`
          );
          await safeSendMessage(from,
            `Your content was updated while saving was in progress -- reply *SAVE* again to save the latest version.`
          );
          return true;
        }

        // B5-F3 (R1): Tag SAVING before INSERT so the full
        // GENERATED -> SAVING -> RECOVERABLE -> SAVED machine is honoured.
        // saveResource() is synchronous so SAVING is never externally observable,
        // but it is testable and makes the invariant explicit.
        lastGeneratedState.set(phoneHash, Object.assign({}, last, { saveState: 'SAVING' }));
        console.log(`[Workspace] State -> SAVING (generationId: ${last.generationId})`);

        // Pass generationId so the DB row carries the idempotency key.
        const saved = saveResource(phoneHash, last.intent.type, title, last.content, meta, last.generationId);

        // DB committed. Tag RECOVERABLE immediately.
        lastGeneratedState.set(phoneHash, Object.assign({}, last, { saveState: 'RECOVERABLE', lastSavedId: saved.id }));
        console.log(`[Workspace] State -> RECOVERABLE (resourceId: ${saved.id}, generationId: ${last.generationId})`);

        const gradeStr   = meta.grade != null ? ` · ${gradeLabel(meta.grade)}`  : '';
        const subjectStr = meta.subject ? ` · ${meta.subject}`      : '';
        await safeSendMessage(from,
          `Saved!\n\n${title}${gradeStr}${subjectStr}\n\nReply *MY RESOURCES* to see all your saved resources.\n_Resource #${saved.id}_`
        );
        lastGeneratedState.delete(phoneHash);
        console.log(`[Workspace] State -> SAVED (resourceId: ${saved.id}, generationId: ${last.generationId})`);
      } catch (err) {
        const isConstraintViolation = err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
          (err.message && err.message.includes('UNIQUE constraint failed'));

        if (isConstraintViolation && last.generationId) {
          console.warn(`[Workspace] UNIQUE constraint on retry -- looking up committed row for generationId: ${last.generationId}`);
          const committed = getSavedResourceByGenerationId(last.generationId, phoneHash);
          if (committed) {
            lastGeneratedState.set(phoneHash, Object.assign({}, last, { saveState: 'RECOVERABLE', lastSavedId: committed.id }));
            try {
              const gradeStr   = meta.grade != null ? ` · ${gradeLabel(meta.grade)}`  : '';
              const subjectStr = meta.subject ? ` · ${meta.subject}`      : '';
              await safeSendMessage(from,
                `Saved!\n\n${title}${gradeStr}${subjectStr}\n\nReply *MY RESOURCES* to see all your saved resources.\n_Resource #${committed.id}_`
              );
              lastGeneratedState.delete(phoneHash);
              console.log(`[Workspace] Constraint-recovery confirmation sent (resourceId: ${committed.id})`);
            } catch (sendErr) {
              console.error('[Workspace] constraint-recovery send failed:', sendErr.message);
            }
            return true;
          }
        }

        console.error('[Workspace] SAVE error:', err.message);
        // Roll back SAVING tag on DB failure so retry can proceed.
        const stateAfterError = lastGeneratedState.get(phoneHash);
        if (stateAfterError && stateAfterError.saveState === 'SAVING') {
          lastGeneratedState.set(phoneHash, Object.assign({}, last, { saveState: 'GENERATED' }));
          console.warn('[Workspace] SAVE: DB error -- rolled back SAVING -> GENERATED for retry.');
        }
        try {
          await safeSendMessage(from, `Couldn't save the resource right now. Please try again.`);
        } catch (sendErr) {
          console.error('[Workspace] SAVE error-path send also failed:', sendErr.message);
        }
      } finally {
        // B5-F1: release lock unconditionally.
        saveLock.delete(phoneHash);
      }
      return true;
    }

    // ── MY RESOURCES ──────────────────────────────────────────────────────────
    if (upper === 'MY RESOURCES') {
      const phoneHash = hashPhone(from);
      try {
        const resources = getSavedResources(phoneHash);

        if (resources.length === 0) {
          await safeSendMessage(from,
            `📂 *My Resources*\n\nYou haven't saved any resources yet.\n\nGenerate something and reply *SAVE* to keep it here for easy reference.`
          );
          return true;
        }

        // Show last 8, grouped by type when there are more than 4
        const recent = resources.slice(0, 8);
        const useGroups = recent.length > 4;

        let msg = `📂 *My Resources* (${resources.length} saved)\n\n`;

        if (useGroups) {
          // Group by resource_type
          const grouped = {};
          for (const r of recent) {
            const t = r.resource_type || 'other';
            if (!grouped[t]) grouped[t] = [];
            grouped[t].push(r);
          }
          for (const [type, items] of Object.entries(grouped)) {
            msg += `*${intentLabel(type).charAt(0).toUpperCase() + intentLabel(type).slice(1)}s*\n`;
            for (const r of items) {
              // grade/subject are stored as top-level columns — no JSON parse needed.
              const gradeStr   = r.grade != null ? ` · Gr ${r.grade === 0 ? 'R' : r.grade}` : '';
              const subjectStr = r.subject ? ` · ${r.subject}`  : '';
              const date = r.created_at ? r.created_at.slice(0, 10) : '';
              // ID shown so a future OPEN N command can reference it
              msg += `  [${r.id}] ${r.title}${gradeStr}${subjectStr} · ${date}\n`;
            }
            msg += '\n';
          }
        } else {
          for (const r of recent) {
            const gradeStr   = r.grade != null ? ` · Gr ${r.grade === 0 ? 'R' : r.grade}` : '';
            const subjectStr = r.subject ? ` · ${r.subject}`  : '';
            const date = r.created_at ? r.created_at.slice(0, 10) : '';
            msg += `[${r.id}] ${r.title}${gradeStr}${subjectStr} · ${date}\n`;
          }
        }

        if (resources.length > 8) {
          msg += `_...and ${resources.length - 8} more_\n`;
        }

        msg += `\n_Reply *SAVE* after any generation to add to this list._`;

        await safeSendMessage(from, msg);
      } catch (err) {
        console.error('[Workspace] getSavedResources error:', err.message);
        await safeSendMessage(from, `⚠️ Couldn't load your resources right now. Please try again.`);
      }
      return true;
    }

    return true; // Shouldn't reach here given isWorkspaceCmd guard, but be safe
  }

  // ── REPORT / HOD report / parent report (follow-up to data-driven assessment) ──
  // All three pull the most recently analysed assessment (teacher.last_assessment_id)
  // unless the teacher names a specific learner for a parent report.

  // Classified once into a single reportCommand value so the outer gate and the
  // inner dispatch can never drift out of sync with each other.
  const parentReportMatch = text.trim().match(/^(parent report|parentreport)(\s+for\s+(.+))?$/i);
  const reportCommand =
    /^(report|full report)$/i.test(upper)      ? 'diagnostic' :
    /^(hod|hod report|hodreport)$/i.test(upper) ? 'hod' :
    parentReportMatch                           ? 'parent' :
    null;

  if (reportCommand) {
    const teacher = getTeacherByPhone(from);
    if (!teacher || !teacher.last_assessment_id) {
      await safeSendMessage(from,
        `I don't have a recent assessment to report on. Upload marks or run a data-driven assessment analysis first, then ask me for a report.`
      );
      return true;
    }

    if (!isProActive(teacher)) {
      await safeSendMessage(from,
        `⭐ *Diagnostic, HOD, and parent reports are a Pro feature*\n\n` +
        `Upgrade to Pro for R${process.env.PRO_PRICE_ZAR || 99}/month to unlock these, plus unlimited generations and PDF downloads.\n\n` +
        `Reply *PRO* to upgrade. 🎓`
      );
      return true;
    }

    const assessmentId = teacher.last_assessment_id;
    const assessmentLabel = require('../utils/database').getDb()
      .prepare(`SELECT title, grade, subject FROM assessments WHERE id = ?`)
      .get(assessmentId) || {};

    // ── Bare REPORT: full diagnostic PDF ──
    if (reportCommand === 'diagnostic') {
      const saved = getSavedReport(assessmentId, 'diagnostic');
      const content = saved ? saved.content : generateTeacherSummary(generateInterventionReport(assessmentId));
      await safeSendMessage(from, `⏳ Preparing your diagnostic report PDF...`);
      try {
        const { fileId, filename } = await generatePdf({
          content,
          type: 'diagnosticReport',
          topic: assessmentLabel.title,
          grade: assessmentLabel.grade != null ? gradeLabel(assessmentLabel.grade) : '',
          subject: assessmentLabel.subject,
          school: teacher.school || '',
        });
        const pdfUrl = buildPdfUrl(fileId);
        await sendDocument(from, pdfUrl, filename, `📎 *Diagnostic Report PDF* (available for 2 hours)`);
      } catch (pdfErr) {
        console.error('[WEBHOOK] Diagnostic report PDF generation failed:', pdfErr.message);
        await safeSendMessage(from, content); // Fall back to plain text if PDF fails
      }
      return true;
    }

    // ── HOD report ──
    if (reportCommand === 'hod') {
      const saved = getSavedReport(assessmentId, 'hod');
      let content;
      if (saved) {
        content = saved.content;
      } else {
        const report = generateInterventionReport(assessmentId);
        content = generateHodSummary(report);
        try { saveReport(hashPhone(from), assessmentId, 'hod', content); } catch {}
      }
      await safeSendMessage(from, content);
      await safeSendMessage(from, `_Want this as a PDF to forward? Reply *REPORT* for the full PDF version._`);
      return true;
    }

    // ── Parent report (optionally for a named learner) ──
    if (reportCommand === 'parent') {
      const learnerName = parentReportMatch[3] ? parentReportMatch[3].trim() : null;
      const saved = getSavedReport(assessmentId, 'parent', learnerName);
      let content;
      if (saved) {
        content = saved.content;
      } else {
        const report = generateInterventionReport(assessmentId);
        content = generateParentSummary(report, learnerName);
        try { saveReport(hashPhone(from), assessmentId, 'parent', content, learnerName); } catch {}
      }
      await safeSendMessage(from, content);
      if (!learnerName) {
        await safeSendMessage(from, `_Tip: ask "parent report for [learner name]" for a report scoped to one learner._`);
      }
      return true;
    }
  }

  if (upper === 'WORKSHEET') {
    const phoneHash = hashPhone(from);
    const pending = pendingIntentState.get(phoneHash);
    if (pending) {
      const intent = { ...pending.intent, type: 'worksheet' };
      pendingIntentState.delete(phoneHash);
      updateTeacherProfile(from, { last_intent: JSON.stringify(intent) });
      await triggerGeneration({ from, intent, deps: buildGenerationDeps() });
    } else {
      await safeSendMessage(from, `What topic should the worksheet cover? Just send me a request like: "Grade 7 fractions worksheet"`);
    }
    return true;
  }

  // ── TEST command (from disambiguation follow-up) ─────────────────────
  if (upper === 'TEST') {
    const phoneHash = hashPhone(from);
    const pending = pendingIntentState.get(phoneHash);
    if (pending) {
      const intent = { ...pending.intent, type: 'test' };
      pendingIntentState.delete(phoneHash);
      updateTeacherProfile(from, { last_intent: JSON.stringify(intent) });
      await triggerGeneration({ from, intent, deps: buildGenerationDeps() });
    } else {
      await safeSendMessage(from, `What topic should the test cover? Just send me a request like: "Grade 7 fractions test"`);
    }
    return true;
  }

  // ── LESSONPLAN command (from disambiguation follow-up) ─────────────────
  if (upper === 'LESSONPLAN') {
    const phoneHash = hashPhone(from);
    const pending = pendingIntentState.get(phoneHash);
    if (pending) {
      const intent = { ...pending.intent, type: 'lessonPlan' };
      pendingIntentState.delete(phoneHash);
      updateTeacherProfile(from, { last_intent: JSON.stringify(intent) });
      await triggerGeneration({ from, intent, deps: buildGenerationDeps() });
    } else {
      await safeSendMessage(from, `What topic should the lesson plan cover? Just send me a request like: "Grade 7 fractions lesson plan"`);
    }
    return true;
  }

  // ── Worksheet differentiation commands (EASIER/HARDER/VISUAL/ORAL) — extracted ─
  if (await handleWorksheetFlow(from, text, buildWorksheetDeps())) return true;

  // ── FORMAL command (parent message) ────────────────────────────────
  if (upper === 'FORMAL') {
    const phoneHash = hashPhone(from);
    const state = parentMessageState.get(phoneHash);
    if (!state || !state.lastContent) {
      await safeSendMessage(from, `Generate a parent message first, then reply FORMAL.`);
      return true;
    }
    const formalQuota = checkAndIncrementUsage(from, 'parentMessage');
    if (!formalQuota.allowed) {
      await safeSendMessage(from,
        `You've hit your free limit (${FREE_LIMIT_DISPLAY()} generations/month). Reply *PRO* to keep going — R${process.env.PRO_PRICE_ZAR || 99}/month. 🚀`
      );
      return true;
    }
    await safeSendMessage(from, `⏳ Generating formal letter version...`);
    try {
      const prompt = buildPrompt({
        type: 'parentMessage',
        situation: state.situation,
        learnerName: state.learnerName,
        grade: state.grade,
        subject: state.subject,
        language: state.language,
        teacherName: state.teacherName,
        school: state.school,
        formal: true,
      }, {});
      const content = await generateContent(prompt, 'parentMessage');
      await safeSendMessage(from, content);
      parentMessageState.delete(phoneHash);
    } catch (err) {
      console.error('[WEBHOOK] Formal letter generation failed:', err.message);
      rollbackUsage(formalQuota, from);
      await safeSendMessage(from, `❌ *Generation failed*\n\nSomething went wrong. Please try again.`);
    }
    return true;
  }

  // ── TRANSLATE command (parent message) ─────────────────────────────
  if (upper === 'TRANSLATE') {
    const phoneHash = hashPhone(from);
    const state = parentMessageState.get(phoneHash);
    if (!state || !state.lastContent) {
      await safeSendMessage(from, `Generate a parent message first, then reply TRANSLATE.`);
      return true;
    }
    state.step = 'ask_translation_language';
    state.lastActivity = Date.now();
    parentMessageState.set(phoneHash, state);
    await safeSendMessage(from, `Which language? (Zulu, Xhosa, Afrikaans, Sotho, Tswana)`);
    return true;
  }

  return false; // Not a command — process normally
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
        await processMessage(message);
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

/**
 * Processes a single incoming WhatsApp message.
 *
 * @param {Object} message - WhatsApp message object
 */
async function processMessage(message) {
  const from        = message.from;
  const messageType = message.type;
  const messageId   = message.id;
  if (!from || !messageId) {
    console.warn("[WEBHOOK] Message missing from or id — skipped");
    return;
  }

  // ── Deduplication ─────────────────────────────────────────────
  if (isDuplicate(messageId)) {
    console.log(`[WEBHOOK] Duplicate message ignored: ${messageId}`);
    return;
  }

  console.log(`[WEBHOOK] Processing message ${messageId} from ...${String(from || '').slice(-4)} (type: ${messageType})`);

  // ── Opt-out check (POPIA compliance) ───────────────────────────
  const teacher = getTeacherByPhone(from);
  if (teacher && teacher.opted_out === 1) {
    // Any message from an opted-out teacher is consent to re-activate
    // (WhatsApp Cloud API policy: any inbound message implies consent to resume).
    // We use opted_out_at to distinguish re-activation from normal flow.
    // opted_out_at is set on STOP and cleared here — it is independent of
    // renewal_reminder_sent_at which is managed by Pro billing logic.
    updateTeacherProfile(from, { opted_out: 0 });
    const db = require('../utils/database').getDb();
    db.prepare(`UPDATE teachers SET opted_out_at = NULL WHERE phone_hash = ?`).run(hashPhone(from));
    await safeSendMessage(from, `👋 Welcome back! You've been re-activated. Send me a request anytime.`);
    console.log(`[WEBHOOK] Teacher ...${String(from).slice(-4)} re-activated after opt-out`);
    // Fall through to normal message processing so their message is not lost
  }

  // ── Update encrypted phone in teachers table ──────────────────
  // Every incoming message gives us a chance to record the phone in encrypted
  // form, which enables proactive messages (confirmations, renewal reminders).
  // updateTeacherProfile is a no-op if the teacher doesn't exist yet;
  // the profile is created during onboarding / first usage check.
  try {
    const phoneEnc = encryptPhone(from);
    updateTeacherProfile(from, { phone_enc: phoneEnc });
  } catch {
    // Non-fatal — encryption setup might not be done yet on first message
  }

  // ── Non-text messages ─────────────────────────────────────────
  const silentTypes = ['reaction', 'sticker', 'contacts', 'location'];
  if (silentTypes.includes(messageType)) {
    return;
  }
  
  // Declare text early so the interactive branch can reassign it
  let text = message.text?.body?.trim();

  if (messageType === 'interactive') {
    const replyText = message.interactive?.button_reply?.title || message.interactive?.list_reply?.title;
    if (replyText) {
      text = replyText;
    } else {
      return;
    }
  }
  
  if (messageType !== 'text' && messageType !== 'interactive') {
    // Allow document and image uploads when teacher is mid data-assessment flow
    if (messageType === 'document' || messageType === 'image') {
      const phoneHashDoc = hashPhone(from);
      if (dataAssessmentState.get(phoneHashDoc)) {
        if (await handleAssessmentFlow(from, '', message, null, buildAssessmentDeps())) return;
      }
    }
    await safeSendMessage(from,
      `I can only handle text messages at the moment — voice notes aren't supported yet.\n\nTo submit marks, start by saying "upload marks" and I'll guide you through it. Or try "Grade 7 algebra worksheet" or reply *HELP* for the full menu. 😊`
    );
    return;
  }

  if (!text) return;

  // ── Command handler (simple commands short-circuit AI; all commands checked here) ──
  const commandHandled = await handleCommand(from, text);
  if (commandHandled) return;

  // ── Onboarding (new users) ────────────────────────────────────
  if (needsOnboarding(from)) {
    const result = handleOnboarding(from, text);
    if (result.handled) {
      await safeSendMessage(from, result.message);
      return;
    }
  }

  // ── Clarification prompt for ambiguous topics ────────────────────
  // Checked BEFORE classification: if the teacher is replying to "what
  // topic would you like?", their reply is the topic itself, not a new
  // request to classify — running it through the classifier would be
  // wrong and wasteful.
  const phoneHash = hashPhone(from);
  const pendingIntent = pendingIntentState.get(phoneHash);

  if (pendingIntent) {
    // Session TTL check (30 minutes)
    if (Date.now() - pendingIntent.lastActivity > 30 * 60 * 1000) {
      pendingIntentState.delete(phoneHash);
    } else {
      // Teacher is providing the topic clarification
      pendingIntentState.delete(phoneHash);
      // Use the teacher's reply as the topic
      const clarifiedIntent = { ...pendingIntent.intent, topic: text.trim() };
      // Store last_intent for RETRY command
      updateTeacherProfile(from, { last_intent: JSON.stringify(clarifiedIntent) });
      // Proceed with generation using the clarified intent
      await triggerGeneration({ from, intent: clarifiedIntent, deps: buildGenerationDeps() });
      return;
    }
  }

  // ── Skip classification entirely if already mid-flow ────────────────
  // If the teacher is in the middle of report comments, parent message,
  // assessment analysis, intervention planning, or profile update, their
  // next message is data for that flow ("78", "skip", "Term 2 test") —
  // not a new request to classify. Running the classifier here would be
  // both wasteful (an AI call every single turn of every conversation)
  // and pointless, since the flow handlers ignore the passed-in intent
  // entirely once their own state already exists.
  const alreadyMidFlow = Boolean(
    reportCommentState.get(phoneHash) ||
    parentMessageState.get(phoneHash) ||
    assessmentAnalysisState.get(phoneHash) ||
    dataAssessmentState.get(phoneHash) ||
    interventionPlanState.get(phoneHash) ||
    profileUpdateState.get(phoneHash) ||
    observationState.get(phoneHash) ||
    observationHistoryState.get(phoneHash) ||
    assessmentSessionState.get(phoneHash) ||
    rosterState.get(phoneHash)
  );

  if (alreadyMidFlow) {
    // Route straight through without classifying — each handler will
    // recognize its own state and continue. Order matches the dispatch
    // order below so behavior is identical to the classified path.
    if (await handleObservationFlow(from, text, null, buildObservationDeps())) return;
    if (await handleObservationHistoryFlow(from, text, null, buildObservationDeps())) return;
    if (await handleAssessmentSessionFlow(from, text, message, null, buildAssessmentSessionDeps())) return;
    if (await handleRosterFlow(from, text, message, null, buildRosterDeps())) return;
    if (await handleReportCommentFlow(from, text, null, buildReportCommentDeps())) return;
    if (await handleProfileUpdateFlow(from, text, buildProfileUpdateDeps())) return;
    if (await handleParentMessageFlow(from, text, null, buildParentMessageDeps())) return;
    if (await handleAssessmentFlow(from, text, message, null, buildAssessmentDeps())) return;
    if (await handleAssessmentAnalysisFlow(from, text, null, buildAssessmentAnalysisDeps())) return;
    if (await handleInterventionPlanFlow(from, text, null, buildInterventionPlanDeps())) return;
    // Defensive fallback: state existed a moment ago but no handler
    // claimed it (e.g. TTL expired between the check above and now) —
    // fall through to normal classification below.
  }

  // ── Classify the message ONCE, with real language understanding ────
  // This single classification result is reused by every multi-turn flow
  // handler below and by the main dispatcher — each flow no longer runs
  // its own separate classification pass (which would multiply AI calls
  // per incoming message and burn through the per-phone rate limit for
  // no reason). The classifier reads the teacher's actual message the way
  // a colleague would — typos, code-switching, indirect phrasing, and
  // inferred grade/subject from their known profile — rather than matching
  // fixed keyword patterns. If the AI call fails for any reason (timeout,
  // network error, malformed response) it transparently falls back to the
  // deterministic regex parser, so a flaky call never breaks the bot.
  const teacherForClassification = getTeacherByPhone(from);
  let lastIntentType = null;
  try {
    if (teacherForClassification?.last_intent) {
      lastIntentType = JSON.parse(teacherForClassification.last_intent)?.type || null;
    }
  } catch { /* ignore malformed last_intent — non-fatal */ }

  const skipClassifier = isClassifierRateLimited(from) || isCeilingReached();
  const intent = skipClassifier
    ? { ...parseIntent(text), _source: isCeilingReached() ? 'fallback-ceiling' : 'fallback-rate-limited' }
    : await classifyIntent(text, {
        grade: teacherForClassification?.grade ?? null,
        subject: teacherForClassification?.subject || null,
        lastIntentType,
      });
  if (intent._source) {
    console.log(`[WEBHOOK] Intent classified via ${intent._source}: ${intent.type}`);
  }

  // ── Observation multi-turn flow ─────────────────────────────────────
  // Checked first: these handlers look at their own session state and
  // cheaply return false if there's none, so this is a pure ordering
  // change. Must precede the other flows below, since any one of them
  // can hijack a message meant for an active observation session if
  // their own intent classifier guesses wrong on ambiguous text like
  // "Add note" or "Delete" (see routing-order regression test).
  const observationHandled = await handleObservationFlow(from, text, intent, buildObservationDeps());
  if (observationHandled) return;

  // ── Observation history multi-turn flow (list + numbered selection) ────
  const observationHistoryHandled = await handleObservationHistoryFlow(from, text, intent, buildObservationDeps());
  if (observationHistoryHandled) return;

  // ── Assessment session multi-turn flow (ADR-006) ────────────────────
  // Checked immediately after the observation flows and before every
  // other flow / general command classification, for the same reason
  // observation sessions are checked first: once a teacher is capturing
  // marks (or picking a Blueprint/Class), a bare number like "4" must be
  // treated as that session's input, not misrouted to another flow's
  // classifier guess.
  const assessmentSessionHandled = await handleAssessmentSessionFlow(from, text, message, intent, buildAssessmentSessionDeps());
  if (assessmentSessionHandled) return;

  // ── Roster multi-turn flow (ADR-006 PR3) ────────────────────────────
  // Exact-command entry points (ROSTER/ADD LEARNER/etc.), checked right
  // after the assessment session flow for the same reason: once a roster
  // session is active, a bare reply like "REPLACE" or a pasted name list
  // is that session's input, not a new intent to classify.
  const rosterHandled = await handleRosterFlow(from, text, message, intent, buildRosterDeps());
  if (rosterHandled) return;

  // ── Report comment multi-turn flow ─────────────────────────────
  const reportCommentHandled = await handleReportCommentFlow(from, text, intent, buildReportCommentDeps());
  if (reportCommentHandled) return;

  // ── Profile update multi-turn flow ─────────────────────────────
  const profileUpdateHandled = await handleProfileUpdateFlow(from, text, buildProfileUpdateDeps());
  if (profileUpdateHandled) return;

  // ── Parent message multi-turn flow ───────────────────────────────
  const parentMessageHandled = await handleParentMessageFlow(from, text, intent, buildParentMessageDeps());
  if (parentMessageHandled) return;

  // ── Data-driven assessment multi-turn flow (Pro) ───────────────────────
  const dataAssessmentHandled = await handleAssessmentFlow(from, text, message, intent, buildAssessmentDeps());
  if (dataAssessmentHandled) return;

  // ── Assessment analysis multi-turn flow (Pro) ───────────────────────
  const assessmentAnalysisHandled = await handleAssessmentAnalysisFlow(from, text, intent, buildAssessmentAnalysisDeps());
  if (assessmentAnalysisHandled) return;

  // ── Curriculum intelligence query (instant, no quota) ────────────────
  const curriculumHandled = await handleCurriculumQueryFlow(from, text, intent);
  if (curriculumHandled) return;

  // ── Intervention plan / SBA support multi-turn flow (Pro) ───────────
  const interventionPlanHandled = await handleInterventionPlanFlow(from, text, intent, buildInterventionPlanDeps());
  if (interventionPlanHandled) return;

  // ── Conversational intents (GREETING, SMALL_TALK, EMOTIONAL_SUPPORT, THANKS, UNKNOWN) ─
  // These should NEVER consume quota, generate PDFs, or invoke content-generation workflows.
  // Replies are generated by Claude directly (reading what the teacher actually said),
  // not picked from a fixed template array. If the teacher is rate-limited (rapid burst)
  // we fall back silently to the templated response rather than showing a curt "please
  // wait" message — that would feel cold in the middle of a teacher venting or just
  // saying hello, and the templated fallback is still warm and instant.
  if (isConversationalIntent(intent.type)) {
    const response = isAiRateLimited(from)
      ? generateConversationalResponse(intent.type, text)
      : await generateConversationalReplyAI(intent.type, text);
    await safeSendMessage(from, response);
    return;
  }

  // Check if topic is ambiguous (null or too short)
  // ATP never has a topic (subject + grade is enough) — skip clarification for it.
  // Assessment analysis and intervention planning are handled entirely by their
  // dedicated flow handlers above (which run before this point and always
  // intercept these intents) — if either reaches here it means that flow
  // somehow didn't catch it, in which case re-routing into the generic
  // "what topic?" clarifier would ask the wrong question. Treat it as
  // UNKNOWN instead so the teacher gets a sensible response either way.
  // moderationPack only needs a topic in full-build mode — if the teacher has
  // a recently analysed assessment (wrap mode), the assessment's own title
  // stands in for the topic, so skip the clarifier in that case.
  const noTopicNeeded = ['atp', 'assessmentAnalysis', 'dataAssessment', 'interventionPlan', 'curriculumQuery', 'observation'];
  const moderationPackHasExistingAssessment = intent.type === 'moderationPack' && !!(getTeacherByPhone(from)?.last_assessment_id);
  if (!noTopicNeeded.includes(intent.type) && !moderationPackHasExistingAssessment && (!intent.topic || intent.topic.length < 3)) {
    pendingIntentState.set(phoneHash, {
      intent,
      lastActivity: Date.now(),
    });
    await safeSendMessage(from, `What topic would you like me to focus on?\n\nFor example:\n• "fractions"\n• "photosynthesis"\n• "the water cycle"\n• "ancient Egypt"\n• "poetry analysis"\n\nPlease reply with the topic.`);
    return;
  }

  if (intent.type === 'assessmentAnalysis' || intent.type === 'interventionPlan' || intent.type === 'observation') {
    // Defensive fallback only — the dedicated flow handlers above should
    // always intercept these before we get here.
    await safeSendMessage(from, `Let's set that up — could you say that again? (e.g. "assessment analysis for Grade 8 Maths", "intervention plan for struggling readers", or "record an observation")`);
    return;
  }

  // Store last_intent for RETRY command
  updateTeacherProfile(from, { last_intent: JSON.stringify(intent) });

  // Process generation
  await triggerGeneration({ from, intent, originalText: text, deps: buildGenerationDeps() });
  return;
}



// ── Helpers ────────────────────────────────────────────────────────────────



/**
 * Generates and sends the compiled PDF for batch report comments.
 *
 * @param {string} from
 * @param {object} state - Report comment state with batch comments
 * @returns {Promise<void>}
 */
function intentLabel(type) {
  const labels = {
    worksheet:   'worksheet',
    test:        'test & memorandum',
    examPaper:   'exam paper & memorandum',
    rubric:      'marking rubric',
    sbaTask:     'SBA task',
    lessonPlan:  'lesson plan',
    explanation: 'explanation',
    atp:         'Annual Teaching Plan',
    assessmentAnalysis: 'assessment analysis',
    dataAssessment:     'data-driven assessment analysis',
    interventionPlan:   'intervention plan',
    moderationPack:     'moderation pack',
    curriculumQuery:    'curriculum intelligence query',
  };
  return labels[type] || 'content';
}

function FREE_LIMIT_DISPLAY() {
  return process.env.FREE_LIMIT || '10';
}

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