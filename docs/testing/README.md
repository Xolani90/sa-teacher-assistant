# RC Sign-off Process

This directory contains the Release Candidate (RC) audit framework for
the SA Teacher Assistant dashboard. It is the entry point for anyone
performing a release audit.

## Purpose
Each dashboard feature area has a corresponding workflow checklist
representing a **user workflow**, not a REST resource. A checklist is
valid release-governance evidence for a given RC — pass/fail with
recorded evidence, traceable to a specific git commit — not just a test
script. Workflow scope can expand as backend endpoints are added in
future PRs without changing the workflow's name, number, or structure;
see each workflow's Implementation Coverage section for what it
currently exercises.

## Execution Order
Run workflows in this order. Each one's Carry Forward section states
what state/prerequisites it hands to the next.

1. [`WORKFLOW_01_AUTHENTICATION.md`](./WORKFLOW_01_AUTHENTICATION.md) — Login, OTP, session, logout
2. [`WORKFLOW_02_CLASSES.md`](./WORKFLOW_02_CLASSES.md) — Class list, detail, snapshot
3. [`WORKFLOW_03_LEARNERS.md`](./WORKFLOW_03_LEARNERS.md) — Learner list, detail, intervention plan
4. `WORKFLOW_04_ASSESSMENTS.md` — Assessment detail, PDF trigger (not yet instantiated)
5. `WORKFLOW_05_REPORTS_PDF.md` — Reports & PDF (not yet instantiated)
6. `WORKFLOW_06_QMS.md` — QMS / reflections / TSE status (not yet instantiated)
7. `WORKFLOW_07_OBSERVATIONS.md` — Observation list, detail (not yet instantiated)

## Pass Criteria
A workflow is **PASS** only when:
- Functional validation: all steps pass
- Security validation: all steps pass (no ownership leaks, no auth bypass)
- Console validation: clean (no uncaught exceptions)
- Zero open Critical or Major findings (Minor findings may remain open
  with a logged disposition)

RC-1 is release-ready only once all seven workflows are individually
signed off as PASS against the same git commit.

## Stop Conditions
Each workflow defines its own Critical stop conditions in its Stop
Conditions section, but the baseline (present in every workflow) is:
- Auth bypass or a protected route reachable while logged out
- Cross-teacher data leakage (ownership scoping failure — must be
  404-not-403 per ADR-008 §8)
- Server 500 on a core read path
- Uncaught console exception during a core flow

Full severity definitions: [`RC_SEVERITY.md`](./RC_SEVERITY.md).

## Template
All workflow checklists are instantiated from the frozen structure in
[`RC_TEMPLATE.md`](./RC_TEMPLATE.md). Do not modify the structure per
workflow — only step content changes, derived from inspecting the
actual implementation (routes/services) at instantiation time. Future
structural improvements come from real execution experience, not
speculation.

## Recording Findings
Every issue found during a workflow run goes in that workflow's
Findings Register — never left as a loose note. Each row cites severity
from `RC_SEVERITY.md`, references concrete evidence (screenshot/HAR),
and tracks disposition (Open / Fixed / Retest Passed) so nothing
disappears between RC cycles.

## Sign-off
Every workflow ends with a Sign-off block (executor, date, git
commit/branch, environment) so a completed checklist remains a valid
audit artifact independent of this conversation or any single person's
memory of what was tested.
