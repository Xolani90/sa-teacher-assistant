# Project Roadmap

Only unfinished work belongs here. The moment something is done and
browser-verified, it moves to `PROJECT_INVENTORY.md` / `VERIFIED.md` and gets
deleted from this file — don't let completed items accumulate here.

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
- Wire up class analytics UI (service exists, no confirmed frontend consumer)
- Wire up class intervention UI (service exists, no confirmed frontend consumer)
- Locate/confirm learners list page (backend + tests exist, page not
  located in this audit — may not exist, or may exist under a name not
  yet checked)

## Production readiness (not started, not audited this session)

- Deployment config review (Render/Netlify)
- CI/CD
- Monitoring/logging
- This section needs its own audit pass before estimating scope — don't
  assume it's "the last 20%" without checking what's actually there.
