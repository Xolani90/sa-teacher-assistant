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

**"Target group size" / problemArea investigation: resolved** (2026-08-06,
commits `2fc2c97`, `9a5b4cf`, `9993811`). See "Known defects — resolved"
below for evidence.

Next priority: **Intervention Plan (AI)** — see "Known defects" below.

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

## Known defects — resolved

**"Target group size" / problemArea contract mismatch** — resolved 2026-08-06.

Investigation history: the original combined "Item Analysis" hypothesis
("field-name mismatch between `assessmentCaptureService.js` write and
`itemAnalysisService.js` read") was disproven by evidence via
`scripts/debugItemAnalysis.js` against assessment id 1 — item analysis
itself was confirmed working correctly (`averageFacilityValue: 0.7`
independently recomputed by hand; `averageDiscrimination: 0` and
`itemQuality: "insufficient_data"` are correct by-design output for a
class under 10 learners). That hypothesis was retired.

The "Target group size" symptom was then investigated as a separate
thread, via `scripts/debugInterventionReport.js` against assessment id 1.
Live evidence showed target group size was actually correct
(`targetGroups: [{ group: "D", learners: ["Naledi Khumalo"], count: 1 }]`)
but the adjacent "Problem areas: none identified" line was wrong — a real,
reproduced defect:

- `interventionPlanService.js` computed `problemAreas` (plural array)
  internally but only ever attached `problemArea` (singular, comma-joined
  string) to the returned plan object
- `interventionReportsService.js` read `report.interventionPlan.problemAreas`
  (plural) in both `generateTeacherSummary` and `generateHodSummary`, which
  never existed, so it silently fell back to `[]`

Fix (commit `2fc2c97`): `interventionPlanService.js` now exposes both
`problemArea` and `problemAreas`, mirroring the existing
`targetGroup`/`targetGroups` precedent.

Regression test (commit `9a5b4cf`): `tests/intervention-reports.test.js`
Test 12 — seeds a dedicated weak-performing assessment (success_rate < 0.5
on real question data) and asserts `problemAreas` is a non-empty array,
and that both teacher and HOD summaries mention the identified problem
area instead of falling back to "none identified" / "general revision".

While investigating, a second, architectural defect was found: the debug
script revealed `generateInterventionReport()` inserted a new row into
`intervention_plans` on every call (its rules-based fallback called
`generateInterventionPlan()`, which persists). Since
`diagnosticWorkflowService.js` already calls `generateInterventionPlan()`
explicitly, and `generateInterventionReport()` runs right after (plus
again on every uncached diagnostic/HOD/parent report view, once per named
learner for parent reports), this created multiple duplicate active rows
per assessment in normal use — contradicting the service's own module
docstring ("This service does NOT re-derive an intervention plan from
scratch").

Fix (commit `9993811`): split into `computeInterventionPlan()` (derives
the plan, no persistence) and `generateInterventionPlan()` (computes +
saves, unchanged public behavior). `interventionReportsService.js`'s
fallback now calls `computeInterventionPlan()`, making report generation
read-only. Verified via `scripts/debugInterventionReport.js` — repeat runs
against assessment id 1 no longer add new `intervention_plans` rows.

## Known defects (pick up now)

**Intervention Plan (AI)** — `fullInterventionPlan.js` prompt lets the model
restate group counts, sometimes incorrectly. Fix direction: inject the
computed value directly rather than asking the model to restate it. Not
yet investigated with live evidence.

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

## Hypothesis discipline

A hypothesis is not promoted to a bug until it has been reproduced with
evidence (logs, database state, browser output, or a failing test). A
hypothesis disproved by evidence is closed, documented (with what was
checked and what the evidence showed), and removed from the active queue
— it is not quietly abandoned or left ambiguous for a future session to
re-litigate. See the "Target group size" investigation above for the
pattern: the original combined hypothesis was disproven and retired,
which narrowed the search and led to the real, separate defect.
