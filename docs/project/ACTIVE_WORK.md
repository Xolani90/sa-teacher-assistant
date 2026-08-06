# Active Work

The one question this file answers: **what should I work on right now?**
Nothing else. For why, see `PROJECT_DECISIONS.md`. For full evidence, see
`PROJECT_INVENTORY.md`. This file just points at the next action.

Update this file whenever the active task changes — not just at session end.

---

## Current Priority

**Phase B — Browser Verification: complete** (2026-08-06)

All items below were personally verified via live browser + Network tab
review (or curl, for Assessment Detail's backend). See `VERIFIED.md` for
full evidence and `RELEASE_CHECKLIST.md` for the release-gate view.

Next priority: the two known defects below (Item Analysis, Intervention
Plan AI), which can now be picked up — Phase B was the only thing blocking
them.

## Phase B checklist — complete

```
[x] Classes page — verified 2026-08-06, clean
[x] Class Detail — verified 2026-08-06; ADR-014 vs VERIFIED.md discrepancy resolved
[x] Learner Detail — verified 2026-08-06, clean
[x] Observation Workspace — verified 2026-08-06, clean
[x] Observation Detail (prior "verified" used seeded data, not a real click-through — redo properly) — redone 2026-08-06, clean
[x] Assessment Detail (PR28 — confirm curl-testing is done first) — curl-tested and browser-verified 2026-08-06
[x] QMS Workspace — verified 2026-08-06, clean
```

## Blocked

Nothing currently blocked.

## Known defects (pick up now — Phase B is done)

**Item Analysis** — `averageFacilityValue`, `averageDiscrimination`,
`Target group size` all zero out. Hypothesis: field-name mismatch in
`question_data` JSON between `assessmentCaptureService.js` (write) and
`itemAnalysisService.js` (read). Not yet confirmed which fields actually
differ — that's the concrete next step.

**Intervention Plan (AI)** — `fullInterventionPlan.js` prompt lets the model
restate group counts, sometimes incorrectly. Fix direction: inject the
computed value directly rather than asking the model to restate it.

## Future (now unblocked — Phase B is done)

- Connect Class Analytics to a frontend consumer (service + tests exist,
  nothing calls it yet — confirmed via `App.jsx` route table)
- Connect Class Intervention to a frontend consumer (same situation)
- Decide whether a standalone Learners list page is actually wanted
  (confirmed absent from `App.jsx` — this is an open product question, not
  an oversight to silently fix)
- Frontend test coverage (currently 0 files in `dashboard/`)
- PR29–PR32 (analytics, QMS polish, reporting, home analytics) — hold until
  the two known defects above are fixed
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
