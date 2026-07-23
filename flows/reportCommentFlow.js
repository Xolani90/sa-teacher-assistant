'use strict';

/**
 * Report comment conversation flow — extracted from routes/webhook.js.
 *
 * Scope: the multi-turn "Report Comment Generator" conversation.
 *   - session entry via classified 'reportComment' intent
 *   - single-learner path (ask_learner_name / ask_mark / ask_behaviour /
 *     generate / ask_next)
 *   - batch/paste-a-class-list path (ask_class_list / ask_behaviour_batch,
 *     including the "skip all" remaining-batch generation)
 *   - per-learner quota checks, AI generation, and rollback on failure
 *   - compiling and sending the batch PDF once a batch completes
 *
 * Dependencies are injected via the `deps` object rather than required
 * directly, so this module has no reverse dependency on webhook.js and
 * no dependency on services/ beyond what's handed to it.
 *
 * Expected deps shape:
 * {
 *   reportCommentState,      // SessionStore instance (owned/instantiated in webhook.js)
 *   hashPhone,                // (from) => phoneHash
 *   parseIntent,               // (text) => intent  — fallback classifier
 *   getTeacherByPhone,         // (from) => teacher row
 *   safeSendMessage,           // async (from, text) => void
 *   checkAndIncrementUsage,    // (from, kind) => { allowed, ... }
 *   rollbackUsage,             // (quota, from) => void
 *   buildPrompt,               // (spec, opts) => prompt
 *   generateContent,           // async (prompt, kind) => string
 *   generateReportSummaryPdf,  // async (comments, meta) => { fileId, filename }
 *   buildPdfUrl,               // (fileId) => url
 *   sendDocument,               // async (from, url, filename, caption) => void
 *   FREE_LIMIT_DISPLAY,        // () => string
 * }
 */

/**
 * Compiles the batch's generated comments into a PDF and sends it.
 * Internal helper — not part of the flow's public entry point, but
 * exported for direct testing since it has its own failure path.
 *
 * @param {string} from
 * @param {object} state
 * @param {object} deps
 */
async function generateAndSendBatchPdf(from, state, deps) {
  const {
    getTeacherByPhone,
    generateReportSummaryPdf,
    buildPdfUrl,
    sendDocument,
    safeSendMessage,
  } = deps;

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
    console.error('[REPORT_COMMENT_FLOW] Batch PDF generation failed:', pdfErr.message);
    await safeSendMessage(from, `❌ *PDF generation failed*\n\nYour comments were generated but we couldn't create the PDF. Please try again.`);
  }
}

/**
 * Handles the multi-turn report comment conversation.
 * Returns true if handled (skip normal processing), false otherwise.
 *
 * @param {string} from
 * @param {string} text
 * @param {object|null} preClassifiedIntent
 * @param {object} deps
 * @returns {Promise<boolean>}
 */
async function handleReportCommentFlow(from, text, preClassifiedIntent = null, deps) {
  const {
    reportCommentState,
    hashPhone,
    parseIntent,
    getTeacherByPhone,
    safeSendMessage,
    checkAndIncrementUsage,
    rollbackUsage,
    buildPrompt,
    generateContent,
    FREE_LIMIT_DISPLAY,
  } = deps;

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
          if (state.comments.length > 0) await generateAndSendBatchPdf(from, state, deps);
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
          console.error(`[REPORT_COMMENT_FLOW] Failed to generate comment for ${learner.name}:`, err.message);
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
      await generateAndSendBatchPdf(from, state, deps);
      reportCommentState.delete(phoneHash);
      return true;
    }

    // Generate comment for current learner
    const learnerQuota = checkAndIncrementUsage(from, 'reportComment');
    if (!learnerQuota.allowed) {
      await safeSendMessage(from,
        `That's your free limit — I got through ${state.batchIndex} of ${state.batch.length} comments. Reply *PRO* to unlock the rest (R${process.env.PRO_PRICE_ZAR || 99}/month). 🚀`
      );
      if (state.comments.length > 0) await generateAndSendBatchPdf(from, state, deps);
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
      console.error(`[REPORT_COMMENT_FLOW] Failed to generate comment for ${currentLearner.name}:`, err.message);
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
    await generateAndSendBatchPdf(from, state, deps);
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
      console.error('[REPORT_COMMENT_FLOW] Report comment generation failed:', err.message);
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

module.exports = { handleReportCommentFlow, generateAndSendBatchPdf };
