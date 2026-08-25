# roundEstimate — Evidence-Review Checkpoint

> **NOT TAXONOMY AUTHORITY. NOT AN IMPLEMENTATION AUTHORIZATION.**
> This document is a breadcrumb recording the state of an in-progress
> evidence review, so the reasoning trail survives outside chat
> history. It freezes nothing, authorizes nothing, and creates no
> taxonomy, generation policy, or specification. It supersedes no
> existing document, including `Senior_Taxonomy_v1.0_Working_Skeleton.md`.

## Repository baseline at time of this checkpoint

`a033921` on `origin/main` (Senior Taxonomy v1.0 Working Skeleton,
non-authoritative). This checkpoint commit adds no code, taxonomy, or
Generation Policy changes on top of that baseline.

## Evidence gap status

CLOSED. CAPS Evidence Set v0.2 (Grade 8 §3.3.2, pp. 75–76; Grade 9
§3.3.3, pp. 119–120) was retrieved, source-verified against the
official 2011 DBE CAPS Mathematics Grades 7–9 document, and reviewed —
independently confirmed at the exact page positions cited. This is a
prior, separate checkpoint; recorded here only for continuity.

## Candidate universe

Seven candidates identified from authoritative project materials:
`mulDivFluency`, `powersRootsFluency`, `ratioSharing` (all three named
in `mentalMathsService.js`'s in-code `AUTHORIZED_FAMILIES` list — a
label with no specification authority per ADR-022 §5 Rule 2), plus
four legacy generators (`addSub`, `roundEstimate`, `fracDecPercent`,
`ratioRate`) from the original ungoverned Senior Phase implementation.

**Only `roundEstimate` has been assessed so far.** The other six
remain unassessed.

## `roundEstimate` — current evidence position

| Dimension | Status |
|---|---|
| Named CAPS technique ("rounding off and compensating") exists at G7/G8/G9 | Established |
| Compensation mechanism | **OPEN** — no worked example or explanation found anywhere in the source document |
| G8/G9 magnitude/range | **OPEN** — no magnitude guidance found attached to this technique at G8 or G9 |
| Form-level taxonomy scope | **OPEN** — not Confirmed, not Closed, not Rejected |
| Generation authorization | **None** |

### Why form-level scope is OPEN, not Confirmed

The frozen Grade 5 spec chain
(`Grade5_Arithmetic_Fluency_Draft_v0.1_Consolidated.md`) distinguishes
two evidence tiers:
- **Named-and-worked** (C6, C12, C13): CAPS gives a demonstrated worked
  instance. These reached Confirmed/Closed form status even with
  numeric range left OPEN.
- **Named-but-unworked** (C1): CAPS names the construct repeatedly but
  never shows it worked. C1's *form-level scope decision itself*
  stayed OPEN, with an explicit non-inference rule.

`roundEstimate`'s evidence — "rounding off and compensating" named
identically at G7, G8, G9, with no worked example located anywhere in
the document — matches C1's named-but-unworked tier, not C6/C12/C13's
tier. Applying the existing precedent consistently places
`roundEstimate`'s form-level scope in the same OPEN category as C1.

### Non-inference exclusions in force

1. Do not assume the mechanism is round → calculate → compensate.
2. Do not import Grade 7's "nearest 5, 10, 100 or 1 000" (a different
   construct — Ordering and comparing whole numbers — not Calculation
   techniques) into a G8/G9 range for this technique.
3. Do not treat the existing `genRoundEstimate` implementation as
   specification evidence.
4. Do not treat the p. 156 Table 4.2 "estimation and appropriate
   rounding" cognitive-levels example as compensation evidence — it
   uses different wording and a different worked example.

## Parked governance question (not resolved here)

ADR-022 §8's specification lifecycle includes a "CAPS / empirical
validation" stage whose scope is undefined — specifically, whether
empirical evidence may ever supply an operational mechanism or range
that CAPS itself does not specify, versus only validating a
specification CAPS evidence already established. This question is
explicitly **not** resolved by this checkpoint and must not be used to
opportunistically authorize `roundEstimate` or any other candidate
without its own explicit governance decision.

## What remains outstanding

- Six candidates not yet assessed: `mulDivFluency`, `powersRootsFluency`,
  `ratioSharing`, `addSub`, `fracDecPercent`, `ratioRate`.
- `roundEstimate`'s form-level scope question is not resolved — this
  checkpoint records that it is open, not how or whether it will be
  closed.
- No Senior Taxonomy v1.0 has been drafted. The only Senior Taxonomy
  artifact in the repository remains
  `Senior_Taxonomy_v1.0_Working_Skeleton.md`, itself explicitly
  NOT AUTHORITATIVE / NOT FROZEN.

---

*End of checkpoint. No taxonomy, Generation Policy, implementation, or
test changes are made by this document.*
