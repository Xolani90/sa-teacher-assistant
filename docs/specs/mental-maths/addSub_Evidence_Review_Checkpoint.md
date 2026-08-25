# addSub — Evidence-Review Checkpoint

> **NOT TAXONOMY AUTHORITY. NOT AN IMPLEMENTATION AUTHORIZATION.**
> This document records an evidence review performed against a CAPS
> source document the user directly uploaded to this session and that
> this session extracted and read itself (not a secondhand or relayed
> quotation). It freezes nothing, authorizes nothing, and creates no
> taxonomy, generation policy, or specification. It supersedes no
> existing document, including `Senior_Taxonomy_v1.0_Working_Skeleton.md`.

## Repository baseline at time of this checkpoint

`3ed9698` on `origin/main` (powersRootsFluency and ratioSharing
evidence-review checkpoints). This checkpoint commit adds no code,
taxonomy, or Generation Policy changes on top of that baseline.

## Source

CAPS Mathematics Senior Phase (Grades 7–9), as uploaded to this
session (`CAPS_SP__MATHEMATICS_GR_7-9.pdf`, 164 pages). Text was
extracted directly from the PDF in this session (`pdftotext -layout`)
and read by this session — first-hand extraction, not a relayed
quotation.

## Note on continuity with prior (relayed) work

Prior conversational context (not part of this repository) reported a
difficulty retrieving Grade 8's version of the addition/subtraction
worked example at "p. 75–76" of the primary CAPS document, and treated
only the Grade 7 (p. 41) version as independently confirmed. **This
checkpoint independently locates and confirms the Grade 8 version at
the same page range (p. 75–76)**, first-hand from the uploaded PDF —
closing that specific, previously-unretrieved gap.

## Evidence position

| Dimension | Status |
|---|---|
| Named CAPS property ("Addition and subtraction as inverse operations") at G7/G8 | Established |
| G7 worked example | Established |
| G8 worked example | Established (identical wording/example to G7) |
| G9 dedicated worked example | **Not located** — general continuity statement only |
| Numeric floor (G7) | Established: "at least 6-digit numbers" |
| Numeric ceiling | **Not located** at any grade |
| Form-level taxonomy scope | Not assessed by this document |
| Generation authorization | None |

### Grade 7 (Section 2 phase overview, p. 13; clarification notes, p. 42)

- "Properties of whole numbers" (Section 2) includes: commutative,
  associative, distributive properties; 0 as additive identity; 1 as
  multiplicative identity.
- Clarification notes (p. 42) list, among the properties to be known:
  "Addition and subtraction as inverse operations" and "Multiplication
  and division as inverse operations" — both named explicitly as
  separate bullets, alongside the identity-element properties.
- Worked example (p. 42): "If 33 + 99 = 132, then 132 – 99 = 33 and
  132 – 33 = 99."
- Separately, "Calculations using whole numbers" (Section 2, p. 13)
  gives a numeric floor: "Addition and subtraction of whole numbers to
  at least 6-digit numbers."

### Grade 8 (clarification notes, p. 75–76)

- Same property list repeated near-verbatim: "Addition and subtraction
  as inverse operations"; "Multiplication and division as inverse
  operations"; identity elements for addition/multiplication.
- Worked example (p. 76), same construction as G7: "a) 33 + 99 = 99 +
  33 = 132... e) if 33 + 99 = 132, then 132 – 99 = 33 and 132 – 33 =
  99." (Item (f), the multiplication/division inverse example, is also
  repeated identically: "if 20 × 5 = 110, then 110 ÷ 20 = 5 and 110 ÷ 5
  = 20" — already independently confirmed for `mulDivFluency`'s G7
  evidence; this is the first independent confirmation that the same
  worked pair repeats verbatim at G8.)
- Section 2's G8 "Calculations using whole numbers" row does not
  restate a new digit-count floor; it reads "Revise calculations using
  all four operations on whole numbers, estimating and using
  calculators where appropriate" — i.e. G8 revises G7's floor rather
  than stating a new one.

### Grade 9 (Section 2, "Properties of numbers", p. 119)

- G9's Section 2 topic renames to "Properties of numbers" and shifts
  focus to describing the real number system (natural → whole →
  integer → rational → irrational), not to restating the
  addition/subtraction or multiplication/division inverse-operation
  bullets specifically.
- Explicit general continuity statement is present: "In Grade 9
  learners consolidate number knowledge and calculation techniques for
  whole numbers, developed in Grade 8" — but this is a general
  statement about whole-number knowledge overall, not a
  construct-specific restatement of the inverse-operations property.
- No G9-specific worked example for addition/subtraction-as-inverse-
  operations was located in the pages reviewed.

## What this establishes

`addSub`'s "inverse operations" property has **named-and-worked
evidence at G7 and G8**, with the G8 instance now independently
confirmed (closing a specific gap the earlier relayed work could not
close). G9 continuity is present only as a general statement, not a
construct-specific one — the same evidentiary shape already
established for `mulDivFluency`'s G8/G9 boundary.

## Non-inference constraints in force

1. Do not assume G9 restates or drops the inverse-operations property
   based on its absence from the reviewed G9 pages — the general
   continuity statement neither confirms nor rules this out at the
   construct level.
2. Do not treat the G7 "at least 6-digit numbers" floor as applying
   unchanged at G8/G9 — Section 2's G8/G9 rows say "revise," not a
   restated digit count; no G8/G9-specific digit floor was located.
3. No numeric ceiling for addition/subtraction was located at any
   grade in the pages reviewed.
4. Do not treat this checkpoint as a form-level taxonomy scope
   decision (e.g. relationship to the "Properties of whole numbers"
   topic as a whole, or to `mulDivFluency`'s already-open bundling
   question, given both share the same "named as inverse-operations
   property under a shared topic" structure) — not assessed here.
5. Do not treat any existing addSub-related code implementation as
   specification evidence.

## What remains outstanding

- Form-level scope decision — not addressed by this document.
- G9 construct-specific evidence for addition/subtraction as inverse
  operations — not located; general continuity only.
- Numeric ceiling at any grade — not located.
- Whether `addSub`'s structural shape (named property under a shared
  "Properties" topic, evidenced identically at G7/G8, general-only
  continuity at G9) should be compared against the `mulDivFluency`
  precedent already on record — not addressed here.

---

*End of evidence-review checkpoint. No taxonomy, Generation Policy,
implementation, or test changes are made by this document.*
