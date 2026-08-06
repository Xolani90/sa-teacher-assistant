# Project Inventory

Evidence-based. Every row below was confirmed by reading actual files in this
repo (paths, route registrations, test files) — not inferred from PR names or
prior conversation summaries. "Browser verified" only means confirmed live in
a browser during this project; anything else is marked unknown, not assumed
working.

Legend: ✅ done · 🚧 partial · ⚪ not started · ❓ unverified

| Feature | Backend | Frontend | API wired | Tests | Browser verified |
|---|---|---|---|---|---|
| Auth (OTP + JWT) | ✅ `routes/auth.js` | ✅ `Login.jsx` | ✅ | ❓ | ✅ (login → dashboard confirmed live) |
| Classes list | ✅ `getTeacherClasses` | ✅ `Classes.jsx` (130 lines) | ✅ `GET /api/classes` | ✅ `api-classes.test.js`, `pr18-api-classes-wiring.test.js` | ❓ |
| Class detail | ✅ `classDetailService.js` | ✅ `ClassDetail.jsx` (333 lines) | ✅ `GET /api/classes/:id/detail` | ✅ `classDetailService.test.js`, `api-class-detail.test.js` | ❓ |
| Class snapshot (ADR-014) | ✅ `classSnapshotService.js` | ✅ same file, second fetch | ✅ `GET /api/classes/:id/snapshot` | ✅ `classSnapshotService.test.js`, `api-class-snapshot.test.js` | ❓ |
| Class analytics (ADR-015) | ✅ `classAnalyticsService.js` | ❓ not yet located in dashboard pages | ❓ | ✅ `classAnalyticsService.test.js` | ❓ |
| Class intervention | ✅ `classInterventionService.js` | ❓ | ❓ | ✅ `classInterventionService.test.js`, `class-intervention-pdf.test.js` | ❓ |
| Learners list | ✅ `getTeacherLearners` | ❓ (list page not yet located) | ✅ `GET /api/learners` | ✅ `api-learners.test.js`, `pr20-api-learners-wiring.test.js`, `getTeacherLearners.test.js` | ❓ |
| Learner detail | ✅ `learnerRepository.js` etc. | ✅ `LearnerDetail.jsx` (267 lines) | ✅ `GET /api/learners/:id/detail` | ✅ `learnerRepository.test.js`, `learnerTimelineService.test.js` | ❓ |
| Learner intervention plan | ✅ | ❓ | ✅ `GET /api/learners/:id/intervention-plan` | ✅ `learner-intervention-pdf.test.js` | ❓ |
| Observation workspace | ✅ multiple services | ✅ `ObservationWorkspace.jsx` | ❓ needs confirming | ✅ many (`observationFlow-*`, `observationRepository-*`, `observationAnalysisService.test.js`) | ❓ |
| Observation detail | ✅ | ✅ `ObservationDetail.jsx` | ❓ | ✅ | ✅ (per prior session notes — recently verified with seeded test data; not independently re-checked in this audit) |
| Assessment detail | ✅ `assessmentDetailService.js` (per memory, not yet re-read in this audit) | ✅ `AssessmentDetail.jsx` (largest page, 12.9KB) | ❓ | ✅ `assessment-capture-service.test.js`, `assessmentCaptureService.edit.test.js`, `assessment-session-*.test.js` | ❓ |
| QMS | ✅ multiple services (`qmsAnalyticsService`, `qmsCoachingWorkflow`, etc.) | ✅ `QMS.jsx` + `components/qms/` | ❓ | ✅ `qmsFlow.test.js`, `qmsAnalyticsService.test.js`, `qmsTopics.test.js`, `qmsTopicSelection.test.js`, `qmsTopicMigration.test.js`, `qmsCoachingWorkflow.test.js` | ❓ |
| Home / command center | ❓ | ✅ `Home.jsx` (10.4KB) | ❓ | ❓ | ✅ ("Good morning, Thabo" dashboard confirmed live per PR24 session) |
| Item analysis (facility/discrimination) | ✅ `itemAnalysisService.js` | ❓ | ❓ | ❓ | ⚪ **known bug in progress** — zeroed-out values traced to field-name mismatch in `question_data` between write path and read path |
| Intervention plan AI generation | ✅ `fullInterventionPlan.js` | n/a | n/a | ❓ | ⚪ **known bug in progress** — model restating group counts incorrectly |

## Notable gap not reflected in prior estimates

**`dashboard/` has zero test files.** All 57 test files in `tests/` cover
backend services and routes only. Frontend correctness currently rests
entirely on manual browser verification, which per the table above has only
been done for Auth and Home. This is a real risk area, not a rounding error —
worth treating "frontend tests" as its own backlog item rather than folding it
into "polish."

## Not yet audited this session

Curriculum data, reports, deployment/CI config, `_removed_dead_code/`
(name suggests already resolved but not confirmed). Don't assume status
without checking.

## Evidence detail — confirmed rows

Full file-level evidence for the rows in the table above that were directly
confirmed by reading code during this audit (not for rows still marked ❓).

### Classes

```
Status: ✓ Backend  ✓ API  ✓ Tests  ⏳ Browser

Frontend:
  dashboard/src/pages/Classes.jsx (130 lines, calls authedFetch('/api/classes'))

Backend:
  routes/api.js (GET /classes, line 835 — getTeacherClasses, scoped by phoneHash)

Tests:
  tests/api-classes.test.js
  tests/pr18-api-classes-wiring.test.js

Verified: No
```

### Class Detail

```
Status: ✓ Backend  ✓ API  ✓ Tests  ⏳ Browser

Frontend:
  dashboard/src/pages/ClassDetail.jsx (333 lines)
  dashboard/src/components/ClassSnapshotSection.jsx

Backend:
  routes/api.js (GET /classes/:classId/detail, line 840)
  routes/api.js (GET /classes/:classId/snapshot, line 845 — ADR-014)
  services/classDetailService.js
  services/classSnapshotService.js

Tests:
  tests/classDetailService.test.js
  tests/classDetailService-integration.test.js
  tests/api-class-detail.test.js
  tests/pr-api-class-detail-wiring.test.js
  tests/classSnapshotService.test.js
  tests/api-class-snapshot.test.js

Verified: No — ⚠️ ADR-014 itself claims "verified against real seeded data
in the dashboard UI," which conflicts with this row. See
PROJECT_DECISIONS.md for the open discrepancy; don't resolve it silently.
```

### Learner Detail

```
Status: ✓ Backend  ✓ API  ✓ Tests  ⏳ Browser

Frontend:
  dashboard/src/pages/LearnerDetail.jsx (267 lines)

Backend:
  routes/api.js (GET /learners/:learnerId/detail, line 850)
  services/learnerRepository.js

Tests:
  tests/learnerRepository.test.js
  tests/learnerTimelineService.test.js

Verified: No
```

Remaining rows (Learners list, Observation, Assessment, QMS, etc.) have
service/test file names confirmed in the summary table above but haven't had
their exact frontend-consumer path or route line number individually
verified in this pass — add the same three-part evidence block here once
that's done, rather than filling it in from memory.
