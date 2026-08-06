# Active Work

The one question this file answers: **what should I work on right now?**
Nothing else. For why, see `PROJECT_DECISIONS.md`. For full evidence, see
`PROJECT_INVENTORY.md`. This file just points at the next action.

Update this file whenever the active task changes — not just at session end.

---

## Current Priority

**Phase B — Browser Verification**

Status: Not yet started (Phase A evidence audit is complete as of commit
`1ef2a1a`)

## Remaining — Phase B checklist

Mirrors `RELEASE_CHECKLIST.md`; this is just the execution-order view of it.

```
[ ] Classes page
[ ] Class Detail (+ resolve ADR-014 vs VERIFIED.md discrepancy first)
[ ] Learner Detail
[ ] Observation Workspace
[ ] Observation Detail (prior "verified" used seeded data, not a real click-through — redo properly)
[ ] Assessment Detail (PR28 — confirm curl-testing is done first)
[ ] QMS Workspace
```

For each: open the page, exercise the main flow, check Network tab, compare
JSON to what the UI expects, log the result in `VERIFIED.md`, tick the
matching row in `RELEASE_CHECKLIST.md`.

## Blocked

Nothing currently blocked.

## Known defects (don't re-diagnose, resume from here)

**Item Analysis** — `averageFacilityValue`, `averageDiscrimination`,
`Target group size` all zero out. Hypothesis: field-name mismatch in
`question_data` JSON between `assessmentCaptureService.js` (write) and
`itemAnalysisService.js` (read). Not yet confirmed which fields actually
differ — that's the concrete next step if this gets picked up before Phase B
finishes. Not a blocker on Phase B; can run in parallel since it's a
confirmed existing defect, not new work.

**Intervention Plan (AI)** — `fullInterventionPlan.js` prompt lets the model
restate group counts, sometimes incorrectly. Fix direction: inject the
computed value directly rather than asking the model to restate it.

## Future (after Phase B, not before)

- Connect Class Analytics to a frontend consumer (service + tests exist,
  nothing calls it yet — confirmed via `App.jsx` route table)
- Connect Class Intervention to a frontend consumer (same situation)
- Decide whether a standalone Learners list page is actually wanted
  (confirmed absent from `App.jsx` — this is an open product question, not
  an oversight to silently fix)
- Frontend test coverage (currently 0 files in `dashboard/`)
- PR29–PR32 (analytics, QMS polish, reporting, home analytics) — hold until
  Phase B and the two known defects are done
- Release checklist completion
- Production deployment validation
- Final QA pass
- v1.0

## The four-part done rule

Nothing moves out of Active Work and into "finished" without all four:

- ✅ code
- ✅ tests
- ✅ documentation (`PROJECT_INVENTORY.md` evidence block)
- ✅ browser verification, where the feature has a UI (logged in
  `VERIFIED.md`, ticked in `RELEASE_CHECKLIST.md`)

Once all four exist for a feature, it's done — don't revisit it unless a
regression is actually observed.
