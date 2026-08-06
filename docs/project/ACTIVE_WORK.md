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
commits `2fc2c97`, `9a5b4cf`, `9993811`). See "1. Confirmed defects" below.

The AI intervention-plan group-count claim was checked for evidence
2026-08-06 and found to have none (see "2. Unconfirmed hypotheses" below).
It is not the active priority — pick the next item from "3. Engineering
work" below instead.

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

## 1. Confirmed defects

Each entry here has: reproduction, evidence, fix, regression test, commit.

### "Target group size" / problemArea contract mismatch — resolved 2026-08-06

Investigation history: the original combined "Item Analysis" hypothesis
("field-name mismatch between `assessmentCaptureService.js` write and
`itemAnalysisService.js` read") was disproven by evidence via
`scripts/debugItemAnalysis.js` against assessment id 1 — item analysis
itself was confirmed working correctly (`averageFacilityValue: 0.7`
independently recomputed by hand; `averageDiscrimination: 0` and
`itemQuality: "insufficient_data"` are correct by-design output for a
class under 10 learners). That hypothesis was retired (see "2. Unconfirmed
hypotheses" history below).

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

### Duplicate `intervention_plans` writes on report generation — resolved 2026-08-06

While investigating the above, a second, architectural defect was found:
the debug script revealed `generateInterventionReport()` inserted a new
row into `intervention_plans` on every call (its rules-based fallback
called `generateInterventionPlan()`, which persists). Since
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

## 2. Unconfirmed hypotheses

Observations that have NOT been reproduced. Nothing here gets fixed until
it clears "1. Confirmed defects" via real evidence — see "Hypothesis
discipline" below.

### Item Analysis field-name mismatch — DISPROVEN, closed 2026-08-06

Original claim: `question_data` field-name mismatch between
`assessmentCaptureService.js` (write) and `itemAnalysisService.js` (read)
causes `averageFacilityValue`, `averageDiscrimination`, and target group
size to zero out.

Evidence gathered (via `scripts/debugItemAnalysis.js` against assessment
id 1, a real 5-learner blueprint-backed assessment):
- Blueprint-backed analysis path confirmed working — `question_data`
  reads correctly, `blueprint_questions` join resolves correctly
- `averageFacilityValue: 0.7` — independently recomputed by hand from raw
  learner marks and confirmed correct for all 4 questions
- `averageDiscrimination: 0` and `itemQuality: "insufficient_data"` are
  correct, by-design output for a class under 10 learners — not a bug;
  the tool's own summary text states this explicitly

Result: disproven, not supported by evidence. Closed — no fix needed.
(The adjacent "Target group size" symptom turned out to be a real, but
unrelated, defect — see "1. Confirmed defects" above.)

### AI intervention plan may restate group counts incorrectly — NOT REPRODUCED

Original claim (`fullInterventionPlan.js` prompt lets the model restate
group counts, sometimes incorrectly) appeared identically worded across
six docs (`ACTIVE_WORK.md`, `NEXT_SESSION.md`, `PROJECT_INVENTORY.md`,
`PROJECT_ROADMAP.md`, `VERIFIED.md`, `PROJECT_STATUS.md`) without any of
them citing a captured example of actual bad output.

Status: not reproduced.

Evidence checked, 2026-08-06:
- `scripts/debugAiInterventionPlan.js` — queried the `reports` table for
  any row with `report_type = 'ai_intervention_plan'`, across ALL
  assessments: **0 rows found**. No AI-generated plan has ever been saved
  in the local dev database.
- Searched `tests/` for any test exercising `buildFullInterventionPlanPrompt`
  output: only `tests/assessmentFlow-deps-contract.test.js`, which checks
  the function is present in a dependency-injection contract list — it
  never calls it or asserts anything about output content.
- No evidence of any kind (saved output, test, log) that this has ever
  actually happened.

Next evidence required: a live generation run through the real
data-driven assessment flow with `ANTHROPIC_API_KEY` (or
`OPENAI_API_KEY`) configured, then a hand comparison of the "Target
Learners" / "groups identified" text in the model's response against the
real `groupLearners()` counts for that same assessment. Requires a real
API call (small cost) — hold until deliberately picked up for that
purpose.

The fix direction already noted (inject the computed value directly
rather than asking the model to restate it) remains a reasonable approach
*if and when this is confirmed* — it is not implemented speculatively.

## 3. Engineering work

Enhancements, not bugs — no defect claim attached to any of these.

- Connect Class Analytics to a frontend consumer (service + tests exist,
  nothing calls it yet — confirmed via `App.jsx` route table)
- Connect Class Intervention to a frontend consumer (same situation)
- Decide whether a standalone Learners list page is actually wanted
  (confirmed absent from `App.jsx` — this is an open product question, not
  an oversight to silently fix)
- Frontend test coverage (currently 0 files in `dashboard/`)
- PR29–PR32 (analytics, QMS polish, reporting, home analytics)
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
