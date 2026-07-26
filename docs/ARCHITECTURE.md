# Architecture Overview

Entry point for understanding how `sa-teacher-assistant` is layered, before
diving into individual ADRs under `docs/adr/`. For the detailed reasoning
behind any given layer, follow the links in the table below.

## Service dependency diagram

```
Channels (WhatsApp / PDF / Dashboard)
                │
                ▼
        MasteryService          (planned — ADR-007)
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
| `MasteryService` (planned) | Composing `TimelineService` + `ProgressService` + `CoverageService` output into a mastery judgement. | Its own database queries, its own trend/coverage math. |

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

This is the "services consume contracts, not storage" rule from ADR-007
§3.4: a change to a table's columns should only ever require a change in
the one repository function that selects them, not in every service above
it.

## Testing isolation

Each layer's unit tests mock the layer(s) immediately beneath it, rather
than exercising a real database through several layers at once:

```
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
