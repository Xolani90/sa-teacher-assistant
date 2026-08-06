# Workflow 5: Reports & PDF — RC Sign-off Checklist

Severity terms refer to `docs/testing/RC_SEVERITY.md`. Structure frozen
per `docs/testing/RC_TEMPLATE.md`.

## Release Information
| Field | Value |
|---|---|
| Release Candidate | RC-1 |
| Workflow | W5 – Reports & PDF |
| Git Branch | |
| Git Commit | |
| Dashboard Version | |
| API Commit (if different) | |
| Environment | ☐ Local Dev ☐ Staging ☐ Production |
| Executed By | |
| Date | |

## Implementation Coverage
- Current scope: `GET /api/assessments/:assessmentId/pdf` (Blueprint
  Assessment PDF generation) — the same route validated functionally
  under Workflow 4. This workflow re-audits it specifically as a
  **report artifact** (PDF content/rendering correctness), where
  Workflow 4 audits it as an assessment-domain endpoint (status codes,
  ownership).
- Future report endpoints (PR29–32: analytics, class/home reporting)
  will be incorporated into this workflow's Implementation Coverage and
  Functional Validation as they are implemented. The workflow identity
  and structure do not change when that happens.

## Preconditions
- Logged-in teacher session (Workflow 1 passed).
- Workflow 4 (Assessments) has passed, or at minimum W4-07/W4-08/W4-09
  (PDF generation + open + 422 for non-blueprint) are known-good, since
  this workflow depends on that same route being reachable.
- A blueprint-backed assessment with known, verified item-analysis
  values (facility, discrimination, group size — see Workflow 4's
  W4-04/05/06) so the PDF's printed values can be checked against a
  known-good source rather than just "did a PDF appear."

## Environment Notes
- If Workflow 4 found the intervention-value bug (zeroed
  `averageFacilityValue`/`averageDiscrimination`/`Target group size`)
  still open, expect the same zeroed values to appear in the generated
  PDF — this is the same underlying data, not a separate PDF-rendering
  bug. Cross-reference rather than logging it twice as unrelated
  findings.
- PDF generation here is on-demand, not cached — regenerating the same
  assessment's PDF twice should produce consistent content each time.

## Stop Conditions
**Critical:**
- PDF content shows another teacher's data (cross-teacher leakage) —
  should be structurally impossible given W4's ownership check, but
  verify the generated file itself, not just the response status
- PDF is generated but is corrupt / fails to open
- Server 500 during PDF generation for a valid, owned assessmentId
- Uncaught console exception while triggering or viewing a PDF

**Non-blocking:** cosmetic UI, spinner/timing, copy, minor layout,
PDF visual polish that doesn't affect correctness.

## Functional Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W5-01 | 5.1 | Generate PDF for a blueprint-backed assessment with known item-analysis values | PDF opens, is not corrupt | Opens: Y/N | ☐ |
| W5-02 | 5.2 | Compare PDF's printed facility/discrimination/group-size values against the dashboard detail payload (W4-04/05/06) | Values match exactly | Match: Y/N · discrepancies: ___ | ☐ |
| W5-03 | 5.3 | Confirm PDF header/student-info/section headings render correctly (`drawHeader`, `drawStudentInfoRow`, `drawSectionHeading` per merged PDF visual enhancements) | All present and correctly populated | Observed: ___ | ☐ |
| W5-04 | 5.4 | Regenerate the same assessment's PDF a second time | Content identical to first generation | Identical: Y/N | ☐ |
| W5-05 | 5.5 | Attempt PDF generation for a non-blueprint-backed assessment | 422, no PDF generated (covered functionally in W4-09; confirm no partial/corrupt file is left behind) | Behavior: ___ | ☐ |

## Security Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W5-S1 | S1 | Inspect the generated PDF's actual content (not just the API response) for a Teacher-A-owned assessment | Contains only Teacher A's data | Confirmed: Y/N | ☐ |
| W5-S2 | S2 | Attempt to access the signed PDF URL from an unauthenticated session (e.g. new incognito window) | Confirm whether URL itself requires auth or is a bearer-token-scoped signed link; document actual behavior — do not assume | Behavior: ___ | ☐ |

## Console Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W5-06 | 5.6 | Trigger PDF generation → open PDF, full sequence | Clean — no uncaught exceptions, no failed loads | Clean: Y/N | ☐ |

## Optional — Timing/UX
| Evidence ID | Step | Action | Expected | Status |
|---|---|---|---|---|
| W5-T1 | T1 | Observe generation latency for a large assessment (many learners/questions) | Reasonable latency, correct loading state | Optional |

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
WF6 (QMS) prerequisites: ___ (or "None")

## Sign-off
- Workflow Executed By: __________
- Date: __________
- Git Commit / Branch: __________
- Environment: ☐ Local Dev ☐ Staging ☐ Production
