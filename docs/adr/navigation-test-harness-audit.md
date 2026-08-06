# ADR-019 Navigation Test-Harness Audit & Migration Checklist

Date: 2026-08-05
Trigger: growthPlanFlow.test.js crashed with `Cannot read properties of null
(reading 'hooks')` because the test required `flows/growthPlanFlow.js`
directly and never ran `routes/webhook.js` (the composition root), so
`NavigationService`'s registry was empty when the CANCEL branch called
`navigationService.getFlowDefinition('growthPlan').hooks.cleanup(...)`
with no null-check.

Current status: The original crash has been resolved. This document now
tracks the remaining migration work and architectural decisions resulting
from that incident.

> **Scope note:** This audit reflects the repository snapshot dated
> 2026-08-05. Where later commits have already addressed an item (for
> example, the growthPlan test-harness registration fix drafted earlier
> in this thread), those fixes are intentionally described as follow-up
> work rather than assumed to exist in this snapshot. Re-run the
> classification against `main` before relying on this table's current
> statuses.

## Audit status

- Current as of repository snapshot: 2026-08-05 (post-Recommendation-2 fix)

**Migration progress**
- Migrated flows reviewed: 2
- Registration duplication: Yes (temporary) — will read "No (shared
  helper)" once registration is extracted into shared infrastructure

**Platform state**
- Platform invariant: Adopted (Strict registration)
- Platform consistency: ✅ Uniform (`growthPlan` and `assessmentSession`
  both Strict)

**Outstanding work**
- Crash risks: 0 — both `growthPlan` and `assessmentSession` test
  harnesses now register the flow before CANCEL/STATUS is exercised
- Coverage gaps: 0 — both flows' CANCEL/STATUS tests exercise the real
  NavigationService-registered path

## Method

`grep -rn "getFlowDefinition(" flows/ tests/` finds every call site.
Each is classified against three questions:

1. **Harness** — does the flow's test file execute the composition root
   (`routes/webhook.js`), or call `registerFlow()` itself, so the registry
   is populated under test?
2. **`.hooks` access** — does the flow's CANCEL/STATUS branch guard the
   result of `getFlowDefinition()` before touching `.hooks`, or dereference
   it unguarded?
3. **Coverage** — does an existing test actually exercise the CANCEL/STATUS
   path for that flow?

Only two flows call `getFlowDefinition()` at all today (the rest of the
codebase hasn't been migrated onto NavigationService yet, so this list
will grow as ADR-019 continues):

> This table is intentionally cumulative. Each NavigationService migration
> adds one row, allowing reviewers to track migration progress and verify
> that test-harness expectations evolve alongside production behavior.

| Flow | Harness | `.hooks` access | CANCEL | STATUS | Classification |
|---|---|---|---|---|---|
| `growthPlan` | **Fixed** — `createDeps()` in `tests/growthPlanFlow.test.js` now calls a `registerGrowthPlanFlow(growthPlanState)` helper that mirrors the `routes/webhook.js` registration byte-for-byte, so every test's fresh `growthPlanState` is registered with `NavigationService` before CANCEL/STATUS is exercised | **Unguarded** (`flows/growthPlanFlow.js:133,140` — `getFlowDefinition(...).hooks.cleanup` / `.hooks.describeStatus`, no `?.`) — still unguarded by design; the platform invariant decision (below) determines whether that's correct long-term | Yes (8 assertions, now against a populated registry) | Yes — 4 new assertions across all four mid-flow steps (`awaitingGoal`, `awaitingTopic`, `reviewSummary`, `awaitingCorrectionChoice`), verifying the handled flag, message count, step-label content, no-save, and no-state-clear | **Resolved** — CANCEL and STATUS both now exercise the real `NavigationService`-registered path; no crash risk and no coverage gap remains for this flow. Classified **Strict registration**, now the adopted platform-wide policy (unguarded `.hooks` access is intentional under that policy) |
| `assessmentSession` | **Fixed** — `tests/assessment-session-flow.test.js` now calls a `registerAssessmentSessionFlow(assessmentSessionState, describeAssessmentSessionStatus)` helper that mirrors the `routes/webhook.js` registration byte-for-byte, registered before CANCEL/STATUS is exercised | **Unguarded** (`flows/assessmentSessionFlow.js` — CANCEL now calls `getFlowDefinition('assessmentSession').hooks.cleanup(phoneHash)` directly; STATUS calls `getFlowDefinition('assessmentSession').hooks.describeStatus(phoneHash)` directly when `owner.owner === 'flow'`; the prior `def?.` guards and defensive fallbacks have been removed) | Yes (session-removed assertion now against a populated registry) | Yes (learner-count/progress assertions now against a populated registry) | **Resolved** — CANCEL and STATUS both now exercise the real `NavigationService`-registered path; no crash risk and no coverage gap remains for this flow. Now classified **Strict registration**, matching `growthPlan` |

## Findings

- **growthPlan's CANCEL** was the confirmed root cause of the original
  crash. The fix has now landed in `tests/growthPlanFlow.test.js`:
  `createDeps()` calls `registerGrowthPlanFlow(growthPlanState)`, which
  registers a FlowDefinition mirroring `routes/webhook.js`'s registration
  (id, capabilities, menus, hooks) against `NavigationService` before any
  flow interaction happens. Because `registerFlow()` is idempotent
  (re-registering an id overwrites the previous definition), each test's
  own fresh `growthPlanState` is safely rebound without leaking between
  tests — all 8 CANCEL assertions now exercise the real registered path
  instead of the previously-empty registry.
- **growthPlan's STATUS** branch had the identical unguarded shape
  (`getFlowDefinition('growthPlan').hooks.describeStatus`) but no test
  exercised it. Four new STATUS assertions now cover it — one per
  mid-flow step (`awaitingGoal`, `awaitingTopic`, `reviewSummary`,
  `awaitingCorrectionChoice`) — verifying the handled flag, that exactly
  one new message is sent, that its content reflects the correct step
  label, and that state is neither saved nor cleared by STATUS. Full
  suite: 65 passed, 0 failed.
- **assessmentSession** has been converted from Graceful fallback to
  Strict registration (ADR-019 Recommendation 2, 2026-08-05). Both
  `flows/assessmentSessionFlow.js` CANCEL and STATUS branches now
  dereference `getFlowDefinition('assessmentSession').hooks` directly,
  with no `def?.` guard and no defensive fallback — the same shape as
  `growthPlan`. `tests/assessment-session-flow.test.js` now calls
  `registerAssessmentSessionFlow()` (mirroring the `routes/webhook.js`
  registration byte-for-byte) before any CANCEL/STATUS assertion runs.
  Full suite: 34 passed, 0 failed, now exercising the real
  NavigationService-registered path instead of the old fallback.
- No other flow module (`rosterFlow.js`, `qmsFlow.js`, `reflectionFlow.js`,
  `observationFlow.js`, etc.) calls `getFlowDefinition()` — they haven't
  been migrated onto NavigationService yet, so they're out of scope until
  their own ADR-019 step.

## Remaining architectural blocker

~~**Recommendation 2** is now the primary unresolved item for ADR-019.
Until the platform invariant is decided, newly migrated flows should be
classified against the current observed behavior but should not introduce
a third registration policy.~~ **Resolved** (2026-08-05) — Strict
registration adopted; `assessmentSession` converted to match `growthPlan`.
See Findings above and the Platform invariant section below.

The next real follow-up is the shared-registration-helper extraction
described under "Known technical debt" — registration is still
byte-for-byte duplicated between `routes/webhook.js` and each flow's test
harness (`registerGrowthPlanFlow()`, `registerAssessmentSessionFlow()`).
That extraction is tracked there, not as a platform-invariant blocker.

## Platform invariant

**Status:** Adopted

**Chosen policy:**
- [x] Strict registration
- [ ] Graceful fallback

**Decision recorded in:** ADR-019 Commit (assessmentSession Strict
conversion, 2026-08-05)
**Decision date:** 2026-08-05

All flows migrated under ADR-019 should follow a single platform-wide
policy for how they behave when a FlowDefinition has not been registered.
Exactly one of the following contracts should be adopted:

- **Strict registration** — all migrated flows require successful
  registration before execution. Missing registrations are programmer
  errors and may fail immediately (current `growthPlan` behavior).
- **Graceful fallback** — all migrated flows tolerate a missing
  FlowDefinition through a documented fallback path until registration
  becomes available (current `assessmentSession` behavior).

Individual flows should not implement different policies, as that creates
inconsistent runtime behavior and inconsistent test semantics. This is the
open architectural question the recommendations below are built around.
Once a policy is chosen, update the Status/Chosen policy/Decision fields
above so reviewers can tell at a glance whether the decision has been made.

## Recommendations before continuing ADR-019

1. ~~Land (or re-confirm) the `growthPlanFlow.test.js` registration fix for
   CANCEL, and add the equivalent registration for a new STATUS test before
   `describeStatus` gets exercised for real — otherwise it will reproduce
   today's crash under a different command.~~ **Done** (2026-08-05) — see
   Findings and the `growthPlan` table row above.
2. ~~**Resolve the platform invariant above** (the table below records the
   *current observed state* of each migrated flow — it is not expected to
   already match the target architecture). Once the invariant is adopted,
   update all currently migrated flows to conform to it, and revise each
   flow's classification in the table accordingly.~~ **Done** (2026-08-05)
   — Strict registration adopted; `assessmentSession`'s CANCEL/STATUS
   branches converted to unguarded `.hooks` access, matching `growthPlan`.
   See Findings and the `assessmentSession` table row above.
3. ~~**Make each flow test's contract explicit rather than ambiguous.** For
   `assessmentSession` specifically: if `tests/assessment-session-flow.test.js`
   is meant to verify NavigationService integration, register the flow so
   the test exercises the real migrated path. If it's meant to verify the
   legacy fallback behavior, rename the test (or add a comment) so future
   readers know that's the contract being exercised — right now it's
   silently doing the latter while looking like it does the former.~~
   **Done** (2026-08-05) — subsumed by the Strict conversion above; the
   test now registers the flow, so it exercises the real migrated path
   unambiguously.
4. When a new flow is migrated onto `NavigationService.getFlowDefinition()`,
   complete this checklist before merging. It's split by who owns each
   box: migration tasks are the implementer's; review gates are what a
   reviewer verifies before approving.

   **Migration tasks**
   - [ ] add FlowDefinition registration in `routes/webhook.js`
   - [ ] mirror the registration in the flow's test harness (or import
     from a shared helper, once one exists)
   - [ ] classify the flow's `.hooks` access (guarded vs. unguarded)
   - [ ] add/verify CANCEL coverage
   - [ ] add/verify STATUS coverage
   - [ ] append or update this flow's row in the audit table

   **Review gates**
   - [ ] test-harness registration matches production wiring
     byte-for-byte (or both import the same shared helper)
   - [ ] flow conforms to the platform invariant (once decided)
   - [ ] audit table accurately reflects the implementation in the same
     commit
   - [ ] Exit criteria below still hold

## Maintenance

This document is intended to evolve alongside ADR-019. Existing rows may
change as platform decisions are finalized; reviewers should update
classifications rather than treating earlier assessments as permanent.
When a flow's registration block changes in `routes/webhook.js`, verify
that any mirrored test-harness registration remains in sync until
registration is extracted into shared infrastructure. See Known technical
debt below for the full picture of this duplication.

## Known technical debt

### FlowDefinition registration duplication

Until FlowDefinition registration is extracted into shared infrastructure,
the registration for each migrated flow exists in two places:

- `routes/webhook.js`
- the corresponding test harness

These registrations are intentionally duplicated so the test harness
mirrors the production composition root until registration is extracted
into shared infrastructure.

Any modification to one registration must be reflected in the other.
Any divergence between production and test registration should be treated
as a correctness defect, because it invalidates the test harness as a
faithful representation of production wiring.

### Synchronization rule

Until registration is extracted into shared infrastructure:

- The registration in `routes/webhook.js` is the source of truth.
- Any change to FlowDefinition registration in `routes/webhook.js` must be
  mirrored in the corresponding test harness within the same pull request.
- Reviewers should reject PRs that modify one registration without the
  other.

**Planned removal:** ADR-019 follow-up — extract registration into shared
infrastructure (e.g. a `navigation/registerGrowthPlan.js`-style helper that
both `routes/webhook.js` and the flow's test file import), eliminating the
duplication entirely. (Link the specific ADR/issue/milestone here once one
exists — until then this note is the only tracking reference.)

## Next review trigger

Re-run this audit whenever:

- a new flow adopts `NavigationService.getFlowDefinition()`
- the platform invariant changes
- FlowDefinition registration is refactored
- the shared registration helper is introduced

## Document lifecycle

This audit begins as a migration tracker.

As additional flows migrate:
- append new rows;
- update classifications as platform decisions land;
- remove resolved risks rather than preserving historical states.

Once ADR-019 is complete and all migrated flows share the same platform
invariant, this document should be archived and replaced by the final
ADR implementation notes.

## Exit criteria

This audit is complete when:

- all migrated flows are represented in the table;
- each migrated flow has an explicit classification;
- test harnesses intentionally mirror either production registration or
  documented fallback behavior — no flow's test wiring is accidentally
  exercising one path while appearing to test the other;
- no migrated flow's expected registration semantics (throw-if-missing vs.
  fallback-if-missing) are left implicit — each is a deliberate, documented
  choice consistent with the platform-wide invariant decided in
  Recommendation 2.
