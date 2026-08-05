# Navigation Platform Specification

**Status:** Active
**Origin:** ADR-019
**First production consumer:** Assessment (`flows/assessmentSessionFlow.js`), validated end-to-end via `tests/assessment-completion-menu.test.js` and the full ADR-019 Step 3 commit sequence (122/122 suites passing).
**Reference tag:** `adr019-step3-complete-plus-menu`

This document is the canonical specification for `services/navigationService.js`. Future ADRs that touch routing, menus, STATUS, or CANCEL should reference this document instead of re-explaining the platform from scratch.

---

## 1. Purpose

NavigationService exists to take routing decisions — "what does this incoming message mean, and who should handle it" — out of individual flow files and centralize them in one place with one contract.

Before ADR-019, each flow (Assessment, Observation, Roster, etc.) independently implemented its own STATUS handling, its own CANCEL handling, and in some cases its own ad hoc menu logic. This produced:

- inconsistent behavior between flows (STATUS meant something slightly different depending which flow was active)
- duplicated defensive code (every flow re-implementing "is there an active session," "did this reply match a menu option")
- no single point to reason about routing precedence when flows disagreed

**Problems NavigationService solves:**

- **Routing ownership** — one authoritative order in which global commands, STATUS, an open menu, and an active flow get first claim on an incoming message.
- **Menu lifecycle** — creation, single-consume, replay-safety, and destruction, implemented once instead of per-flow.
- **STATUS ownership** — a single `resolveStatusOwner()` decides whether STATUS belongs to the active flow or falls back to account/quota info, instead of each flow guessing.
- **Flow registration** — a validated contract (`FlowDefinition`) that every flow declares once at module load, so misconfiguration (duplicate commands, a flow claiming a reserved global command) is caught eagerly rather than at runtime.

**Explicit non-goals.** NavigationService does not know or care about:

- **Business logic** — what a valid mark is, what a growth plan status transition means, whatever.
- **Domain semantics** — the meaning of a menu option ("1 = new assessment") is the flow's to define and act on; NavigationService only tracks that *some* option was selected and hands the mapped action back.
- **Rendering** — NavigationService returns plain strings/data for the flow (or the message-sending layer) to deliver. It does not touch WhatsApp formatting, PDFs, or message chunking.

If a change to NavigationService would require it to know something about a specific flow's domain, that change belongs in the flow, not the platform.

---

## 2. Platform Guarantees

These are no longer "how it happens to be implemented" — they are guarantees other code, including future flows, are entitled to rely on. Each has been exercised by a real production consumer (Assessment), not just contract tests.

1. **Deterministic routing.** For any given message and system state, the routing outcome (which stage claims it) is fully determined by the precedence order in §4 — never ambiguous, never dependent on flow registration order.
2. **One active menu at a time.** Opening a new menu always replaces any existing one. Menus never stack.
3. **Replay-safe menus.** A message replayed after a menu selection has already been consumed does not re-fire the mapped action. It receives the "no menu open" response instead.
4. **Menu single-consume.** By default (`expiresAfterReply: true`), a successful selection destroys the menu. `expiresAfterReply: false` is available for menus that should stay open after a match.
5. **Semantic action dispatch.** A menu maps a numeric reply to a semantic action (not just an index) — the flow receives "this option was chosen," not "the user typed 2."
6. **Centralized STATUS ownership.** `resolveStatusOwner()` is the single source of truth for whether STATUS belongs to an active flow (via `capabilities.status` + `hooks.describeStatus`) or falls back to account/quota. STATUS resolution preempts an open menu without consuming or closing it.
7. **HOME/CANCEL cleanup orchestration.** HOME closes any open menu and invokes every registered flow's `hooks.cleanup`, tolerating flows that declare none. CANCEL is centrally handled for any flow with `capabilities.cancel`, and refused (with a specified message) for flows that didn't opt in.
8. **FlowRegistry validation.** `registerFlow()` rejects, synchronously and eagerly at module load: missing id, non-array commands, duplicate commands within a flow, a flow claiming a reserved global command, non-boolean capabilities, non-function hooks, and non-object menus. Misconfiguration cannot silently reach runtime.

---

## 3. FlowDefinition Contract

```js
FlowDefinition {
  id,            // string, unique, required
  commands,      // array of command strings this flow owns
  capabilities,  // { cancel: bool, status: bool, back: bool, ... } — all optional, default false
  menus,         // object — optional, default {}
  hooks          // { cleanup, describeStatus, describeHelp, ... } — optional, all functions
}
```

**`id`** — Required. Unique across the registry. Used by `resolveStatusOwner()`, `renderHelp()`, and cleanup orchestration to identify the flow.

**`commands`** — The set of command strings this flow claims (e.g. `NEW TEST`, `PRINT`). Must not overlap with the reserved global commands (`HOME`, `MENU`, `HELP`, `CANCEL`, `BACK`) — `registerFlow()` rejects that at registration time. The same command string *may* be declared by more than one flow (validated by `validate()`); NavigationService does not resolve that ambiguity itself — that's a flow-discovery concern outside this platform.

**`capabilities`** — Booleans NavigationService checks before centrally handling a global command on the flow's behalf:
- `cancel: true` — CANCEL is centrally handled for this flow; the confirmation prompt is generated automatically. Omit or `false` to have CANCEL refused with the standard "this flow doesn't support cancelling" message.
- `status: true` — this flow owns STATUS while active; must be paired with `hooks.describeStatus`. Without it, STATUS falls back to account/quota info even while the flow is active.
- `back: true` — enables BACK; omitted or `false` refuses it with a specified message.

**`menus`** — Optional. Reserved for menu *definitions* a flow wants to declare declaratively at registration time, distinct from menus opened dynamically at runtime via `openMenu()`. Most flows (including Assessment) open menus dynamically rather than declaring them here; leave this `{}` unless there's a specific need for a static menu definition.

**`hooks`** — Functions NavigationService calls into:
- `cleanup(phoneHash)` — called by HOME for every registered flow, regardless of whether it's currently active. Must tolerate being called on a phone with no active session for this flow.
- `describeStatus(state)` — required if `capabilities.status` is true. Returns the STATUS text for the flow's current state.
- `describeHelp()` — optional. Overrides the auto-generated help text (which otherwise just lists the flow's declared `commands` plus the global commands).

---

## 4. Routing Pipeline

This is the authoritative, frozen routing order. Any change to this order is a platform-level change and needs its own ADR — it is not something an individual flow migration should alter.

```
Incoming message
        │
        ▼
Global navigation           (HOME / MENU / HELP / CANCEL / BACK — answered
                              directly, same meaning regardless of active flow)
        │
        ▼
STATUS resolution            (resolveStatusOwner() — flow-owned if capabilities.status,
                              else falls back to account/quota; preempts an open menu)
        │
        ▼
Menu resolution               (claims only replies that resolve to a defined option;
                              an unmatched numeric reply is its own distinct outcome —
                              re-render, stay open — never falls through)
        │
        ▼
Active workflow               (only reached once platform commands, STATUS, and
                              menu resolution have all declined the message)
        │
        ▼
Workflow discovery            (left to the caller — NavigationService does not
                              resolve which flow a fresh command belongs to)
        │
        ▼
AI fallback
```

Key ordering facts worth calling out explicitly, since they were the actual defects fixed by this precedence rewrite:

- **STATUS is deliberately not a member of `GLOBAL_COMMANDS`.** The five platform commands mean the same thing no matter which flow is active. STATUS does not — its meaning is flow-owned. It gets its own pipeline stage, ahead of menu/workflow resolution, so a teacher can always ask STATUS, including while a completion menu is open — without STATUS ever being treated as if it belonged to NavigationService itself.
- **An open menu is checked before the active workflow**, not after. Prior to this fix, `active_flow` was checked first, which meant a menu opened while a flow was technically still "active" was unreachable — the workflow would swallow the reply the menu should have claimed.
- **An invalid numeric reply against an open menu is a distinct outcome from "no menu open."** It re-renders the menu and stays there; it never falls through to the active workflow, even when one exists underneath.

---

## 5. Menu Lifecycle

**Creation.** `openMenu()` replaces any existing menu unconditionally — menus never stack.

**Active state.** While open, a menu claims any numeric reply ahead of the active workflow (see §4).

**Valid selection.** Resolves to the mapped semantic action. If `expiresAfterReply` is true (the default), the menu is destroyed as part of consuming the reply.

**Invalid selection.** A numeric reply that doesn't match any option in the open menu is its own outcome — the menu re-renders and stays open. This is distinct from "no menu open at all," which is a separate collision-guard message.

**Replay.** A message delivered again after the original selection has already been consumed does not re-fire the action. It receives the same response as "no menu open" — the menu is gone, so there's nothing to replay against.

**Timeout.** Menu timeout/staleness is a flow-level session concern (same as flow session timeouts generally), not something NavigationService tracks independently — a stale flow session dropping means any menu tied to it is gone too.

**HOME.** Destroys any open menu unconditionally, as part of its cleanup sweep across all registered flows.

**CANCEL.** NavigationService centrally answers CANCEL for flows with `capabilities.cancel`, but does **not** itself decide what CANCEL does to an open menu — that's left to the caller/flow to handle alongside the confirmation. (See `assessment-completion-menu.test.js` §7 for the reference behavior: CANCEL at `COMPLETE_MENU` clears the session like any other step.)

**Invariants:**
- Never more than one open menu per phone at a time.
- A consumed or replaced menu cannot be replayed against.
- An invalid reply against an open menu never reaches the active workflow.
- STATUS never consumes or closes an open menu, even when it preempts it.

---

## 6. Responsibilities

| NavigationService owns | Flow owns |
|---|---|
| Routing precedence | Business logic |
| Menu lifecycle (create/consume/destroy/replay-safety) | Semantic meaning of each menu option |
| STATUS ownership resolution | Rendering / message formatting |
| HOME/CANCEL cleanup orchestration | Domain state (session data, DB writes) |
| Numeric reply → semantic action resolution | Action implementation (what actually happens when an action fires) |

This separation is the core theme running through ADR-019: NavigationService answers "whose turn is it to handle this message and what did the user select," never "what should happen as a result."

---

## 7. Assessment: Reference Implementation

`flows/assessmentSessionFlow.js`, registered in `routes/webhook.js`, is the canonical example — not to be copied verbatim, but as the reference for how each contract element gets used in practice:

- **Flow registration** — `registerFlow({ id: 'assessmentSession', commands: [...], capabilities: { cancel: true, status: true }, hooks: {...} })` in `routes/webhook.js`.
- **STATUS hook** — `hooks.describeStatus` delegates to the flow's existing capture-status renderer; STATUS/CANCEL logic in `assessmentSessionFlow.js` itself now has a single authoritative execution path through NavigationService, with no conditional fallback branches (ADR-019 Step 3, Commit 4 removed the last of the transitional guards).
- **Cleanup hook** — `hooks.cleanup` clears any active capture session for the phone on HOME.
- **Completion menu** — on capture completion, the session moves to `COMPLETE_MENU` (not deleted) and opens a two-option menu (new assessment / print) folded into the same completion message. See `tests/assessment-completion-menu.test.js` for the full behavioral spec: digit and literal-command entry both work identically, invalid input re-renders without falling through, RESUME re-renders without consuming, and STATUS resolves ahead of the menu without closing it.
- **Semantic action mapping** — the menu maps `1`/`NEW TEST` → restart capture, `2`/`PRINT` → print sub-flow, rather than exposing raw digits to the flow's state machine.

---

## 8. Migration Audit

Findings from direct inspection of `flows/*.js` (line counts, state-machine step counts, menu-pattern greps, local STATUS/CANCEL handling), not estimates.

| Flow | Session | Menu | Local STATUS | Local CANCEL | Migration Priority |
|---|---|---|---|---|---|
| `curriculumQueryFlow` | No | No | No | No | Not applicable |
| `tseMyGrowthFlow` | No | No | No | No | Not applicable |
| `qmsFlow` | No | No | No | No | Compatible, but low learning value |
| `worksheetFlow` | Minimal | No | No | No | Low |
| `growthPlanFlow` | Yes | Yes | No | Yes | **Recommended next migration** |
| `reflectionFlow` | Yes | Yes | No | Yes | Medium |
| `profileUpdateFlow` | Yes | Yes | No | Yes | Medium |
| `rosterFlow` | Yes | Yes | No | Yes | High-value after Growth Plan |
| `observationFlow` | Yes | Yes | No | Yes | Defer (largest) |
| `workspaceFlow` | Dispatcher | No | No | No | Separate architecture |
| `assessmentFlow` / `assessmentSessionFlow` | Yes | Yes | Migrated | Migrated | Complete (reference implementation) |

**Architectural lesson worth preserving exactly:** QMS is not the best second migration because it is *too simple*, not because it is too complex. A second migration needs to exercise aspects of the platform Assessment didn't — a stateless command dispatcher validates almost nothing new. `growthPlanFlow` is the strongest candidate: a genuine (small) session state machine with a menu-like correction prompt and locally-handled CANCEL, substantially smaller than Assessment, giving a real second data point on what's generic platform behavior versus what was specific to Assessment — without observationFlow's scale or rosterFlow's numbered-menu complexity yet.

---

## 9. Migration Playbook

A repeatable checklist, generalized from the actual ADR-019 commit sequence:

1. **Audit the flow** — session state? menu-like prompts? local STATUS/CANCEL handling? (See §8's method — grep for `step ===`, `'STATUS'`, `'CANCEL'`, numbered-option patterns.)
2. **Register the FlowDefinition** — `registerFlow({ id, commands, capabilities, hooks })` at module load, per §3.
3. **Add hooks** — at minimum `cleanup`; add `describeStatus` if `capabilities.status` is set.
4. **Delegate STATUS/CANCEL** — replace the flow's local handling with calls through NavigationService's central resolution. Keep transitional fallback branches during this step if the old and new paths need to coexist briefly.
5. **Remove transitional code** — once the registration is proven safe (tests green, both paths verified equivalent), delete the fallback branches. Audit what else becomes dead code as a result before removing it (see ADR-019 Step 3, Commit 4 for the pattern: audit each removal candidate individually, don't assume).
6. **Introduce menus** (if applicable) — fold menu prompts into existing messages rather than sending separate ones; define the semantic action mapping; verify single-consume and replay-safety with dedicated tests mirroring `assessment-completion-menu.test.js`.
7. **Verify tests** — full suite green, not just the new flow's tests. Add explicit tests for: menu lifecycle if applicable, STATUS-while-menu-open interaction, CANCEL from every reachable step, no regression to flows that were already passing.
8. **Tag a rollback point** — `git tag -a <flow>-navigationservice-complete -m "..."` once the migration is verified, same pattern as `adr019-step3-complete-plus-menu`.
