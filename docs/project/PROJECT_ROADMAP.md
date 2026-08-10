# Project Roadmap

Only unfinished work belongs here. The moment something is done and
browser-verified, it moves to `PROJECT_INVENTORY.md` / `VERIFIED.md` and gets
deleted from this file — don't let completed items accumulate here.

## Status update (2026-08-10, post-RC1)

RC-1 is complete and approved (`docs/testing/RC1_SIGNOFF.md`, commit
`784d3e8`). Everything under "Immediate (this phase)" and "Active bug
fixes" below is historical — the browser verification pass was completed
as part of RC-1's seven workflows, and both bugs listed were fixed and
verified as W4-F1. Preserved below for record, not as a live task list.

One item under "Next phase" below has been **code-verified complete and
removed**: "Wire up class analytics/intervention UI" — `ClassSnapshotSection.jsx`
(rendered on Class Detail, `/classes/:classId`) already renders both
`AnalyticsSnapshotCard` and `InterventionSnapshotCard` via
`classSnapshotService`, composing `classAnalyticsService` and
`classInterventionService`. This resolves an apparent contradiction with
`docs/PROJECT-STATUS.md`, which had already found this — that document
was correct, this roadmap entry was stale.

**Proposed post-RC1 sequence** (not yet started, pending approval):
1. Frontend verification pass — browser-verify Reflection editing and
   Class Analytics/Intervention (both confirmed implemented in code, not
   yet logged as browser-verified in `VERIFIED.md`).
2. Reporting Centre — design (ADR first: report catalogue, scope,
   authorization, orchestration, error handling, explicit out-of-scope),
   then implementation. Code-verified as the largest genuine remaining
   product gap: report/PDF generation logic exists in `pdfService.js`,
   `interventionReportsService.js`, `diagnosticWorkflowService.js`, and
   `assessmentDetailService.js`, but only one narrow route
   (`GET /assessments/:assessmentId/pdf`) exposes any of it, and there is
   no unified workspace.
3. Production-readiness assessment (see "Production readiness" below —
   still unaudited).

Deferred, not part of the above sequence: standalone Learners list page,
WhatsApp blueprint creation, CAPS Grades R–6 expansion, duplicate ADR-005
numbering — each is a separate backlog/product decision, not blocking the
Reporting Centre work.

---

**Everything below this line is the pre-RC1 (unchanged) roadmap content,
preserved for history.**

## Immediate (this phase)

### Browser verification pass
Highest-value work right now per the audit: backend + tests exist for
almost everything, browser proof exists for almost nothing.

1. Classes list — open, confirm real data renders
2. Class detail — open, confirm detail + snapshot sections both render
3. Learner detail — open, confirm timeline/history renders
4. Observation workspace + detail — re-verify (prior "verified" used seeded
   test data, not a full click-through)
5. Assessment detail (PR28) — finish curl-testing, then browser-check
6. QMS workspace — open, click through sub-components
7. Record every mismatch found in `NEXT_SESSION.md`, fix, re-verify

### Active bug fixes
- Item analysis: `averageFacilityValue`, `averageDiscrimination`, `Target
  group size` all zeroing out. Root cause hypothesis: field-name mismatch in
  `question_data` JSON between `assessmentCaptureService.js` (write) and
  `itemAnalysisService.js` (read). Needs: confirm exact field names on both
  sides, fix mismatch, add a regression test.
- Intervention plan AI: `fullInterventionPlan.js` prompt lets the model
  freely restate group counts, sometimes incorrectly. Needs: constrain the
  prompt to use the actual computed group size rather than letting the model
  restate it, or inject the value directly instead of asking the model to
  state it.

## Next phase

- PR29–PR32: analytics, QMS workspace polish, reporting, home analytics
  (per existing PR sequence — don't start until the verification pass above
  is done, per the "prove before building" principle)
- Frontend test coverage (currently zero files in `dashboard/`)
- Locate/confirm learners list page (backend + tests exist, page not
  located in this audit — may not exist, or may exist under a name not
  yet checked)

## Production readiness (not started, not audited this session)

- Deployment config review (Render/Netlify)
- CI/CD
- Monitoring/logging
- This section needs its own audit pass before estimating scope — don't
  assume it's "the last 20%" without checking what's actually there.
