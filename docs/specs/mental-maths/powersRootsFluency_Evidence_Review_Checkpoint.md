# powersRootsFluency — Evidence-Review Checkpoint

> **NOT TAXONOMY AUTHORITY. NOT AN IMPLEMENTATION AUTHORIZATION.**
> This document records an evidence review performed against a CAPS
> source document the user directly uploaded to this session and that
> this session extracted and read itself (not a secondhand or relayed
> quotation). It freezes nothing, authorizes nothing, and creates no
> taxonomy, generation policy, or specification. It supersedes no
> existing document, including `Senior_Taxonomy_v1.0_Working_Skeleton.md`,
> and it supersedes `powersRootsFluency_Retrieval_Gap_Checkpoint.md`
> now that the retrieval gap that document recorded is closed.

## Repository baseline at time of this checkpoint

`ce661da` on `origin/main` (candidate-universe status consolidation
checkpoint). This checkpoint commit adds no code, taxonomy, or
Generation Policy changes on top of that baseline.

## Source

CAPS Mathematics Senior Phase (Grades 7–9), as uploaded to this
session (`CAPS_SP__MATHEMATICS_GR_7-9.pdf`, 164 pages; PDF metadata:
Adobe InDesign CS5.5, Adobe PDF Library 9.9, created 2012-09-20 —
consistent with the official 2011 DBE CAPS document). Text was
extracted directly from the PDF in this session (`pdftotext -layout`)
and read by this session — this is a first-hand extraction, not a
relayed or secondhand quotation.

## Evidence position

| Dimension | Status |
|---|---|
| Named CAPS topic ("Exponents", 1.2) at G7/G8/G9 | Established |
| G7 worked evidence | Established |
| G8 worked evidence | Established |
| G9 worked evidence | Established |
| Numeric ceiling/range | Partially established (see below) |
| Form-level taxonomy scope | Not assessed by this document (see "What remains outstanding") |
| Generation authorization | None |

### Grade 7 (Section 2 phase overview, p. 13; clarification notes, p. 43–44)

- Named construct: "Determine squares to at least 12² and their
  square roots"; "Determine cubes to at least 6³ and their cube
  roots"; "Compare and represent whole numbers in exponential form:
  aᵇ = a × a × a × ... for b number of factors."
- Worked examples present:
  - "a³ = a × a × a; a⁵ = a × a × a × a × a"
  - "50 × 50 × 50 × 50 × 50 × 50 × 50 = 50⁷"
  - "3² = 9 therefore √9 = 3"
  - "√81 = 9 because 9² = 81" [as printed; see note below]
  - "√27 = 3 because 3³ = 27"
  - Misconception guards: "12² = 12 × 12 and not 12 × 2"; "1³ means
    1 × 1 × 1 and not 1 × 3"; "100¹ = 100"
- G7 explicitly states square roots/cube roots are "the inverse
  operations of squaring and cubing."
- G7 also covers calculations in exponential form (p. 44): "(7 – 4)³
  = 3³ and NOT 7³ – 4³"; "√16 + 9 = √25, and NOT √16 + √9" — order-of-
  operations misconceptions specific to this construct.

**Extraction-fidelity note — RESOLVED:** the `pdftotext` line rendered
as "√81 = 9 because 9² = 81" was flagged as a possible extraction
artifact in an earlier pass of this checkpoint. Visual confirmation
against the rendered PDF page image (p. 43) now confirms this line is
correct as extracted: "√81 = 9 because 9² = 81" (verified: 9² = 81 ✓)
is a distinct bullet from the cube-root example "³√27 = 3 because 3³ =
27" (verified: 3³ = 27 ✓), both genuinely present on the page as
separate misconception-guard examples. No extraction error occurred;
this note is retained only as a record that the check was performed.

### Grade 8 ("What is different to Grade 7?", p. 81–84)

- Revises G7 squares/cubes/roots, extends to integers and rational
  numbers in exponential form, and introduces scientific notation
  (positive exponents).
- Introduces general laws of exponents (m, n natural numbers, a, t ≠
  0): aᵐ × aⁿ = aᵐ⁺ⁿ; aᵐ ÷ aⁿ = aᵐ⁻ⁿ (m > n); (aᵐ)ⁿ = aᵐˣⁿ; (a × t)ⁿ =
  aⁿ × tⁿ; a⁰ = 1 — each with a worked numeric and algebraic example
  (e.g. "2³ × 2⁴ = 2³⁺⁴ = 2⁷"; "x³ × x⁴ = x³⁺⁴ = x⁷").
- Extends to squares/cubes/roots of rational numbers, with worked
  decimal/fraction examples: "(0,7)² = 0,49"; "(0,1)³ = 0,001".
- Explicit resultant-sign rule for integers raised to powers: "using
  patterns... learners should anticipate the resultant sign of an
  integer raised to an odd or even power e.g. (–15)⁴ will be
  positive, while (–15)³ will be negative."
- Introduces scientific notation with worked examples: "25 = 2,5 ×
  10¹"; "25 million = 2,5 × 10⁷."

### Grade 9 ("What is different to Grade 8?", p. 124–126)

- Explicit continuity statement: "In Grade 9 learners consolidate
  number knowledge and calculation techniques for exponents,
  developed in Grade 8."
- Extends laws of exponents to integer exponents, including a⁻ᵐ =
  1/aᵐ, with worked examples: "5⁻³ = 1/5³ = 1/125"; "7³ ÷ 7⁵ = 7⁻² =
  1/7² = 1/49."
- Extends scientific notation to negative exponents: "25 millionth =
  2,5 × 10⁻⁵."
- Provides worked calculation/equation examples using the laws (p.
  125): "Calculate: 2⁻¹ × 6³ × 3⁻²"; "Solve x: 3ˣ = 9"; "Solve x: 2ˣ =
  1/4"; "5^(x+1) = 1."

## What this establishes

Unlike `roundEstimate` (named-but-unworked) and the unresolved parts of
`mulDivFluency`, `powersRootsFluency` has **named-and-worked evidence
at every Senior Phase grade**, with an explicit G8→G9 continuity
statement in CAPS's own words. This is the strongest evidence tier
available in this project's framework (comparable to C6/C12/C13 in the
frozen Grade 5 spec, not to C1's named-but-unworked tier).

A **floor** is given at G7 for squares/cubes ("squares to at least
12", "cubes to at least 6"). No corresponding explicit numeric ceiling
was located for squares/cubes at any grade in the pages reviewed.

A **ceiling** is given for general exponent calculations at G7:
"Perform calculations involving all four operations using numbers in
exponential form, limited to exponents up to 5, and square and cube
roots" (Section 2 phase overview and G7 clarification notes, both
independently located in the extracted text — confirmed, not
inferred). No corresponding G8/G9 numeric ceiling for general exponent
calculations was located in the pages reviewed; G8/G9 clarification
notes describe extending the *laws* (integer exponents, negative
exponents) without repeating a numeric exponent ceiling.

## Non-inference constraints in force

1. (Resolved — see extraction-fidelity note above.) The √81/³√27
   examples are both confirmed correct; no remaining caution needed
   for this specific line.
2. Do not assume a numeric ceiling exists at G8/G9 for general
   exponent calculations merely because one exists at G7 — none was
   located in the G8/G9 pages reviewed.
3. Do not treat this checkpoint as a form-level taxonomy scope
   decision — whether `powersRootsFluency` should be one candidate or
   split (e.g. squares/cubes vs. general exponent laws vs. scientific
   notation) is not assessed here.
4. Do not treat any existing powers/roots code implementation as
   specification evidence.

## What remains outstanding

- Form-level scope decision (one candidate vs. split) — not addressed
  by this document.
- G8/G9 numeric ceiling for general exponent calculations (if any) —
  not located in the pages reviewed.
- ~~Visual confirmation of the flagged extraction artifact (√81
  line).~~ Resolved — see extraction-fidelity note above.

---

*End of evidence-review checkpoint. No taxonomy, Generation Policy,
implementation, or test changes are made by this document.*
