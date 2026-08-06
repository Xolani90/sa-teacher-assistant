# Workflow 4: Assessments — RC Sign-off Checklist

Severity terms refer to `docs/testing/RC_SEVERITY.md`. Structure frozen
per `docs/testing/RC_TEMPLATE.md`.

## Release Information
| Field | Value |
|---|---|
| Release Candidate | RC-1 |
| Workflow | W4 – Assessments |
| Git Branch | |
| Git Commit | |
| Dashboard Version | |
| API Commit (if different) | |
| Environment | ☐ Local Dev ☐ Staging ☐ Production |
| Executed By | |
| Date | |

## Implementation Coverage
- `GET /api/assessments/:assessmentId/detail` — aggregated Assessment Detail via `assessmentDetailService.getAssessmentDetail`, the evidence view behind a class/learner's overall percentage.
- `GET /api/assessments/:assessmentId/pdf` — on-demand Blueprint Assessment PDF generation (`pdfService.generateBlueprintAssessmentPdf`), returns a signed download URL via `core/generationPipeline.buildPdfUrl`, not raw file bytes. Ownership is re-checked here (via `getAssessmentDetail`) before generation, independent of any check inside the PDF generator itself.
- Active bug context: intervention report values (`averageFacilityValue`, `averageDiscrimination`, `Target group size`) have shown up zeroed in some cases, traced to a suspected field-name mismatch between the write path (`assessmentCaptureService.js`) and read path (`itemAnalysisService.js`) in `question_data` JSON. Verify these fields explicitly in this workflow rather than assuming they're correct because the endpoint returns 200.

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

## Stop Conditions
**Critical:**
- `.../detail` or `.../pdf` returns another teacher's assessment data
  for an ID it does not own (must be 404, not 403 — ADR-008 §8)
- `averageFacilityValue`, `averageDiscrimination`, or `Target group
  size` render as zero/null for an assessment with real captured data
  (known active bug area — do not pass this silently; log even if it
  looks like "existing known issue")
- Server 500 on `.../detail` or `.../pdf` for a valid, owned assessmentId
- Uncaught console exception while browsing Assessment Detail or
  triggering PDF generation

**Non-blocking:** cosmetic UI, spinner/timing, copy, minor layout.

## Functional Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W4-01 | 4.1 | Click into an assessment → GET /api/assessments/:assessmentId/detail | 200, full aggregated payload | status: ___ | ☐ |
| W4-02 | 4.2 | Invalid assessmentId (0, -1, "abc") → GET .../detail | 400, `assessmentId must be a positive integer.` | status: ___ | ☐ |
| W4-03 | 4.3 | Nonexistent assessmentId → GET .../detail | 404, `Assessment not found.` | status: ___ | ☐ |
| W4-04 | 4.4 | Inspect `averageFacilityValue` on detail payload against known captured data | Matches expected non-zero value | expected: ___ · actual: ___ | ☐ |
| W4-05 | 4.5 | Inspect `averageDiscrimination` on detail payload | Matches expected non-zero value | expected: ___ · actual: ___ | ☐ |
| W4-06 | 4.6 | Inspect `Target group size` on detail payload | Matches actual learner count, not zero | expected: ___ · actual: ___ | ☐ |
| W4-07 | 4.7 | Trigger PDF for a blueprint-backed assessment → GET .../pdf | 200, `{ url, filename }` | status: ___ · url present: Y/N | ☐ |
| W4-08 | 4.8 | Open the returned `url` | PDF downloads/opens, content matches assessment | Behavior: ___ | ☐ |
| W4-09 | 4.9 | Trigger PDF for a non-blueprint-backed assessment | 422, "not created from a Blueprint" error | status: ___ | ☐ |
| W4-10 | 4.10 | Invalid assessmentId → GET .../pdf | 400 | status: ___ | ☐ |
| W4-11 | 4.11 | Nonexistent assessmentId → GET .../pdf | 404, `Assessment not found.` | status: ___ | ☐ |

## Security Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W4-S1 | S1 | Teacher A requests Teacher B's assessmentId on .../detail | 404 identical to "not found" (not 403, no data leak) | status: ___ | ☐ |
| W4-S2 | S2 | Teacher A requests Teacher B's assessmentId on .../pdf | 404 identical to "not found" — PDF must not generate | status: ___ | ☐ |
| W4-S3 | S3 | Request /api/assessments/:id/detail without Authorization header | 401 | status: ___ | ☐ |

## Console Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W4-12 | 4.12 | Browse Assessment Detail → trigger PDF → open PDF, full sequence | Clean — no uncaught exceptions, no failed loads, no React errors | Clean: Y/N | ☐ |

## Optional — Timing/UX
| Evidence ID | Step | Action | Expected | Status |
|---|---|---|---|---|
| W4-T1 | T1 | Observe latency for on-demand PDF generation | Reasonable latency, correct loading/spinner state during generation | Optional |

## Findings Register
| ID | Severity | Step | Description | Evidence | Disposition |
|---|---|---|---|---|---|
| | | | | | |

## Workflow Result
- Functional: ☐ Pass ☐ Fail
- Security: ☐ Pass ☐ Fail
- Console: ☐ Clean ☐ Issues found
- Critical findings: ___
- Major findings: ___
- Minor findings: ___
- Retests required: ___
- Execution time: ___ minutes
- Overall: ☐ PASS ☐ FAIL
- Reason (if FAIL): ___

## Carry Forward
WF5 (Reports & PDF) prerequisites: ___ (or "None") — note whether the
known intervention-value bug (W4-04/05/06) is still open, since it may
also affect Workflow 5's report content.

## Sign-off
- Workflow Executed By: __________
- Date: __________
- Git Commit / Branch: __________
- Environment: ☐ Local Dev ☐ Staging ☐ Production
