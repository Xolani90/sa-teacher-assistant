'use strict';

/**
 * Intervention plan / SBA support conversation flow — extracted from
 * routes/webhook.js.
 *
 * Scope: the multi-turn "Intervention Plan / SBA Support" conversation
 * (Pro feature).
 *   - session entry via classified 'interventionPlan' intent, gated on
 *     Pro status before any state is created
 *   - mode detection (sba vs intervention) from the triggering message
 *   - ask_grade_subject step (skipped when both are already known from
 *     the teacher's profile)
 *   - ask_focus_area / ask_context steps for the intervention path
 *   - ask_sba_context step for the SBA path
 *   - generateInterventionOutput(): shared terminal step (quota check,
 *     AI generation, optional PDF for Pro, rollback on failure)
 *
 * Dependencies are injected via the `deps` object rather than required
 * directly, so this module has no reverse dependency on webhook.js and
 * no dependency on services/ beyond what's handed to it.
 *
 * Expected deps shape:
 * {
 *   interventionPlanState,    // SessionStore instance (owned/instantiated in webhook.js)
 *   hashPhone,                 // (from) => phoneHash
 *   parseIntent,                // (text) => intent  — fallback classifier
 *   getTeacherByPhone,          // (from) => teacher row
 *   isProActive,                // (teacher) => boolean
 *   safeSendMessage,            // async (from, text) => void
 *   parseGrade,                 // (text) => number|null
 *   gradeLabel,                 // (grade) => string
 *   checkAndIncrementUsage,     // (from, kind) => { allowed, ... }
 *   rollbackUsage,              // (quota, from) => void
 *   buildPrompt,                // (spec, opts) => prompt
 *   generateContent,            // async (prompt, kind) => string
 *   generatePdf,                 // async (opts) => { fileId, filename }
 *   buildPdfUrl,                 // (fileId) => url
 *   sendDocument,                 // async (from, url, filename, caption) => void
 *   FREE_LIMIT_DISPLAY,          // () => string
 * }
 */

/**
 * Handles the multi-turn intervention planning and SBA support conversation.
 * Pro-only — gated before any state is created.
 * Returns true if handled (skip normal processing), false otherwise.
 *
 * @param {string} from
 * @param {string} text
 * @param {object|null} preClassifiedIntent
 * @param {object} deps
 * @returns {Promise<boolean>}
 */
async function handleInterventionPlanFlow(from, text, preClassifiedIntent = null, deps) {
  const {
    interventionPlanState,
    hashPhone,
    parseIntent,
    getTeacherByPhone,
    isProActive,
    safeSendMessage,
    parseGrade,
    gradeLabel,
  } = deps;

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
    await generateInterventionOutput(from, state, phoneHash, deps);
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
    await generateInterventionOutput(from, state, phoneHash, deps);
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
 * @param {object} deps
 * @returns {Promise<void>}
 */
async function generateInterventionOutput(from, state, phoneHash, deps) {
  const {
    interventionPlanState,
    getTeacherByPhone,
    isProActive,
    safeSendMessage,
    gradeLabel,
    checkAndIncrementUsage,
    rollbackUsage,
    buildPrompt,
    generateContent,
    generatePdf,
    buildPdfUrl,
    sendDocument,
    FREE_LIMIT_DISPLAY,
  } = deps;

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

module.exports = { handleInterventionPlanFlow, generateInterventionOutput };
