# ADR-002: Generation Pipeline Boundary

**Status:** Accepted (design phase — implementation not yet started)

## Context

`processGeneration()` in `routes/webhook.js` (lines 2482–2766) is the
shared function every resource-generating flow ultimately calls to turn an
`intent` into AI-generated content, deliver it, optionally attach a PDF,
and record it for the SAVE command. It is 285 lines, called from six sites
in `webhook.js`, and is the largest remaining piece of generation-adjacent
logic still living outside `flows/`.

Unlike the four prior extractions (see ADR-001), `processGeneration()` is
not a conversational flow with its own multi-turn state — it is shared
infrastructure invoked by many flows (and, eventually, by extracted flow
modules via the `triggerGeneration` placeholder already wired into
`buildWorksheetDeps()`). Treating it as a flow extraction would have been
the wrong model. This ADR treats it instead as an infrastructure
extraction, informed by a full dependency and call-graph analysis rather
than by applying the ADR-001 pattern by assumption.

Full supporting evidence: `generation-pipeline-analysis.md`.

## Decision

Extract `processGeneration()` and its generation-exclusive helpers into
`core/generationPipeline.js`, exposed as a single public function:

```js
await triggerGeneration({ from, intent, originalText, deps });
```

### What moves into the pipeline

Per the analysis document's "Summary: what moves, what stays":

- The full body of `processGeneration()`
- `buildPdfUrl`, `hasExplicitExplanationKeyword` (generation-exclusive
  local helpers, no external call sites)
- `pdfEligible`, `saveableTypes` arrays (generation-exclusive, no external
  call sites)
- All three `setTimeout` follow-up blocks (explanation disambiguation
  nudge, quiz retry nudge, SAVE reminder nudge — all generation-exclusive)

### What stays external, injected as dependencies

- **Business services:** `buildPrompt`, `generateContent`, `generatePdf`
- **Shared utility helpers:** `gradeLabel`, `getWorksheetTotalMarks`,
  `intentLabel` — cross-cutting formatting/labeling helpers used across
  multiple flow modules and non-generation call sites within
  `webhook.js` itself (`intentLabel` has 3 non-generation call sites in
  `webhook.js`, at the SAVE lifecycle and MY RESOURCES display logic;
  it has no call sites in `flows/*.js` today, correcting an earlier,
  unverified claim in this ADR that it was shared with
  `worksheetFlow.js`/`assessmentFlow.js`)
- **Infrastructure:** `sendDocument`, `safeSendMessage`, `hashPhone`,
  `getTeacherByPhone`, `isProActive`, `checkAndIncrementUsage`,
  `rollbackUsage`, `isAiRateLimited`, `FREE_LIMIT_DISPLAY`, `getDb`
- **Standalone domain utility (imported directly, not injected):**
  `validateAtpWeeks` — pure, independently unit-tested, own module
  (`utils/atpWeekValidator.js`); generation-exclusive today but not
  generation-owned. See `generation-pipeline-analysis.md` for the full
  reclassification evidence.

### What is passed in as shared state, not owned

- `lastGeneratedState` — the pipeline publishes exactly one write
  (`saveState: 'GENERATED'`, with a minted `generationId`) at the end of a
  successful generation. It does not read this state for any control-flow
  decision.
- `pendingIntentState` — the pipeline publishes the post-explanation
  disambiguation offer; the dispatcher's WORKSHEET/TEST/LESSONPLAN
  follow-up handlers (remaining in `webhook.js`) consume it.

Both stores are publisher/consumer contracts, not bidirectional
coupling — see the analysis document's session-store section for the full
evidence trail establishing this.

### Public API

```js
await triggerGeneration({ from, intent, originalText, deps });
```

- Returns void — matches the current `processGeneration()` contract. No
  change to callers beyond the function name and the `deps` parameter.
- `deps` is built by a `buildGenerationDeps()` factory remaining in
  `webhook.js`, following the exact same pattern as
  `buildObservationDeps()`, `buildWorkspaceDeps()`, `buildWorksheetDeps()`,
  and `buildAssessmentDeps()` — no new dependency-injection pattern
  introduced for this extraction.

## Non-goals

This extraction explicitly does **not**:

- Own the SAVE lifecycle. The `GENERATED → SAVING → RECOVERABLE → SAVED`
  state machine (webhook.js ~1688–1854) remains where it is. It is a
  downstream consumer of `lastGeneratedState`, not part of the pipeline.
  It is a separate future extraction candidate in its own right, given its
  size (101 passing tests in `phase-b5-concurrency.test.js` alone).
- Own quota or rate-limiting implementation. `checkAndIncrementUsage`,
  `rollbackUsage`, `isAiRateLimited`, and `FREE_LIMIT_DISPLAY` remain
  general infrastructure, injected into the pipeline like any other
  dependency. Absorbing them would wrongly couple unrelated flows (report
  comments, parent messaging, intervention plans) to the generation
  subsystem.
- Own worksheet, assessment, workspace, or observation state. Those
  modules already own their own state per ADR-001 and are unaffected by
  this extraction.
- Own onboarding. Already lives in `services/onboardingService.js`, per
  ADR-001's negative-case findings.
- Resolve the `pdfEligible`/`saveableTypes` array duplication noted in the
  analysis document. Both arrays move in as-is; deduplicating them is a
  separate, smaller cleanup.
- Move `intentLabel` out of `webhook.js`. It has 3 call sites, but all 3
  are within `webhook.js` itself (SAVE lifecycle, MY RESOURCES display) —
  not spread across other modules, correcting an earlier unverified claim
  in this section. Moving it into the pipeline would still just relocate
  the coupling rather than remove it, since the pipeline is not its only
  consumer. A future `utils/intentLabel.js` extraction remains the
  correct fix, out of scope here.

## Alternatives considered

**Bundle SAVE lifecycle into the pipeline (Option B in the original
discussion).** Rejected. The analysis confirmed `processGeneration()`
writes to `lastGeneratedState` exactly once, at the end, and never reads it
for control flow. SAVE's state machine has no participation from
generation beyond that one write. Bundling them would create an
unnecessarily large module and mix two lifecycles (generate; separately,
maybe-later save) that the evidence shows are not actually intertwined.

## Consequences

- `routes/webhook.js` loses its single largest remaining function
  (~285 lines), continuing the reduction trend from ADR-001's four
  extractions.
- Six call sites in `webhook.js` are updated to call `triggerGeneration()`
  with `buildGenerationDeps()`, following the established pattern exactly.
- The `worksheetFlow.js` `triggerGeneration` placeholder (currently pointed
  at `processGeneration` via `buildWorksheetDeps()`) becomes a real
  cross-module call for the first time — this is the first extraction
  where a previously-extracted flow module will actually invoke the new
  module, rather than everything still routing through `webhook.js`.
- SAVE lifecycle extraction remains open as a natural follow-up, now
  clearly scoped by this ADR's non-goals rather than left ambiguous.

## Related

- `generation-pipeline-analysis.md` — full evidence: call graph, dependency
  inventory, session-store ownership analysis
- `ADR-001-flow-boundaries.md` — the flow-extraction pattern this ADR
  deliberately does not reuse, and why
- `PROJECT_STATUS.md` — extraction history and current metrics
