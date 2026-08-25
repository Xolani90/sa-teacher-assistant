# fracDecPercent — Evidence-Review Checkpoint

> **NOT TAXONOMY AUTHORITY. NOT AN IMPLEMENTATION AUTHORIZATION.**
> This document records an evidence review performed against a CAPS
> source document the user directly uploaded to this session and that
> this session extracted and read itself (not a secondhand or relayed
> quotation). It freezes nothing, authorizes nothing, and creates no
> taxonomy, generation policy, or specification. It supersedes no
> existing document, including `Senior_Taxonomy_v1.0_Working_Skeleton.md`.
>
> **Scope note:** `fracDecPercent` covers a substantially larger CAPS
> footprint than the other candidates reviewed so far — it spans three
> Section 2 sub-topics (Calculations with fractions, Percentages,
> Equivalent forms) each with their own G7/G8/G9 rows and clarification
> notes. This checkpoint reviews the "Equivalent forms" sub-topic in
> most detail, as it is the part most directly named "fracDecPercent"
> by the legacy generator name, and samples the other two sub-topics.
> It is **not** a claim of exhaustive coverage of every fraction/
> decimal/percentage clarification note in the document.

## Repository baseline at time of this checkpoint

`3ed9698` on `origin/main` (powersRootsFluency and ratioSharing
evidence-review checkpoints), plus `addSub_Evidence_Review_Checkpoint.md`
added earlier in this same session. This checkpoint commit adds no
code, taxonomy, or Generation Policy changes on top of that baseline.

## Source

CAPS Mathematics Senior Phase (Grades 7–9), as uploaded to this
session (`CAPS_SP__MATHEMATICS_GR_7-9.pdf`, 164 pages). Text was
extracted directly from the PDF in this session (`pdftotext -layout`)
and read by this session — first-hand extraction, not a relayed
quotation.

## Evidence position

| Dimension | Status |
|---|---|
| Named CAPS topic ("Equivalent forms") at G7/G8/G9 | Established |
| G7 worked example (fraction/decimal/percentage equivalence) | Established |
| G7 worked example (percentage calculation) | Established |
| G8/G9 dedicated worked example for equivalent forms specifically | **Not located in the pages sampled** |
| "Calculations with fractions" sub-topic named at G7/G8/G9 | Established |
| "Percentages" sub-topic named at G7/G8/G9 | Established |
| Form-level taxonomy scope (one candidate vs. three) | Not assessed — see scope note below |
| Generation authorization | None |

### Equivalent forms — Grade 7 (Section 2, p. ~15; clarification notes, p. ~53)

- Section 2 names: "Recognize and use equivalent forms of common
  fractions with 1-digit or 2-digit denominators"; "recognize
  equivalence between common fraction and decimal fraction forms of
  the same number"; "recognize equivalence between common fraction,
  decimal fraction and percentage forms of the same number."
- Worked example located (clarification notes): "Learners should
  become familiar with the equivalent fraction and decimal forms of
  common percentages like: a) 25% or ¼ or 0,25; b) 50% or ½ or 0,5;
  c) 60% or ⅗ or 0,6."
- Separate worked example for percentage calculation: "Calculate 60%
  of R105" (percentage-of-a-whole-number context, using the
  equivalent-fraction method described).

### Equivalent forms — Grade 8 / Grade 9 (Section 2 phase overview)

- G8: "Revise equivalent forms between: common fractions (fractions
  where one denominator is a multiple of the other); common fraction
  and decimal fraction forms of the same number; common fraction,
  decimal fraction and percentage forms of the same number."
- G9: near-identical wording ("Revise equivalent forms between: common
  fractions where one denominator is a multiple of another;
  common fraction and decimal fraction forms...; common fraction,
  decimal fraction and percentage forms...").
- Both G8 and G9 rows are framed as **revision** of G7 content in
  Section 2 — no new equivalent-forms mechanism or worked example
  specific to G8/G9 was located in the pages sampled for this
  checkpoint. This does not establish absence; it establishes only
  that this pass did not locate one (see "What remains outstanding").

### Calculations with fractions (Section 2 phase overview, sampled)

- G7: "addition and subtraction of common fractions... limited to
  fractions with the same denominator or where one denominator is a
  multiple of another"; extended to "where one denominator is not a
  multiple of the other"; "multiplication of common fractions,
  including mixed numbers."
- G8: revises G7's addition/subtraction and multiplication; adds
  "divide whole numbers and common fractions by common fractions"
  (new mechanism: division).
- G9: "All four operations with common fractions and mixed numbers";
  "All four operations with numbers that involve the squares, cubes,
  square roots and cube roots of common fractions" (links to
  `powersRootsFluency`'s already-confirmed G8 extension to rational
  numbers).
- No worked numeric example for this sub-topic was reviewed in detail
  in this pass — Section 2 phase-overview text only, not the fuller
  clarification notes.

### Percentages (Section 2 phase overview, sampled)

- G7: "percentages of whole numbers"; "calculate the percentage of
  part of a whole"; "calculate percentage increase or decrease of
  whole numbers."
- The G7 worked examples quoted above (25%/¼/0,25 etc., and the "60%
  of R105" example) sit under this sub-topic's clarification notes.
- G8/G9 phase-overview rows for Percentages were not located/reviewed
  in this pass in the same detail as G7.

## What this establishes

`fracDecPercent`, at least for the "Equivalent forms" sub-topic, has
**named-and-worked evidence at G7**, with G8/G9 treated by CAPS as
revision of the same mechanism rather than a new one — structurally
similar to `mulDivFluency`'s multiplication-fact-fluency finding
(named at multiple grades, one clear worked instance located). The
"Calculations with fractions" and "Percentages" sub-topics are
confirmed as named CAPS content across all three grades but were only
sampled, not worked through with the same rigor as "Equivalent forms"
or as the other candidates in this project.

## Non-inference constraints in force

1. Do not treat the absence of a G8/G9-specific worked example for
   equivalent forms as evidence one doesn't exist — this pass sampled
   the Section 2 phase-overview table more than the full clarification
   notes for G8/G9.
2. Do not treat "Calculations with fractions" and "Percentages" as
   equivalently well-evidenced as "Equivalent forms" — they were
   sampled, not worked through in depth.
3. Do not assume `fracDecPercent` should remain one candidate spanning
   all three sub-topics, or should be split along them — this
   structural/scope question is explicitly unaddressed by this
   checkpoint, following the same non-inference posture already
   applied to `mulDivFluency` and `ratioRate`.
4. Do not treat any existing fracDecPercent-related code
   implementation as specification evidence.

## What remains outstanding

- Deeper pass through "Calculations with fractions" and "Percentages"
  clarification notes (not just Section 2 phase-overview rows), to
  bring their evidence tier up to the same rigor as "Equivalent
  forms."
- G8/G9 worked-example search for "Equivalent forms" specifically, in
  the fuller clarification notes rather than the phase-overview table.
- Numeric range/ceiling for any of the three sub-topics — not
  addressed in this pass.
- Form-level scope decision (one candidate vs. split along the three
  CAPS sub-topics) — not addressed here.

---

*End of evidence-review checkpoint. No taxonomy, Generation Policy,
implementation, or test changes are made by this document.*
