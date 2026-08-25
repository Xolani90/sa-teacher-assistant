# Senior Phase Taxonomy Decision Record: addSub ↔ mulDivFluency Inverse-Operations Boundary

> **PROPOSED DECISION RECORD — NOT YET FROZEN.**
> This document records a Project Owner scope decision under the
> Senior Phase Scope Resolution Framework (accepted as methodology
> under ADR-023 §5, commit `19255ba`) and ADR-023 (accepted, commit
> `580fa45`). It does not constitute a taxonomy freeze. Per ADR-023
> §6, freezing requires its own separate, explicit freeze act, in its
> own dedicated commit, after review of this record. This document
> authorizes no implementation, no Generation Policy, no code,
> candidate-ID, or `AUTHORIZED_FAMILIES` change, and no file rename.

## 1. Evidence basis

Traceable to:
- `addSub_Evidence_Review_Checkpoint.md` — first-hand CAPS extraction,
  G7/G8 named-and-worked evidence for "addition and subtraction as
  inverse operations," item (e) of the Section 2 "Properties of whole
  numbers" clarification-notes list.
- `mulDivFluency_Scope_Decision_Review.md` — first-hand CAPS
  verification of "inverse operation between multiplication and
  division," item (f) of the same list, named-and-worked at G7.
- Both documents independently confirm the two properties are
  evidenced from the **same CAPS clarification-notes list**, at the
  same grades, in adjacent lettered items — not from independently
  sourced material.
- The same list contains **seven sibling properties** in total:
  commutative, associative, and distributive properties; addition/
  subtraction as inverse operations; multiplication/division as
  inverse operations; 0 as additive identity; 1 as multiplicative
  identity. Only the two inverse-operation properties currently
  correspond to any named candidate in this project.
- `mulDivFluency`'s multiplication-fact-fluency sub-construct ("at
  least 12×12") is evidenced from a **separate** CAPS bullet, under
  the "Mental calculations" heading — not part of the Properties of
  whole numbers list, and not implicated in this overlap.

## 2. Framework provisions applied

- **§2 (candidate definition)** — evidentiary coherence and generation
  coherence, not co-location, are the tests for whether material
  constitutes one candidate.
- **§3 (CAPS headings ≠ generation units)** — the seven-property
  list's single heading neither requires bundling all seven, nor does
  the two-bullet Mental-calculations structure require splitting
  fact-fluency from inverse-operations.
- **§6 (shared-sentence overlap)** — this is a mandatory
  boundary-resolution flag. Per the framework's own text, this is
  "not a default toward merging" — it establishes only that the
  boundary is unresolved and requires explicit treatment.
- **§7 (legacy implementation firewall)** — the existing
  `mulDivFluency` bundle and the `addSub` name carry no evidentiary
  weight in this decision.
- **§9 (OPEN criteria)** — evidence tier uneven without a stated CAPS
  reason, and no CAPS/governance statement affirmatively supporting a
  specific bundle/split outcome, are both conditions that keep the
  five unnamed sibling properties outside this decision (see §6
  below).
- **§10 (resolution outcomes)** — this record resolves the
  addSub/mulDivFluency inverse-operations question only; it does not
  assign an outcome, OPEN or DEFERRED, to the five sibling properties.
- **§12 (evidence-derived conclusion vs. governance judgment)** —
  applied throughout this record; see §4.

## 3. Options considered

1. **Keep `addSub` and `mulDivFluency` fully separate, as currently
   named.** Rejected: `addSub`'s own scope-decision review already
   established that its current boundary, defined only by legacy
   generator naming, does not correspond to any actual CAPS-named
   unit. Preserving the status quo would tacitly ratify an
   unevidenced boundary rather than remain neutral.
2. **Merge the two inverse-operation properties into a single
   inverse-operations candidate; leave multiplication-fact fluency
   in `mulDivFluency`, untouched.** Adopted — see §4–§5.
3. **Reframe under a full "Properties of whole numbers" candidate**,
   absorbing all seven sibling properties. Rejected at this time:
   five of the seven properties have no evidence review performed
   anywhere in this repository. Deciding their taxonomy placement now
   would mean deciding on evidence that does not yet exist, contrary
   to §9's OPEN criteria.
4. **Any other boundary.** No alternative was identified in the
   evidence review that was not a variant of (2) or (3).

## 4. Project Owner judgment

The evidence and the framework's methodology **narrow the defensible
options; they do not uniquely determine the taxonomy boundary.** CAPS
does not state that the two inverse-operation properties must be
treated as one candidate, nor does it state they must remain two. The
shared-sentence overlap (§6) establishes only that the question is
live and requires explicit resolution — the framework is explicit
that this is not a default toward merging.

Xolani Tshabalala, acting as the Project Owner established by
ADR-023, therefore exercises governance judgment to merge the two
inverse-operation constructs into a single candidate, for the
following stated reasons: both properties share the same CAPS source
list and item-adjacency; both follow the identical "if X, then Y and
Z" worked-example structure at G7; and the Project Owner judges that
an inverse-operations item family, irrespective of which two
operations instantiate it, constitutes a sufficiently coherent
generation-eligible practice target under §2(b) — a judgment call the
evidence permits but does not compel.

This judgment is recorded as governance judgment, not as a
CAPS-derived conclusion, per §12.

## 5. Proposed scope outcome

The proposed scope outcome is a single **inverse-operations**
candidate, comprising: addition/subtraction as inverse operations
(G7/G8 named-and-worked, G9 general continuity only), and
multiplication/division as inverse operations (G7 named-and-worked,
G8 unverified-but-consistent, G9 general continuity only).

- **Multiplication-fact fluency** ("at least 12×12") remains a
  separate matter, unaffected by this decision. It was never party to
  the shared-sentence overlap and has no relationship to `addSub`.
- This is a **proposed scope boundary only** — recorded, not yet
  effective. It does not itself rename any candidate ID, file, or
  `AUTHORIZED_FAMILIES` entry, and does not itself constitute the
  taxonomy freeze (§7). The taxonomy remains as currently recorded
  until the subsequent freeze/taxonomy-update act.

## 6. The five sibling properties are not resolved by this decision

The five remaining sibling properties in the Properties of whole
numbers list — commutative, associative, and distributive properties,
and the two identity-element properties — are **not resolved by this
decision**. They remain outside the current candidate decision and
require a dedicated evidence review and subsequent scope decision
before any taxonomy placement is determined. **No OPEN or DEFERRED
status is assigned or changed by this record.**

Whether these five properties should later be recorded as C — OPEN,
D — DEFERRED, or otherwise, per framework §10, is left to a
separate, explicitly stated Project Owner judgment, made as its own
decision with its own rationale — not implied or smuggled into this
addSub/mulDivFluency record.

## 7. Explicit non-freeze statement

This decision record is **not a freeze**. Per ADR-023 §6, a taxonomy
decision becomes frozen only when the Project Owner records a
separate, explicit freeze act, in its own dedicated commit, following
review of this record. Until that freeze act occurs, this document
represents a **proposed taxonomy outcome**, per the framework's §13,
not an authorized or binding one.

## 8. Rejected alternatives and reasons

See §3. Summarized: Option 1 rejected as an unevidenced status quo;
Option 3 rejected as premature given no evidence review exists for
the five unnamed properties; Option 4 identified no distinct
alternative.

## 9. Traceability

- `addSub_Evidence_Review_Checkpoint.md`
- `addSub_Scope_Decision_Review.md`
- `mulDivFluency_Scope_Decision_Review.md`
- `Senior_Phase_Scope_Resolution_Framework__PROPOSED.md` — accepted as
  methodology under ADR-023 §5, commit `19255ba`. (Filename retains
  its original `__PROPOSED` suffix; renaming it is a separate,
  deliberately deferred documentation act, not performed by this
  record.)
- ADR-023 — accepted, commit `580fa45`.

## 10. Explicit non-actions

This document does not: rename `addSub`, `mulDivFluency`, or any
candidate ID; modify `AUTHORIZED_FAMILIES` or any implementation
code; modify `Senior_Taxonomy_v1.0_Working_Skeleton.md` or
`ADR-INDEX.md`; assign or change any OPEN/DEFERRED status for the
five sibling properties; create any Generation Policy; authorize any
implementation, test, or code change; or freeze any taxonomy status.
The sequence from here remains: this decision record → review →
explicit Project Owner freeze act (separate commit) → taxonomy/
`AUTHORIZED_FAMILIES` update → Generation Policy → implementation.

---

*End of decision record. Proposed scope outcome recorded for the
addSub ↔ mulDivFluency inverse-operations overlap. Five sibling
properties left unresolved and unstatused by this record. Not frozen.
No implementation, taxonomy-ID, file-rename, or code changes made or
authorized by this document.*
