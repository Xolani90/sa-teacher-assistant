'use strict';
/**
 * NavigationService tests (ADR-019 — Unified Conversational Navigation
 * Framework, Next Step 2: the navigation layer landed as new, additive
 * infrastructure). Nothing here exercises webhook.js/messageProcessor.js —
 * those aren't touched until the assessmentSessionFlow.js migration.
 *
 * Run individually: node tests/navigation-service.test.js
 * Run via npm:       npm test
 */

const crypto = require('crypto');
const nav = require('../services/navigationService');

let passed = 0;
let failed = 0;
function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`PASS: ${label}`);
  } else {
    failed++;
    console.log(`FAIL: ${label}`);
  }
}

function freshPhoneHash() {
  return crypto.randomBytes(16).toString('hex');
}

// ── §1 registerFlow / getFlowDefinition ─────────────────────────────────
{
  nav.registerFlow({
    id: 'assessmentSession',
    commands: ['UNDO', 'STATUS', 'EDIT', 'CANCEL'],
    supportsCancel: true,
    supportsBack: false,
  });
  const def = nav.getFlowDefinition('assessmentSession');
  assert(def && def.id === 'assessmentSession', 'registerFlow stores a retrievable definition');
  assert(def.commands.includes('STATUS'), 'registered commands are preserved');
  assert(nav.getFlowDefinition('doesNotExist') === null, 'unknown flow id returns null');
}

// re-registration is idempotent (overwrite, not throw/duplicate)
{
  nav.registerFlow({ id: 'assessmentSession', commands: ['STATUS'] });
  const def = nav.getFlowDefinition('assessmentSession');
  assert(def.commands.length === 1 && def.commands[0] === 'STATUS', 're-registering a flow id overwrites its definition');
  // restore full definition for later tests
  nav.registerFlow({
    id: 'assessmentSession',
    commands: ['UNDO', 'STATUS', 'EDIT', 'CANCEL'],
    supportsCancel: true,
    supportsBack: false,
  });
}

// ── §3/§4 — menus + numeric collision rule ──────────────────────────────
{
  const ph = freshPhoneHash();
  const before = nav.consumeNumericReply(ph, '1');
  assert(before.matched === false && before.reason === 'no_menu_open', 'numeric reply with no open menu is rejected (§4)');

  nav.openMenu(ph, {
    id: 'assessment_complete',
    options: { '1': 'NEW_TEST', '2': 'PRINT', '3': 'CLASS_INTERVENTION', '4': 'LEARNER_PROGRESS' },
  });
  assert(nav.getOpenMenu(ph)?.id === 'assessment_complete', 'openMenu makes the menu retrievable');

  const badOption = nav.consumeNumericReply(ph, '9');
  assert(badOption.matched === false && badOption.reason === 'unknown_option', 'a numeric reply not in the menu is rejected');
  assert(nav.getOpenMenu(ph)?.id === 'assessment_complete', 'menu survives an unmatched numeric reply');

  const ok = nav.consumeNumericReply(ph, '2');
  assert(ok.matched === true && ok.value === 'PRINT', 'a matching numeric reply resolves to the mapped action');
  assert(nav.getOpenMenu(ph) === null, 'menu with expiresAfterReply is destroyed after being consumed (consumed → destroyed)');

  const afterConsumed = nav.consumeNumericReply(ph, '2');
  assert(afterConsumed.matched === false && afterConsumed.reason === 'no_menu_open', 'the same digit cannot double-fire after consumption');
}

// non-expiring menu stays open across replies
{
  const ph = freshPhoneHash();
  nav.openMenu(ph, { id: 'sticky_menu', options: { '1': 'A' }, expiresAfterReply: false });
  nav.consumeNumericReply(ph, '1');
  assert(nav.getOpenMenu(ph)?.id === 'sticky_menu', 'expiresAfterReply: false keeps the menu open after a match');
  nav.closeMenu(ph);
  assert(nav.getOpenMenu(ph) === null, 'closeMenu destroys the menu explicitly');
}

// opening a new menu replaces any previous one (never stacked)
{
  const ph = freshPhoneHash();
  nav.openMenu(ph, { id: 'first', options: { '1': 'A' } });
  nav.openMenu(ph, { id: 'second', options: { '1': 'B' } });
  assert(nav.getOpenMenu(ph)?.id === 'second', 'menus are never stacked — opening a new one replaces the old one');
}

// ── §5 — renderHelp ──────────────────────────────────────────────────────
{
  const help = nav.renderHelp('assessmentSession');
  assert(help.includes('UNDO') && help.includes('STATUS') && help.includes('EDIT') && help.includes('CANCEL'), 'renderHelp lists the flow\'s declared commands');
  assert(help.includes('HOME') && help.includes('MENU') && help.includes('HELP'), 'renderHelp always lists the global commands');

  const helpUnknownFlow = nav.renderHelp('noSuchFlow');
  assert(helpUnknownFlow.includes('HOME'), 'renderHelp degrades gracefully for an unregistered flow id (global commands only)');
}

// ── §6 — MENU is global and inert; isGlobalCommand ──────────────────────
{
  assert(nav.isGlobalCommand('menu') === true, 'isGlobalCommand is case-insensitive');
  assert(nav.isGlobalCommand('  HOME  ') === true, 'isGlobalCommand trims whitespace');
  assert(nav.isGlobalCommand('7') === false, 'a bare digit is not a global command');
  assert(nav.isGlobalCommand('NEW_TEST') === false, 'an arbitrary word is not a global command');
}

// ── §8 — HOME / BACK / CANCEL ────────────────────────────────────────────
{
  const ph = freshPhoneHash();
  nav.openMenu(ph, { id: 'm', options: { '1': 'A' } });
  let extraCleared = false;
  const fakeStore = { delete: () => { extraCleared = true; } };
  const msg = nav.handleHome(ph, { extraStores: [fakeStore] });
  assert(nav.getOpenMenu(ph) === null, 'HOME closes any open menu');
  assert(extraCleared === true, 'HOME clears every extra store it is given');
  assert(typeof msg === 'string' && msg.length > 0, 'HOME returns a reply message');
}

{
  const backNotSupported = nav.handleBack('assessmentSession'); // supportsBack: false
  assert(backNotSupported.handled === false, 'BACK is refused when the flow did not declare supportsBack');
  assert(backNotSupported.message === "BACK isn't available here.", 'BACK refusal uses the specified copy');

  nav.registerFlow({ id: 'backable', commands: [], supportsBack: true });
  const backSupported = nav.handleBack('backable');
  assert(backSupported.handled === true, 'BACK is allowed when the flow declared supportsBack');
}

{
  const cancelSupported = nav.handleCancel('assessmentSession'); // supportsCancel: true
  assert(cancelSupported.handled === true, 'CANCEL is centrally handled for a flow declaring supportsCancel');
  assert(typeof cancelSupported.confirmationPrompt === 'string', 'CANCEL returns a confirmation prompt');

  nav.registerFlow({ id: 'noCancel', commands: [], supportsCancel: false });
  const cancelRefused = nav.handleCancel('noCancel');
  assert(cancelRefused.handled === false, 'CANCEL is refused for a flow that did not opt in');
}

// ── §2 — evaluateMessage five-step order ────────────────────────────────
{
  const ph = freshPhoneHash();
  const activeFlow = nav.evaluateMessage(ph, 'anything', { activeFlowId: 'assessmentSession' });
  assert(activeFlow.step === 'active_flow', 'step 1: an active flow claims the message before anything else');
}

{
  const ph = freshPhoneHash();
  nav.openMenu(ph, { id: 'm2', options: { '1': 'DO_THING' } });
  const menuStep = nav.evaluateMessage(ph, '1', {});
  assert(menuStep.step === 'active_menu' && menuStep.value === 'DO_THING', 'step 2: an open menu claims a matching numeric reply');
}

{
  const ph = freshPhoneHash();
  const collision = nav.evaluateMessage(ph, '5', {});
  assert(collision.step === 'numeric_no_menu', 'step 2/§4: a bare digit with no open menu is refused, never guessed at');
  assert(collision.message === nav.NO_MENU_OPEN_REPLY, 'the collision-guard message matches the ADR-specified copy');
}

{
  const ph = freshPhoneHash();
  const globalStep = nav.evaluateMessage(ph, 'help', {});
  assert(globalStep.step === 'global_command' && globalStep.command === 'HELP', 'step 3: global commands are recognised case-insensitively');
}

{
  const ph = freshPhoneHash();
  const fallthrough = nav.evaluateMessage(ph, 'Grade 7 fractions worksheet', {});
  assert(fallthrough.step === 'discovery', 'ordinary free text falls through to discovery/AI intent (steps 4/5), left to the caller');
}

console.log(`\n=== Results: ${passed}/${passed + failed} tests passed ===`);
process.exit(failed === 0 ? 0 : 1);
