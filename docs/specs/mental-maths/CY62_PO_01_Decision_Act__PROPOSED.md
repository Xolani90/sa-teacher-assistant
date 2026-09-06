# CY62-PO-01 — `ratioRate` Grade-Scope Decision

**STATUS: ACCEPTED**

## 1. Decision Act

**Project Owner decision:** `C — Authorize G7–G9`

**Accepted scope:** `ratioRate` is authorized for **Grades 7–9**.

**Project Owner:** Xolani Tshabalala

This Decision Act is accepted by the Project Owner under ADR-023. The acceptance is limited strictly to the grade scope stated above.

The decision does **not** authorize an AI session, implementation agent, or other automated process to treat this document as authority for any unresolved generation specification.

## 2. Dependency

This decision depends on:

* **CY59-PO-02 — ACCEPTED (`a8b35e9`)**
* CY59-PO-02 established `ratioRate` as a distinct sibling candidate.
* Prior to this Decision Act, no grade scope for `ratioRate` had been accepted.

## 3. Decision Boundary

This Decision Act resolves **only the grade scope** of the `ratioRate` candidate.

It does **not** decide or authorize:

* generation range;
* question/item form;
* numeric domains;
* exactness or divisibility requirements;
* `canonicalAnswer` semantics;
* prompt semantics;
* wording requirements;
* randomization;
* difficulty model or banding;
* weighting;
* implementation behavior;
* production code changes;
* changes to the Generation Policy;
* freezing or accepting `Senior_Phase_Generation_Policy_v1_0_PROPOSED.md`.

Those matters remain unresolved unless separately authorized by a later governance decision.

## 4. Evidence Basis

### G7

G7 contains named curricular evidence concerning comparison of quantities of different kinds, including rate-related content, together with speed/distance/time contextual guidance.

No worked example is required as a mandatory threshold by the established repository precedent.

### G8

G8 contains materially similar named rate-related skill evidence and contextual treatment.

The evidence is materially consistent with the G7 treatment and supports continuation of the same `ratioRate` candidate.

### G9

G9 contains the strongest explicit evidence, including:

* the combined **“Ratio and rate”** skill;
* worked speed/distance/time examples;
* formulas for speed, distance, and time.

G9 also introduces a separate **“Direct and indirect proportion”** skill.

The repository does not establish whether this G9 structure should be interpreted as:

1. straightforward continuation of the earlier rate construct;
2. a broadened or restructured treatment; or
3. a distinct curricular treatment.

This uncertainty was disclosed during the decision process and does not invalidate the Project Owner's bounded grade-scope decision.

## 5. `Mental calculations` Heading

The absence of a `Mental calculations` heading does not disqualify `ratioRate`.

The governance record does not establish an authoritative rule making that heading mandatory for grade-scope authorization.

The `ratioRate` candidate lacks that heading consistently across G7–G9, while the relevant grade-specific curricular evidence exists.

## 6. Accepted Option

**Option C — Authorize G7–G9**

The Project Owner has selected Option C.

The accepted scope is therefore:

| Candidate   | Grade scope | Status         |
| ----------- | ----------- | -------------- |
| `ratioRate` | G7–G9       | **AUTHORIZED** |

The supporting rationale is that the available evidence establishes a sufficiently continuous rate-related curricular basis across G7, G8, and G9 for the bounded purpose of grade-scope authorization.

The G9 restructuring caveat remains part of the governance record and must not be silently removed or converted into an assumption of curricular identity beyond this scope decision.

## 7. Governance Consequence

This Decision Act establishes the following authority:

* `ratioRate` candidate identity: **accepted under CY59-PO-02**
* `ratioRate` grade scope: **accepted under CY62-PO-01**
* Authorized grades: **G7–G9**

The following remain unresolved:

* generation range;
* item form;
* exactness;
* numeric domain;
* `canonicalAnswer`;
* prompt semantics;
* randomization;
* difficulty;
* weighting;
* Generation Policy status;
* production implementation.

No implementation may infer those unresolved specifications merely from this grade-scope decision.

## 8. Acceptance Integrity

This acceptance is a Project Owner governance action under ADR-023.

No AI session is authorized to fabricate, simulate, or retrospectively attribute Project Owner acceptance.

The accepted Decision Act explicitly records:

```text
CY62-PO-01 = C
ratioRate grade scope = G7–G9
Project Owner: Xolani Tshabalala
```

The acceptance should be recorded in a dedicated governance commit containing no unrelated changes.

## 9. Non-Effects

This Decision Act:

* does not modify production code;
* does not authorize implementation;
* does not freeze the Mental Maths Generation Policy;
* does not modify `Senior_Phase_Generation_Policy_v1_0_PROPOSED.md`;
* does not reopen CY59-PO-02;
* does not alter any previously accepted governance decision;
* does not establish an evidence hierarchy beyond the conclusions explicitly recorded here.

## 10. Final Decision

**CY62-PO-01 — ACCEPTED**

**Decision:** `C`

**`ratioRate` grade scope:** **G7–G9**

**Implementation authority:** **NOT GRANTED**

**Generation specification authority:** **NOT GRANTED**

**Generation Policy:** **REMAINS PROPOSED / UNFROZEN**
