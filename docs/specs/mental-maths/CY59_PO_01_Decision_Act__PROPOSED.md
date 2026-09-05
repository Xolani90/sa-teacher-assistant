# CY59-PO-01 — Project Owner Decision Act

**Status:** ACCEPTED
**Accepted by:** Xolani Tshabalala, Project Owner
**Acceptance date:** 2026-09-05
**Depends on:** ADR-023 (Accepted, bootstrap commit `580fa45`)
**Related evidence:** Cycle 59 — Bounded Governance Decision-Readiness Drafting

This document records the explicit Project Owner Decision Act required by
ADR-023 §4.

I, **Xolani Tshabalala, Project Owner**, hereby ACCEPT the following decision
under ADR-023:

> **CY59-PO-01 = B — Two paired sub-constructs**

`powersRootsFluency` is governed as one candidate family containing two paired
sub-constructs:

1. **squares + square roots**
2. **cubes + cube roots**

This decision establishes governance structure only. It does not authorize
generation eligibility or implementation details.

---

## 1. Decision

**Question:**

What governance structure should apply to `powersRootsFluency`'s four
constituent forms?

**Project Owner decision:**

> **B — Two paired sub-constructs: square + square root, and cube + cube root.**

The paired structure reflects the strongest available CAPS evidence, which
presents squares together with their square roots and cubes together with their
cube roots.

---

## 2. Rationale

The Cycle 59 evidence audit established that:

* G7 names squares and their square roots together.
* G7 names cubes and their cube roots together.
* G8 explicitly revisits both pairs.
* G8 additionally introduces calculation of squares, cubes, square roots and
  cube roots of rational numbers.
* The CAPS evidence does not establish four independently governed forms.
* The CAPS evidence also does not require all four forms to be treated as one
  undifferentiated governance unit.

The Project Owner therefore accepts the paired structure:

* square / square root;
* cube / cube root.

This is a governance abstraction informed by the curriculum evidence. It is
not claimed to be a CAPS-native identifier.

---

## 3. Consequences

This decision means:

* `powersRootsFluency` remains the candidate family identifier.
* Square and square-root content are governed as one paired sub-construct.
* Cube and cube-root content are governed as one paired sub-construct.
* Future generation-eligibility specifications may distinguish the two pairs
  where evidence or separately accepted policy requires it.
* The existing accepted grade-scope authorization remains unchanged.

---

## 4. Explicit Non-Actions

This Decision Act does NOT:

* authorize any numeric range;
* establish a generation ceiling;
* interpret "at least 12²" as a maximum;
* interpret "at least 6³" as a maximum;
* authorize any specific item form;
* authorize integer or rational generation details beyond already accepted
  scope;
* establish exactness rules;
* establish `canonicalAnswer` semantics;
* establish prompt semantics;
* establish randomization or weighting;
* establish difficulty bands;
* authorize production implementation;
* modify `AUTHORIZED_FAMILIES`;
* modify grade authorization;
* freeze the Senior Phase Generation Policy;
* make the Generation Policy Accepted.

The current implementation ranges and uniform 25% form selection remain
implementation-observed only.

---

## 5. Acceptance Act

This document is ACCEPTED by **Xolani Tshabalala, Project Owner**, under
ADR-023 §4.

The accepted decision is:

> **CY59-PO-01 = B — `powersRootsFluency` consists of two paired
> sub-constructs: square + square root, and cube + cube root.**

The Project Owner explicitly accepts the consequences and non-actions stated
above.

This acceptance is a Project Owner governance act. It is not an AI
recommendation or AI-held authority.

**Project Owner:** Xolani Tshabalala
**Acceptance date:** 2026-09-05

---

*End of Decision Act. ACCEPTED under ADR-023 by Project Owner Xolani Tshabalala
on 2026-09-05.*
