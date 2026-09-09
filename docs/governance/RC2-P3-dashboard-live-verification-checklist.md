# RC2 P3 — Dashboard Live End-to-End Verification Checklist

**STATUS: NOT YET PERFORMED — this is a manual checklist, not a completed
verification.** Automated coverage for these same code paths already
passes (111/111 across `blueprints-dashboard-e2e.test.js`,
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

- [ ] Confirm the dashboard loads at `https://sa-teacher-assistant.onrender.com`
- [ ] Log in via `Login.jsx` with a real teacher account
- [ ] Confirm `ProtectedRoute.jsx` actually blocks dashboard pages when logged
      out (open an inner page URL directly in a private/incognito window
      with no session — should redirect to Login, not show data)

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

## Sign-off

Once every box above is checked with a genuine result observed (not
assumed), update `docs/releases/RC1-MILESTONE.md`'s dashboard note and
close the RC2 P1 M4 follow-up, citing this checklist and the date
performed.
