# Mental Maths Senior Phase — Candidate-Universe Status Consolidation

> **NOT TAXONOMY AUTHORITY. NOT AN IMPLEMENTATION AUTHORIZATION.**
> This document organizes the current status of every identified
> candidate into one place, using only what has already been recorded
> in this repository's checkpoints and reviews. It performs no new
> evidence retrieval, resolves no open question, and creates no
> taxonomy, generation policy, or specification. It supersedes no
> existing document, including `Senior_Taxonomy_v1.0_Working_Skeleton.md`.

## Repository baseline at time of this checkpoint

`8a09f9b` on `origin/main` (ratioSharing retrieval-gap checkpoint).
This checkpoint commit adds no code, taxonomy, or Generation Policy
changes on top of that baseline.

## Purpose and scope of this document

This is a status index, not a new assessment. Each row below reflects
only what a prior checkpoint or review already recorded. Two states
are kept distinct and must not be collapsed into each other:

- **Retrieval gap** — evidence retrieval could not be performed in a
  given session (tooling/access limitation). This says nothing about
  whether CAPS evidence exists; it only says no attempt has succeeded
  yet.
- **Not assessed** — no retrieval attempt or review has been performed
  on this candidate at all in this project.

Neither state is equivalent to a taxonomy-level "OPEN" finding, which
is reserved for candidates where evidence *was* retrieved and a
specific scope/form question remains unresolved (e.g. `mulDivFluency`,
`ratioRate`).

## Candidate status table

| Candidate | Current position | Evidence status | Scope status | Authorization |
|---|---|---|---|---|
| `roundEstimate` | Assessed | Evidence gap closed; form-level questions remain | Open | None |
| `mulDivFluency` | Assessed | Mixed; G7 inverse operation worked | Scope open | None |
| `powersRootsFluency` | Retrieval gap | No authoritative assessment yet | Undetermined | None |
| `ratioSharing` | Retrieval gap | No dedicated assessment yet | Undetermined | None |
| `ratioRate` | Scope review | Scope open; heterogeneous constructs | Open | None |
| `addSub` | Not assessed | No assessment yet | Undetermined | None |
| `fracDecPercent` | Not assessed | No assessment yet | Undetermined | None |

## Source of each row

- `roundEstimate` — `roundEstimate_Evidence_Review_Checkpoint.md`
  (evidence gap closed; form-level scope recorded OPEN, matching the
  C1 named-but-unworked precedent).
- `mulDivFluency` — `mulDivFluency_Scope_Decision_Review.md` (fact
  fluency named-but-unworked; inverse operation named-and-worked at
  G7; G8/G9 mechanism-level evidence unverified; bundling-vs-split
  scope question recorded explicitly OPEN, option C).
- `powersRootsFluency` — `powersRootsFluency_Retrieval_Gap_Checkpoint.md`
  (no CAPS retrieval performed; no evidence tier, range, or scope
  inferred).
- `ratioSharing` — `ratioSharing_Retrieval_Gap_Checkpoint.md` (no CAPS
  retrieval performed; the "sharing in a given ratio where the whole
  is given" phrase from prior conversational context is explicitly
  **not** treated as an assessment and remains unverified).
- `ratioRate` — referenced by `mulDivFluency_Scope_Decision_Review.md`
  as an existing scope review in this project (heterogeneous
  constructs, scope question open); not re-examined by this document.
- `addSub`, `fracDecPercent` — listed in
  `roundEstimate_Evidence_Review_Checkpoint.md`'s candidate universe as
  unassessed; no dedicated checkpoint exists for either in this
  repository.

## Explicit non-actions of this document

- No new candidates are created.
- `mulDivFluency` and `ratioRate` are not split into sub-candidates
  here.
- `ratioSharing` is not assessed based on the "sharing in a given
  ratio" phrase or any other unverified material.
- ADR-022 is not resolved or amended.
- No taxonomy authority, Generation Policy, implementation, or test
  changes are made.

## What remains outstanding

- Four candidates (`powersRootsFluency`, `ratioSharing`, `addSub`,
  `fracDecPercent`) have no authoritative CAPS evidence on record.
- Two candidates (`mulDivFluency`, `ratioRate`) have an explicit open
  scope question (bundle vs. split) unresolved.
- One candidate (`roundEstimate`) has a closed evidence gap but an
  open form-level scope question.
- No Senior Taxonomy v1.0 has been drafted. The only Senior Taxonomy
  artifact in the repository remains
  `Senior_Taxonomy_v1.0_Working_Skeleton.md`, itself explicitly
  NOT AUTHORITATIVE / NOT FROZEN.

---

*End of consolidation checkpoint. No taxonomy, Generation Policy,
implementation, or test changes are made by this document.*
