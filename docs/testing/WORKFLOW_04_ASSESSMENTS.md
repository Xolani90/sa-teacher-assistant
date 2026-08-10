# Workflow 4: Assessments — RC Sign-off Checklist

Severity terms refer to `docs/testing/RC_SEVERITY.md`. Structure frozen
per `docs/testing/RC_TEMPLATE.md`.

## Release Information
| Field | Value |
|---|---|
| Release Candidate | RC-1 |
| Workflow | W4 – Assessments |
| Git Branch | main |
| Git Commit | fb010d2 |
| Dashboard Version | |
| API Commit (if different) | |
| Environment | ☒ Local Dev ☐ Staging ☐ Production |
| Executed By | Xolani |
| Date | 2026-08-07 |

## Implementation Coverage
- `GET /api/assessments/:assessmentId/detail` — aggregated Assessment Detail via `assessmentDetailService.getAssessmentDetail`, the evidence view behind a class/learner's overall percentage.
- `GET /api/assessments/:assessmentId/pdf` — on-demand Blueprint Assessment PDF generation (`pdfService.generateBlueprintAssessmentPdf`), returns a signed download URL via `core/generationPipeline.buildPdfUrl`, not raw file bytes. Ownership is re-checked here (via `getAssessmentDetail`) before generation, independent of any check inside the PDF generator itself.
- Active bug context: intervention report values (`averageFacilityValue`, `averageDiscrimination`, `Target group size`) were previously suspected zeroed due to a `question_data` field-name mismatch. **Investigated and marked Not Reproducible on build `670c37b`** — see `docs/testing/INVESTIGATION_LOG.md`. During W4 execution, a **distinct** defect was confirmed: these fields are computed in `itemAnalysisService.js`/`interventionPlanService.js` but never wired into `assessmentDetailService.js`. **Remediated** — `assessmentDetailService.js` now composes both fields into `/detail` as `itemAnalysis{...}` and `interventionSummary{targetGroupSize}`; see W4-F1 disposition below.

## Preconditions
- Logged-in teacher session (Workflow 1 passed).
- Test teacher has ≥1 blueprint-backed assessment with learner results
  captured (for the 200 detail + successful PDF path).
- Test teacher has ≥1 assessment that is NOT blueprint-backed (for the
  422 PDF path).
- A second teacher's assessmentId is known, to test ownership scoping.

## Environment Notes
- The PDF route returns `{ url, filename }`, not the file bytes —
  confirm the URL is actually fetchable/downloadable, not just present
  in the JSON.
- `isBlueprintBacked` on the detail payload is what gates the PDF route's
  422 — confirm this flag is accurate for both blueprint and
  non-blueprint assessments before treating the PDF result as correct.
- **New note added during W4 execution:** the generated PDF `url` is a
  signed, on-demand link with a 2-hour TTL (`cleanupOldPdfs()`,
  `TWO_HOURS` in `core/generationPipeline.js`). W4-07 (trigger) and
  W4-08 (open) are written as if one continuous action; if a tester
  steps away between the two steps, a stale-URL 404 with body
  `"PDF not found or expired."` is expected behavior, not a defect.
  Regenerate the URL if more than ~2 hours have passed since W4-07.

## Stop Conditions
**Critical:**
- `.../detail` or `.../pdf` returns another teacher's assessment data
  for an ID it does not own (must be 404, not 403 — ADR-008 §8)
- `averageFacilityValue`, `averageDiscrimination`, or `Target group
  size` render as zero/null for an assessment with real captured data
  where zero is not the correct value (e.g. not explained by the <10-
  learner insufficient-data threshold — see
  `docs/testing/INVESTIGATION_LOG.md`). If this reproduces, it's a new
  confirmed defect, not a re-flag of the NR investigation — log full
  evidence (assessmentId, `question_data`, diagnostic script output)
- Server 500 on `.../detail` or `.../pdf` for a valid, owned assessmentId
- Uncaught console exception while browsing Assessment Detail or
  triggering PDF generation

**Non-blocking:** cosmetic UI, spinner/timing, copy, minor layout.

## Functional Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W4-01 | 4.1 | Click into an assessment → GET /api/assessments/:assessmentId/detail | 200, full aggregated payload | status: 200, full payload returned for assessmentId=6 | ☒ |
| W4-02 | 4.2 | Invalid assessmentId (0, -1, "abc") → GET .../detail | 400, `assessmentId must be a positive integer.` | status: 400, message matched exactly | ☒ |
| W4-03 | 4.3 | Nonexistent assessmentId → GET .../detail | 404, `Assessment not found.` | status: 404, message matched exactly | ☒ |
| W4-04 | 4.4 | Inspect `averageFacilityValue` on detail payload against known captured data | Matches expected non-zero value | status: present at `itemAnalysis.averageFacilityValue`, verified via `tests/w4-f1-assessment-detail-integration.test.js` Scenario A against an independently-recomputed `performItemAnalysis()` call | ☒ |
| W4-05 | 4.5 | Inspect `averageDiscrimination` on detail payload | Matches expected non-zero value | status: present at `itemAnalysis.averageDiscrimination`, verified via Scenario A (≥10 learners, real discrimination) and Scenario B (<10 learners, correctly 0 by design, distinguished via `insufficientDataQuestionCount`) | ☒ |
| W4-06 | 4.6 | Inspect `Target group size` on detail payload | Matches actual learner count, not zero | status: present at `interventionSummary.targetGroupSize`, verified via Scenario A (non-zero, real spread), Scenario D (legitimate `0`, typeof number), and Scenario E (zero-learner case now `null`, distinguishable from D's `0`) | ☒ |
| W4-07 | 4.7 | Trigger PDF for a blueprint-backed assessment → GET .../pdf | 200, `{ url, filename }` | status: 200 · url present: Y | ☒ |
| W4-08 | 4.8 | Open the returned `url` | PDF downloads/opens, content matches assessment | Behavior: confirmed — PDF opened with correct topic breakdown, learner summary, and per-topic detail appendix matching assessmentId=6 | ☒ |
| W4-09 | 4.9 | Trigger PDF for a non-blueprint-backed assessment | 422, "not created from a Blueprint" error | status: Blocked/Not Executable — no non-blueprint assessment present in current seed data (confirmed via query: `SELECT ... WHERE blueprint_id IS NULL` returned empty). Test-data gap, not a defect. Not preemptively seeded per plan — revisit if W5+ surfaces a real need. | N/A |
| W4-10 | 4.10 | Invalid assessmentId → GET .../pdf | 400 | status: 400, message matched | ☒ |
| W4-11 | 4.11 | Nonexistent assessmentId → GET .../pdf | 404, `Assessment not found.` | status: 404, message matched | ☒ |

## Security Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W4-S1 | S1 | Teacher A requests Teacher B's assessmentId on .../detail | 404 identical to "not found" (not 403, no data leak) | status: 404, `"Assessment not found."` — Teacher A (sub:1) against Teacher B's assessmentId=12 | ☒ |
| W4-S2 | S2 | Teacher A requests Teacher B's assessmentId on .../pdf | 404 identical to "not found" — PDF must not generate | status: 404, `"Assessment not found."`, no PDF generated | ☒ |
| W4-S3 | S3 | Request /api/assessments/:id/detail without Authorization header | 401 | status: 401, `{"error":"Unauthorized"}` | ☒ |

## Console Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W4-12 | 4.12 | Browse Assessment Detail → trigger PDF → open PDF, full sequence | Clean — no uncaught exceptions, no failed loads, no React errors | Clean: Y | ☒ |

## Optional — Timing/UX
| Evidence ID | Step | Action | Expected | Status |
|---|---|---|---|---|
| W4-T1 | T1 | Observe latency for on-demand PDF generation | Reasonable latency, correct loading/spinner state during generation | Not executed — optional |

## Findings Register
| ID | Severity | Step | Description | Evidence | Disposition |
|---|---|---|---|---|---|
| W4-F1 | Major | 4.4/4.5/4.6 | `averageFacilityValue`, `averageDiscrimination`, and target-group size are computed in `itemAnalysisService.js`/`interventionPlanService.js` but never wired into `assessmentDetailService.js` — the fields are simply absent from `/detail`, not zeroed. Distinct from the closed NR investigation (that was about value correctness once present; this is endpoint exposure). | assessmentId=6 `/detail` response inspected, fields confirmed absent | **Resolved** — see Resolved Findings below |
| W4-F2 | Minor | 4.9 | No non-blueprint assessment exists in current seed data, so the 422 path cannot be executed. Confirms known limitation RC1-H-001 (no production path for teachers to create blueprints in WhatsApp; dev seed script is the only entry point) — this is a consequence of that gap, not a new defect. | `SELECT id, title, phone_hash, blueprint_id FROM assessments WHERE blueprint_id IS NULL` → `[]` | Not seeded preemptively; revisit if W5+ needs it |
| W4-F3 | Minor | 4.7/4.8 | Checklist doesn't document the PDF signed-URL's 2-hour TTL as expected behavior. A tester who steps away between W4-07 and W4-08 could misread a legitimate expiry (`"PDF not found or expired."`, 404) as a defect. | Confirmed by design: `cleanupOldPdfs()` / `TWO_HOURS` in `core/generationPipeline.js`; reproduced once during this session before being correctly diagnosed as non-defect | One-line addition to checklist's Environment Notes (done above); doesn't block sign-off |

### Resolved Findings
| ID | Status | Description | Resolution Evidence |
|---|---|---|---|
| W4-F1 | Resolved | `averageFacilityValue`, `averageDiscrimination`, and target-group size never wired into `assessmentDetailService.js`. | `assessmentDetailService.js` now composes `performItemAnalysis()`/`computeInterventionPlan()` (both pre-existing, unchanged services — no new computation logic) into `/detail` as `itemAnalysis{available,reason,averageFacilityValue,averageDiscrimination,insufficientDataQuestionCount}` and `interventionSummary{targetGroupSize}`. Fixed alongside it: `computeInterventionPlan()` previously masked the zero-learner-results case as a legitimate empty plan (`targetGroupSize: 0`), indistinguishable from a real class with no Group C/D learners; it now propagates `groupLearners()`'s error, surfacing as `targetGroupSize: null`. Verified via real HTTP/DB integration (`tests/w4-f1-assessment-detail-integration.test.js`, 36/36 passing): Scenario A (12 real learners, non-zero discrimination + target group, cross-checked against independently-invoked `performItemAnalysis()`/`computeInterventionPlan()`), Scenario B (4 learners, `insufficientDataQuestionCount` correctly explains the by-design 0), Scenario C (free-form/no per-question data → `available:false` with a reason, not a misleading 0), Scenario D (real learners, legitimate `targetGroupSize:0`, typeof number), Scenario E (zero learner_results → `targetGroupSize:null`, asserted `!==` Scenario D's `0`). Full existing suite (blueprint-analytics, intervention-reports incl. the zero-learner `generateParentSummary` case, migration-030, phase-c2-diagnostic-atomicity, tseEvidenceHooks, blueprint-pdf-report) confirmed unaffected — 0 regressions. |

## Workflow Result
- Functional: ☒ Pass ☐ Fail
- Security: ☒ Pass ☐ Fail
- Console: ☒ Clean ☐ Issues found
- Critical findings: 0
- Major findings: 1 (W4-F1) — Resolved
- Minor findings: 2 (W4-F2, W4-F3)
- Retests required: 0
- Execution time: ___ minutes
- Overall: ☒ PASS ☐ FAIL
- Reason (if FAIL): N/A

## Carry Forward
W4-F1 is resolved as of this update (see Resolved Findings above). No
further carry-forward action required; W5's earlier confirmation that
its PDF output was consistent with the pre-fix `/detail` gap (not a
separate defect) stands as historical context only.

## Sign-off
- Workflow Executed By: Xolani
- Date: 2026-08-07
- Git Commit / Branch: main / fb010d2
- Environment: ☒ Local Dev ☐ Staging ☐ Production
