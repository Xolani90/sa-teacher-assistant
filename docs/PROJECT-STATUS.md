# SA Teacher Assistant

## Project Status

Last verified: 2026-08-01

This document reflects what has been **verified by inspecting the codebase**,
not what is assumed or remembered from earlier sessions. Where a milestone
was investigated and found already implemented, that is noted explicitly so
future sessions don't re-plan work that already exists. See the Discovery
Log at the bottom for how this document came to look the way it does.

---

## Completed

### Architecture (ADRs)

- ✅ ADR-008 — Teacher authentication
- ✅ ADR-009 — Class Intervention rollup
- ✅ ADR-010 — QMS/TSE relationship
- ✅ ADR-011 — QMS domain model
- ✅ ADR-012 — QMS Action Centre
- ✅ ADR-015 — Class Analytics Snapshot
- ✅ ADR-014 — Dashboard Snapshot Orchestration Service
  — Status corrected from "Proposed" to "Accepted — Implemented"
  (commit `c33f06b`), verified against real seeded data in the browser.

### Dashboard

- ✅ Class Snapshot (`classSnapshotService` → `GET /api/classes/:classId/snapshot`
  → `ClassSnapshotSection.jsx`) — Analytics, Intervention, and QMS cards,
  each independently fault-isolated.
- ✅ Learner Detail (`learnerDetailService` → `GET /api/learners/:learnerId/detail`
  → `LearnerDetail.jsx`) — KPIs, assessment history, CAPS coverage,
  intervention priorities, observations, recommended actions.
- ✅ Assessment Detail (`assessmentDetailService` → `GET /api/assessments/:assessmentId/detail`
  → `AssessmentDetail.jsx`) — class-level and per-learner topic analytics
  for blueprint-backed assessments, honest degradation for legacy
  (non-blueprint) assessments.

### Analytics

- ✅ Class Analytics (`classAnalyticsService`, ADR-015)
- ✅ Class Intervention (`classInterventionService`, ADR-009)
- ✅ Learner Analytics — **discovered already implemented** during
  investigation for a planned analytics ADR (no number was ever
  assigned); no new ADR or service was needed.
- ✅ Assessment Analytics (`blueprintAnalytics` + `itemAnalysisService`)
  — **discovered already implemented** during the same investigation
  pass.

### QMS

- ✅ QMS Action Centre (`/qms`, `QMSSummaryBanner`, `QMSCategoryCard`,
  `QMSCategoryActions`, `tseEvidenceService.getStatusSnapshot`)
- ✅ Reflection viewing (`reflectionService.listReflections` →
  `GET /api/reflections` → `ReflectionPanel.jsx`)
- 🟡 Reflection editing — `reflectionService.js` already has
  `createReflection`, `updateReflection`, and `deleteReflection`
  implemented, but only `listReflections` is exposed via the API.
  `ReflectionPanel.jsx` is read-only by design ("Logged via WhatsApp").
  This is a small, scoped gap: thin routes + edit UI, no new service.

### Observations

- ✅ Observation Detail (`observationDetailService` →
  `GET /api/observations/:assessmentId` → `ObservationDetail.jsx`),
  supported by `observationAnalysisService`, `observationGroupingService`.
- ✅ Observation Workspace (`ObservationWorkspace.jsx` → `/observations`,
  backed by `GET /api/observations`, a thin route wrapping
  `observationRepository.getObservationHistory`) — grade/subject filters,
  free-text search, links into `ObservationDetail.jsx`. No new service or
  ADR needed; composed an existing, already-tested repository read.
  Nav entry added to `Layout.jsx`. (commit `2148502`)

---

## Known Limitations

### Curriculum Dataset (Grades R–6)

Status: Known limitation, not a defect.

`CAPS_TOPICS` currently begins at Grade 7. Foundation Phase (R–3) and
Intermediate Phase (4–6) curriculum data is absent for all subjects.
Affected services correctly report unavailable coverage rather than
producing misleading values.

Affected: `curriculumIntelligenceService`, `curriculumCoverageService`,
`coverageService`, `blueprintTopicValidation`, `masteryService` (coverage-
driven escalation), `classInterventionService`, `classAnalyticsService`,
Dashboard Snapshot Analytics card.

Full detail and acceptance criteria tracked in:
`docs/backlog/curriculum-data-gaps.md`

---

## Next Milestones

1. **Reflection editing** — expose `createReflection`/`updateReflection`/
   `deleteReflection` via thin routes, add edit UI to `ReflectionPanel.jsx`.
2. **Reporting Centre** — likely the largest genuine gap remaining.
   Orchestrates existing PDF/export generators (class, learner, blueprint,
   intervention) behind a single workspace. Deserves its own ADR, since
   it introduces a new workspace rather than composing an existing
   aggregation contract.
3. **Curriculum expansion** — populate Grades R–6 CAPS data. Content
   project, not a redesign; see backlog doc for acceptance criteria.

---

## Architecture Notes

The project has reached a composition phase. Most core domain services
(analytics, intervention, mastery, coverage, learner/assessment/
observation detail, QMS evidence and reflections) already exist and are
independently tested. Recent investigations (Learner Analytics, Assessment
Analytics, QMS Action Centre, Observation Detail) repeatedly found
"missing" features were already implemented, just not reflected in the
running mental model of the project.

Going forward, before proposing a new ADR or service, investigate first:

- Does an aggregation service already exist for this data?
- Is there already a route exposing it?
- Is there already a frontend page/component consuming it?

Only write a new ADR when the investigation confirms a genuine
architectural gap — a new orchestration contract, not just a new UI on
top of an existing one. Most remaining work is expected to be composition,
navigation, and exposing existing capabilities rather than new domain
services.

---

## Discovery Log

### 2026-08-01

Verified existing functionality that no longer requires implementation:

- Learner Analytics already implemented (`learnerDetailService.js` +
  `LearnerDetail.jsx`) — investigated while scoping a planned analytics
  ADR (no number was ever assigned); no new ADR or service was needed.
- Assessment Analytics already implemented (`assessmentDetailService.js`
  + `blueprintAnalytics.js` + `itemAnalysisService.js` +
  `AssessmentDetail.jsx`).
- Observation Detail already implemented (`observationDetailService.js`
  + `ObservationDetail.jsx`).
- QMS Action Centre already implemented (ADR-012, `/qms`,
  `QMSSummaryBanner`, `QMSCategoryCard`, reflections viewing).

New findings from the same investigation pass:

- Observation Workspace requires a browse/list page — detail view exists
  but there is no index route or filtering UI.
- Reflection editing: backend service functions
  (`createReflection`/`updateReflection`/`deleteReflection`) already
  exist in `reflectionService.js`, but are not exposed via API routes or
  the dashboard UI, which is currently read-only.
- Curriculum dataset (`CAPS_TOPICS`) currently begins at Grade 7; no
  Foundation or Intermediate Phase data exists. Logged as a backlog item
  rather than a defect, since affected services degrade honestly.
- ADR-014's Status field was found still marked "Proposed" despite the
  Dashboard Snapshot service being fully implemented, tested, and
  browser-verified against real seeded data. Corrected to
  "Accepted — Implemented" (commit `c33f06b`).

### 2026-08-01 (later)

- Investigated Observation and QMS Workspaces before assuming either was
  a genuine gap, per the discipline established above.
- QMS: Action Centre confirmed complete. Reflection viewing complete.
  Reflection editing found to be a small, scoped gap — backend functions
  (`createReflection`/`updateReflection`/`deleteReflection`) already
  exist in `reflectionService.js`, but are not exposed via API routes or
  the read-only `ReflectionPanel.jsx` UI. Logged as a Next Milestone, not
  a new workspace.
- Observation: confirmed genuine gap (no browse/list page). Built
  `ObservationWorkspace.jsx` + `GET /api/observations` as a thin route
  wrapping `observationRepository.getObservationHistory` — composition
  only, no new service, no ADR. Shipped and pushed (commit `2148502`).
