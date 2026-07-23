'use strict';

/**
 * Assessment analysis / diagnostics conversation flow — extracted from
 * routes/webhook.js.
 *
 * Scope: the multi-turn "Assessment Analysis" conversation (Pro-only).
 *   - Pro gate checked before any state is created
 *   - ask_grade_subject / ask_assessment_name / ask_topics / ask_performance
 *     steps
 *   - quota check + AI generation + optional PDF (Pro) on completion
 *   - rollback on generation failure
 *
 * Dependencies are injected via the `deps` object rather than required
 * directly, so this module has no reverse dependency on webhook.js and
 * no dependency on services/ beyond what's handed to it.
 *
 * Expected deps shape:
 * {
 *   assessmentAnalysisState,   // SessionStore instance (owned/instantiated in webhook.js)
 *   hashPhone,                  // (from) => phoneHash
 *   parseIntent,                 // (text) => intent  — fallback classifier
 *   getTeacherByPhone,           // (from) => teacher row
 *   isProActive,                 // (teacher) => boolean
 *   safeSendMessage,             // async (from, text) => void
 *   parseGrade,                  // (text) => number|null
 *   gradeLabel,                  // (grade) => string
 *   checkAndIncrementUsage,      // (from, kind) => { allowed, ... }
 *   rollbackUsage,               // (quota, from) => void
 *   buildPrompt,                 // (spec, opts) => prompt
 *   generateContent,             // async (prompt, kind) => string
 *   generatePdf,                 // async ({content, type, ...}) => { fileId, filename }
 *   buildPdfUrl,                 // (fileId) => url
 *   sendDocument,                // async (from, url, filename, caption) => void
 *   FREE_LIMIT_DISPLAY,          // () => string
 * }
 */

/**
 * Handles the multi-turn assessment analysis / diagnostics conversation.
 * Pro-only — gated the same way ATP is gated, before any state is created.
 * Returns true if handled (skip normal processing), false otherwise.
 *
 * @param {string} from
 * @param {string} text
 * @param {object|null} preClassifiedIntent
 * @param {object} deps
 * @returns {Promise<boolean>}
 */
async function handleAssessmentAnalysisFlow(from, text, preClassifiedIntent = null, deps) {
  const {
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
  } = deps;

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

module.exports = { handleAssessmentAnalysisFlow };
