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
// Mental Maths goes through services/mentalMathsSessionService.js, which is
// the single entry point to the two governed generators (Grade 5 C12/C13 and
// the Senior Phase authorized families). The legacy six-strand path
// (generateMentalMathsSet) is deliberately NOT imported here and has no code
// path from this module at all — it remains exported from
// mentalMathsService.js untouched for anything else that still calls it.
const mentalMaths = require('../services/mentalMathsSessionService');
const { openMenu, closeMenu } = require('../services/navigationService');

// ── Mental Maths session wizard menus ───────────────────────────────────
//
// Three grade-agnostic steps, each built on the exact contract
// flows/mainMenuFlow.js's other sub-menus use (openMenu /
// consumeNumericReply). Unlike those, every option set here is derived at
// runtime (from SUPPORTED_GRADES / topicsForGrade), so the menus are
// opened here rather than from mainMenuFlow.js's static MENUS_BY_ID
// table. mainMenuFlow.js still owns *consuming* every reply — this module
// only ever opens a menu, never reads a reply off one.
//
//   1. Grade    — only grades with an authorized generator are offered.
//   2. Topic    — only topics authorized for the chosen grade.
//   3. Delivery — oral or written (presentation only; skipped when the
//                 teacher already said which they wanted).
//
// There is deliberately NO difficulty step. Difficulty modelling has no
// authorization for any grade (ADR-022 §5 Governance Rule 3; the Grade 5
// ADR-023 §6 freeze act §6; Senior Phase Generation Policy v1.0 §10
// item 4), so offering Support/Core/Extension here would invent it.
const MENTAL_MATHS_GRADE_MENU_ID = 'mainMenu.mentalMathsGrade';
// Retains its historical id/name: this is the same menu, now carrying the
// grade's authorized topics rather than only the Senior Phase families.
const MENTAL_MATHS_FAMILY_MENU_ID = 'mainMenu.mentalMathsFamily';
const MENTAL_MATHS_DELIVERY_MENU_ID = 'mainMenu.mentalMathsDelivery';

const MENTAL_MATHS_MENU_IDS = [
  MENTAL_MATHS_GRADE_MENU_ID,
  MENTAL_MATHS_FAMILY_MENU_ID,
  MENTAL_MATHS_DELIVERY_MENU_ID,
];

// Re-exported from mentalMathsSessionService so the label map has a single
// home while flows/mainMenuFlow.js's existing import keeps working.
const FAMILY_LABELS = mentalMaths.FAMILY_LABELS;

// Reverse lookup (Senior Phase family label -> family key), unchanged in
// meaning and still exported for compatibility. NOT used to resolve a topic
// menu reply: topic labels are only unique WITHIN a grade (Grade 5's
// "Multiplication & Division" is the frozen C13 candidate, Grade 7/8's is
// the mulDivFluency family), so flows/mainMenuFlow.js resolves a topic reply
// through the grade-scoped topicKeyForLabel() below instead.
const FAMILY_MENU_LABEL_TO_FAMILY = Object.fromEntries(
  Object.entries(FAMILY_LABELS).map(([family, label]) => [label, family])
);

// Grade-scoped topic-label resolver, re-exported so flows/mainMenuFlow.js
// has one import site for the whole wizard.
const topicKeyForLabel = mentalMaths.topicKeyForLabel;

// Reverse lookup for the delivery menu, same mechanism.
const DELIVERY_MENU_LABEL_TO_MODE = Object.fromEntries(
  Object.entries(mentalMaths.DELIVERY_MODE_LABELS).map(([mode, label]) => [label, mode])
);

const GRADE_MENU_LABEL_TO_GRADE = Object.fromEntries(
  mentalMaths.SUPPORTED_GRADES.map((grade) => [`Grade ${grade}`, grade])
);

/**
 * Opens one numbered wizard menu. Options are always the given labels in
 * order, plus the universal "0. Back to main menu" every other sub-menu
 * in flows/mainMenuFlow.js uses.
 */
async function openMentalMathsMenu(from, { menuId, heading, labels, expiresAfterReply = false, footer = null }, { hashPhone, safeSendMessage }) {
  const phoneHash = hashPhone(from);
  const options = {};
  labels.forEach((label, i) => { options[String(i + 1)] = label; });
  options['0'] = 'Back to main menu';

  openMenu(phoneHash, { id: menuId, options, expiresAfterReply });

  const lines = labels.map((label, i) => `${i + 1}. ${label}`);
  await safeSendMessage(from,
    `${heading}\n\n${lines.join('\n')}\n0. Back to main menu${footer ? `\n\n${footer}` : ''}`
  );
}

async function openMentalMathsGradeMenu(from, { unsupportedGrade = null } = {}, deps) {
  const prefix = unsupportedGrade != null
    ? `🔢 *Mental Maths isn't available for ${mentalMaths.gradeMenuLabel(unsupportedGrade)} yet.*\n\nIt's ready for these grades:`
    : `🔢 *Mental Maths — which grade?*`;
  await openMentalMathsMenu(from, {
    menuId: MENTAL_MATHS_GRADE_MENU_ID,
    heading: prefix,
    labels: mentalMaths.SUPPORTED_GRADES.map((g) => mentalMaths.gradeMenuLabel(g)),
  }, deps);
}

async function openMentalMathsTopicMenu(from, grade, deps) {
  await openMentalMathsMenu(from, {
    menuId: MENTAL_MATHS_FAMILY_MENU_ID,
    heading: `🔢 *${mentalMaths.gradeMenuLabel(grade)} Mental Maths — choose a focus:*`,
    labels: mentalMaths.topicsForGrade(grade).map((t) => t.label),
  }, deps);
}

async function openMentalMathsDeliveryMenu(from, { grade, topicLabel, count }, deps) {
  await openMentalMathsMenu(from, {
    menuId: MENTAL_MATHS_DELIVERY_MENU_ID,
    heading: `🔢 *${mentalMaths.gradeMenuLabel(grade)} Mental Maths — ${topicLabel}*\n\nHow will learners do it?`,
    labels: mentalMaths.DELIVERY_MODE_VALUES.map((m) => mentalMaths.DELIVERY_MODE_LABELS[m]),
    expiresAfterReply: true,
    footer: `_${count} questions. For a different length, ask for e.g. "${mentalMaths.gradeMenuLabel(grade)} mental maths, 20 questions"._`,
  }, deps);
}

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
    mentalMathsFamilyPendingState,
    lastGeneratedState,
    recordWorksheetGeneration,
    buildWorksheetDeps,
    updateTeacherProfile,
  } = deps;

  // Per-phone burst rate limit — prevents rapid-fire AI calls.
  //
  // isAiRateLimited() is check-AND-record (utils/webhookHelpers.js): every
  // call that isn't already over the limit consumes one of the 5 slots per
  // 60s for a full minute. So it must be consumed once per actual AI call,
  // never once per entry into this function.
  //
  // Mental Maths is the only type that re-enters triggerGeneration() without
  // reaching the AI: its wizard asks grade -> topic -> delivery, one menu
  // round-trip each, and only the final step generates. Checking here charged
  // 4 slots for 1 AI call, so a teacher was throttled — and told they were
  // "sending requests too quickly" — for nothing but tapping menu options.
  // For that type the identical check is therefore deferred until the wizard
  // has fully resolved (see the deferred call below, immediately before quota
  // and generation). Same limiter, same limit, same message: one slot per AI
  // call, exactly like every other type. No other type's behaviour changes.
  async function burstRateLimited() {
    if (!isAiRateLimited(from)) return false;
    await safeSendMessage(from,
      `⏱️ You're sending requests too quickly. Please wait a moment before trying again.`
    );
    return true;
  }

  if (intent.type !== 'mentalMaths' && await burstRateLimited()) return;

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

  // ── Mental Maths session wizard ───────────────────────────────────
  //
  // Gated before quota deduction, same pattern as the atp/moderationPack
  // Pro-gates above. The deterministic question set is also computed here
  // (not inside buildPrompt/promptService) because it needs the fully
  // resolved grade/topic/count/mode, and because the set must exist before
  // the AI wording call is ever made — the AI never authors or alters the
  // arithmetic, only wraps this pre-computed set in wording.
  //
  // Every grade goes through the same three-step resolution, in the same
  // order, so the teacher experience is identical across grades:
  //   grade -> topic -> delivery mode -> generate.
  // Any step already answered (from the message, the profile, or a menu
  // round-trip) is skipped. Question count comes from the teacher's own
  // wording via the existing intent.questionCount field, defaulting to the
  // previously hard-coded 12.
  //
  // Which grades and topics exist is decided entirely by
  // services/mentalMathsSessionService.js, which derives them from the two
  // governed generators — nothing is hard-coded here, so a grade with no
  // frozen specification has no path through this block at all.
  if (intent.type === 'mentalMaths') {
    // A Mental Maths request made from the menu must always begin with a
    // grade choice. A saved profile grade is useful context elsewhere, but
    // using it here silently skipped the first wizard step and made the
    // feature appear to offer only that one grade. An explicit grade in the
    // teacher's message still skips this menu as intended.
    const rawGrade = intent.grade;
    const parsedGrade = rawGrade != null && rawGrade !== '' ? parseInt(rawGrade, 10) : null;
    const effGrade = Number.isInteger(parsedGrade) ? parsedGrade : null;
    const phoneHash = hashPhone(from);

    // Question count: reuses the existing intent.questionCount field that
    // utils/intentParser.js already extracts and clamps from "N questions"
    // phrasing — no new parser field, no new clamp.
    const count = intent.mentalMathsCount != null
      ? mentalMaths.normaliseCount(intent.mentalMathsCount)
      : (intent.questionCount != null ? mentalMaths.normaliseCount(intent.questionCount) : mentalMaths.DEFAULT_COUNT);

    // Delivery mode: an explicit menu answer wins; otherwise the teacher's
    // own wording ("oral", "written", "in their books") is honoured so
    // they are not asked something they already answered.
    const mode = mentalMaths.normaliseDeliveryMode(intent.mentalMathsMode)
      || mentalMaths.parseDeliveryMode(originalText || '');

    // ── Step 1: grade ────────────────────────────────────────────────
    if (!mentalMaths.isSupportedGrade(effGrade)) {
      // No authorized generator for this grade (or no grade known at all).
      // Offer only the grades that genuinely have one — never fall back to
      // generating something for an unauthorized grade.
      mentalMathsFamilyPendingState.set(phoneHash, {
        subject: intent.subject,
        count,
        mode,
        lastActivity: Date.now(),
      });
      await openMentalMathsGradeMenu(from, { unsupportedGrade: effGrade }, { hashPhone, safeSendMessage });
      return;
    }

    // ── Step 2: topic ────────────────────────────────────────────────
    // intent.family is the historical field name for the chosen topic and
    // is kept as-is so the family-menu round-trip contract is unchanged.
    // Every supported grade is asked, including Grade 5 — the grade's own
    // authorized topics are the only options offered, and no topic is ever
    // assumed on the teacher's behalf here. (generateSession() still has a
    // programmatic default for direct callers; the teacher-facing flow
    // deliberately does not use it.)
    const topic = intent.family != null && mentalMaths.findTopic(effGrade, intent.family)
      ? intent.family
      : null;
    if (topic == null) {
      mentalMathsFamilyPendingState.set(phoneHash, {
        grade: effGrade,
        subject: intent.subject,
        count,
        mode,
        lastActivity: Date.now(),
      });
      await openMentalMathsTopicMenu(from, effGrade, { hashPhone, safeSendMessage });
      return;
    }

    // ── Step 3: delivery mode ────────────────────────────────────────
    if (!mode) {
      mentalMathsFamilyPendingState.set(phoneHash, {
        grade: effGrade,
        subject: intent.subject,
        family: topic,
        count,
        lastActivity: Date.now(),
      });
      await openMentalMathsDeliveryMenu(from, {
        grade: effGrade,
        topicLabel: mentalMaths.findTopic(effGrade, topic).label,
        count,
      }, { hashPhone, safeSendMessage });
      return;
    }

    // ── Generate ─────────────────────────────────────────────────────
    // generateSession() independently re-validates grade/topic/count/mode
    // and delegates to the grade's own governed generator, so a bad
    // combination reaching here fails loudly rather than generating.
    let session;
    try {
      session = mentalMaths.generateSession({ grade: effGrade, topic, count, mode });
    } catch (mmErr) {
      console.error('[WEBHOOK] Mental Maths session generation rejected:', mmErr.message);
      await safeSendMessage(from,
        `🔢 I couldn't put that Mental Maths session together. Reply *MENU* and pick Mental Maths again, and I'll walk you through it.`
      );
      return;
    }

    // Every menu step is answered — close any wizard menu still open so a
    // stray digit afterwards can't re-enter the flow, and clear the
    // pending request now that it has been fully consumed.
    closeMenu(phoneHash);
    mentalMathsFamilyPendingState.delete(phoneHash);

    intent.grade = effGrade;
    intent.mentalMathsQuestions = session.questions;
    intent.mentalMathsSession = session;
    intent.mentalMathsMode = session.mode;
    intent.mentalMathsCount = session.count;
    intent.mentalMathsTopicLabel = session.topicLabel;
    intent.family = session.topic;
    // Gives the session a real name in the SAVE title and the MY RESOURCES
    // listing, which previously showed every Mental Maths session as
    // "Untitled — Mental Maths session". Set only after the gate, so it can
    // never be mistaken for a CAPS topic by the topic-clarifier or the
    // ATP grounding (mentalMaths is excluded from both).
    intent.topic = session.topicLabel;
  }

  // Deferred burst rate limit for Mental Maths — see burstRateLimited() at
  // the top of this function for why. Every wizard step above has already
  // returned, so reaching here means this request WILL make an AI call, and
  // consuming exactly one slot for it matches every other type. Placed
  // before checkAndIncrementUsage() so a throttled request costs no quota.
  if (intent.type === 'mentalMaths' && await burstRateLimited()) return;

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
  // RC1-H-015: checkAndIncrementUsage() above has already consumed one
  // generation from the teacher's free-tier quota. If this interim send
  // fails (e.g. Meta messaging-pair throttle, network error), the whole
  // request aborts here with nothing generated — but until now the quota
  // decrement was never rolled back, so the teacher silently lost a
  // generation for a message that never even started. Roll back exactly
  // like the generateContent() failure path below does, then re-throw so
  // the existing outer webhook.js catch/fallback-notice behavior is
  // unchanged for every other aspect of this failure.
  // Mental Maths (V1) gets its own ack wording: it is strand-based mental
  // fluency practice, not a CAPS-topic-aligned generator (the service
  // deliberately does not model its six strands as CAPS ATP topics — see
  // services/mentalMathsService.js) — so the shared "CAPS-aligned ..."
  // template would overclaim curriculum alignment for this type
  // specifically. Every other intent type keeps the original wording.
  const ackMessage = intent.type === 'mentalMaths'
    ? `⏳ Generating your Mental Maths session${gradeDisplay}... Please wait.`
    : `⏳ Generating your CAPS-aligned ${intentLabel(intent.type)}${gradeDisplay}${subjectDisplay}... Please wait.`;
  try {
    await safeSendMessage(from, ackMessage);
  } catch (err) {
    rollbackUsage(quota, from);
    throw err;
  }

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

  // Mental Maths is the one type that can survive a total AI failure: its
  // questions and canonicalAnswers are already computed deterministically
  // (services/mentalMathsSessionService.js), and the AI was only ever asked
  // for wording. When a session exists, an AI outage must NOT cost the
  // teacher their content — the deterministic rendering below is a complete,
  // correct response on its own. Every other type has no content without the
  // AI and keeps the original rollback-and-apologise behaviour untouched.
  const mentalMathsFallbackAvailable = intent.type === 'mentalMaths' && !!intent.mentalMathsSession;

  const content = await generateContent(prompt, intent.type).catch(async (err) => {
    console.error('[WEBHOOK] AI generation failed:', err.message);
    if (mentalMathsFallbackAvailable) {
      // Deliberately no rollback and no error message: the teacher still
      // receives the full session (questions + answer key), so the quota was
      // genuinely spent and there is nothing to apologise for. The Mental
      // Maths block below turns this null into the deterministic rendering.
      console.warn(`[WEBHOOK] Mental Maths wording call failed — falling back to deterministic rendering for ...${String(from).slice(-4)}`);
      return null;
    }
    // Roll back usage increment for free-tier teachers
    rollbackUsage(quota, from);
    await safeSendMessage(from,
      `Something went wrong on my end — please try again in a moment. If it keeps happening, reply *HELP*.`
    ).catch(() => {}); // best-effort — don't double-throw
    return null;
  });

  // Error already sent to teacher — except for Mental Maths with a
  // deterministic session in hand, which continues to delivery below.
  if (!content && !mentalMathsFallbackAvailable) return;

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

  // ── Mental Maths: deterministic answer key + faithfulness gate ──
  // The wording call was asked for phrasing only, and was explicitly told
  // not to produce an answer key. Here that is enforced rather than
  // trusted: every generated question must still appear verbatim in the
  // AI's output and the output must carry no answer section of its own.
  //
  //  * Verified  -> keep the AI's wording, append the answer key built in
  //                 code from canonicalAnswer.
  //  * Not verified -> discard the AI's wording entirely and send the fully
  //                 deterministic rendering.
  //
  // Either way, the questions and the answer key the teacher receives are
  // exactly the ones the deterministic generator produced — the AI is
  // structurally unable to affect any mathematical value.
  //
  // finalContent is null here when the wording call failed outright (see
  // mentalMathsFallbackAvailable above); finaliseSessionContent() treats that
  // exactly like unfaithful wording and renders deterministically, so the
  // outage path and the unfaithful-wording path converge on one code path.
  if (intent.type === 'mentalMaths' && intent.mentalMathsSession) {
    const finalised = mentalMaths.finaliseSessionContent(finalContent, intent.mentalMathsSession);
    if (finalised.source === 'deterministic' && finalContent) {
      // Only log the faithfulness miss when there was actually wording to
      // check — an outright failure has already been logged above.
      console.warn(`[WEBHOOK] Mental Maths wording call not verifiably faithful — using deterministic rendering for ...${String(from).slice(-4)}`);
    }
    finalContent = finalised.content;
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
  const saveableTypes = ['worksheet', 'test', 'lessonPlan', 'atp', 'sbaTask', 'examPaper', 'rubric', 'moderationPack', 'mentalMaths'];
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
      // Mental Maths stores the delivered content (verified questions +
      // the code-built answer key), not the raw AI wording — a saved
      // session without its answer key would be useless to the teacher.
      // Every other type keeps storing `content` exactly as before.
      content: intent.type === 'mentalMaths' ? finalContent : content,
      lastActivity: Date.now(),
    });
    // Append SAVE nudge as a follow-up (1.5 s delay — after any differentiation prompt)
    setTimeout(async () => {
      await safeSendMessage(from, `_Reply *SAVE* to keep this in My Resources._`);
    }, 1500);
  }

  console.log(`[WEBHOOK] Response delivered to ...${String(from || '').slice(-4)}`);
}

module.exports = {
  triggerGeneration,
  buildPdfUrl,
  // Mental Maths session-wizard menus — consumed by flows/mainMenuFlow.js
  MENTAL_MATHS_GRADE_MENU_ID,
  MENTAL_MATHS_FAMILY_MENU_ID,
  MENTAL_MATHS_DELIVERY_MENU_ID,
  MENTAL_MATHS_MENU_IDS,
  FAMILY_LABELS,
  FAMILY_MENU_LABEL_TO_FAMILY,
  topicKeyForLabel,
  DELIVERY_MENU_LABEL_TO_MODE,
  GRADE_MENU_LABEL_TO_GRADE,
};
