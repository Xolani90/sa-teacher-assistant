# RC Sign-off Checklist — Template (FROZEN)

This is the frozen structure for every workflow-level RC sign-off
checklist (`WORKFLOW_0N_<NAME>.md`). Do not redesign the structure per
workflow — only the step content changes, derived from the actual
implementation under test at the time the checklist is instantiated.

Severity terms (Critical/Major/Minor) always refer to
`docs/testing/RC_SEVERITY.md` — do not redefine them locally.

Workflow identity is a **user workflow**, not a REST resource. A
workflow's scope may expand as backend endpoints are added in later PRs
without changing the workflow's name, number, or structure. Each
workflow records what it currently covers in its Implementation
Coverage section below, immediately under Release Information.

---

## Release Information
| Field | Value |
|---|---|
| Release Candidate | |
| Workflow | |
| Git Branch | |
| Git Commit | |
| Dashboard Version | |
| API Commit (if different) | |
| Environment | ☐ Local Dev ☐ Staging ☐ Production |
| Executed By | |
| Date | |

## Implementation Coverage
State plainly which endpoints/services this workflow currently
exercises, and note any known future expansion (e.g. "Future report
endpoints will be incorporated as implemented" for Workflow 5).

## Preconditions
(workflow-specific — e.g. seeded data, existing auth session, existing
records to navigate to)

## Environment Notes
(workflow-specific — e.g. local dev quirks, dependent services)

## Stop Conditions
**Critical** (stop audit immediately — see RC_SEVERITY.md):
- (workflow-specific list, always including cross-teacher data leakage,
  auth bypass, server 500 on core paths, uncaught console exceptions)

**Non-blocking** (log and continue):
- Cosmetic UI, spinner/timing, copy, minor layout

## Functional Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|

## Security Validation
(where applicable — ownership scoping / 404-not-403 checks, cross-teacher
access attempts)
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|

## Console Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|

## Optional — Timing/UX
| Evidence ID | Step | Action | Expected | Status |
|---|---|---|---|---|

## Findings Register
| ID | Severity | Step | Description | Evidence | Disposition |
|---|---|---|---|---|---|
| | Critical/Major/Minor (see RC_SEVERITY.md) | | | Screenshot/HAR | Open/Fixed/Retest Passed |

(one row per finding; leave empty if none)

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
Prerequisites/state this workflow hands off to the next workflow (or
"None").

## Sign-off
- Workflow Executed By: __________
- Date: __________
- Git Commit / Branch: __________
- Environment: ☐ Local Dev ☐ Staging ☐ Production
