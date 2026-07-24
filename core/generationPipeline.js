// core/generationPipeline.js
// Extracted from routes/webhook.js — the shared AI generation pipeline
// (processGeneration -> triggerGeneration). Handles rate limiting, Pro
// gating for atp/moderationPack, quota deduction, prompt building, AI
// generation, ATP week-range validation/retry, delivery, PDF attachment,
// disambiguation/quiz/SAVE follow-ups, and resource-persistence state
// publication. Dependencies injected via buildGenerationDeps() in
// webhook.js; no reverse dependency on webhook.js.
//
// See docs/adr/ADR-002-generation-pipeline.md and
// docs/adr/generation-pipeline-analysis.md for the extraction boundary
// and dependency-contract evidence this module was built against.

'use strict';

const { validateAtpWeeks } = require('../utils/atpWeekValidator');
const { resolveCurrentTopic, topicMatchesCurrentATP } = require('../services/curriculumIntelligenceService');

// Types whose content is tied to a specific CAPS topic and should be
// grounded against the ATP (rather than left to the AI to free-associate
// a topic, or the classifier to guess one). atp/curriculumQuery/rubric/
// moderationPack/assessmentAnalysis/reportComment/parentMessage etc. are
// intentionally excluded — they either have no single topic, or (rubric/
// moderationPack) wrap an existing task that already carries its own topic.
const ATP_GROUNDED_TYPES = ['lessonPlan', 'worksheet', 'test', 'examPaper', 'sbaTask', 'quickQuiz'];

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

async function triggerGeneration({ from, intent, originalText = null, deps }) {
  const {
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
  } = deps;

  // Per-phone burst rate limit — prevents rapid-fire AI calls
  if (isAiRateLimited(from)) {
    await safeSendMessage(from,
      `⏱️ You're sending requests too quickly. Please wait a moment before trying again.`
    );
    return;
  }

  // Persist the generation intent for RETRY, exactly once, regardless of
  // which caller (disambiguation follow-up, clarified-topic reply, or the
  // main classification path) routed us here. This used to be duplicated
  // at every call site in webhook.js; centralizing it here means every
  // generation path updates last_intent exactly once, with no risk of a
  // new call site forgetting to do it.
  updateTeacherProfile(from, { last_intent: JSON.stringify(intent) });

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

  // ── Ground topic against the ATP ────────────────────────────────
  // Fixes the "Algebraic Equations in Term 3" class of bug: previously
  // intent.topic was passed straight into the prompt with no connection to
  // the ATP the app itself generates, so an under-specified request left
  // the AI free to invent a plausible-but-wrong topic. Resolve the
  // effective grade/subject the same way the rest of this function does
  // (intent, falling back to teacher profile), then either fill in a
  // missing topic from the current ATP week, or softly flag one that
  // doesn't match — never block, since teachers legitimately revisit or
  // work ahead of the ATP.
  let atpTopicWarning = null;
  if (ATP_GROUNDED_TYPES.includes(intent.type)) {
    const effGrade   = intent.grade != null ? intent.grade : (teacher?.grade ?? null);
    const effSubject = intent.subject !== 'general' ? intent.subject : (teacher?.subject || null);

    if (effGrade != null && effSubject) {
      if (!intent.topic) {
        const resolved = resolveCurrentTopic(effGrade, effSubject);
        if (resolved) {
          intent.topic = resolved.topic;
          intent.atpTopic = true;
          intent.term = resolved.term;
        }
      } else {
        const check = topicMatchesCurrentATP(effGrade, effSubject, intent.topic);
        if (check.checked && !check.matches) {
          atpTopicWarning =
            `ℹ️ _Heads up: "${intent.topic}" isn't in this term's ATP for ${gradeLabel(effGrade)} — ` +
            `this term's topics are: ${check.currentTermTopics.join(', ')}. ` +
            `Generating it anyway in case you're revisiting or working ahead._`;
        }
      }
    }
  }

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
  // Usage is only committed once WhatsApp has accepted the generated
  // content. If delivery fails here, the teacher got nothing for their
  // quota — roll it back, mirroring the isolation already used around
  // generateContent() above. PDF delivery below stays a best-effort
  // bonus (unchanged) since text delivery is what quota actually pays for.
  let usageCommitted = false;
  try {
    await safeSendMessage(from, finalContent);
    usageCommitted = true;
    if (atpTopicWarning) {
      await safeSendMessage(from, atpTopicWarning).catch(() => {}); // best-effort, never block delivery
    }
  } catch (sendErr) {
    console.error('[WEBHOOK] Delivery of generated content failed:', sendErr.message);
    rollbackUsage(quota, from);
    await safeSendMessage(from,
      `Something went wrong sending your content — please try again in a moment. If it keeps happening, reply *HELP*.`
    ).catch(() => {}); // best-effort — don't double-throw
    return;
  }

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

  // ── Worksheet state storage and differentiation follow-up (Feature 2) — extracted ─
  if (intent.type === 'worksheet' && !intent.differentiation) {
    recordWorksheetGeneration(from, intent, content, buildWorksheetDeps());
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

module.exports = { triggerGeneration, buildPdfUrl };
