# `estimation` / `roundingOffAndCompensating` — Taxonomy Decision Record (Grade Scope & Separation)

**Status:** PROPOSED DECISION RECORD — NOT YET FROZEN

> **PROPOSED TAXONOMY-SCOPE DECISION — NOT AN AUTHORIZATION OR
> IMPLEMENTATION CHANGE.**
> This document records a Project Owner judgment made in session,
> correcting an evidentiary premise asserted in
> `Senior_Phase_Project_Owner_Judgments_Round1.md`, item 3. It performs
> no new evidence extraction beyond direct verification against
> `CAPS_SP__MATHEMATICS_GR_7-9.pdf`. It does not authorize `estimation`
> or `roundingOffAndCompensating` for generation at any grade, and does
> not modify `AUTHORIZED_FAMILIES`, `FAMILY_GRADE_AUTHORIZATION`,
> Generation Policy, resolver mappings, generators, runtime code, or
> tests.

## 1. Corrected evidence basis

Traceable to `roundEstimate_Evidence_Review_Checkpoint.md` (committed)
and independently re-verified against `CAPS_SP__MATHEMATICS_GR_7-9.pdf`
directly. At G7, G8, and G9 alike, under "Calculation techniques"
(Numbers, Operations and Relationships → Whole numbers), the source
lists, in identical bullet-list form: estimation; adding, subtracting
and multiplying in columns; long division; rounding off and
compensating; using a calculator. Neither `estimation` nor `rounding
off and compensating` has an accompanying worked example at any grade.

The one candidate worked example anywhere in the document — Table 4.2
(assessment cognitive-levels guide, p.156): "Estimate the answer and
then calculate with a calculator: 325 + 279 [Grade 7]" — was already
excluded as evidence by `roundEstimate_Evidence_Review_Checkpoint.md`'s
non-inference exclusion #4 (different wording — "estimation and
appropriate rounding of numbers" — and a different document location,
assessment guidance rather than ATP content). Direct re-verification
this session confirms that exclusion continues to hold.

**Conclusion: `estimation` and `roundingOffAndCompensating` occupy the
identical evidence tier — named-but-unworked, G7–G9 — with no CAPS-level
asymmetry between them.**

## 2. Correction to Round 1, judgment #3

**Retracted claim:** `Senior_Phase_Project_Owner_Judgments_Round1.md`,
item 3 stated: "the legacy `roundEstimate` bundle is split into two
candidates, consistent with the reasoning already recorded in
`roundEstimate_Evidence_Review_Checkpoint.md`: estimation has at least
one worked instance; rounding-off-and-compensating has none, at any
grade."

**Correction:** This evidentiary premise is retracted. It does not
hold against the committed checkpoint or against direct source
verification. It must not be treated as supporting evidence for the
separation judgment below, or cited in any future document as a
CAPS-derived distinction between the two candidates.

**What is not retracted:** the decision to split `roundEstimate` into
two named candidates (`estimation`, `roundingOffAndCompensating`)
stands — re-grounded below as a Project Owner governance judgment, not
a CAPS-evidence conclusion. Round 1 item 3's other content (neither
candidate authorized; grade scope/evidence sufficiency to be separately
established) is unaffected and remains in force.

This correction is recorded here, alongside Round 1's original text,
which is not edited or overwritten — the audit trail preserves both
the original claim and this superseding correction.

## 3. Project Owner judgment

**Governance judgment**, made against evidence that is explicitly
identical for both candidates: `estimation` and
`roundingOffAndCompensating` remain **two separate taxonomy
candidates**. This is a Project Owner judgment about taxonomy
structure — made to preserve operational precision for a future
generator (the two techniques are conceptually related but
operationally different) — and is explicitly **not** a claim that CAPS
itself distinguishes them or provides asymmetric evidentiary support
for one over the other.

Evidence equality does not imply construct identity; this record does
not infer that the candidates must therefore be merged, only that CAPS
supplies no evidentiary basis for treating them differently.

## 4. Decision

| Candidate | Scope evidence | Evidence tier | Authorization |
|---|---|---|---|
| `estimation` | G7–G9, named | Named-but-unworked | **Not authorized** |
| `roundingOffAndCompensating` | G7–G9, named | Named-but-unworked | **Not authorized** |

Grade-level scope for either candidate, should authorization ever be
pursued, remains unresolved and is not addressed by this record — this
record fixes taxonomy separation and evidence-tier status only.

## 5. Explicit non-actions

This record does not authorize `estimation` or
`roundingOffAndCompensating` for generation at any grade; does not
modify `AUTHORIZED_FAMILIES` or `FAMILY_GRADE_AUTHORIZATION`; does not
modify any code or test; and does not constitute an ADR-023 §6 freeze
act.

## 6. Traceability

- `roundEstimate_Evidence_Review_Checkpoint.md` (committed)
- `CAPS_SP__MATHEMATICS_GR_7-9.pdf` — direct re-verification
- `Senior_Phase_Project_Owner_Judgments_Round1.md` (conversation-
  recorded; not yet committed) — item 3, corrected by this record
- Project Owner confirmation of the separation judgment, recorded in
  session

---

*End of decision record. Proposed only. Not frozen. No authorization,
`AUTHORIZED_FAMILIES`, `FAMILY_GRADE_AUTHORIZATION`, Generation
Policy, implementation, or test change is made by this document.*
