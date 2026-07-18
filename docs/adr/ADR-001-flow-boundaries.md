# ADR-001: Flow Module Boundaries

**Status:** Accepted (retroactive — documents a pattern already implemented
across four extractions before this ADR was written)

## Context

`routes/webhook.js` grew to 3390 lines by accumulating every conversational
flow, command handler, and piece of shared infrastructure in one file. This
made the file hard to navigate, hard to test in isolation, and increased the
risk that a change to one flow would accidentally affect another.

Four extractions were carried out before this document was written:
observationFlow, workspaceFlow, worksheetFlow, and assessmentFlow. This ADR
records the boundary rule that was applied in each case, so future
extractions (and anyone reviewing the resulting `flows/` directory) can see
why the boundary was drawn where it was, and apply the same rule
consistently.

## Decision

A block of code in `routes/webhook.js` qualifies as an extractable **flow
module** when it has:

1. **Its own multi-turn conversation state** — typically a dedicated
   `SessionStore` instance that no other flow reads or writes.
2. **A recognizable entry point** — either an existing top-level function
   (`handleXFlow`), or a clearly bounded inline command block with
   identifiable start/end markers in the dispatcher.
3. **No dependency on other flows' internal state** — a flow extraction must
   not require reaching back into `webhook.js` for state owned by another
   flow. Cross-cutting concerns (quota, rate limiting, teacher profile
   lookups, message sending) are acceptable as **injected dependencies**,
   not as reasons to keep the flow inline.

Each extraction follows the same shape:

- The flow's logic moves into `flows/<name>Flow.js` as
  `handle<Name>Flow(from, text, ..., deps)`.
- `deps` is built by a `build<Name>Deps()` factory function that remains in
  `webhook.js`, returning a frozen object of everything the flow needs
  (session stores, shared helpers, service functions).
- The flow module has **no reverse dependency on `webhook.js`** — it never
  `require()`s anything from the file it was extracted from.
- Call sites in `webhook.js` are updated to call the new function with
  `build<Name>Deps()` passed in.
- The full test suite is run after each extraction to confirm zero behavior
  change before committing.

## What does *not* qualify as a flow module

Investigation before extracting `lessonPlanFlow` and `onboardingFlow`
(see `PROJECT_STATUS.md`, "Roadmap adjustments") established two negative
cases worth recording as part of this boundary rule:

- **Thin routing into shared infrastructure is not a flow.** A resource
  type that is just one branch of a shared pipeline (e.g. `lessonPlan`
  going through `processGeneration()` alongside `worksheet`, `test`, `atp`,
  etc.) is not extractable as its own flow — extracting it would either
  duplicate the shared pipeline or leave the extraction incomplete. This
  work belongs to the shared-infrastructure extraction instead (see
  ADR-002).
- **Already-extracted logic living in `services/` is not a pending
  extraction.** `onboardingFlow` was assumed to be a roadmap item, but the
  onboarding state machine already lived in `services/onboardingService.js`
  from before this modularisation effort began. `webhook.js`'s only
  involvement was a two-line delegation call. Confirming this before
  writing an extraction script avoided doing unnecessary (and
  architecturally meaningless) work.

The lesson: **verify a boundary exists in the code before scripting an
extraction against it.** Grep for the handler function, the session store,
and the call sites first. If any of the three is missing or shared with
other flows, it is not a standalone flow module.

## Consequences

- `flows/` now contains four self-contained modules, each independently
  testable and each with a clear, injected dependency surface.
- `routes/webhook.js` shrank from 3390 to 2840 lines (~16.2%) across the
  four extractions, with zero test regressions at any step.
- The dependency-injection pattern (`deps` object + `build<Name>Deps()`
  factory) is now the established convention for any future flow
  extraction.
- The roadmap was revised from an assumed seven-item list down to the four
  extractions that were actually real, plus one remaining piece of shared
  infrastructure (`generationPipeline` — see ADR-002).

## Related

- `docs/adr/generation-pipeline-analysis.md` — dependency inventory for the
  next (and architecturally different) extraction
- `docs/adr/ADR-002-generation-pipeline.md` — decision record for the
  shared generation pipeline boundary
- `PROJECT_STATUS.md` — extraction history and current metrics
