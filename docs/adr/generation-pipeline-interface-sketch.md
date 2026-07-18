# Generation Pipeline Interface Sketch

**Status:** Draft — informs the eventual ADR-003 (or an amendment to
ADR-002) once implementation begins.
**Purpose:** Documents the `triggerGeneration()` public API, derived from
evidence gathered against the current six call sites of `processGeneration()`,
before any implementation code is written.
**Related:** `generation-pipeline-analysis.md` (dependency evidence),
`ADR-002-generation-pipeline.md` (extraction boundary decision).

This document separates what the evidence has established with confidence
from what remains an open, non-binding design direction. Only the former
should be treated as settled going into implementation.

---

## Stable — evidence-backed

### Parameter shape

```js
await triggerGeneration({ from, intent, originalText, deps });
```

- `from` and `intent` are supplied at all six current call sites; `intent`
  is always a fully-classified plain object, never partial or raw text.
- `originalText` is optional — only one of six call sites (line 2468)
  provides it; the rest rely on the existing `= null` default.
- `deps` is a new dependency-injection seam, not a refactor of an existing
  parameter. No call site today passes a fourth argument — `processGeneration()`
  currently reaches module-level closures directly for every service,
  infrastructure function, and session store it needs.
- No call site passes anything outside these four categories (no flags, no
  callbacks, no extra session objects) — checked against all six sites.

### Ownership boundaries

- **Pipeline owns `last_intent` persistence.** Five of six call sites
  currently call `updateTeacherProfile(from, { last_intent: ... })`
  immediately before invoking generation; the RETRY path (line 1630) is the
  one exception, and investigation confirmed this is a genuine latent bug,
  not an intentional optimization — RETRY mutates `lastIntent.regenerate`
  in memory for `quickQuiz` but never persists it back, so `last_intent` in
  the database silently diverges from what was actually generated.
  Centralizing this write inside `triggerGeneration()` removes the
  duplication and fixes the inconsistency as a side effect.
- **Caller owns `pendingIntentState` cleanup.** Deletion of pending intent
  state reflects dispatcher/conversation-state semantics (which command
  consumed the pending state, and why), not generation state. The pipeline
  publishes to `pendingIntentState` in one case (post-explanation
  disambiguation offer) but has no basis for owning its cleanup — different
  callers consume pending state for different reasons.
- Both `lastGeneratedState` and `pendingIntentState` are publisher/consumer
  contracts, not bidirectional coupling — full evidence in
  `generation-pipeline-analysis.md`.

### Control-flow contract

- `triggerGeneration()` is observationally equivalent to `Promise<void>`.
  None of the six existing callers inspect a return value or branch on one.
- Every exit point in `processGeneration()`'s current body is a bare
  `return;` — seven exit points checked, zero exceptions.
- No `throw` statements exist in the function body. All expected failure
  modes (rate limiting, Pro-gating, quota exceeded, AI generation failure,
  delivery failure) are caught internally and converted into a
  `safeSendMessage()` to the teacher, not surfaced to the caller.
- `worksheetFlow.js` — the one flow module that already anticipates calling
  `triggerGeneration()` — documents this explicitly in its own JSDoc:
  `triggerGeneration, // async (from, intent) => void`. This is direct
  evidence from the codebase, not inference.
- **No behavioral change at any of the six call sites** other than the
  invocation shape (`processGeneration(from, intent, text)` →
  `triggerGeneration({ from, intent, originalText: text, deps })`).

---

## Deferred — non-binding, not yet evidence-backed

The following were discussed as possible future directions but are
explicitly **not** part of the interface contract at this stage. None of
the current evidence demonstrates one of these is preferable to the
others — that comparison hasn't been done yet, and shouldn't be implied by
this document.

- Whether `triggerGeneration()` returns `Promise<void>` permanently, or
  evolves to something like `Promise<GenerationOutcome>` (a discriminated
  union such as `{ outcome: 'sent' | 'rate_limited' | 'quota_exceeded' |
  'generation_failed' | 'delivery_failed' | ... }`).
- Whether improved observability — if wanted later — comes from a
  structured return value, emitted events, instrumentation hooks, or
  dedicated test helpers. These are different mechanisms with different
  tradeoffs and have not been compared against each other.

If and when observability becomes a real need (e.g. a future orchestration
layer, or tests that currently have to assert against mocked
`safeSendMessage` calls), that decision should be made on its own evidence
at that time — not smuggled in as part of this extraction.

---

## Migration note (implementation detail, not architecture)

`flows/worksheetFlow.js` currently documents and calls generation with a
**positional** signature:

```js
await triggerGeneration(from, intent);
```

This was written before ADR-002's object-parameter shape was decided, while
`triggerGeneration` was still just an alias for `processGeneration`. During
the actual pipeline extraction, this call site (and its JSDoc comment at
lines 26–33) will need a mechanical update to the object shape:

```js
await triggerGeneration({ from, intent, originalText, deps });
```

This is not a behavioral change — just a call-site update that should not
be rediscovered mid-implementation.
