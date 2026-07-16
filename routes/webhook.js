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
const { saveObservationSubmission, getObservationHistory, getObservationAssessment } = require('../services/observationRepository');

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

/**
 * Builds the signed, time-limited download URL for a generated PDF.
 * Consolidates what was previously 5 independent copies of the same
 * HMAC-token logic scattered across the file — a change to the signing
 * scheme (e.g. rotating to a longer token, changing the digest algorithm)
 * previously required editing all 5 in lockstep, with no compiler or test
 * to catch a missed one.
 *
 * @param {string} fileId - the PDF's file identifier, as returned by
 *   generatePdf() / generateReportSummaryPdf()
 * @returns {string} full URL, e.g. `${APP_URL}/pdf/${fileId}?t=${token}`
 */
function buildPdfUrl(fileId) {
  const crypto = require('crypto');
  const token = crypto.createHmac('sha256', process.env.PDF_SECRET).update(fileId).digest('hex').slice(0, 16);
  return `${process.env.APP_URL}/pdf/${fileId}?t=${token}`;
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

// ── Report comment conversation state (in-memory) ─────────────────────────
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

/**
 * Handles the multi-turn report comment conversation.
 * Returns true if handled (skip normal processing), false otherwise.
 *
 * @param {string} from
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function handleReportCommentFlow(from, text, preClassifiedIntent = null) {
  const phoneHash = hashPhone(from);
  const state = reportCommentState.get(phoneHash);

  // Session TTL check (30 minutes)
  if (state && Date.now() - state.lastActivity > 30 * 60 * 1000) {
    reportCommentState.delete(phoneHash);
    return false; // Treat as new session
  }

  // If not in report comment flow, check if this is a report comment intent.
  // Uses the intent already classified once at the top of processMessage —
  // avoids firing a second AI classification call for the same message.
  if (!state) {
    const intent = preClassifiedIntent || parseIntent(text);
    if (intent.type === 'reportComment') {
      const teacher = getTeacherByPhone(from);
      reportCommentState.set(phoneHash, {
        step: 'ask_mode',
        grade: teacher?.grade ?? null,
        subject: teacher?.subject || null,
        language: teacher?.language || 'english',
        lastActivity: Date.now(),
      });
      await safeSendMessage(from, `📝 *Report Comment Generator*\n\nHow would you like to enter your learners?\n\n1️⃣ One at a time — I'll guide you through each learner\n\n2️⃣ Paste a class list — paste all names and marks at once\n\nReply with 1 or 2.`);
      return true;
    }
    return false;
  }

  // Handle each step of the conversation
  const trimmed = text.trim();

  if (state.step === 'ask_mode') {
    if (trimmed === '1') {
      state.step = 'ask_learner_name';
      state.lastActivity = Date.now();
      reportCommentState.set(phoneHash, state);
      await safeSendMessage(from, `📝 *Report Comment Generator*\n\nLet's create a professional report comment.\n\n*What is the learner's name?*`);
      return true;
    }
    if (trimmed === '2') {
      state.step = 'ask_class_list';
      state.lastActivity = Date.now();
      reportCommentState.set(phoneHash, state);
      await safeSendMessage(from, `📋 *Paste your class list*\n\nUse this format — one learner per line:\n\n*Name Mark*\n\nExample:\n\nThabo 78\n\nSipho 45\n\nNaledi 92\n\nAmahle 67\n\nYou can also include totals:\n\nThabo 45/50\n\nSipho 38/50\n\nReply with your list when ready.`);
      return true;
    }
    await safeSendMessage(from, `No problem — just reply with 1 for one at a time, or 2 for paste a class list.`);
    return true;
  }

  if (state.step === 'ask_class_list') {
    const lines = trimmed.split('\n');
    const parsedLearners = [];
    const regex = /^([a-zA-Z][a-zA-Z\s'-]{1,30}?)\s+(\d{1,3})(?:\/(\d{1,3}))?/;

    for (const line of lines) {
      const match = line.trim().match(regex);
      if (match) {
        const name = match[1].trim();
        const mark = parseInt(match[2], 10);
        const outOf = match[3] ? parseInt(match[3], 10) : null;
        parsedLearners.push({ name, mark, outOf });
      }
    }

    if (parsedLearners.length < 2) {
      await safeSendMessage(from, `I could only find ${parsedLearners.length} learner(s) in that list. I need at least 2 to work with. Please check the format and try again:\n\nThabo 78\nSipho 45`);
      return true;
    }

    if (parsedLearners.length > 45) {
      await safeSendMessage(from, `That's ${parsedLearners.length} learners — a bit much for one go. Please split into smaller groups (max 45 at a time).`);
      return true;
    }

    state.batch = parsedLearners;
    state.batchIndex = 0;
    state.comments = [];
    state.step = 'ask_behaviour_batch';
    state.lastActivity = Date.now();
    reportCommentState.set(phoneHash, state);

    const firstLearner = state.batch[0];
    const percentage = firstLearner.outOf ? Math.round((firstLearner.mark / firstLearner.outOf) * 100) : firstLearner.mark;
    await safeSendMessage(from, `✅ Found ${parsedLearners.length} learners. Generating comments now...\n\n*${firstLearner.name} — ${percentage}%*\n\nAny behaviour notes? (e.g. "Participates well") or reply *skip* to use mark only.`);
    return true;
  }

  if (state.step === 'ask_behaviour_batch') {
    const currentLearner = state.batch[state.batchIndex];
    // Normalise before comparing: WhatsApp renders *text* as bold
    // client-side, so a teacher replying to a bolded "Reply *skip all*"
    // prompt only ever sees and types the plain words "skip all" — never
    // the literal asterisk characters. The previous exact-match check
    // ('*skip all*') could essentially never be triggered by a real reply,
    // so "skip all" fell through to being stored as literal behaviourNotes
    // text instead of skipping — it showed up in the generated PDF as
    // "Behaviour: skip all" for every learner it was typed for, rather than
    // skipping behaviour notes as the teacher intended.
    const normalised = trimmed.toLowerCase().replace(/\*/g, '').trim();
    const isSkipAll = normalised === 'skip all';
    const isSkipOne = normalised === 'skip';
    const behaviourNotes = (isSkipOne || isSkipAll) ? null : trimmed;

    // Check for skip all
    if (isSkipAll) {
      const remaining = state.batch.length - state.batchIndex;
      await safeSendMessage(from, `⏳ Generating comments for remaining ${remaining} learners...`);
      
      // Generate all remaining comments without behaviour notes
      for (let i = state.batchIndex; i < state.batch.length; i++) {
        const learner = state.batch[i];
        // Per-learner quota check
        const batchQuota = checkAndIncrementUsage(from, 'reportComment');
        if (!batchQuota.allowed) {
          await safeSendMessage(from,
            `That's your free limit for the month — I managed ${i - state.batchIndex} of ${remaining} comments. Reply *PRO* to keep going (R${process.env.PRO_PRICE_ZAR || 99}/month). 🚀`
          );
          // Still send PDF for what was generated so far
          if (state.comments.length > 0) await generateAndSendBatchPdf(from, state);
          reportCommentState.delete(phoneHash);
          return true;
        }
        try {
          await safeSendMessage(from, `⏳ Generating comment for ${learner.name}...`);
          
          const prompt = buildPrompt({
            type: 'reportComment',
            learnerName: learner.name,
            grade: state.grade,
            subject: state.subject,
            mark: learner.mark,
            outOf: learner.outOf,
            behaviourNotes: null,
            language: state.language,
          }, {});

          const content = await generateContent(prompt, 'reportComment');
          state.comments.push({
            learnerName: learner.name,
            mark: learner.mark,
            outOf: learner.outOf,
            behaviourNotes: null,
            comment: content,
          });
        } catch (err) {
          console.error(`[WEBHOOK] Failed to generate comment for ${learner.name}:`, err.message);
          rollbackUsage(batchQuota, from);
          state.comments.push({
            learnerName: learner.name,
            mark: learner.mark,
            outOf: learner.outOf,
            behaviourNotes: null,
            comment: `[Generation failed for ${learner.name}]`,
          });
        }
      }

      // Generate and send PDF
      await generateAndSendBatchPdf(from, state);
      reportCommentState.delete(phoneHash);
      return true;
    }

    // Generate comment for current learner
    const learnerQuota = checkAndIncrementUsage(from, 'reportComment');
    if (!learnerQuota.allowed) {
      await safeSendMessage(from,
        `That's your free limit — I got through ${state.batchIndex} of ${state.batch.length} comments. Reply *PRO* to unlock the rest (R${process.env.PRO_PRICE_ZAR || 99}/month). 🚀`
      );
      if (state.comments.length > 0) await generateAndSendBatchPdf(from, state);
      reportCommentState.delete(phoneHash);
      return true;
    }
    try {
      await safeSendMessage(from, `⏳ Generating comment for ${currentLearner.name}...`);

      const prompt = buildPrompt({
        type: 'reportComment',
        learnerName: currentLearner.name,
        grade: state.grade,
        subject: state.subject,
        mark: currentLearner.mark,
        outOf: currentLearner.outOf,
        behaviourNotes: behaviourNotes,
        language: state.language,
      }, {});

      const content = await generateContent(prompt, 'reportComment');
      state.comments.push({
        learnerName: currentLearner.name,
        mark: currentLearner.mark,
        outOf: currentLearner.outOf,
        behaviourNotes: behaviourNotes,
        comment: content,
      });
    } catch (err) {
      console.error(`[WEBHOOK] Failed to generate comment for ${currentLearner.name}:`, err.message);
      rollbackUsage(learnerQuota, from);
      state.comments.push({
        learnerName: currentLearner.name,
        mark: currentLearner.mark,
        outOf: currentLearner.outOf,
        behaviourNotes: behaviourNotes,
        comment: `[Generation failed for ${currentLearner.name}]`,
      });
    }

    state.batchIndex++;
    state.lastActivity = Date.now();
    reportCommentState.set(phoneHash, state);

    // Check if there are more learners
    if (state.batchIndex < state.batch.length) {
      const nextLearner = state.batch[state.batchIndex];
      const percentage = nextLearner.outOf ? Math.round((nextLearner.mark / nextLearner.outOf) * 100) : nextLearner.mark;
      await safeSendMessage(from, `✅ Comment saved! (${state.batchIndex}/${state.batch.length})\n\n*${nextLearner.name} — ${percentage}%*\n\nAny behaviour notes? or reply *skip*\n\nReply *skip all* to generate all remaining comments without behaviour notes.`);
      return true;
    }

    // All learners done
    await safeSendMessage(from, `✅ All ${state.batch.length} comments generated!\n\nSending your compiled report... 📄`);
    await generateAndSendBatchPdf(from, state);
    reportCommentState.delete(phoneHash);
    return true;
  }

  if (state.step === 'ask_learner_name') {
    if (trimmed.length < 3 || !/[a-zA-Z]/.test(trimmed)) {
      await safeSendMessage(from, "Let me have the learner's name — letters only, at least 3 characters:");
      return true;
    }
    state.learnerName = trimmed;
    state.step = 'ask_mark';
    state.lastActivity = Date.now();
    reportCommentState.set(phoneHash, state);
    await safeSendMessage(from, `Got it! Learner: ${trimmed}\n\n*What mark did they achieve?*\n\nReply with the mark (e.g. "45" or "45/50") or just the percentage (e.g. "75%").`);
    return true;
  }

  if (state.step === 'ask_mark') {
    // Parse mark - could be "45", "45/50", or "75%"
    let mark = null;
    let outOf = null;

    // Try percentage format first
    const percentMatch = trimmed.match(/^(\d+)%$/);
    if (percentMatch) {
      mark = parseInt(percentMatch[1], 10);
      outOf = 100;
    } else {
      // Try fraction format
      const fractionMatch = trimmed.match(/^(\d+)\s*\/\s*(\d+)$/);
      if (fractionMatch) {
        mark = parseInt(fractionMatch[1], 10);
        outOf = parseInt(fractionMatch[2], 10);
      } else {
        // Try just a number - treat as percentage out of 100
        const numMatch = trimmed.match(/^(\d+)$/);
        if (numMatch) {
          mark = parseInt(numMatch[1], 10);
          outOf = 100; // Default to 100 for bare numbers
        }
      }
    }

    // Validation: for percentage format (outOf === 100), check 0-100 range
    // For fraction format, check 0 <= mark <= outOf
    if (mark === null || mark < 0) {
      await safeSendMessage(from, "Let me have a valid mark — 0-100, percentage (e.g. 75%), or fraction (e.g. 45/50):");
      return true;
    }
    if (outOf === 100 && mark > 100) {
      await safeSendMessage(from, "Let me have a valid mark — 0-100, percentage (e.g. 75%), or fraction (e.g. 45/50):");
      return true;
    }
    if (outOf !== null && outOf !== 100 && mark > outOf) {
      await safeSendMessage(from, `The mark can't exceed the total (${outOf}). Let me have a valid mark:`);
      return true;
    }

    state.mark = mark;
    state.outOf = outOf;
    state.step = 'ask_behaviour';
    state.lastActivity = Date.now();
    reportCommentState.set(phoneHash, state);
    await safeSendMessage(from, `Mark recorded: ${mark}${outOf ? `/${outOf}` : ''}%\n\n*Any behaviour notes to include?*\n\nReply with notes (e.g. "Participates well in class") or type *skip* to continue without behaviour notes.`);
    return true;
  }

  if (state.step === 'ask_behaviour') {
    if (trimmed.toLowerCase() !== 'skip') {
      state.behaviourNotes = trimmed;
    } else {
      state.behaviourNotes = null;
    }
    state.step = 'generate';
    state.lastActivity = Date.now();
    reportCommentState.set(phoneHash, state);

    // Generate the comment
    await safeSendMessage(from, `⏳ Generating report comment for ${state.learnerName}...`);

    // Quota check before generating
    const quota = checkAndIncrementUsage(from, 'reportComment');
    if (!quota.allowed) {
      await safeSendMessage(from,
        `You've hit your free limit for the month (${FREE_LIMIT_DISPLAY()} generations). Reply *PRO* to go unlimited — R${process.env.PRO_PRICE_ZAR || 99}/month. 🚀\n\n` +
        `Your content is worth it — and so is your time. 🎓`
      );
      reportCommentState.delete(phoneHash);
      return true;
    }

    try {
      const prompt = buildPrompt({
        type: 'reportComment',
        learnerName: state.learnerName,
        grade: state.grade,
        subject: state.subject,
        mark: state.mark,
        outOf: state.outOf,
        behaviourNotes: state.behaviourNotes,
        language: state.language,
      }, {});

      const content = await generateContent(prompt, 'reportComment');
      await safeSendMessage(from, content);
      await safeSendMessage(from, `\n\n*Next learner or done?*\n\nReply with a learner's name to generate another comment, or type *done* to exit.`);
      state.step = 'ask_next';
      state.lastActivity = Date.now();
      reportCommentState.set(phoneHash, state);
    } catch (err) {
      console.error('[WEBHOOK] Report comment generation failed:', err.message);
      // Roll back usage increment for free-tier teachers
      rollbackUsage(quota, from);
      await safeSendMessage(from, `❌ *Generation failed*\n\nSomething went wrong. Please try again.`);
      reportCommentState.delete(phoneHash);
    }
    return true;
  }

  if (state.step === 'ask_next') {
    if (trimmed.toLowerCase() === 'done') {
      reportCommentState.delete(phoneHash);
      await safeSendMessage(from, `✅ Report comment session ended.\n\nReply *report comment* to start a new session anytime.`);
      return true;
    }

    // Start a new comment for the next learner
    if (trimmed.length < 2) {
      await safeSendMessage(from, "Let me have a valid learner name (at least 2 characters), or type *done* to exit:");
      return true;
    }

    state.learnerName = trimmed;
    state.mark = null;
    state.outOf = null;
    state.behaviourNotes = null;
    state.step = 'ask_mark';
    state.lastActivity = Date.now();
    reportCommentState.set(phoneHash, state);
    await safeSendMessage(from, `Learner: ${trimmed}\n\n*What mark did they achieve?*\n\nReply with the mark (e.g. "45" or "45/50") or just the percentage (e.g. "75%").`);
    return true;
  }

  return false;
}

// ── Parent message flow handler ───────────────────────────────────────────
/**
 * Handles the multi-turn parent message conversation.
 * Returns true if handled (skip normal processing), false otherwise.
 *
 * @param {string} from
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function handleParentMessageFlow(from, text, preClassifiedIntent = null) {
  const phoneHash = hashPhone(from);
  const state = parentMessageState.get(phoneHash);

  // Session TTL check (30 minutes)
  if (state && Date.now() - state.lastActivity > 30 * 60 * 1000) {
    parentMessageState.delete(phoneHash);
    return false; // Treat as new session
  }

  // If not in parent message flow, check if this is a parent message intent.
  // Uses the intent already classified once at the top of processMessage.
  if (!state) {
    const intent = preClassifiedIntent || parseIntent(text);
    if (intent.type === 'parentMessage') {
      const teacher = getTeacherByPhone(from);
      // Detect situation from the message
      const lower = text.toLowerCase();
      let situation = 'general';
      if (/\b(absent|absence|not attending|missing)\b/i.test(lower)) {
        situation = 'absence';
      } else if (/\b(failing|poor marks|struggling|not passing)\b/i.test(lower)) {
        situation = 'failing';
      } else if (/\b(behaviour|conduct|disrupting|disruptive)\b/i.test(lower)) {
        situation = 'behaviour';
      } else if (/\b(meeting|come in|appointment|see you)\b/i.test(lower)) {
        situation = 'meeting';
      } else if (/\b(outstanding work|homework|assignment|missing work)\b/i.test(lower)) {
        situation = 'outstanding_work';
      } else if (/\b(improvement|doing well|progress|great job)\b/i.test(lower)) {
        situation = 'improvement';
      }

      // Try to extract learner name from the message
      const nameMatch = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g);
      const learnerName = nameMatch ? nameMatch[0] : null;

      if (learnerName) {
        // Quota check before generating
        const quota = checkAndIncrementUsage(from, 'parentMessage');
        if (!quota.allowed) {
          await safeSendMessage(from,
            `You've hit your free limit (${FREE_LIMIT_DISPLAY()} generations/month). Reply *PRO* to keep going — R${process.env.PRO_PRICE_ZAR || 99}/month. 🚀`
          );
          return true;
        }
        // Generate immediately
        try {
          const prompt = buildPrompt({
            type: 'parentMessage',
            situation,
            learnerName,
            grade: teacher?.grade ?? null,
            subject: teacher?.subject || 'general',
            language: teacher?.language || 'english',
            teacherName: teacher?.name || null,
            school: teacher?.school || null,
          }, {});
          const content = await generateContent(prompt, 'parentMessage');
          await safeSendMessage(from, content);
          await safeSendMessage(from, `\n\n↩️ Reply FORMAL for a more formal letter version\n\n🌍 Reply TRANSLATE to get it in another language`);
          // Store for FORMAL/TRANSLATE commands
          parentMessageState.set(phoneHash, {
            step: 'post_generation',
            situation,
            learnerName,
            grade: teacher?.grade ?? null,
            subject: teacher?.subject || 'general',
            language: teacher?.language || 'english',
            teacherName: teacher?.name || null,
            school: teacher?.school || null,
            lastContent: content,
            lastActivity: Date.now(),
          });
        } catch (err) {
          console.error('[WEBHOOK] Quick parent message generation failed:', err.message);
          rollbackUsage(quota, from);
          await safeSendMessage(from, `❌ *Generation failed*\n\nSomething went wrong. Please try again.`);
        }
      } else {
        // Ask for learner name
        parentMessageState.set(phoneHash, {
          step: 'ask_learner_name',
          situation,
          grade: teacher?.grade ?? null,
          subject: teacher?.subject || 'general',
          language: teacher?.language || 'english',
          teacherName: teacher?.name || null,
          school: teacher?.school || null,
          lastActivity: Date.now(),
        });
        await safeSendMessage(from, `👨‍👩‍👧 *Parent Message Generator*\n\nWhat is the learner's name?`);
      }
      return true;
    }
    return false;
  }

  // Handle each step of the conversation
  const trimmed = text.trim();

  if (state.step === 'ask_learner_name') {
    if (trimmed.length < 2 || !/[a-zA-Z]/.test(trimmed)) {
      await safeSendMessage(from, "Let me have the learner's name (at least 2 characters):");
      return true;
    }
    state.learnerName = trimmed;
    state.step = 'generate';
    state.lastActivity = Date.now();
    parentMessageState.set(phoneHash, state);

    // Generate the message
    await safeSendMessage(from, `⏳ Generating parent message for ${trimmed}...`);

    const quota = checkAndIncrementUsage(from, 'parentMessage');
    if (!quota.allowed) {
      await safeSendMessage(from,
        `You've hit your free limit for the month (${FREE_LIMIT_DISPLAY()} generations). Reply *PRO* to go unlimited — R${process.env.PRO_PRICE_ZAR || 99}/month. 🚀\n\n` +
        `Your content is worth it — and so is your time. 🎓`
      );
      parentMessageState.delete(phoneHash);
      return true;
    }

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
      }, {});
      const content = await generateContent(prompt, 'parentMessage');
      await safeSendMessage(from, content);
      await safeSendMessage(from, `\n\n↩️ Reply FORMAL for a more formal letter version\n\n🌍 Reply TRANSLATE to get it in another language`);
      state.step = 'post_generation';
      state.lastContent = content;
      state.lastActivity = Date.now();
      parentMessageState.set(phoneHash, state);
    } catch (err) {
      console.error('[WEBHOOK] Parent message generation failed:', err.message);
      rollbackUsage(quota, from);
      await safeSendMessage(from, `❌ *Generation failed*\n\nSomething went wrong. Please try again.`);
      parentMessageState.delete(phoneHash);
    }
    return true;
  }

  if (state.step === 'post_generation') {
    // This step is handled by FORMAL and TRANSLATE commands in handleCommand
    // Just clear the state if they send something else
    parentMessageState.delete(phoneHash);
    return false;
  }

  if (state.step === 'ask_translation_language') {
    const language = trimmed.toLowerCase();
    const supportedLanguages = ['english', 'afrikaans', 'zulu', 'xhosa', 'sotho', 'tswana', 'sepedi', 'xitsonga', 'siswati', 'tshivenda', 'ndebele'];
    if (!supportedLanguages.includes(language)) {
      await safeSendMessage(from, `Please choose from: English, Afrikaans, Zulu, Xhosa, Sotho, Tswana, Sepedi, Xitsonga, Siswati, Tshivenda, or Ndebele.`);
      return true;
    }
    // Generate translation
    const translateQuota = checkAndIncrementUsage(from, 'parentMessage');
    if (!translateQuota.allowed) {
      await safeSendMessage(from,
        `You've hit your free limit (${FREE_LIMIT_DISPLAY()} generations/month). Reply *PRO* to keep going — R${process.env.PRO_PRICE_ZAR || 99}/month. 🚀`
      );
      parentMessageState.delete(phoneHash);
      return true;
    }
    await safeSendMessage(from, `⏳ Translating to ${language.charAt(0).toUpperCase() + language.slice(1)}...`);
    try {
      const prompt = buildPrompt({
        type: 'parentMessage',
        situation: state.situation,
        learnerName: state.learnerName,
        grade: state.grade,
        subject: state.subject,
        language: language,
        teacherName: state.teacherName,
        school: state.school,
        translateFrom: state.lastContent,
      }, {});
      const content = await generateContent(prompt, 'parentMessage');
      await safeSendMessage(from, content);
      parentMessageState.delete(phoneHash);
    } catch (err) {
      console.error('[WEBHOOK] Translation failed:', err.message);
      rollbackUsage(translateQuota, from);
      await safeSendMessage(from, `❌ *Translation failed*\n\nSomething went wrong. Please try again.`);
      parentMessageState.delete(phoneHash);
    }
    return true;
  }

  return false;
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
async function handleDataAssessmentFlow(from, text, message = null, preClassifiedIntent = null) {
  const phoneHash = hashPhone(from);
  let state = dataAssessmentState.get(phoneHash);

  // ── Not mid-flow: check if this is a fresh trigger ──
  if (!state) {
    const intent = preClassifiedIntent || parseIntent(text);
    if (intent.type !== 'dataAssessment') return false;

    // Pro gate — isProActive requires the teacher ROW (it reads teacher.is_pro /
    // teacher.pro_expires), not a phone number. Passing `from` directly always
    // evaluated to false, which meant this entire Pro feature was unreachable
    // for every teacher, including those who had already paid.
    if (!isProActive(getTeacherByPhone(from))) {
      await safeSendMessage(from,
        '📊 Data-driven assessment analysis (item analysis, error analysis, learner grouping) is a *Pro feature*.\n\n' +
        'It gives you facility values, discrimination indices, and full CAPS-aligned diagnostic reports.\n\n' +
        'Reply *UPGRADE* to unlock, or use the conversational *assessment analysis* feature instead.'
      );
      return true;
    }

    // Start the flow — collect metadata first
    dataAssessmentState.set(phoneHash, {
      step: 'awaitingTitle',
      grade: intent.grade ?? null,
      subject: intent.subject || null,
      title: null,
      term: null,
      lastActivity: Date.now(),
    });

    await safeSendMessage(from,
      '📊 *Data-Driven Assessment Analysis*\n\n' +
      'I\'ll run a full item analysis, error analysis, and learner grouping with CAPS-aligned recommendations.\n\n' +
      'First, what is the *title* of this assessment? (e.g. "Term 2 Test", "June Exam")'
    );
    return true;
  }

  // Update activity timestamp
  state = { ...state, lastActivity: Date.now() };

  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  // Allow cancellation at any step
  if (/^(cancel|stop|exit|quit|nevermind|never mind)\b/i.test(trimmed)) {
    dataAssessmentState.delete(phoneHash);
    await safeSendMessage(from, '✅ Data assessment cancelled. What else can I help you with?');
    return true;
  }

  // ── Step: collect assessment title ──
  if (state.step === 'awaitingTitle') {
    state.title = trimmed || 'Assessment';
    state.step = 'awaitingGrade';
    dataAssessmentState.set(phoneHash, state);

    if (state.grade) {
      // Grade already known from trigger phrase — skip straight to subject
      state.step = state.subject ? 'awaitingTerm' : 'awaitingSubject';
      dataAssessmentState.set(phoneHash, state);
      if (state.subject) {
        await safeSendMessage(from, `Which *term* is this assessment for? (1, 2, 3, or 4)`);
      } else {
        await safeSendMessage(from, `Which *subject* is "${state.title}" for?`);
      }
    } else {
      await safeSendMessage(from, `Which *grade* is this assessment for? (e.g. Grade 8, Grade 10)`);
    }
    return true;
  }

  // ── Step: collect grade ──
  if (state.step === 'awaitingGrade') {
    const gradeMatch = trimmed.match(/\b(\d{1,2})\b/);
    if (!gradeMatch) {
      await safeSendMessage(from, 'Please enter the grade number, e.g. "8" or "Grade 10".');
      return true;
    }
    state.grade = parseInt(gradeMatch[1], 10);
    state.step = state.subject ? 'awaitingTerm' : 'awaitingSubject';
    dataAssessmentState.set(phoneHash, state);
    if (state.subject) {
      await safeSendMessage(from, `Which *term* is this for? (1, 2, 3, or 4)`);
    } else {
      await safeSendMessage(from, `Which *subject*?`);
    }
    return true;
  }

  // ── Step: collect subject ──
  if (state.step === 'awaitingSubject') {
    state.subject = trimmed;
    state.step = 'awaitingTerm';
    dataAssessmentState.set(phoneHash, state);
    await safeSendMessage(from, `Which *term*? (1, 2, 3, or 4)`);
    return true;
  }

  // ── Step: collect term ──
  if (state.step === 'awaitingTerm') {
    const termMatch = trimmed.match(/\b([1-4])\b/);
    state.term = termMatch ? parseInt(termMatch[1], 10) : 1;
    state.step = 'awaitingMarks';
    dataAssessmentState.set(phoneHash, state);
    await safeSendMessage(from, getFormatHelpText());
    return true;
  }

  // ── Step: receive marks (text or document) ──
  if (state.step === 'awaitingMarks') {
    let parseResult = null;

    // ── Case 1: Teacher uploaded a document (CSV or Excel) ──
    const isDocument = message && message.type === 'document';
    if (isDocument) {
      const mediaId = message.document?.id;
      const filename = message.document?.filename || '';
      const mimeType = message.document?.mime_type || '';
      const isCsv  = /\.csv$/i.test(filename) || mimeType === 'text/csv' || mimeType === 'text/plain';
      const isXlsx = /\.xlsx?$/i.test(filename) ||
                     mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                     mimeType === 'application/vnd.ms-excel';

      if (!mediaId) {
        await safeSendMessage(from, '⚠️ Could not read the document. Please try sending it again.');
        return true;
      }
      if (!isCsv && !isXlsx) {
        await safeSendMessage(from,
          '⚠️ Please upload a *CSV* (.csv) or *Excel* (.xlsx) file.\n\n' +
          'You can also type marks directly or send a photo of your mark sheet.'
        );
        return true;
      }

      const fileLabel = isXlsx ? 'Excel file' : 'CSV file';
      await safeSendMessage(from, `⏳ Downloading your ${fileLabel}...`);
      try {
        const { buffer } = await downloadMedia(mediaId);
        parseResult = parseMarks(buffer, isXlsx ? 'xlsx' : 'csv');
      } catch (err) {
        console.error('[DataAssessment] Media download failed:', err.message);
        await safeSendMessage(from,
          '⚠️ I couldn\'t download that file. Please try again, or type your marks directly.'
        );
        return true;
      }
    }

    // ── Case 1b: Teacher uploaded an image (photo of mark sheet) ──
    const isImage = message && message.type === 'image';
    if (isImage && !parseResult) {
      const mediaId = message.image?.id;
      const mimeType = message.image?.mime_type || 'image/jpeg';

      if (!mediaId) {
        await safeSendMessage(from, '⚠️ Could not read the image. Please try again.');
        return true;
      }

      await safeSendMessage(from, '📸 Reading your mark sheet... This may take a moment. ⏳');
      try {
        const { buffer } = await downloadMedia(mediaId);
        parseResult = await extractMarksFromImage(buffer, mimeType);
      } catch (err) {
        console.error('[DataAssessment] Image download/vision failed:', err.message);
        await safeSendMessage(from,
          '⚠️ I couldn\'t read the mark sheet from that image. Please try a clearer photo, or upload a CSV/Excel file.'
        );
        return true;
      }
    }

    // ── Case 2: Teacher typed marks inline ──
    if (!parseResult && trimmed) {
      parseResult = parseMarks(trimmed, 'auto');
    }

    // No usable input yet
    if (!parseResult) {
      await safeSendMessage(from,
        'Please type your marks or upload a CSV file.\n\n' + getFormatHelpText()
      );
      return true;
    }

    // Parse errors
    if (parseResult.errors.length > 0) {
      dataAssessmentState.set(phoneHash, state); // keep state
      await safeSendMessage(from,
        '⚠️ *Could not read the marks:*\n\n' +
        parseResult.errors.map(e => `• ${e}`).join('\n') +
        '\n\nPlease correct the format and try again.\n\n' +
        getFormatHelpText()
      );
      return true;
    }

    // Too few learners for meaningful analysis
    if (parseResult.learners.length < 2) {
      await safeSendMessage(from,
        '⚠️ I need at least 2 learners to run a meaningful analysis. Please include all learners and try again.'
      );
      dataAssessmentState.set(phoneHash, state);
      return true;
    }

    // Acknowledge warnings
    if (parseResult.warnings.length > 0) {
      await safeSendMessage(from,
        '⚠️ *Notes on your data:*\n' +
        parseResult.warnings.map(w => `• ${w}`).join('\n') +
        '\n\nContinuing with the analysis...'
      );
    } else {
      await safeSendMessage(from,
        `✅ Received marks for *${parseResult.learners.length} learners* across *${parseResult.questionCount || 0} question(s)*.\n\nRunning full diagnostic analysis — this may take a moment... ⏳`
      );
    }

    // ── Run the diagnostic pipeline ──
    let diagnosticResults;
    try {
      const assessmentData = {
        title: state.title,
        grade: state.grade,
        subject: state.subject,
        term: state.term,
        type: 'test',
        totalMarks: parseResult.totalMark,
        atpTopics: Object.values(parseResult.questionTopics || {}),
        learnerResults: parseResult.learners, // already in { learnerName, mark, totalMarks, questionData } shape
      };
      diagnosticResults = processAssessmentData(phoneHash, assessmentData);
    } catch (err) {
      console.error('[DataAssessment] Pipeline error:', err.message, err.stack);
      dataAssessmentState.delete(phoneHash);
      await safeSendMessage(from,
        '⚠️ Something went wrong during analysis. Please try again or contact support.'
      );
      return true;
    }

    dataAssessmentState.delete(phoneHash);

    if (diagnosticResults.error) {
      await safeSendMessage(from, `⚠️ Analysis failed: ${diagnosticResults.error}`);
      return true;
    }

    // ── Format and send the diagnostic summary (Steps 1–5) ──
    const { analyses } = diagnosticResults;
    const ia = analyses.itemAnalysis;
    const ea = analyses.errorAnalysis;
    const lg = analyses.learnerGrouping;

    let summary = `📊 *Diagnostic Report — ${state.title}*\n`;
    summary += `${gradeLabel(state.grade)} ${state.subject} | Term ${state.term}\n`;
    summary += `${parseResult.learners.length} learners analysed\n\n`;

    // Step 1–2: Item analysis summary
    if (ia && !ia.error) {
      summary += ia.summary + '\n';
      const worst = (ia.questions || [])
        .filter(q => q.difficultyCategory === 'difficult' || q.difficultyCategory === 'very_difficult')
        .slice(0, 3);
      if (worst.length > 0) {
        summary += `*Questions needing reteaching:*\n`;
        worst.forEach(q => {
          const topicLabel = q.topic ? ` (${q.topic})` : '';
          summary += `• Q${q.questionNumber}${topicLabel}: facility value ${(q.facilityValue * 100).toFixed(0)}%, `;
          summary += `${(q.successRate * 100).toFixed(0)}% succeeded\n`;
        });
        summary += '\n';
      }
    }

    // Step 3: Error analysis summary
    if (ea && !ea.error && ea.summary) {
      summary += ea.summary + '\n';
    }

    // Step 5: Learner grouping — remap A/B/C/D → Group 1-4 (spec labels)
    // Group A (80-100%) = Group 4 Advanced
    // Group B (60-79%)  = Group 3 Proficient
    // Group C (40-59%)  = Group 2 Developing
    // Group D (0-39%)   = Group 1 Intensive Support
    const groupData = {};
    if (lg && !lg.error && lg.groups) {
      const g = lg.groups;
      groupData.group4 = { count: (g.A || {}).count || 0, names: ((g.A || {}).learners || []).map(l => l.name) };
      groupData.group3 = { count: (g.B || {}).count || 0, names: ((g.B || {}).learners || []).map(l => l.name) };
      groupData.group2 = { count: (g.C || {}).count || 0, names: ((g.C || {}).learners || []).map(l => l.name) };
      groupData.group1 = { count: (g.D || {}).count || 0, names: ((g.D || {}).learners || []).map(l => l.name) };

      summary += `*👥 Learner Grouping:*\n`;
      summary += `• Group 4 — Advanced (80–100%): ${groupData.group4.count} learner${groupData.group4.count !== 1 ? 's' : ''}\n`;
      summary += `• Group 3 — Proficient (60–79%): ${groupData.group3.count} learner${groupData.group3.count !== 1 ? 's' : ''}\n`;
      summary += `• Group 2 — Developing (40–59%): ${groupData.group2.count} learner${groupData.group2.count !== 1 ? 's' : ''}\n`;
      summary += `• Group 1 — Intensive Support (0–39%): ${groupData.group1.count} learner${groupData.group1.count !== 1 ? 's' : ''}\n`;
      if (lg.classAverage !== undefined) summary += `\n_Class average: ${lg.classAverage}%_\n`;
    } else {
      // Fallback: compute groups from parseResult directly (in case DB pipeline failed)
      const learners = parseResult.learners || [];
      groupData.group4 = { count: 0, names: [] };
      groupData.group3 = { count: 0, names: [] };
      groupData.group2 = { count: 0, names: [] };
      groupData.group1 = { count: 0, names: [] };
      for (const l of learners) {
        const pct = l.totalMarks > 0 ? Math.round((l.mark / l.totalMarks) * 100) : 0;
        if (pct >= 80)      { groupData.group4.count++; groupData.group4.names.push(l.learnerName); }
        else if (pct >= 60) { groupData.group3.count++; groupData.group3.names.push(l.learnerName); }
        else if (pct >= 40) { groupData.group2.count++; groupData.group2.names.push(l.learnerName); }
        else                { groupData.group1.count++; groupData.group1.names.push(l.learnerName); }
      }
    }

    await safeSendMessage(from, summary);

    // Store the assessmentId in profile for REPORT command follow-up
    if (diagnosticResults.assessmentId) {
      updateTeacherProfile(from, { last_assessment_id: String(diagnosticResults.assessmentId) });
    }

    // ── Steps 6–10: AI-powered Intervention Package ──────────────────────────
    await safeSendMessage(from,
      '⏳ *Generating your intervention plan...* (Steps 6–10)\n_This takes 20–30 seconds._'
    );

    // This flow is Pro-gated at entry, so quota is never actually blocking —
    // but every other generateContent() call site records the attempt via
    // checkAndIncrementUsage()/rollbackUsage() so usage_events (and the
    // STATUS command's usage count) stay accurate. This call — the single
    // most expensive prompt in the app (fullInterventionPlan, 8,192-token
    // budget) — was the one path that skipped that logging entirely.
    const quota = checkAndIncrementUsage(from, 'fullInterventionPlan');

    try {
      // Extract weak topics and error patterns for the AI prompt
      const weakTopics = (ia && !ia.error)
        ? (ia.questions || [])
            .filter(q => q.difficultyCategory === 'difficult' || q.difficultyCategory === 'very_difficult')
            .map(q => q.topic || `Question ${q.questionNumber}`)
            .filter(Boolean)
        : [];

      const errorPatterns = (ea && !ea.error && ea.errorPatterns)
        ? ea.errorPatterns.slice(0, 5).map(p => p.description || p.type || String(p))
        : [];

      const classAvg = (lg && lg.classAverage) ? `${lg.classAverage}%` : 'Not calculated';

      const interventionPrompt = buildFullInterventionPlanPrompt({
        grade: state.grade,
        subject: state.subject,
        term: state.term,
        assessmentTitle: state.title,
        classAverage: classAvg,
        weakTopics,
        errorPatterns,
        groups: groupData,
        totalLearners: parseResult.learners.length,
      });

      const interventionResponse = await generateContent(interventionPrompt, 'fullInterventionPlan');

      // Persist the AI plan text so interventionReportsService prefers it over
      // the rules-based fallback when HOD/parent reports are requested later.
      try {
        saveReport(phoneHash, diagnosticResults.assessmentId, 'ai_intervention_plan', interventionResponse);
        // The full diagnostic report (summary + AI plan) is what REPORT sends back
        // as a PDF — save it now so that command doesn't need to regenerate AI content.
        saveReport(phoneHash, diagnosticResults.assessmentId, 'diagnostic', `${summary}\n\n${interventionResponse}`);
      } catch (saveErr) {
        // Non-fatal — teacher already has the content in-chat even if persistence fails.
        console.error('[DataAssessment] Failed to persist report:', saveErr.message);
      }

      // Parse the AI response into sections by delimiter
      const sections = parseInterventionSections(interventionResponse);

      if (sections.step6) {
        await safeSendMessage(from,
          `📋 *Step 6 — Intervention Plan*\n\n${sections.step6.trim()}`
        );
      }
      if (sections.step7) {
        await safeSendMessage(from,
          `🎯 *Step 7 — Differentiated Activities*\n\n${sections.step7.trim()}`
        );
      }
      if (sections.step8) {
        await safeSendMessage(from,
          `🔁 *Step 8 — Reteaching Plan*\n\n${sections.step8.trim()}`
        );
      }
      if (sections.step9) {
        await safeSendMessage(from,
          `📅 *Step 9 — Monitoring Plan*\n\n${sections.step9.trim()}`
        );
      }
      if (sections.step10) {
        await safeSendMessage(from,
          `📄 *Step 10 — Professional Summary*\n\n${sections.step10.trim()}\n\n` +
          `_Reply *REPORT* for the full diagnostic PDF._`
        );
      } else {
        await safeSendMessage(from,
          '📄 *Full report ready.* Reply *REPORT* to receive the diagnostic PDF.\n' +
          'Or ask for *parent report*, *HOD report*, *moderation pack*, or more *differentiated activities*.'
        );
      }
    } catch (aiErr) {
      console.error('[DataAssessment] Steps 6–10 AI error:', aiErr.message);
      rollbackUsage(quota, from);
      // Non-fatal: Steps 1–5 already sent. Persist what we have so REPORT
      // still has real content to send, even without the AI intervention plan.
      try {
        saveReport(phoneHash, diagnosticResults.assessmentId, 'diagnostic', summary);
      } catch (saveErr) {
        console.error('[DataAssessment] Failed to persist fallback report:', saveErr.message);
      }
      await safeSendMessage(from,
        '📄 *Intervention plan ready.* Reply *REPORT* to receive the full diagnostic PDF with:\n' +
        '• Complete item analysis table\n' +
        '• Error analysis by CAPS topic\n' +
        '• Intervention plan for each learner group\n' +
        '• Reteaching recommendations\n\n' +
        'Or ask for a *parent report*, *HOD report*, *moderation pack*, or *differentiated activities*.'
      );
    }

    return true;
  }

  return false;
}

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
/**
 * Handles the multi-turn assessment analysis / diagnostics conversation.
 * Pro-only — gated the same way ATP is gated, before any state is created.
 * Returns true if handled (skip normal processing), false otherwise.
 *
 * @param {string} from
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function handleAssessmentAnalysisFlow(from, text, preClassifiedIntent = null) {
  const phoneHash = hashPhone(from);
  const state = assessmentAnalysisState.get(phoneHash);

  // Session TTL check (30 minutes)
  if (state && Date.now() - state.lastActivity > 30 * 60 * 1000) {
    assessmentAnalysisState.delete(phoneHash);
    return false;
  }

  // Entry point — only start the flow if this is a fresh assessmentAnalysis intent.
  // Uses the intent already classified once at the top of processMessage.
  if (!state) {
    const intent = preClassifiedIntent || parseIntent(text);
    if (intent.type !== 'assessmentAnalysis') return false;

    const teacher = getTeacherByPhone(from);
    if (!isProActive(teacher)) {
      await safeSendMessage(from,
        `⭐ *Assessment analysis is a Pro feature*\n\n` +
        `Upgrade to Pro for R${process.env.PRO_PRICE_ZAR || 99}/month to get diagnostic breakdowns of your class results, plus unlimited generations and PDF downloads.\n\n` +
        `Reply *PRO* to upgrade. 🎓`
      );
      return true;
    }

    assessmentAnalysisState.set(phoneHash, {
      step: 'ask_grade_subject',
      grade: teacher?.grade ?? null,
      subject: teacher?.subject || null,
      language: teacher?.language || 'english',
      lastActivity: Date.now(),
    });

    // If we already know grade & subject from profile, skip straight to the
    // assessment name question — don't ask what we already know.
    const knownGrade = teacher?.grade;
    const knownSubject = teacher?.subject;
    if (knownGrade && knownSubject) {
      const st = assessmentAnalysisState.get(phoneHash);
      st.step = 'ask_assessment_name';
      assessmentAnalysisState.set(phoneHash, st);
      await safeSendMessage(from,
        `📊 *Assessment Analysis*\n\nI'll use ${knownSubject} Grade ${knownGrade} from your profile. What was the assessment? (e.g. "Term 2 test", "fractions quiz")\n\n_Reply CANCEL anytime to stop._`
      );
      return true;
    }

    await safeSendMessage(from,
      `📊 *Assessment Analysis*\n\nLet's break down how your class did. What grade and subject is this for? (e.g. "Grade 8 Maths")\n\n_Reply CANCEL anytime to stop._`
    );
    return true;
  }

  const trimmed = text.trim();
  if (trimmed.toUpperCase() === 'CANCEL') {
    assessmentAnalysisState.delete(phoneHash);
    await safeSendMessage(from, `No problem — assessment analysis cancelled.`);
    return true;
  }

  if (state.step === 'ask_grade_subject') {
    const parsedGrade = parseGrade(trimmed);
    const grade = parsedGrade !== null ? parsedGrade : state.grade;
    // Reuse the subject patterns already proven in intentParser for consistency
    const { parseIntent: parseForSubject } = require('../utils/intentParser');
    const subjectGuess = parseForSubject(trimmed).subject;
    const subject = subjectGuess !== 'general' ? subjectGuess : state.subject;

    if (grade == null || !subject) {
      await safeSendMessage(from, `I still need both a grade and a subject — e.g. "Grade 8 Mathematics". What grade and subject is this for?`);
      return true;
    }

    state.grade = grade;
    state.subject = subject;
    state.step = 'ask_assessment_name';
    state.lastActivity = Date.now();
    assessmentAnalysisState.set(phoneHash, state);
    await safeSendMessage(from, `Got it — ${gradeLabel(grade)} ${subject}. What was the assessment? (e.g. "Term 2 test", "fractions quiz")`);
    return true;
  }

  if (state.step === 'ask_assessment_name') {
    if (trimmed.length < 2) {
      await safeSendMessage(from, `Let me have a short name for the assessment, e.g. "Term 2 test" or "fractions quiz":`);
      return true;
    }
    state.assessmentName = trimmed;
    state.step = 'ask_topics';
    state.lastActivity = Date.now();
    assessmentAnalysisState.set(phoneHash, state);
    await safeSendMessage(from, `What topics or sections did it cover? (e.g. "fractions, decimals and percentages")`);
    return true;
  }

  if (state.step === 'ask_topics') {
    if (trimmed.length < 2) {
      await safeSendMessage(from, `What topics did the assessment cover? Just list them, e.g. "fractions, decimals":`);
      return true;
    }
    state.topics = trimmed;
    state.step = 'ask_performance';
    state.lastActivity = Date.now();
    assessmentAnalysisState.set(phoneHash, state);
    await safeSendMessage(from,
      `Now tell me how the class did — whatever you've got is fine. For example:\n\n` +
      `• A rough class average ("average was around 55%")\n` +
      `• A list of marks ("Thabo 18/30, Sipho 22/30, ...")\n` +
      `• Just your impression ("most struggled with word problems, a few aced it")\n\n` +
      `Reply with what you have.`
    );
    return true;
  }

  if (state.step === 'ask_performance') {
    if (trimmed.length < 3) {
      await safeSendMessage(from, `Tell me a bit about how the class performed — even a rough impression is fine.`);
      return true;
    }
    state.performanceData = trimmed;
    state.lastActivity = Date.now();
    assessmentAnalysisState.set(phoneHash, state);

    // Pro is already confirmed at entry, but re-check + apply the standard
    // atomic quota gate (Pro = unlimited, never actually blocks, but keeps
    // usage logging consistent with every other generation path).
    const quota = checkAndIncrementUsage(from, 'assessmentAnalysis');
    if (!quota.allowed) {
      await safeSendMessage(from,
        `You've hit your free limit (${FREE_LIMIT_DISPLAY()} generations/month). Reply *PRO* to keep going — R${process.env.PRO_PRICE_ZAR || 99}/month. 🚀`
      );
      assessmentAnalysisState.delete(phoneHash);
      return true;
    }

    await safeSendMessage(from, `⏳ Analysing your class's results...`);
    try {
      const prompt = buildPrompt({
        type: 'assessmentAnalysis',
        grade: state.grade,
        subject: state.subject,
        assessmentName: state.assessmentName,
        topics: state.topics,
        performanceData: state.performanceData,
        language: state.language,
      }, {});
      const content = await generateContent(prompt, 'assessmentAnalysis');
      await safeSendMessage(from, content);

      const stillPro = isProActive(getTeacherByPhone(from));
      if (stillPro) {
        try {
          const { fileId, filename } = await generatePdf({
            content,
            type: 'assessmentAnalysis',
            topic: state.assessmentName,
            grade: gradeLabel(state.grade),
            subject: state.subject,
            school: (getTeacherByPhone(from) || {}).school || '',
          });
          const pdfUrl = buildPdfUrl(fileId);
          await sendDocument(from, pdfUrl, filename, `📎 *PDF Download* (available for 2 hours)`);
        } catch (pdfErr) {
          console.error('[WEBHOOK] Assessment analysis PDF generation failed:', pdfErr.message);
        }
      }

      await safeSendMessage(from, `💡 Want me to turn this into an intervention plan for the learners who need the most help? Just say "intervention plan" or reply *HELP* for everything else I can do.`);
    } catch (err) {
      console.error('[WEBHOOK] Assessment analysis generation failed:', err.message);
      rollbackUsage(quota, from);
      await safeSendMessage(from, `❌ Something went wrong generating that analysis. Please try again.`);
    }
    assessmentAnalysisState.delete(phoneHash);
    return true;
  }

  return false;
}

// ── Intervention plan / SBA support flow handler (Pro feature) ─────────────
/**
 * Handles the multi-turn intervention planning and SBA support conversation.
 * Pro-only — gated before any state is created.
 * Returns true if handled (skip normal processing), false otherwise.
 *
 * @param {string} from
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function handleInterventionPlanFlow(from, text, preClassifiedIntent = null) {
  const phoneHash = hashPhone(from);
  const state = interventionPlanState.get(phoneHash);

  if (state && Date.now() - state.lastActivity > 30 * 60 * 1000) {
    interventionPlanState.delete(phoneHash);
    return false;
  }

  if (!state) {
    const intent = preClassifiedIntent || parseIntent(text);
    if (intent.type !== 'interventionPlan') return false;

    const teacher = getTeacherByPhone(from);
    if (!isProActive(teacher)) {
      await safeSendMessage(from,
        `⭐ *Intervention planning & SBA support are Pro features*\n\n` +
        `Upgrade to Pro for R${process.env.PRO_PRICE_ZAR || 99}/month to get structured intervention plans and SBA guidance, plus unlimited generations and PDF downloads.\n\n` +
        `Reply *PRO* to upgrade. 🎓`
      );
      return true;
    }

    // Detect which of the two related needs this is — SBA logistics/admin
    // questions vs an actual remediation plan for struggling learners.
    const lower = text.toLowerCase();
    const isSba = /\b(sba|school[\s-]based assessment)\b/i.test(lower) && !/\bstruggl|behind|intervention\b/i.test(lower);

    interventionPlanState.set(phoneHash, {
      mode: isSba ? 'sba' : 'intervention',
      step: 'ask_grade_subject',
      grade: teacher?.grade ?? null,
      subject: teacher?.subject || null,
      language: teacher?.language || 'english',
      lastActivity: Date.now(),
    });

    const knownGrade = teacher?.grade;
    const knownSubject = teacher?.subject;
    if (knownGrade && knownSubject) {
      const st = interventionPlanState.get(phoneHash);
      st.step = isSba ? 'ask_sba_context' : 'ask_focus_area';
      interventionPlanState.set(phoneHash, st);
      if (isSba) {
        await safeSendMessage(from,
          `📋 *SBA Support*\n\nI'll use ${knownSubject} Grade ${knownGrade} from your profile. What do you need help with — a specific task, the term's schedule, weighting, or record-keeping?\n\n_Reply CANCEL anytime to stop._`
        );
      } else {
        await safeSendMessage(from,
          `🎯 *Intervention Plan*\n\nI'll use ${knownSubject} Grade ${knownGrade} from your profile. What's the focus — a specific topic the class is struggling with, or particular learners falling behind?\n\n_Reply CANCEL anytime to stop._`
        );
      }
      return true;
    }

    await safeSendMessage(from,
      (isSba
        ? `📋 *SBA Support*\n\nWhat grade and subject is this for? (e.g. "Grade 10 Physical Sciences")`
        : `🎯 *Intervention Plan*\n\nWhat grade and subject is this for? (e.g. "Grade 8 Mathematics")`
      ) + `\n\n_Reply CANCEL anytime to stop._`
    );
    return true;
  }

  const trimmed = text.trim();
  if (trimmed.toUpperCase() === 'CANCEL') {
    interventionPlanState.delete(phoneHash);
    await safeSendMessage(from, `No problem — cancelled.`);
    return true;
  }

  if (state.step === 'ask_grade_subject') {
    const parsedGrade = parseGrade(trimmed);
    const grade = parsedGrade !== null ? parsedGrade : state.grade;
    const { parseIntent: parseForSubject } = require('../utils/intentParser');
    const subjectGuess = parseForSubject(trimmed).subject;
    const subject = subjectGuess !== 'general' ? subjectGuess : state.subject;

    if (grade == null || !subject) {
      await safeSendMessage(from, `I still need both a grade and a subject — e.g. "Grade 8 Mathematics". What grade and subject is this for?`);
      return true;
    }

    state.grade = grade;
    state.subject = subject;
    state.step = state.mode === 'sba' ? 'ask_sba_context' : 'ask_focus_area';
    state.lastActivity = Date.now();
    interventionPlanState.set(phoneHash, state);

    if (state.mode === 'sba') {
      await safeSendMessage(from, `Got it — ${gradeLabel(grade)} ${subject}. What do you need help with — a specific task, the term's schedule, weighting, or record-keeping?`);
    } else {
      await safeSendMessage(from, `Got it — ${gradeLabel(grade)} ${subject}. What's the focus — a topic the class is struggling with, or specific learners falling behind?`);
    }
    return true;
  }

  if (state.step === 'ask_focus_area') {
    if (trimmed.length < 3) {
      await safeSendMessage(from, `Tell me a bit more about the focus — a topic, or the group of learners you're worried about:`);
      return true;
    }
    state.focusArea = trimmed;
    state.step = 'ask_context';
    state.lastActivity = Date.now();
    interventionPlanState.set(phoneHash, state);
    await safeSendMessage(from,
      `Anything else I should know? For example, what you've already tried, roughly how many learners are affected, or what's driving the gap (if you know). Reply *skip* if you'd rather I just work from what you've told me.`
    );
    return true;
  }

  if (state.step === 'ask_context') {
    state.context = trimmed.toLowerCase() === 'skip' ? 'No further context provided.' : trimmed;
    state.lastActivity = Date.now();
    interventionPlanState.set(phoneHash, state);
    await generateInterventionOutput(from, state, phoneHash);
    return true;
  }

  if (state.step === 'ask_sba_context') {
    if (trimmed.length < 3) {
      await safeSendMessage(from, `What do you need help with — a specific SBA task, the schedule, weighting, or record-keeping? Tell me a bit more:`);
      return true;
    }
    state.context = trimmed;
    state.lastActivity = Date.now();
    interventionPlanState.set(phoneHash, state);
    await generateInterventionOutput(from, state, phoneHash);
    return true;
  }

  return false;
}

/**
 * Generates and sends the final intervention plan or SBA support output,
 * then cleans up the session. Shared by both terminal steps of
 * handleInterventionPlanFlow.
 *
 * @param {string} from
 * @param {object} state
 * @param {string} phoneHash
 * @returns {Promise<void>}
 */
async function generateInterventionOutput(from, state, phoneHash) {
  const quota = checkAndIncrementUsage(from, 'interventionPlan');
  if (!quota.allowed) {
    await safeSendMessage(from,
      `You've hit your free limit (${FREE_LIMIT_DISPLAY()} generations/month). Reply *PRO* to keep going — R${process.env.PRO_PRICE_ZAR || 99}/month. 🚀`
    );
    interventionPlanState.delete(phoneHash);
    return;
  }

  await safeSendMessage(from, state.mode === 'sba' ? `⏳ Pulling together SBA guidance...` : `⏳ Building your intervention plan...`);
  try {
    const prompt = buildPrompt({
      type: 'interventionPlan',
      mode: state.mode,
      grade: state.grade,
      subject: state.subject,
      focusArea: state.focusArea || null,
      context: state.context,
      term: null,
      language: state.language,
    }, {});
    const content = await generateContent(prompt, 'interventionPlan');
    await safeSendMessage(from, content);

    const stillPro = isProActive(getTeacherByPhone(from));
    if (stillPro) {
      try {
        const { fileId, filename } = await generatePdf({
          content,
          type: 'interventionPlan',
          topic: state.focusArea || (state.mode === 'sba' ? 'SBA Support' : 'Intervention Plan'),
          grade: gradeLabel(state.grade),
          subject: state.subject,
          school: (getTeacherByPhone(from) || {}).school || '',
        });
        const pdfUrl = buildPdfUrl(fileId);
        await sendDocument(from, pdfUrl, filename, `📎 *PDF Download* (available for 2 hours)`);
      } catch (pdfErr) {
        console.error('[WEBHOOK] Intervention plan PDF generation failed:', pdfErr.message);
      }
    }
  } catch (err) {
    console.error('[WEBHOOK] Intervention plan generation failed:', err.message);
    rollbackUsage(quota, from);
    await safeSendMessage(from, `❌ Something went wrong generating that. Please try again.`);
  }
  interventionPlanState.delete(phoneHash);
}

// ── Observation flow handler ──────────────────────────────────────────────
/**
 * Handles the single-turn "record a Foundation Phase observation" conversation.
 * Collects one raw text block (header + per-learner domain/status/notes),
 * parses and persists it in one round-trip.
 * Returns true if handled (skip normal processing), false otherwise.
 *
 * @param {string} from
 * @param {string} text
 * @param {object|null} preClassifiedIntent
 * @returns {Promise<boolean>}
 */
async function handleObservationFlow(from, text, preClassifiedIntent = null) {
  const phoneHash = hashPhone(from);
  const state = observationState.get(phoneHash);

  if (state && Date.now() - state.lastActivity > 30 * 60 * 1000) {
    observationState.delete(phoneHash);
    return false;
  }

  if (!state) {
    const intent = preClassifiedIntent || parseIntent(text);
    if (intent.type !== 'observation') return false;

    observationState.set(phoneHash, {
      step: 'awaitingObservationText',
      lastActivity: Date.now(),
    });
    await safeSendMessage(from,
      `👀 *Record an Observation*\n\n` + getObservationFormatHelpText()
    );
    return true;
  }

  const trimmed = text.trim();
  if (trimmed.toUpperCase() === 'CANCEL') {
    observationState.delete(phoneHash);
    await safeSendMessage(from, `No problem — cancelled.`);
    return true;
  }

  if (state.step === 'awaitingObservationText') {
    const result = processObservationSubmission(text);

    if (!result.success) {
      // Stay in flow — let them fix and resend rather than losing the session
      observationState.set(phoneHash, { ...state, lastActivity: Date.now() });
      await safeSendMessage(from,
        `⚠️ *Couldn't read that observation:*\n\n` +
        result.errors.map(e => `• ${e}`).join('\n') +
        `\n\n${result.helpText}`
      );
      return true;
    }

    let saveError = null;
    try {
      saveObservationSubmission(phoneHash, result.header, result.records);
    } catch (err) {
      saveError = err;
      console.error('[WEBHOOK] saveObservationSubmission failed:', err.message);
    }

    observationState.delete(phoneHash);

    if (saveError) {
      await safeSendMessage(from,
        `⚠️ *Couldn't save that observation right now.* Please try sending it again in a moment.`
      );
      return true;
    }

    await safeSendMessage(from,
      `✅ *Observation saved successfully.*\n\n${result.summary}`
    );
    return true;
  }

  return false;
}

// ── Observation history flow handler ──────────────────────────────────────
/**
 * Handles MY OBSERVATIONS: shows the teacher's recent saved observation
 * assessments, then lets them reply with a number to view that
 * assessment's detail (learner/record counts, per-domain breakdown).
 *
 * Read-only view over data already written by handleObservationFlow's
 * saveObservationSubmission() call — same relationship teacherWorkspaceService's
 * getSavedResources() has to the SAVE command. No PDF/export option is
 * offered here since no observation-specific PDF generation exists yet
 * (that would need a real prompts/pdfService addition, not a promise).
 *
 * Returns true if handled (skip normal processing), false otherwise.
 *
 * @param {string} from
 * @param {string} text
 * @param {Object|null} preClassifiedIntent
 * @returns {Promise<boolean>}
 */
function formatObservationDate(createdAt) {
  if (!createdAt) return '';
  // SQLite datetime('now') format: 'YYYY-MM-DD HH:MM:SS'
  const datePart = createdAt.slice(0, 10);
  const d = new Date(`${datePart}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return datePart;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

async function handleObservationHistoryFlow(from, text, preClassifiedIntent = null) {
  const phoneHash = hashPhone(from);
  const state = observationHistoryState.get(phoneHash);

  if (state && Date.now() - state.lastActivity > 15 * 60 * 1000) {
    observationHistoryState.delete(phoneHash);
    return false;
  }

  const trimmed = text.trim();

  // Entry point: not currently in this flow — check if this message
  // triggers it (either a fresh intent classification, or "BACK" from
  // inside the detail view re-entering the list).
  if (!state) {
    const intent = preClassifiedIntent || parseIntent(text);
    if (intent.type !== 'observationHistory') return false;
    return sendObservationHistoryList(from, phoneHash);
  }

  if (trimmed.toUpperCase() === 'CANCEL') {
    observationHistoryState.delete(phoneHash);
    await safeSendMessage(from, `No problem — cancelled.`);
    return true;
  }

  if (state.step === 'listShown') {
    if (trimmed.toUpperCase() === 'BACK') {
      return sendObservationHistoryList(from, phoneHash);
    }

    const choice = parseInt(trimmed, 10);
    const ids = state.ids || [];
    if (!Number.isInteger(choice) || choice < 1 || choice > ids.length) {
      observationHistoryState.set(phoneHash, { ...state, lastActivity: Date.now() });
      await safeSendMessage(from,
        `Reply with a number from 1 to ${ids.length} to view that observation, or *BACK* to see the list again.`
      );
      return true;
    }

    const assessmentId = ids[choice - 1];
    let assessment;
    try {
      assessment = getObservationAssessment(assessmentId);
    } catch (err) {
      console.error('[Workspace] getObservationAssessment error:', err.message);
      await safeSendMessage(from, `⚠️ Couldn't load that observation right now. Please try again.`);
      return true;
    }

    if (!assessment) {
      await safeSendMessage(from, `That observation couldn't be found — it may have been removed. Reply *BACK* to see the list.`);
      return true;
    }

    // Group records by domain for a short breakdown (counts only —
    // no invented commentary beyond what's actually in the records).
    const byDomain = {};
    for (const r of assessment.records) {
      if (!byDomain[r.domain]) byDomain[r.domain] = [];
      byDomain[r.domain].push(r.developmentalStatus);
    }

    const gradeStr = assessment.grade != null ? gradeLabel(assessment.grade === '0' || assessment.grade === 0 ? 0 : assessment.grade) : '—';
    let msg = `📋 *Grade ${gradeStr} ${assessment.subject || ''}*\n`;
    if (assessment.assessmentName) msg += `Assessment: ${assessment.assessmentName}\n`;
    msg += `${formatObservationDate(assessment.createdAt)}\n\n`;
    msg += `Learners: ${new Set(assessment.records.map(r => r.learnerName)).size}\n`;
    msg += `Records: ${assessment.records.length}\n\n`;
    msg += `*By domain:*\n`;
    for (const [domain, statuses] of Object.entries(byDomain)) {
      const counts = {};
      for (const s of statuses) counts[s] = (counts[s] || 0) + 1;
      const breakdown = Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(', ');
      msg += `• ${domain}: ${breakdown}\n`;
    }
    msg += `\n_Reply *BACK* to see your other observations._`;

    observationHistoryState.set(phoneHash, { ...state, lastActivity: Date.now() });
    await safeSendMessage(from, msg);
    return true;
  }

  return false;
}

/**
 * Fetches and sends the observation history list, storing the
 * displayed number → assessmentId mapping so the next numeric reply
 * can be resolved back to a real assessment.
 */
async function sendObservationHistoryList(from, phoneHash) {
  let history;
  try {
    history = getObservationHistory(phoneHash, { limit: 8 });
  } catch (err) {
    console.error('[Workspace] getObservationHistory error:', err.message);
    await safeSendMessage(from, `⚠️ Couldn't load your observations right now. Please try again.`);
    return true;
  }

  if (history.length === 0) {
    observationHistoryState.delete(phoneHash);
    await safeSendMessage(from,
      `👀 *My Observations*\n\nYou haven't saved any observations yet.\n\nReply with an observation to record your first one.`
    );
    return true;
  }

  let msg = `👀 *My Observations*\n\nHere are your most recent observations:\n\n`;
  history.forEach((h, i) => {
    const gradeStr = h.grade != null ? gradeLabel(h.grade === '0' || h.grade === 0 ? 0 : h.grade) : '—';
    msg += `${i + 1}. Grade ${gradeStr} • ${h.subject || 'General'}\n`;
    if (h.assessmentName) msg += `   "${h.assessmentName}"\n`;
    msg += `   ${formatObservationDate(h.createdAt)}\n`;
    msg += `   ${h.learnerCount} learner${h.learnerCount === 1 ? '' : 's'}\n\n`;
  });
  msg += `Reply with the number to view details.`;

  observationHistoryState.set(phoneHash, {
    step: 'listShown',
    ids: history.map(h => h.id),
    lastActivity: Date.now(),
  });

  await safeSendMessage(from, msg);
  return true;
}

// ── Profile update flow handler ───────────────────────────────────────────
/**
 * Handles the multi-turn profile update conversation.
 * Returns true if handled (skip normal processing), false otherwise.
 *
 * @param {string} from
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function handleProfileUpdateFlow(from, text) {
  const phoneHash = hashPhone(from);
  const state = profileUpdateState.get(phoneHash);

  // Session TTL check (10 minutes)
  if (state && Date.now() - state.lastActivity > 10 * 60 * 1000) {
    profileUpdateState.delete(phoneHash);
    return false; // Treat as new session
  }

  // If not in profile update flow, return false
  if (!state) return false;

  const trimmed = text.trim();

  // Import parsing functions from onboardingService
  const { parseGradeInput, parseSubjectInput, parseSchoolInput, parseLanguageInput } = require('../services/onboardingService');

  // ask_field: parse 1-4, set step to the appropriate field name
  if (state.step === 'ask_field') {
    const choice = parseInt(trimmed, 10);
    if (choice < 1 || choice > 4) {
      await safeSendMessage(from, `Please reply with a number between 1 and 4:\n\n1. Grade\n2. Subject\n3. School\n4. Language`);
      return true;
    }

    const fieldMap = {
      1: 'ask_grade',
      2: 'ask_subject',
      3: 'ask_school',
      4: 'ask_language',
    };
    state.step = fieldMap[choice];
    state.lastActivity = Date.now();
    profileUpdateState.set(phoneHash, state);

    const prompts = {
      ask_grade: `Which grade do you mainly teach?\n\nReply with just the number, e.g.: *7* or *Grade 10*\n\n(You can always specify a different grade in any request)\n\nReply *CANCEL* to skip.`,
      ask_subject: `What subject do you mainly teach?\n\nExamples:\n• Mathematics\n• English\n• Life Sciences\n• Physical Sciences\n• History\n• Geography\n• Accounting\n• Business Studies\n\n(You can request any subject any time)\n\nReply *CANCEL* to skip.`,
      ask_school: `What school do you teach at?\n\nThis will appear on your PDF headers.\n\nReply with your school name, or type *cancel* to continue.`,
      ask_language: `Preferred language for generated content?\n\nReply with:\n• *1* for English\n• *2* for Afrikaans\n• *3* for isiZulu\n• *4* for isiXhosa\n• *5* for Sesotho\n• *6* for Setswana\n• *7* for Sepedi\n• *8* for Xitsonga\n• *9* for siSwati\n• *10* for Tshivenda\n• *11* for isiNdebele\n\nThis will apply to all worksheets, tests, lesson plans, and explanations you generate.\n\nReply *CANCEL* to skip.`,
    };
    await safeSendMessage(from, prompts[fieldMap[choice]]);
    return true;
  }

  // Handle each field update
  if (state.step === 'ask_grade') {
    if (trimmed.toUpperCase() === 'CANCEL') {
      profileUpdateState.delete(phoneHash);
      await safeSendMessage(from, `Profile update cancelled.`);
      return true;
    }
    const grade = parseGradeInput(trimmed);
    if (grade === null) {
      await safeSendMessage(from, `I didn't catch that. Let me have a grade number, e.g.:\n\n*7* or *Grade 10* or *Gr 4* or *Grade R*\n\nOr reply *CANCEL* to skip.`);
      return true;
    }
    updateTeacherProfile(from, { grade });
    profileUpdateState.delete(phoneHash);
    await safeSendMessage(from, `✅ Updated! Your grade is now set to ${gradeLabel(grade)}.`);
    return true;
  }

  if (state.step === 'ask_subject') {
    if (trimmed.toUpperCase() === 'CANCEL') {
      profileUpdateState.delete(phoneHash);
      await safeSendMessage(from, `Profile update cancelled.`);
      return true;
    }
    const subject = parseSubjectInput(trimmed);
    if (!subject) {
      await safeSendMessage(from, `I didn't recognise that subject. Let me try again with one of these:\n\n*Mathematics* | *English* | *Life Sciences* | *Physical Sciences* | *History* | *Geography* | *Accounting* | *Business Studies* | *Economics*\n\nOr reply *CANCEL* to skip.`);
      return true;
    }
    updateTeacherProfile(from, { subject });
    profileUpdateState.delete(phoneHash);
    await safeSendMessage(from, `✅ Updated! Your subject is now set to ${subject}.`);
    return true;
  }

  if (state.step === 'ask_school') {
    if (trimmed.toUpperCase() === 'CANCEL') {
      profileUpdateState.delete(phoneHash);
      await safeSendMessage(from, `Profile update cancelled.`);
      return true;
    }
    const school = parseSchoolInput(trimmed);
    if (!school) {
      await safeSendMessage(from, `I didn't catch that. Let me have your school name, or reply *cancel* to continue.`);
      return true;
    }
    updateTeacherProfile(from, { school });
    profileUpdateState.delete(phoneHash);
    await safeSendMessage(from, `✅ Updated! Your school is now set to ${school}.`);
    return true;
  }

  if (state.step === 'ask_language') {
    if (trimmed.toUpperCase() === 'CANCEL') {
      profileUpdateState.delete(phoneHash);
      await safeSendMessage(from, `Profile update cancelled.`);
      return true;
    }
    const language = parseLanguageInput(trimmed);
    if (!language) {
      await safeSendMessage(from, `Please reply with a number 1-11 for your preferred language:\n\n• 1 = English\n• 2 = Afrikaans\n• 3 = isiZulu\n• 4 = isiXhosa\n• 5 = Sesotho\n• 6 = Setswana\n• 7 = Sepedi\n• 8 = Xitsonga\n• 9 = siSwati\n• 10 = Tshivenda\n• 11 = isiNdebele\n\nOr reply *CANCEL* to skip.`);
      return true;
    }
    updateTeacherProfile(from, { language });
    profileUpdateState.delete(phoneHash);
    const languageDisplayNames = {
      english: 'English',
      afrikaans: 'Afrikaans',
      isizulu: 'isiZulu',
      isixhosa: 'isiXhosa',
      sesotho: 'Sesotho',
      setswana: 'Setswana',
      sepedi: 'Sepedi',
      xitsonga: 'Xitsonga',
      siswati: 'siSwati',
      tshivenda: 'Tshivenda',
      isindebele: 'isiNdebele',
    };
    await safeSendMessage(from, `✅ Updated! Your language is now set to ${languageDisplayNames[language] || language}.`);
    return true;
  }

  return false;
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
    const teacher = getTeacherByPhone(from);
    const name    = teacher?.name || 'there';
    await safeSendMessage(from,
      `👋 Hey ${name}! Here's what I can do:\n\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `📝 *GENERATE RESOURCES*\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `Just describe what you need, e.g.:\n` +
      `_"Grade 7 Maths worksheet on fractions"_\n` +
      `_"30-mark test on photosynthesis, Grade 9"_\n` +
      `_"Lesson plan, Grade 10 Accounting"_\n` +
      `_"Parent message: Thabo absent 3 days"_\n\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `⭐ *PRO FEATURES*\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `• Annual Teaching Plans (CAPS ATP)\n` +
      `• Assessment analysis & gap reports\n` +
      `• Intervention plans & SBA support\n` +
      `• Moderation packs & sign-off sheets\n\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `📊 *AFTER UPLOADING MARKS*\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `*REPORT* — full diagnostic PDF\n` +
      `*HOD REPORT* — for department submission\n` +
      `*PARENT REPORT* — for one learner or class\n\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `🏫 *YOUR WORKSPACE*\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `*WORKSPACE* — classes, assessments & progress\n` +
      `*MY CLASSES* — list classes (NEW CLASS to add)\n` +
      `*MY ASSESSMENTS* — history with averages\n` +
      `*MY PROGRESS* — CAPS curriculum coverage\n\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `👤 *YOUR ACCOUNT*\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `*STATUS* — usage & plan\n` +
      `*PRO* — upgrade to Pro\n` +
      `*PROFILE* — view your defaults\n` +
      `*UPDATE* — change your defaults\n\n` +
      `💡 _After a worksheet, reply_ *EASIER · HARDER · VISUAL · ORAL* _to adapt it._\n\n` +
      `Type anything to get started. 😊`
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
      await processGeneration(from, lastIntent);
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
  const isWorkspaceCmd =
    upper === 'MY CLASSES' || upper.startsWith('NEW CLASS') ||
    upper === 'MY ASSESSMENTS' || upper === 'MY ASSESSMENT HISTORY' ||
    upper === 'MY PROGRESS' || upper === 'MY CURRICULUM PROGRESS' ||
    upper === 'WORKSPACE' ||
    upper === 'MY RESOURCES' ||
    upper === 'SAVE';

  if (isWorkspaceCmd) {
    const {
      getTeacherClasses,
      createClass,
      getAssessmentHistory,
      validateNewClassInput,
      saveResource,
      getSavedResources,
      getSavedResourceByGenerationId,
    } = require('../services/teacherWorkspaceService');
    const { getTeacherProgressReport } = require('../services/curriculumCoverageService');
    const { handleCurriculumQuery: calendarQuery } = require('../services/curriculumIntelligenceService');

    const hash = hashPhone(from);
    const teacher = getTeacherByPhone(from);

    if (!teacher) {
      await safeSendMessage(from, `⚠️ You need to complete setup first. Reply *HELLO* to get started.`);
      return true;
    }

    // ── NEW CLASS ──
    if (upper.startsWith('NEW CLASS')) {
      // Format: NEW CLASS Grade 7A Mathematics | 32
      // Parse: everything after "NEW CLASS " is "name | learner_count"
      const rest = text.slice('NEW CLASS'.length).trim();

      // No arguments at all → show usage prompt
      if (!rest) {
        await safeSendMessage(from,
          `📚 *Create a new class*\n\nFormat:\n*NEW CLASS [name] | [learner count]*\n\nExample:\n_NEW CLASS Grade 7A Mathematics | 32_\n\nThe class name should include the grade and subject.`
        );
        return true;
      }

      // No pipe → missing learner count
      if (!rest.includes('|')) {
        await safeSendMessage(from,
          `📚 *Missing learner count*\n\nPlease include the number of learners after a "|":\n\n*NEW CLASS [name] | [count]*\n\nExample:\n_NEW CLASS Grade 7A Mathematics | 32_`
        );
        return true;
      }

      const pipeIdx = rest.indexOf('|');
      const rawName  = rest.slice(0, pipeIdx).trim();
      const rawCount = rest.slice(pipeIdx + 1).trim();

      // Load existing classes for duplicate check
      let existingClasses = [];
      try { existingClasses = getTeacherClasses(hash); } catch (_) {}

      const validation = validateNewClassInput(rawName, rawCount, existingClasses);

      if (!validation.valid) {
        const errorMessages = {
          missing_name:       `📚 *Class name required*\n\nPlease provide a name before the "|":\n\n_NEW CLASS Grade 7A Mathematics | 32_`,
          name_too_long:      `📚 *Class name too long*\n\nPlease keep the name under 80 characters.\n\nExample:\n_NEW CLASS Grade 7A Mathematics | 32_`,
          name_invalid_chars: `📚 *Invalid class name*\n\nThe name must contain at least one letter or number.\n\nExample:\n_NEW CLASS Grade 7A Mathematics | 32_`,
          missing_count:      `📚 *Learner count required*\n\nPlease add the number of learners after the "|":\n\n_NEW CLASS Grade 7A Mathematics | 32_`,
          count_not_a_number: `📚 *Invalid learner count*\n\nThe learner count must be a number.\n\nExample:\n_NEW CLASS Grade 7A Mathematics | 32_`,
          count_too_low:      `📚 *Learner count must be at least 1*\n\nA class needs at least one learner.\n\nExample:\n_NEW CLASS Grade 7A Mathematics | 32_`,
          count_too_high:     `📚 *Learner count seems too high*\n\nThe maximum supported class size is 200. If your class is larger, please contact support.`,
          duplicate_name:     `📚 *You already have a class called "${rawName}"*\n\nUse a different name, or reply *MY CLASSES* to see your existing classes.`,
        };
        const msg = errorMessages[validation.error] ||
          `⚠️ Invalid input. Please use the format:\n_NEW CLASS Grade 7A Mathematics | 32_`;
        await safeSendMessage(from, msg);
        return true;
      }

      // Validation passed — extract grade from name (or fall back to teacher profile)
      const gradeMatch = validation.name.match(/\bgrade\s*(\d+)/i);
      const grade = gradeMatch ? parseInt(gradeMatch[1], 10) : (teacher.grade ?? null);
      const subject = teacher.subject || 'General';

      try {
        const newClass = createClass(hash, validation.name, grade, subject, validation.count);
        await safeSendMessage(from,
          `✅ *Class created!*\n\n📚 *${newClass.name}*\nGrade: ${newClass.grade != null ? gradeLabel(newClass.grade) : 'Not set'} | Subject: ${newClass.subject}\nLearners: ${newClass.learner_count}\n\n_Reply *MY CLASSES* to see all your classes._`
        );
      } catch (err) {
        console.error('[Workspace] createClass error:', err.message);
        await safeSendMessage(from, `⚠️ Couldn't create the class. Please try again.`);
      }
      return true;
    }

    // ── MY CLASSES ──
    if (upper === 'MY CLASSES') {
      try {
        const classes = getTeacherClasses(hash);
        if (classes.length === 0) {
          await safeSendMessage(from,
            `📚 *Your Classes*\n\nYou haven't added any classes yet.\n\nTo create one, reply:\n*NEW CLASS [name] | [learner count]*\n\nExample:\n_NEW CLASS Grade 8B Mathematics | 28_`
          );
        } else {
          let msg = `📚 *Your Classes* (${classes.length})\n\n`;
          for (const cls of classes) {
            msg += `*${cls.name}*\n`;
            msg += `${cls.grade != null ? gradeLabel(cls.grade) : 'Grade ?'} | ${cls.subject || '?'} | ${cls.learner_count || 0} learners\n\n`;
          }
          msg += `_Reply *NEW CLASS [name] | [count]* to add another class._`;
          await safeSendMessage(from, msg);
        }
      } catch (err) {
        console.error('[Workspace] getTeacherClasses error:', err.message);
        await safeSendMessage(from, `⚠️ Couldn't load your classes. Please try again.`);
      }
      return true;
    }

    // ── MY ASSESSMENTS ──
    if (upper === 'MY ASSESSMENTS' || upper === 'MY ASSESSMENT HISTORY') {
      try {
        const assessments = getAssessmentHistory(hash);
        if (assessments.length === 0) {
          await safeSendMessage(from,
            `📊 *Assessment History*\n\nNo data-driven assessments on record yet.\n\nTo analyse a class assessment, send your mark sheet and I'll run a full diagnostic.\n\n_Tip: Upload a CSV, Excel file, or photo of your mark sheet._`
          );
        } else {
          const recent = assessments.slice(0, 8);
          let msg = `📊 *Assessment History* (${assessments.length} total)\n\n`;
          for (const a of recent) {
            const avg = a.class_average != null ? `${Math.round(a.class_average)}%` : 'N/A';
            const date = a.created_at ? a.created_at.split(' ')[0] : '';
            msg += `*${a.title || 'Untitled'}*\n`;
            msg += `${a.grade != null ? gradeLabel(a.grade) : 'Grade ?'} | ${a.subject || '?'} | Term ${a.term || '?'}\n`;
            msg += `Class avg: ${avg} | Learners: ${a.learner_count || 0} | ${date}\n\n`;
          }
          if (assessments.length > 8) {
            msg += `_... and ${assessments.length - 8} more older assessments._\n\n`;
          }
          msg += `_Reply *MY PROGRESS* to see curriculum coverage tracked from these assessments._`;
          await safeSendMessage(from, msg);
        }
      } catch (err) {
        console.error('[Workspace] getAssessmentHistory error:', err.message);
        await safeSendMessage(from, `⚠️ Couldn't load assessment history. Please try again.`);
      }
      return true;
    }

    // ── MY PROGRESS / MY CURRICULUM PROGRESS ──
    if (upper === 'MY PROGRESS' || upper === 'MY CURRICULUM PROGRESS') {
      try {
        const progress = getTeacherProgressReport(hash);

        if (progress && progress.error) {
          // Profile incomplete — fall back to calendar estimate if possible
          if (teacher.grade != null && teacher.subject) {
            const calResult = await calendarQuery(`${teacher.subject} ${gradeLabel(teacher.grade)} coverage`, teacher);
            await safeSendMessage(from, calResult || `⚠️ Complete your profile with grade and subject to see curriculum progress.\n\nReply *PROFILE* to update.`);
          } else {
            await safeSendMessage(from,
              `⚠️ *Profile incomplete*\n\nI need your grade and subject to show curriculum progress.\n\nReply *PROFILE* to update your details.`
            );
          }
          return true;
        }

        if (!progress || !progress.dataAvailable) {
          // Real data exists but subject not in CAPS reference table — use calendar estimate
          const grade = teacher.grade ?? progress?.grade;
          const subject = teacher.subject || progress?.subject;
          if (grade != null && subject) {
            const calResult = await calendarQuery(`${subject} ${gradeLabel(grade)} coverage`, teacher);
            await safeSendMessage(from,
              `📈 *Curriculum Progress — ${subject} ${gradeLabel(grade)}*\n\n` +
              `_Note: Detailed per-topic tracking isn't available for this subject yet. Showing calendar-based estimate:_\n\n` +
              (calResult || `No calendar data available either.`)
            );
          } else {
            await safeSendMessage(from, `⚠️ Set your grade and subject in *PROFILE* to view curriculum progress.`);
          }
          return true;
        }

        // Real persisted data available — use it
        let msg = `📈 *Curriculum Progress — ${progress.subject} ${gradeLabel(progress.grade)}*\n`;
        msg += `_Based on ${progress.totalCovered} topic(s) recorded from your assessments_\n\n`;
        msg += progress.summary;
        if (progress.catchUpPlan && !progress.catchUpPlan.startsWith('✅')) {
          msg += `\n${progress.catchUpPlan}`;
        }
        await safeSendMessage(from, msg);
      } catch (err) {
        console.error('[Workspace] getTeacherProgressReport error:', err.message);
        await safeSendMessage(from, `⚠️ Couldn't load curriculum progress. Please try again.`);
      }
      return true;
    }

    // ── WORKSPACE summary ──
    if (upper === 'WORKSPACE') {
      try {
        const classes = getTeacherClasses(hash);
        const assessments = getAssessmentHistory(hash);
        const progress = getTeacherProgressReport(hash);

        let msg = `🏫 *Your Workspace*\n\n`;

        // Classes
        msg += `📚 *Classes:* ${classes.length}\n`;
        if (classes.length > 0) {
          msg += classes.slice(0, 3).map(c => `  • ${c.name}`).join('\n') + '\n';
          if (classes.length > 3) msg += `  _...and ${classes.length - 3} more_\n`;
        } else {
          msg += `  _None yet — reply *NEW CLASS* to add one_\n`;
        }

        // Assessments
        msg += `\n📊 *Assessments analysed:* ${assessments.length}\n`;
        if (assessments.length > 0) {
          const last = assessments[0];
          const avg = last.class_average != null ? `${Math.round(last.class_average)}%` : 'N/A';
          msg += `  Last: ${last.title || 'Untitled'} — class avg ${avg}\n`;
        }

        // Curriculum progress
        if (progress && !progress.error && progress.dataAvailable) {
          msg += `\n📈 *Curriculum coverage:* ${progress.overallCoverage}% (${progress.totalCovered}/${progress.totalExpected} topics)\n`;
        } else if (teacher.grade != null && teacher.subject) {
          msg += `\n📈 *Curriculum coverage:* _Use data-driven assessments to build your progress record_\n`;
        }

        msg += `\n*Quick commands:*\n`;
        msg += `MY CLASSES | MY ASSESSMENTS | MY PROGRESS`;

        await safeSendMessage(from, msg);
      } catch (err) {
        console.error('[Workspace] summary error:', err.message);
        await safeSendMessage(from, `⚠️ Couldn't load workspace summary. Please try again.`);
      }
      return true;
    }

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
      await processGeneration(from, intent);
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
      await processGeneration(from, intent);
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
      await processGeneration(from, intent);
    } else {
      await safeSendMessage(from, `What topic should the lesson plan cover? Just send me a request like: "Grade 7 fractions lesson plan"`);
    }
    return true;
  }

  // ── EASIER command (differentiation) ─────────────────────────────────
  if (upper === 'EASIER') {
    const phoneHash = hashPhone(from);
    const lastWorksheet = lastWorksheetState.get(phoneHash);
    if (!lastWorksheet) {
      await safeSendMessage(from, `Send me a worksheet request first, then reply EASIER/HARDER/VISUAL/ORAL.`);
      return true;
    }
    const intent = { ...lastWorksheet.intent, type: 'worksheet', differentiation: 'easier' };
    await processGeneration(from, intent);
    return true;
  }

  // ── HARDER command (differentiation) ─────────────────────────────────
  if (upper === 'HARDER') {
    const phoneHash = hashPhone(from);
    const lastWorksheet = lastWorksheetState.get(phoneHash);
    if (!lastWorksheet) {
      await safeSendMessage(from, `Send me a worksheet request first, then reply EASIER/HARDER/VISUAL/ORAL.`);
      return true;
    }
    const intent = { ...lastWorksheet.intent, type: 'worksheet', differentiation: 'harder' };
    await processGeneration(from, intent);
    return true;
  }

  // ── VISUAL command (differentiation) ────────────────────────────────
  if (upper === 'VISUAL') {
    const phoneHash = hashPhone(from);
    const lastWorksheet = lastWorksheetState.get(phoneHash);
    if (!lastWorksheet) {
      await safeSendMessage(from, `Send me a worksheet request first, then reply EASIER/HARDER/VISUAL/ORAL.`);
      return true;
    }
    const intent = { ...lastWorksheet.intent, type: 'worksheet', differentiation: 'visual' };
    await processGeneration(from, intent);
    return true;
  }

  // ── ORAL command (differentiation) ──────────────────────────────────
  if (upper === 'ORAL') {
    const phoneHash = hashPhone(from);
    const lastWorksheet = lastWorksheetState.get(phoneHash);
    if (!lastWorksheet) {
      await safeSendMessage(from, `Send me a worksheet request first, then reply EASIER/HARDER/VISUAL/ORAL.`);
      return true;
    }
    const intent = { ...lastWorksheet.intent, type: 'worksheet', differentiation: 'oral' };
    await processGeneration(from, intent);
    return true;
  }

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
        if (await handleDataAssessmentFlow(from, '', message)) return;
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
      await processGeneration(from, clarifiedIntent);
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
    observationHistoryState.get(phoneHash)
  );

  if (alreadyMidFlow) {
    // Route straight through without classifying — each handler will
    // recognize its own state and continue. Order matches the dispatch
    // order below so behavior is identical to the classified path.
    if (await handleReportCommentFlow(from, text)) return;
    if (await handleProfileUpdateFlow(from, text)) return;
    if (await handleParentMessageFlow(from, text)) return;
    if (await handleDataAssessmentFlow(from, text, message)) return;
    if (await handleAssessmentAnalysisFlow(from, text)) return;
    if (await handleInterventionPlanFlow(from, text)) return;
    if (await handleObservationFlow(from, text)) return;
    if (await handleObservationHistoryFlow(from, text)) return;
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

  // ── Report comment multi-turn flow ─────────────────────────────
  const reportCommentHandled = await handleReportCommentFlow(from, text, intent);
  if (reportCommentHandled) return;

  // ── Profile update multi-turn flow ─────────────────────────────
  const profileUpdateHandled = await handleProfileUpdateFlow(from, text);
  if (profileUpdateHandled) return;

  // ── Parent message multi-turn flow ───────────────────────────────
  const parentMessageHandled = await handleParentMessageFlow(from, text, intent);
  if (parentMessageHandled) return;

  // ── Data-driven assessment multi-turn flow (Pro) ───────────────────────
  const dataAssessmentHandled = await handleDataAssessmentFlow(from, text, message, intent);
  if (dataAssessmentHandled) return;

  // ── Assessment analysis multi-turn flow (Pro) ───────────────────────
  const assessmentAnalysisHandled = await handleAssessmentAnalysisFlow(from, text, intent);
  if (assessmentAnalysisHandled) return;

  // ── Curriculum intelligence query (instant, no quota) ────────────────
  const curriculumHandled = await handleCurriculumQueryFlow(from, text, intent);
  if (curriculumHandled) return;

  // ── Intervention plan / SBA support multi-turn flow (Pro) ───────────
  const interventionPlanHandled = await handleInterventionPlanFlow(from, text, intent);
  if (interventionPlanHandled) return;

  // ── Observation multi-turn flow ─────────────────────────────────────
  const observationHandled = await handleObservationFlow(from, text, intent);
  if (observationHandled) return;

  // ── Observation history multi-turn flow (list + numbered selection) ────
  const observationHistoryHandled = await handleObservationHistoryFlow(from, text, intent);
  if (observationHistoryHandled) return;

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
  await processGeneration(from, intent, text);
  return;
}

// ── Process content generation ────────────────────────────────────────
/**
 * Processes content generation for a given intent.
 * Handles quota check, AI generation, and PDF delivery.
 *
 * @param {string} from
 * @param {object} intent
 * @param {string} [originalText] - Original message text for disambiguation
 * @returns {Promise<void>}
 */
async function processGeneration(from, intent, originalText = null) {
  // Per-phone burst rate limit — prevents rapid-fire AI calls
  if (isAiRateLimited(from)) {
    await safeSendMessage(from,
      `⏱️ You're sending requests too quickly. Please wait a moment before trying again.`
    );
    return;
  }

  // ATP is a Pro-only feature — gate before quota deduction
  if (intent.type === 'atp') {
    const teacher = getTeacherByPhone(from);
    if (!isProActive(teacher)) {
      await safeSendMessage(from,
        `⭐ *Annual Teaching Plans are a Pro feature*\n\n` +
        `Upgrade to Pro for R${process.env.PRO_PRICE_ZAR || 99}/month to generate full CAPS-aligned ATPs for any subject and grade, plus unlimited generations and PDF downloads.\n\n` +
        `Reply *PRO* to upgrade. 🎓`
      );
      return;
    }
  }

  // Moderation packs are a Pro-only feature — gate before quota deduction.
  // If the teacher has a recently analysed assessment (last_assessment_id),
  // wrap that existing assessment instead of generating a new paper from
  // scratch — pulls in its title/marks/type so the prompt can skip straight
  // to the moderation paperwork.
  if (intent.type === 'moderationPack') {
    const teacher = getTeacherByPhone(from);
    if (!isProActive(teacher)) {
      await safeSendMessage(from,
        `⭐ *Moderation packs are a Pro feature*\n\n` +
        `Upgrade to Pro for R${process.env.PRO_PRICE_ZAR || 99}/month to generate full moderation packs — cover sheet, Bloom's review, checklist, and sign-off — plus unlimited generations and PDF downloads.\n\n` +
        `Reply *PRO* to upgrade. 🎓`
      );
      return;
    }
    if (teacher?.last_assessment_id) {
      try {
        const row = require('../utils/database').getDb()
          .prepare(`SELECT title, total_marks, assessment_type FROM assessments WHERE id = ?`)
          .get(teacher.last_assessment_id);
        if (row) {
          intent.existingAssessment = {
            title: row.title,
            totalMarks: row.total_marks,
            assessmentType: row.assessment_type,
          };
          // Wrap mode doesn't need a topic — the assessment already has one.
          if (!intent.topic) intent.topic = row.title;
        }
      } catch (err) {
        console.error('[WEBHOOK] Failed to load existing assessment for moderation pack:', err.message);
        // Non-fatal — falls through to full-build mode if lookup fails.
      }
    }
  }

  const quota = checkAndIncrementUsage(from, intent.type);

  if (!quota.allowed) {
    await safeSendMessage(from,
      `You've hit your free limit (${FREE_LIMIT_DISPLAY()} generations/month). Reply *PRO* to keep going — R${process.env.PRO_PRICE_ZAR || 99}/month. 🚀`
    );
    return;
  }

  // ── Acknowledgment ────────────────────────────────────────────
  const teacher = getTeacherByPhone(from);
  const gradeDisplay = intent.grade != null ? ` for ${gradeLabel(intent.grade)}` : (teacher?.grade != null ? ` for your grade (${gradeLabel(teacher.grade)})` : '');
  const subjectDisplay = intent.subject !== 'general' ? ` in ${intent.subject.charAt(0).toUpperCase() + intent.subject.slice(1)}` : '';
  await safeSendMessage(from, `⏳ Generating your CAPS-aligned ${intentLabel(intent.type)}${gradeDisplay}${subjectDisplay}... Please wait.`);

  // ── Log enriched intent ───────────────────────────────────────
  console.log(`[WEBHOOK] Intent:`, {
    type:    intent.type,
    grade:   intent.grade,
    subject: intent.subject,
    topic:   intent.topic,
    marks: intent.type === 'worksheet'
          ? getWorksheetTotalMarks(intent.grade != null ? intent.grade : (teacher?.grade ?? null))
          : intent.marks,
  });

  // ── Generate content ──────────────────────────────────────────
  const profile = {
    grade:   teacher?.grade   ?? null,
    subject: teacher?.subject || null,
    name:    teacher?.name    || null,
  };
  const prompt  = buildPrompt(intent, profile);
  const content = await generateContent(prompt, intent.type).catch(async (err) => {
    console.error('[WEBHOOK] AI generation failed:', err.message);
    // Roll back usage increment for free-tier teachers
    rollbackUsage(quota, from);
    await safeSendMessage(from,
      `Something went wrong on my end — please try again in a moment. If it keeps happening, reply *HELP*.`
    ).catch(() => {}); // best-effort — don't double-throw
    return null;
  });

  if (!content) return; // Error already sent to teacher

  // ── ATP-only safety net: verify week ranges are sequential and
  // non-overlapping. The prompt (prompts/atp.js) instructs the AI not to
  // repeat week numbers across rows, but that's a probabilistic
  // instruction, not a guarantee — this is the deterministic backstop.
  // On failure we retry generation ONCE with an explicit correction
  // appended; if the retry also fails validation, we ship the content
  // anyway (better than blocking the teacher entirely) but prepend a
  // visible warning so it's never silently wrong.
  let finalContent = content;
  if (intent.type === 'atp') {
    let check = validateAtpWeeks(finalContent);
    if (!check.valid) {
      console.warn(`[WEBHOOK] ATP week-range validation failed on first attempt for ...${String(from).slice(-4)}:`, check.issues);

      const correctionPrompt = prompt +
        `\n\nIMPORTANT CORRECTION: Your previous attempt at this ATP had overlapping/repeated week numbers across rows within a term (e.g. one row ending "4-5" followed by another starting "5-6", which illegally repeats week 5). ` +
        `Regenerate the FULL Annual Teaching Plan from scratch, making absolutely sure that within each term, week numbers are strictly sequential and each week number appears in exactly one row — no row's start week may be less than or equal to the previous row's end week.`;

      const retryContent = await generateContent(correctionPrompt, intent.type).catch((err) => {
        console.error('[WEBHOOK] ATP correction retry failed:', err.message);
        return null;
      });

      if (retryContent) {
        const retryCheck = validateAtpWeeks(retryContent);
        if (retryCheck.valid) {
          console.log(`[WEBHOOK] ATP week-range corrected successfully on retry for ...${String(from).slice(-4)}`);
          finalContent = retryContent;
        } else {
          console.warn(`[WEBHOOK] ATP week-range validation still failing after retry for ...${String(from).slice(-4)}:`, retryCheck.issues);
          finalContent = `⚠️ *Note: please double-check the week numbers in this ATP* — our automatic check found possible overlapping weeks between topics. Everything else should be accurate, but review the week ranges before submitting this as your official plan.\n\n${retryContent}`;
        }
      } else {
        finalContent = `⚠️ *Note: please double-check the week numbers in this ATP* — our automatic check found possible overlapping weeks between topics. Everything else should be accurate, but review the week ranges before submitting this as your official plan.\n\n${finalContent}`;
      }
    }
  }

  // ── Send text response ────────────────────────────────────────
  await safeSendMessage(from, finalContent);

  // ── Offer PDF for worksheets, tests, lesson plans, and other printable documents ─
  // (sbaTask, examPaper, rubric, moderationPack added — these are physical/printable
  // documents teachers need to print, sign, or file, same as worksheet/test/atp, but
  // were previously missing from this list and so never got a PDF in this generic
  // generation path even when the teacher was Pro.)
  const pdfEligible = ['worksheet', 'test', 'lessonPlan', 'atp', 'sbaTask', 'examPaper', 'rubric', 'moderationPack'].includes(intent.type);
  // Re-check Pro status right before PDF generation (edge case: status may
  // have changed during the AI call, e.g. concurrent expiry/downgrade).
  const stillPro = quota.isPro && isProActive(getTeacherByPhone(from));
  if (pdfEligible && stillPro) {
    try {
      const { fileId, filename } = await generatePdf({
        content: finalContent,
        type:    intent.type,
        topic:   intent.topic,
        grade:   intent.grade != null ? gradeLabel(intent.grade) : (teacher?.grade != null ? gradeLabel(teacher.grade) : 'Grade 7'),
        subject: intent.subject !== 'general' ? intent.subject : (teacher?.subject || 'General'),
        school:  teacher?.school || '',
        marks: intent.type === 'worksheet'
          ? getWorksheetTotalMarks(intent.grade != null ? intent.grade : (teacher?.grade ?? null))
          : intent.marks,
      });
      const pdfUrl = buildPdfUrl(fileId);
      await sendDocument(from, pdfUrl, filename, `📎 *PDF Download* (available for 2 hours)\n\n_Open in your browser to download and print._`);
    } catch (pdfErr) {
      console.error('[WEBHOOK] PDF generation failed:', pdfErr.message);
      // PDF is a bonus — don't block the teacher if it fails
    }
  } else if (pdfEligible && !stillPro) {
    await safeSendMessage(from,
      `💡 _Get a print-ready PDF of this ${intentLabel(intent.type)} by upgrading to Pro (R${process.env.PRO_PRICE_ZAR || 99}/month). Reply *PRO*._`
    );
  }

  // ── Usage reminder for free teachers approaching limit ─────────
  if (!quota.isPro && quota.usedCount !== null) {
    const remaining = (parseInt(process.env.FREE_LIMIT || '10') - quota.usedCount);
    if (remaining === 2 || remaining === 1) {
      await safeSendMessage(from,
        `ℹ️ _${remaining} free generation${remaining === 1 ? '' : 's'} left this month. Reply *PRO* to upgrade._`
      );
    }
  }

  // ── Disambiguation follow-up after explanation (Feature 1) ───────
  if (intent.type === 'explanation' && originalText && !hasExplicitExplanationKeyword(originalText)) {
    const phoneHash = hashPhone(from);
    pendingIntentState.set(phoneHash, {
      intent: { topic: intent.topic, grade: intent.grade, subject: intent.subject },
      lastActivity: Date.now(),
    });
    setTimeout(async () => {
      const topicPart = intent.topic ? ` on ${intent.topic}` : '';
      await safeSendMessage(from,
        `💡 Would you also like:\n\n📄 Reply WORKSHEET for a worksheet${topicPart}\n\n📝 Reply TEST for a test${topicPart}\n\n📋 Reply LESSONPLAN for a lesson plan${topicPart}\n\nOr just send a new request.`
      );
    }, 1000);
  }

  // ── Worksheet state storage and differentiation follow-up (Feature 2) ───────
  if (intent.type === 'worksheet' && !intent.differentiation) {
    const phoneHash = hashPhone(from);
    lastWorksheetState.set(phoneHash, {
      intent: { topic: intent.topic, grade: intent.grade, subject: intent.subject },
      content: content,
      lastActivity: Date.now(),
    });
    setTimeout(async () => {
      await safeSendMessage(from,
        `🎯 Need different versions?\n\nReply EASIER — support version (more scaffolding)\n\nReply HARDER — extension version (higher challenge)\n\nReply VISUAL — diagram/image-based version\n\nReply ORAL — oral assessment questions`
      );
    }, 1000);
  }

  // ── Quick quiz follow-up (Feature 4) ────────────────────────────────────────
  if (intent.type === 'quickQuiz') {
    setTimeout(async () => {
      await safeSendMessage(from,
        `🔄 Reply RETRY for different questions on the same topic\n\n📄 Reply WORKSHEET to get a full worksheet on this topic`
      );
    }, 1000);
  }

  // ── Resource persistence: store for SAVE command (Feature: Phase B) ─────────
  // Saveable types: all generation intents that produce a reusable document.
  // quickQuiz, explanation, and assessmentAnalysis are excluded — they are
  // ephemeral or part of a larger workflow that auto-saves via saveReport().
  const saveableTypes = ['worksheet', 'test', 'lessonPlan', 'atp', 'sbaTask', 'examPaper', 'rubric', 'moderationPack'];
  if (saveableTypes.includes(intent.type)) {
    const phoneHash = hashPhone(from);
    // generationId: unique token minted at storage time.
    // Purpose: lets the SAVE handler log which exact generation was saved,
    // and lets tests assert that rapid successive generations store
    // distinct IDs (the latest one wins, old one is unreachable).
    // saveState: explicit lifecycle tag so SAVE handler uses tag-based
    // branching rather than property-presence inference (B4-R1).
    const { randomUUID } = require('crypto');
    const phoneHashGen = hashPhone(from);

    // B4-R2: if current state is RECOVERABLE (DB committed, WA failed),
    // the teacher is explicitly generating new content — log the overwrite
    // so ops can audit committed-but-unconfirmed rows if needed.
    const existingState = lastGeneratedState.get(phoneHashGen);
    if (existingState && existingState.saveState === 'RECOVERABLE') {
      console.warn(
        `[Workspace] RECOVERABLE state overwritten by new generation. ` +
        `Orphaned resourceId: ${existingState.lastSavedId}, ` +
        `generationId: ${existingState.generationId}. ` +
        `Teacher chose to generate new content — prior DB row retained.`
      );
    }

    lastGeneratedState.set(phoneHashGen, {
      generationId: randomUUID(),
      saveState: 'GENERATED',
      intent: {
        type:           intent.type,
        topic:          intent.topic          || null,
        grade:          intent.grade          ?? null,
        subject:        intent.subject        || null,
        term:           intent.term           || null,
        atpTopic:       intent.atpTopic       || null,
        differentiation: intent.differentiation || null,
      },
      content,
      lastActivity: Date.now(),
    });
    // Append SAVE nudge as a follow-up (1.5 s delay — after any differentiation prompt)
    setTimeout(async () => {
      await safeSendMessage(from, `_Reply *SAVE* to keep this in My Resources._`);
    }, 1500);
  }

  console.log(`[WEBHOOK] Response delivered to ...${String(from || '').slice(-4)}`);
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Checks if the original message contained explicit explanation keywords.
 * @param {string} text - Original message text
 * @returns {boolean}
 */
function hasExplicitExplanationKeyword(text) {
  const lower = text.toLowerCase();
  const explicitKeywords = [
    'explain', 'verduidelik', 'describe', 'what is', 'how does', 'tell me',
    'what are', 'how do', 'tell me about', 'simple explanation', 'definition'
  ];
  return explicitKeywords.some(keyword => lower.includes(keyword));
}

/**
 * Generates and sends the compiled PDF for batch report comments.
 *
 * @param {string} from
 * @param {object} state - Report comment state with batch comments
 * @returns {Promise<void>}
 */
async function generateAndSendBatchPdf(from, state) {
  try {
    const teacher = getTeacherByPhone(from);
    const { fileId, filename } = await generateReportSummaryPdf(state.comments, {
      grade: state.grade,
      subject: state.subject,
      school: teacher?.school || '',
    });
    const pdfUrl = buildPdfUrl(fileId);
    await sendDocument(from, pdfUrl, filename, `📄 *Your report comments are ready!*\n\nAll ${state.batch.length} comments have been compiled into the PDF above.`);
  } catch (pdfErr) {
    console.error('[WEBHOOK] Batch PDF generation failed:', pdfErr.message);
    await safeSendMessage(from, `❌ *PDF generation failed*\n\nYour comments were generated but we couldn't create the PDF. Please try again.`);
  }
}

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
