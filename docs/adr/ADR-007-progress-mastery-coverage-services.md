# ADR-007: Progress, Coverage, and Mastery Services

## 1. Status

**Accepted (implemented — PR4–PR10 merged to `main`. This header previously
read "Proposed... Nothing described here is implemented yet" and was stale
relative to `main`.)**

Implementation summary:
- PR4 — `ProgressService` (`d3c90c7`)
- PR5 — `CoverageService` (`a3f3de5`)
- PR6 — `MasteryService` (`41bb1b6`), wired into `LEARNER PROGRESS <n>` (`efdd249`)
- PR7 — `InterventionService` (`8b56177`)
- PR8 — Intervention section wired into `LEARNER PROGRESS <n>` WhatsApp reply (`a37655b`)
- PR9 — `generateLearnerInterventionPdf()` PDF parity (`d77a6c4`)
- PR10 — `GET /api/learners/:learnerId/intervention-plan` (`routes/api.js`),
  third delivery surface for the same `InterventionPlan[]`. Gated by
  `requireAdminSecret` (`utils/adminAuth.js`) as an internal-only
  placeholder — there is no per-teacher HTTP authentication anywhere in
  this codebase yet, so this endpoint is not exposed to teachers. Real
  teacher auth (login/session/token issuance, teacher→class→learner
  ownership checks) is deliberately scoped out as its own future ADR
  rather than folded into this PR.

See `docs/ARCHITECTURE.md` for the current layering diagram and allowed-deps
table, and the corresponding test suites (`tests/routing-order-workspace-flow.test.js`,
`tests/learner-intervention-pdf.test.js`, and this ADR's service-level tests)
for regression coverage.

Depends on: ADR-003 (learner identity), ADR-004 (class-aware identity),
ADR-005 (assessment blueprints), and the `TimelineEvent` contract frozen by
`services/learnerTimelineService.js` (ADR-003 Phase 1, PR3).

---

## 2. Context

`learnerTimelineService.getLearnerTimeline()` gives any consumer a single,
chronologically-sorted stream of `TimelineEvent` objects for a learner —
`assessment` events (with `payload.percentage`, `payload.mark`,
`payload.totalMarks`, `payload.assessmentType`, ...) merged with
`observation` events (with `payload.developmentalStatus`, `payload.domain`,
...). That answered *how do we get a learner's history as one normalized
stream*. It did not answer *what a service that reasons about that history
is allowed to assume about it*.

Three services are needed on top of the timeline:

- **ProgressService** — has this learner's performance moved up or down over
  time?
- **CoverageService** — has this learner's work touched the CAPS topics they
  should have covered?
- **MasteryService** — combining the above (plus the raw timeline), does
  this learner show mastery of a subject/topic?

The risk this ADR exists to head off: `TimelineEvent` deliberately mixes two
incompatible kinds of data in one array — percentage-bearing assessment
events and non-numeric observation `developmentalStatus` events — plus
percentage-bearing events that are not comparable to each other across
subjects or assessment types (a 20-mark quiz and a 100-mark exam are both
"percentages" but were not necessarily produced by comparable instruments).
Without an explicit scope decision, the first implementation of
`ProgressService` would be a `.map(e => e.payload.percentage)` over the raw
timeline, which silently produces `NaN`/nonsense the first time an
observation event or a cross-subject comparison shows up in the array. This
ADR fixes that scope before PR4 is written, not after.

---

## 3. Decision

### 3.1 ProgressService: scope and pipeline

**Responsibilities**

- Compute trends over percentage-bearing assessment events.
- Group strictly by `(learnerId, subject)`.
- Report historical movement (e.g. rising/falling/flat, delta over time).

**Non-goals**

- CAPS expectations or curriculum pacing (that's CoverageService).
- Intervention recommendations.
- Mastery judgements.
- AI analysis.
- Cross-subject aggregation, and cross-assessment-type comparison within a
  subject (a quiz trend and an exam trend are both kept as `percentage`
  values but are not blended into one number by this service; if
  assessment-type weighting/normalization is ever needed, that is a future,
  explicit extension of ProgressService — not an assumption baked in now).

**Contract statement, verbatim, to go at the top of `progressService.js`:**

> ProgressService analyzes only percentage-bearing assessment events. Events
> without a comparable numeric achievement measure (for example,
> developmental-status observations) are ignored by this service. Progress
> trends are computed per learner, per subject. Cross-subject aggregation is
> outside the scope of ProgressService.

**Filter/group pipeline:**

```
TimelineEvent[]
        │
        ▼
Filter:
    type == "assessment"
    payload.percentage != null
        │
        ▼
Group by:
    learnerId
    subject
        │
        ▼
Chronological trend calculation (occurredAt order, already
sorted by learnerTimelineService — re-sort only if a
different slice/order is needed for the calculation itself)
```

This prevents: comparing Mathematics against English, mixing tests/exams/
worksheet-derived marks indiscriminately without the caller knowing it
happened, treating `developmentalStatus` values like `"Developing"` as if
they were numeric, and inventing arbitrary numeric mappings for observation
statuses just to keep them in the same reduction.

### 3.2 CoverageService: scope

**Responsibilities**

- Compare completed work (from the timeline, plus blueprint/CAPS topic
  metadata already established in ADR-005) to CAPS expectations for the
  learner's grade/subject.
- Determine curriculum coverage.
- Identify missing outcomes/topics.

**Non-goals**

- Learner performance trends (that's ProgressService).
- Progress calculations of any kind.
- Intervention advice.

### 3.3 MasteryService: composition, not reimplementation

**Responsibilities**

- Combine `TimelineService` + `ProgressService` + `CoverageService` output.
- Produce mastery judgements.

**Non-goals**

- Its own database queries.
- Its own timeline construction.
- Its own raw trend calculations — it consumes ProgressService's output
  rather than recomputing trends from `TimelineEvent[]` directly.

**Dependency chain:**

```
MasteryService
    │
    ├── TimelineService
    ├── ProgressService
    └── CoverageService
```

### 3.4 Services consume contracts, not storage

Consistent with the direction ADR-003/ADR-005 already established
(repositories own persistence, `learnerTimelineService` owns
normalization):

> Services consume contracts, not storage. Domain services must depend on
> service or repository interfaces rather than SQL schemas or table
> structure. Changes to persistence should not require changes to
> domain-service logic provided the contracts remain stable.

Concretely: `ProgressService` and `CoverageService` depend on
`learnerTimelineService.getLearnerTimeline()` (and, for Coverage, whatever
blueprint/CAPS-topic service ADR-005 already exposes) — never on
`learnerRepository` or raw SQL directly. `MasteryService` depends on the
other three services — never on a repository or the database directly.

### 3.5 Testing isolation

Each layer mocks the layer(s) immediately beneath it in its own unit tests,
matching the pattern already used by `learnerTimelineService.test.js`
(mocks `learnerRepository` rather than standing up a database):

```
RiskScoringService
        ▲
InterventionService
        ▲
MasteryService              tests mock TimelineService, ProgressService,
        ▲                   and CoverageService independently — not real
ProgressService              implementations, and not the DB through them.
CoverageService
        ▲
TimelineService              tests mock learnerRepository.
        ▲
learnerRepository            tests run against a real (test) database.
        ▲
SQLite
```

`MasteryService`'s tests specifically must inject/mock all three upstream
services as three independent seams. Calling through to real
`ProgressService`/`CoverageService`/`TimelineService` implementations from a
`MasteryService` unit test is an integration test wearing a unit test's
name, and is not acceptable as the only coverage for `MasteryService`'s own
orchestration logic.

---

## 4. Consequences

- `ProgressService`'s first version cannot answer "how is this learner doing
  overall" across subjects — only per-subject. This is intentional; a
  cross-subject rollup, if wanted later, is a new, explicitly-scoped
  extension, not a silent averaging of incompatible percentages.
- Observation events are invisible to `ProgressService`. Anything that wants
  to reason about developmental-status trajectory needs a separate service
  (out of scope for this ADR) rather than overloading `ProgressService`.
- `MasteryService` cannot be built or meaningfully tested until both
  `ProgressService` and `CoverageService` exist and are stable, since it has
  no logic of its own beyond composition.
- Future assessment-type normalization (e.g. weighting an exam differently
  from a quiz within the same subject) has one obvious place to go
  (`ProgressService`) instead of being invented ad hoc wherever a trend is
  computed.

---

## 5. Alternatives Considered

- **Single `AnalyticsService` doing progress + coverage + mastery in one
  module.** Rejected: mixes three different questions (numeric trend,
  curriculum coverage, composite judgement) in one place, makes unit testing
  require a full fixture covering all three concerns at once, and repeats
  the exact layering mistake ADR-001 already fixed for flows.
- **Let `ProgressService` accept the full mixed `TimelineEvent[]` and filter
  internally per call-site.** Rejected: pushes the filter/group contract
  out to every caller instead of owning it once, and reintroduces the risk
  of a caller forgetting to filter out observation events.
- **Numeric-map developmental statuses (e.g. `"Developing" -> 2`) so
  `ProgressService` can include them in one trend.** Rejected: invents a
  scale CAPS does not define, and silently conflates two measurement
  systems (percentage-of-marks vs. developmental-status category) that have
  no principled conversion between them.

---

## 6. Non-goals (ADR-level)

- This ADR does not specify `InterventionService` or `RiskScoringService`
  beyond placing them above `MasteryService` in the dependency chain shown
  in §3.5 — they are future ADRs.
- This ADR does not change anything about `learnerTimelineService.js` or the
  `TimelineEvent` contract; it is consumed as-is.
