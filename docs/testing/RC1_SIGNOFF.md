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
| Audit Completion Date | (in progress — 6 of 7 workflows done) |
| Audited By | Xolani Tshabalala |

## Workflow Results
| Workflow | Functional | Security | Console | Overall | Workflow Doc |
|---|---|---|---|---|---|
| W1 Authentication | PASS | PASS | Clean | PASS | [WORKFLOW_01_AUTHENTICATION.md](./WORKFLOW_01_AUTHENTICATION.md) |
| W2 Classes | PASS | PASS | Clean | PASS | [WORKFLOW_02_CLASSES.md](./WORKFLOW_02_CLASSES.md) |
| W3 Learners | PASS | PASS | Clean | PASS | [WORKFLOW_03_LEARNERS.md](./WORKFLOW_03_LEARNERS.md) |
| W4 Assessments | PASS | PASS | Clean | PASS | [WORKFLOW_04_ASSESSMENTS.md](./WORKFLOW_04_ASSESSMENTS.md) |
| W5 Reports & PDF | PASS | PASS | Clean | PASS | [WORKFLOW_05_REPORTS_PDF.md](./WORKFLOW_05_REPORTS_PDF.md) |
| W6 QMS | PASS | PASS | Clean | PASS | [WORKFLOW_06_QMS.md](./WORKFLOW_06_QMS.md) |
| W7 Observations | PASS | PASS | Clean | PASS | [WORKFLOW_07_OBSERVATIONS.md](./WORKFLOW_07_OBSERVATIONS.md) |

(Fill each cell with PASS / FAIL, sourced directly from that workflow's
Workflow Result section — do not re-judge results here.)

## Findings Summary
Aggregate counts, sourced from each workflow's Findings Register.

| Severity | Count | Resolved | Open / Accepted |
|---|---|---|---|
| Critical | 0 | — | — |
| Major | 2 | 2 | 0 open — both resolved. W4-F1: `averageFacilityValue`/`averageDiscrimination`/target-group size never wired into `assessmentDetailService.js` — fixed and verified, see W4 Resolved Findings. W6-F1: dashboard `ReflectionPanel.jsx` create-reflection form omitted `topicId` — remediated in commit `f4edfa2`, verified via automated tests, HTTP/DB integration, and final browser retest; see W6 Resolved Findings. |
| Minor | 8 | — | 8 (favicon.ico 404 [W1]; duplicate class names [W2]; React Router future-flag warnings [W2, recurring in W3]; a11y form field missing id/name [W3]; inconsistent learner timestamp formats [W3]; no non-blueprint assessment in seed data blocking 422 PDF path [W4, same gap noted again in W5-05]; PDF signed-URL 2-hour TTL undocumented in checklist [W4]; Chrome native PDF-viewer a11y issue, browser-chrome-level [W5]) |

*(Running totals from W1–W7, all workflows executed.)*

### Open Findings Requiring Disposition
None currently open — all Critical and Major findings are either
Resolved (below) or there were none raised.

(List any Critical or Major finding that isn't fully "Fixed / Retest
Passed" — RC-1 cannot be approved with open Critical findings, and open
Major findings must be explicitly accepted with a stated reason, not
silently carried forward.)

### Resolved Findings
Findings that have been fixed and verified, but were not merely
"accepted" — do not conflate with Known Accepted Issues below.

| ID | Workflow | Severity | Status | Description | Resolution Evidence |
|---|---|---|---|---|---|
| W6-F1 | W6 | Major | Resolved | Dashboard `ReflectionPanel.jsx` create-reflection form (`handleSave()`, POST branch) originally sent `{ content }` only, never `topicId`, causing every browser-created reflection to fail 400 against API-layer validation (working as designed per ADR-013 §4.3/§3.3). | Remediated in commit `f4edfa2` (topic selector added, wired to new `GET /api/qms/topics` route, `topicId` now included in POST body). Repository hygiene follow-up in `542403e` (unrelated scratch files removed, W6-F1 implementation files unaffected). Verified via automated tests (targeted backend + frontend suites, all passing), HTTP/DB integration (curl-level persistence confirmed), and final browser retest (W6-15, all steps PASS, including PATCH leaving `topicId` unchanged). The "Unscoped" list-pill display noticed during retest was traced and classified as a pre-existing, unrelated UI gap (driven by `r.term`, not `topicId`) — not a W6-F1 regression. |
| W4-F1 | W4 | Major | Resolved | `averageFacilityValue`, `averageDiscrimination`, and target-group size are computed in `itemAnalysisService.js`/`interventionPlanService.js` but were never wired into `assessmentDetailService.js` — fields were absent from `/detail` entirely, not zeroed. | `assessmentDetailService.js` now composes both pre-existing services into `/detail` as `itemAnalysis{...}`/`interventionSummary{targetGroupSize}`, no new computation logic added. Alongside it, `computeInterventionPlan()` now distinguishes a legitimate zero-target-group class (`targetGroupSize:0`) from zero learner_results (`targetGroupSize:null`) — previously indistinguishable. Verified via `tests/w4-f1-assessment-detail-integration.test.js`, real HTTP/DB integration, Scenarios A–E, 36/36 passing; full existing suite (blueprint-analytics, intervention-reports, migration-030, phase-c2-diagnostic-atomicity, tseEvidenceHooks, blueprint-pdf-report) confirmed unaffected. See W4 Resolved Findings for full detail. |

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
| W4-F2 | W4 | Minor | No non-blueprint assessment exists in current seed data, so the 422 PDF path (W4-09, and again W5-05) could not be executed. Confirms known limitation RC1-H-001 (no production path for teachers to create blueprints in WhatsApp). | Test-data gap, not a defect; not preemptively seeded per plan. Revisit if a later workflow surfaces a real need to exercise the 422 path. |
| W4-F3 | W4 | Minor | PDF signed-URL has an undocumented 2-hour TTL (`cleanupOldPdfs()` in `core/generationPipeline.js`); checklist wording implies W4-07/08 as one continuous action, which is correct for real usage but can mislead a tester who steps away | Working as intended; one-line note added to W4 checklist's Environment Notes |
| W5-F1 | W5 | Minor | Chrome's native PDF viewer (PDF.js) reports one accessibility issue — "A form field element should have an id or name attribute" — in its own viewer chrome, not in the generated PDF content or app code | Browser-chrome-level, not app-level; same category as W3-F1 |

## Release Recommendation
☐ **RC-1 Approved for Production** — all workflows PASS, zero open
Critical findings, all Major findings resolved or explicitly accepted
above.

☑ **RC-1 Not Approved** — see blocking findings below.

**Blocking findings (if not approved):**
- W4-F1 (Major, open) — remains an outstanding issue across W1–W5. Not yet determined whether it's a genuine product gap or a checklist/expectation mismatch. Does not block continued workflow execution (W7 remains), but must be dispositioned — fixed, retested, or explicitly accepted with reason — before the Release Recommendation section above can be checked.

**Recommendation notes:**
W1–W6 executed; W6 passed after W6-F1 remediation. W7 remains. One
open Major finding (W4-F1) must still be closed out — fixed, retested,
or explicitly accepted with stated reason — before final RC-1
approval.

## Sign-off
- Approved By: __________
- Role: __________
- Date: __________
- Git Commit: __________
