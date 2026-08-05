'use strict';
/**
 * NavigationService tests (ADR-019 — Unified Conversational Navigation
 * Framework, Step 3 / Commit 1: FlowRegistry contract only). Nothing here
 * exercises webhook.js/messageProcessor.js — those aren't touched until
 * Commit 2 (navigation wiring) and Commit 3 (Assessment migration).
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

// ── §1 registerFlow / getFlowDefinition — happy path ────────────────────
{
  nav.registerFlow({
    id: 'assessmentSession',
    commands: ['PRINT', 'NEW TEST'],
    capabilities: { status: true, cancel: true, back: false, menus: false },
  });
  const def = nav.getFlowDefinition('assessmentSession');
  assert(def && def.id === 'assessmentSession', 'registerFlow stores a retrievable definition');
  assert(def.commands.includes('PRINT'), 'registered commands are preserved');
  assert(def.capabilities.status === true, 'capabilities are preserved');
  assert(nav.getFlowDefinition('doesNotExist') === null, 'unknown flow id returns null');
}

// re-registration is idempotent (overwrite, not throw/duplicate)
{
  nav.registerFlow({ id: 'assessmentSession', commands: ['STATUS'], capabilities: { status: true } });
  const def = nav.getFlowDefinition('assessmentSession');
  assert(def.commands.length === 1 && def.commands[0] === 'STATUS', 're-registering a flow id overwrites its definition');
  // restore full definition for later tests
  nav.registerFlow({
    id: 'assessmentSession',
    commands: ['PRINT', 'NEW TEST'],
    capabilities: { status: true, cancel: true, back: false, menus: false },
  });
}

// missing capabilities/menus default to safe values, not a throw
{
  nav.registerFlow({ id: 'minimalFlow', commands: [] });
  const def = nav.getFlowDefinition('minimalFlow');
  assert(def.capabilities.status === false && def.capabilities.cancel === false, 'omitted capabilities default to false');
  assert(typeof def.menus === 'object', 'omitted menus defaults to an empty object');
  assert(def.hooks.cleanup === undefined, 'omitted hooks are simply absent, not required');
}

// ── §1 registerFlow — per-definition validation (fail fast) ─────────────
{
  let threw = false;
  try { nav.registerFlow({ commands: [] }); } catch (e) { threw = true; }
  assert(threw, 'registerFlow rejects a definition with no id');
}
{
  let threw = false;
  try { nav.registerFlow({ id: 'bad', commands: 'STATUS' }); } catch (e) { threw = true; }
  assert(threw, 'registerFlow rejects commands that is not an array');
}
{
  let threw = false;
  try { nav.registerFlow({ id: 'bad', commands: ['STATUS', 'STATUS'] }); } catch (e) { threw = true; }
  assert(threw, 'registerFlow rejects duplicate commands within the same flow');
}
{
  let threw = false;
  let message = '';
  try { nav.registerFlow({ id: 'bad', commands: ['CANCEL'] }); } catch (e) { threw = true; message = e.message; }
  assert(threw, 'registerFlow rejects a flow declaring a reserved global command as its own');
  assert(message.includes('reserved'), 'the rejection explains that the command is reserved to NavigationService');
}
{
  let threw = false;
  try { nav.registerFlow({ id: 'bad', capabilities: { status: 'yes' } }); } catch (e) { threw = true; }
  assert(threw, 'registerFlow rejects a non-boolean capability');
}
{
  let threw = false;
  try { nav.registerFlow({ id: 'bad', hooks: { cleanup: 'not a function' } }); } catch (e) { threw = true; }
  assert(threw, 'registerFlow rejects a hook that is not a function');
}
{
  let threw = false;
  try { nav.registerFlow({ id: 'bad', menus: ['not', 'an', 'object'] }); } catch (e) { threw = true; }
  assert(threw, 'registerFlow rejects menus that is not an object');
}

// ── FlowRegistry.validate() — cross-registry invariants ──────────────────
{
  const result = nav.validate();
  assert(result.valid === true, 'validate() passes for the current, well-formed registry');
  assert(Array.isArray(result.errors) && result.errors.length === 0, 'validate() returns an empty errors array when valid');
}
{
  // Shared command names across flows are explicitly allowed — NOT a
  // registry error. STATUS/PRINT/etc. are resolved by active-flow
  // ownership at evaluateMessage() time, not by uniqueness.
  nav.registerFlow({ id: 'growthPlan', commands: ['STATUS'], capabilities: { status: true } });
  const result = nav.validate();
  assert(result.valid === true, 'validate() allows the same command string declared by more than one flow');
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
  assert(help.includes('PRINT') && help.includes('NEW TEST'), "renderHelp lists the flow's declared commands");
  assert(help.includes('HOME') && help.includes('MENU') && help.includes('HELP'), 'renderHelp always lists the global commands');
  assert(help.includes('CANCEL'), 'renderHelp includes CANCEL when capabilities.cancel is true');

  const helpUnknownFlow = nav.renderHelp('noSuchFlow');
  assert(helpUnknownFlow.includes('HOME'), 'renderHelp degrades gracefully for an unregistered flow id (global commands only)');
}
{
  nav.registerFlow({
    id: 'customHelpFlow',
    commands: [],
    hooks: { describeHelp: () => 'CUSTOM HELP TEXT' },
  });
  assert(nav.renderHelp('customHelpFlow') === 'CUSTOM HELP TEXT', 'hooks.describeHelp overrides the auto-generated help text when present');
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
  let cleanedUp = false;
  nav.registerFlow({
    id: 'cleanupFlow',
    commands: [],
    hooks: { cleanup: (calledPh) => { if (calledPh === ph) cleanedUp = true; } },
  });
  const msg = nav.handleHome(ph);
  assert(nav.getOpenMenu(ph) === null, 'HOME closes any open menu');
  assert(cleanedUp === true, "HOME invokes every registered flow's hooks.cleanup with the phoneHash");
  assert(typeof msg === 'string' && msg.length > 0, 'HOME returns a reply message');
}
{
  // A flow with no cleanup hook must not break HOME for every other flow.
  const ph = freshPhoneHash();
  nav.registerFlow({ id: 'statelessFlow', commands: [] }); // no hooks at all
  let threw = false;
  try { nav.handleHome(ph); } catch (e) { threw = true; }
  assert(threw === false, 'HOME tolerates flows that declare no cleanup hook');
}

{
  const backNotSupported = nav.handleBack('assessmentSession'); // capabilities.back: false
  assert(backNotSupported.handled === false, 'BACK is refused when the flow did not declare capabilities.back');
  assert(backNotSupported.message === "BACK isn't available here.", 'BACK refusal uses the specified copy');

  nav.registerFlow({ id: 'backable', commands: [], capabilities: { back: true } });
  const backSupported = nav.handleBack('backable');
  assert(backSupported.handled === true, 'BACK is allowed when the flow declared capabilities.back');
}

{
  const cancelSupported = nav.handleCancel('assessmentSession'); // capabilities.cancel: true
  assert(cancelSupported.handled === true, 'CANCEL is centrally handled for a flow declaring capabilities.cancel');
  assert(typeof cancelSupported.confirmationPrompt === 'string', 'CANCEL returns a confirmation prompt');

  nav.registerFlow({ id: 'noCancel', commands: [], capabilities: { cancel: false } });
  const cancelRefused = nav.handleCancel('noCancel');
  assert(cancelRefused.handled === false, 'CANCEL is refused for a flow that did not opt in');
}

// ── STATUS ownership policy ───────────────────────────────────────────────
{
  const owner = nav.resolveStatusOwner('assessmentSession'); // capabilities.status: true
  assert(owner.owner === 'flow' && owner.flowId === 'assessmentSession', 'STATUS belongs to an active flow that declares capabilities.status');
}
{
  nav.registerFlow({ id: 'noStatus', commands: [], capabilities: { status: false } });
  const owner = nav.resolveStatusOwner('noStatus');
  assert(owner.owner === 'account', 'STATUS falls back to account/quota when the active flow does not declare capabilities.status');
}
{
  const owner = nav.resolveStatusOwner(null);
  assert(owner.owner === 'account', 'STATUS falls back to account/quota when there is no active flow');
}
{
  const owner = nav.resolveStatusOwner('doesNotExist');
  assert(owner.owner === 'account', 'STATUS falls back to account/quota for an unregistered flow id');
}

// ── §2 — evaluateMessage precedence (ADR-019 Step 3 Commit 5 addendum) ──
// Supersedes the Commit 1 ordering. This block asserts the CURRENT
// contract only — no archaeological tests for the prior order.
// New precedence: global command > active menu (valid selection) >
// active workflow > discovery.
{
  const ph = freshPhoneHash();
  const globalStep = nav.evaluateMessage(ph, 'help', {});
  assert(globalStep.step === 'global_command' && globalStep.command === 'HELP', 'global commands are recognised case-insensitively');
}

{
  const ph = freshPhoneHash();
  nav.openMenu(ph, { id: 'm2', options: { '1': 'DO_THING' } });
  const menuStep = nav.evaluateMessage(ph, '1', {});
  assert(menuStep.step === 'active_menu' && menuStep.value === 'DO_THING', 'a valid numeric reply is consumed by an open menu');
}

{
  const ph = freshPhoneHash();
  const collision = nav.evaluateMessage(ph, '5', {});
  assert(collision.step === 'numeric_no_menu', 'a bare digit with no open menu is refused, never guessed at');
  assert(collision.message === nav.NO_MENU_OPEN_REPLY, 'the collision-guard message matches the ADR-specified copy');
}

{
  const ph = freshPhoneHash();
  const activeFlow = nav.evaluateMessage(ph, 'anything', { activeFlowId: 'assessmentSession' });
  assert(activeFlow.step === 'active_flow', 'an active flow claims the message once globals and menu resolution have declined it');
}

{
  const ph = freshPhoneHash();
  const fallthrough = nav.evaluateMessage(ph, 'Grade 7 fractions worksheet', {});
  assert(fallthrough.step === 'discovery', 'ordinary free text falls through to discovery/AI intent, left to the caller');
}

// ── invariant: STATUS resolution preempts an active workflow ────────────
// STATUS is deliberately NOT in GLOBAL_COMMANDS — it's flow-owned meaning,
// resolved via resolveStatusOwner(), not answered by NavigationService
// itself. It still gets its own pre-menu, pre-workflow evaluation stage.
{
  const ph = freshPhoneHash();
  const result = nav.evaluateMessage(ph, 'STATUS', { activeFlowId: 'assessmentSession' });
  assert(result.step === 'status_request', 'STATUS resolution preempts active workflow');
  assert(result.owner === 'flow' && result.flowId === 'assessmentSession', 'STATUS resolution reflects the same ownership resolveStatusOwner() would give directly');
}
{
  assert(nav.isGlobalCommand('STATUS') === false, 'STATUS is intentionally excluded from GLOBAL_COMMANDS — it is resolved, not answered, by NavigationService');
}

// ── invariant: global commands preempt an active menu ────────────────────
{
  const ph = freshPhoneHash();
  nav.openMenu(ph, { id: 'preempt_test', options: { '1': 'PRINT' } });
  const result = nav.evaluateMessage(ph, 'CANCEL', {});
  assert(result.step === 'global_command' && result.command === 'CANCEL', 'global commands preempt an active menu');
  assert(nav.getOpenMenu(ph)?.id === 'preempt_test', 'the menu itself is untouched by evaluateMessage — the caller decides what CANCEL does to it');
}

// ── invariant: valid menu selection preempts the active workflow ────────
{
  const ph = freshPhoneHash();
  nav.openMenu(ph, { id: 'preempt_flow', options: { '1': 'NEW_ASSESSMENT' } });
  const result = nav.evaluateMessage(ph, '1', { activeFlowId: 'assessmentSession' });
  assert(result.step === 'active_menu' && result.value === 'NEW_ASSESSMENT', 'a valid menu selection preempts an active workflow, even though the flow is still "active"');
}

// ── invariant: the workflow only ever sees a message after globals AND
// menu resolution have both declined it ─────────────────────────────────
{
  const ph = freshPhoneHash();
  nav.openMenu(ph, { id: 'decline_test', options: { '1': 'A' } });
  const stillMenu = nav.evaluateMessage(ph, 'some free text', { activeFlowId: 'assessmentSession' });
  // Free text isn't numeric, so the menu declines it (only claims valid
  // numeric selections) and it should reach the active flow, not the menu.
  assert(stillMenu.step === 'active_flow', 'free text while a menu is open is declined by the menu and reaches the active workflow');
}

// ── the explicit interaction test that motivated this redesign ──────────
{
  const ph = freshPhoneHash();
  nav.openMenu(ph, { id: 'assessmentSession.complete', options: { '1': 'NEW_ASSESSMENT', '2': 'PRINT' } });
  const result = nav.evaluateMessage(ph, 'STATUS', { activeFlowId: 'assessmentSession' });
  assert(result.step === 'status_request' && result.owner === 'flow' && result.flowId === 'assessmentSession', 'given an active flow AND an open completion menu, STATUS still resolves to the flow, ahead of the menu');
  assert(nav.getOpenMenu(ph)?.id === 'assessmentSession.complete', 'the completion menu remains open — STATUS does not consume or close it');
}

// ── §9 — Menu routing precedence (invalid menu input) ────────────────────
{
  const ph = freshPhoneHash();
  nav.openMenu(ph, { id: 'invalid_input_test', options: { '1': 'A', '2': 'B' } });
  const result = nav.evaluateMessage(ph, '9', {});
  assert(result.step === 'invalid_menu_option', 'an invalid numeric reply against an open menu is its own distinct step, not the no-menu collision guard');
  assert(result.message === nav.INVALID_MENU_OPTION_REPLY, 'invalid menu input gets the re-render copy, not the "no menu open" copy');
  assert(nav.getOpenMenu(ph)?.id === 'invalid_input_test', 'the menu remains open after an invalid numeric reply');
}
{
  const ph = freshPhoneHash();
  nav.openMenu(ph, { id: 'invalid_input_flow_test', options: { '1': 'A' } });
  const result = nav.evaluateMessage(ph, '9', { activeFlowId: 'assessmentSession' });
  assert(result.step === 'invalid_menu_option', 'invalid menu input never falls through to the active workflow, even when one is active');
}

// ── §10 — Menu lifecycle ──────────────────────────────────────────────────
{
  const ph = freshPhoneHash();
  nav.openMenu(ph, { id: 'lifecycle_a', options: { '1': 'A' } });
  nav.openMenu(ph, { id: 'lifecycle_b', options: { '1': 'B' } });
  assert(nav.getOpenMenu(ph)?.id === 'lifecycle_b', 'opening a second menu replaces the first — menus never stack');
}
{
  const ph = freshPhoneHash();
  nav.openMenu(ph, { id: 'lifecycle_home', options: { '1': 'A' } });
  nav.handleHome(ph);
  assert(nav.getOpenMenu(ph) === null, 'HOME destroys the active menu');
}
{
  const ph = freshPhoneHash();
  nav.openMenu(ph, { id: 'lifecycle_selected', options: { '1': 'DONE_ACTION' } });
  const result = nav.evaluateMessage(ph, '1', {});
  assert(result.step === 'active_menu', 'sanity: the selection was consumed');
  assert(nav.getOpenMenu(ph) === null, 'successful selection destroys the menu');
}

// ── §11 — Idempotency ──────────────────────────────────────────────────────
{
  const ph = freshPhoneHash();
  nav.openMenu(ph, { id: 'idempotency_test', options: { '2': 'PRINT' } });
  const first = nav.evaluateMessage(ph, '2', {});
  assert(first.step === 'active_menu' && first.value === 'PRINT', 'first delivery of the reply consumes the menu and resolves the action');

  // Simulate a replayed/duplicate WhatsApp delivery of the same message.
  const replay = nav.evaluateMessage(ph, '2', {});
  assert(replay.step === 'numeric_no_menu', 'a replayed numeric reply after consumption does not re-fire the action');
  assert(replay.message === nav.NO_MENU_OPEN_REPLY, 'the replay gets the "no menu open" response, not a second PRINT');
}

console.log(`\n=== Results: ${passed}/${passed + failed} tests passed ===`);
process.exit(failed === 0 ? 0 : 1);
