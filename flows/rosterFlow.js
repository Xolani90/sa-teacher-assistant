// flows/rosterFlow.js
// ADR-006 PR3 — WhatsApp Roster Management.
//
// learnerRosterService (PR2.5/PR3) can read, add, remove, and reconcile a
// class roster, but until this flow nothing lets a teacher populate one
// from WhatsApp. Once a roster exists, assessmentSessionFlow.js already
// prefills marks capture from it (getClassRoster) — teachers stop typing
// every learner's name at the start of every single test.
//
// Commands (all case-insensitive, matched on the exact command text —
// this flow does not go through the AI intent classifier, same as
// assessmentSessionFlow's NEW TEST/RESUME/CANCEL/STATUS):
//   ROSTER          - paste/replace a class's full roster
//   LIST ROSTER      - view a class's current roster
//   ADD LEARNER      - add one learner to a class
//   REMOVE LEARNER   - remove one learner from a class
//   CLEAR ROSTER      - remove every learner from a class
//
// State machine (steps below are all reachable from any top-level command;
// CANCEL/STATUS work mid-flow the same way assessmentSessionFlow's do):
//
//   ROSTER / CLEAR ROSTER / ADD LEARNER / REMOVE LEARNER / LIST ROSTER
//     -> CHOOSE_CLASS (skipped if the teacher has exactly one class)
//     -> ROSTER: has an existing roster? -> CHOOSE_MODE (REPLACE/MERGE/CANCEL)
//                                        -> PASTE -> PREVIEW -> (save)
//     -> LIST ROSTER: -> shows roster, offers ADD/REMOVE/REPLACE follow-ups
//     -> ADD LEARNER: -> ENTER_NAME -> (save)
//     -> REMOVE LEARNER: -> CHOOSE_LEARNER -> CONFIRM_REMOVE -> (save)
//     -> CLEAR ROSTER: -> CONFIRM_CLEAR -> (save)
//
// Validation is strict, not lenient: a pasted list with a blank line or a
// duplicate name is rejected with the exact line number, not silently
// cleaned — see learnerRosterService.validateRosterNames()'s doc comment
// for why (a silently-dropped name quietly shifts every mark entered
// afterwards onto the wrong learner).
//
// Dependencies injected via buildRosterDeps() in webhook.js; no reverse
// dependency on webhook.js (matches assessmentSessionFlow.js).

const {
  getRoster,
  setRoster,
  addLearner,
  removeLearner,
  clearRoster,
  splitRosterLines,
  validateRosterNames,
  formatRosterList,
} = require('../services/learnerRosterService');

const STEP = {
  CHOOSE_CLASS: 'chooseClass',
  CHOOSE_MODE: 'chooseMode',
  PASTE: 'paste',
  PREVIEW: 'preview',
  LIST: 'list',
  ENTER_NAME: 'enterName',
  CHOOSE_LEARNER: 'chooseLearner',
  CONFIRM_REMOVE: 'confirmRemove',
  CONFIRM_CLEAR: 'confirmClear',
};

const ACTION = {
  ROSTER: 'roster',
  LIST: 'list',
  ADD: 'add',
  REMOVE: 'remove',
  CLEAR: 'clear',
};

const TOP_LEVEL_COMMANDS = {
  ROSTER: ACTION.ROSTER,
  'LIST ROSTER': ACTION.LIST,
  'ADD LEARNER': ACTION.ADD,
  'REMOVE LEARNER': ACTION.REMOVE,
  'CLEAR ROSTER': ACTION.CLEAR,
};

function formatClassList(classes) {
  return classes
    .map((c, i) => `${i + 1}. ${c.name} (Grade ${c.grade}, ${c.subject}) — ${c.learner_count} learner${c.learner_count === 1 ? '' : 's'}`)
    .join('\n');
}

function parseListSelection(text, listLength) {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = parseInt(trimmed, 10);
  if (n < 1 || n > listLength) return null;
  return n - 1;
}

function pasteInstructions(className) {
  return `Paste the learner names for *${className}*, one per line, e.g.:\n\nSipho Dlamini\nAyanda Molefe\nNaledi Mokoena\n\nReply *CANCEL* to stop.`;
}

// Kicks a chosen action off, either straight into its first real step (if
// the teacher only has one class, there's nothing to choose) or into
// CHOOSE_CLASS. Shared by the top-level command entry point and by
// LIST ROSTER's ADD/REMOVE/REPLACE follow-up prompts.
async function beginAction(from, action, deps) {
  const { hashPhone, safeSendMessage, rosterState, getTeacherClasses } = deps;
  const phoneHash = hashPhone(from);
  const classes = getTeacherClasses(phoneHash);

  if (classes.length === 0) {
    rosterState.delete(phoneHash);
    await safeSendMessage(from, "You don't have any classes set up yet. Set up a class first, then try again.");
    return;
  }

  if (classes.length === 1) {
    await enterClass(from, action, classes[0], deps);
    return;
  }

  rosterState.set(phoneHash, { step: STEP.CHOOSE_CLASS, action, classes, lastActivity: Date.now() });
  await safeSendMessage(from, `Choose a Class:\n\n${formatClassList(classes)}\n\nReply with a number.`);
}

// Once a class is known (either the teacher's only class, or their
// CHOOSE_CLASS reply), route to the right first real step for `action`.
async function enterClass(from, action, chosenClass, deps) {
  const { hashPhone, safeSendMessage, rosterState } = deps;
  const phoneHash = hashPhone(from);

  if (action === ACTION.ROSTER) {
    const existing = getRoster(phoneHash, chosenClass.id);
    if (existing.length > 0) {
      rosterState.set(phoneHash, { step: STEP.CHOOSE_MODE, action, classId: chosenClass.id, className: chosenClass.name, existingCount: existing.length, lastActivity: Date.now() });
      await safeSendMessage(from,
        `*${chosenClass.name}* already has ${existing.length} learner${existing.length === 1 ? '' : 's'}.\n\nReply:\n*REPLACE* — start this class's roster over from the new list\n*MERGE* — add the new names, keep everyone already there\n*CANCEL* — stop`
      );
      return;
    }
    rosterState.set(phoneHash, { step: STEP.PASTE, action, mode: 'merge', classId: chosenClass.id, className: chosenClass.name, lastActivity: Date.now() });
    await safeSendMessage(from, pasteInstructions(chosenClass.name));
    return;
  }

  if (action === ACTION.LIST) {
    await showList(from, chosenClass, deps);
    return;
  }

  if (action === ACTION.ADD) {
    rosterState.set(phoneHash, { step: STEP.ENTER_NAME, action, classId: chosenClass.id, className: chosenClass.name, lastActivity: Date.now() });
    await safeSendMessage(from, `Enter the learner's name to add to *${chosenClass.name}*:\n\nReply *CANCEL* to stop.`);
    return;
  }

  if (action === ACTION.REMOVE) {
    const roster = getRoster(phoneHash, chosenClass.id);
    if (roster.length === 0) {
      rosterState.delete(phoneHash);
      await safeSendMessage(from, `*${chosenClass.name}* has no learners on its roster yet.`);
      return;
    }
    rosterState.set(phoneHash, { step: STEP.CHOOSE_LEARNER, action, classId: chosenClass.id, className: chosenClass.name, roster, lastActivity: Date.now() });
    await safeSendMessage(from, `${formatRosterList(roster)}\n\nReply with a number to remove that learner, or *CANCEL* to stop.`);
    return;
  }

  if (action === ACTION.CLEAR) {
    const roster = getRoster(phoneHash, chosenClass.id);
    if (roster.length === 0) {
      rosterState.delete(phoneHash);
      await safeSendMessage(from, `*${chosenClass.name}* has no learners on its roster yet.`);
      return;
    }
    rosterState.set(phoneHash, { step: STEP.CONFIRM_CLEAR, action, classId: chosenClass.id, className: chosenClass.name, count: roster.length, lastActivity: Date.now() });
    await safeSendMessage(from, `Remove all ${roster.length} learners from *${chosenClass.name}*'s roster? This can't be undone from WhatsApp.\n\nReply *YES* or *NO*.`);
  }
}

async function showList(from, chosenClass, deps) {
  const { hashPhone, safeSendMessage, rosterState } = deps;
  const phoneHash = hashPhone(from);
  const roster = getRoster(phoneHash, chosenClass.id);

  if (roster.length === 0) {
    rosterState.delete(phoneHash);
    await safeSendMessage(from, `*${chosenClass.name}* has no learners on its roster yet. Send *ROSTER* to add some.`);
    return;
  }

  rosterState.set(phoneHash, { step: STEP.LIST, action: ACTION.LIST, classId: chosenClass.id, className: chosenClass.name, lastActivity: Date.now() });
  await safeSendMessage(from,
    `*${chosenClass.name}*\n\n${formatRosterList(roster)}\n\n${roster.length} learner${roster.length === 1 ? '' : 's'}\n\nReply:\n*ADD* — add a learner\n*REMOVE* — remove a learner\n*REPLACE* — paste a new full list`
  );
}

async function handleRosterFlow(from, text, message = null, preClassifiedIntent = null, deps) {
  const { hashPhone, safeSendMessage, rosterState, getTeacherClasses } = deps;
  const phoneHash = hashPhone(from);
  const trimmed = text.trim();
  const upper = trimmed.toUpperCase();

  let state = rosterState.get(phoneHash);

  // ── No session in progress: only a top-level command starts one ───────
  if (!state) {
    const action = TOP_LEVEL_COMMANDS[upper];
    if (!action) return false; // not our concern — let normal routing continue
    await beginAction(from, action, deps);
    return true;
  }

  // ── A session is in progress: CANCEL works from any step ──────────────
  if (upper === 'CANCEL') {
    rosterState.delete(phoneHash);
    await safeSendMessage(from, 'Roster update cancelled. Nothing was changed.');
    return true;
  }

  // A fresh top-level command while mid-flow restarts cleanly rather than
  // colliding with whatever step is in progress.
  if (TOP_LEVEL_COMMANDS[upper] && state.step !== STEP.PASTE) {
    await beginAction(from, TOP_LEVEL_COMMANDS[upper], deps);
    return true;
  }

  // ── CHOOSE_CLASS ────────────────────────────────────────────────────
  if (state.step === STEP.CHOOSE_CLASS) {
    const idx = parseListSelection(trimmed, state.classes.length);
    if (idx === null) {
      await safeSendMessage(from, `Please reply with a number from 1 to ${state.classes.length}, or *CANCEL* to stop.`);
      return true;
    }
    await enterClass(from, state.action, state.classes[idx], deps);
    return true;
  }

  // ── CHOOSE_MODE (ROSTER, class already has learners) ───────────────
  if (state.step === STEP.CHOOSE_MODE) {
    if (upper === 'REPLACE' || upper === 'MERGE') {
      rosterState.set(phoneHash, { ...state, step: STEP.PASTE, mode: upper.toLowerCase(), lastActivity: Date.now() });
      await safeSendMessage(from, pasteInstructions(state.className));
      return true;
    }
    await safeSendMessage(from, 'Reply *REPLACE*, *MERGE*, or *CANCEL*.');
    return true;
  }

  // ── PASTE ───────────────────────────────────────────────────────────
  if (state.step === STEP.PASTE) {
    const lines = splitRosterLines(trimmed);
    const { valid, errors, names } = validateRosterNames(lines);

    if (!valid) {
      await safeSendMessage(from,
        `That list has some issues — nothing was saved:\n\n${errors.join('\n')}\n\nFix the paste and send it again, or reply *CANCEL* to stop.`
      );
      return true;
    }

    rosterState.set(phoneHash, { ...state, step: STEP.PREVIEW, names, lastActivity: Date.now() });
    await safeSendMessage(from,
      `${names.length} learner${names.length === 1 ? '' : 's'}:\n\n${names.map((n, i) => `${i + 1}. ${n}`).join('\n')}\n\nReply *SAVE* to confirm, or *CANCEL* to stop.`
    );
    return true;
  }

  // ── PREVIEW ─────────────────────────────────────────────────────────
  if (state.step === STEP.PREVIEW) {
    if (upper !== 'SAVE') {
      await safeSendMessage(from, 'Reply *SAVE* to confirm, or *CANCEL* to stop.');
      return true;
    }

    const { roster, added, matched, removed } = setRoster(phoneHash, state.classId, state.names, { mode: state.mode });
    rosterState.delete(phoneHash);

    const removedNote = removed > 0 ? `\n${removed} removed (left off the new list)` : '';
    await safeSendMessage(from,
      `Roster saved for *${state.className}*.\n\n${added} added, ${matched} already there${removedNote}\n\n${roster.length} learner${roster.length === 1 ? '' : 's'} total.`
    );
    return true;
  }

  // ── LIST (follow-up: ADD/REMOVE/REPLACE) ───────────────────────────
  if (state.step === STEP.LIST) {
    const classes = getTeacherClasses(phoneHash);
    const chosenClass = classes.find((c) => c.id === state.classId) || { id: state.classId, name: state.className };

    if (upper === 'ADD') {
      await enterClass(from, ACTION.ADD, chosenClass, deps);
      return true;
    }
    if (upper === 'REMOVE') {
      await enterClass(from, ACTION.REMOVE, chosenClass, deps);
      return true;
    }
    if (upper === 'REPLACE') {
      await enterClass(from, ACTION.ROSTER, chosenClass, deps);
      return true;
    }
    await safeSendMessage(from, 'Reply *ADD*, *REMOVE*, *REPLACE*, or *CANCEL*.');
    return true;
  }

  // ── ENTER_NAME (ADD LEARNER) ────────────────────────────────────────
  if (state.step === STEP.ENTER_NAME) {
    if (trimmed.length < 2) {
      await safeSendMessage(from, 'That name looks too short. Enter the learner\'s name, or *CANCEL* to stop.');
      return true;
    }

    const { learner, wasNew, roster } = addLearner(phoneHash, state.classId, trimmed);
    rosterState.delete(phoneHash);

    await safeSendMessage(from,
      wasNew
        ? `Added:\n\n${learner.name}\n\n*${state.className}* now has ${roster.length} learner${roster.length === 1 ? '' : 's'}.`
        : `${learner.name} is already on *${state.className}*'s roster — nothing added.`
    );
    return true;
  }

  // ── CHOOSE_LEARNER (REMOVE LEARNER) ─────────────────────────────────
  if (state.step === STEP.CHOOSE_LEARNER) {
    const idx = parseListSelection(trimmed, state.roster.length);
    if (idx === null) {
      await safeSendMessage(from, `Please reply with a number from 1 to ${state.roster.length}, or *CANCEL* to stop.`);
      return true;
    }
    const target = state.roster[idx];
    rosterState.set(phoneHash, { ...state, step: STEP.CONFIRM_REMOVE, targetId: target.id, targetName: target.name, lastActivity: Date.now() });
    await safeSendMessage(from, `Remove ${target.name} from *${state.className}*?\n\nReply *YES* or *NO*.`);
    return true;
  }

  // ── CONFIRM_REMOVE ──────────────────────────────────────────────────
  if (state.step === STEP.CONFIRM_REMOVE) {
    if (upper === 'NO') {
      rosterState.delete(phoneHash);
      await safeSendMessage(from, 'No changes made.');
      return true;
    }
    if (upper !== 'YES') {
      await safeSendMessage(from, 'Reply *YES* or *NO*.');
      return true;
    }

    const { roster, removed: didRemove } = removeLearner(phoneHash, state.classId, state.targetId);
    rosterState.delete(phoneHash);

    await safeSendMessage(from,
      didRemove
        ? `Removed ${state.targetName}.\n\n*${state.className}* now has ${roster.length} learner${roster.length === 1 ? '' : 's'}.`
        : `${state.targetName} was already off the roster — nothing changed.`
    );
    return true;
  }

  // ── CONFIRM_CLEAR ────────────────────────────────────────────────────
  if (state.step === STEP.CONFIRM_CLEAR) {
    if (upper === 'NO') {
      rosterState.delete(phoneHash);
      await safeSendMessage(from, 'No changes made.');
      return true;
    }
    if (upper !== 'YES') {
      await safeSendMessage(from, 'Reply *YES* or *NO*.');
      return true;
    }

    const { removed } = clearRoster(phoneHash, state.classId);
    rosterState.delete(phoneHash);

    await safeSendMessage(from, `Cleared ${removed} learner${removed === 1 ? '' : 's'} from *${state.className}*'s roster.`);
    return true;
  }

  return false;
}

module.exports = { handleRosterFlow, STEP, ACTION, TOP_LEVEL_COMMANDS };
