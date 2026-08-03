# ADR-015: Class Analytics Snapshot

## 1. Status

**Proposed.** This document freezes the aggregation contract for
`classAnalyticsService` ahead of implementation. It contains a data shape
and aggregation rules, but no implementation code.

**Depends on:** ADR-003 (learner identity), ADR-004 (class-aware identity),
ADR-007 (`ProgressService`, `CoverageService`, `MasteryService` — the
per-learner reports this ADR aggregates). Sibling to ADR-009
(`ClassInterventionService`), which this ADR does not depend on and does
not call — see §3.4.

---

## 2. Context

`ProgressService`, `CoverageService`, and `MasteryService` (ADR-007) each
expose only per-learner reports:
`getLearnerProgress(learnerId)`, `getLearnerCoverage(learnerId)`,
`getLearnerMastery(learnerId)` — each optionally scoped to one subject.
There is no class-level view of "how is this class doing" today.

ADR-009 already fills part of the class-level gap by answering *"which
learners need intervention, and on what"* via `ClassInterventionService`.
That is a different question from the one this ADR answers: *"how is this
class performing, overall and by subject"* — a snapshot, not a priority
triage list. The two are siblings, not layered on each other (§3.4).

---

## 3. Decision

Introduce `classAnalyticsService`, composing `ProgressService`,
`CoverageService`, and `MasteryService` once per learner in a class
roster — the same layering discipline ADR-007 and ADR-009 established:

```
Repository -> Timeline -> Progress/Coverage -> Mastery
                                |         |        |
                                v         v        v
                            classAnalyticsService
                              (aggregation only)
                                      |
                                      v
                        WhatsApp / PDF / Dashboard (future)
```

### 3.1 Inputs

```
getClassAnalytics(classId, options = {})

options: {
  subject?: string,     // scope to one subject; omitted = all subjects
  dateRange?: { from, to }  // reserved for future filtering; ADR-014 owns
                             // historical/trend semantics, not this ADR
}
```

### 3.2 Aggregation rules

For each learner in the class roster, this service calls
`getLearnerProgress`, `getLearnerCoverage`, and `getLearnerMastery` (all
per §3's dependency list), each inside its own `try/catch`, mirroring
ADR-009 §3.6's fault isolation — one learner's failure never aborts the
class snapshot.

- **Averages** (`classSummary`) are computed only from learners with a
  numeric value for that metric; learners with `insufficient-data` mastery
  or missing coverage/progress data are excluded from the relevant average
  and instead counted in that metric's `distributions` bucket.
- **Distributions** (`distributions.mastery/coverage/progress`) are
  learner counts per bucket (e.g. mastery buckets already defined by
  `MasteryService`'s own `masteryLevel` values, not new ones invented
  here), so the shape of "insufficient-data" is inherited, not
  redefined.
- **`highlights.strongestArea` / `weakestArea`** are computed only from
  `breakdowns.bySubject`, comparing each subject's average mastery
  percentage; a subject with no evaluated learners is excluded from this
  comparison rather than treated as zero.
- **`highlights.attentionRequired`** is a plain count (or list of
  `learnerId`s) of learners with `insufficient-data` mastery across *all*
  subjects in scope — this is a structural echo of ADR-009 §3.2's
  `insufficientData` bucket, not a recalculation. It does **not** carry
  priority information; that stays owned by `ClassInterventionService`.
- **`breakdowns.bySubject`** is one entry per subject with `classSummary`-
  shaped values (average progress/coverage/mastery) scoped to that
  subject.
- **`breakdowns.byLearner`** is one entry per learner, each carrying that
  learner's own progress/coverage/mastery reports as-is (not
  re-aggregated) — this is the "drill down" affordance for the dashboard,
  analogous to ADR-009's `subjectPlans` retention in `PriorityLearner`.

### 3.3 Output contract

```
ClassAnalyticsSnapshot {
  classId,
  subject: string | null,      // echoes the options.subject filter, or null

  classSummary: {
    learnerCount,
    averageProgress: number | null,
    averageCoverage: number | null,
    averageMastery: number | null
  },

  distributions: {
    mastery:  { [masteryLevel]: count },
    coverage: { [coverageBucket]: count },
    progress: { [progressBucket]: count }
  },

  highlights: {
    strongestArea: { subject, averageMasteryPercentage } | null,
    weakestArea:   { subject, averageMasteryPercentage } | null,
    attentionRequired: { count, learnerIds: [] }
  },

  breakdowns: {
    bySubject: [
      { subject, learnerCount, averageProgress, averageCoverage, averageMastery }
    ],
    byLearner: [
      { learnerId, learnerName, progress, coverage, mastery }
    ]
  },

  errors: [ { learnerId, reason } ]   // same shape as ADR-009 §3.6
}
```

### 3.4 Relationship to `ClassInterventionService` (ADR-009)

`classAnalyticsService` and `ClassInterventionService` are **siblings**,
not layered: neither calls the other, and this ADR does not read
`InterventionPlan` or `priority` at any point. Both independently call
into the same learner-domain services (`ProgressService`/
`CoverageService`/`MasteryService` here; `InterventionService` — itself
built on those three — there). This duplication of "call once per learner
in the roster" is accepted deliberately (§7) rather than introducing a
shared roster-iteration helper prematurely.

The dashboard is expected to call both services and present them
side-by-side (analytics snapshot + intervention priorities), not to
derive one from the other.

---

## 4. Non-goals

- No persistence — every call recomputes from current data, same as
  ADR-007 and ADR-009's services.
- No dashboard rendering, chart data, colours, or React concerns — the
  output contract is deliberately plain aggregate data (§3.3).
- No trend history, historical windows, smoothing, or comparison periods
  — that is ADR-014's scope (§6), not this ADR's.
- No intervention prioritisation or `priority` values of any kind — that
  stays owned by `ClassInterventionService` (ADR-009); see §3.4.
- No PDF generation or WhatsApp delivery — service contract only, same
  split as ADR-007 and ADR-009.
- No new mastery/progress/coverage calculation rules — this service only
  aggregates values already produced by `MasteryService`/`ProgressService`/
  `CoverageService`.
- No parallel/batched execution in the initial implementation, matching
  ADR-009 §4.

---

## 5. Testing Strategy

`classAnalyticsService` is tested against mocked `ProgressService`,
`CoverageService`, and `MasteryService`, matching how ADR-009 tested
against a mocked `InterventionService`. Minimum coverage:

- All learners have full data across all three metrics — averages and
  distributions computed correctly.
- Some learners have `insufficient-data` mastery — excluded from
  `averageMastery` and `attentionRequired` populated correctly.
- One learner throws for one service call; remaining learners and
  remaining services for that learner still processed; `errors[]`
  populated.
- Multiple learners throw across different services.
- `subject` option scopes `classSummary` and `breakdowns.bySubject` to
  one subject only, and `breakdowns.byLearner` reflects only that
  subject's reports.
- `highlights.strongestArea`/`weakestArea` correctly exclude subjects with
  zero evaluated learners rather than treating them as zero.
- Empty class roster (`learnerCount === 0`) returns a well-formed
  `ClassAnalyticsSnapshot` with all averages `null` and counts at zero,
  rather than throwing.

---

## 6. Future Work

- **ADR-014 (Trend Aggregation)**: historical/time-series view built on
  top of the same learner-domain services, introducing timestamps,
  windows, smoothing, and comparison periods — deliberately deferred
  rather than folded into this ADR's snapshot contract (§1 of this ADR's
  rationale).
- Configurable coverage/progress bucket boundaries, if the fixed buckets
  inherited from `MasteryService`/`CoverageService`/`ProgressService`
  prove too coarse for dashboard use.
- Parallel or batched execution across the roster, if profiling shows
  sequential per-learner calls are too slow for larger classes — the
  public contract (`ClassAnalyticsSnapshot` shape) should not need to
  change for this, matching ADR-009 §6.
- Delivery surfaces beyond the dashboard (WhatsApp summary, PDF class
  report) — each their own follow-on concern, not blocked on this ADR.

---

## 7. Alternatives Considered

- **Build `classAnalyticsService` on top of `ClassInterventionService`
  instead of calling `ProgressService`/`CoverageService`/`MasteryService`
  directly.** Rejected: `InterventionPlan` carries `priority` and
  `recommendedAction`, not raw coverage percentages or progress values —
  building on it would mean either extending `InterventionPlan`'s shape
  (out of scope for this ADR) or losing the data this service needs to
  report. Calling the same three ADR-007 services directly, in parallel
  to ADR-009 rather than beneath it, keeps both aggregation services
  reading from the same source of truth without coupling them to each
  other.
- **A single combined `classSummary` percentage across progress,
  coverage, and mastery.** Rejected, for the same reason ADR-009 rejected
  a single class mastery percentage: it hides which dimension (progress
  vs. coverage vs. mastery) is actually driving a low number, which is
  the information a teacher needs to act.
- **Share a roster-iteration helper between `ClassInterventionService` and
  `classAnalyticsService`.** Deferred, not rejected outright — the two
  services currently iterate the same roster independently with separate
  `try/catch`/`errors[]` handling. A shared helper is worth revisiting if
  a third class-level aggregation service (e.g. ADR-014) emerges and the
  duplication becomes a real maintenance cost, rather than abstracting
  after only two call sites.
