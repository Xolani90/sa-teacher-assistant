# fracDecPercent — Scope-Decision Review

> **NOT TAXONOMY AUTHORITY. NOT AN IMPLEMENTATION AUTHORIZATION.**
> This document extends `fracDecPercent_Evidence_Review_Checkpoint.md`
> with a scope-decision review, following the same method used for
> `mulDivFluency_Scope_Decision_Review.md`, `powersRootsFluency_Scope_
> Decision_Review.md`, `ratioSharing_Scope_Decision_Review.md`, and
> `addSub_Scope_Decision_Review.md`. It assigns no taxonomy status,
> freezes nothing, and creates no Generation Policy or specification.
> It supersedes no existing document.

## Repository baseline at time of this checkpoint

`7356644` on `origin/main`, plus the powersRootsFluency, ratioSharing,
and addSub scope-decision reviews added earlier in this same session.
This checkpoint commit adds no code, taxonomy, or Generation Policy
changes on top of that baseline.

## Evidence boundary in force for this decision

Only `fracDecPercent_Evidence_Review_Checkpoint.md` is treated as
authoritative. That checkpoint established that `fracDecPercent`
spans **three separately-named Section 2 sub-topics**, each with its
own G7/G8/G9 rows:

- **Equivalent forms** (fractions ↔ decimals ↔ percentages) — named-
  and-worked at G7 via the fraction/decimal/percentage equivalence
  table (25%/¼/0,25 etc.); G8/G9 rows present but framed as revision
  of the same G7 mechanism, with no G8/G9-specific worked example
  located in the pages sampled.
- **Percentage calculation** — independently named-and-worked at G7
  via the "Calculate 60% of R105" example. This demonstration and the
  Equivalent Forms table above both occur within the same
  clarification-notes passage, but that is a fact about where in the
  source document they appear, not a fact about which sub-topic's
  mechanism each demonstrates. They are treated here as **two
  distinct worked demonstrations, co-located in one passage**, not one
  demonstration doing double duty for both sub-topics.
- **Calculations with fractions** — named at G7/G8/G9 (G7:
  addition/subtraction/multiplication of common fractions; G8: adds
  division; G9: all four operations, including with surds of
  fractions, which links to `powersRootsFluency`'s G8 rational-number
  extension) but only sampled at the phase-overview level — **named-
  but-unworked**, no clarification-notes worked example reviewed in
  this pass.

Note on decimals specifically: CAPS does not evidence "decimal
fractions" as a freestanding fourth sub-topic in this checkpoint —
decimals appear only as one representation inside Equivalent Forms and
inside Calculations with Fractions' broader scope. No separate
decimal-only worked example or named sub-topic was located. This is
stated as an absence, not as a decision that decimals are subsumed.

**Excluded from this decision:** any existing fracDecPercent-related
code implementation, the unreviewed G8/G9 clarification notes for all
three sub-topics, and numeric range/ceiling questions for any of them.

## The scope question for fracDecPercent

`fracDecPercent`'s legacy name implies a single bundled construct, but
the evidence checkpoint found three CAPS-named sub-topics under
Section 2, evidenced at markedly different tiers:

1. **Internal to the bundle:** should Calculations with Fractions,
   Equivalent Forms, and Percentage Calculation remain one candidate,
   given they sit under the same Section 2 heading area at all three
   grades and are conceptually related?
2. **Uneven evidence tiers:** Equivalent Forms and Percentage
   Calculation are each independently named-and-worked at G7;
   Calculations with Fractions is named at every grade but was only
   sampled, not worked. If the bundle is kept, the candidate as a
   whole would carry mixed evidence tiers — the same shape already
   seen in `mulDivFluency` and resolved there as OPEN, not as a reason
   to split or to tolerate the mixture as settled.
3. **External relationship:** Calculations with Fractions at G9
   explicitly extends into "squares, cubes, square roots and cube
   roots of common fractions" — the same rational-number extension
   already evidenced under `powersRootsFluency`'s G8 continuity. This
   raises a boundary question between the two candidates at G9,
   parallel to the addSub/mulDivFluency shared-sentence problem
   already recorded as open.

These three sub-topics are not evidenced with the same depth as each
other, so any scope decision made now would be made on an uneven
evidentiary base — the evidence checkpoint itself flags this as
unresolved.

## Structural comparison

| | mulDivFluency | addSub | fracDecPercent |
|---|---|---|---|
| Sub-constructs bundled under the legacy name | 2 (fact fluency, inverse op) | 1 named + 6 unnamed CAPS siblings | 3 (Calculations with Fractions, Equivalent Forms, Percentage Calculation) |
| Evidence tier per sub-construct | Mixed (unworked / worked) | Uniform for the one named property; siblings unassessed | Uneven — Equivalent Forms and Percentage Calculation each independently named-and-worked at G7; Calculations with Fractions named-but-unworked |
| Named as distinct CAPS bullets/sub-topics? | Yes, two separate Section 2 bullets | N/A (one property among seven) | Yes, three separate Section 2 sub-topics with their own G7/G8/G9 rows — though "decimals" alone has no standalone bullet |
| Cross-candidate boundary question? | No | Yes — inverse-operations sentence shared with mulDivFluency | Yes — G9 "operations with surds of fractions" overlaps powersRootsFluency's rational-number extension |
| Affirmative CAPS/project statement requiring bundling? | Not located | Not located | Not located |

## Which of A / B / C is supported

**C — the scope question remains explicitly OPEN.** Calculations with
Fractions, Equivalent Forms, and Percentage Calculation are not
affirmatively bundled by CAPS as one named construct (decimals in
particular have no standalone sub-topic bullet — only a representation
inside two others), nor is there evidence supporting a clean split,
since one of the three sub-topics was only sampled and the two that
are worked were worked independently of each other, not as a single
combined mechanism. Deciding either way now would rest on the legacy
name (excluded from scope reasoning) or on an incomplete evidentiary
comparison.

## Scope / Evidence tier / Range / Implementation — kept distinct

- **Scope (what constitutes the candidate):** OPEN — not decided by
  this document. Candidates for resolution: one bundled construct
  (current legacy shape); three sub-topics as three candidates; or two
  (Equivalent Forms and Percentage Calculation grouped, given their
  co-located G7 worked evidence, separate from Calculations with
  Fractions). Co-location of worked examples in the source is not
  itself grounds for grouping — noted here only as a candidate
  grouping to weigh later, not a conclusion.
- **Evidence tier (named / demonstrated / worked, per sub-construct):**
  - Equivalent Forms — named-and-worked at G7 (equivalence table);
    revision-only at G8/G9.
  - Percentage Calculation — independently named-and-worked at G7
    ("60% of R105"); not derivative of the equivalence table; G8/G9
    not reviewed in this pass.
  - Calculations with Fractions — named at G7/G8/G9; unworked in this
    pass (phase-overview level only).
  
  These tiers are not uniform and are not to be flattened into one
  rating for "fracDecPercent" as a whole.
- **Range (authorized numerical domain):** Not assessed by this
  document. No ceiling/floor for any of the three sub-topics has been
  established here.
- **Implementation:** Explicitly not evidence. No existing
  fracDecPercent code, generator behavior, or naming may be used to
  resolve scope, evidence tier, or range in this or any future
  document, per this project's standing rule.

## What remains OPEN, precisely

- Whether `fracDecPercent` should remain one candidate, split three
  ways, or split some other way (e.g. Equivalent Forms + Percentage
  Calculation together, Calculations with Fractions separate).
- Deeper evidence pass for "Calculations with fractions" clarification
  notes (G7/G8/G9), to establish whether worked examples and distinct
  item forms exist there.
- Deeper evidence pass for "Percentages" clarification notes
  (G7/G8/G9), distinguishing percentage-of-whole, increase/decrease,
  and any other named mechanisms, with their worked examples
  identified separately from each other and from Equivalent Forms.
- G8/G9 worked-example search for "Equivalent forms" specifically.
- The relationship between fracDecPercent's G9 "surds of fractions"
  material and `powersRootsFluency`'s G8 rational-number extension —
  the fact that the mathematical content intersects does not by
  itself establish that they are the same taxonomy candidate.
- Numeric range/ceiling for any of the three sub-topics.
- Whether "decimal fractions" merits recognition as its own sub-topic
  at all, given no standalone CAPS bullet was located for it
  independent of Equivalent Forms.

## Non-inference constraint in force

- The legacy name `fracDecPercent` must not be treated as defining
  this candidate's scope.
- The co-location of the Equivalent Forms and Percentage Calculation
  worked examples in the same clarification-notes passage must not be
  read as evidence that CAPS treats them as one mechanism or one
  candidate.
- Greater evidentiary depth given to Equivalent Forms and Percentage
  Calculation must not be read as a decision that Calculations with
  Fractions is out of scope — only that it has not yet been worked
  through with the same rigor.
- The G9 overlap with `powersRootsFluency` must not be used to
  informally assign that material to either candidate.
- Neither bundling nor splitting nor redefinition is authorized by
  this document.

## What can now be checkpointed

This scope-decision review is ready to checkpoint. No taxonomy status,
Generation Policy, implementation, or test change accompanies it.

## Next candidate

This completes the scope-decision review pass for the four newly-
assessed candidates (powersRootsFluency, ratioSharing, addSub,
fracDecPercent). No further candidate is queued by this document — the
next step is the deeper CAPS evidence pass for Calculations with
Fractions and Percentages (G7/G8/G9 clarification notes, mechanisms,
worked examples, range evidence), recording evidence by sub-construct
without resolving the bundle/split question, range and the G9
surds-of-fractions boundary kept OPEN throughout.

---

End of scope-decision review. Scope question **C (explicitly OPEN)**
recorded, with evidence now differentiated by sub-construct:
Equivalent Forms and Percentage Calculation each independently
named-and-worked at G7; Calculations with Fractions named-but-unworked.
No taxonomy edits. No Generation Policy. No implementation or test
changes.
