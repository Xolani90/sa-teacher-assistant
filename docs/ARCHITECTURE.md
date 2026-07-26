# Architecture Overview

Entry point for understanding how `sa-teacher-assistant` is layered, before
diving into individual ADRs under `docs/adr/`. For the detailed reasoning
behind any given layer, follow the links in the table below.

## Service dependency diagram

```
Channels (WhatsApp / PDF / API)
   WhatsApp: LEARNER PROGRESS <name>        (ADR-007 PR8, flows/workspaceFlow.js)
   PDF:      generateLearnerInterventionPdf (ADR-007 PR9, services/pdfService.js)
   API:      GET /api/learners/:id/intervention-plan (ADR-007 PR10, routes/api.js)
                │
                ▼
      InterventionService       (ADR-007 PR7)
                │
                ▼
        MasteryService          (ADR-007)
                │
       ┌────────┴────────┐
       ▼                 ▼
ProgressService    CoverageService
       │                 │
       └────────┬────────┘
                ▼
     learnerTimelineService
                │
                ▼
      learnerRepository
                │
                ▼
            SQLite
```

`CoverageService` additionally composes `blueprintRepository` (topic
detail per assessment) and `curriculumCoverageService` (CAPS expected-topic
lists) — both shown collapsed into the "CoverageService" box above for
diagram clarity; see ADR-007 §3.2 for the full picture.

## Responsibility table

| Layer | Owns | Does NOT own |
|---|---|---|
| `learnerRepository` | Raw SQL over `learners`, `learner_results`, `observation_records`, joined against `assessments`/`classes`. | Normalization, trends, coverage, mastery. |
| `learnerTimelineService` | Merging assessment + observation rows into one chronologically-sorted `TimelineEvent[]` stream, with a stable, documented shape (`eventKey`, `occurredAt`, `payload`, ...). | Filtering by type, computing trends, calling AI, mutating state. |
| `ProgressService` | Percentage-bearing assessment trend analysis, strictly grouped per `(learnerId, subject)`. | CAPS expectations, mastery, cross-subject or cross-assessment-type aggregation. |
| `CoverageService` | Comparing blueprint-backed assessment topics against CAPS expected-topic lists, per `(learnerId, subject, grade, term)`. | Trends, mastery, non-blueprint (free-form) assessment content. |
| `MasteryService` | Composing `TimelineService` + `ProgressService` + `CoverageService` output into a per-subject mastery judgement (`masteryLevel`, `confidence`, `strengths`/`concerns`). | Its own database queries, its own trend/coverage math. |
| `InterventionService` | Composing `MasteryService` output into a per-subject `InterventionPlan` (`priority`, `focusTopics`, `recommendedActions`) via a fixed, deterministic rule table. | Its own database queries, its own trend/coverage/mastery math, AI-generated recommendations (future ADR would consume `InterventionPlan`, not replace this layer). |
| `flows/workspaceFlow.js` (`LEARNER PROGRESS <name>`, ADR-007 PR8) | Formatting `InterventionPlan[]` (mastery + intervention sections) into a WhatsApp-friendly message. | Any priority/trend/mastery decision — it reads `plan.priority`, `plan.recommendedActions`, and `plan.evidence.mastery` as-is and computes nothing. |
| `services/pdfService.js` (`generateLearnerInterventionPdf`, ADR-007 PR9) | Rendering the same `InterventionPlan[]` as a printable per-learner PDF (cover block, per-subject mastery + intervention sections). | Any priority/trend/mastery decision, same rule as `workspaceFlow.js` above — it is a second formatting consumer of `InterventionService`, not a second computation of mastery/intervention logic. |
| `routes/api.js` (`GET /api/learners/:learnerId/intervention-plan`, ADR-007 PR10) | Serializing the same `InterventionPlan[]` as JSON, unchanged. Also owns request validation (`learnerId` shape) and HTTP status mapping (400/404/500) — concerns specific to being an HTTP surface, not domain logic. | Any priority/trend/mastery decision, same rule as `workspaceFlow.js`/`pdfService.js` above — a third formatting consumer of `InterventionService`, not a third computation of it. Also does not own teacher authentication/authorization — see note below. |

## Allowed dependencies

Each layer may depend only on the layer(s) directly beneath it in the
diagram above — never on a layer's own dependencies, and never by reaching
around a layer into raw storage:

- `learnerRepository` → SQLite only.
- `learnerTimelineService` → `learnerRepository` only.
- `ProgressService` → `learnerTimelineService` only.
- `CoverageService` → `learnerTimelineService`, `blueprintRepository`,
  `curriculumCoverageService`.
- `MasteryService` → `learnerTimelineService`, `ProgressService`,
  `CoverageService` only — no direct repository or SQL access.
- `flows/workspaceFlow.js` → `InterventionService` only (via the
  `getLearnerInterventionPlan` dep) — it does not call `MasteryService`
  directly, even though `MasteryReport` is reachable through
  `InterventionPlan.evidence.mastery`. This is the same "consume the
  highest-level service that already composes what you need" rule as
  `InterventionService` → `MasteryService` below, applied one layer up:
  the delivery surface reaches past `InterventionService` for nothing.
- `services/pdfService.js`'s `generateLearnerInterventionPdf` → `InterventionService`
  (via `getLearnerInterventionPlan`) and `learnerRepository` (via
  `getLearnerById`, for the cover block's name/phone-hash) only — same
  restriction as `workspaceFlow.js` above. PDF and WhatsApp are two
  independent consumers of the identical `InterventionPlan[]` call, not two
  computations of it.
- `routes/api.js`'s `GET /api/learners/:learnerId/intervention-plan` →
  `InterventionService` (via `getLearnerInterventionPlan`) and
  `learnerRepository` (via `getLearnerById`, for the 404-vs-empty-plans
  distinction) only — same restriction as `workspaceFlow.js` and
  `pdfService.js` above. API, PDF, and WhatsApp are three independent
  consumers of the identical `InterventionPlan[]` call, not three
  computations of it.

  **Authorization note (temporary):** this endpoint is gated by
  `requireAdminSecret` (`utils/adminAuth.js`) — a single shared secret,
  the same scheme already used by `/admin/stats` and `/admin/grant-pro`.
  This is *not* per-teacher authentication; there is currently no
  per-teacher HTTP identity anywhere in this codebase (WhatsApp
  establishes identity via the sender's phone number; the PDF download
  endpoint uses an unscoped per-file token). Until a dedicated ADR
  defines real teacher auth and teacher→class→learner ownership checks,
  this endpoint is for trusted internal clients only, not teachers. Only
  the middleware at the mount point in `server.js` will need to change
  when that lands — `routes/api.js` and everything beneath it stays the
  same.
- `InterventionService` → `MasteryService` only — no direct access to
  `ProgressService`, `CoverageService`, `learnerTimelineService`, or
  repository/SQL layers, even though that data is reachable through
  `MasteryReport.evidence`. Reaching past `MasteryService` for "just one
  more field" defeats the point of freezing `MasteryReport` as a contract.

This is the "services consume contracts, not storage" rule from ADR-007
§3.4: a change to a table's columns should only ever require a change in
the one repository function that selects them, not in every service above
it.

## Testing isolation

Each layer's unit tests mock the layer(s) immediately beneath it, rather
than exercising a real database through several layers at once:

```
InterventionService     tests mock MasteryService
MasteryService         tests mock TimelineService, ProgressService,
                        CoverageService independently
ProgressService         tests mock learnerTimelineService
CoverageService          tests mock learnerTimelineService,
                          blueprintRepository, curriculumCoverageService
learnerTimelineService    tests mock learnerRepository
learnerRepository          tests run against a real (in-memory) SQLite DB
```

See `tests/progressService.test.js` and `tests/coverageService.test.js` for
the concrete pattern (overwriting a required module's exported function
directly, then restoring it — no DI framework, no mocking library).

## Where to go next

| ADR | Purpose |
|---|---|
| [ADR-003](./adr/ADR-003-longitudinal-learner-progress.md) | Learner identity model — the `learners` table and `resolveLearner()`. |
| [ADR-004](./adr/ADR-004-class-aware-learner-identity.md) | Class-aware identity resolution. |
| [ADR-005](./adr/ADR-005-assessment-blueprint.md) | Assessment Blueprints — reusable, versioned, CAPS-validated question metadata. |
| [ADR-006](./adr/ADR-006-assessment-session-engine.md) | The multi-turn WhatsApp marks-capture state machine. |
| [ADR-007](./adr/ADR-007-progress-mastery-coverage-services.md) | This document's source of truth — the Progress/Coverage/Mastery service layer. |

For the full, dependency-ordered reading list (not just the ones this
overview draws from), see `docs/adr/ADR-INDEX.md`.
