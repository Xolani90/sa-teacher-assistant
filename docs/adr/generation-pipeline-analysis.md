# Generation Pipeline Analysis

Supporting evidence for ADR-002. This document is a technical inventory of
`processGeneration()` as it exists in `routes/webhook.js` (currently at
lines 2482–2766), gathered by reading the full function body and grepping
every call site of each dependency across `routes/webhook.js` and
`flows/*.js`. It answers what the function calls, what state it reads and
writes, which side effects are generation-exclusive vs. shared with other
flows, and which responsibilities should move together into
`core/generationPipeline.js`.

This is a living document — if implementation surfaces a dependency missed
here, update this file rather than treating the gap as a surprise.

## Call graph

Six call sites, all currently inside `routes/webhook.js` (no cross-module
callers yet, despite `worksheetFlow.js` referencing `processGeneration` in
comments as a future `triggerGeneration` target):

- line 1630
- line 2026
- line 2041
- line 2056
- line 2312
- line 2468

`processGeneration()` itself is defined at line 2482 and returns void — it
is a pure side-effect function, not a value-returning one.

## Core services (business logic — inject)

| Dependency | Source |
|---|---|
| `buildPrompt` | `services/promptService` |
| `generateContent` | `services/aiService` |
| `generatePdf` | `services/pdfService` |
| `validateAtpWeeks` | `utils/atpWeekValidator` |
| `getWorksheetTotalMarks` | `utils/capsPhase` |

## Infrastructure (shared — inject)

| Dependency | Source | Notes |
|---|---|---|
| `sendDocument` | `services/whatsappService` | |
| `safeSendMessage` | local wrapper in webhook.js (line 185) | wraps `sendMessage` |
| `hashPhone`, `getTeacherByPhone`, `isProActive` | `utils/usageTracker` | |
| `checkAndIncrementUsage`, `rollbackUsage` | `utils/usageTracker` + local wrapper | used by 5+ other flows, not generation-exclusive |
| `isAiRateLimited` | local (webhook.js line 146) | also called at line 2428 (conversational-response gating, outside generation) |
| `checkAndRecordRateLimit` | local (webhook.js line 112) | underlying primitive for both `isAiRateLimited` and `isClassifierRateLimited` |
| `FREE_LIMIT_DISPLAY` | local (webhook.js line 2826) | called 8x across report comment, parent message, assessment analysis, intervention plan, translate, formal message, and generation |
| `getDb()` (inline require) | `utils/database` | narrow, conditional — moderation pack existing-assessment lookup only (line 2521) |

## Session stores (shared contracts — pass in, don't own)

### `lastGeneratedState`
- Written once, at the end of `processGeneration()` (line 2744), tagged
  `saveState: 'GENERATED'`, with a freshly minted `generationId`.
- One read inside `processGeneration()` (line 2734) — only to log a warning
  if overwriting a `RECOVERABLE` row; does not affect control flow.
- Consumed exclusively by the SAVE command handler (webhook.js
  ~1688–1854), which owns the full `GENERATED → SAVING → RECOVERABLE →
  SAVED` state machine (locking, CAS re-read, constraint-recovery).
- **Relationship: publisher/consumer, not bidirectional.** `processGeneration()`
  publishes exactly one state; SAVE owns everything downstream. This is the
  basis for treating generation and SAVE as separate module boundaries.

### `pendingIntentState`
- Written by `processGeneration()` once (line 2689), as the origin of the
  post-explanation disambiguation offer (WORKSHEET/TEST/LESSONPLAN nudge).
- Also read/written extensively **outside** `processGeneration()`, in the
  dispatcher's WORKSHEET/TEST/LESSONPLAN follow-up command handlers and the
  classifier-fallback disambiguation flow (lines 2021, 2024, 2036, 2039,
  2051, 2054, 2298, 2303, 2306, 2449).
- **Relationship: same publisher/consumer shape as `lastGeneratedState`.**
  `processGeneration()` publishes the offer; the generic resource-type
  disambiguation dispatcher (already scoped as part of `generationPipeline`
  per the remaining-work list) consumes it. Should be passed into the
  pipeline module as shared state, not owned/managed internally by it.

## Timers / async side effects

All three `setTimeout` calls in `webhook.js` are inside `processGeneration()`
— confirmed generation-exclusive, no external coupling:

- line 2693 — explanation → disambiguation follow-up nudge (1000ms)
- line 2708 — quick quiz → retry prompt nudge (1000ms)
- line 2760 — SAVE reminder nudge (1500ms)

## Local helpers — disposition

| Helper | Line | Generation-exclusive? | Move into `generationPipeline`? |
|---|---|---|---|
| `buildPdfUrl` | 86 | Yes (only call site: line 2664) | ✅ Yes |
| `hasExplicitExplanationKeyword` | 2775 | Yes (only call site: line 2687) | ✅ Yes |
| `intentLabel` | 2807 | No — also used by `worksheetFlow.js`, `assessmentFlow.js` | ❌ No — candidate for a future shared `utils/intentLabel.js` extraction (out of scope here) |
| `FREE_LIMIT_DISPLAY` | 2826 | No — shared across 6+ flows | ❌ No — inject as infra |
| `rollbackUsage` | 55 | No — shared across 5+ flows | ❌ No — inject as infra |
| `isAiRateLimited` / `checkAndRecordRateLimit` | 146 / 112 | No — shared with conversational-response gating | ❌ No — inject as infra |

## Generation-exclusive data structures

`pdfEligible` (line 2647) and `saveableTypes` (line 2719) — both arrays of
resource-type strings, no call sites outside `processGeneration()`. Safe to
move in as-is. Note: the two arrays currently have near-identical contents
(`['worksheet', 'test', 'lessonPlan', 'atp', 'sbaTask', 'examPaper',
'rubric', 'moderationPack']`) — minor duplication worth a future cleanup,
not addressed by this extraction.

## Summary: what moves, what stays

**Moves into `core/generationPipeline.js`:**
- The full body of `processGeneration()`
- `buildPdfUrl`, `hasExplicitExplanationKeyword`
- `pdfEligible`, `saveableTypes` arrays
- All 3 `setTimeout` follow-up blocks

**Stays external, injected as dependencies:**
- All core services (`buildPrompt`, `generateContent`, `generatePdf`,
  `validateAtpWeeks`, `getWorksheetTotalMarks`)
- All infrastructure (`sendDocument`, `safeSendMessage`, `hashPhone`,
  `getTeacherByPhone`, `isProActive`, `checkAndIncrementUsage`,
  `rollbackUsage`, `isAiRateLimited`, `FREE_LIMIT_DISPLAY`, `getDb`)
- `intentLabel` (shared helper, stays in `webhook.js` for now)

**Passed in as shared state, not owned:**
- `lastGeneratedState`
- `pendingIntentState`

**Explicitly out of scope (belongs to other modules):**
- SAVE lifecycle (state machine at webhook.js ~1688–1854) — separate
  future extraction candidate, consumes `lastGeneratedState` as published
  by the pipeline
- Quota/rollback implementation (`utils/usageTracker`) — pipeline is a
  consumer, not an owner
