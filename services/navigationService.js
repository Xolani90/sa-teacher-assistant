// services/navigationService.js
// ADR-019: Unified Conversational Navigation Framework — Step 2 of the
// ADR's "Next Steps": the navigation layer itself, landed as new, additive
// infrastructure. Nothing in this file is wired into webhook.js,
// messageProcessor.js, or any existing flow yet — that happens in the
// follow-up PR that migrates assessmentSessionFlow.js (Next Step 3).
//
// Owns:
//   - FlowDefinition registration (§1)
//   - the fixed five-step message-evaluation order (§2), exposed as
//     evaluateMessage() for the future router to call
//   - scoped session.menu objects with an explicit lifecycle (§3)
//   - the numeric-collision rule (§4)
//   - auto-rendered HELP (§5)
//   - the global, inert MENU command (§6)
//   - HOME / BACK / CANCEL (§8)
//
// Contextual menus (§7) are just callers of openMenu() — no separate API.

'use strict';

const { SessionStore } = require('../utils/sessionStore');

// Menus are short-lived decision points, not long-running sessions — a
// generous but bounded TTL keeps `session.menu` from lingering past the
// point a teacher plausibly still means to answer it.
const MENU_TTL_MS = 15 * 60 * 1000;
const menuStore = new SessionStore('navigationMenu', MENU_TTL_MS);

const GLOBAL_COMMANDS = ['HOME', 'MENU', 'HELP', 'CANCEL', 'BACK'];

// §1 — Flow registry. Flows call registerFlow() once at module load with a
// declarative FlowDefinition instead of embedding navigation logic.
const registry = new Map();

/**
 * @typedef {Object} FlowDefinition
 * @property {string} id
 * @property {string[]} [commands]        - e.g. ["UNDO", "STATUS", "EDIT", "CANCEL"]
 * @property {boolean} [supportsCancel]   - opt into centrally-handled CANCEL
 * @property {boolean} [supportsBack]     - opt into centrally-handled BACK
 * @property {Object.<string, string[]>} [menus] - named menu templates the
 *   flow can open, keyed by menu id, each an ordered list of option labels
 */

/**
 * Registers a flow's navigation metadata. Idempotent — re-registering the
 * same id overwrites the previous definition, so a flow module can be
 * required multiple times (as happens under test) without erroring.
 *
 * @param {FlowDefinition} definition
 */
function registerFlow(definition) {
  if (!definition || !definition.id) {
    throw new Error('[NAV] registerFlow requires a definition with an id');
  }
  registry.set(definition.id, {
    id: definition.id,
    commands: definition.commands || [],
    supportsCancel: Boolean(definition.supportsCancel),
    supportsBack: Boolean(definition.supportsBack),
    menus: definition.menus || {},
  });
}

function getFlowDefinition(flowId) {
  return registry.get(flowId) || null;
}

// ── §3/§4 — Scoped menus ─────────────────────────────────────────────────

/**
 * Opens a scoped menu for a teacher. Only the currently open menu may
 * consume a bare numeric reply (§4). Opening a new menu replaces any
 * previously open one — menus are never stacked.
 *
 * @param {string} phoneHash
 * @param {{id: string, options: Object.<string,string>, expiresAfterReply?: boolean}} menu
 */
function openMenu(phoneHash, menu) {
  if (!menu || !menu.id || !menu.options || typeof menu.options !== 'object') {
    throw new Error('[NAV] openMenu requires { id, options }');
  }
  menuStore.set(phoneHash, {
    id: menu.id,
    options: menu.options,
    expiresAfterReply: menu.expiresAfterReply !== false,
    lastActivity: Date.now(),
    state: 'awaiting_reply',
  });
}

function getOpenMenu(phoneHash) {
  const menu = menuStore.get(phoneHash);
  if (!menu || menu.state !== 'awaiting_reply') return null;
  return menu;
}

function closeMenu(phoneHash) {
  menuStore.delete(phoneHash);
}

/**
 * §4 — The numeric collision rule. A bare numeric reply is only ever
 * legal while a scoped menu is open; consuming it here destroys the menu
 * (consumed → destroyed) so a duplicate/retried digit can't double-fire.
 *
 * @returns {{matched: true, menuId: string, value: string} |
 *           {matched: false, reason: 'no_menu_open'|'not_numeric'|'unknown_option'}}
 */
function consumeNumericReply(phoneHash, text) {
  const trimmed = String(text || '').trim();
  if (!/^\d+$/.test(trimmed)) {
    return { matched: false, reason: 'not_numeric' };
  }

  const menu = getOpenMenu(phoneHash);
  if (!menu) {
    return { matched: false, reason: 'no_menu_open' };
  }

  const value = menu.options[trimmed];
  if (!value) {
    return { matched: false, reason: 'unknown_option' };
  }

  if (menu.expiresAfterReply) {
    closeMenu(phoneHash);
  }
  return { matched: true, menuId: menu.id, value };
}

const NO_MENU_OPEN_REPLY =
  "I don't currently have a numbered menu open. Reply MENU to see available options.";

// ── §5 — Auto-rendered HELP ─────────────────────────────────────────────

/**
 * Renders the HELP listing for a flow purely from its registered metadata.
 * Flows never format their own help text once migrated onto this layer.
 */
function renderHelp(flowId) {
  const def = getFlowDefinition(flowId);
  const flowCommands = def ? def.commands : [];
  const globalOnly = GLOBAL_COMMANDS.filter(
    (c) => !flowCommands.includes(c) && (c !== 'CANCEL' || !def?.supportsCancel) && (c !== 'BACK' || !def?.supportsBack)
  );

  const lines = ['*Available commands*'];
  if (flowCommands.length) {
    lines.push(flowCommands.join(', '));
  }
  const globalLine = ['HOME', 'MENU', 'HELP']
    .concat(def?.supportsCancel ? ['CANCEL'] : [])
    .concat(def?.supportsBack ? ['BACK'] : [])
    .filter((c) => !flowCommands.includes(c));
  lines.push(globalLine.join(', '));

  return lines.join('\n');
}

// ── §8 — HOME / BACK / CANCEL ────────────────────────────────────────────

/**
 * HOME clears workflow, menu, and any temporary prompt state, returning
 * the teacher to the root screen. Callers pass the state stores that
 * should be cleared (the navigation layer doesn't know every flow's Map).
 */
function handleHome(phoneHash, { extraStores = [] } = {}) {
  closeMenu(phoneHash);
  extraStores.forEach((store) => store.delete(phoneHash));
  return "You're back at the main menu. Reply MENU to see what I can do.";
}

/**
 * BACK only affects navigation, never data, and only works if the active
 * flow declared supportsBack for the current step.
 */
function handleBack(flowId) {
  const def = getFlowDefinition(flowId);
  if (!def || !def.supportsBack) {
    return { handled: false, message: "BACK isn't available here." };
  }
  return { handled: true };
}

/**
 * CANCEL confirmation copy, centralised for any flow declaring
 * supportsCancel = true. The flow still performs its own cleanup — this
 * only owns the wording so it isn't reinvented per flow.
 */
function handleCancel(flowId) {
  const def = getFlowDefinition(flowId);
  if (!def || !def.supportsCancel) {
    return { handled: false, message: 'CANCEL isn\'t available here.' };
  }
  return {
    handled: true,
    confirmationPrompt: 'Cancel this and lose your progress? Reply YES to confirm, or anything else to keep going.',
  };
}

function isGlobalCommand(text) {
  return GLOBAL_COMMANDS.includes(String(text || '').trim().toUpperCase());
}

// ── §2 — Fixed message-evaluation order ──────────────────────────────────
//
// evaluateMessage() is the future single entry point for webhook routing.
// It does NOT call into flows itself (flows are injected by the caller,
// since the navigation layer has no reverse dependency on them); it just
// enforces the order and hands back a routing decision.
//
// activeFlowId   - id of the flow currently claiming this phoneHash's
//                  session, or null
// text           - the inbound message text
//
// Returns one of:
//   { step: 'active_flow' }                         — defer to the flow's own handler
//   { step: 'active_menu', menuId, value }           — a scoped menu claimed a numeric reply
//   { step: 'numeric_no_menu', message }             — §4 collision guard fired
//   { step: 'global_command', command }              — HOME/MENU/HELP/CANCEL/BACK
//   { step: 'discovery' }                            — caller should attempt flow discovery
//   { step: 'ai_intent' }                            — fall through to free-text classification
function evaluateMessage(phoneHash, text, { activeFlowId = null } = {}) {
  // 1. Active workflow — the flow's own state machine gets first refusal.
  if (activeFlowId) {
    return { step: 'active_flow' };
  }

  // 2. Active menu.
  const numericAttempt = consumeNumericReply(phoneHash, text);
  if (numericAttempt.matched) {
    return { step: 'active_menu', menuId: numericAttempt.menuId, value: numericAttempt.value };
  }
  if (/^\d+$/.test(String(text || '').trim())) {
    // It was numeric but didn't match an open menu — §4 fires here rather
    // than letting it fall through to discovery/AI guessing.
    return { step: 'numeric_no_menu', message: NO_MENU_OPEN_REPLY };
  }

  // 3. Global navigation commands.
  if (isGlobalCommand(text)) {
    return { step: 'global_command', command: String(text).trim().toUpperCase() };
  }

  // 4/5. Workflow discovery vs. AI intent are both the caller's concern —
  // the navigation layer has no visibility into flow-start heuristics or
  // the classifier. Signal that navigation had nothing to claim.
  return { step: 'discovery' };
}

module.exports = {
  registerFlow,
  getFlowDefinition,
  openMenu,
  getOpenMenu,
  closeMenu,
  consumeNumericReply,
  renderHelp,
  handleHome,
  handleBack,
  handleCancel,
  isGlobalCommand,
  evaluateMessage,
  GLOBAL_COMMANDS,
  NO_MENU_OPEN_REPLY,
};
