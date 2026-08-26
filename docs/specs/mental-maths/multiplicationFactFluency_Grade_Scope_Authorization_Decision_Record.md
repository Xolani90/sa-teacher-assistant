# `multiplicationFactFluency` — Grade Scope Authorization Decision Record

**Status:** PROPOSED DECISION RECORD — NOT YET FROZEN

> **PROPOSED SCOPE AUTHORIZATION — NOT AN IMPLEMENTATION CHANGE.**
> This record authorizes `multiplicationFactFluency` at G7–G8 scope,
> at the taxonomy/scope level only. It does not authorize any
> particular generation algorithm, numeric-range convention (including
> the code's existing `1–12`), difficulty bands, operand distributions,
> item counts, generator behavior, resolver changes, Generation Policy
> text, tests, or code changes, and does not constitute an ADR-023 §6
> freeze act.

## 1. CAPS evidence

Independently verified against `CAPS_SP__MATHEMATICS_GR_7-9.pdf`,
under "Mental calculations" (Numbers, Operations and Relationships →
Whole numbers — a heading distinct from "Calculation techniques",
addressed in the companion `estimation` /
`roundingOffAndCompensating` decision record):

- **G7:** "Multiplication of whole numbers to at least 12 × 12,"
  listed as material revised from Grade 6.
- **G8:** "Multiplication of whole numbers to at least 12 × 12,"
  listed again explicitly under "What is different to Grade 7?" — an
  explicit revision marker, not repetition by omission.
- **G9:** No "Mental calculations" heading exists anywhere in the G9
  section of the document — checked exhaustively across every
  occurrence of the heading in the full document text.

## 2. Evidence-supported scope

G7–G8. Neither instance carries a worked example in the ATP material;
this is a named, explicitly-revised-at-next-grade requirement — the
same evidence shape already used for `powersRootsFluency`'s integer
domain (per
`Powersrootsfluency_grade_scope_decision_record.md`).

## 3. Project Owner judgment

**Authorization judgment, supported by CAPS evidence** — not a claim
that CAPS contains the taxonomy identifier
`multiplicationFactFluency`, which remains this project's own
abstraction. G9 is explicitly **not** authorized by extrapolation from
G7/G8, and the absence of a G9 Mental Calculations heading is
explicitly **not** interpreted as CAPS affirmatively excluding the
construct at G9 — only that no supporting evidence was located.

## 4. Decision

| Candidate | Authorized grades | Evidence basis | Status |
|---|---|---|---|
| `multiplicationFactFluency` | G7–G8 | Explicit "Mental calculations" evidence, G7 named/revised-from-G6, G8 explicit revision | **Authorized (scope only)** |
| `multiplicationFactFluency`, G9 | — | No supporting Mental Calculations evidence identified | Not authorized |

## 5. Explicit scope of this authorization

This is **scope authorization only**. It does not authorize: a
question-generation algorithm; the current `1–12` implementation
convention (which, per the governing rule already applied to other
candidates, carries no evidentiary weight of its own); difficulty
bands; operand distributions; item counts; generator behavior;
resolver/dispatch changes; Generation Policy text; tests; code
changes; or a freeze act. All of these require their own steps through
the established Generation Policy / governance chain before
implementation.

## 6. Traceability

- `CAPS_SP__MATHEMATICS_GR_7-9.pdf` — direct verification
- `Senior_Phase_Project_Owner_Judgments_Round1.md` (conversation-
  recorded; not yet committed) — item 8 (candidate left open)
- `Senior_Phase_Project_Owner_Judgments_Round2.md` (conversation-
  recorded; not yet committed) — item 4 (candidate named)
- Project Owner authorization decision, recorded in session

---

*End of decision record. Proposed only. Not frozen. No*
`AUTHORIZED_FAMILIES`*,* `FAMILY_GRADE_AUTHORIZATION`*, Generation
Policy, implementation, or test change is made by this document.*
