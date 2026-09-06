# CY68-PO-01 — Project Owner Decision Act

**STATUS: ACCEPTED — GOVERNANCE METHODOLOGY ONLY**

**Prepared for:** Xolani Tshabalala, Project Owner
**Prepared by:** AI session, Cycle 68 (autonomous governance audit)
**Accepted by:** Xolani Tshabalala, Project Owner
**Acceptance date:** 2026-09-06
**Depends on:** ADR-023 (Accepted, bootstrap commit `580fa45`)

> I, Xolani Tshabalala, Project Owner, hereby ACCEPT Generation Policy
> v1.0 as governance methodology only, within the scope defined in §2
> of this Decision Act and pursuant to ADR-023 §5.
>
> This acceptance establishes the Generation Policy's candidate
> taxonomy, grade-authorization framework, six-condition
> generation-eligibility gate, ten-point Policy Completeness Review,
> and freeze-prerequisite mechanics as the governing methodology for
> future candidate-specific generation-specification review.
>
> This acceptance does NOT authorize or establish any candidate-specific
> generation specification, generation eligibility, generation
> parameters, item forms, numeric/operand ranges, canonicalAnswer
> semantics, prompts, randomization, difficulty bands, resolver/dispatch
> implementation, tests, or production implementation.
>
> All unresolved matters identified in §4 and §5 remain unresolved and
> require their own subsequent governance decisions where applicable.

---

## 1. Decision Subject

`docs/specs/mental-maths/Senior_Phase_Generation_Policy_v1_0_PROPOSED.md`
("Generation Policy v1.0").

The policy was reconciled through Cycle 66 at policy-reconciliation
commit `8867602f16407e7b14aca0a6ebdce18c6dfdf38b`. The Cycle 68
repository baseline was subsequently advanced to `29002d8` and then,
after this Decision Act correction pass, to the current repository
baseline `7fec7749481ced0ca864fc55039822fcc8108195`.

Neither the Cycle 66 policy-reconciliation commit nor the Cycle 68
documentation commits changed the policy's substantive proposed status
prior to this acceptance act.

Before this Decision Act, the Generation Policy status was:

`PROPOSED FRAMEWORK — NOT YET FROZEN — NOT IMPLEMENTATION-AUTHORITATIVE`

This Decision Act accepts that policy **as governance methodology only**,
within the explicit scope and limitations recorded below.

---

## 2. Decision Accepted

The Project Owner accepts Generation Policy v1.0 **as governance
methodology** — specifically:

* the candidate taxonomy consolidation established in Generation Policy v1.0 §1;
* the grade-authorization framework in §2;
* the six-condition generation-eligibility gate proposed in §4;
* the ten-point Policy Completeness Review proposed in §10; and
* the freeze-prerequisite mechanics proposed in §9.

The policy's §2 representation contains seven authorization-table rows
covering six candidate-level generation-specification candidates,
because `powersRootsFluency` is represented separately by domain.
`mulDivFluency` remains an accepted umbrella/family rather than an
independently authorized generation-specification candidate, consistent
with CY54-PO-01 and CY56-PO-01.

This acceptance establishes those mechanisms as the accepted
methodology governing how future candidate-specific generation
specifications are to be evaluated and, where all applicable
requirements are subsequently satisfied, separately frozen under
ADR-023.

This acceptance does **not** itself freeze any candidate-specific
generation specification.

---

## 3. What This Acceptance Establishes

By accepting this policy under ADR-023 §5, the Project Owner establishes:

* the policy's candidate taxonomy as the accepted governance framework;
* the grade-authorization framework as the accepted scope framework;
* the six-condition generation-eligibility gate as the required
  future procedure for determining whether a candidate-specific
  generation specification is eligible to proceed toward freeze;
* the ten-point Policy Completeness Review as the required review
  procedure;
* the freeze-prerequisite sequence in §9 as the accepted methodology
  for future candidate-specific generation-specification work.

Future generation-specification drafting for:

* `ratioRate`;
* `ratioSharing`;
* `powersRootsFluency`;
* `multiplicationFactFluency`;
* `estimation`; and
* `roundingOffAndCompensating`

must be evaluated against this accepted methodology.

`mulDivFluency` remains governed as an accepted umbrella/family under
CY54-PO-01 and CY56-PO-01. This acceptance does not create independent
generation authority for that umbrella.

Acceptance of the methodology does not mean that any candidate has
satisfied the generation-eligibility gate.

---

## 4. What This Acceptance Does NOT Establish

This acceptance does **not**, by itself or by implication, establish
any of the following:

* `ratioRate` item forms;
* `ratioRate` numeric or operand ranges;
* `ratioRate` generation constraints;
* `ratioRate` exclusions;
* `ratioRate` exactness rules;
* `ratioRate` `canonicalAnswer` semantics;
* `ratioRate` prompt wording;
* `ratioRate` randomization;
* `ratioRate` difficulty bands;
* generation eligibility for `ratioRate`;
* generation eligibility for `ratioSharing`;
* generation eligibility for `powersRootsFluency` in either domain;
* generation eligibility for `multiplicationFactFluency`;
* generation eligibility for `estimation`;
* generation eligibility for `roundingOffAndCompensating`;
* generation eligibility for `mulDivFluency`;
* `ratioSharing`'s G9 status;
* the `ratioSharing` ↔ `ratioRate` pedagogical-justification question;
* CY54-PO-02 (`mulDivFluency` inverse-operation ownership);
* the `addSub` ↔ `mulDivFluency` boundary decision;
* any candidate-specific generation specification;
* any candidate-specific generation parameters;
* any candidate-specific rational-domain generation specification;
* any candidate-specific canonical-answer contract;
* any candidate-specific difficulty specification;
* any resolver or dispatch implementation;
* any test implementation;
* any production implementation;
* any `AUTHORIZED_FAMILIES` change;
* any `FAMILY_GRADE_AUTHORIZATION` change;
* any amendment to ADR-022;
* any amendment to ADR-023.

The accepted generation-eligibility gate is a **governance procedure**.
It is not itself a grant of generation eligibility.

---

## 5. Known Unresolved Matters

The following matters remain unresolved after this acceptance and
retain their existing governance status:

* `ratioSharing` G9 — unresolved, pending further evidence or a future
  governance decision;
* `ratioSharing` ↔ `ratioRate` pedagogical justification — remains open;
* CY54-PO-02 (`mulDivFluency` inverse-operation ownership) — unresolved;
* `addSub` ↔ `mulDivFluency` boundary — proposed, not frozen;
* the ADR-022 lifecycle status of the generation-eligibility gate —
  deferred;
* candidate-specific item forms — not yet established;
* candidate-specific numeric/operand ranges — not yet established;
* candidate-specific rational-domain generation specifications — not yet
  established;
* candidate-specific generation constraints and exclusions — not yet
  established;
* candidate-specific generation eligibility — not established.

The Cycle 67 Policy Completeness Review disposition remains:

* Item 1 — item forms: open;
* Item 2 — numeric/operand ranges: open;
* Item 3 — rational-domain generation specification: open;
* Item 4 — difficulty bands: not an applicable policy blocker under the
  existing ADR-022 scope;
* Item 5 — resolver/dispatch implications: implementation-layer concern,
  not a current methodology blocker;
* Item 6 — excluded-candidate table: complete;
* Item 7 — `ratioSharing` ↔ `ratioRate` pedagogical justification:
  partially resolved/open;
* Item 8 — `ratioSharing` G9 status: open;
* Item 9 — ADR-023 stale §1 clarification: not an outstanding blocker;
* Item 10 — whether the generation-eligibility gate should become an
  ADR-022-recognized lifecycle concept: deferred.

Acceptance of this policy does not resolve any of these outstanding
candidate-specific or lifecycle questions.

---

## 6. Evidence / Provenance

This Decision Act relies on already-committed repository governance
state and the preceding Cycle 68 review/correction work:

* Generation Policy v1.0, reconciled through Cycle 66 at
  `8867602f16407e7b14aca0a6ebdce18c6dfdf38b`;
* Cycle 68 review baseline `29002d8`;
* Cycle 68 Decision Act correction baseline `7fec7749481ced0ca864fc55039822fcc8108195`;
* ADR-023 — Accepted, bootstrap commit `580fa45`;
* ADR-022 — Accepted, `b528f73`;
* CY54-PO-01 — Accepted, `ca23918`;
* CY54-PO-02 — Unresolved;
* CY56-PO-01 — Accepted, `dda9db0`;
* CY59-PO-01 — Accepted, `a8b35e9`;
* CY59-PO-02 — Accepted, `a8b35e9`;
* CY62-PO-01 — Accepted, `e2c0c8c`.

This Decision Act does not introduce new CAPS evidence or establish
new candidate-specific curricular claims.

The acceptance is a governance act concerning the methodology only.

---

## 7. Governance Boundary

This acceptance is deliberately limited.

The Project Owner accepts Generation Policy v1.0 as a **governance
methodology**.

It does not constitute:

* acceptance of a candidate-specific generation specification;
* generation eligibility;
* implementation authorization;
* production deployment authorization;
* resolver/dispatch authorization;
* test authorization;
* amendment of ADR-022;
* amendment of ADR-023.

No candidate-specific generation work may be treated as authorized
merely because this methodology has been accepted.

Any later candidate-specific generation specification must independently
satisfy the accepted methodology and any applicable Project Owner
decision and freeze requirements before it can become authoritative.

---

## 8. Project Owner Authority

This Decision Act records an explicit acceptance by:

**Xolani Tshabalala, Project Owner**

The acceptance is made pursuant to ADR-023 §5.

The acceptance is intentionally confined to the governance methodology
identified in §2.

No AI session is exercising Project Owner authority by preparing or
describing this document. The acceptance recorded above is the
Project Owner's explicit governance act.

---

## 9. Freeze-Prerequisite Boundary

Acceptance of Generation Policy v1.0 does not itself constitute an
ADR-023 §6 freeze of any candidate-specific generation specification.

For any future candidate-specific generation specification, the
accepted Generation Policy methodology must first be applied,
including the applicable:

1. item-form definition;
2. numeric/operand-domain evidence;
3. rational-domain generation specification where applicable;
4. difficulty treatment where applicable;
5. resolver/dispatch implications as an implementation concern;
6. exclusion analysis;
7. Policy Completeness Review;
8. applicable candidate-scope and taxonomy decisions; and
9. ADR-023 acceptance/freeze requirements.

A future candidate-specific freeze must be a separate governance act
with its own explicit scope and Project Owner attribution.

---

## 10. Policy Completeness Review Status at Acceptance

The ten-point Policy Completeness Review is accepted as methodology,
but acceptance does not require every future candidate-specific
generation specification to be considered complete at this moment.

The current policy-level disposition remains:

| Review item                                           | Current status                                               |
| ----------------------------------------------------- | ------------------------------------------------------------ |
| 1. Item forms                                         | Open                                                         |
| 2. Numeric/operand ranges                             | Open                                                         |
| 3. Rational-domain generation specification           | Open                                                         |
| 4. Difficulty bands                                   | Not an applicable policy blocker under current ADR-022 scope |
| 5. Resolver/dispatch implications                     | Implementation-layer concern                                 |
| 6. Excluded-candidate table                           | Complete                                                     |
| 7. ratioSharing ↔ ratioRate pedagogical justification | Partial / open                                               |
| 8. ratioSharing G9 status                             | Open                                                         |
| 9. ADR-023 stale §1 clarification                     | No outstanding blocker                                       |
| 10. ADR-022 lifecycle recognition of generation gate  | Deferred                                                     |

These statuses do not grant generation authority.

They identify the matters that must be addressed through the appropriate
future governance process.

---

## 11. Explicit Non-Authorization of Implementation

Nothing in this Decision Act authorizes modification of:

* `AUTHORIZED_FAMILIES`;
* `FAMILY_GRADE_AUTHORIZATION`;
* resolver logic;
* dispatch logic;
* generation services;
* question generators;
* prompt builders;
* canonical-answer logic;
* difficulty logic;
* persistence logic;
* production code;
* automated tests.

No implementation should rely on this Decision Act as an implementation
authorization.

---

## 12. Decision Act Record

**Decision:** ACCEPTED

**Scope:** Generation Policy v1.0 as governance methodology only.

**Project Owner:** Xolani Tshabalala

**Acceptance date:** 2026-09-06

**Generation specification frozen:** NO

**Candidate generation eligibility granted:** NO

**Production implementation authorized:** NO

**ADR-022 amended:** NO

**ADR-023 amended:** NO

**Next candidate-specific governance decision:** Separate future act
required.

---

*End of CY68-PO-01 Decision Act.*

*Accepted by the Project Owner as governance methodology only.
No candidate-specific generation specification, generation eligibility,
or implementation authority is established by this act.*
