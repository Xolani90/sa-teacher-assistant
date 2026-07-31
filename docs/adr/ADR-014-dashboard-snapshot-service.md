# ADR-014: Dashboard Snapshot Service

## 1. Status

**Proposed.** Freezes the composition contract for `dashboardSnapshotService`
ahead of implementation. No code changes accompany this document.

**Depends on:** ADR-007 (`ProgressService`/`CoverageService`/`MasteryService`,
consumed transitively), ADR-009 (`ClassInterventionService`), ADR-013
(`classAnalyticsService`). Consumes `tseGrowthInsightService` where
class-scoped data is available — see §3.4.

---

## 2. Context

The dashboard now has two independently-frozen class-level aggregation
contracts (ADR-009, ADR-013) plus TSE growth insight data, with no single
place a page can ask for "everything about this class" in one call. Left
alone, the dashboard would end up either making three separate fetches
per class page (three loading states, three partial-failure paths to
handle in the UI) or reaching directly into service internals from a
route handler, which breaks the layering discipline every other ADR in
this project has maintained.

Once dashboard pages depend on a shape, changing that shape is expensive.
This ADR exists to freeze that shape once, before any UI code exists
against it — not after.

---

## 3. Decision

Introduce `dashboardSnapshotService`, composing `classAnalyticsService`,
`classInterventionService`, and `tseGrowthInsightService` once per
request. Pure orchestration — no new calculations, no direct repository
access:

```
classAnalyticsService ──┐
classInterventionService ─┼──> dashboardSnapshotService ──> API route ──> Dashboard
tseGrowthInsightService ──┘
```

### 3.1 Entry point

```
getClassSnapshot(phoneHash, classId, options = {})

options: {
  subject?: string   // passed through to classAnalyticsService only;
                      // classInterventionService and tseGrowthInsightService
                      // are not subject-scoped today
}
```

### 3.2 Fault isolation

Each child service call executes independently inside its own
`try/catch`, matching the sequential per-learner isolation pattern
already established in ADR-009 §3.6 and ADR-013 §3.2 — but applied here
at the *section* level rather than the per-learner level, since these
are three independent top-level calls, not a roster iteration.

One section failing never blocks or nulls out the others.

### 3.3 Response contract

```
ClassSnapshot {
  class: {
    id,
    name
  },

  snapshot: {
    analytics:    SnapshotSection<ClassAnalyticsSnapshot>,
    intervention: SnapshotSection<ClassInterventionPlan>,
    qms:          SnapshotSection<TseGrowthInsight>   // see §3.4
  },

  metadata: {
    generatedAt: string,   // ISO timestamp, computed once per call
    partial: boolean,      // true if any section.status !== "ok"
    errors: [ { section: string, reason: string } ]
    // flat list for convenience/logging; the authoritative
    // per-section state is `snapshot.<section>.status`, not this list
  }
}

SnapshotSection<T> {
  status: "ok" | "error",
  data: T | null,
  error: string | null   // null when status === "ok"
}
```

No `"partial"` status at the section level — a section either succeeded
(`"ok"`) or didn't (`"error"`); "partial" is a property of the whole
snapshot (`metadata.partial`), reflecting that some sections succeeded
and at least one did not. This mirrors how `classAnalyticsService` and
`classInterventionService` already report internally: each *learner*
either succeeds or lands in `errors[]`, never something in between.

The UI reads `snapshot.<section>.status` to decide whether to render
that section's data or an "unavailable" state — it never needs to
guess from a null check whether `data: null` means "no data" versus
"call failed," since `status` disambiguates that explicitly.

### 3.4 `qms` section — scope note

`tseGrowthInsightService`'s existing public function may not currently
accept a `classId` (its home is presently teacher-scoped QMS pages, not
class-scoped ones — needs confirming against its actual signature
before implementation). If no class-scoped entry point exists yet:

- Phase 1 ships `qms` with `status: "unavailable"` (a third valid
  status value reserved specifically for "not wired up yet," distinct
  from `"error"`, which means "we tried and it failed") and `data: null`.
- Wiring `tseGrowthInsightService` for real class-level QMS data,
  if it needs a new class-scoped accessor, is out of scope for this
  ADR and becomes a small follow-on PR once confirmed.

### 3.5 Reserved sections

`snapshot` is intentionally an object keyed by section name, not an
array — new sections (attendance, observations, curriculum, AI
insights, predictions) are additive keys, requiring no shape change to
sections already shipped and no frontend fetch-logic change, only a
new key the UI opts into rendering.

---

## 4. Non-goals

- No new mastery/progress/coverage/intervention/QMS calculations — this
  service only composes existing, already-frozen contracts.
- No persistence of the snapshot.
- No caching. If profiling later shows repeated calls are expensive,
  caching is a follow-on concern with its own invalidation-strategy
  ADR, not bundled in here.
- No dashboard rendering, chart data, or React concerns.
- No new API route wiring beyond the single endpoint in §5 — route
  auth/validation follows the exact existing ADR-008 pattern.
- No parallel/concurrent execution of the three child calls in the
  initial implementation, matching ADR-009 §4 and ADR-013 §4's same
  sequential-first stance — revisit only if profiling shows it matters.

---

## 5. Delivery surface

Single endpoint: `GET /api/classes/:classId/snapshot`, following the
existing DI/handler convention in `routes/api.js` (ownership check via
`req.teacher.phoneHash`, 400/404/500 conventions matching
`createGetClassDetailHandler` and siblings). Optional `?subject=` query
param, passed through per §3.1.

---

## 6. Testing Strategy

Tested against mocked `classAnalyticsService`, `classInterventionService`,
and `tseGrowthInsightService`, matching the mocking discipline already
used for ADR-009/ADR-013's own test suites. Minimum coverage:

- All three services succeed — all sections `"ok"`, `metadata.partial`
  is `false`.
- One service throws — its section is `"error"` with the caught
  message, other two sections unaffected, `metadata.partial` is `true`.
- All three throw — snapshot is still well-formed, not itself an
  exception; `metadata.errors` contains all three.
- `qms` section reports `"unavailable"` when no class-scoped
  TSE accessor is wired (§3.4), without affecting `analytics`/
  `intervention`.
- `subject` option passes through to `classAnalyticsService` only,
  verified via the mock's call arguments — `classInterventionService`/
  `tseGrowthInsightService` mocks receive no subject argument.
- Empty/zero-learner class — snapshot still well-formed (delegates
  entirely to the empty-roster behavior each child service already
  guarantees per its own ADR).

---

## 7. Alternatives Considered

- **Flat `errors[]` only, no per-section `status`.** Rejected: the
  earlier draft did this, but it leaves the UI guessing whether
  `data: null` means "genuinely empty" or "call failed" — `status` per
  section removes that ambiguity for free.
- **`snapshot` as an array instead of a keyed object.** Rejected: an
  array requires the frontend to `.find()` by section name, and offers
  no benefit over direct key access for a fixed, named set of sections.
- **Concurrent (`Promise.allSettled`) execution of the three child
  calls.** Deferred, not rejected outright — sequential is simpler to
  reason about and test, and three calls is unlikely to be a latency
  problem yet. Revisit if profiling on a real class size says otherwise,
  same stance as ADR-009/ADR-013.
- **Caching the snapshot per class for N seconds.** Rejected for Phase
  1 — introduces invalidation complexity (a new assessment or
  observation should presumably invalidate it) that deserves its own
  design pass rather than being bundled into the composition ADR.
