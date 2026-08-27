# Senior Phase Taxonomy Decision Record: `ratioSharing` Grade Scope

**Status:** PROPOSED DECISION RECORD — NOT YET FROZEN

> **PROPOSED TAXONOMY-SCOPE DECISION — NOT AN AUTHORIZATION OR
> IMPLEMENTATION CHANGE.**
> This document transcribes a Project Owner judgment already made
> (Round 1, item 5; superseded by Round 2, item 1) into a decision
> record. It performs no new evidence extraction and makes no new
> governance judgment. It does not authorize `ratioSharing` at any
> grade, and does not modify `AUTHORIZED_FAMILIES`,
> `FAMILY_GRADE_AUTHORIZATION`, Generation Policy, resolver mappings,
> generators, runtime code, or tests.

## 1. Evidence basis

Traceable to `ratioSharing_Evidence_Review_Checkpoint.md` (committed,
`3ed9698`), which establishes: the CAPS phrase "sharing in a given
ratio where the whole is given" is present at G7 and G8, at an
**identical evidence tier — named-but-unworked at both grades**. No
worked example was located at either grade. G9 status is recorded as
genuinely unresolved, not merely unretrieved — the G9 Topics-table
material restructures into a merged "ratio and rate" bullet whose
relationship (if any) to the G7/G8 sharing-in-a-ratio mechanism is not
stated in the reviewed text.

## 2. Prior process gap, noted not corrected here

Per `Senior_Phase_Governance_Gap_Analysis.md` §6.5, `ratioSharing` has
never been run through the Senior Phase Scope Resolution Framework.
Round 1's initial ruling ("G7 only for now") was explicitly recorded
as provisional for that reason. This record does not retroactively
run the candidate through the framework; it records the Project
Owner's subsequent, explicit ruling superseding that provisional
position.

## 3. Project Owner judgment

**Round 1** (as Project Owner judgment): `ratioSharing` retained as
standalone; scoped provisionally to G7 only, pending framework review.

**Round 2** (as Project Owner judgment, superseding Round 1 on this
point): `ratioSharing` is scoped to **G7 and G8**. Stated reason: the
evidence tier is identical at both grades (named-but-unworked), and
there is no evidentiary basis for treating G8 as categorically
unsupported while accepting G7 — singling out G7, as the current code
does, has no basis in the reviewed evidence. G9 remains unresolved;
no G9 authorization is inferred from this judgment.

This is recorded as **governance judgment**, not a CAPS-derived
conclusion — CAPS's identical evidence tier at G7/G8 supports, but
does not compel, treating the two grades alike.

## 4. Decision

- `ratioSharing` → **G7, G8**.
- G9 → **not authorized / unresolved**, pending further evidence or a
  future framework pass.
- No change to item forms, numeric-range conventions, or exclusions
  already on record for this candidate (the G8-only sibling bullet
  "increasing or decreasing a number in a given ratio" remains
  excluded, pending its own evidence review).

## 5. Explicit non-actions

This record does not authorize `ratioSharing` for generation at any
grade; does not modify `AUTHORIZED_FAMILIES` or
`FAMILY_GRADE_AUTHORIZATION`; does not modify any code or test; and
does not constitute an ADR-023 §6 freeze act. It fixes a taxonomy-
scope judgment only, pending the sequence in Round 1/Round 2's own
stated next steps (decision record → review → Policy Completeness
Review → freeze).

## 6. Traceability

- `ratioSharing_Evidence_Review_Checkpoint.md` (`3ed9698`)
- `Senior_Phase_Governance_Gap_Analysis.md` (conversation-recorded;
  not yet committed)
- `Senior_Phase_Project_Owner_Judgments_Round1.md` (conversation-
  recorded; not yet committed) — item 5
- `Senior_Phase_Project_Owner_Judgments_Round2.md` (conversation-
  recorded; not yet committed) — item 1

---

*End of decision record. Proposed only. Not frozen. No authorization,
`AUTHORIZED_FAMILIES`, `FAMILY_GRADE_AUTHORIZATION`, Generation
Policy, implementation, or test change is made by this document.*
