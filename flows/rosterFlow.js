// flows/rosterFlow.js
// ADR-006 PR3 — WhatsApp roster management (ROSTER/ADD/REMOVE/CLEAR).
//
// Closes the gap left at the end of PR2.5: learnerRosterService could
// read and prefill a roster (see assessmentSessionFlow.js), but nothing
// let a teacher populate or maintain one from WhatsApp.
//
// This file owns conversation state, prompts, and persistence for five
// exact-command entry points — ROSTER, LIST ROSTER, ADD LEARNER <name>,
// REMOVE LEARNER <name>, CLEAR ROSTER — mirroring
// assessmentSessionFlow.js's SessionStore / CANCEL-from-anywhere
// conventions. The actual reads/writes live in
// services/learnerRosterService.js, which has no knowledge of
// WhatsApp/SessionStore/webhook.js and is unit-tested on its own.
//
// Class resolution follows the same 0/1/2+ rule as observationFlow.js /
// assessmentFlow.js (ADR-004, utils/classContext.js): auto-use the sole
// class, ask only when ambiguous (2+ classes). Unlike those two flows, a
// roster is *scoped* to a real class_id (learnerRosterService reads/
// writes WHERE class_id = ?, never NULL) — so zero classes is a hard
// stop here, not a "stay unclassed" fallback.
//
// Dependencies injected via buildRosterDeps() in webhook.js; no reverse
// dependency on webhook.js (matches assessmentSessionFlow.js /
// observationFlow.js / workspaceFlow.js).
//
// Not yet built (deliberately, per PR sequencing): bulk marks entry
// using roster order (PR4), corrections/undo (PR5).

const {
  getRoster,
  setRoster,
  addLearner,
  removeLearner,
  clearRoster,
  validateRosterNames,
  formatRosterList,
} = require('../services/learnerRosterService');

const STEP = {
  SELECT_CLASS: 'selectClass',
  CHOOSE_MODE: 'chooseMode',
  PASTE: 'paste',
  PREVIEW: 'preview',
  CONFIRM_CLEAR: 'confirmClear',
};

const ACTION = {
  ROSTER: 'roster',
  LIST: 'list',
  ADD: 'add',
  REMOVE: 'remove',
  CLEAR: 'clear',
};

function pastePrompt() {
  return 'Paste your list of learner names, one per line (numbering like "1. Name" is fine — it gets stripped). Send *CANCEL* to stop.';
}

function formatRosterSummary(roster, className) {
  if (roster.length === 0) {
    return `*${className}* has no roster yet. Send *ROSTER* to paste one in.`;
  }
  return `*${className}* roster (${roster.length} learner${roster.length === 1 ? '' : 's'}):\n\n${formatRosterList(roster)}`;
}

async function handleRosterFlow(from, text, message = null, preClassifiedIntent = null, deps) {
  const {
    hashPhone,
    safeSendMessage,
    rosterState, // SessionStore instance
    getTeacherClasses,
    formatClassSelectionPrompt,
    matchClassSelection,
  } = deps;

  const phoneHash = hashPhone(from);
  const trimmed = text.trim();
  const upper = trimmed.toUpperCase();

  const state = rosterState.get(phoneHash);

  // ── No session in progress: recognise entry commands ──────────────────
  if (!state) {
    const addMatch = trimmed.match(/^ADD LEARNER\s+(.+)$/i);
    const removeMatch = trimmed.match(/^REMOVE LEARNER\s+(.+)$/i);

    let action = null;
    let payload = null;

    if (upper === 'ROSTER') {
      action = ACTION.ROSTER;
    } else if (upper === 'LIST ROSTER') {
      action = ACTION.LIST;
    } else if (addMatch) {
      action = ACTION.ADD;
      payload = { name: addMatch[1].trim() };
    } else if (removeMatch) {
      action = ACTION.REMOVE;
      payload = { name: removeMatch[1].trim() };
    } else if (upper === 'CLEAR ROSTER') {
      action = ACTION.CLEAR;
    } else {
      return false; // not our concern — let normal routing continue
    }

    let classes = [];
    try {
      classes = getTeacherClasses(phoneHash);
    } catch (err) {
      console.error('[Roster] getTeacherClasses failed:', err.message);
      classes = [];
    }

    if (classes.length === 0) {
      await safeSendMessage(from,
        "You don't have any classes set up yet. Set up a class first, then you can manage its roster."
      );
      return true;
    }

    if (classes.length >= 2) {
      rosterState.set(phoneHash, {
        step: STEP.SELECT_CLASS,
        action,
        payload,
        pendingClasses: classes.map((c) => ({ id: c.id, name: c.name })),
        lastActivity: Date.now(),
      });
      await safeSendMessage(from, formatClassSelectionPrompt(
        classes.map((c) => ({ id: c.id, name: c.name }))
      ));
      return true;
    }

    // Exactly one class — no need to ask which one.
    return startAction(from, phoneHash, action, payload, classes[0], deps);
  }

  // ── A session is in progress: CANCEL works from any step ──────────────
  if (upper === 'CANCEL') {
    rosterState.delete(phoneHash);
    await safeSendMessage(from, 'Roster action cancelled. Nothing was changed.');
    return true;
  }

  // ── SELECT_CLASS ────────────────────────────────────────────────────
  if (state.step === STEP.SELECT_CLASS) {
    const matched = matchClassSelection(trimmed, state.pendingClasses || []);
    if (!matched) {
      await safeSendMessage(from,
        `Please reply with a number from 1 to ${(state.pendingClasses || []).length}, or *CANCEL* to stop.`
      );
      return true;
    }
    // Clear the class-selection session before dispatching — startAction
    // sets a fresh session of its own for actions that need one (ROSTER,
    // CLEAR on a non-empty roster); single-turn actions (LIST/ADD/REMOVE,
    // CLEAR on an already-empty roster) complete here and must not leave
    // this SELECT_CLASS state behind for the next message to misroute into.
    rosterState.delete(phoneHash);
    return startAction(from, phoneHash, state.action, state.payload, matched, deps);
  }

  // ── CHOOSE_MODE (ROSTER only, when the class already has a roster) ────
  if (state.step === STEP.CHOOSE_MODE) {
    if (upper === 'REPLACE' || upper === 'MERGE') {
      rosterState.set(phoneHash, {
        ...state,
        step: STEP.PASTE,
        mode: upper === 'REPLACE' ? 'replace' : 'merge',
        lastActivity: Date.now(),
      });
      await safeSendMessage(from, pastePrompt());
      return true;
    }
    await safeSendMessage(from,
      `*${state.className}* already has a roster. Reply *REPLACE* to start fresh with a new list, *MERGE* to add to the existing roster, or *CANCEL* to stop.`
    );
    return true;
  }

  // ── PASTE (ROSTER only) ────────────────────────────────────────────
  if (state.step === STEP.PASTE) {
    const { valid, names, errors } = validateRosterNames(trimmed);

    if (!valid) {
      const errorList = errors.map((e) => `Line ${e.line}: ${e.message}`).join('\n');
      await safeSendMessage(from,
        `That list has a few problems — nothing was saved:\n\n${errorList}\n\nFix and paste the full list again, or *CANCEL* to stop.`
      );
      return true; // no state change — PASTE rejects invalid pastes in place
    }

    rosterState.set(phoneHash, {
      ...state,
      step: STEP.PREVIEW,
      names,
      lastActivity: Date.now(),
    });

    const modeNote = state.mode === 'replace'
      ? `This will *replace* the existing roster for *${state.className}*.`
      : `This will be *added* to the roster for *${state.className}* (matching names are kept, not duplicated).`;

    await safeSendMessage(from,
      `${names.length} learner${names.length === 1 ? '' : 's'} parsed:\n\n${names.map((n, i) => `${i + 1}. ${n}`).join('\n')}\n\n${modeNote}\n\nReply *SAVE* to confirm, *EDIT* to paste again, or *CANCEL* to stop.`
    );
    return true;
  }

  // ── PREVIEW (ROSTER only) ──────────────────────────────────────────
  if (state.step === STEP.PREVIEW) {
    if (upper === 'EDIT') {
      rosterState.set(phoneHash, { ...state, step: STEP.PASTE, lastActivity: Date.now() });
      await safeSendMessage(from, pastePrompt());
      return true;
    }

    if (upper === 'SAVE') {
      const { roster, added, matched, removed } = setRoster(
        phoneHash, state.classId, state.names, { mode: state.mode }
      );
      rosterState.delete(phoneHash);

      const removedNote = state.mode === 'replace' ? `, ${removed} removed` : '';
      await safeSendMessage(from,
        `Roster saved for *${state.className}*. ${added} added, ${matched} matched${removedNote}.\n\n${formatRosterList(roster)}`
      );
      return true;
    }

    await safeSendMessage(from, 'Reply *SAVE* to confirm, *EDIT* to paste again, or *CANCEL* to stop.');
    return true;
  }

  // ── CONFIRM_CLEAR (CLEAR ROSTER only) ──────────────────────────────
  if (state.step === STEP.CONFIRM_CLEAR) {
    if (upper === 'YES') {
      const { clearedCount } = clearRoster(phoneHash, state.classId);
      rosterState.delete(phoneHash);
      await safeSendMessage(from,
        clearedCount > 0
          ? `Cleared *${state.className}*'s roster (${clearedCount} learner${clearedCount === 1 ? '' : 's'} removed). Past marks and observations for them are kept — they're just off the active roster now.`
          : `*${state.className}* had no roster to clear.`
      );
      return true;
    }
    if (upper === 'NO') {
      rosterState.delete(phoneHash);
      await safeSendMessage(from, 'Okay, roster left unchanged.');
      return true;
    }
    await safeSendMessage(from,
      `Clear the entire roster for *${state.className}*? Reply *YES* to confirm or *NO* to cancel.`
    );
    return true;
  }

  return false;
}

// Dispatches an already-resolved action against a single, known class —
// either because the teacher only has one class, or because they just
// answered a SELECT_CLASS prompt. Shared by both call sites so the 0/1/2+
// class resolution above doesn't need to duplicate per-action logic.
async function startAction(from, phoneHash, action, payload, chosenClass, deps) {
  const { safeSendMessage, rosterState } = deps;

  switch (action) {
    case ACTION.ROSTER: {
      const existing = getRoster(phoneHash, chosenClass.id);
      if (existing.length > 0) {
        rosterState.set(phoneHash, {
          step: STEP.CHOOSE_MODE,
          action,
          classId: chosenClass.id,
          className: chosenClass.name,
          lastActivity: Date.now(),
        });
        await safeSendMessage(from,
          `*${chosenClass.name}* already has a roster (${existing.length} learner${existing.length === 1 ? '' : 's'}). Reply *REPLACE* to start fresh with a new list, *MERGE* to add to the existing roster, or *CANCEL* to stop.`
        );
        return true;
      }

      rosterState.set(phoneHash, {
        step: STEP.PASTE,
        action,
        classId: chosenClass.id,
        className: chosenClass.name,
        mode: 'merge', // irrelevant with an empty starting roster
        lastActivity: Date.now(),
      });
      await safeSendMessage(from, `*${chosenClass.name}* — ${pastePrompt()}`);
      return true;
    }

    case ACTION.LIST: {
      const roster = getRoster(phoneHash, chosenClass.id);
      await safeSendMessage(from, formatRosterSummary(roster, chosenClass.name));
      return true;
    }

    case ACTION.ADD: {
      const { learner, alreadyOnRoster, rosterSize } = addLearner(phoneHash, chosenClass.id, payload.name);
      await safeSendMessage(from,
        alreadyOnRoster
          ? `*${learner.name}* is already on *${chosenClass.name}*'s roster (${rosterSize} learner${rosterSize === 1 ? '' : 's'}).`
          : `Added *${learner.name}* to *${chosenClass.name}*'s roster (${rosterSize} learner${rosterSize === 1 ? '' : 's'}).`
      );
      return true;
    }

    case ACTION.REMOVE: {
      const { removed, learner, rosterSize } = removeLearner(phoneHash, chosenClass.id, payload.name);
      await safeSendMessage(from,
        removed
          ? `Removed *${learner.name}* from *${chosenClass.name}*'s roster (${rosterSize} learner${rosterSize === 1 ? '' : 's'} left). Past marks and observations for them are kept.`
          : `Couldn't find *${payload.name}* on *${chosenClass.name}*'s current roster.`
      );
      return true;
    }

    case ACTION.CLEAR: {
      const existing = getRoster(phoneHash, chosenClass.id);
      if (existing.length === 0) {
        await safeSendMessage(from, `*${chosenClass.name}* has no roster to clear.`);
        return true;
      }
      rosterState.set(phoneHash, {
        step: STEP.CONFIRM_CLEAR,
        action,
        classId: chosenClass.id,
        className: chosenClass.name,
        lastActivity: Date.now(),
      });
      await safeSendMessage(from,
        `Clear the entire roster for *${chosenClass.name}* (${existing.length} learner${existing.length === 1 ? '' : 's'})? Reply *YES* to confirm or *NO* to cancel.`
      );
      return true;
    }

    default:
      return false;
  }
}

module.exports = { handleRosterFlow, STEP, ACTION };
