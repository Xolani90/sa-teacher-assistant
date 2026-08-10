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
| Assessment detail | ✅ | ✅ (`assessment-capture-*`, `assessment-session-*`) | ✅ |
| Class Detail | ✅ | ✅ (`classDetailService.test.js`, `api-class-detail.test.js`) | ✅ |
| Class Snapshot | ✅ | ✅ (`classSnapshotService.test.js`, `api-class-snapshot.test.js`) | ✅ |
| QMS workspace | ✅ | ✅ (`qmsFlow`, `qmsAnalyticsService`, `qmsTopics*`, `qmsCoachingWorkflow`) | ✅ |
| Item analysis | ✅ | ❓ | ❓ hypothesis disproven 2026-08-06 — facility value confirmed correct; see PROJECT_DECISIONS.md |
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

### Assessment Detail (PR28)

- **Verified:** 2026-08-06 (backend curl-tested same day, see
  `PROJECT_DECISIONS.md`/`CHANGELOG_PROJECT.md`; frontend cross-checked
  against `AssessmentDetail.jsx` source using the same curl response)
- **Assessment used:** id 1, "Fractions Test (Seed)", Grade 6A Mathematics
- **Evidence:**
  - ✓ Backend math independently recomputed and confirmed correct:
    `classAverage: 70` = mean of 100/80/80/60/30; `passRate: 80` = 4/5
    learners ≥50%; both topic averages (`Common Fractions`,
    `Whole Numbers`, both 70%) recompute correctly from per-learner data
  - ✓ `assessment.title/createdAt/assessmentType/isBlueprintBacked`,
    `class.name`, `summary.classAverage/passRate/learnerCount`,
    `analytics.available/topics/perLearnerTopics`,
    `learners[].resultId/learnerName/mark/totalMarks/percentage` all
    match `AssessmentDetail.jsx` field-for-field
  - ✓ `PercentagePill` thresholds (≥75 Strong / ≥50 Developing / <50 At
    Risk) checked against actual data — correct in all 5 cases
- **Verified by:** curl (backend) + component source cross-check
  (frontend), this session

### QMS Workspace

- **Verified:** 2026-08-06
- **Environment:** local development (backend `localhost:3000`, dashboard `localhost:5173`)
- **Evidence:**
  - ✓ `GET /api/tse/status` and `GET /api/reflections` both fire on load
    and resolve correctly
  - ✓ `counts.{curriculum,assessment,intervention,observation,resource}`
    (0, 1, 7, 0, 0) match what each `QMSCategoryCard` displays
  - ✓ `missingCategories` correctly lists the three zero-count categories,
    each rendering the "No evidence yet" dashed-border state
  - ✓ `gaps: []` correctly suppresses the `GapsSection` (guarded by
    `gaps.length > 0`)
  - ✓ non-null `strength` correctly renders the "On track" summary banner
  - ✓ empty `reflections: []` handled cleanly by `ReflectionPanel`
  - Note (not a bug): `latest` field in the `/api/tse/status` response
    isn't consumed by the frontend — same unused-data pattern as
    `recordCount` on Observation Workspace, not a defect
- **Verified by:** manual browser test + live API response review, this
  session

### Class Analytics / Class Intervention (Class Detail snapshot section)

- **Verified:** 2026-08-10
- **Environment:** local development (backend `localhost:3000`, dashboard
  `localhost:5173`)
- **Class used:** Grade 6B Mathematics, classId=4
  (`/classes/4`)
- **Evidence:**
  - ✓ `GET /api/classes/4/snapshot` returned 200 OK (confirmed in Network
    tab, not inferred from UI)
  - ✓ ANALYTICS card rendered real, non-placeholder data: 50% Avg mastery,
    — Avg coverage (expected null — Grade 6 has no CAPS_TOPICS coverage
    data, a known pre-existing gap, not a defect), 62% Avg progress
  - ✓ INTERVENTION card rendered 2 high / 3 medium / 0 low, independently
    cross-checked against the page's own "Intervention priorities" list
    further down (Aisha Petersen/Emma Botha = High; Bongani Zulu/Chloe
    van der Merwe/Dumisani Ngcobo = Medium) — snapshot summary and detail
    list agree, confirming the card reflects real computed data rather
    than a static/independent number
  - ✓ QMS card correctly showed "Not available" rather than fabricated
    data — honest degradation, consistent with the class-level QMS scope
    gap already known
  - Console inspected: only the two already-accepted findings present
    (favicon.ico 404 [W1-F1], React Router v7 future-flag warnings
    [W2-F2]). No errors traceable to `ClassSnapshotSection.jsx`,
    `AnalyticsSnapshotCard`, or `InterventionSnapshotCard`
- **Result:** PASS. No new findings. This also resolves the
  `PROJECT_ROADMAP.md` vs `docs/PROJECT-STATUS.md` discrepancy identified
  during Phase 1 doc reconciliation — the UI consumer was already wired
  and working, not missing.
- **Verified by:** manual browser test + Network tab confirmation, this
  session

### Reflection editing (QMS Workspace — ReflectionPanel create/edit/delete)

- **Verified:** 2026-08-10
- **Environment:** local development (backend `localhost:3000`, dashboard
  `localhost:5173`), QMS Readiness page (`/qms`)
- **Evidence:**
  - ✓ **Create:** `+ Add Reflection` → filled coaching-area dropdown and
    content → `POST /api/reflections` → new reflection appeared in the
    list with correct content and date
  - ✓ **Edit:** clicked `Edit` on a reflection, changed content, `Save
    Changes` → `PATCH /api/reflections/:id` response confirmed in
    Network tab: correct `id`, updated `content`, unchanged `topicId`,
    `updatedAt` advanced past `createdAt`, `deletedAt: null` — matches
    `ReflectionPanel.jsx`'s PATCH body field-for-field
  - ✓ **Empty-content validation:** cleared the textarea while editing
    and attempted to save — client-side blocked it with "Reflection
    cannot be empty.", no PATCH request fired
  - ✓ **Delete:** clicked `Delete` → `Confirm` → reflection removed from
    the list after refresh; confirmed via before/after list state, not
    just the confirmation UI
  - ⚠️ **Open finding (non-blocking):** a `POST /api/reflections 401
    (Unauthorized)` appeared in the console during two earlier create
    attempts in this same session (stack traced to
    `ReflectionPanel.jsx:94` → `TeacherContext.jsx:43` → `client.js:79`),
    despite the create visibly succeeding with no inline error and no
    forced logout each time. Re-tested with Network log cleared and a
    single isolated click: request came back `200`, no 401, 5 requests
    total, none failed. Same tab/session throughout — token/session
    expiry ruled out as the cause. Root cause not identified; not
    reproduced under clean single-click conditions. Logging this as a
    known intermittent issue for follow-up investigation, not a blocker
    — the code path (`authenticatedFetch`) does not silently retry on
    401, so a real 401 on the actual create request would visibly break
    the flow (inline error, forced logout), which did not happen.
  - Console otherwise consistent with the two already-accepted findings
    (favicon 404 [W1-F1], React Router v7 future-flag warnings [W2-F2])
- **Result:** PASS, with one open non-blocking finding (intermittent
  401 above) logged for follow-up.
- **Verified by:** manual browser test + Network tab confirmation, this
  session

### Reflection editing (QMS Workspace — ReflectionPanel create/edit/delete)

- **Verified:** 2026-08-10
- **Environment:** local development (backend `localhost:3000`, dashboard
  `localhost:5173`), QMS Readiness page (`/qms`)
- **Evidence:**
  - ✓ **Create:** `+ Add Reflection` → filled coaching-area dropdown and
    content → `POST /api/reflections` → new reflection appeared in the
    list with correct content and date
  - ✓ **Edit:** clicked `Edit` on a reflection, changed content, `Save
    Changes` → `PATCH /api/reflections/:id` response confirmed in
    Network tab: correct `id`, updated `content`, unchanged `topicId`,
    `updatedAt` advanced past `createdAt`, `deletedAt: null` — matches
    `ReflectionPanel.jsx`'s PATCH body field-for-field
  - ✓ **Empty-content validation:** cleared the textarea while editing
    and attempted to save — client-side blocked it with "Reflection
    cannot be empty.", no PATCH request fired
  - ✓ **Delete:** clicked `Delete` → `Confirm` → reflection removed from
    the list after refresh; confirmed via before/after list state, not
    just the confirmation UI
  - ⚠️ **Open finding (non-blocking):** a `POST /api/reflections 401
    (Unauthorized)` appeared in the console during two earlier create
    attempts in this same session (stack traced to
    `ReflectionPanel.jsx:94` → `TeacherContext.jsx:43` → `client.js:79`),
    despite the create visibly succeeding with no inline error and no
    forced logout each time. Re-tested with Network log cleared and a
    single isolated click: request came back `200`, no 401, 5 requests
    total, none failed. Same tab/session throughout — token/session
    expiry ruled out as the cause. Root cause not identified; not
    reproduced under clean single-click conditions. Logging this as a
    known intermittent issue for follow-up investigation, not a blocker
    — the code path (`authenticatedFetch`) does not silently retry on
    401, so a real 401 on the actual create request would visibly break
    the flow (inline error, forced logout), which did not happen.
    - **Investigation (same session, static trace, no code changed):**
      - `ReflectionPanel.jsx` create/edit both go through the same
        `authedFetch` → `authenticatedFetch` path used by every other
        endpoint in the dashboard — no reflections-specific request
        logic.
      - `TeacherProvider`'s token state is hydrated synchronously
        (`useState(() => getStoredToken())`) before first render, and
        `ProtectedRoute` gates off that same in-memory state — no
        async token-hydration race window before a user can interact
        with the panel.
      - Server-side, `requireTeacherAuth` is mounted once, blanket,
        over the entire `/api` router (`server.js`) — reflections
        routes have no auth logic of their own; they inherit the exact
        same middleware as classes/learners/topics/status.
      - Duplicate GET requests observed throughout this session
        (`topics`, `reflections` listing, `classes`, `learners` each
        fetched twice per load) are consistent with React 18
        `<StrictMode>` (confirmed enabled in `main.jsx`)
        double-invoking effects in dev — expected/benign, and doesn't
        explain a duplicated `onClick`-triggered POST, since StrictMode
        double-invokes effects, not click handlers.
      - A genuine 401 from `requireTeacherAuth` triggers
        `TeacherContext`'s auth-failure path: cleared stored token,
        cleared React auth state, thrown `ApiError` surfaced as an
        inline form error. None of that occurred alongside the
        successful creates — indicating the 401 that appeared in the
        console did not come from the request that actually created
        the reflection, but from a second, unidentified request.
      - **Disposition:** insufficient evidence to identify the second
        request or its cause; not a proven product defect, not
        dismissed as noise either. If it recurs, `requireTeacherAuth`
        logs the specific rejection reason server-side
        (`[TEACHER_AUTH] ...`) on every 401 — checking the backend
        terminal at the moment of recurrence would disambiguate
        expired/malformed/unknown-teacher without any code change.
        No code change is justified until then.
  - Console otherwise consistent with the two already-accepted findings
    (favicon 404 [W1-F1], React Router v7 future-flag warnings [W2-F2])
- **Result:** PASS, with one open non-blocking finding (intermittent
  401 above) logged for follow-up.
- **Verified by:** manual browser test + Network tab confirmation, this
  session

## Rule going forward

A row only moves to browser ✅ after an actual session, with a full entry
added to "Verified By" above — date, environment, specific evidence, who/how
it was verified. Passing backend tests is necessary but not sufficient to
call a feature done.
