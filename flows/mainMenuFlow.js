// flows/mainMenuFlow.js
//
// Guided, numbered main-menu navigation for teachers who don't want to
// (or shouldn't have to) memorize commands. Built entirely on the
// existing NavigationService primitives already used by assessmentSession/
// reflection/growthPlan (openMenu / consumeNumericReply) — no new
// navigation mechanism is introduced.
//
// Design goal: this flow NEVER replaces free-text/command entry — a
// teacher who already knows "Grade 6 fractions worksheet" or "ROSTER"
// still gets exactly today's behavior. It only gives a menu-driven path
// alongside it, for teachers who don't know what to type.
//
// Dispatch-order note (read before moving this flow's position anywhere):
// This flow's own state (mainMenuState) must be checked in
// core/messageProcessor.js's alreadyMidFlow list and FLOW_STORES
// (routes/webhook.js) exactly like the other 13 multi-turn flows, and its
// id must be added to the activeFlowId chain that gates the speculative
// navigationService.evaluateMessage() call — otherwise a numeric reply to
// this flow's own menu can be double-consumed before this flow's handler
// ever sees it (this is exactly what RC1-H-007 fixed for the assessment
// completion menu, and RC1-H-013 fixed for reflection/growthPlan). See
// the wiring checklist at the bottom of this file.

'use strict';

const { openMenu, consumeNumericReply, closeMenu } = require('../services/navigationService');

// ── Menu definitions ────────────────────────────────────────────────────
// Each menu is a flat { '1': 'label', '2': 'label', ... } map, matching
// NavigationService.openMenu()'s existing contract exactly.

const MAIN_MENU_ID = 'mainMenu';
const MAIN_MENU_OPTIONS = {
  '1': 'Create a resource',
  '2': 'Submit & analyse marks',
  '3': 'Classroom observations',
  '4': 'Manage my classes',
  '5': 'Reflect & track my growth',
  '6': 'My progress & account',
  '7': 'Help — how this works',
};

const CREATE_MENU_ID = 'mainMenu.create';
const CREATE_MENU_OPTIONS = {
  '1': 'Worksheet',
  '2': 'Test (with memo)',
  '3': 'Lesson plan',
  '4': 'Annual Teaching Plan (ATP)',
  '5': 'Explain a topic',
  '0': 'Back to main menu',
};

const ASSESS_MENU_ID = 'mainMenu.assess';
const ASSESS_MENU_OPTIONS = {
  '1': 'Upload marks for analysis',
  '2': 'Start interactive mark capture (NEW TEST)',
  '3': 'Print a blueprint question paper',
  '4': 'Intervention plan for strugglers',
  '0': 'Back to main menu',
};

const OBSERVE_MENU_ID = 'mainMenu.observe';
const OBSERVE_MENU_OPTIONS = {
  '1': 'Start a classroom observation',
  '2': 'View my observation history',
  '0': 'Back to main menu',
};

const CLASSES_MENU_ID = 'mainMenu.classes';
const CLASSES_MENU_OPTIONS = {
  '1': 'View my classes',
  '2': 'Create a new class',
  '3': 'Manage a roster (add/remove learners)',
  '4': 'View a learner\u2019s progress',
  '0': 'Back to main menu',
};

const GROWTH_MENU_ID = 'mainMenu.growth';
const GROWTH_MENU_OPTIONS = {
  '1': 'Reflect on a lesson',
  '2': 'Set a new growth goal',
  '3': 'My coaching insights',
  '4': 'My past reflections',
  '0': 'Back to main menu',
};

const ACCOUNT_MENU_ID = 'mainMenu.account';
const ACCOUNT_MENU_OPTIONS = {
  '1': 'My progress (curriculum coverage)',
  '2': 'My assessment history',
  '3': 'My usage / plan status',
  '4': 'My profile',
  '0': 'Back to main menu',
};

// Maps each sub-menu id to its options, so the generic "show this menu"
// helper below doesn't need a big if/else at every call site.
const MENUS_BY_ID = {
  [MAIN_MENU_ID]: MAIN_MENU_OPTIONS,
  [CREATE_MENU_ID]: CREATE_MENU_OPTIONS,
  [ASSESS_MENU_ID]: ASSESS_MENU_OPTIONS,
  [OBSERVE_MENU_ID]: OBSERVE_MENU_OPTIONS,
  [CLASSES_MENU_ID]: CLASSES_MENU_OPTIONS,
  [GROWTH_MENU_ID]: GROWTH_MENU_OPTIONS,
  [ACCOUNT_MENU_ID]: ACCOUNT_MENU_OPTIONS,
};

function renderMenuText(menuId, name) {
  const options = MENUS_BY_ID[menuId];
  const lines = [];

  if (menuId === MAIN_MENU_ID) {
    lines.push(`\uD83D\uDC4B Hi ${name || 'there'}! What would you like to do?\n`);
  } else {
    lines.push(`${menuTitle(menuId)}\n`);
  }

  for (const [num, label] of Object.entries(options)) {
    const isBack = num === '0';
    lines.push(`${isBack ? '\u2B05\uFE0F' : numberEmoji(num)} ${label}`);
  }

  lines.push(`\nJust reply with a number.`);
  if (menuId === MAIN_MENU_ID) {
    lines.push(`_(You can also just type what you need, e.g. "Grade 6 fractions worksheet" — no need to use the menu at all.)_`);
  }
  return lines.join('\n');
}

function menuTitle(menuId) {
  switch (menuId) {
    case CREATE_MENU_ID: return '\uD83D\uDCDA What would you like to create?';
    case ASSESS_MENU_ID: return '\uD83D\uDCCA Submit & analyse marks';
    case OBSERVE_MENU_ID: return '\uD83D\uDC41\uFE0F Classroom observations';
    case CLASSES_MENU_ID: return '\uD83C\uDFEB Manage my classes';
    case GROWTH_MENU_ID: return '\uD83C\uDFAF Reflect & track my growth';
    case ACCOUNT_MENU_ID: return '\uD83D\uDC64 My progress & account';
    default: return 'Menu';
  }
}

function numberEmoji(n) {
  const map = { '1': '1\uFE0F\u20E3', '2': '2\uFE0F\u20E3', '3': '3\uFE0F\u20E3', '4': '4\uFE0F\u20E3', '5': '5\uFE0F\u20E3', '6': '6\uFE0F\u20E3', '7': '7\uFE0F\u20E3' };
  return map[n] || `${n}.`;
}

// ── Entry points ─────────────────────────────────────────────────────────
// A teacher can reach the main menu two ways, both handled identically:
//   1. Typing MENU/HELP/HI/HELLO (today's existing entry words)
//   2. Replying "0" from any sub-menu ("Back to main menu")

function isMainMenuTrigger(upper) {
  return upper === 'MENU' || upper === 'HELP' || upper === 'HI' || upper === 'HELLO';
}

/**
 * Opens the main menu and sends it. Does not touch onboarding/other-flow
 * state — the caller (commandHandler.js) is responsible for the existing
 * onboarding guards and clearAllSessions() call, exactly as today's
 * HELP/MENU branch already does.
 */
async function sendMainMenu(from, deps) {
  const phoneHash = deps.hashPhone(from);
  openMenu(phoneHash, { id: MAIN_MENU_ID, options: MAIN_MENU_OPTIONS, expiresAfterReply: false });
  const teacher = deps.getTeacherByPhone(from);
  await deps.safeSendMessage(from, renderMenuText(MAIN_MENU_ID, teacher?.name));
}

async function sendSubMenu(from, deps, menuId) {
  const phoneHash = deps.hashPhone(from);
  openMenu(phoneHash, { id: menuId, options: MENUS_BY_ID[menuId], expiresAfterReply: false });
  await deps.safeSendMessage(from, renderMenuText(menuId));
}

/**
 * Main dispatch entry, called from core/messageProcessor.js in the same
 * position as every other multi-turn flow (see wiring checklist below).
 * Returns true if this flow claimed and fully handled the message.
 *
 * @param {string} from
 * @param {string} text
 * @param {Object} deps - see buildMainMenuDeps() in routes/webhook.js
 */
async function handleMainMenuFlow(from, text, deps) {
  const phoneHash = deps.hashPhone(from);
  const upper = text.toUpperCase().trim();

  // Any global command (HOME/CANCEL/BACK/etc.) or a fresh MENU/HELP
  // request always wins over a currently-open menu — re-opening the main
  // menu is a legitimate way to bail out of a sub-menu without answering
  // it, same as every other flow's CANCEL/HOME handling.
  if (isMainMenuTrigger(upper)) {
    await sendMainMenu(from, deps);
    return true;
  }

  const attempt = consumeNumericReply(phoneHash, text);
  if (!attempt.matched) {
    // No menu of ours is open, or the reply wasn't a number this flow's
    // menu recognizes — not our concern; let normal dispatch continue.
    return false;
  }

  const { menuId, value } = attempt;

  // ── "Back to main menu" is universal across every sub-menu ───────────
  if (value === 'Back to main menu') {
    await sendMainMenu(from, deps);
    return true;
  }

  // ── Top-level menu selections ─────────────────────────────────────────
  if (menuId === MAIN_MENU_ID) {
    switch (value) {
      case 'Create a resource':
        await sendSubMenu(from, deps, CREATE_MENU_ID);
        return true;
      case 'Submit & analyse marks':
        await sendSubMenu(from, deps, ASSESS_MENU_ID);
        return true;
      case 'Classroom observations':
        await sendSubMenu(from, deps, OBSERVE_MENU_ID);
        return true;
      case 'Manage my classes':
        await sendSubMenu(from, deps, CLASSES_MENU_ID);
        return true;
      case 'Reflect & track my growth':
        await sendSubMenu(from, deps, GROWTH_MENU_ID);
        return true;
      case 'My progress & account':
        await sendSubMenu(from, deps, ACCOUNT_MENU_ID);
        return true;
      case 'Help \u2014 how this works':
        closeMenu(phoneHash);
        await deps.sendLegacyHelpText(from);
        return true;
      default:
        return false;
    }
  }

  // ── "Create a resource" sub-menu ──────────────────────────────────────
  // Reuses the exact existing mechanism the WORKSHEET/TEST/LESSONPLAN
  // commands and the "what topic?" clarifier already use
  // (deps.pendingIntentState + deps.triggerGeneration) rather than
  // inventing a second way to ask for grade/subject/topic.
  if (menuId === CREATE_MENU_ID) {
    const typeByLabel = {
      'Worksheet': 'worksheet',
      'Test (with memo)': 'test',
      'Lesson plan': 'lessonPlan',
      'Annual Teaching Plan (ATP)': 'atp',
      'Explain a topic': 'explanation',
    };
    const type = typeByLabel[value];
    if (!type) return false;

    closeMenu(phoneHash);
    const teacher = deps.getTeacherByPhone(from);
    const grade = teacher?.grade ?? null;
    const subject = teacher?.subject || null;

    if (type === 'atp') {
      // ATP never needs a topic (subject + grade is enough) — go straight
      // to generation, exactly like the existing ATP path.
      await deps.triggerGeneration({
        from,
        intent: { type, grade, subject, topic: null },
        deps: deps.buildGenerationDeps(),
      });
      return true;
    }

    deps.pendingIntentState.set(phoneHash, {
      intent: { type, grade, subject, topic: null },
      lastActivity: Date.now(),
    });
    await deps.safeSendMessage(from,
      `Great \u2014 what topic should it cover? (e.g. "fractions", "the water cycle", "poetry analysis")` +
      (grade == null || !subject
        ? `\n\n_Tip: reply *UPDATE* afterwards to save your grade/subject as defaults so I don\u2019t have to ask next time._`
        : '')
    );
    return true;
  }

  // ── "Submit & analyse marks" sub-menu ──────────────────────────────────
  if (menuId === ASSESS_MENU_ID) {
    closeMenu(phoneHash);
    switch (value) {
      case 'Upload marks for analysis':
        await deps.safeSendMessage(from, `Sure \u2014 send me the mark sheet (type it, or attach a photo, CSV or Excel file) and I\u2019ll take it from there.`);
        return true;
      case 'Start interactive mark capture (NEW TEST)':
        await deps.reDispatchAsText(from, 'NEW TEST');
        return true;
      case 'Print a blueprint question paper':
        await deps.reDispatchAsText(from, 'PRINT');
        return true;
      case 'Intervention plan for strugglers':
        await deps.safeSendMessage(from, `Tell me a bit more \u2014 e.g. "intervention plan for my Grade 7 Maths strugglers".`);
        return true;
      default:
        return false;
    }
  }

  // ── "Classroom observations" sub-menu ──────────────────────────────────
  if (menuId === OBSERVE_MENU_ID) {
    closeMenu(phoneHash);
    switch (value) {
      case 'Start a classroom observation':
        await deps.reDispatchAsText(from, 'Observe my class');
        return true;
      case 'View my observation history':
        await deps.reDispatchAsText(from, 'MY OBSERVATIONS');
        return true;
      default:
        return false;
    }
  }

  // ── "Manage my classes" sub-menu ────────────────────────────────────────
  if (menuId === CLASSES_MENU_ID) {
    closeMenu(phoneHash);
    switch (value) {
      case 'View my classes':
        await deps.reDispatchAsText(from, 'MY CLASSES');
        return true;
      case 'Create a new class':
        await deps.safeSendMessage(from, `Sure \u2014 what\u2019s the class? Reply like: *NEW CLASS Grade 6A Mathematics | 32* (name | number of learners).`);
        return true;
      case 'Manage a roster (add/remove learners)':
        await deps.reDispatchAsText(from, 'ROSTER');
        return true;
      case 'View a learner\u2019s progress':
        await deps.safeSendMessage(from, `Which learner? Reply like: *LEARNER PROGRESS Thabo Mokoena*.`);
        return true;
      default:
        return false;
    }
  }

  // ── "Reflect & track my growth" sub-menu ────────────────────────────────
  if (menuId === GROWTH_MENU_ID) {
    closeMenu(phoneHash);
    switch (value) {
      case 'Reflect on a lesson':
        await deps.reDispatchAsText(from, 'REFLECT');
        return true;
      case 'Set a new growth goal':
        await deps.reDispatchAsText(from, 'NEW GOAL');
        return true;
      case 'My coaching insights':
        await deps.reDispatchAsText(from, 'MY COACHING');
        return true;
      case 'My past reflections':
        await deps.reDispatchAsText(from, 'MY REFLECTIONS');
        return true;
      default:
        return false;
    }
  }

  // ── "My progress & account" sub-menu ────────────────────────────────────
  if (menuId === ACCOUNT_MENU_ID) {
    closeMenu(phoneHash);
    switch (value) {
      case 'My progress (curriculum coverage)':
        await deps.reDispatchAsText(from, 'MY PROGRESS');
        return true;
      case 'My assessment history':
        await deps.reDispatchAsText(from, 'MY ASSESSMENTS');
        return true;
      case 'My usage / plan status':
        await deps.reDispatchAsText(from, 'STATUS');
        return true;
      case 'My profile':
        await deps.reDispatchAsText(from, 'PROFILE');
        return true;
      default:
        return false;
    }
  }

  return false;
}

module.exports = {
  handleMainMenuFlow,
  sendMainMenu,
  isMainMenuTrigger,
  MAIN_MENU_ID,
};

// ── Wiring checklist (apply in routes/webhook.js and core/messageProcessor.js) ──
//
// This flow is deliberately menu-only (no SessionStore of its own) — an
// open NavigationService menu IS its entire session state, already
// persisted the same way assessmentSession's completion menu is. That
// means it does NOT need a new entry in FLOW_STORES / alreadyMidFlow /
// activeFlowId in the same way the 13 stateful flows do, BUT it still
// needs three specific wiring changes, in this order:
//
// 1. routes/webhook.js — build its deps object:
//
//      function buildMainMenuDeps() {
//        return Object.freeze({
//          hashPhone,
//          getTeacherByPhone,
//          safeSendMessage,
//          pendingIntentState,
//          triggerGeneration,
//          buildGenerationDeps,
//          sendLegacyHelpText: sendLegacyHelpTextImpl, // see item 3 below
//          // reDispatchAsText re-enters processMessage() with synthetic
//          // text, so every existing command/flow keeps being the single
//          // source of truth for its own behavior — this flow never
//          // duplicates that logic.
//          reDispatchAsText: (from, text) =>
//            require('../core/messageProcessor').processMessage(
//              { from, id: `mainmenu-redispatch-${Date.now()}`, type: 'text', text: { body: text } },
//              buildProcessMessageDeps()
//            ),
//        });
//      }
//
//    Add `buildMainMenuDeps` and `handleMainMenuFlow` to the object
//    buildProcessMessageDeps() returns, exactly like every other flow's
//    build*Deps()/handle*Flow pair.
//
// 2. core/commandHandler.js — replace the existing HELP/MENU/HI/HELLO
//    branch's message-send with a call to sendMainMenu() instead of the
//    long text block, keeping every onboarding guard and the existing
//    clearAllSessions() call completely untouched:
//
//      // (all existing onboarding-guard code above stays exactly as-is)
//      deps.clearAllSessions(from);
//      const { sendMainMenu } = require('../flows/mainMenuFlow');
//      await sendMainMenu(from, deps.buildMainMenuDeps());
//      return true;
//
//    Move the CURRENT long help text (the "1. CREATE A RESOURCE..." block)
//    into a small sendLegacyHelpText(from) helper alongside it, so the new
//    menu's "Help \u2014 how this works" option can still show the classic
//    reference text for teachers who want the full command list.
//
// 3. core/messageProcessor.js — check this flow EARLY, before the
//    classifier and before any command that could plausibly collide with
//    a bare digit reply (mirroring exactly how assessmentSession/roster
//    are checked first for the same "a bare number must hit the open
//    menu, not a classifier guess" reason — see the comments already
//    above the observation/assessmentSession checks in that file):
//
//      const mainMenuHandled = await deps.handleMainMenuFlow(from, text, deps.buildMainMenuDeps());
//      if (mainMenuHandled) return;
//
//    Place this call immediately after the existing `handleCommand()`
//    check (line ~106) and BEFORE the onboarding check — a teacher
//    replying to an open main-menu numeric prompt should never be
//    re-routed into onboarding. Do NOT place it inside the
//    `alreadyMidFlow` block; this flow does not use that mechanism (see
//    the note above), and its own consumeNumericReply() call already
//    only fires when one of ITS menus is genuinely open.
//
// TESTING NOTE (do this before merging, given this codebase's history):
// RC1-H-004/006/007/008/010/012 were all real production defects caused
// by exactly this shape of change — a new global check intercepting a
// message meant for something else. Before merging, write a real-dispatch
// test (processMessage() end-to-end, not calling handleMainMenuFlow()
// directly) covering at minimum: (a) a bare "1" with NO menu open does
// NOT get swallowed here and still reaches the existing numeric-menu
// collision guard / classifier as today; (b) a numeric reply while
// genuinely mid another flow (e.g. assessmentSessionState active) is
// NOT intercepted by this flow's consumeNumericReply() call — confirm
// this is naturally true because openMenu() for a DIFFERENT menu id was
// never called for that phone, but write the regression test anyway,
// since that is exactly the kind of assumption RC1-H-007 disproved; and
// (c) MENU sent while genuinely mid another multi-turn flow still clears
// that flow via clearAllSessions() as it does today.
