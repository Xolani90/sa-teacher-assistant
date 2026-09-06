# CY68-PO-01 — Project Owner Decision Act (DRAFT)

**STATUS: PROPOSED — NOT ACCEPTED**

**Prepared for:** Xolani Tshabalala, Project Owner
**Prepared by:** AI session, Cycle 68 (autonomous governance audit)
**Depends on:** ADR-023 (Accepted, bootstrap commit `580fa45`)

> This document has NOT been accepted. No Project Owner acceptance,
> freeze, or authorization act has occurred by virtue of this file's
> existence or its commit. Preparing this draft is not itself a
> governance act under ADR-023 §4 — it lacks the required Project
> Owner attribution and explicit acceptance statement. Only the
> Project Owner, acting explicitly and outside any AI session, may
> convert this into a real Decision Act by editing the Status field
> above to `ACCEPTED`, adding their own attribution and acceptance
> date, and recording that change in its own dedicated commit per
> ADR-023 §5/§7.

---

## 1. Decision Subject

`docs/specs/mental-maths/Senior_Phase_Generation_Policy_v1_0_PROPOSED.md`
("Generation Policy v1.0"). Its content was last reconciled through
commit `8867602f16407e7b14aca0a6ebdce18c6dfdf38b` (Cycle 66); this
Decision Act draft was itself prepared and committed during Cycle 68,
whose resulting repository baseline is `29002d8dad076fe5d6af6d6dacd343bf75bd9e50`.
Neither commit changed the policy's Status, which remains:
`PROPOSED FRAMEWORK — NOT YET FROZEN — NOT IMPLEMENTATION-AUTHORITATIVE`.

## 2. Decision Requested

Whether the Project Owner accepts Generation Policy v1.0 **as
governance methodology** — i.e., accepts:

- the candidate taxonomy consolidation in §1 (seven table rows,
  covering six distinct generation-specification candidates —
  `estimation`, `roundingOffAndCompensating`, `multiplicationFactFluency`,
  `ratioSharing`, `powersRootsFluency` [counted twice, once per
  domain: integer and rational], and `ratioRate`; `mulDivFluency` is
  separately accepted as the umbrella/family containing
  `multiplicationFactFluency` as its governed sub-construct — CY54-PO-01,
  CY56-PO-01 — but has no independent row in §1 and no independent
  generation authority of its own, per policy §7),
- the grade-authorization table in §2,
- the six-condition generation-eligibility gate proposed in §4,
- the ten-point Policy Completeness Review proposed in §10, and
- the freeze-prerequisite mechanics proposed in §9

as the accepted framework governing how any future candidate-specific
generation specification will be evaluated and, eventually, frozen
under ADR-023 §6.

This is **not** a request to perform an ADR-023 §6 freeze act for any
candidate's generation specification. No candidate has one yet (see
§4 below).

## 3. What Acceptance Would Establish

If the Project Owner accepts this policy under ADR-023 §5:

- The document's Status field changes from `PROPOSED` to `ACCEPTED`
  as governance methodology.
- The six-condition generation-eligibility gate, the ten-point
  Completeness Review, and the freeze-prerequisite sequence in §9
  become the accepted procedure for any future generation
  specification work in this domain, rather than a proposal awaiting
  review.
- Future generation-specification drafting for `ratioRate`,
  `ratioSharing`, `powersRootsFluency`, `multiplicationFactFluency`,
  `estimation`, or `roundingOffAndCompensating` would be evaluated
  against this accepted methodology rather than an as-yet-unreviewed
  one.

## 4. What Acceptance Would NOT Establish

Acceptance of this policy as methodology would **not**, by itself or
by implication, establish any of the following. Each remains
unresolved and would require its own separate, later Project Owner
decision:

- `ratioRate` item forms, numeric/operand ranges, generation
  constraints, exclusions, exactness rules, or `canonicalAnswer`
  semantics.
- `ratioRate` prompt wording, randomization, or difficulty bands.
- Generation eligibility for `ratioRate`, `ratioSharing`,
  `powersRootsFluency` (either domain), or `multiplicationFactFluency`.
- `ratioSharing`'s G9 status (currently "not authorized / unresolved").
- The `ratioSharing`↔`ratioRate` pedagogical-justification question
  (candidate *identity* is already separately resolved — CY59-PO-02 —
  but whether the original split was ever justified is not).
- `mulDivFluency`'s CY54-PO-02 inverse-operation-ownership question
  (recorded as unresolved).
- The `addSub`↔`mulDivFluency` boundary decision (`b6dba51`,
  proposed, not frozen).
- Whether the "generation-eligibility gate" or "scope-authorized but
  generation-ineligible" state become formally recognized ADR-022
  lifecycle concepts (§10 item 10 of the policy; an open, separately
  deferred question).
- Any resolver/dispatch implementation, test, or production code
  change of any kind.
- Any `AUTHORIZED_FAMILIES` or `FAMILY_GRADE_AUTHORIZATION` change.

## 5. Known Unresolved Matters (carried forward, not resolved by this Decision Act)

- `ratioSharing` G9 — unresolved, pending further evidence or a
  future framework pass.
- `ratioSharing`↔`ratioRate` pedagogical-justification question — open.
- CY54-PO-02 (`mulDivFluency` inverse-operation ownership) — unresolved.
- `addSub`↔`mulDivFluency` boundary — proposed, not frozen.
- Generation-eligibility gate's ADR-022 lifecycle status — deferred.
- All six generation-eligibility conditions (policy §4) — unsatisfied
  for every candidate.
- Policy Completeness Review (policy §10), per the Cycle 67 audit:
  items 1 (item forms), 2 (numeric/operand ranges), 3 (rational-domain
  generation spec), 7 (ratioSharing↔ratioRate pedagogical justification,
  partial), 8 (ratioSharing G9 status), and 10 (whether the
  generation-eligibility gate becomes an ADR-022-recognized lifecycle
  concept) remain genuinely open. Item 5 (resolver/dispatch
  implications) is not analyzed by this policy and is an
  implementation-layer concern, not a blocker to this policy's own
  readiness for review. Item 4 (difficulty bands) is not applicable —
  explicitly out of scope per ADR-022 §5 Governance Rule 3. Item 6
  (the §7 excluded-candidates table) was found complete as a
  documentation matter as of Cycle 67. Item 9 (ADR-023's own stale §1
  body text) is an unrelated mechanical ADR-023 issue, not a defect in
  this policy. None of items 4, 5, 6, or 9 block Project Owner review
  of this policy as methodology.

## 6. Evidence / Provenance

This draft rests only on already-committed repository state:

- Generation Policy v1.0, as committed and reconciled through CY66
  (`8867602`).
- ADR-023 — Accepted, bootstrap commit `580fa45`.
- ADR-022 — Accepted, `b528f73`.
- CY54-PO-01/02 — Accepted, `ca23918`.
- CY56-PO-01 — Accepted, `dda9db0`.
- CY59-PO-01 — Accepted, `a8b35e9`.
- CY59-PO-02 — Accepted, `a8b35e9` (`a8b35e97` per policy citation).
- CY62-PO-01 — Accepted, `e2c0c8c`.

No new evidence, CAPS citation, or governance judgment is introduced
by this draft. It restates and bounds an existing proposal; it
resolves nothing.

## 7. Governance Safety Statement

- This document does not itself accept, freeze, or authorize anything.
- No AI session holds Project Owner authority (ADR-023 §3.2).
- The Status field above must remain `PROPOSED — NOT ACCEPTED` until
  the Project Owner personally edits it and records that edit in a
  dedicated commit per ADR-023 §4/§5/§7.
- Committing this file is an ordinary documentation commit, not a
  Decision Act — it does not meet ADR-023 §4's four requirements
  (named artifact, explicit act statement, Project Owner attribution,
  distinct commit performing the act), since no acceptance is being
  stated here, only a request prepared for future review.

---

*End of draft. PROPOSED — NOT ACCEPTED. Prepared for Project Owner
review only.*
