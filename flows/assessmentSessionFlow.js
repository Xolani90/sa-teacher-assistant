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
  formatCapturePrompt,
  formatStatus,
  toLearnerResults,
} = require('../services/assessmentCaptureService');

const STEP = {
  SELECT_BLUEPRINT: 'selectBlueprint',
  SELECT_CLASS: 'selectClass',
  ACTIVE: 'active',
};

function formatBlueprintList(blueprints) {
  return blueprints
    .map((b, i) => `${i + 1}. ${b.title} (Grade ${b.grade}, ${b.subject}) — ${b.question_count} question${b.question_count === 1 ? '' : 's'}`)
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

async function handleAssessmentSessionFlow(from, text, message = null, preClassifiedIntent = null, deps) {
  const {
    hashPhone,
    safeSendMessage,
    assessmentSessionState, // SessionStore instance
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
      await safeSendMessage(from,
        "No active assessment session found. Send *NEW TEST* to start one."
      );
      return true;
    }

    return false; // not our concern — let normal routing continue
  }

  // ── A session is in progress: CANCEL and STATUS work from any step ────
  if (upper === 'CANCEL') {
    assessmentSessionState.delete(phoneHash);
    await safeSendMessage(from, 'Assessment session cancelled. No marks were saved.');
    return true;
  }

  if (upper === 'STATUS') {
    await safeSendMessage(from, describeStatus(state));
    return true;
  }

  // NEW TEST while a session is already active — don't silently clobber it.
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

    // ADR-006 PR2.5: if this class has a saved roster, capture is
    // prefilled from it (no roster -> falls back to PR2's ask-every-name
    // behaviour, unchanged). getClassRoster is optional in deps so this
    // stays backward compatible with any caller not yet passing it.
    const roster = typeof getClassRoster === 'function'
      ? getClassRoster(phoneHash, chosenClass.id)
      : [];

    const activeState = initCapture({
      blueprint,
      classId: chosenClass.id,
      className: chosenClass.name,
      learnerCount: chosenClass.learner_count,
      roster,
    });

    assessmentSessionState.set(phoneHash, activeState);

    const rosterNote = roster.length > 0
      ? `\nRoster: *${roster.length} learner${roster.length === 1 ? '' : 's'} loaded* — names will be prefilled.`
      : '';

    await safeSendMessage(from,
      `Assessment created.\n\nBlueprint: *${state.blueprintTitle}*\nClass: *${chosenClass.name}*\nLearners: *${chosenClass.learner_count}*${rosterNote}\n\n${formatCapturePrompt(activeState)}`
    );
    return true;
  }

  // ── ACTIVE - marks capture (ADR-006 PR2 interactive, PR4 bulk paste) ──
  if (state.step === STEP.ACTIVE) {
    const isBulk = looksLikeBulkPaste(trimmed);
    const result = isBulk
      ? submitBulkReply(state, trimmed, { parseMarks })
      : submitReply(state, trimmed);

    if (!result.ok) {
      await safeSendMessage(from, result.error);
      return true;
    }

    // Bulk paste only: tell the teacher about anything that needed their
    // attention (skipped learners, warnings) before moving on. A clean
    // paste with nothing skipped stays silent — see formatBulkResultNotice.
    const bulkNotice = isBulk ? formatBulkResultNotice(result.result) : '';

    if (isComplete(result.state)) {
      assessmentSessionState.delete(phoneHash);

      const completionPrefix = bulkNotice ? `${bulkNotice}\n\n` : '';
      await safeSendMessage(from,
        `${completionPrefix}Capture complete.\n\n${result.state.learnerCount} learners\n${result.state.questions.length} questions\n\nGenerating assessment...`
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
      });

      if (diagnostic.error) {
        await safeSendMessage(from,
          `Marks were captured, but I couldn't finish generating the report: ${diagnostic.error}`
        );
        return true;
      }

      await safeSendMessage(from, diagnostic.teacherSummary);
      return true;
    }

    assessmentSessionState.set(phoneHash, result.state);
    const prompt = formatCapturePrompt(result.state);
    await safeSendMessage(from, bulkNotice ? `${bulkNotice}\n\n${prompt}` : prompt);
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
    default:
      return '';
  }
}

module.exports = { handleAssessmentSessionFlow, STEP };
