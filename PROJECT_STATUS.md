# SA Teacher Assistant – Project Status

_Last updated: 2026-07-17_

## Repository
- **Canonical repo:** `~/Downloads/sa-teacher-assistant`
- **Branch:** `main`
- **Remote:** `origin/main`
- **Old repos** (`sa-teacher-assistant-archive/`, `sa-teacher-assistant-archive-stale/`, and the various dated `.zip`/`.tar.gz` snapshots in `~/Downloads`) are **retired** — read-only backups only. Do not develop in them.

## Current Health
Stable. `git status` clean, in sync with `origin/main`. 29/30 test suites passing as of last full run. The 1 remaining failure is `phase-classifier-disambiguation.test.js` — not a code bug, blocked on Anthropic API credit balance (see Blockers below).

## Recently Completed
- `rollbackUsage()` shared helper for quota rollback consistency (`bcbaff3`, 2026-07-13)
- SQLite-backed rate limiting, replacing in-memory Maps that reset on Render restart (`00d65d5`)
- Delivery rollback feature + regression test rewrite (`c705c1b`, `aa04b94`)
- `buildPdfUrl()` consolidation of PDF signing logic (`1a37d97`)
- Observation workflow (OBSERVATION intent, submission flow, MY OBSERVATIONS command)
- `parseSqliteUtc()` UTC timestamp fix + documented invariant (`9e62f70`)
- Subscription renewal stacking fix, `markUserAsPro()` fix, `/admin/grant-pro` fix
- PDF rendering fixes: bullet bold-span rendering, page-total footer, number line realignment
- Duplicate `parseSqliteUtc` declarations removed from `tests/phase-d-payment-renewal.test.js` and `tests/phase-d-replay-stress.test.js`

## Outstanding Work

### High Priority
- Worksheet/PDF branding and layout polish (`prompts/worksheet.js`)
- Teacher analytics

### Medium Priority
- `routes/webhook.js` modularisation — currently ~3700 lines. First step: extract coherent handler blocks into a `flows/` directory (`worksheetFlow.js`, `testFlow.js`, `lessonPlanFlow.js`, `observationFlow.js`, `interventionFlow.js`, `pdfFlow.js`), leaving `webhook.js` as routing/orchestration only. Incremental, one flow at a time — no architecture redesign.

## Modularisation Status

### Architecture decisions
Design rationale and supporting evidence for the modularisation effort now live in `docs/adr/`:
- [ADR-001 — Flow module boundaries](docs/adr/ADR-001-flow-boundaries.md)
- [ADR-002 — Generation pipeline boundary](docs/adr/ADR-002-generation-pipeline.md)
- [Generation pipeline analysis](docs/adr/generation-pipeline-analysis.md) — supporting evidence for ADR-002

### Flow-layer extraction
- ✅ observationFlow extracted from routes/webhook.js (594a9dc) — handleObservationFlow, handleObservationHistoryFlow, formatObservationDate, sendObservationHistoryList. Dependencies injected via buildObservationDeps() factory; no reverse dependency on webhook.js.
- ✅ workspaceFlow extracted from routes/webhook.js (9e364ae) — MY CLASSES, NEW CLASS, MY ASSESSMENTS, MY PROGRESS, WORKSPACE summary. SAVE/MY RESOURCES stay inline (tied to lastGeneratedState/saveLock). Dependencies injected via buildWorkspaceDeps() factory.
- ✅ worksheetFlow extracted from routes/webhook.js (4e4f8e0) — EASIER/HARDER/VISUAL/ORAL differentiation commands + lastWorksheetState bookkeeping. AI generation, quota, PDF, SAVE all stay inline until core/generationPipeline.js exists. Dependencies injected via buildWorksheetDeps() factory; triggerGeneration is a placeholder pointing at processGeneration().
- ✅ assessmentFlow extracted from routes/webhook.js (b6ef2da) — upload marks multi-turn flow (CSV/photo/document -> parse -> processAssessmentData() diagnostic summary). Scoped narrower than the full pipeline: handleAssessmentAnalysisFlow and handleInterventionPlanFlow remain inline (separate state stores, future extraction candidate). Dependencies injected via buildAssessmentDeps() factory.

**Status: 4 / 4 real flow modules extracted (100%)**

### Roadmap adjustments (revised after code inspection)

The original roadmap listed lessonPlanFlow and onboardingFlow as pending extractions. Investigation of the actual codebase found neither is a standalone flow, so both were removed from the extraction list rather than left as stale unchecked items:

**lessonPlanFlow** — Not extracted because no standalone flow exists. Lesson plans are one of several resource types (alongside worksheet, test, atp, sbaTask, etc.) handled entirely by the shared generation pipeline (processGeneration(), intent routing, PDF eligibility, SAVE lifecycle). The only lesson-plan-specific code in webhook.js is a ~6-line LESSONPLAN disambiguation command handler and entries in shared arrays (pdfEligible, saveableTypes, intentLabel).

**onboardingFlow** — Already extracted before this modularisation effort began, into services/onboardingService.js (handleOnboarding, needsOnboarding). routes/webhook.js only delegates via a 2-line call site; there is no onboarding-specific logic left to extract.

### Remaining architectural work

- ⬜ core/generationPipeline

This is the one remaining major extraction and includes:
- processGeneration() — shared generation orchestration
- prompt dispatch across all resource types
- PDF eligibility/delivery
- SAVE lifecycle (B2–B5 state machine)
- quota / usage rollback handling
- generic resource-type disambiguation (WORKSHEET/TEST/LESSONPLAN/etc.)

This is shared infrastructure used across all generation types, not another conversation flow — architecturally significant but a single focused piece of work rather than several unrelated extractions.

### Other planned work (non-modularisation)
- School administration features
- District dashboard
- Department of Education reporting
- Subscription/payment improvements

### Blocked
- AI classifier improvements — blocked on Anthropic API credit balance (account tied to the API key used by `phase-classifier-disambiguation.test.js` is depleted; regex fallback works correctly in the meantime)

### Audit follow-up
- Item 5 (stale code comment): **resolved**. Located and removed — a leftover '// Report comment conversation state (in-memory)' header comment at routes/webhook.js:164, which contradicted the correct comment directly below it describing the SessionStore SQLite-backed migration. Backlog audit is now fully closed.

## Modularisation Metrics

**Flow modules completed:** 4 / 4 (100%)
**Architectural extraction completed:** 1 / 1 (100%) — generationPipeline

**routes/webhook.js**
- Initial size: 3390 lines (42e5278)
- Current size: ~2340 lines
- Net reduction: ~1050 lines (~31%)

All planned modularisation work is complete: 4 flow modules
(observation, workspace, worksheet, assessment) plus the shared
generation pipeline (triggerGeneration in core/generationPipeline.js),
per ADR-001 and ADR-002.

