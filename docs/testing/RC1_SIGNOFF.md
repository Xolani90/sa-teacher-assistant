# RC-1 Sign-off Summary

This is the single-artifact summary of RC-1's release audit. Do not fill
this in until all seven workflow checklists have actually been executed
against a running build — this document reports results, it does not
generate them. Each row must trace back to a completed workflow file
with recorded evidence, not to an assumption of pass.

## Audit Scope
| Field | Value |
|---|---|
| Release Candidate | RC-1 |
| Git Commit Audited | be6bfe91a526ec8a5828f0f1bb55f359f9836226 |
| Git Branch | main |
| Environment | ☑ Local Dev ☐ Staging ☐ Production |
| Audit Start Date | 2026-08-06 |
| Audit Completion Date | (in progress — 4 of 7 workflows done) |
| Audited By | Xolani Tshabalala |

## Workflow Results
| Workflow | Functional | Security | Console | Overall | Workflow Doc |
|---|---|---|---|---|---|
| W1 Authentication | PASS | PASS | Clean | PASS | [WORKFLOW_01_AUTHENTICATION.md](./WORKFLOW_01_AUTHENTICATION.md) |
| W2 Classes | PASS | PASS | Clean | PASS | [WORKFLOW_02_CLASSES.md](./WORKFLOW_02_CLASSES.md) |
| W3 Learners | PASS | PASS | Clean | PASS | [WORKFLOW_03_LEARNERS.md](./WORKFLOW_03_LEARNERS.md) |
| W4 Assessments | PASS | PASS | Clean | PASS | [WORKFLOW_04_ASSESSMENTS.md](./WORKFLOW_04_ASSESSMENTS.md) |
| W5 Reports & PDF | | | | | [WORKFLOW_05_REPORTS_PDF.md](./WORKFLOW_05_REPORTS_PDF.md) |
| W6 QMS | | | | | [WORKFLOW_06_QMS.md](./WORKFLOW_06_QMS.md) |
| W7 Observations | | | | | [WORKFLOW_07_OBSERVATIONS.md](./WORKFLOW_07_OBSERVATIONS.md) |

(Fill each cell with PASS / FAIL, sourced directly from that workflow's
Workflow Result section — do not re-judge results here.)

## Findings Summary
Aggregate counts, sourced from each workflow's Findings Register.

| Severity | Count | Resolved | Open / Accepted |
|---|---|---|---|
| Critical | 0 | — | — |
| Major | 1 | — | 1 (W4-F1: `averageFacilityValue`/`averageDiscrimination`/target-group size never wired into `assessmentDetailService.js` — open, carried forward to W5 for re-verification) |
| Minor | 7 | — | 7 (favicon.ico 404 [W1]; duplicate class names [W2]; React Router future-flag warnings [W2, recurring in W3]; a11y form field missing id/name [W3]; inconsistent learner timestamp formats [W3]; no non-blueprint assessment in seed data blocking 422 PDF path [W4]; PDF signed-URL 2-hour TTL undocumented in checklist [W4]) |

*(Running totals from W1–W4 — will update as W5–W7 land.)*

### Open Findings Requiring Disposition
| ID | Workflow | Severity | Description | Disposition |
|---|---|---|---|---|
| W4-F1 | W4 | Major | `averageFacilityValue`, `averageDiscrimination`, and target-group size are computed in `itemAnalysisService.js`/`interventionPlanService.js` but never wired into `assessmentDetailService.js` — fields are absent from `/detail` entirely, not zeroed. Distinct from the closed NR investigation in `INVESTIGATION_LOG.md` (that was about value correctness once present; this is endpoint exposure). | Open — carried forward to W5. Verify during W5 whether the gap is isolated to `assessmentDetailService.js` or also affects report generation paths. Must be explicitly resolved or accepted before RC-1 approval, per Major-finding policy above. |

(List any Critical or Major finding that isn't fully "Fixed / Retest
Passed" — RC-1 cannot be approved with open Critical findings, and open
Major findings must be explicitly accepted with a stated reason, not
silently carried forward.)

## Known Accepted Issues
Issues knowingly shipped in RC-1 (e.g. Minor findings not worth
blocking release for). List explicitly rather than letting them exist
only inside individual workflow Findings Registers.

| ID | Workflow | Severity | Description | Reason Accepted |
|---|---|---|---|---|
| W1-F1 | W1 | Minor | favicon.ico 404 | Cosmetic, no functional impact |
| W2-F1 | W2 | Minor | Duplicate class names in list UI (stress-test seed artifact) | Test data artifact, not a real defect; revisit if seed data changes |
| W2-F2 | W2 | Minor | React Router v7 future-flag deprecation warnings in console (recurring in W3) | Library-level, non-blocking; addressed at next React Router major upgrade |
| W3-F1 | W3 | Minor | Chrome accessibility issue: form field missing id/name attribute on Learner Detail | Non-blocking, cosmetic/accessibility hygiene |
| W3-F2 | W3 | Minor | Inconsistent learner timestamp formats (ISO 8601 vs SQLite datetime) across different seed paths | Not a live defect; normalize if any code later depends on parsing these as dates |
| W4-F2 | W4 | Minor | No non-blueprint assessment exists in current seed data, so the 422 PDF path (W4-09) could not be executed. Confirms known limitation RC1-H-001 (no production path for teachers to create blueprints in WhatsApp). | Test-data gap, not a defect; not preemptively seeded per plan. Revisit if W5+ surfaces a real need to exercise the 422 path. |
| W4-F3 | W4 | Minor | PDF signed-URL has an undocumented 2-hour TTL (`cleanupOldPdfs()` in `core/generationPipeline.js`); checklist wording implies W4-07/08 as one continuous action, which is correct for real usage but can mislead a tester who steps away | Working as intended; one-line note added to W4 checklist's Environment Notes |

## Release Recommendation
☐ **RC-1 Approved for Production** — all workflows PASS, zero open
Critical findings, all Major findings resolved or explicitly accepted
above.

☐ **RC-1 Not Approved** — see blocking findings below.

**Blocking findings (if not approved):**
- W4-F1 (Major, open) — pending W5 re-verification before this can be marked resolved or explicitly accepted. Not yet a hard blocker on its own, but must be dispositioned before final RC-1 approval.

**Recommendation notes:**
W1–W4 complete and passing. W5–W7 remain. W4-F1 is the only open Major
finding in the audit so far; it does not block continued workflow
execution but must be closed out (fixed, retested, or explicitly
accepted with reason) before the Release Recommendation section above
can be checked.

## Sign-off
- Approved By: __________
- Role: __________
- Date: __________
- Git Commit: __________
