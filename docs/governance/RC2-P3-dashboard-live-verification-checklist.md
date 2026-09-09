# RC2 P3 — Dashboard Live End-to-End Verification Checklist

**STATUS: PARTIALLY PERFORMED — server-side and unauthenticated checks
done 2026-09-09 (see "Verification log" below); every box requiring a
logged-in teacher session in a real browser remains OUTSTANDING.**

Automated coverage for these same code paths already passes (111/111
across `blueprints-dashboard-e2e.test.js`,
`growth-plans-dashboard-e2e.test.js`, `reflections-dashboard-e2e.test.js`,
`resources-dashboard-e2e.test.js`, `resources-dashboard-wiring.test.js`).
What remains is confirming the same behavior against the real deployed
dashboard at `https://sa-teacher-assistant.onrender.com`, in a real
browser, with a real logged-in teacher session — the gap flagged as an
open RC2 follow-up in commit `3ab093f`.

Do this once, top to bottom, on the live site. Check each box only after
you've actually seen the described result — not from memory of how it's
supposed to work.

## Setup

- [x] Confirm the dashboard loads at
      `https://sa-teacher-assistant.onrender.com/app` — **note the `/app`
      path.** The bare domain serves the public marketing landing page by
      design, not the dashboard. Verified 2026-09-09 (Verification log,
      item 1)
- [ ] Log in via `Login.jsx` with a real teacher account
- [ ] Confirm `ProtectedRoute.jsx` actually blocks dashboard pages when logged
      out (open an inner page URL directly in a private/incognito window
      with no session — should redirect to Login, not show data)
      — **half-verified 2026-09-09.** The "not show data" half is proven
      server-side (Verification log, items 3–4): an inner URL returns only
      the SPA shell, and every API endpoint refuses an unauthenticated or
      forged request. The client-side redirect to `/login` itself still
      needs a real browser and is not claimed here.

## Home / Classes (`GET /classes`)

- [ ] `Home.jsx` loads without error and shows real data (not an empty/
      loading-forever state)
- [ ] `Classes.jsx` lists your real classes
- [ ] Open a class → `ClassDetail.jsx` (`GET /classes/:classId/detail`) shows
      correct roster/learner list
- [ ] Class snapshot section (`ClassSnapshotSection.jsx`,
      `GET /classes/:classId/snapshot`) renders real analytics, not
      placeholder/zeroed data
- [ ] Edit a class (`PATCH /classes/:classId`) — change something small,
      confirm it persists after a page refresh
- [ ] From `ClassDetail`, open a learner → `LearnerDetail.jsx`
      (`GET /learners/:learnerId/detail`) shows correct learner info
- [ ] From `LearnerDetail`, check the intervention plan section
      (`GET /learners/:learnerId/intervention-plan`) renders correctly
- [ ] (Destructive — use a disposable test learner/class, not a real one)
      Delete a learner (`DELETE /learners/:learnerId`) and confirm it's
      actually gone from the roster afterward

## Resources (`GET/DELETE /resources`)

- [ ] `ResourcesWorkspace.jsx` lists real saved resources matching what
      `MY RESOURCES` shows on WhatsApp for the same teacher
- [ ] Open one → `ResourceDetail.jsx` (`GET /resources/:id`) shows the full
      content correctly
- [ ] Delete a disposable test resource (`DELETE /resources/:id`) and
      confirm it disappears from the list on refresh

## Observations (`GET/PATCH /observations`)

- [ ] `ObservationWorkspace.jsx` lists real observations
      (`GET /observations`)
- [ ] Open one → `ObservationDetail.jsx` (`GET /observations/:assessmentId`)
      shows correct detail
- [ ] Edit an observation record (`PATCH /observations/records/:recordId`)
      and confirm the change persists

## Assessments / Blueprints (`GET /assessments`, `GET /blueprints`)

- [ ] Open an assessment detail (`GET /assessments/:assessmentId/detail`) —
      confirm marks/analysis shown match what you'd expect from the real
      capture session
- [ ] Download the assessment PDF (`GET /assessments/:assessmentId/pdf`) —
      confirm it actually opens and isn't corrupted
- [ ] `BlueprintsWorkspace.jsx` lists real blueprints (`GET /blueprints`)
- [ ] Open one → `BlueprintDetail.jsx` (`GET /blueprints/:id`) shows correct
      questions/marks

## Reflections & Growth Plans (`GET/POST/PATCH/DELETE`)

- [ ] `ReflectionPanel.jsx` lists real reflections (`GET /reflections`)
- [ ] Create a new reflection from the dashboard (`POST /reflections`) —
      confirm it appears immediately and also shows up if you send
      `REFLECT` on WhatsApp afterward (cross-checks the two entry points
      write to the same data)
- [ ] Edit (`PATCH /reflections/:id`) and delete (`DELETE /reflections/:id`)
      a disposable test reflection
- [ ] `GrowthPlanPanel.jsx` lists real growth plans (`GET /growth-plans`,
      `GET /growth-plans/:id`)
- [ ] Create, edit, delete a disposable test growth plan
      (`POST` / `PATCH /growth-plans/:id` / `DELETE /growth-plans/:id`)

## QMS / Incidents (`GET /qms/topics`, `GET/POST/PATCH/DELETE /incidents`)

- [ ] `QMS.jsx` loads with real category cards
      (`QMSCategoryCard.jsx`, `QMSSummaryBanner.jsx`, `GET /qms/topics`)
- [ ] `QMSCategoryActions.jsx` actions work (whatever the real category
      actions are — confirm they don't error)
- [ ] `IncidentsWorkspace.jsx` lists real incidents (`GET /incidents`)
- [ ] Open one → `IncidentDetail.jsx` (`GET /incidents/:id`)
- [ ] Create, edit, delete a disposable test incident
      (`POST` / `PATCH /incidents/:id` / `DELETE /incidents/:id`)

## TSE

- [ ] TSE status section reflects real data (`GET /tse/status`)

## Cross-check with WhatsApp (the part automated e2e tests can't cover)

- [ ] Generate or save something new via WhatsApp (e.g. a worksheet, a
      REFLECT entry), then confirm it shows up on the dashboard without a
      deploy or manual refresh trick — just a normal page load
- [ ] Make an edit on the dashboard (e.g. edit a reflection), then confirm
      the corresponding WhatsApp view (e.g. a follow-up REFLECT-related
      command, if one surfaces saved reflections) reflects the change

## Verification log

Performed 2026-09-09 against `https://sa-teacher-assistant.onrender.com`
(live production). Everything in this section was actually executed and
observed; nothing here is inferred from source reading alone unless the
item says so explicitly.

### 1. Deployment reachable — and the dashboard is at `/app`, not `/`

- `GET /healthz` → `200`,
  `{"status":"ok","service":"SA Teacher Assistant","version":"2.0.0"}`
- `GET /` → `200`, **1,405,551 bytes — the public marketing landing page**
  (`<title>SA Teacher Assistant — CAPS-Aligned Classroom Materials on
  WhatsApp</title>`, no `<div id="root">`), served from `public/index.html`
- `GET /app` → `200`, 402 bytes — the SPA shell
  (`<title>Teacher Assistant</title>`, `<div id="root">`) from
  `dashboard/dist`

**Correction to an earlier draft of this log,** which claimed `GET /`
serves the SPA shell. It does not, and the distinction is load-bearing for
anyone working through this checklist: `server.js` registers a dedicated
`app.get('/')` landing-page route *before* the dashboard catch-all,
deliberately, because payment-processor domain verification requires a
login-free page at the bare domain root. The teacher app lives at `/app`
(`App.jsx` mounts `Home` at `path="/app"` behind `ProtectedRoute`).

So **do the browser pass against `/app`, not the bare domain.** Opening
the bare domain shows the marketing page and proves nothing about the
dashboard. The original wording of the first Setup box below was misleading
on exactly this point and has been corrected.

### 2. The deployed bundle is current — verification would exercise today's code

Worth establishing before any of the below is trusted: a stale deploy would
make the whole checklist verify old code. The live bundle is
`/assets/index-BuRokdQF.js` (280,104 bytes). It was confirmed to contain
the most recent `dashboard/src` commit, `1c95ea5` ("Home page presented a
failed classes/learners fetch as an honest empty account", 2026-09-08), by
locating that fix's two gating conditions in the minified output:

- stats section — `r?…"Loading your overview…"…:s?null:…"mb-7 grid grid-cols-…"`
  (i.e. `loading ? Spinner : error ? null : <section>`)
- My Classes section —
  `!s&&a.jsxs("section",{className:"mb-7",…{title:"My Classes"`
  (i.e. `{!error && <section>}`)

Note for anyone repeating this: searching the bundle for the copy quoted in
that commit message (`"No classes yet — create one on WhatsApp"`,
`"0 classes, 0 learners"`) returns nothing and does **not** mean the fix is
missing — those strings only ever existed in source comments and are
stripped by minification. Check the gating conditions, not the prose.

Also confirmed `main` is fully pushed (`git rev-list --count origin/main..main`
= 0), so no local work is missing from the deploy. The untracked local
`dashboard/dist/` (built 2026-09-01, hash `index-CiBzBwa8.js`) is a stale
developer artifact and is not what production serves.

### 3. API auth boundary — all 21 GET endpoints reject unauthenticated requests

`server.js:427` mounts the API as
`app.use('/api', apiLimiter, requireTeacherAuth, apiRouter)`, so the gate is
structural — it applies at the mount point to every route in
`routes/api.js` rather than per-handler. Confirmed live: with no
`Authorization` header, all of the following returned `401`:

```
/api/classes                      /api/observations/1
/api/learners                     /api/assessments/1/detail
/api/resources                    /api/assessments/1/pdf
/api/observations                 /api/resources/1
/api/reflections                  /api/growth-plans/1
/api/growth-plans                 /api/blueprints/1
/api/blueprints                   /api/incidents/1
/api/qms/topics                   /api/classes/1/detail
/api/incidents                    /api/classes/1/snapshot
/api/tse/status                   /api/learners/1/detail
                                  /api/learners/1/intervention-plan
```

Token-forgery attempts against `/api/classes`, all `401`:

| Attempt | Result |
|---|---|
| `Bearer not-a-jwt-at-all` | 401 |
| `Basic dXNlcjpwYXNz` (wrong scheme) | 401 |
| `Bearer ` (empty token) | 401 |
| valid-shape JWT signed with a wrong secret | 401 |
| same, already expired | 401 |
| unsigned `alg: none` JWT with `sub: 1` | 401 |

The `alg: none` case is the one worth noting — that is the classic JWT
bypass, and `utils/teacherAuth.js` rejects it.

Deliberately **not** probed: `POST`/`PATCH`/`DELETE` endpoints. An
unauthenticated write probe is only safe if auth works, which is the very
thing under test, so the write verbs were left to the authenticated
browser pass below rather than tested by firing them at production.

### 4. No data leaks to an unauthenticated visitor via SPA routes

`GET` on `/classes`, `/observations`, `/qms`, `/incidents`, `/reflections`
with no session each returned `200` with the identical SPA shell
— `<div id="root"></div>`, no server-rendered content. There is no
server-side rendering path that could emit teacher data before
`ProtectedRoute.jsx` runs, so a direct inner-URL hit cannot show data even
in principle. `ProtectedRoute.jsx` itself was read and does
`isAuthenticated ? children : <Navigate to="/login" replace />`.

Two things noticed while doing this, neither a security issue, both worth
knowing before the browser pass:

- `/reflections` was included in the probe above but is **not** a route in
  `App.jsx`. Reflections and growth plans are panels inside the QMS page
  (`src/components/qms/ReflectionPanel.jsx`, `GrowthPlanPanel.jsx`,
  rendered by `src/pages/QMS.jsx`), so exercise them at `/qms` — there is
  no standalone `/reflections` page to visit.
- `App.jsx` has no catch-all `path="*"` route and no `path="/"` route, while
  `server.js`'s SPA fallback returns `index.html` for any unmatched GET.
  An unknown in-app URL (a typo, a stale bookmark) therefore returns 200
  and renders nothing — a blank page rather than a "not found" screen.
  Recorded as an observation only; not fixed here, and not a P3 blocker.

### What is still outstanding, and why it cannot be closed from here

Every remaining box needs an authenticated teacher session, which requires
a real teacher phone number receiving a real WhatsApp OTP against
production. That is not something this pass can or should manufacture — it
needs the operator's own login. Specifically still open: per-page data
correctness, every `POST`/`PATCH`/`DELETE` round-trip, the assessment PDF
download, and the WhatsApp cross-check section.

The honest summary: the security boundary around the dashboard is now
verified live, and the deploy is confirmed current. Whether each page
renders the right data for a logged-in teacher is untested.

## Sign-off

Once every box above is checked with a genuine result observed (not
assumed), update `docs/releases/RC1-MILESTONE.md`'s dashboard note and
close the RC2 P1 M4 follow-up, citing this checklist and the date
performed.

The 2026-09-09 partial pass above is deliberately **not** a sign-off and
does not close M4. The RC1-MILESTONE.md Accepted Limitations line still
correctly says live end-to-end dashboard verification is an open RC2
follow-up, and that stays true until the authenticated browser boxes are
done.
