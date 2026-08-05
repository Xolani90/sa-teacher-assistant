// services/navigationService.js
// ADR-019: Unified Conversational Navigation Framework.
//
// Step 3 / Commit 1 of 5 — FlowRegistry contract only. This commit
// reshapes the FlowDefinition contract, adds registration + cross-registry
// validation, and updates renderHelp()/handleHome() to the new shape.
// Nothing in this file is wired into webhook.js, messageProcessor.js, or
// any existing flow yet — that begins in Commit 2 (navigation wiring) and
// Commit 3 (Assessment becomes the first production consumer).
//
// Owns:
//   - FlowDefinition registration + validation (§1)
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

// Reserved to the navigation layer. A flow may never declare one of these
// as one of its own `commands` — see validateDefinition() / validate().
// Ordinary flow-specific commands (STATUS, PRINT, SAVE, ...) ARE allowed
// to be declared by more than one flow: NavigationService resolves them
// by active-flow ownership at evaluateMessage() time, not by uniqueness.
const GLOBAL_COMMANDS = ['HOME', 'MENU', 'HELP', 'CANCEL', 'BACK'];

// §1 — Flow registry. Flows call registerFlow() once at module load with a
// declarative FlowDefinition instead of embedding navigation logic.
const registry = new Map();

/**
 * @typedef {Object} FlowCapabilities
 * @property {boolean} status - flow exposes its own STATUS meaning
 * @property {boolean} cancel - flow opts into centrally-handled CANCEL
 * @property {boolean} back   - flow opts into centrally-handled BACK
 * @property {boolean} menus  - flow may open scoped session.menu prompts
 */

/**
 * @typedef {Object} FlowHooks
 * @property {function(string):void} [cleanup]        - invoked by HOME;
 *   flow owns deleting its own state, NavigationService never touches a
 *   flow's state maps directly.
 * @property {function(string):string} [describeStatus] - invoked when
 *   capabilities.status is true and the flow is active; if omitted, the
 *   flow is expected to keep handling STATUS itself for now.
 * @property {function(string):string} [describeHelp]  - transitional
 *   override for renderHelp(); optional, since renderHelp() already
 *   auto-generates help text from commands + capabilities by default.
 */

/**
 * @typedef {Object} FlowDefinition
 * @property {string} id
 * @property {string[]} commands           - e.g. ["PRINT", "NEW TEST"]
 * @property {Object.<string, string[]>} menus - named menu templates the
 *   flow can open, keyed by menu id, each an ordered list of option labels
 * @property {FlowCapabilities} capabilities
 * @property {FlowHooks} [hooks]
 */

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Validates a single FlowDefinition in isolation — everything intrinsic
 * to one flow's own declaration, independent of what else is registered.
 * Throws synchronously with a descriptive message; registerFlow() never
 * partially registers a malformed definition.
 */
function validateDefinition(definition) {
  if (!isPlainObject(definition)) {
    throw new Error('[NAV] registerFlow requires a FlowDefinition object');
  }
  if (typeof definition.id !== 'string' || definition.id.trim() === '') {
    throw new Error('[NAV] FlowDefinition.id is required and must be a non-empty string');
  }
  if (definition.commands !== undefined && !Array.isArray(definition.commands)) {
    throw new Error(`[NAV] FlowDefinition("${definition.id}").commands must be an array`);
  }
  const commands = definition.commands || [];
  const seen = new Set();
  for (const cmd of commands) {
    if (typeof cmd !== 'string' || cmd.trim() === '') {
      throw new Error(`[NAV] FlowDefinition("${definition.id}").commands must contain only non-empty strings`);
    }
    const upper = cmd.trim().toUpperCase();
    if (seen.has(upper)) {
      throw new Error(`[NAV] FlowDefinition("${definition.id}") declares duplicate command "${cmd}"`);
    }
    seen.add(upper);
    if (GLOBAL_COMMANDS.includes(upper)) {
      // Reserved-command violations are a cross-registry-visible rule in
      // spirit, but they're checkable per-definition (GLOBAL_COMMANDS is
      // fixed), so we fail fast here rather than waiting for validate().
      throw new Error(
        `[NAV] FlowDefinition("${definition.id}") declares "${cmd}", which is reserved to NavigationService. ` +
        `Use capabilities.cancel/back/status instead of declaring HOME/MENU/HELP/CANCEL/BACK as a flow command.`
      );
    }
  }

  if (definition.menus !== undefined && !isPlainObject(definition.menus)) {
    throw new Error(`[NAV] FlowDefinition("${definition.id}").menus must be an object`);
  }
  const menus = definition.menus || {};
  for (const [menuId, options] of Object.entries(menus)) {
    if (!Array.isArray(options)) {
      throw new Error(`[NAV] FlowDefinition("${definition.id}").menus["${menuId}"] must be an array of option labels`);
    }
  }

  const capabilities = definition.capabilities || {};
  if (!isPlainObject(definition.capabilities || {})) {
    throw new Error(`[NAV] FlowDefinition("${definition.id}").capabilities must be an object`);
  }
  for (const key of ['status', 'cancel', 'back', 'menus']) {
    if (capabilities[key] !== undefined && typeof capabilities[key] !== 'boolean') {
      throw new Error(`[NAV] FlowDefinition("${definition.id}").capabilities.${key} must be a boolean`);
    }
  }

  const hooks = definition.hooks || {};
  if (!isPlainObject(definition.hooks || {})) {
    throw new Error(`[NAV] FlowDefinition("${definition.id}").hooks must be an object`);
  }
  for (const key of ['cleanup', 'describeStatus', 'describeHelp']) {
    if (hooks[key] !== undefined && typeof hooks[key] !== 'function') {
      throw new Error(`[NAV] FlowDefinition("${definition.id}").hooks.${key} must be a function`);
    }
  }

  return {
    id: definition.id,
    commands,
    menus,
    capabilities: {
      status: Boolean(capabilities.status),
      cancel: Boolean(capabilities.cancel),
      back: Boolean(capabilities.back),
      menus: Boolean(capabilities.menus),
    },
    hooks: {
      cleanup: hooks.cleanup,
      describeStatus: hooks.describeStatus,
      describeHelp: hooks.describeHelp,
    },
  };
}

/**
 * Registers a flow's navigation metadata. Idempotent — re-registering the
 * same id overwrites the previous definition, so a flow module can be
 * required multiple times (as happens under test) without erroring.
 *
 * @param {FlowDefinition} definition
 */
function registerFlow(definition) {
  const normalized = validateDefinition(definition);
  registry.set(normalized.id, normalized);
}

function getFlowDefinition(flowId) {
  return registry.get(flowId) || null;
}

/**
 * §1 cross-registry invariants — everything that can only be checked by
 * seeing the whole registry at once, run once at application startup
 * after every flow module has called registerFlow(). Per-definition
 * concerns (malformed shape, reserved commands, duplicate commands
 * within one flow) are already rejected eagerly by registerFlow() itself
 * and are NOT re-checked here.
 *
 * Intentionally does NOT reject the same command string (e.g. "STATUS")
 * being declared by more than one flow — that's expected: NavigationService
 * resolves shared commands by active-flow ownership, not by uniqueness.
 *
 * @returns {{valid: true} | {valid: false, errors: string[]}}
 */
function validate() {
  const errors = [];
  const seenIds = new Set();

  for (const def of registry.values()) {
    if (seenIds.has(def.id)) {
      errors.push(`Duplicate flow id registered: "${def.id}"`);
    }
    seenIds.add(def.id);

    for (const cmd of def.commands) {
      if (GLOBAL_COMMANDS.includes(cmd.toUpperCase())) {
        // Defense in depth — registerFlow() already rejects this at
        // registration time, so reaching here would indicate the
        // registry was mutated outside registerFlow().
        errors.push(`Flow "${def.id}" declares reserved command "${cmd}"`);
      }
    }
  }

  return errors.length ? { valid: false, errors } : { valid: true, errors: [] };
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
 * Flows never format their own help text once migrated onto this layer,
 * unless they supply hooks.describeHelp as a transitional override.
 */
function renderHelp(flowId) {
  const def = getFlowDefinition(flowId);
  if (def?.hooks?.describeHelp) {
    return def.hooks.describeHelp(flowId);
  }

  const flowCommands = def ? def.commands : [];
  const lines = ['*Available commands*'];
  if (flowCommands.length) {
    lines.push(flowCommands.join(', '));
  }
  const globalLine = ['HOME', 'MENU', 'HELP']
    .concat(def?.capabilities.cancel ? ['CANCEL'] : [])
    .concat(def?.capabilities.back ? ['BACK'] : [])
    .filter((c) => !flowCommands.includes(c));
  lines.push(globalLine.join(', '));

  return lines.join('\n');
}

// ── §8 — HOME / BACK / CANCEL ────────────────────────────────────────────

/**
 * HOME clears the open menu and every registered flow's own state via its
 * optional hooks.cleanup(phoneHash). NavigationService never enumerates or
 * touches a concrete flow's state maps directly — flow lifecycle stays
 * owned by the flow itself. Flows with no persistent state (stateless,
 * menu-only, or one-shot flows) simply omit hooks.cleanup.
 */
function handleHome(phoneHash) {
  closeMenu(phoneHash);
  for (const def of registry.values()) {
    def.hooks?.cleanup?.(phoneHash);
  }
  return "You're back at the main menu. Reply MENU to see what I can do.";
}

/**
 * BACK only affects navigation, never data, and only works if the active
 * flow declared capabilities.back for the current step.
 */
function handleBack(flowId) {
  const def = getFlowDefinition(flowId);
  if (!def || !def.capabilities.back) {
    return { handled: false, message: "BACK isn't available here." };
  }
  return { handled: true };
}

/**
 * CANCEL confirmation copy, centralised for any flow declaring
 * capabilities.cancel = true. The flow still performs its own cleanup via
 * hooks.cleanup — this only owns the wording so it isn't reinvented per
 * flow.
 */
function handleCancel(flowId) {
  const def = getFlowDefinition(flowId);
  if (!def || !def.capabilities.cancel) {
    return { handled: false, message: 'CANCEL isn\'t available here.' };
  }
  return {
    handled: true,
    confirmationPrompt: 'Cancel this and lose your progress? Reply YES to confirm, or anything else to keep going.',
  };
}

/**
 * STATUS ownership policy: if an active flow declares capabilities.status,
 * STATUS belongs to that flow; otherwise it falls back to the caller's
 * account/quota implementation. NavigationService only resolves ownership
 * here — it does not itself know how to render either kind of STATUS.
 *
 * @returns {{owner: 'flow', flowId: string} | {owner: 'account'}}
 */
function resolveStatusOwner(activeFlowId) {
  if (activeFlowId) {
    const def = getFlowDefinition(activeFlowId);
    if (def?.capabilities.status) {
      return { owner: 'flow', flowId: activeFlowId };
    }
  }
  return { owner: 'account' };
}

function isGlobalCommand(text) {
  return GLOBAL_COMMANDS.includes(String(text || '').trim().toUpperCase());
}

// ── §2 — Fixed message-evaluation order (ADR-019 Step 3 Commit 5 addendum) ─
//
// evaluateMessage() is the future single entry point for webhook routing.
// It does NOT call into flows itself (flows are injected by the caller,
// since the navigation layer has no reverse dependency on them); it just
// enforces the order and hands back a routing decision.
//
// Revised precedence (supersedes the Commit 1 ordering). NavigationService
// draws a deliberate line between two kinds of "navigation" requests:
//   - platform-owned (HOME/MENU/HELP/CANCEL/BACK): a single, fixed meaning
//     regardless of which flow is active — NavigationService answers these
//     itself.
//   - flow-owned (STATUS): NavigationService never renders STATUS; it only
//     decides who should (resolveStatusOwner), because STATUS's meaning is
//     intentionally different per active flow. STATUS is therefore its own
//     evaluation stage, not folded into GLOBAL_COMMANDS.
//   1. Platform navigation commands (HOME/MENU/HELP/CANCEL/BACK) — checked
//      first, even with an active flow or an open menu.
//   2. STATUS resolution — resolveStatusOwner(activeFlowId), also checked
//      before any menu or workflow, since a teacher may ask for status at
//      any point in the conversation and it is not a menu selection.
//   3. Active menu — claims only replies that resolve to a defined menu
//      option. A numeric reply that does NOT resolve to a defined option
//      is invalid menu input: the menu stays open and must be re-rendered
//      by the caller — it never falls through to the active workflow. A
//      numeric reply with no menu open at all is the original §4
//      collision guard.
//   4. Active workflow — the flow's own state machine, but only once
//      platform commands, STATUS, and menu resolution have all declined
//      the message.
//   5/6. Workflow discovery / AI intent — both the caller's concern.
//
// activeFlowId   - id of the flow currently claiming this phoneHash's
//                  session, or null
// text           - the inbound message text
//
// Returns one of:
//   { step: 'global_command', command }              — HOME/MENU/HELP/CANCEL/BACK
//   { step: 'status_request', owner, flowId? }        — STATUS; owner is 'flow' or 'account'
//   { step: 'active_menu', menuId, value }            — a scoped menu claimed a numeric reply
//   { step: 'invalid_menu_option', message }          — menu open, digit doesn't match; re-render, stay open
//   { step: 'numeric_no_menu', message }              — §4 collision guard fired (no menu open at all)
//   { step: 'active_flow' }                           — defer to the flow's own handler
//   { step: 'discovery' }                             — caller should attempt flow discovery
//   { step: 'ai_intent' }                             — fall through to free-text classification
const INVALID_MENU_OPTION_REPLY =
  "That's not one of the options. Please reply with one of the numbers shown.";

function evaluateMessage(phoneHash, text, { activeFlowId = null } = {}) {
  // 1. Platform navigation commands — a fixed, flow-independent meaning.
  if (isGlobalCommand(text)) {
    return { step: 'global_command', command: String(text).trim().toUpperCase() };
  }

  // 2. STATUS — flow-owned meaning, resolved (not answered) here. Kept
  // deliberately separate from GLOBAL_COMMANDS; see comment above.
  if (String(text || '').trim().toUpperCase() === 'STATUS') {
    return { step: 'status_request', ...resolveStatusOwner(activeFlowId) };
  }

  // 3. Active menu — valid selection only; invalid options never fall
  // through to the workflow.
  const numericAttempt = consumeNumericReply(phoneHash, text);
  if (numericAttempt.matched) {
    return { step: 'active_menu', menuId: numericAttempt.menuId, value: numericAttempt.value };
  }
  if (numericAttempt.reason === 'unknown_option') {
    return { step: 'invalid_menu_option', message: INVALID_MENU_OPTION_REPLY };
  }
  if (/^\d+$/.test(String(text || '').trim())) {
    // Numeric, but no menu is open at all — the original §4 collision guard.
    return { step: 'numeric_no_menu', message: NO_MENU_OPEN_REPLY };
  }

  // 4. Active workflow — only reached once platform commands, STATUS, and
  // menu resolution have all declined the message.
  if (activeFlowId) {
    return { step: 'active_flow' };
  }

  // 4/5. Workflow discovery vs. AI intent are both the caller's concern —
  // the navigation layer has no visibility into flow-start heuristics or
  // the classifier. Signal that navigation had nothing to claim.
  return { step: 'discovery' };
}

module.exports = {
  registerFlow,
  getFlowDefinition,
  validate,
  openMenu,
  getOpenMenu,
  closeMenu,
  consumeNumericReply,
  renderHelp,
  handleHome,
  handleBack,
  handleCancel,
  resolveStatusOwner,
  isGlobalCommand,
  evaluateMessage,
  GLOBAL_COMMANDS,
  NO_MENU_OPEN_REPLY,
  INVALID_MENU_OPTION_REPLY,
};
