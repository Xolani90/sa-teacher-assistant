# Mental Maths Senior Phase — Candidate-Universe Status Consolidation (v2)

> **NOT TAXONOMY AUTHORITY. NOT AN IMPLEMENTATION AUTHORIZATION.**
> This document organizes the current status of every identified
> candidate into one place, using only what has already been recorded
> in this repository's checkpoints and reviews. It performs no new
> evidence retrieval, resolves no open question, and creates no
> taxonomy, generation policy, or specification. It supersedes no
> existing document, including `Senior_Taxonomy_v1.0_Working_Skeleton.md`.
> It supersedes this file's own prior content (v1), which is preceded
> by this version now that four retrieval gaps recorded there have
> closed.

## Repository baseline at time of this checkpoint

`8b2f74c` on `origin/main` (addSub and fracDecPercent evidence-review
checkpoints). This checkpoint commit adds no code, taxonomy, or
Generation Policy changes on top of that baseline.

## Purpose and scope of this document

This is a status index, not a new assessment. Each row below reflects
only what a prior checkpoint or review already recorded — it performs
no new evidence retrieval itself. Two states are kept distinct and
must not be collapsed into each other:

- **Assessed** — a first-hand or independently-verified evidence
  review has been performed and recorded in a checkpoint document.
- **Scope review** — evidence has been assessed, but a specific
  bundling/splitting or form-level question remains explicitly open
  (this is a stronger state than "assessed with no open question," not
  a weaker one — it means the evidence was examined closely enough to
  surface a real question).

All four candidates previously in "Retrieval gap" or "Not assessed"
state (`powersRootsFluency`, `ratioSharing`, `addSub`,
`fracDecPercent`) moved to "Assessed" in this version, following
first-hand extraction from CAPS PDFs the user uploaded directly to
this session (not secondhand or relayed quotations).

## Candidate status table

| Candidate | Current position | Evidence status | Scope status | Authorization |
|---|---|---|---|---|
| `roundEstimate` | Assessed | Evidence gap closed; form-level questions remain | Open | None |
| `mulDivFluency` | Assessed | Mixed; G7 inverse operation worked, now also confirmed at G8 | Scope open | None |
| `powersRootsFluency` | Assessed | Named-and-worked at G7, G8, and G9; explicit G9 continuity statement | Not yet reviewed | None |
| `ratioSharing` | Assessed | Named-but-unworked at G7/G8; G9 status genuinely unresolved | Not yet reviewed | None |
| `ratioRate` | Scope review | Scope open; heterogeneous constructs | Open | None |
| `addSub` | Assessed | Named-and-worked at G7 and G8 (G8 now independently confirmed); G9 continuity general only | Not yet reviewed | None |
| `fracDecPercent` | Assessed | Named-and-worked at G7 for Equivalent forms; other two sub-topics sampled, not fully worked | Not yet reviewed | None |

## Source of each row

- `roundEstimate` — `roundEstimate_Evidence_Review_Checkpoint.md`
  (evidence gap closed; form-level scope recorded OPEN, matching the
  C1 named-but-unworked precedent).
- `mulDivFluency` — `mulDivFluency_Scope_Decision_Review.md` (fact
  fluency named-but-unworked; inverse operation named-and-worked at
  G7; bundling-vs-split scope question recorded explicitly OPEN,
  option C). The G8 instance of the inverse-operation worked example
  (previously unverified/relayed) is now independently confirmed via
  `addSub_Evidence_Review_Checkpoint.md`, which located the identical
  example at p. 75-76 while reviewing addSub's shared "Properties of
  whole numbers" topic.
- `powersRootsFluency` — `powersRootsFluency_Evidence_Review_Checkpoint.md`
  (supersedes the earlier `powersRootsFluency_Retrieval_Gap_Checkpoint.md`).
  Named-and-worked at every Senior Phase grade; strongest evidence tier
  of any candidate reviewed so far. One extraction artifact flagged
  (a garbled square-root line) pending visual confirmation.
- `ratioSharing` — `ratioSharing_Evidence_Review_Checkpoint.md`
  (supersedes the earlier `ratioSharing_Retrieval_Gap_Checkpoint.md`).
  Independently confirms the "sharing in a given ratio where the whole
  is given" phrase previously relayed without verification; no worked
  example located; G9 status genuinely unresolved (not merely
  unretrieved).
- `ratioRate` — referenced by `mulDivFluency_Scope_Decision_Review.md`
  as an existing scope review in this project (heterogeneous
  constructs, scope question open); not re-examined by this document
  or by the new CAPS PDF pass.
- `addSub` — `addSub_Evidence_Review_Checkpoint.md`. Named-and-worked
  at G7 and G8 (identical worked example at both grades); G9 has only
  a general continuity statement, no construct-specific evidence.
- `fracDecPercent` — `fracDecPercent_Evidence_Review_Checkpoint.md`.
  Covers three CAPS sub-topics (Calculations with fractions,
  Percentages, Equivalent forms); "Equivalent forms" reviewed in most
  depth (named-and-worked at G7); the other two sub-topics sampled at
  Section 2 phase-overview level only, not worked through with the
  same rigor.

## Cross-candidate observation (not a scope decision)

Three candidates now share a structural pattern worth noting for a
future governance decision, though none is resolved here:
`mulDivFluency`, `addSub`, and (partially) `powersRootsFluency` each
bundle a "named property" (inverse operations, laws of exponents)
under a shared CAPS "Properties" topic, evidenced at G7/G8 with only a
general continuity statement at G9. This observation does not create,
imply, or authorize any bundling/splitting decision for any of these
candidates — it is recorded only so a future consolidated scope review
can consider them together if useful.

## Explicit non-actions of this document

- No new candidates are created.
- `mulDivFluency` and `ratioRate` are not split into sub-candidates
  here.
- No form-level scope decision is made for `powersRootsFluency`,
  `ratioSharing`, `addSub`, or `fracDecPercent` — each is newly
  "Assessed" for evidence, not scope-reviewed.
- ADR-022 is not resolved or amended.
- No taxonomy authority, Generation Policy, implementation, or test
  changes are made.

## What remains outstanding

- Four candidates (`powersRootsFluency`, `ratioSharing`, `addSub`,
  `fracDecPercent`) now have evidence assessed but have not yet had a
  dedicated scope review (bundle vs. split, precedent comparison)
  the way `mulDivFluency` and `ratioRate` have.
- `fracDecPercent`'s "Calculations with fractions" and "Percentages"
  sub-topics need a deeper pass to reach the same evidentiary rigor as
  "Equivalent forms."
- `powersRootsFluency`'s flagged extraction artifact (square-root
  line) needs visual page-image confirmation.
- `roundEstimate` and `mulDivFluency` still carry their own open
  form-level scope questions, unresolved by this consolidation.
- No Senior Taxonomy v1.0 has been drafted. The only Senior Taxonomy
  artifact in the repository remains
  `Senior_Taxonomy_v1.0_Working_Skeleton.md`, itself explicitly
  NOT AUTHORITATIVE / NOT FROZEN.

---

*End of consolidation checkpoint. No taxonomy, Generation Policy,
implementation, or test changes are made by this document.*
