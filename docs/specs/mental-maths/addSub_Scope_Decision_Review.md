# addSub — Scope-Decision Review

> **NOT TAXONOMY AUTHORITY. NOT AN IMPLEMENTATION AUTHORIZATION.**
> This document extends `addSub_Evidence_Review_Checkpoint.md` with a
> scope-decision review, following the same method used for
> `mulDivFluency_Scope_Decision_Review.md`. It assigns no taxonomy
> status, freezes nothing, and creates no Generation Policy or
> specification. It supersedes no existing document.

## Repository baseline at time of this checkpoint

`7356644` on `origin/main`, plus the powersRootsFluency and
ratioSharing scope-decision reviews added earlier in this same
session. This checkpoint commit adds no code, taxonomy, or Generation
Policy changes on top of that baseline.

## Evidence boundary in force for this decision

Only `addSub_Evidence_Review_Checkpoint.md` is treated as
authoritative. That checkpoint established that "Addition and
subtraction as inverse operations" sits under CAPS's "Properties of
whole numbers" topic (G7/G8) alongside several sibling properties in
the same clarification-notes list:

- The commutative property of addition and multiplication
- The associative property of addition and multiplication
- The distributive property of multiplication over addition/subtraction
- Addition and subtraction as inverse operations
- Multiplication and division as inverse operations
- 0 as the identity element for addition
- 1 as the identity element for multiplication

All seven are named together, under one topic, with worked examples
for each given in the same lettered list (a)–(f) at both G7 and G8.

**Excluded from this decision:** any existing addSub-related code
implementation, and `mulDivFluency`'s own bundling question (which
covers "multiplication-fact fluency" and "inverse multiplication/
division" — a different pairing than what's considered here).

## The scope question for addSub

`addSub`'s legacy name implies a candidate about addition and
subtraction specifically. But the CAPS evidence shows "addition and
subtraction as inverse operations" is one property among seven
properties of whole numbers, all named and worked together, at the
same grades, in the same list. This raises two distinct scope
questions:

1. **Internal to "inverse operations":** should addSub (addition/
   subtraction inverse) and the multiplication/division inverse
   property (already evidenced as part of `mulDivFluency`) be treated
   as one "inverse operations" candidate, given CAPS worked example
   (e) and (f) sit in the identical list, immediately adjacent, at
   both G7 and G8?
2. **External to inverse operations:** should "addition and
   subtraction as inverse operations" instead be grouped with the
   other whole-number properties (commutative, associative,
   distributive, identity elements) as one "properties of whole
   numbers" candidate, since CAPS names and evidences all seven
   together under one topic?

These two questions pull in different directions — (1) would group
addSub with part of mulDivFluency; (2) would group addSub with
material currently outside any named candidate in
`AUTHORIZED_FAMILIES` at all (no candidate for "commutative/
associative/distributive properties" or "identity elements" appears to
exist in the working skeleton).

## Structural comparison

| | mulDivFluency | powersRootsFluency | addSub |
|---|---|---|---|
| Sub-constructs bundled under shared CAPS topic | 2 (fact fluency, inverse op) | 4 (squares/roots, exponential form, laws, sci. notation) | Named alongside **6 sibling properties** under "Properties of whole numbers," of which only 1 (inverse op) maps to any existing candidate name |
| Evidence tier | Mixed | Uniform (named-and-worked) | Uniform for the property actually named `addSub` (named-and-worked G7/G8) — but 5 of its 6 siblings have no candidate name in the project at all |
| Does an existing candidate split already exist for the sibling material? | N/A | N/A | **Yes and no** — multiplication/division inverse already sits inside `mulDivFluency`; the other five properties (commutative, associative, distributive, two identity elements) appear to have **no candidate home** anywhere in `AUTHORIZED_FAMILIES` or the working skeleton |

## Which of A / B / C is supported

**C — the scope question remains explicitly OPEN**, and for a reason
distinct from every other candidate reviewed so far: this is not a
question of whether to bundle or split evidence within `addSub` as
currently named — it's that CAPS's own evidence suggests `addSub`'s
current boundary (as implied by its legacy name) may not match any
coherent CAPS-defined unit at all. The addition/subtraction-inverse
property CAPS actually evidences is one-seventh of a larger named
CAPS topic, most of which has no candidate representation in this
project's taxonomy work to date.

This is not resolved here as A (keep as-is), because "as-is" isn't
well-defined — `addSub`'s current scope (implied only by its legacy
generator name) doesn't correspond to any CAPS-named unit; the
CAPS-named unit is "Properties of whole numbers" in full. Nor is it
resolved as B (split), because splitting into what — the seven
individual properties as seven candidates? Two (addSub, mulDiv-
adjacent)? — is itself undecided.

## What remains OPEN, precisely

- Whether `addSub` should be redefined to match CAPS's "Properties of
  whole numbers" topic in full (absorbing the five currently-unnamed
  properties), narrowed to only the inverse-operations pair (partially
  overlapping `mulDivFluency`), or left as a name with no clean CAPS
  correspondent.
- Whether the five whole-number properties with no current candidate
  name (commutative, associative, distributive, two identity elements)
  should become their own candidate(s) at all, or are considered
  out-of-scope for the Mental Maths feature by design (a decision this
  document cannot make and has not seen evidence of either way).
- The relationship between `addSub`'s inverse-operations evidence and
  `mulDivFluency`'s inverse-operations evidence — both cite the same
  CAPS clarification-notes list (items (e) and (f) respectively) as
  their evidence, meaning some future taxonomy decision must account
  for two existing candidates drawing from the same CAPS sentence.
- G9 continuity for addition/subtraction as inverse operations
  specifically — general statement only, per the evidence checkpoint.

## Non-inference constraint in force

- The legacy name `addSub` must not be treated as defining this
  candidate's correct CAPS-aligned scope — the evidence located a
  broader CAPS unit than the name implies.
- The fact that `mulDivFluency` already exists as a candidate must not
  be used to resolve where the addition/subtraction vs. multiplication/
  division inverse-operations material "belongs" — that is exactly the
  open question, not a fact to reason from.
- The absence of any candidate for the other five whole-number
  properties must not be read as a decision that they are out of
  scope — only as an observed gap.
- Neither bundling nor splitting nor redefinition is authorized by
  this document.

## What can now be checkpointed

This scope-decision review is ready to checkpoint. No taxonomy status,
Generation Policy, implementation, or test change accompanies it.

## Next candidate

Per the instructed sequence: `fracDecPercent` next.

---

End of scope-decision review. Scope question **C (explicitly OPEN)**
recorded, with the additional finding that `addSub`'s legacy-name
boundary does not correspond to any single CAPS-named unit, and that
five sibling CAPS properties currently have no candidate
representation in this project at all. No taxonomy edits. No
Generation Policy. No implementation or test changes.