# CY54-PO-01 / CY54-PO-02 — Project Owner Decision Act

**Status:** ACCEPTED
**Accepted by:** Xolani Tshabalala, Project Owner
**Acceptance date:** 2026-09-05
**Depends on:** ADR-023 (Accepted, bootstrap commit `580fa45`)

This document records the explicit Project Owner Decision Act required by
ADR-023 §4.

I, **Xolani Tshabalala, Project Owner**, hereby ACCEPT the following decisions
under ADR-023:

* **CY54-PO-01 = B — Umbrella / sub-construct**
* **CY54-PO-02 = D — Remain unresolved pending further evidence**

This acceptance is an explicit Project Owner governance act. It is not an AI
recommendation, AI decision, or AI-held authority.

The dedicated Git commit recording this document constitutes the repository
record of this acceptance act under the ADR-023 governance mechanism.

---

## 1. CY54-PO-01

**Question:** What is the authoritative governance relationship between
`mulDivFluency` and `multiplicationFactFluency`?

**Project Owner decision:**

> B — `mulDivFluency` is an umbrella candidate/family containing
> `multiplicationFactFluency` as a governed sub-construct.

**Evidence basis:** `mulDivFluency_Scope_Decision_Review.md`,
`Senior_Phase_Cross_Candidate_Scope_Matrix.md`,
`Candidate_Universe_Status_Consolidation.md`,
`addSub_mulDivFluency_Scope_Decision_Record.md`.

**Consequences:**

* `mulDivFluency` is confirmed as the umbrella/family identifier.
* `multiplicationFactFluency` remains a distinctly identifiable governed
  sub-construct within that family, retaining its existing G7–G8 grade-scope
  authorization.
* Future Senior Phase governance documents must represent this
  umbrella/sub-construct relationship consistently rather than treating the
  two names as either fully synonymous or fully unrelated.
* This decision does **not** authorize new generation forms.
* This decision does **not** establish numeric ranges.
* This decision does **not** establish exactness rules.
* This decision does **not** establish `canonicalAnswer` semantics.
* This decision does **not** establish prompt semantics.
* This decision does **not** authorize production implementation.
* This decision does **not** freeze the Generation Policy.

---

## 2. CY54-PO-02

**Question:** Where does the multiplication/division inverse-operation
content belong?

**Project Owner decision:**

> D — Remain unresolved pending further evidence.

**Consequences:**

* The inverse-operation boundary (`mulDivFluency` vs. `addSub` vs. a separate
  candidate) remains explicitly open.
* No generation-eligibility work may be authored for that construct on the
  assumption it belongs to any one of the three options.
* No implementation change may rely on an assumed ownership boundary.
* A further, separate Project Owner decision is required before this question
  can close.

---

## 3. Explicit non-actions

This Decision Act does not, by itself:

* modify `Senior_Phase_Generation_Policy_v1_0_PROPOSED.md`;
* mark that policy Accepted, Frozen, or Implementation-authoritative;
* modify `AUTHORIZED_FAMILIES`;
* modify any production code;
* authorize item forms;
* authorize numeric or operand ranges;
* authorize exactness rules;
* authorize `canonicalAnswer` semantics;
* authorize prompt semantics;
* resolve CY54-PO-02; or
* authorize production implementation.

Any subsequent governance work remains subject to ADR-022 and ADR-023 and
must respect the boundaries established by this Decision Act.

---

## 4. Acceptance Act

This document is ACCEPTED by **Xolani Tshabalala, Project Owner**, under
ADR-023 §4.

The accepted decisions are:

1. **CY54-PO-01 = B — Umbrella / sub-construct**
2. **CY54-PO-02 = D — Remain unresolved pending further evidence**

The Project Owner explicitly accepts the consequences and non-actions stated
in Sections 1–3.

This acceptance does not:

* freeze the Senior Phase Generation Policy;
* authorize production implementation;
* modify `AUTHORIZED_FAMILIES`;
* establish numeric ranges;
* establish item-generation forms;
* establish exactness rules;
* establish `canonicalAnswer` semantics;
* establish prompt semantics; or
* resolve the CY54-PO-02 inverse-operation boundary.

Those matters remain subject to subsequent governance decisions under
ADR-022 and ADR-023.

**Project Owner:** Xolani Tshabalala
**Acceptance date:** 2026-09-05

---

*End of Decision Act. ACCEPTED under ADR-023 by Project Owner Xolani Tshabalala
on 2026-09-05.*
