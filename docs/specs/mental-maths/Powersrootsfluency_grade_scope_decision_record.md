# Senior Phase Taxonomy Decision Record: `powersRootsFluency` Grade Scope (Integer and Rational Domains)

**Status:** PROPOSED DECISION RECORD — NOT YET FROZEN

> **PROPOSED TAXONOMY-SCOPE DECISION — NOT AN AUTHORIZATION OR
> IMPLEMENTATION CHANGE.**
> This document transcribes Project Owner judgments already made
> (Round 2, items 2 and 3) into a decision record. It performs no new
> evidence extraction and makes no new governance judgment beyond what
> Round 2 already decided. It does not authorize `powersRootsFluency`
> at any grade or in any domain, and does not modify
> `AUTHORIZED_FAMILIES`, `FAMILY_GRADE_AUTHORIZATION`, Generation
> Policy, resolver mappings, generators, runtime code, or tests.

## 1. Evidence basis

Traceable to `powersRootsFluency_Evidence_Review_Checkpoint.md`
(committed, `3ed9698`) and independently re-confirmed against the
primary source (`CAPS_SP__MATHEMATICS_GR_7-9.pdf`) in this session:

- **G7, integer domain:** "Determine squares to at least 12² and their
  square roots" / "Determine cubes to at least 6³ and cube roots" —
  named under G7 Mental calculations, Exponents.
- **G8, integer domain:** "Revise: Squares to at least 12² and their
  square roots" / "Cubes to at least 6³ and their cube roots" —
  explicit revision of the same G7 material, confirmed in both the
  G8 Topics table and the G8 Annual Teaching Plan clarification notes.
- **G8, rational domain only:** "Calculate the squares, cubes, square
  roots and cube roots of rational numbers" — present under G8
  Calculations using numbers in exponential form. **This phrase does
  not appear under G7.**
- **G9:** the Exponents topic column at G9 contains no "Mental
  calculations" heading and no corresponding fluency requirement for
  integer or rational squares/cubes/roots. G9's exponent content
  (laws of exponents, integer exponents, scientific notation) is a
  distinct construct from the mental-fluency material evidenced at
  G7/G8.

The rational-domain scope-level merge into `powersRootsFluency`
(rather than remaining under `fracDecPercent`) was previously accepted
at the scope level in
`fracDecPercent_powersRootsFluency_RationalSquaresRoots_Scope_Decision_Record.md`
(committed, `5b4c964`) and reaffirmed by Round 1, item 4. This record
does not revisit that scope-level merge; it addresses grade boundary
only.

## 2. Project Owner judgment

**Integer domain (Round 2, item 2):** scoped to **G7 and G8**. Stated
reason: CAPS explicitly places integer square/cube/root mental fluency
at G7 and explicitly revises it at G8; G9's exponent work does not
carry a corresponding mental-fluency requirement, so no G9
authorization is inferred merely because the underlying mathematical
concepts remain in the G9 curriculum in a different form.

**Rational domain (Round 2, item 3):** scoped to **G8 only**. Stated
reason: the CAPS progression introduces rational-number squares,
cubes, square roots, and cube roots specifically at G8, with no
corresponding G7 phrase.

Both are recorded as **governance judgment** informed by, but not
purely dictated by, CAPS progression language — the Project Owner's
stated reasoning is preserved above rather than presented as a bare
CAPS-derived conclusion.

## 3. Decision

- `powersRootsFluency`, integer domain → **G7, G8**. G9 not
  authorized.
- `powersRootsFluency`, rational domain → **G8 only**. G7 and G9 not
  authorized.
- **Implementation boundary, explicit:** this record does not
  authorize a rational-form generator. Per Round 2 item 3, before any
  rational-domain implementation is authorized, a separate generation
  specification must be authored establishing, at minimum: allowable
  fraction/decimal forms; numerator/denominator or decimal-range
  constraints; exact-vs-rounded output rules; precision/rounding
  rules; permitted item forms; exclusions and difficulty constraints.
  No such specification currently exists in this repository.
- Numeric-range conventions (currently `1–12` square/root, `1–6`
  cube/cube-root in code) remain **UNDECIDED** as policy values,
  consistent with Round 1 item 9 — this record does not adopt them.

## 4. Explicit non-actions

This record does not authorize `powersRootsFluency` for generation at
any grade or in any domain; does not modify `AUTHORIZED_FAMILIES` or
`FAMILY_GRADE_AUTHORIZATION`; does not author the required rational-
domain generation specification; does not modify any code or test;
and does not constitute an ADR-023 §6 freeze act.

## 5. Traceability

- `powersRootsFluency_Evidence_Review_Checkpoint.md` (`3ed9698`)
- `fracDecPercent_powersRootsFluency_RationalSquaresRoots_Scope_Decision_Record.md`
  (`5b4c964`) — scope-level merge acceptance (not superseded here)
- `Senior_Phase_Project_Owner_Judgments_Round1.md` (conversation-
  recorded; not yet committed) — item 4
- `Senior_Phase_Project_Owner_Judgments_Round2.md` (conversation-
  recorded; not yet committed) — items 2, 3
- Independent verification against `CAPS_SP__MATHEMATICS_GR_7-9.pdf`,
  performed in this session

---

*End of decision record. Proposed only. Not frozen. No authorization,
`AUTHORIZED_FAMILIES`, `FAMILY_GRADE_AUTHORIZATION`, Generation
Policy, implementation, or test change is made by this document. No
rational-form generation specification is created by this document.*
