# ADR-009: Class-Level Intervention Rollup

## 1. Status

**Proposed.** This document freezes the aggregation contract for
`ClassInterventionService` ahead of PR11. It contains a data shape and
aggregation rules, but no implementation code.

**Depends on:** ADR-003 (learner identity), ADR-004 (class-aware identity),
ADR-007 (`InterventionService` and the `InterventionPlan` shape this ADR
aggregates).

---

## 2. Context

`InterventionService.getLearnerInterventionPlan(learnerId)` returns one
`InterventionPlan` **per subject** for a single learner — there is no
learner-level plan today, only a per-subject one. Teachers scanning a class
roster need a class-level view ("which learners need my attention first?")
without duplicating any of the mastery/progress/coverage/intervention logic
that already lives beneath `InterventionService`.

Two properties of the existing `InterventionPlan` shape matter for this
ADR's design and are easy to get wrong if assumed rather than checked
against `services/interventionService.js`:

- A learner has **multiple** `InterventionPlan`s (one per subject), each
  with its own `priority`. There is no single "the learner's priority"
  today.
- `InterventionPlan.priority` is a **presentation field**, not a proxy for
  evidence availability. `determinePriority()` maps
  `masteryLevel === "insufficient-data"` to `priority === "medium"` (with a
  "gather more evidence" `recommendedAction`) so teachers still get an
  actionable next step per subject. The canonical signal for "this subject
  has no real evidence yet" is `evidence.mastery.masteryLevel ===
  "insufficient-data"`, not `priority`.

Any class-level rollup that reads only `priority` would silently conflate
"moderate concern" with "no data at all." This ADR exists specifically to
avoid that mistake being discovered mid-implementation.

---

## 3. Decision

Introduce `ClassInterventionService`, composing
`InterventionService.getLearnerInterventionPlan()` once per learner in a
class roster. No direct access to `learnerRepository`, `learnerTimelineService`,
`ProgressService`, `CoverageService`, or `MasteryService` — the same
layering discipline ADR-007 established for WhatsApp/PDF/API:

```
Repository -> Timeline -> Progress/Coverage -> Mastery -> Intervention
                                                              |
                                                              v
                                                  ClassInterventionService
                                                    (aggregation only)
                                                              |
                                                              v
                                            WhatsApp / PDF / Dashboard (future)
```

### 3.1 Subject-plan classification

For each `InterventionPlan` returned for a learner:

- A subject plan is **insufficient-data** if
  `plan.evidence.mastery.masteryLevel === "insufficient-data"`.
  `priority` is never used to infer this — a subject with `priority ===
  "medium"` may or may not be insufficient-data, and only
  `evidence.mastery.masteryLevel` disambiguates.
- Otherwise the subject plan is **evaluated**, and its `priority`
  (`high`/`medium`/`low`) is authoritative for that subject.

### 3.2 Overall learner priority (worst-subject-wins)

1. Filter the learner's subject plans to the evaluated ones (§3.1).
2. If one or more evaluated plans remain: overall priority is the highest
   priority among them, ordered `high > medium > low`.
3. If none remain (every subject plan is insufficient-data): the learner is
   **not** placed in a High/Medium/Low bucket — they are classified as
   `insufficientData` instead (§3.4).

This is a purely structural summary of existing `priority` values — it
recalculates nothing and does not consult mastery/progress/coverage
directly.

### 3.3 `priorityLearners` shape

One entry per learner, retaining every contributing subject plan so no
detail is lost behind the summary:

```
PriorityLearner {
  learnerId,
  learnerName,
  overallPriority,       // "high" | "medium" | "low"
  subjectPlans: InterventionPlan[]   // every subject plan for this learner, evaluated and insufficient-data alike
}
```

Bucket contents (`priorityLearners.high/medium/low`) are ordered:
**High → Medium → Low**, and **alphabetically by `learnerName` within each
bucket.** No secondary ranking (topics missing, coverage percentage, etc.)
is introduced.

### 3.4 Summary counts

```
summary: {
  totalLearners,
  evaluatedLearners,   // learners with >=1 evaluated subject plan
  insufficientData,    // learners whose subject plans are ALL insufficient-data
  erroredLearners       // learners whose plan retrieval threw (see 3.6)
}

priorityCounts: { high, medium, low }   // counts learners once, by overallPriority
```

A learner is counted in exactly one of `evaluatedLearners` (as reflected in
`priorityCounts`), `insufficientData`, or `erroredLearners` — never more
than one.

### 3.5 Common focus topics

Aggregated only from **evaluated** subject plans across the whole class
(topics are subject-specific, so this is computed per subject/topic pair,
not per learner):

```
commonFocusTopics: [
  { subject, topic, affectedLearners, percentage }
]
```

- `percentage` is `affectedLearners / evaluatedLearners` for that subject.
- A topic is included when `percentage >= COMMON_TOPIC_THRESHOLD`.
- `COMMON_TOPIC_THRESHOLD = 0.5`, defined as a single named constant in
  `services/classInterventionService.js` — not inlined at each call site —
  so it can be revisited without touching aggregation logic.
- Insufficient-data subject plans contribute nothing here — they have no
  `focusTopics` worth aggregating.

### 3.6 Fault isolation

`ClassInterventionService` processes the roster **sequentially**, one
learner at a time, each inside its own `try/catch`:

- **Success** → the learner's subject plans feed §3.1–§3.5 as described.
- **Exception** (e.g. `getLearnerInterventionPlan` throws for that
  learner) → increments `erroredLearners`, appends
  `{ learnerId, reason }` to `errors[]`, and processing continues with the
  remaining learners. This learner contributes to no other count.

A single learner's failure never aborts the class rollup.

```
ClassInterventionPlan {
  classId,
  summary: {
    totalLearners,
    evaluatedLearners,
    insufficientData,
    erroredLearners
  },
  priorityCounts: { high, medium, low },
  commonFocusTopics: [ { subject, topic, affectedLearners, percentage } ],
  priorityLearners: {
    high:   PriorityLearner[],
    medium: PriorityLearner[],
    low:    PriorityLearner[]
  },
  errors: [ { learnerId, reason } ]
}
```

Sequential processing is a deliberate MVP choice, not an oversight — see
§6.

---

## 4. Non-goals

- No new mastery, progress, or coverage calculations.
- No new intervention/priority rules beyond the worst-subject-wins
  structural summary in §3.2.
- No direct CAPS/curriculum lookups.
- No direct database or repository access — `ClassInterventionService`'s
  only dependency is `InterventionService`.
- No parallel/batched execution in the initial implementation.
- No dashboard, API route, or WhatsApp command wiring — this ADR covers
  the service contract only; delivery surfaces are follow-on work, same
  pattern as ADR-007 separating the service layer (PR4–PR7) from its
  delivery surfaces (PR8–PR10).

---

## 5. Testing Strategy

`ClassInterventionService` is tested against a mocked
`InterventionService.getLearnerInterventionPlan`, matching how PR8–PR10
tested against a mocked `InterventionService` rather than a real database.
Minimum coverage:

- All learners evaluated, no insufficient-data or errors.
- Some learners have every subject plan insufficient-data.
- One learner throws; remaining learners still processed and correctly
  aggregated.
- Multiple learners throw.
- A learner with mixed subjects (e.g. Maths high, English insufficient-data)
  — overall priority must be `high`, and the learner must not be
  double-counted as `insufficientData`.
- `commonFocusTopics` excludes insufficient-data subject plans from both
  numerator and denominator.
- Priority bucket ordering: High → Medium → Low, alphabetical by
  `learnerName` within each bucket.
- Empty class roster (`totalLearners === 0`) returns a well-formed
  `ClassInterventionPlan` with all counts at zero rather than throwing.

---

## 6. Future Work

- Parallel or batched execution across the roster, if profiling on a real
  class size shows sequential calls are too slow — the public contract
  (`ClassInterventionPlan` shape) should not need to change for this.
- Configurable `COMMON_TOPIC_THRESHOLD` (per phase, per school, etc.)
  instead of the flat constant.
- Delivery surfaces: WhatsApp command, PDF export, dashboard consumption —
  each blocked on their own separate concerns (e.g. dashboard is blocked
  on ADR-008, not on this ADR).

---

## 7. Alternatives Considered

- **Bucket by (learner, subject) pair instead of collapsing to one entry
  per learner.** Rejected: while it would avoid inventing the
  worst-subject-wins rule, it lets the same learner appear in more than one
  priority bucket, which is harder for a teacher to scan and answers a
  different question ("which subjects need attention" rather than "which
  learners need attention"). Worst-subject-wins is still purely structural
  (a max over existing `priority` values) rather than a new educational
  rule.
- **Infer insufficient-data from `priority === "medium"`.** Rejected:
  `priority` is a presentation field that intentionally folds
  insufficient-data into "medium" so a teacher still gets a next action.
  Using it as the evidence-availability signal would misclassify genuine
  medium-concern subjects as data gaps and vice versa.
- **A single class mastery percentage (e.g. "72% class mastery").**
  Rejected: hides distribution — a class evenly split between secure and
  beginning could produce the same average as one uniformly developing,
  despite needing a very different teaching response.
- **Fail the whole rollup if any single learner's plan retrieval
  throws.** Rejected: one learner's bad data shouldn't block a teacher from
  seeing the rest of the class. Partial success with a visible `errors[]`
  gives better operational behavior than an all-or-nothing failure.
