# mulDivFluency — Scope-Decision Review

**Status:** REVIEW ARTIFACT ONLY. No taxonomy status assigned. Not
committed as a taxonomy decision. `roundEstimate`, `ratioRate` remain
parked. `ratioSharing` not assessed.

## Evidence boundary in force for this decision

Only the following is treated as authoritative:

- **Multiplication-fact fluency:** G7/G8 CAPS explicitly state
  "multiplication of whole numbers to at least 12 × 12" (Section 2
  phase overview, p. 12–13, independently verified). Named construct,
  floor stated, no ceiling, no worked example specific to fact recall.
- **Inverse multiplication/division:** G7 CAPS explicitly names
  "inverse operation between multiplication and division" (Section 2,
  p. 12, independently verified) and G7's own clarification notes
  (p. 41, independently verified) contain a worked example: "If
  20 × 5 = 110, then 110 ÷ 20 = 5 and 110 ÷ 5 = 20." Named-and-worked
  at G7.

**Excluded from this decision:** the relayed (unverified) G8
inverse-operation worked example, the relayed G9 continuity sentence,
any secondary source, and genMulDiv/genMulDivFlat or their ranges.

## Precedent relied upon

The C1 (Doubling/Halving) precedent from the frozen Grade 5
specification, as already applied to ratioRate's scope question in
this project: C1 bundled two related-but-distinct operations
(doubling, halving) under one candidate name, with mixed evidence —
"Demonstrated: doubling as estimation aid... Named-but-unworked:
'doubling and halving' appears as a general bullet in 3 locations, no
Grade 5 worked example for halving-for-division or
doubling-for-multiplication." The frozen spec did not resolve this by
assuming the bundle was fine, nor by splitting it — it recorded the
bundling question itself as "OPEN — taxonomy scope decision
deliberately deferred."

This precedent was chosen because it is the only prior case in this
project where two related mathematical operations, evidenced at
different tiers, were bundled under one candidate name — the same
structural shape now present in mulDivFluency.

## Structural comparison

| | C1 (Doubling/Halving) | mulDivFluency |
|---|---|---|
| Two related operations under one name | Doubling, halving | Multiplication-fact fluency, inverse multiplication/division |
| Evidence tier of each | Doubling: demonstrated (estimation aid); halving: named-but-unworked | Fact fluency: named-but-unworked; inverse operation: named-and-worked (G7) |
| Are the two operations inverse/complementary in nature? | Yes (doubling ↔ halving) | Yes (multiplying ↔ dividing) |
| Does CAPS itself name them as one construct or list them separately? | Named together as "doubling and halving" in a general bullet | Named as two separate Section 2 sub-bullets ("multiplication of whole numbers to at least 12×12" and "inverse operation between multiplication and division") — not one combined phrase |
| Resolution in the precedent | Scope question recorded as explicitly OPEN | — (this decision) |

The comparison is not exact — C1's two operations were named together
in the same bullet at the point they were unworked, whereas
mulDivFluency's two sub-constructs are named as separate bullets from
the outset in Section 2. If anything, this makes the case for treating
them as a single evidence-uniform candidate weaker than C1's, since
CAPS's own bullet structure already treats them as distinct items, not
one combined phrase.

## Which of A / B / C is supported

**C — the scope question itself remains explicitly OPEN**, following
the C1 precedent.

Reasoning:

- **A** (keep bundled, tolerate mixed tiers) is not supported as a
  clean conclusion: unlike C1, where the two operations at least
  appear in a shared bullet, CAPS's Section 2 material treats
  multiplication-fact fluency and the inverse-operation relationship
  as two distinct, separately-worded bullets under the same "Mental
  calculations" heading. Bundling them into one candidate isn't
  contradicted by CAPS, but nothing in CAPS or this project's
  precedent affirmatively requires or supports it either — the only
  thing forcing the bundle is the legacy generator's shared name,
  which is explicitly excluded from this decision.
- **B** (split into two candidates now) is not supported either:
  splitting is itself a scope decision, and per the ratioRate scope
  review already on record in this project, "no evidence exists to
  split, and no evidence exists to keep bundled" is not resolved by
  choosing one arbitrarily — it's resolved by recording the question
  as open, exactly as C1 did.
- **C** is the only option consistent with how this exact type of
  situation (related operations, uneven evidence tiers, no
  affirmative CAPS or project statement on bundling) was actually
  handled previously in this project.

## What remains OPEN, precisely

- Whether mulDivFluency should remain one candidate encompassing both
  multiplication-fact fluency and inverse multiplication/division, or
  be split into two candidates aligned to these distinct CAPS
  sub-bullets.
- Multiplication-fact fluency's own form-level status (independent of
  the bundling question) — named-but-unworked, no worked example
  located for fact recall as an item form.
- Inverse multiplication/division's G8/G9 continuity — G7 is
  named-and-worked; G8's worked example is unverified; G9 has no
  sub-construct-specific evidence, only general four-operation
  continuity.
- Numeric ceiling/range for either sub-construct — OPEN at every grade
  ("at least 12×12" is a floor only).

## Non-inference constraint in force

- The shared legacy name `mulDivFluency` must not be treated as
  evidence that the two sub-constructs form one candidate.
- The fact that both are currently generated by related code
  (genMulDiv/genMulDivFlat) must not be treated as evidence they
  belong together.
- The G7 worked inverse-operation example must not be generalized to
  supply worked evidence for multiplication-fact fluency, nor
  projected forward to G8/G9 without independent verification at
  those grades.
- Neither bundling nor splitting is authorized by this document — both
  remain unauthorized pending a deliberate governance decision, exactly
  as ratioRate's equivalent question remains unauthorized.

## What can now be checkpointed

This scope-decision review, plus the corrected evidence position (G7
inverse-operation named-and-worked; fact-fluency named-but-unworked;
G8/G9 mechanism-level evidence unverified) is ready to checkpoint. No
taxonomy status, Generation Policy, implementation, or test change
accompanies it.

## Next candidate

Per the instructed sequence, powersRootsFluency is next.

---

End of scope-decision review. Scope question **C (explicitly OPEN)**
recorded. No taxonomy edits. No Generation Policy. No implementation
or test changes.
