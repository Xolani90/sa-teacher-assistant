# Verified — Release Checklist

The question this file answers, and the only question it answers:
**have I personally proven this works, end to end, in a browser?**

Passing backend tests earns the "Tests" column, not the "Browser" column.
A row only gets a browser ✅ after an actual click-through, noted below.

| Feature | Backend | Tests | Browser |
|---|---|---|---|
| Login (OTP request) | ✅ | ❓ (not confirmed which test file covers this) | ✅ |
| OTP verification / JWT | ✅ | ❓ | ✅ |
| Protected routes | ✅ | ❓ | ✅ |
| Home dashboard | ❓ | ❓ | ✅ |
| Classes list | ✅ | ✅ `api-classes.test.js`, `pr18-api-classes-wiring.test.js` | ✅ |
| Class detail | ✅ | ✅ `classDetailService.test.js`, `api-class-detail.test.js` | ⏳ |
| Class snapshot | ✅ | ✅ `classSnapshotService.test.js`, `api-class-snapshot.test.js` | ⏳ |
| Learner detail | ✅ | ✅ `learnerRepository.test.js`, `learnerTimelineService.test.js` | ✅ |
| Learners list | ✅ | ✅ `api-learners.test.js`, `pr20-api-learners-wiring.test.js` | ⏳ |
| Observation workspace | ✅ | ✅ (multiple `observationFlow-*`, `observationRepository-*`) | ✅ |
| Observation detail | ✅ | ✅ | ✅ |
| Assessment detail | ✅ | ✅ (`assessment-capture-*`, `assessment-session-*`) | ⏳ |
| Class Detail | ✅ | ✅ (`classDetailService.test.js`, `api-class-detail.test.js`) | ✅ |
| Class Snapshot | ✅ | ✅ (`classSnapshotService.test.js`, `api-class-snapshot.test.js`) | ✅ |
| QMS workspace | ✅ | ✅ (`qmsFlow`, `qmsAnalyticsService`, `qmsTopics*`, `qmsCoachingWorkflow`) | ⏳ |
| Item analysis | ✅ | ❓ | ❌ known bug — do not mark ⏳ until `question_data` field mismatch is fixed |
| Intervention plan (AI) | ✅ | ❓ | ❌ known bug — AI misstates group counts |

Legend: ✅ done and confirmed · ⏳ implemented, not yet browser-verified ·
❓ status genuinely unknown, needs checking · ❌ known broken, don't attempt
to verify until fixed

## Verified By — evidence log

Detailed entries only for rows actually marked ✅ Browser above. This is the
"is X actually working?" answer with receipts, not a restatement of the
table.

### Authentication

- **Verified:** during PR24 session (exact date not independently
  confirmed in this audit — no `.git` history available; treat as
  approximate)
- **Environment:** local development
- **Evidence:**
  - ✓ OTP request → `devOtp` returned in response, auto-filled into UI field
  - ✓ OTP verification → JWT issued
  - ✓ `ProtectedRoute.jsx` → `TeacherContext.jsx` gated correctly
  - ✓ Dashboard loaded post-login
- **Verified by:** manual browser test (screenshots reviewed, not
  independently re-run in this audit)

### Home dashboard

- **Verified:** same session as Authentication above
- **Environment:** local development
- **Evidence:**
  - ✓ "Good morning, Thabo" personalized greeting rendered
  - ✓ 4 classes, 10 learners shown, matching real seeded data
  - ✓ Class cards populated live from `GET /api/classes` and
    `GET /api/learners` (confirmed via Network panel per original session)
- **Verified by:** manual browser test (screenshots reviewed, not
  independently re-run in this audit)

### Classes list

- **Verified:** 2026-08-06
- **Environment:** local development (backend `localhost:3000`, dashboard `localhost:5173`)
- **Evidence:**
  - ✓ `GET /api/classes` returned 4 classes, correct shape (`id`, `name`,
    `grade`, `subject`, `learnerCount`, `createdAt`, `updatedAt`)
  - ✓ All 4 cards rendered on screen matching the response exactly
  - ✓ Console clean — only React Router v6→v7 future-flag deprecation
    warnings (library noise, not app bugs) and a cosmetic `favicon.ico` 404
  - Note (not a bug): ids 3 and 4 are both named "Grade 6B Mathematics
    (Analytics Stress Test)" — leftover test data, not a rendering defect
- **Verified by:** manual browser test, this session, live

### Class Detail / Class Snapshot

- **Verified:** 2026-08-06
- **Environment:** local development (backend `localhost:3000`, dashboard `localhost:5173`)
- **Class used:** Grade 6A Mathematics (id 2, 5 learners — chosen for real data)
- **Evidence:**
  - ✓ `GET /api/classes/:id/detail` response fields match exactly what
    `ClassDetail.jsx` reads: `classHealth`,
    `curriculumCoverage.dataAvailable/percentage/remainingTopics`,
    `recentAssessments`, `interventions.summary.evaluatedLearners/
    insufficientData`, `interventions.priorityLearners.high/medium`
  - ✓ `GET /api/classes/:id/snapshot` response: `analytics` and
    `interventions` sections both return `status: "ok"` with real data
  - ✓ `qms` section returns `status: "unavailable"` — confirmed by code
    (`ClassSnapshotSection.jsx` comment: "Per ADR-014 §3.4, this section
    always reports 'unavailable' today") that this is an intentional,
    handled state, not an error — renders "Not available at the class
    level yet."
  - ✓ `metadata.partial: true` on the snapshot response is expected given
    the QMS non-availability, not a bug
- **Resolves:** the ADR-014 vs `VERIFIED.md` discrepancy flagged in
  `PROJECT_DECISIONS.md` — ADR-014's claim was accurate; `VERIFIED.md` was
  just being appropriately conservative until independently re-checked
  here.
- **Verified by:** manual browser test + live API response review, this
  session

### Learner Detail

- **Verified:** 2026-08-06
- **Environment:** local development (backend `localhost:3000`, dashboard `localhost:5173`)
- **Learner used:** Kagisho Van Wyk (id 5, Grade 6A Mathematics — has real
  assessment, intervention, and observation data)
- **Evidence:**
  - ✓ `GET /api/learners/:learnerId/detail` response fields match exactly
    what `LearnerDetail.jsx` reads: `learner.name/className/grade/classId`,
    `performance.overallAverage/passRate/trend`,
    `assessmentHistory[].resultId/title/subject/term/percentage`,
    `curriculumCoverage.dataAvailable`, `interventions.plans[].priority`,
    `observations.totalSessions/recent[]`, `recommendedActions[]`
  - ✓ `performance.trend: "insufficient-data"` is a handled trend key →
    renders "Not enough data yet" (not a raw/broken value)
  - ✓ `curriculumCoverage.dataAvailable: false` correctly falls to the
    empty state, not a blank/broken section
  - ✓ `interventions.plans[0].priority: "medium"` correctly passes the
    high/medium filter and renders in the priorities list
  - ✓ Both observation cards render with title and date, correctly
    link to `/observations/:assessmentId`
  - No mismatches, no zeroed-out fields
- **Verified by:** manual browser test + live API response review, this
  session

## Rule going forward

A row only moves to browser ✅ after an actual session, with a full entry
added to "Verified By" above — date, environment, specific evidence, who/how
it was verified. Passing backend tests is necessary but not sufficient to
call a feature done.
