# Workflow 5: Reports & PDF — RC Sign-off Checklist

Severity terms refer to `docs/testing/RC_SEVERITY.md`. Structure frozen
per `docs/testing/RC_TEMPLATE.md`.

## Release Information
| Field | Value |
|---|---|
| Release Candidate | RC-1 |
| Workflow | W5 – Reports & PDF |
| Git Branch | main |
| Git Commit | 63c76a7 |
| Dashboard Version | |
| API Commit (if different) | |
| Environment | ☒ Local Dev ☐ Staging ☐ Production |
| Executed By | Xolani |
| Date | 2026-08-08 |

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
- **Confirmed during W5 execution:** the signed PDF URL (`?t=<token>`)
  is itself the auth mechanism — no Authorization header is required
  or expected to open it (W5-S2). This is by design, since these URLs
  are meant to be opened directly in a browser (e.g. from WhatsApp or
  the dashboard), which cannot attach a bearer token. Accepted risk:
  anyone who obtains the URL can view the PDF for the remainder of its
  2-hour TTL with no re-authentication — standard tradeoff for signed
  URLs, not a defect.

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
| W5-01 | 5.1 | Generate PDF for a blueprint-backed assessment with known item-analysis values | PDF opens, is not corrupt | Opens: Y — assessmentId=6, opened cleanly in Chrome's native PDF viewer, 2 pages | ☒ |
| W5-02 | 5.2 | Compare PDF's printed facility/discrimination/group-size values against the dashboard detail payload (W4-04/05/06) | Values match exactly | Not independently executed. W4-F1 confirmed these fields are absent from `/detail` entirely — there is no dashboard-side value to compare the PDF against. This is not a new PDF defect; it is the same underlying gap already logged as W4-F1. No duplicate finding created here. | N/A — see W4-F1 |
| W5-03 | 5.3 | Confirm PDF header/student-info/section headings render correctly (`drawHeader`, `drawStudentInfoRow`, `drawSectionHeading` per merged PDF visual enhancements) | All present and correctly populated | Observed: header (subject/grade/date/total marks), teacher/blueprint/learner-count line, Overall Performance, Topic Performance table, Strongest/Weakest Topics, Learner Summary, and Appendix (per-topic learner detail) all rendered correctly across 2 pages | ☒ |
| W5-04 | 5.4 | Regenerate the same assessment's PDF a second time | Content identical to first generation | Identical: Y — two independent generations (different UUID/signed-token URLs, as expected) produced byte-identical meaningful content: same averages (75%/75%/75%/100%), same topic table, same strongest/weakest rankings, same learner summary and appendix values | ☒ |
| W5-05 | 5.5 | Attempt PDF generation for a non-blueprint-backed assessment | 422, no PDF generated (covered functionally in W4-09; confirm no partial/corrupt file is left behind) | Behavior: Blocked/Not Executable — confirmed via direct query (`SELECT ... WHERE blueprint_id IS NULL` → empty result) that no non-blueprint assessment exists in current seed data. Same fixture gap as W4-09/W4-F2. Not manufacturing a fixture solely to force execution, per test-plan discipline — revisit only if a real need to exercise the 422 path arises in a later workflow. | N/A |

## Security Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W5-S1 | S1 | Inspect the generated PDF's actual content (not just the API response) for a Teacher-A-owned assessment | Contains only Teacher A's data | Confirmed: Y — both generated PDFs (W5-01, W5-04) contained exclusively Chloe van der Merwe / Grade 6B Mathematics data, Teacher A's (Thabo Mokoena's) own assessment. No cross-teacher content present. | ☒ |
| W5-S2 | S2 | Attempt to access the signed PDF URL from an unauthenticated session (e.g. new incognito window) | Confirm whether URL itself requires auth or is a bearer-token-scoped signed link; document actual behavior — do not assume | Behavior: 200 OK, `Content-Type: application/pdf`, served with no Authorization header at all. Confirmed the `?t=<token>` query param is the auth mechanism by design — see Environment Notes above. | ☒ |

## Console Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W5-06 | 5.6 | Trigger PDF generation → open PDF, full sequence | Clean — no uncaught exceptions, no failed loads | Clean: Y — Console panel showed zero logged errors/warnings during trigger→open. Chrome's native PDF-viewer Issues panel flagged one third-party issue ("A form field element should have an id or name attribute") originating from Chrome's own PDF.js viewer chrome, not from the generated PDF content or app code — logged below as a Minor/non-blocking finding, consistent with how W3-F1 (a similar a11y finding) was handled. | ☒ |

## Optional — Timing/UX
| Evidence ID | Step | Action | Expected | Status |
|---|---|---|---|---|
| W5-T1 | T1 | Observe generation latency for a large assessment (many learners/questions) | Reasonable latency, correct loading state | Not executed — optional |

## Findings Register
| ID | Severity | Step | Description | Evidence | Disposition |
|---|---|---|---|---|---|
| W5-F1 | Minor | 5.6 | Chrome's native PDF viewer (PDF.js) reports one accessibility issue — "A form field element should have an id or name attribute" — in its own viewer chrome (e.g. the built-in find/search field), not in the generated PDF content or app code. | Chrome DevTools Issues panel, single third-party issue while viewing assessmentId=6's PDF | Non-blocking; browser-chrome-level, not app-level. Same category as W3-F1. |

**Note:** W5-02 intentionally has no findings-register entry of its own.
The underlying gap is already logged as **W4-F1** (Major, open, carried
forward from Workflow 4) and is not duplicated here. W5 confirms the
gap is consistent with what W4 found — the PDF simply doesn't print
facility/discrimination/group-size values because the dashboard-side
service never computes/exposes them for this route either, not because
of a separate PDF-rendering defect.

## Workflow Result
- Functional: ☒ Pass ☐ Fail
- Security: ☒ Pass ☐ Fail
- Console: ☒ Clean ☐ Issues found
- Critical findings: 0
- Major findings: 0 (W4-F1 remains open under Workflow 4, not duplicated here)
- Minor findings: 1 (W5-F1)
- Retests required: 0
- Execution time: ___ minutes
- Overall: ☒ PASS ☐ FAIL
- Reason (if FAIL): N/A

## Carry Forward
WF6 (QMS) prerequisites: None. W4-F1 remains open and tracked under
Workflow 4 / the RC-1 sign-off summary — it does not block W6 execution
but must still be resolved or explicitly accepted before final RC-1
approval.

## Sign-off
- Workflow Executed By: Xolani
- Date: 2026-08-08
- Git Commit / Branch: main / 63c76a7
- Environment: ☒ Local Dev ☐ Staging ☐ Production
