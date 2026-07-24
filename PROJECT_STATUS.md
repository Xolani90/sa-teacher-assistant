# SA Teacher Assistant – Project Status

_Last updated: 2026-07-24_

## Repository
- **Canonical repo:** `~/Downloads/sa-teacher-assistant`
- **Branch:** `main`
- **Remote:** `origin/main`
- **Old repos** (`sa-teacher-assistant-archive/`, `sa-teacher-assistant-archive-stale/`, and the various dated `.zip`/`.tar.gz` snapshots in `~/Downloads`) are **retired** — read-only backups only. Do not develop in them.

## Current Health
Stable. 61/61 fast test suites passing as of last full run (`node tests/run-all.js`), plus an optional smoke test (`RUN_SMOKE_TESTS=1 node tests/payment-webhook-smoke.test.js`) not counted in that figure. `phase-classifier-disambiguation.test.js` depends on live Anthropic API credit and may fail independently of code changes — not a regression signal on its own.

## Recently Completed
- ✅ **Architecture modularisation complete** — `routes/webhook.js` reduced from ~3390 to a thin routing/orchestration layer via extracted flow modules (`observationFlow`, `workspaceFlow`, `worksheetFlow`, `assessmentFlow`, `assessmentSessionFlow`, `rosterFlow`, `reportCommentFlow`, `interventionPlanFlow`, `assessmentAnalysisFlow`, `parentMessageFlow`, `curriculumQueryFlow`) plus shared infrastructure (`core/generationPipeline.js`, `core/messageProcessor.js`, `core/commandHandler.js`, `utils/webhookHelpers.js`, `utils/interventionParser.js`)
- ✅ Yoco webhook signature verifier extracted to `utils/yocoWebhookVerifier.js` — pure, unit-tested (9/9), wired into `server.js`'s `/payment/webhook` route with unchanged log semantics; end-to-end smoke test added (`tests/payment-webhook-smoke.test.js`, gated behind `RUN_SMOKE_TESTS=1`)
- ✅ Startup validation: `YOCO_SECRET_KEY` requires a matching, well-formed `YOCO_WEBHOOK_SECRET` or the server fails fast rather than silently accepting unverifiable webhooks
- ✅ ADR-005A: blueprint assessment analytics PDF (`generateBlueprintAssessmentPdf()`) wired into `assessmentSessionFlow.js` — previously implemented and tested but unreachable from any WhatsApp command; now generated and delivered via `sendDocument()` automatically when marks capture completes, with a best-effort failure path that never loses already-committed marks
- ✅ ADR-006 PR1–PR5: full Assessment Session Engine (blueprint→class→capture state machine, bulk-paste capture, UNDO/BACK, EDIT `<learner>`, roster prefill)
- ✅ ADR-005 (PR1–PR5 equivalent): Assessment Blueprint lifecycle (draft/publish/archive/versioning), CAPS topic validation, marks-import against a published blueprint, per-topic/per-learner analytics
- ✅ 61/61 test suites passing, up from ~29/30 several sessions ago

## Outstanding Work

### Current milestone: ADR-005 PDF parity (reframed into 3 parts after code inspection)
Original framing ("make blueprint PDFs look like regular PDFs") turned out to undersell the actual gap. Split into:
- ✅ **ADR-005A — Expose blueprint analytics PDF through a teacher-facing workflow.** Done (see above).
- ⬜ **ADR-005B — Printable blueprint assessment papers.** Regular AI-generated tests (`generatePdf()` with `isAssessment=true`) produce a blank question paper with a student-info box and instructions box, ready to hand to learners. Blueprints have no equivalent — only the after-the-fact analytics report exists. This is the more product-relevant gap: Create blueprint → **print assessment (missing)** → learners write → capture marks → analytics PDF.
- ⬜ **ADR-005C — Unify layout, branding, filenames, metadata.** Once both PDF paths are in active use: shared `buildFilename()` (currently `generateBlueprintAssessmentPdf` builds its own filename inline, no date suffix), shared PDFDocument `info` metadata block, consistent fonts/margins/branding via shared components rather than duplicated per-generator logic.

### High Priority
- ADR-005B (printable blueprint test papers, see above)
- Worksheet/PDF branding and layout polish (`prompts/worksheet.js`)
- Teacher analytics / longitudinal learner progress (ADR-003 groundwork already exists — `docs/adr/ADR-003-longitudinal-learner-progress.md`)

### Medium Priority
- Assessment history & reporting UX (view past assessments, re-run diagnostics, compare two assessments)
- Blueprint authoring UX improvements — deferred until teachers have used the feature enough to surface real pain points; lifecycle + test coverage are already functionally complete

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

- ✅ core/generationPipeline — done. `core/generationPipeline.js` now owns processGeneration()/triggerGeneration(), prompt dispatch, PDF eligibility/delivery, the SAVE lifecycle (B2–B5 state machine), quota/usage rollback handling, and generic resource-type disambiguation. `core/messageProcessor.js` and `core/commandHandler.js` were extracted alongside it. All planned architectural extractions are complete — see "Recently Completed" above.

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

