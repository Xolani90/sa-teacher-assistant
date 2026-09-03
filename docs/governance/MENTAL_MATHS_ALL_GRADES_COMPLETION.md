# Mental Maths — Final All-Grades Feature Completion

## Authorization

The Mental Maths feature must be completed as a product feature that caters for **all grades within the SA Teacher Assistant's approved curriculum scope**.

The previously completed Grade 5 C12/C13 implementation is one governed grade-specific implementation slice. It is **not** the definition of the entire Mental Maths feature.

The Grade 5 C12/C13 generation-policy specification is frozen and must remain frozen.

This document authorizes implementation work. It does not authorize creation of another governance phase.

---

## Phase 1 — Determine the Actual All-Grades Scope

Inspect the repository, existing Mental Maths specifications/governance, curriculum/taxonomy artifacts, dispatch logic, and current implementation.

Determine exactly which grades the SA Teacher Assistant is expected to support for Mental Maths.

Use the project's existing approved scope and curriculum evidence. Do not invent grade coverage.

Produce a grade-by-grade matrix showing:

- Grade
- Expected Mental Maths availability
- Topics/question types currently supported
- Difficulty support
- Delivery modes
- Current implementation status
- Missing functionality
- Whether curriculum evidence/specification already exists
- Implementation required

Do not reopen already-settled governance decisions merely because coverage is being checked.

The frozen Grade 5 C12/C13 specification must remain unchanged.

For other grades, use the project's existing approved curriculum/taxonomy evidence and specifications. If a grade/topic genuinely lacks an authorized specification required for implementation, identify it clearly rather than inventing mathematical rules or silently expanding governance.

---

## Phase 2 — Complete the All-Grades Implementation

Implement every genuinely missing Mental Maths capability required for the approved all-grades scope.

The finished feature should provide a coherent teacher experience across all supported grades, including where applicable:

1. Grade selection
2. Topic selection appropriate to the selected grade
3. Difficulty selection: Support / Core / Extension
4. Question count
5. Oral delivery
6. Written delivery
7. Deterministic mathematical generation
8. canonicalAnswer generation
9. LLM wording/presentation only
10. Answer key
11. Grade-specific dispatch
12. WhatsApp-compatible formatting
13. Save-session behaviour
14. Saved-resource integration/retrieval
15. Validation and error handling
16. Appropriate tests
17. End-to-end teacher-facing flow

Do not force identical question types or difficulty rules onto every grade.

Grade-specific behavior must follow the approved curriculum/specification for that grade.

Do not invent curriculum coverage merely to make the grade matrix appear complete.

---

## Governance Boundaries

The following rules are mandatory:

- Do not reopen the frozen Grade 5 C12/C13 policy.
- Do not introduce `c12Band()`.
- Do not introduce `c13Band()`.
- Do not introduce hard-coded unauthorized difficulty thresholds.
- Do not make the LLM responsible for mathematical correctness.
- Preserve deterministic mathematical generation.
- Preserve `canonicalAnswer` as the mathematical source of truth.
- Do not alter frozen governance artifacts unless a genuine implementation contradiction makes it unavoidable.
- Do not create another governance phase.
- Do not touch unrelated features.
- Do not touch unrelated `public/` work.
- Do not perform unrelated refactoring.
- Make the smallest coherent implementation necessary.
- Preserve existing architecture and conventions wherever practical.
- Reuse existing persistence mechanisms where the approved architecture already specifies them.
- Do not create a new database table unless the existing approved architecture genuinely requires it.

---

## Phase 3 — Test the Complete All-Grades Feature

Create or update tests so that every supported grade has meaningful coverage.

Test:

- Grade dispatch
- Grade-appropriate topics
- Mathematical question generation
- Mathematical correctness
- `canonicalAnswer`
- Difficulty handling
- Question count
- Oral/written modes
- Answer keys
- Save/retrieval behavior
- Validation/error handling
- WhatsApp formatting
- Regression of existing Grade 5 C12/C13 behavior

Do not claim all-grades support merely because a generic dispatcher accepts a grade.

Verify that actual generated content and supported topics are valid for each supported grade.

Run the relevant Mental Maths test suite.

Run the broader test suite if practical.

If the environment prevents tests from running, report the exact limitation. Do not mask or misrepresent test failures.

---

## Phase 4 — Final Closure Report

Do **not** commit or push.

Report:

1. The complete approved grade scope.
2. A grade-by-grade implementation matrix.
3. What was already complete.
4. What was missing.
5. What was implemented.
6. Every changed file.
7. Tests added or changed.
8. Mental Maths test results.
9. Broader test results.
10. Any environmental limitations.
11. `git diff --stat`
12. `git status --short`

---

## Success Criterion

The success criterion is **not**:

> "Grade 5 Mental Maths works."

The success criterion is:

> "Every grade within the approved Mental Maths scope has a real, curriculum-appropriate, tested implementation, while the frozen Grade 5 C12/C13 governance remains intact."

Inspect first, then implement the genuine remaining gaps.

Do not stop after producing another audit if genuine implementation gaps are found.

Do not commit.

Do not push.

Stop only after the implementation and testing work is complete and the final closure report has been produced.
