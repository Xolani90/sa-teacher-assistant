# Investigation Log

Records investigations into suspected defects that were chased down but
did not conclude in a simple "found and fixed" outcome. Purpose: prevent
re-investigating the same hypothesis from scratch months later. An entry
here is not a substitute for a Findings Register row in a workflow
checklist — this log is for the investigation itself (what was checked,
what wasn't, and why), not for pass/fail evidence.

## Status Definitions
| Status | Meaning |
|---|---|
| Active | Reproducible today |
| Fixed | Root cause identified and corrected |
| Not Reproducible (NR) | Investigated on current build, unable to reproduce |
| Deferred | Known issue but intentionally postponed |

---

## Investigation: Intervention Metrics Showing Zero

**Status:** Not Reproducible (NR) on RC-1 baseline

**Date:** 2026-08-06

**Build:** `670c37b`

**Investigated by:** X.O (with Claude)

**Original report:** `averageFacilityValue`, `averageDiscrimination`,
and `Target group size` observed showing as zero in intervention
reports, suspected to be caused by a field-name mismatch in
`question_data` JSON between the write path
(`assessmentCaptureService.js`) and read path
(`itemAnalysisService.js`).

### Hypotheses Tested
1. **Field-name mismatch** — traced `question_number`/`questionNumber`
   naming across `assessmentCaptureService.js` → `blueprintRepository.js`
   (`mapBlueprint`) → `diagnosticWorkflowService.js`
   (`storeLearnerResults`) → `itemAnalysisService.js` /
   `errorAnalysisService.js` / `blueprintAnalytics.js`. All consistent —
   no mismatch found (static trace).
2. **`question_data` JSON serialization/deserialization** — traced
   `JSON.stringify(result.questionData)` on write through
   `JSON.parse(row.question_data)` on every read site. Consistent.
3. **`performItemAnalysis()`** — ran directly against real seeded data
   via `scripts/diagnoseInterventionReport.js`. Produced correct
   non-zero output.
4. **`generateInterventionReport()`** — same script, same runs. Correct.
5. **`generateTeacherSummary()`** — same script, same runs. Correct.
6. **Legacy/free-form (non-blueprint) assessment path** — could not be
   tested; zero legacy assessments exist in the local seeded database
   (`SELECT id FROM assessments WHERE blueprint_id IS NULL` → `[]`).
7. **PDF service as a possible independent consumer of these fields** —
   `services/pdfService.js` does not reference `averageFacilityValue`,
   `averageDiscrimination`, or "Target group" at all. Ruled out as a
   site of this specific bug.

### Result
Ran `scripts/diagnoseInterventionReport.js` against two real,
blueprint-backed seeded assessments:

- **Assessment 11** (1 learner): `averageFacilityValue = 0.5`,
  `averageDiscrimination = 0` (correctly `insufficient_data` — below
  the 10-learner threshold for discrimination, not a bug),
  `Target group size = 1` (matches the one learner in Group C).
- **Assessment 1** (5 learners): `averageFacilityValue = 0.7`,
  `averageDiscrimination = 0` (same insufficient-data reason, correct
  for <10 learners), `Target group size = 1` (matches the one learner
  in Group D — Naledi Khumalo).

Both runs produced correct, non-zero, data-consistent output at every
checkpoint (`question_data` → `performItemAnalysis` →
`generateInterventionReport` → `generateTeacherSummary`). The bug did
not reproduce.

### Remaining Possibilities (Not Ruled Out)
- Production-only dataset (a real teacher's captured data, not present
  in local seeds)
- A malformed/partially-captured historical assessment (e.g. an
  abandoned capture session, a row inserted before a schema/convention
  change)
- A blueprint edited/versioned after the assessment captured against it
- A dashboard/UI formatting bug — note the dashboard (`GET
  /assessments/:assessmentId/detail` → `blueprintAnalytics.js`) does
  not currently expose `averageFacilityValue`/`averageDiscrimination`
  by these names at all; if the original report was from the
  dashboard rather than the WhatsApp text report, this may have been
  the wrong service entirely
- Already fixed by unrelated work since the bug was first reported

### Trigger for Reopening
Only reopen this investigation if a **real, current assessmentId**
reproduces zeroed values. Do not re-run the same static hypotheses
(field-name mismatch, serialization) without new evidence — they were
thoroughly checked here. When Workflow 4 (Assessments) is executed for
real against a live build (see W4-04/05/06 in
`WORKFLOW_04_ASSESSMENTS.md`), if it reproduces there, run
`scripts/diagnoseInterventionReport.js <assessmentId>` against that
specific id and update this entry with the new evidence rather than
opening a fresh investigation.
