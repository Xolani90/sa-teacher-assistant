// flows/assessmentSessionFlow.js
// ADR-006 — Assessment Session Engine.
//
// State machine:
//   (no session) -> SELECT_BLUEPRINT -> SELECT_CLASS -> ACTIVE_SESSION
//
// PR1 scope: get the SELECT_BLUEPRINT/SELECT_CLASS state machine right,
// persisted via the same SessionStore (SQLite-backed) used by every other
// multi-turn flow, so a session survives process restarts / Render deploys
// exactly like the existing report-comment / parent-message /
// data-assessment flows do.
//
// PR2 scope (this file's ACTIVE-step handling): marks capture itself.
// This file owns conversation state, prompts, and persistence only — the
// actual state-machine transitions (name -> per-question marks ->
// next learner -> completion) and their validation live in
// services/assessmentCaptureService.js, which has no knowledge of
// WhatsApp/SessionStore/the DB and is trivial to unit-test on its own.
// Nothing is written to learner_results until the LAST learner's LAST
// question is answered — see assessmentCaptureService.js's module doc for
// why (crash/abandon recovery: SessionStore autosaves the in-progress
// marks after every turn, but the DB stays untouched until completion).
//
// Command note: the ADR-006 design doc used STOP/RESUME for pause/resume.
// STOP is already a *global*, WhatsApp-compliance opt-out command (see
// handleCommand() in webhook.js — it unsubscribes the teacher and clears
// every session). Reusing it here would silently opt a teacher out of the
// whole service the moment they meant to pause a test. This flow does not
// define a separate pause command at all: SessionStore already persists
// state after every turn, so there is nothing to explicitly "pause" —
// a teacher can simply stop replying and pick up again later with RESUME,
// which just re-renders whatever prompt they left off on.
//
// Dependencies injected via buildAssessmentSessionDeps() in webhook.js;
// no reverse dependency on webhook.js (matches assessmentFlow.js /
// observationFlow.js / workspaceFlow.js).

const {
  initCapture,
  isComplete,
  submitReply,
  submitBulkReply,
  submitEdit,
  submitUndo,
  formatCapturePrompt,
  formatStatus,
  toLearnerResults,
} = require('../services/assessmentCaptureService');

// ADR-019 Step 3, Commit 3b: STATUS and CANCEL now delegate to
// NavigationService rather than this flow owning that logic inline.
// Ownership migration only — see the CANCEL/STATUS branches below for
// why handleCancel() is deliberately NOT used (it always attaches a
// YES-confirmation prompt, which would be a behavioural change, not a
// migration). getFlowDefinition() + resolveStatusOwner() carry no such
// policy, so they're the pieces that fit this commit's scope.
const navigationService = require('../services/navigationService');

const STEP = {
  SELECT_BLUEPRINT: 'selectBlueprint',
  SELECT_CLASS: 'selectClass',
  ACTIVE: 'active',
  // ADR-005B: a lightweight, single-purpose sub-flow for printing a blank
  // blueprint question paper. Deliberately NOT reused with SELECT_BLUEPRINT
  // above — that step always continues into SELECT_CLASS/ACTIVE capture,
  // and conflating the two would mean a wrong keypress after "PRINT" could
  // accidentally start (and silently abandon) a real marks-capture session.
  SELECT_PRINT_BLUEPRINT: 'selectPrintBlueprint',
  // ADR-019 Step 3, Commit 5 part 2: once marks capture completes, the
  // session isn't deleted outright anymore — it moves here so the teacher
  // can immediately act on a scoped NavigationService menu (NEW_ASSESSMENT
  // / PRINT) instead of having to remember/retype a command from a blank
  // slate. Scope note: this menu only offers actions assessmentSessionFlow
  // itself owns. CLASS_INTERVENTION/LEARNER_PROGRESS belong to
  // workspaceFlow.js and are deliberately NOT offered here — cross-flow
  // menu dispatch has no designed mechanism yet and is deferred to a
  // future ADR-019 commit once there's a second real consumer to design
  // it against.
  COMPLETE_MENU: 'completeMenu',
};

// ADR-019 Step 3, Commit 5 part 2 — the post-completion menu. Registered
// with NavigationService (capabilities.menus / FlowDefinition.menus in
// webhook.js) purely for documentation/discoverability; the numeric
// dispatch itself is handled locally below via consumeNumericReply(),
// matching how CANCEL/STATUS already delegate ownership without this flow
// calling evaluateMessage() wholesale (see Commit 3b comment above).
const COMPLETE_MENU_ID = 'assessmentSession.complete';
const COMPLETE_MENU_OPTIONS = { '1': 'NEW_ASSESSMENT', '2': 'PRINT' };

function formatCompleteMenu() {
  return 'What would you like to do next?\n\n1. Start a new assessment\n2. Print a blueprint question paper';
}

function formatBlueprintList(blueprints) {
  return blueprints
    .map((b, i) => `${i + 1}. ${b.title} (Grade ${b.grade}, ${b.subject}) — ${b.questionCount} question${b.questionCount === 1 ? '' : 's'}`)
    .join('\n');
}

function formatClassList(classes) {
  return classes
    .map((c, i) => `${i + 1}. ${c.name} (Grade ${c.grade}, ${c.subject}) — ${c.learner_count} learner${c.learner_count === 1 ? '' : 's'}`)
    .join('\n');
}

// Parses a plain numeric reply ("2") into a 0-based list index, or null if
// the reply isn't a bare number or is out of range. Kept deliberately
// strict — no fuzzy matching — since picking the wrong blueprint or class
// here silently mis-targets an entire assessment session downstream.
function parseListSelection(text, listLength) {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = parseInt(trimmed, 10);
  if (n < 1 || n > listLength) return null;
  return n - 1;
}

// ADR-006 PR4 Phase 3: a conservative first-pass detector for bulk-pasted
// marks vs. a single interactive reply (a name, or one mark). A bare
// multi-line reply is virtually never a valid single-field answer, so
// newline presence is a safe, cheap signal. Expand this (CSV, comma lists,
// etc.) without touching the dispatch logic below if that's ever needed.
function looksLikeBulkPaste(text) {
  return text.includes('\n');
}

// Builds a short "what happened" summary for a bulk paste that had
// skipped learners and/or warnings, per the "only speak up if something
// needs attention" rule — a clean bulk paste gets no extra noise.
function formatBulkResultNotice(result) {
  if (!result) return '';

  const parts = [];

  if (result.skipped && result.skipped.length > 0) {
    const lines = result.skipped.map((s) => `• ${s.learnerName} — ${s.reason}`);
    parts.push(`⚠️ ${result.skipped.length} learner${result.skipped.length === 1 ? '' : 's'} skipped:\n${lines.join('\n')}`);
  }

  if (result.warnings && result.warnings.length > 0) {
    parts.push(`⚠️ Warnings:\n${result.warnings.map((w) => `• ${w}`).join('\n')}`);
  }

  if (parts.length === 0) return '';

  return `✅ Applied marks for ${result.appliedCount} learner${result.appliedCount === 1 ? '' : 's'}.\n\n${parts.join('\n\n')}`;
}

// RC1: a bulk paste where every line was rejected (submitBulkReply's
// accepted.length === 0 branch) previously showed only the generic
// "No learners could be captured..." message and silently dropped the
// specific per-learner reasons that adaptParsedMarks() already computed —
// leaving the teacher with no way to tell what was actually wrong with
// their paste. This surfaces those reasons alongside the generic error.
function formatBulkFailureDetail(genericError, result) {
  if (!result || !result.skipped || result.skipped.length === 0) {
    return genericError;
  }

  const lines = result.skipped.map((s) => `• ${s.learnerName} — ${s.reason}`);
  return `${genericError}\n\n${lines.join('\n')}`;
}

/**
 * Generates and sends the blueprint assessment analytics PDF once marks
 * capture completes and processAssessmentData() has stored the assessment.
 * Internal helper — not part of the flow's public entry point, but
 * exported for direct testing since it has its own failure path.
 *
 * PDF generation is best-effort: if it fails, the teacher still has the
 * text summary already sent by the caller, so this only sends a follow-up
 * apology rather than blocking or reversing anything already delivered.
 *
 * @param {string} from
 * @param {number} assessmentId
 * @param {object} deps
 */
async function generateAndSendBlueprintPdf(from, assessmentId, deps) {
  const {
    generateBlueprintAssessmentPdf,
    buildPdfUrl,
    sendDocument,
    safeSendMessage,
  } = deps;

  try {
    const { fileId, filename, error } = await generateBlueprintAssessmentPdf(assessmentId);
    if (error) {
      console.error('[ASSESSMENT_SESSION_FLOW] Blueprint PDF generation returned an error:', error);
      await safeSendMessage(from, `⚠️ Marks were saved, but the analytics PDF couldn't be generated: ${error}`);
      return;
    }
    const pdfUrl = buildPdfUrl(fileId);
    await sendDocument(from, pdfUrl, filename, `📊 *Assessment report ready!*\n\nClass performance, topic breakdown, and per-learner detail are in the PDF above.`);
  } catch (pdfErr) {
    console.error('[ASSESSMENT_SESSION_FLOW] Blueprint PDF generation failed:', pdfErr.message);
    await safeSendMessage(from, `⚠️ Marks were saved, but we couldn't generate the analytics PDF. You can still view the summary above.`);
  }
}

/**
 * ADR-005B: generates and sends the printable blank blueprint question
 * paper (as opposed to generateAndSendBlueprintPdf() above, which sends
 * the after-the-fact analytics report once marks are captured). This is
 * a single-turn action — no marks capture, no assessment row, nothing to
 * commit — so failure just means "tell the teacher and let them retry",
 * with no state to roll back.
 */
async function generateAndSendPrintablePaper(from, blueprintId, deps) {
  const {
    generateBlueprintPaperPdf,
    buildPdfUrl,
    sendDocument,
    safeSendMessage,
  } = deps;

  try {
    const { fileId, filename, error } = await generateBlueprintPaperPdf(blueprintId);
    if (error) {
      await safeSendMessage(from, `⚠️ Couldn't generate the printable paper: ${error}`);
      return;
    }
    const pdfUrl = buildPdfUrl(fileId);
    await sendDocument(from, pdfUrl, filename, `🖨️ *Printable question paper ready!*\n\nHand this to learners, then capture their marks with *NEW TEST*.`);
  } catch (pdfErr) {
    console.error('[ASSESSMENT_SESSION_FLOW] Blueprint paper PDF generation failed:', pdfErr.message);
    await safeSendMessage(from, `⚠️ Couldn't generate the printable paper right now. Please try again.`);
  }
}

async function handleAssessmentSessionFlow(from, text, message = null, preClassifiedIntent = null, deps) {
  const {
    hashPhone,
    safeSendMessage,
    assessmentSessionState, // SessionStore instance
    blueprintAuthoringState, // RC1-H-004 follow-up: see STATUS/RESUME guard below
    listBlueprints,
    getTeacherClasses,
    getBlueprintById,
    processAssessmentData,
    getClassRoster, // ADR-006 PR2.5: prefills learner names from the saved roster, if any
    parseMarks, // ADR-006 PR4 Phase 3: bulk-paste capture via submitBulkReply()
  } = deps;

  const phoneHash = hashPhone(from);
  const trimmed = text.trim();
  const upper = trimmed.toUpperCase();

  let state = assessmentSessionState.get(phoneHash);

  // ── No session in progress ────────────────────────────────────────────
  if (!state) {
    if (upper === 'NEW TEST') {
      const blueprints = listBlueprints(phoneHash, { status: 'published' });
      if (blueprints.length === 0) {
        await safeSendMessage(from,
          "You don't have any published Assessment Blueprints yet. Create and publish one first, then send *NEW TEST* to start a session."
        );
        return true;
      }

      assessmentSessionState.set(phoneHash, {
        step: STEP.SELECT_BLUEPRINT,
        blueprints,
        lastActivity: Date.now(),
      });

      await safeSendMessage(from,
        `📝 *New Assessment Session*\n\nChoose a Blueprint:\n\n${formatBlueprintList(blueprints)}\n\nReply with a number.`
      );
      return true;
    }

    if (upper === 'RESUME' || upper === 'STATUS') {
      // RC1-H-004 follow-up: this flow has no assessment session of its
      // own, but another flow (blueprintAuthoring) may genuinely own an
      // active session for this phone right now — don't answer on its
      // behalf. Returning false here lets messageProcessor's dispatch
      // order continue on to blueprintAuthoringFlow, which has its own
      // correct STATUS handling. Only claim STATUS/RESUME as "nothing
      // active anywhere" once we've confirmed that.
      if (blueprintAuthoringState?.get(phoneHash)) {
        return false;
      }
      await safeSendMessage(from,
        "No active assessment session found. Send *NEW TEST* to start one."
      );
      return true;
    }

    // ADR-005B: PRINT lists published blueprints and, on selection,
    // generates a blank question paper — a separate, single-turn action
    // from NEW TEST's capture session (see STEP.SELECT_PRINT_BLUEPRINT doc).
    if (upper === 'PRINT') {
      const blueprints = listBlueprints(phoneHash, { status: 'published' });
      if (blueprints.length === 0) {
        await safeSendMessage(from,
          "You don't have any published Assessment Blueprints yet. Create and publish one first, then send *PRINT* to get a printable question paper."
        );
        return true;
      }

      assessmentSessionState.set(phoneHash, {
        step: STEP.SELECT_PRINT_BLUEPRINT,
        blueprints,
        lastActivity: Date.now(),
      });

      await safeSendMessage(from,
        `🖨️ *Print a Question Paper*\n\nChoose a Blueprint:\n\n${formatBlueprintList(blueprints)}\n\nReply with a number.`
      );
      return true;
    }

    return false; // not our concern — let normal routing continue
  }

  // ── A session is in progress: CANCEL and STATUS work from any step ────
  //
  // ADR-019 Commit 3b: both branches now route through NavigationService
  // rather than this flow inlining its own state-clearing / status-
  // rendering. Deliberately NOT using navigationService.handleCancel() —
  // it always returns a YES-confirmation prompt, and today's CANCEL is
  // immediate. Adopting that prompt here would be a UX change smuggled
  // into an ownership migration, which Commit 3b explicitly rules out.
  // getFlowDefinition() exposes the same hooks.cleanup already registered
  // in Commit 3, so this is genuinely NavigationService-owned cleanup —
  // just without borrowing handleCancel()'s confirmation policy.
  if (upper === 'CANCEL') {
    // ADR-019 Recommendation 2 (Strict registration): mirrors growthPlan's
    // unguarded access. A missing FlowDefinition here is a programmer
    // error (wiring gap), not a runtime condition to tolerate silently.
    navigationService.getFlowDefinition('assessmentSession').hooks.cleanup(phoneHash);
    await safeSendMessage(from, 'Assessment session cancelled. No marks were saved.');
    return true;
  }

  if (upper === 'STATUS') {
    const owner = navigationService.resolveStatusOwner('assessmentSession');
    const message = owner.owner === 'flow'
      ? navigationService.getFlowDefinition('assessmentSession').hooks.describeStatus(phoneHash)
      : describeStatus(state);
    await safeSendMessage(from, message);
    return true;
  }

  // NEW TEST while a session is already active — don't silently clobber it.
  // A session sitting at COMPLETE_MENU is the one exception: nothing is
  // actually "in progress" there anymore (capture already finished), so
  // typing NEW TEST/PRINT directly should behave exactly like picking the
  // matching menu digit, not get told to CANCEL something that's already
  // done.
  if (upper === 'NEW TEST' || upper === 'PRINT') {
    if (state.step === STEP.COMPLETE_MENU) {
      navigationService.closeMenu(phoneHash);
      assessmentSessionState.delete(phoneHash);
      return handleAssessmentSessionFlow(from, upper, message, preClassifiedIntent, deps);
    }
  }

  if (upper === 'NEW TEST') {
    await safeSendMessage(from,
      `You already have an assessment session in progress.\n\n${describeStatus(state)}\n\nSend *CANCEL* first if you want to abandon it and start a new one.`
    );
    return true;
  }

  // RESUME just re-renders the current prompt — SessionStore has already
  // kept the state, so there's nothing to "restore" beyond that.
  if (upper === 'RESUME') {
    await safeSendMessage(from, describeStatus(state) + '\n\n' + currentPrompt(state));
    return true;
  }

  // ── SELECT_BLUEPRINT ────────────────────────────────────────────────
  if (state.step === STEP.SELECT_BLUEPRINT) {
    const idx = parseListSelection(trimmed, state.blueprints.length);
    if (idx === null) {
      await safeSendMessage(from,
        `Please reply with a number from 1 to ${state.blueprints.length}, or *CANCEL* to stop.`
      );
      return true;
    }

    const chosenBlueprint = state.blueprints[idx];
    const classes = getTeacherClasses(phoneHash);
    if (classes.length === 0) {
      assessmentSessionState.delete(phoneHash);
      await safeSendMessage(from,
        "You don't have any classes set up yet. Set up a class first, then send *NEW TEST* to start a session."
      );
      return true;
    }

    assessmentSessionState.set(phoneHash, {
      step: STEP.SELECT_CLASS,
      blueprintId: chosenBlueprint.id,
      blueprintTitle: chosenBlueprint.title,
      blueprintTotalMarks: chosenBlueprint.total_marks,
      classes,
      lastActivity: Date.now(),
    });

    await safeSendMessage(from,
      `Blueprint: *${chosenBlueprint.title}*\n\nChoose a Class:\n\n${formatClassList(classes)}\n\nReply with a number.`
    );
    return true;
  }

  // ── SELECT_PRINT_BLUEPRINT (ADR-005B) ─────────────────────────────────
  if (state.step === STEP.SELECT_PRINT_BLUEPRINT) {
    const idx = parseListSelection(trimmed, state.blueprints.length);
    if (idx === null) {
      await safeSendMessage(from,
        `Please reply with a number from 1 to ${state.blueprints.length}, or *CANCEL* to stop.`
      );
      return true;
    }

    const chosenBlueprint = state.blueprints[idx];
    // Single-turn action: clear the session before generating, since
    // there is no further capture state to track either way.
    assessmentSessionState.delete(phoneHash);
    await generateAndSendPrintablePaper(from, chosenBlueprint.id, deps);
    return true;
  }

  // ── SELECT_CLASS ────────────────────────────────────────────────────
  if (state.step === STEP.SELECT_CLASS) {
    const idx = parseListSelection(trimmed, state.classes.length);
    if (idx === null) {
      await safeSendMessage(from,
        `Please reply with a number from 1 to ${state.classes.length}, or *CANCEL* to stop.`
      );
      return true;
    }

    const chosenClass = state.classes[idx];

    const blueprint = getBlueprintById(state.blueprintId);
    if (!blueprint) {
      assessmentSessionState.delete(phoneHash);
      await safeSendMessage(from,
        "That Blueprint could not be loaded - it may have been deleted. Send *NEW TEST* to start again."
      );
      return true;
    }

    // getBlueprintById() intentionally returns a blueprint in ANY status
    // (draft/published/archived) — that's correct for read/history access
    // (see blueprintRepository.js#archiveBlueprint's docstring), but this
    // call site is starting a brand-new capture session, not reading one.
    // listBlueprints(phoneHash, { status: 'published' }) already filtered
    // SELECT_BLUEPRINT's options to published-only, but SessionStore
    // persists this session across turns (and process restarts/days —
    // see this file's own header comment on RESUME), so the blueprint can
    // legitimately be archived (e.g. via the Dashboard, in a separate
    // session) in the gap between picking it here and reaching this step.
    // Without this re-check, capture would proceed and persist
    // learner_results against an archived blueprint_id — directly
    // contradicting archiveBlueprint()'s documented invariant that
    // archiving "prevents further versions/instances being created from
    // it going forward."
    if (blueprint.status !== 'published') {
      assessmentSessionState.delete(phoneHash);
      await safeSendMessage(from,
        `*${blueprint.title}* is no longer available to start a new test from (it's been archived). Send *NEW TEST* to pick a different Blueprint.`
      );
      return true;
    }

    // ADR-006 PR2.5: if this class has a saved roster, capture is
    // prefilled from it (no roster -> falls back to PR2's ask-every-name
    // behaviour, unchanged). getClassRoster is optional in deps so this
    // stays backward compatible with any caller not yet passing it.
    const roster = typeof getClassRoster === 'function'
      ? getClassRoster(phoneHash, chosenClass.id)
      : [];

    // RC1-D1-003: chosenClass.learner_count is a cache and can drift
    // behind the live active roster (see services/learnerRosterService.js's
    // syncLearnerCount()/getActiveRosterCounts()). Using it alone here
    // silently truncated capture to the stale count, dropping real,
    // actively-rostered learners. roster.length alone isn't safe either:
    // initCapture()'s own contract allows learnerCount to legitimately
    // exceed the roster (roster prefills some learners, the rest are asked
    // for by name). The correct population is never smaller than the live
    // roster but may be larger — hence Math.max, not a straight substitution.
    const effectiveLearnerCount = Math.max(chosenClass.learner_count, roster.length);

    const activeState = initCapture({
      blueprint,
      classId: chosenClass.id,
      className: chosenClass.name,
      learnerCount: effectiveLearnerCount,
      roster,
    });

    assessmentSessionState.set(phoneHash, activeState);

    const rosterNote = roster.length > 0
      ? `\nRoster: *${roster.length} learner${roster.length === 1 ? '' : 's'} loaded* — names will be prefilled.`
      : '';

    await safeSendMessage(from,
      `Assessment created.\n\nBlueprint: *${state.blueprintTitle}*\nClass: *${chosenClass.name}*\nLearners: *${effectiveLearnerCount}*${rosterNote}\n\n${formatCapturePrompt(activeState)}`
    );
    return true;
  }

  // ── ACTIVE - marks capture (ADR-006 PR2 interactive, PR4 bulk paste) ──
  if (state.step === STEP.ACTIVE) {
    // ADR-006 PR5 Phase 1a: UNDO/BACK. Checked first, before the
    // bulk/interactive branch, so it can never be mistaken for a learner
    // name or a mark value (e.g. during the NAME step).
    if (upper === 'UNDO' || upper === 'BACK') {
      const undoResult = submitUndo(state);
      if (!undoResult.ok) {
        await safeSendMessage(from, undoResult.error);
        return true;
      }

      assessmentSessionState.set(phoneHash, undoResult.state);
      await safeSendMessage(from, `↩️ Undone.\n\n${formatCapturePrompt(undoResult.state)}`);
      return true;
    }

    // ADR-006 PR5 Phase 1b: EDIT <learner> — jump back to a
    // already-captured learner to re-enter their marks. Checked before
    // the bulk/interactive branch for the same reason as UNDO/BACK: it
    // must never be mistaken for a learner name or a mark value.
    if (upper.startsWith('EDIT ') || upper === 'EDIT') {
      const query = trimmed.slice(4).trim(); // preserve original case for error messages
      const editResult = submitEdit(state, query);
      if (!editResult.ok) {
        await safeSendMessage(from, editResult.error);
        return true;
      }

      assessmentSessionState.set(phoneHash, editResult.state);
      await safeSendMessage(from, formatCapturePrompt(editResult.state));
      return true;
    }

    const isBulk = looksLikeBulkPaste(trimmed);
    const result = isBulk
      ? submitBulkReply(state, trimmed, { parseMarks })
      : submitReply(state, trimmed);

    if (!result.ok) {
      const detail = isBulk
        ? formatBulkFailureDetail(result.error, result.result)
        : result.error;
      await safeSendMessage(from, detail);
      return true;
    }

    // Bulk paste only: tell the teacher about anything that needed their
    // attention (skipped learners, warnings) before moving on. A clean
    // paste with nothing skipped stays silent — see formatBulkResultNotice.
    const bulkNotice = isBulk ? formatBulkResultNotice(result.result) : '';

    if (isComplete(result.state)) {
      // ADR-019 Commit 5 part 2: the session moves to COMPLETE_MENU rather
      // than being deleted, and the completion menu opens immediately —
      // before PDF generation — so the options are live from the moment
      // the teacher sees the completion message, not after a follow-up
      // PDF send. The menu is included in this same message.
      assessmentSessionState.set(phoneHash, { step: STEP.COMPLETE_MENU, lastActivity: Date.now() });
      navigationService.openMenu(phoneHash, { id: COMPLETE_MENU_ID, options: COMPLETE_MENU_OPTIONS });

      const completionPrefix = bulkNotice ? `${bulkNotice}\n\n` : '';
      await safeSendMessage(from,
        `${completionPrefix}Capture complete.\n\n${result.state.learnerCount} learner${result.state.learnerCount === 1 ? '' : 's'}\n${result.state.questions.length} question${result.state.questions.length === 1 ? '' : 's'}\n\nGenerating assessment...\n\n${formatCompleteMenu()}`
      );

      const diagnostic = await processAssessmentData(phoneHash, {
        title: result.state.blueprintTitle,
        grade: result.state.grade,
        subject: result.state.subject,
        term: result.state.term,
        type: 'test',
        totalMarks: result.state.blueprintTotalMarks,
        blueprintId: result.state.blueprintId,
        blueprintVersion: result.state.blueprintVersion,
        classId: result.state.classId,
        learnerResults: toLearnerResults(result.state),
        // Phase 6 fix: mirror flows/assessmentFlow.js's (legacy CSV/photo
        // flow) atpTopics wiring. Without this, storeAssessment() always
        // persisted atp_topics: '[]' for blueprint-based captures, and
        // updateCoverageFromAssessment() silently marked zero topics
        // covered — even though each blueprint question carries a
        // CAPS-registry-validated topic (validated at publish time).
        atpTopics: [...new Set((result.state.questions || []).map((q) => q.topic).filter(Boolean))],
      });

      if (diagnostic.error) {
        await safeSendMessage(from,
          `Marks were captured, but I couldn't finish generating the report: ${diagnostic.error}`
        );
        return true;
      }

      await safeSendMessage(from, diagnostic.teacherSummary);
      await generateAndSendBlueprintPdf(from, diagnostic.assessmentId, deps);
      return true;
    }

    assessmentSessionState.set(phoneHash, result.state);
    const prompt = formatCapturePrompt(result.state);
    await safeSendMessage(from, bulkNotice ? `${bulkNotice}\n\n${prompt}` : prompt);
    return true;
  }

  // ── COMPLETE_MENU (ADR-019 Commit 5 part 2) ────────────────────────────
  // Only a valid numeric selection against the still-open NavigationService
  // menu is acted on. Anything else (an invalid digit, free text, a
  // replayed digit after the menu's already been consumed) just re-renders
  // the menu — it never falls through to the ACTIVE-step marks parsing,
  // since there's no capture in progress here to misinterpret it as.
  if (state.step === STEP.COMPLETE_MENU) {
    const consumed = navigationService.consumeNumericReply(phoneHash, trimmed);
    if (consumed.matched) {
      assessmentSessionState.delete(phoneHash);
      if (consumed.value === 'NEW_ASSESSMENT') {
        return handleAssessmentSessionFlow(from, 'NEW TEST', message, preClassifiedIntent, deps);
      }
      if (consumed.value === 'PRINT') {
        return handleAssessmentSessionFlow(from, 'PRINT', message, preClassifiedIntent, deps);
      }
    }

    // Re-open the menu on an invalid/expired reply so a mistyped digit
    // doesn't strand the teacher with no way back in.
    navigationService.openMenu(phoneHash, { id: COMPLETE_MENU_ID, options: COMPLETE_MENU_OPTIONS });
    await safeSendMessage(from, formatCompleteMenu());
    return true;
  }

  return false;
}

function describeStatus(state) {
  switch (state.step) {
    case STEP.SELECT_BLUEPRINT:
      return `Session status: choosing a Blueprint.\n\n${formatBlueprintList(state.blueprints)}`;
    case STEP.SELECT_CLASS:
      return `Session status: Blueprint *${state.blueprintTitle}* selected. Choosing a Class.\n\n${formatClassList(state.classes)}`;
    case STEP.ACTIVE:
      return formatStatus(state);
    case STEP.SELECT_PRINT_BLUEPRINT:
      return `Session status: choosing a Blueprint to print.\n\n${formatBlueprintList(state.blueprints)}`;
    case STEP.COMPLETE_MENU:
      return `Session status: assessment complete.\n\n${formatCompleteMenu()}`;
    default:
      return 'Session status: unknown.';
  }
}

function currentPrompt(state) {
  switch (state.step) {
    case STEP.SELECT_BLUEPRINT:
      return 'Reply with a number to choose a Blueprint.';
    case STEP.SELECT_CLASS:
      return 'Reply with a number to choose a Class.';
    case STEP.ACTIVE:
      return formatCapturePrompt(state);
    case STEP.SELECT_PRINT_BLUEPRINT:
      return 'Reply with a number to choose which Blueprint to print.';
    case STEP.COMPLETE_MENU:
      return formatCompleteMenu();
    default:
      return '';
  }
}

module.exports = {
  handleAssessmentSessionFlow,
  generateAndSendBlueprintPdf,
  generateAndSendPrintablePaper,
  STEP,
  describeStatus,
  COMPLETE_MENU_ID,
  COMPLETE_MENU_OPTIONS,
};
