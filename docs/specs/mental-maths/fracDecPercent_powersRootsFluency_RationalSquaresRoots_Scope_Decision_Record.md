# Senior Phase Taxonomy Decision Record: fracDecPercent ↔ powersRootsFluency Rational-Number Squares/Roots Overlap

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
- `powersRootsFluency_Evidence_Review_Checkpoint.md` and
  `powersRootsFluency_Scope_Decision_Review__RECONSTRUCTION.md` —
  named-and-worked evidence for squares/cubes and their roots at G7
  (integer base), extended to rational numbers at G8 (e.g.
  "(0,7)²=0,49").
- `fracDecPercent_Evidence_Review_Checkpoint.md` and
  `fracDecPercent_Deeper_Evidence_Review_Checkpoint.md` — G8/G9
  "squares, cubes, square roots and cube roots of common fractions"
  (named, unworked in the pages sampled) and, independently, "squares,
  cubes, square roots and cube roots of decimal fractions" (named
  **and worked** at G8: `(0,4)²=0,16`, `(0,1)³=0,001`, `√0,04=0,2`;
  unworked at G9).
- CAPS presents squares, cubes and roots as a continuing Exponents
  strand and extends the number domain to rationals at G8. This
  supports, but does not compel, treating the rational-number forms
  as extensions of the same generation construct.
- Worked-example inspection (this session, read-only) found that
  fraction squares/roots and decimal squares/roots are demonstrated
  via different procedural techniques in CAPS's own worked examples —
  numerator/denominator decomposition for fractions
  (e.g. `√(9/16)=√9/√16=3/4`), place-value scaling for decimals
  (e.g. `√0,04=0,2`) — but this procedural difference was tested
  against learner objective, error model, and generation-policy
  consequence (§4) and found not to change the underlying practice
  target.

## 2. Framework provisions applied

- **§2(a) (evidentiary coherence)** — both representations are
  independently named and, at least for decimals, worked at G8 under
  the same underlying operation (square/cube/root), applied to a
  rational-number input.
- **§2(b) (generation coherence)** — the decisive test: whether items
  generated across both representations would represent the same
  underlying practice target, "even where item forms or numerical
  representations vary." Applied via the generation-target analysis
  in §4.
- **§3 (CAPS structure ≠ generation unit)** — the fact that CAPS
  places fraction/decimal material under Section 2 topics 1.4/1.5,
  separate from 1.2 Exponents, is evidence, not a decisive rule. It
  does not by itself require excluding the rational-number extension
  from `powersRootsFluency`, nor does the Exponents continuity
  language by itself require including it.
- **§6 (shared-mechanism-family overlap)** — this overlap is
  different CAPS material (fracDecPercent's fraction/decimal topics)
  evidencing the same underlying mechanism (squares/cubes/roots)
  applied to different number types, as distinct from a
  shared-sentence overlap. Per §6, the framework does not default
  toward either merging or a stated "extends to" relationship for
  this overlap type — explicit analysis of generation-relevance is
  required before resolution, per §11's mandatory joint sequencing.
- **§7 (legacy implementation firewall)** — no existing code,
  generator, or candidate naming was used as evidence in this
  decision.
- **§9/§10 (evidence sufficiency / resolution outcomes)** — the
  generation-target analysis in §4 is treated as sufficient to
  support a proposed decision (§8's middle threshold), though not
  sufficient to freeze (§8's third threshold, which additionally
  requires the ADR-023 freeze act).
- **§12 (evidence-derived conclusion vs. governance judgment)** —
  applied throughout; see §5.

## 3. Options considered

1. **Merge the overlapping rational-number squares/cubes/roots
   material into `powersRootsFluency`**, as a within-candidate
   representation variation rather than a separate candidate.
   Adopted — see §5.
2. **Keep the material with `fracDecPercent`**, treating rational
   squares/roots as native to the fraction/decimal topics rather than
   exported to `powersRootsFluency`. Considered and rejected — see
   §4/§7.
3. **Treat it as a stated "extends to" relationship** between two
   still-separate candidates, without merging. Considered: the
   framework names this as a live option under §6, but once the §4
   analysis establishes sufficient generation coherence for a single
   candidate, retaining two candidates connected only by an
   "extends to" relationship introduces a taxonomy boundary without
   an identified generation-policy consequence. Rejected as
   unnecessary once §4's analysis supported a single-candidate
   outcome.
4. **Split further, by representation** (a "square common fractions"
   candidate distinct from a "square decimals" candidate, potentially
   independent of both `fracDecPercent` and `powersRootsFluency`).
   Considered and rejected — the generation-target analysis in §4
   found no eligibility, difficulty-tier, progression, or assessment
   difference between the two representations, only an
   implementation-level procedural and item-authoring difference.

## 4. Generation-target analysis (§2(b) applied)

Eight representative items were analyzed across both operations
(square/cube) and both roots, in both representations:
`(3/4)²`, `0,75²`, `√(9/16)`, `√0,5625`, `(2/3)³`, `0,8³`,
`∛(8/27)`, `∛0,512`.

- **Learner objective:** the same mathematical capability — apply an
  exponent/root operation to a rational number and interpret the
  result — across both representations. No separate CAPS learning
  objective distinguishing decimal-form from common-fraction-form
  squares/cubes/roots was identified in the reviewed material.
- **Error model:** representation-specific error *surfaces*
  (asymmetric numerator/denominator treatment for fractions;
  decimal-point mistracking for decimals) were found to express the
  same underlying misconception category — incomplete or incorrect
  propagation of the operation across the full value — rather than
  distinct misconception categories.
- **Generation policy consequence:** no meaningful difference found
  in eligibility (both become relevant at G8 under the same
  continuity statement), progression (no CAPS evidence one
  representation gates or precedes the other), or assessment
  criteria (no evidence a teacher would grade these as different
  skills). One asymmetry was found in item-authoring difficulty
  specifically — decimal perfect-powers are less visually
  recognizable than fraction perfect-powers — but this affects
  difficulty calibration and item-construction constraints, not
  eligibility or the definition of the skill being assessed.

**Classification: same practice target, different representation.**
This is the basis for §5's judgment, distinguished from the CAPS
evidence itself per §12.

## 5. Project Owner judgment

CAPS evidence (§1) establishes that squares/cubes/roots are evidenced
across both integer and rational-number inputs, and that the
fraction/decimal representations of the rational extension are
procedurally distinct in their worked-example technique. It does not
by itself establish where the taxonomy boundary should sit — that is
a governance judgment, informed but not compelled by the generation-
target analysis in §4.

Xolani Tshabalala, acting as the Project Owner established by
ADR-023, exercises governance judgment that the rational-number
squares/cubes/roots material — in both its common-fraction and
decimal-fraction forms — should be treated as one generation-eligible
practice target within `powersRootsFluency`'s scope, rather than
being treated as native to `fracDecPercent` or split into
representation-specific candidates. This judgment rests on the §4
finding that the procedural differences between representations do
not propagate into eligibility, progression, or assessment
consequences — the dimensions the framework treats as defining a
taxonomy boundary — and rests explicitly on that finding rather than
on the weaker observation that "they are both rational-number forms
of the same operation."

This judgment is recorded as governance judgment, not as a
CAPS-derived conclusion, per §12.

## 6. Proposed scope outcome

- **`powersRootsFluency`** retains, as a proposed matter, the
  squares/cubes/square-roots/cube-roots construct across its
  evidenced number domains, **including** the rational-number forms
  identified in §1, for both common-fraction and decimal-fraction
  representations. (This decision does not otherwise redefine
  `powersRootsFluency`'s broader scope, including any exponential-
  notation, laws-of-exponents, or scientific-notation material
  identified elsewhere in its evidence review.)
- **`fracDecPercent`** retains its own fraction/decimal/percentage
  material, **except** for the overlapping squares/cubes/roots
  material, which is proposed to be excluded from its eventual
  boundary and treated as belonging to `powersRootsFluency` instead.
- **Common-fraction and decimal-fraction forms are not split into
  separate taxonomy candidates.** Both remain representations within
  the single rational-number extension of `powersRootsFluency`.
- This decision does **not** imply that all fraction/decimal
  calculations belong to `powersRootsFluency` — only the specific
  overlapping squares/cubes/square-root/cube-root material identified
  in §1. `fracDecPercent`'s Calculations with Fractions, Percentages,
  and Decimal Fractions sub-topics otherwise remain unaffected and
  unresolved by this record (their own internal scope question, per
  `fracDecPercent_Scope_Decision_Review.md`, remains separately OPEN).
- This decision does **not** decide or imply any broader restructuring
  of `fracDecPercent` beyond excluding the specific overlapping
  material.
- This is a **proposed scope boundary only** — recorded, not yet
  effective. It does not itself rename any candidate ID, file, or
  `AUTHORIZED_FAMILIES` entry, and does not itself constitute the
  taxonomy freeze (§8). The taxonomy remains as currently recorded
  until the subsequent freeze/taxonomy-update act.

## 7. Taxonomy boundary vs. generation mechanism — explicitly preserved distinction

This record deliberately separates two different kinds of decision:

- **Proposed taxonomy boundary:** the rational-number
  squares/cubes/roots material, across both fraction and decimal
  representations, constitutes one coherent generation-eligible
  practice target within `powersRootsFluency`.
- **Generation mechanism (not decided here, noted only):** common-
  fraction and decimal-fraction forms may, and per the worked-example
  evidence in §1 and §4 likely will, require distinct internal
  construction algorithms — fraction items via numerator/denominator
  decomposition, decimal items via place-value-pattern construction —
  and decimal items may require additional authoring constraints
  (e.g. restriction to decimals with recognizable perfect-power
  values) given the item-authoring-difficulty asymmetry found in §4.

This distinction is recorded explicitly so that a future
implementation discussion needing two internal generators does not,
by itself, reopen or appear to contradict this taxonomy decision. The
existence of multiple generation mechanisms under one candidate is
consistent with this record, not evidence against it.

## 8. Explicit non-freeze statement

This decision record is **not a freeze**. Per ADR-023 §6, a taxonomy
decision becomes frozen only when the Project Owner records a
separate, explicit freeze act, in its own dedicated commit, following
review of this record. Until that freeze act occurs, this document
represents a **proposed taxonomy outcome**, per the framework's §13,
not an authorized or binding one.

## 9. Rejected alternatives and reasons

See §3. Summarized: Option 2 (native to fracDecPercent) rejected —
the §4 analysis found no eligibility/progression/assessment basis
distinguishing the rational extension from `powersRootsFluency`'s
existing integer-domain scope. Option 3 (extension relationship
between two separate candidates) rejected as an unnecessary
intermediate position once §4 supported a single coherent candidate.
Option 4 (representation-level split) rejected — the only
representation-level difference found was procedural/implementation-
level, not a taxonomy-defining difference under §2(b).

§4 provided sufficient analytical basis for the Project Owner to
judge that a single coherent candidate is preferable; it did not
itself prove that outcome. That distinction is preserved throughout
this section per §12.

## 10. Traceability

- `powersRootsFluency_Evidence_Review_Checkpoint.md`
- `powersRootsFluency_Scope_Decision_Review__RECONSTRUCTION.md`
- `fracDecPercent_Evidence_Review_Checkpoint.md`
- `fracDecPercent_Scope_Decision_Review.md`
- `fracDecPercent_Deeper_Evidence_Review_Checkpoint.md`
- `Senior_Phase_Scope_Resolution_Framework__PROPOSED.md` — accepted as
  methodology under ADR-023 §5, commit `19255ba`.
- ADR-023 — accepted, commit `580fa45`.
- `addSub_mulDivFluency_Scope_Decision_Record.md` — prior decision
  record in this same series, commit `b6dba51` (methodological
  precedent for record structure; no substantive dependency).

## 11. Explicit non-actions

This document does not: rename `fracDecPercent`, `powersRootsFluency`,
or any candidate ID; modify `AUTHORIZED_FAMILIES` or any
implementation code; modify `Senior_Taxonomy_v1.0_Working_Skeleton.md`
or `ADR-INDEX.md`; resolve `fracDecPercent`'s own remaining internal
scope question (Calculations with Fractions / Equivalent Forms /
Percentage Calculation / Decimal Fractions bundling); authorize any
Generation Policy (§7's mechanism note is descriptive, not
authorizing); authorize any implementation, test, or code change; or
freeze any taxonomy status. The sequence from here remains: this
decision record → review → explicit Project Owner freeze act
(separate commit) → taxonomy/`AUTHORIZED_FAMILIES` update →
Generation Policy → implementation.

---

*End of decision record. Proposed scope outcome recorded for the
fracDecPercent ↔ powersRootsFluency rational-number squares/cubes/
roots overlap. Common-fraction and decimal-fraction representations
kept within one taxonomy candidate; generation-mechanism variation
explicitly distinguished from the taxonomy decision itself. Not
frozen. No implementation, taxonomy-ID, file-rename, or code changes
made or authorized by this document.*
