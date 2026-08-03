# ADR-014: Dashboard Snapshot Orchestration Service

## Status
Accepted — Implemented

Verified against real seeded data in the dashboard UI. Analytics and
Intervention sections render live values correctly. QMS/TSE gracefully
reports "Not available" when class-scoped data cannot be derived
because growth insights remain teacher-scoped.

## Context
The dashboard currently needs data from multiple independent backend services:

- `classAnalyticsService` (ADR-015) — `getClassAnalytics(phoneHash, classId, options)` — mastery, coverage, and progress aggregates for a class
- `classInterventionService` (ADR-009) — `getClassInterventionPlan(phoneHash, classId, options)` — priority learners, focus topics, recommended actions
- `tseGrowthInsightService` (TSE Phase 4) — `getGrowthInsights(phoneHash, opts)` — evidence-gap insights

**Flagged during drafting:** `tseGrowthInsightService.getGrowthInsights`
is **not class-scoped** — it takes `(phoneHash, { term })` only, with no
`classId` parameter. It queries `curriculum_coverage` /
`assessments` / `intervention_plans` / `observation_assessments`
directly by `phone_hash` and `term`, not per class or per roster. This
ADR does not change that; `dashboardSnapshotService` calls it once per
snapshot using `phoneHash` alone and does not attempt to filter it by
`classId`. If TSE insights are meant to become class-scoped, that is a
change to `tseGrowthInsightService` itself, out of scope here.

Each of these services is independently frozen and tested. If the dashboard
calls them directly, it must:

- know about every backend service it depends on,
- issue multiple requests per page load,
- implement its own fault-handling per service,
- change every time a new snapshot section is added (e.g. attendance,
  observations, QMS readiness, predictions).

This tightly couples the frontend to the backend's internal service graph,
which the project's ADR-driven, layered architecture (routes → flows → core
→ services → utils) is intended to avoid.

## Decision
Introduce `dashboardSnapshotService` as a pure orchestration layer.

- It performs **no calculations of its own**.
- It composes results from child services into a single, stable response.
- It is the only entry point the dashboard route/API needs for a class
  overview.

## Service Composition
- `classAnalyticsService`
- `classInterventionService`
- `tseGrowthInsightService`

## Response Contract

```json
{
  "class": {
    "id": 4,
    "name": "..."
  },
  "snapshot": {
    "analytics": {
      "status": "ok",
      "data": { },
      "error": null
    },
    "intervention": {
      "status": "ok",
      "data": { },
      "error": null
    },
    "tse": {
      "status": "partial",
      "data": null,
      "error": "..."
    }
  },
  "metadata": {
    "generatedAt": "2026-08-01T00:00:00.000Z",
    "version": 1,
    "partial": true,
    "sections": {
      "analytics": "ok",
      "intervention": "ok",
      "tse": "partial"
    }
  }
}
```

Every section under `snapshot` is self-describing: `status`
(`"ok" | "partial" | "error"`), `data`, and `error`. Frontend consumers
branch on `status` per section rather than inferring failure from
missing/null fields. `metadata.sections` mirrors each section's `status`
at the top level for lightweight diagnostics/logging without walking the
full `snapshot` object.

## Fault Isolation
- Each child service call is wrapped independently (e.g. via a shared
  `safeCall` helper already established in prior ADRs).
- A failure in one child service does not throw or block the others.
- `metadata.partial` is `true` if any section has `status !== "ok"`.

## Non-goals
- No persistence of snapshot results.
- No caching (may be revisited in a future ADR if load requires it).
- No duplicated analytics/intervention/TSE logic — this service only
  composes existing, already-frozen contracts.
- No new calculations or business logic.
- No direct database access; all data access is delegated to child
  services.

## Alternatives Considered

1. **Dashboard calls three endpoints directly.**
   Rejected — couples frontend to backend service graph, triples request
   overhead, and duplicates fault-handling logic per consumer.

2. **One monolithic analytics service replacing the three.**
   Rejected — violates the single-responsibility boundaries already
   established in ADR-015 and would require re-testing already-frozen,
   independently verified contracts.

3. **Server-side caching of the snapshot.**
   Deferred — no evidence yet of load that requires it; can be added later
   without changing the contract, since caching is orthogonal to
   composition.

## Consequences
- Stable, self-describing frontend contract regardless of which child
  services succeed or fail.
- New snapshot sections (attendance, observations, QMS readiness,
  predictions, etc.) are additive — existing consumers are unaffected.
- Dashboard code no longer needs to know which services exist or how they
  fail; it only needs to render based on `status`.
- Slightly more indirection for anyone tracing a single metric back to its
  source service, offset by the stability gained at the API boundary.

## Implementation Plan
1. `services/dashboardSnapshotService.js`
   - `getClassSnapshot(phoneHash, classId, options)`
   - Child services are declared in a section registry rather than called
     individually inline:
     ```js
     const snapshotSections = {
       analytics: () => classAnalyticsService.getClassAnalytics(phoneHash, classId, { subject: options.subject }),
       intervention: () => classInterventionService.getClassInterventionPlan(phoneHash, classId, options),
       // NOTE: tseGrowthInsightService is phoneHash/term-scoped, not
       // class-scoped (see Context) — classId is intentionally not passed.
       tse: () => tseGrowthInsightService.getGrowthInsights(phoneHash, { term: options.term }),
     };
     ```
   - Child services are required as whole modules (not destructured),
     matching the convention already established in
     `classInterventionService.js` / `classAnalyticsService.js`, so tests
     can monkey-patch e.g. `classAnalyticsService.getClassAnalytics`
     directly without the reference being captured at require-time.
   - Iterates over the registry, wrapping each entry with the shared
     `safeCall()` helper, so every section automatically gets the same
     fault-isolation policy and adding a future section (attendance,
     observations, AI insights, etc.) is a one-line registry addition
     rather than new orchestration code.
   - Assembles the response contract above, including `metadata.sections`.
2. Unit tests — mirror the fault-isolation test patterns from ADR-015
   (all-succeed, one-fails, all-fail cases).
3. `GET /api/classes/:id/snapshot` — thin route, following the PR18/PR20
   thin-route convention (route only calls the service, no logic in the
   route handler).
4. Dashboard widgets (Analytics Snapshot, Intervention Snapshot, QMS
   Snapshot) consume only this endpoint — no direct calls to child
   services from the frontend.
