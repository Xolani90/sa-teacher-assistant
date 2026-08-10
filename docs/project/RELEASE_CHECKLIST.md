# Release Checklist

Ticked only when personally confirmed. This is the release gate — when every
box below is checked, the app is a release candidate. Not before.

Source of truth for the underlying facts is `PROJECT_STATUS.md`. This file
is just that data reshaped as a checklist; if the two ever disagree, trust
`PROJECT_STATUS.md` and fix this file, not the other way round.

```
Authentication
  [x] Backend
  [ ] Tests        (exists somewhere in tests/, exact file not yet confirmed)
  [x] Browser

Home dashboard
  [ ] Backend       (page renders live data; which service backs it not yet confirmed)
  [x] Browser

Classes (list)
  [x] API wired
  [x] Backend
  [x] Tests         (api-classes.test.js, pr18-api-classes-wiring.test.js)
  [x] Browser        — verified 2026-08-06, see VERIFIED.md

Class Detail
  [x] API wired
  [x] Backend
  [x] Tests         (classDetailService.test.js, api-class-detail.test.js)
  [x] Browser        — verified 2026-08-06, see VERIFIED.md

Class Snapshot
  [x] API wired
  [x] Backend
  [x] Tests         (classSnapshotService.test.js, api-class-snapshot.test.js)
  [x] Browser        — verified 2026-08-06, see VERIFIED.md; ADR-014
                        discrepancy resolved, see PROJECT_DECISIONS.md

Class Analytics
  [x] Frontend consumer located — ClassSnapshotSection.jsx on Class
                        Detail (/classes/:classId), confirmed via
                        browser verification 2026-08-10, see VERIFIED.md
  [x] Backend
  [x] Tests         (classAnalyticsService.test.js)
  [x] Browser        — verified 2026-08-10, see VERIFIED.md

Class Intervention
  [x] Frontend consumer located — ClassSnapshotSection.jsx on Class
                        Detail (/classes/:classId), confirmed via
                        browser verification 2026-08-10, see VERIFIED.md
  [x] Backend
  [x] Tests         (classInterventionService.test.js, class-intervention-pdf.test.js)
  [x] Browser        — verified 2026-08-10, see VERIFIED.md

Learner Detail
  [x] API wired
  [x] Backend
  [x] Tests         (learnerRepository.test.js, learnerTimelineService.test.js)
  [x] Browser        — verified 2026-08-06, see VERIFIED.md

Learners (list)
  [x] Frontend page — CONFIRMED does not exist (no /learners route in App.jsx)
  [x] API wired      (backend endpoint exists, just has no list-page consumer)
  [x] Backend
  [x] Tests          (api-learners.test.js, pr20-api-learners-wiring.test.js)
  [ ] Browser         — N/A until built; not a verification task, a build task

Observation Workspace
  [x] Backend
  [x] Tests         (observationFlow-*, observationRepository-*, observationAnalysisService.test.js)
  [x] Browser        — verified 2026-08-06, see VERIFIED.md

Observation Detail
  [x] Backend
  [x] Tests
  [x] Browser        — verified 2026-08-06, see VERIFIED.md; genuine
                        click-through, supersedes prior seeded-data claim

Assessment Detail (PR28)
  [x] Backend        — curl-tested 2026-08-06, response well-formed,
                        figures independently recomputed and confirmed
                        correct
  [x] Tests          (assessment-capture-*, assessment-session-*)
  [x] Browser        — verified 2026-08-06, see VERIFIED.md

QMS Workspace
  [x] Backend
  [x] Tests          (qmsFlow, qmsAnalyticsService, qmsTopics*, qmsCoachingWorkflow)
  [x] Browser        — verified 2026-08-06, see VERIFIED.md

Item Analysis (deterministic — averageFacilityValue/averageDiscrimination/
target group size exposure on Assessment Detail)
  [x] Backend         — RC-1 W4-F1: exposure gap fixed and verified via
                        real HTTP/DB integration (36/36 tests passing,
                        Scenarios A-E). See docs/testing/RC1_SIGNOFF.md.
  [x] Tests           — tests/w4-f1-assessment-detail-integration.test.js
  [ ] Browser         — not yet logged in VERIFIED.md as its own
                        browser-verification entry (Assessment Detail's
                        overall page was verified 2026-08-06, before this
                        fix; a fresh pass confirming itemAnalysis/
                        interventionSummary render correctly would close
                        this box with real evidence rather than inference)

Intervention Plan (AI-generated — fullInterventionPlan.js prompt group-
count claim, distinct from the deterministic computeInterventionPlan()
above)
  [ ] Backend         — status unchanged: "not reproduced" per
                        docs/project/ACTIVE_WORK.md history. RC-1 did not
                        investigate this specific claim; do not mark
                        resolved without new evidence.
  [ ] Browser

Frontend test coverage
  [ ] Any tests exist  — currently 0 files in dashboard/

Production readiness
  [ ] Deployment config reviewed
  [ ] CI/CD
  [ ] Monitoring/logging
  (not audited yet — needs its own pass before checking any of these off)
```

## How to use this file

- Only check a box after doing the thing yourself, not because a related
  box is checked or a service "should" work.
- When you check a Browser box, add a one-line note to `VERIFIED.md` with
  what you actually did.
- Don't add new rows for new features here — add them to
  `PROJECT_INVENTORY.md` first, then mirror into this checklist once backend
  work starts.
