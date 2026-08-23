// core/messageProcessor.js
// Extracted from routes/webhook.js — the core per-message dispatcher
// (processMessage). Handles deduplication, opt-out re-activation, phone
// encryption bookkeeping, non-text message short-circuits, command
// handling, onboarding, pending-topic clarification, mid-flow routing
// (observation/assessment-session/roster/report-comment/profile-update/
// parent-message/data-assessment/assessment-analysis/intervention-plan),
// intent classification, and the final dispatch into conversational
// replies, topic clarification, or generation. Dependencies injected via
// buildProcessMessageDeps() in webhook.js; no reverse dependency on
// webhook.js.
//
// ADR-019 Step 3, Commit 2: also calls NavigationService.evaluateMessage()
// once per message as the integration point for the future navigation
// router — its result is currently discarded (see inline comment at the
// call site). Commit 3 begins acting on that result, scoped to the
// assessment-session flow only.

'use strict';

/**
 * Processes a single incoming WhatsApp message.
 *
 * @param {Object} message - WhatsApp message object
 */
async function processMessage(message, deps) {
  const from        = message.from;
  const messageType = message.type;
  const messageId   = message.id;
  if (!from || !messageId) {
    console.warn("[WEBHOOK] Message missing from or id — skipped");
    return;
  }

  // ── Deduplication ─────────────────────────────────────────────
  if (deps.isDuplicate(messageId)) {
    console.log(`[WEBHOOK] Duplicate message ignored: ${messageId}`);
    return;
  }

  console.log(`[WEBHOOK] Processing message ${messageId} from ...${String(from || '').slice(-4)} (type: ${messageType})`);

  // ── Opt-out check (POPIA compliance) ───────────────────────────
  const teacher = deps.getTeacherByPhone(from);
  if (teacher && teacher.opted_out === 1) {
    // Any message from an opted-out teacher is consent to re-activate
    // (WhatsApp Cloud API policy: any inbound message implies consent to resume).
    // We use opted_out_at to distinguish re-activation from normal flow.
    // opted_out_at is set on STOP and cleared here — it is independent of
    // renewal_reminder_sent_at which is managed by Pro billing logic.
    deps.updateTeacherProfile(from, { opted_out: 0 });
    const db = require('../utils/database').getDb();
    db.prepare(`UPDATE teachers SET opted_out_at = NULL WHERE phone_hash = ?`).run(deps.hashPhone(from));
    await deps.safeSendMessage(from, `👋 Welcome back! You've been re-activated. Send me a request anytime.`);
    console.log(`[WEBHOOK] Teacher ...${String(from).slice(-4)} re-activated after opt-out`);
    // Fall through to normal message processing so their message is not lost
  }

  // ── Update encrypted phone in teachers table ──────────────────
  // Every incoming message gives us a chance to record the phone in encrypted
  // form, which enables proactive messages (confirmations, renewal reminders).
  // deps.updateTeacherProfile is a no-op if the teacher doesn't exist yet;
  // the profile is created during onboarding / first usage check.
  try {
    const phoneEnc = deps.encryptPhone(from);
    deps.updateTeacherProfile(from, { phone_enc: phoneEnc });
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
      const phoneHashDoc = deps.hashPhone(from);
      if (deps.dataAssessmentState.get(phoneHashDoc)) {
        if (await deps.handleAssessmentFlow(from, '', message, null, deps.buildAssessmentDeps())) return;
      }
    }
    await deps.safeSendMessage(from,
      `I can only handle text messages at the moment — voice notes aren't supported yet.\n\nTo submit marks, start by saying "upload marks" and I'll guide you through it. Or try "Grade 7 algebra worksheet" or reply *HELP* for the full menu. 😊`
    );
    return;
  }

  if (!text) return;

  // ── Command handler (simple commands short-circuit AI; all commands checked here) ──
  const commandHandled = await deps.handleCommand(from, text);
  if (commandHandled) return;

  // ── Guided main menu (flows/mainMenuFlow.js) ──────────────────────────
  // Checked immediately after commandHandler and BEFORE onboarding: a
  // teacher replying to an already-open numbered main-menu prompt must
  // never be re-routed into onboarding. This flow does not use the
  // alreadyMidFlow/FLOW_STORES mechanism the 13 stateful flows below use —
  // an open NavigationService menu IS its entire state (see the flow
  // file's own header comment for why that's safe here), so it needs no
  // entry in that list. handleMainMenuFlow() itself only claims a message
  // when one of ITS OWN menus is genuinely open for this phone (via
  // navigationService.consumeNumericReply()), so a bare "1" with nothing
  // of ours open safely falls through to existing behavior unchanged.
  const mainMenuHandled = await deps.handleMainMenuFlow(from, text, deps.buildMainMenuDeps());
  if (mainMenuHandled) return;

  // ── Onboarding (new users) ────────────────────────────────────
  const needsOb = deps.needsOnboarding(from);
  if (needsOb) {
    const result = deps.handleOnboarding(from, text);
    if (result.handled) {
      await deps.safeSendMessage(from, result.message);
      return;
    }
  }

  // ── Clarification prompt for ambiguous topics ────────────────────
  // Checked BEFORE classification: if the teacher is replying to "what
  // topic would you like?", their reply is the topic itself, not a new
  // request to classify — running it through the classifier would be
  // wrong and wasteful.
  const phoneHash = deps.hashPhone(from);
  const pendingIntent = deps.pendingIntentState.get(phoneHash);

  if (pendingIntent) {
    // Session TTL check (30 minutes)
    if (Date.now() - pendingIntent.lastActivity > 30 * 60 * 1000) {
      deps.pendingIntentState.delete(phoneHash);
    } else {
      // Teacher is providing the topic clarification
      deps.pendingIntentState.delete(phoneHash);
      // Use the teacher's reply as the topic
      const clarifiedIntent = { ...pendingIntent.intent, topic: text.trim() };
      // Proceed with generation using the clarified intent
      await deps.triggerGeneration({ from, intent: clarifiedIntent, deps: deps.buildGenerationDeps() });
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
    deps.reportCommentState.get(phoneHash) ||
    deps.parentMessageState.get(phoneHash) ||
    deps.assessmentAnalysisState.get(phoneHash) ||
    deps.dataAssessmentState.get(phoneHash) ||
    deps.interventionPlanState.get(phoneHash) ||
    deps.profileUpdateState.get(phoneHash) ||
    deps.observationState.get(phoneHash) ||
    deps.observationHistoryState.get(phoneHash) ||
    deps.assessmentSessionState.get(phoneHash) ||
    deps.blueprintAuthoringState.get(phoneHash) ||
    deps.rosterState.get(phoneHash) ||
    deps.reflectionState.get(phoneHash) ||
    deps.growthPlanState.get(phoneHash)
  );

  // ── ADR-019 Step 3, Commit 2: NavigationService integration point ──────
  // Computes the routing decision NavigationService.evaluateMessage() would
  // make for this message, but does not act on it and does not log it —
  // this commit exists solely to prove the dependency can be inserted into
  // the pipeline without changing observable behavior in any way (no new
  // output, no new side effects). The result is discarded on purpose.
  // Correctness of evaluateMessage() itself is covered in isolation by
  // tests/navigation-service.test.js, not exercised here. Commit 3 is the
  // first commit where messageProcessor acts on any part of this result,
  // starting with the assessment-session flow only.
  // RC1-H-013 fix: reflectionState and growthPlanState are active-flow
  // state stores exactly like assessmentSessionState/blueprintAuthoringState
  // above (see the alreadyMidFlow computation, which already includes them)
  // but were missing from this gate. Both flows open a bare numeric
  // correction menu (reflectionFlow.js/growthPlanFlow.js CORRECTION_MENU_ID)
  // via navigationService.openMenu(), which defaults expiresAfterReply to
  // true — so the same double-consumption bug RC1-H-007 fixed for
  // assessmentSession's COMPLETE_MENU applies here too: without these two
  // branches, the speculative evaluateMessage() call below closes the
  // correction menu before the real flow handler's own
  // consumeNumericReply() call gets a chance to, causing every correction
  // choice to be rejected as invalid and the menu to loop.
  const activeFlowId = deps.assessmentSessionState.get(phoneHash)
    ? 'assessmentSession'
    : (deps.blueprintAuthoringState.get(phoneHash)
      ? 'blueprintAuthoring'
      : (deps.reflectionState.get(phoneHash)
        ? 'reflection'
        : (deps.growthPlanState.get(phoneHash) ? 'growthPlan' : null)));
  // RC1-H-007 fix: evaluateMessage() is a discarded dry-run per the comment
  // above, but it is NOT actually side-effect-free — it calls
  // consumeNumericReply() internally (navigationService.js §4), which
  // destructively closes an open menu on a match. When a flow is already
  // active and about to run its own consumeNumericReply() against the same
  // reply (e.g. assessmentSessionFlow's COMPLETE_MENU handler), this
  // speculative call was consuming/closing the menu first, so the real
  // handler moments later found no_menu_open. Skipping the speculative call
  // whenever activeFlowId is set gives the owning flow the only/first
  // opportunity to consume the reply, matching the "no new side effects"
  // intent this call was originally meant to have. When no flow is active,
  // behavior is unchanged.
  if (!activeFlowId) {
    require('../services/navigationService').evaluateMessage(phoneHash, text, { activeFlowId });
  }

  if (alreadyMidFlow) {
    // Route straight through without classifying — each handler will
    // recognize its own state and continue. Order matches the dispatch
    // order below so behavior is identical to the classified path.
    if (await deps.handleObservationFlow(from, text, null, deps.buildObservationDeps())) return;
    if (await deps.handleObservationHistoryFlow(from, text, null, deps.buildObservationDeps())) return;
    if (await deps.handleReflectionFlow(from, text, null, deps.buildReflectionDeps())) return;
    if (await deps.handleGrowthPlanFlow(from, text, null, deps.buildGrowthPlanDeps())) return;
    if (await deps.handleAssessmentSessionFlow(from, text, message, null, deps.buildAssessmentSessionDeps())) return;
    if (await deps.handleBlueprintAuthoringFlow(from, text, message, null, deps.buildBlueprintAuthoringDeps())) return;
    if (await deps.handleRosterFlow(from, text, message, null, deps.buildRosterDeps())) return;
    if (await deps.handleReportCommentFlow(from, text, null, deps.buildReportCommentDeps())) return;
    if (await deps.handleProfileUpdateFlow(from, text, deps.buildProfileUpdateDeps())) return;
    if (await deps.handleParentMessageFlow(from, text, null, deps.buildParentMessageDeps())) return;
    if (await deps.handleAssessmentFlow(from, text, message, null, deps.buildAssessmentDeps())) return;
    if (await deps.handleAssessmentAnalysisFlow(from, text, null, deps.buildAssessmentAnalysisDeps())) return;
    if (await deps.handleInterventionPlanFlow(from, text, null, deps.buildInterventionPlanDeps())) return;
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
  const teacherForClassification = deps.getTeacherByPhone(from);
  let lastIntentType = null;
  try {
    if (teacherForClassification?.last_intent) {
      lastIntentType = JSON.parse(teacherForClassification.last_intent)?.type || null;
    }
  } catch { /* ignore malformed last_intent — non-fatal */ }

  const skipClassifier = deps.isClassifierRateLimited(from) || deps.isCeilingReached();
  const intent = skipClassifier
    ? { ...deps.parseIntent(text), _source: deps.isCeilingReached() ? 'fallback-ceiling' : 'fallback-rate-limited' }
    : await deps.classifyIntent(text, {
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
  const observationHandled = await deps.handleObservationFlow(from, text, intent, deps.buildObservationDeps());
  if (observationHandled) return;

  // ── Observation history multi-turn flow (list + numbered selection) ────
  const observationHistoryHandled = await deps.handleObservationHistoryFlow(from, text, intent, deps.buildObservationDeps());
  if (observationHistoryHandled) return;

  // ── Reflection multi-turn flow ──────────────────────────────────────
  const reflectionHandled = await deps.handleReflectionFlow(from, text, intent, deps.buildReflectionDeps());
  if (reflectionHandled) return;

  // ── Growth plan multi-turn flow ─────────────────────────────────────
  const growthPlanHandled = await deps.handleGrowthPlanFlow(from, text, intent, deps.buildGrowthPlanDeps());
  if (growthPlanHandled) return;

  // ── Assessment session multi-turn flow (ADR-006) ────────────────────
  // Checked immediately after the observation flows and before every
  // other flow / general command classification, for the same reason
  // observation sessions are checked first: once a teacher is capturing
  // marks (or picking a Blueprint/Class), a bare number like "4" must be
  // treated as that session's input, not misrouted to another flow's
  // classifier guess.
  const assessmentSessionHandled = await deps.handleAssessmentSessionFlow(from, text, message, intent, deps.buildAssessmentSessionDeps());
  if (assessmentSessionHandled) return;

  // ── Blueprint authoring multi-turn flow (RC1-H-001) ─────────────────
  // Checked immediately after the assessment session flow, for the same
  // "bare replies must hit the active session, not a classifier guess"
  // reason — once a teacher is mid-way through NEW BLUEPRINT, a title,
  // a bare grade number, or a "<topic> | <marks>" line must be treated
  // as that session's input.
  const blueprintAuthoringHandled = await deps.handleBlueprintAuthoringFlow(from, text, message, intent, deps.buildBlueprintAuthoringDeps());
  if (blueprintAuthoringHandled) return;

  // ── Roster multi-turn flow (ADR-006 PR3) ────────────────────────────
  // Exact-command entry points (ROSTER/ADD LEARNER/etc.), checked right
  // after the assessment session flow for the same reason: once a roster
  // session is active, a bare reply like "REPLACE" or a pasted name list
  // is that session's input, not a new intent to classify.
  const rosterHandled = await deps.handleRosterFlow(from, text, message, intent, deps.buildRosterDeps());
  if (rosterHandled) return;

  // ── Report comment multi-turn flow ─────────────────────────────
  const reportCommentHandled = await deps.handleReportCommentFlow(from, text, intent, deps.buildReportCommentDeps());
  if (reportCommentHandled) return;

  // ── Profile update multi-turn flow ─────────────────────────────
  const profileUpdateHandled = await deps.handleProfileUpdateFlow(from, text, deps.buildProfileUpdateDeps());
  if (profileUpdateHandled) return;

  // ── Parent message multi-turn flow ───────────────────────────────
  const parentMessageHandled = await deps.handleParentMessageFlow(from, text, intent, deps.buildParentMessageDeps());
  if (parentMessageHandled) return;

  // ── Data-driven assessment multi-turn flow (Pro) ───────────────────────
  const dataAssessmentHandled = await deps.handleAssessmentFlow(from, text, message, intent, deps.buildAssessmentDeps());
  if (dataAssessmentHandled) return;

  // ── Assessment analysis multi-turn flow (Pro) ───────────────────────
  const assessmentAnalysisHandled = await deps.handleAssessmentAnalysisFlow(from, text, intent, deps.buildAssessmentAnalysisDeps());
  if (assessmentAnalysisHandled) return;

  // ── Curriculum intelligence query (instant, no quota) ────────────────
  const curriculumHandled = await deps.handleCurriculumQueryFlow(from, text, intent, deps.buildCurriculumQueryDeps());
  if (curriculumHandled) return;

  // ── Intervention plan / SBA support multi-turn flow (Pro) ───────────
  const interventionPlanHandled = await deps.handleInterventionPlanFlow(from, text, intent, deps.buildInterventionPlanDeps());
  if (interventionPlanHandled) return;

  // ── Conversational intents (GREETING, SMALL_TALK, EMOTIONAL_SUPPORT, THANKS, UNKNOWN) ─
  // These should NEVER consume quota, generate PDFs, or invoke content-generation workflows.
  // Replies are generated by Claude directly (reading what the teacher actually said),
  // not picked from a fixed template array. If the teacher is rate-limited (rapid burst)
  // we fall back silently to the templated response rather than showing a curt "please
  // wait" message — that would feel cold in the middle of a teacher venting or just
  // saying hello, and the templated fallback is still warm and instant.
  if (deps.isConversationalIntent(intent.type)) {
    const response = deps.isAiRateLimited(from)
      ? deps.generateConversationalResponse(intent.type, text)
      : await deps.generateConversationalReplyAI(intent.type, text);
    await deps.safeSendMessage(from, response);
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
  const noTopicNeeded = ['atp', 'mentalMaths', 'assessmentAnalysis', 'dataAssessment', 'interventionPlan', 'curriculumQuery', 'observation'];
  const moderationPackHasExistingAssessment = intent.type === 'moderationPack' && !!(deps.getTeacherByPhone(from)?.last_assessment_id);
  if (!noTopicNeeded.includes(intent.type) && !moderationPackHasExistingAssessment && (!intent.topic || intent.topic.length < 3)) {
    deps.pendingIntentState.set(phoneHash, {
      intent,
      lastActivity: Date.now(),
    });
    await deps.safeSendMessage(from, `What topic would you like me to focus on?\n\nFor example:\n• "fractions"\n• "photosynthesis"\n• "the water cycle"\n• "ancient Egypt"\n• "poetry analysis"\n\nPlease reply with the topic.`);
    return;
  }

  if (intent.type === 'assessmentAnalysis' || intent.type === 'interventionPlan' || intent.type === 'observation') {
    // Defensive fallback only — the dedicated flow handlers above should
    // always intercept these before we get here.
    await deps.safeSendMessage(from, `Let's set that up — could you say that again? (e.g. "assessment analysis for Grade 8 Maths", "intervention plan for struggling readers", or "record an observation")`);
    return;
  }

  // Process generation (deps.triggerGeneration persists last_intent internally)
  await deps.triggerGeneration({ from, intent, originalText: text, deps: deps.buildGenerationDeps() });
  return;
}

module.exports = { processMessage };
