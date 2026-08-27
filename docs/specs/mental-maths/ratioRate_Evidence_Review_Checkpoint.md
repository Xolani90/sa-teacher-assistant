# Ratio Rate — Evidence Review Checkpoint

**Candidate:** `ratioRate`
**Layer:** Layer 1 — Evidence Review
**Status:** DRAFT FOR REVIEW
**Purpose:** Fresh, independent CAPS evidence review for the `ratioRate`
candidate. This document does not promote, reinterpret, extend, or rely upon
the existing `ratioRate_Retrieval_Exhaustion_Checkpoint.md`. It performs a
new review directly against the primary CAPS source. It does not constitute
a scope decision, grade authorization, generation authorization, or policy
decision.

---

## 1. Relationship to the existing retrieval-exhaustion checkpoint

`ratioRate_Retrieval_Exhaustion_Checkpoint.md` (committed `2b56fe2`) recorded
that a prior retrieval attempt for this candidate did not reach a usable
evidence conclusion. Per Project Owner instruction, this document does not
treat that checkpoint as a starting point, does not infer any content from
it, and does not carry forward any partial conclusion from it. The review
below is conducted afresh against the primary CAPS source only.

---

## 2. Evidence source

**Primary source:**

Official CAPS Senior Phase Mathematics Grades 7–9 document:

`CAPS_SP__MATHEMATICS_GR_7-9.pdf`

The evidence below is restricted to CAPS curriculum text concerning
"comparing two quantities of different kinds (rate)" and the combined
"ratio and rate" wording used at Grade 9, together with the directly
adjoining "direct and indirect proportion" material where CAPS presents it
in the same clarification block.

This checkpoint does not document evidence for "sharing in a given ratio
where the whole is given," which is the separate, already-reviewed
`ratioSharing` candidate. Where CAPS lists ratio-sharing content alongside
rate content in the same overview-table row, only the rate-specific content
is recorded here.

No implementation code, existing generator behaviour, or downstream policy
is used as evidence.

---

## 3. Grade 7 evidence

### 3.1 Section 2 overview table (Whole Numbers — Solving problems)

CAPS lists, as an explicit skill:

> Comparing two quantities of different kinds (rate)

### 3.2 Annual Teaching Plan clarification notes

CAPS states:

> Contexts involving ratio and rate, should include speed, distance and
> time problems.

No worked numeric example accompanies this clarification note. The
clarification block for Grade 7 moves directly from this sentence to
financial-context content (profit, loss, discount, etc.) without presenting
a solved ratio/rate problem.

**Evidence classification:** named skill, with named example-context
guidance (speed, distance, time), but no located worked numeric example.

**Grade:** G7.

---

## 4. Grade 8 evidence

### 4.1 Section 2 overview table (Whole Numbers — Solving problems)

CAPS lists the same skill as Grade 7:

> Comparing two quantities of different kinds (rate)

Grade 8 additionally lists a skill not present at Grade 7:

> Increasing or decreasing of a number in a given ratio

This additional skill concerns ratio, not rate specifically, and is noted
here only because it appears in the same overview-table cell; it is not
treated as rate evidence.

### 4.2 Annual Teaching Plan clarification notes

CAPS states, in wording materially identical to Grade 7:

> Contexts involving ratio and rate should include speed, distance and
> time problems.

No worked numeric example accompanies this clarification note at Grade 8
either. As at Grade 7, the clarification block moves directly to financial
contexts afterward.

Unlike some other candidates reviewed in this governance chain, this
Grade 8 material is not marked with an explicit "Revise" heading relative
to Grade 7; the skill and clarification wording are presented as
substantively the same statement repeated, not as a marked revision.

**Evidence classification:** named skill, with named example-context
guidance (speed, distance, time) materially identical to Grade 7, but no
located worked numeric example.

**Grade:** G8.

---

## 5. Grade 9 evidence

### 5.1 Section 2 overview table (Whole Numbers — Solving problems)

CAPS lists, as a single combined skill:

> Ratio and rate

alongside a new, separate skill not present at Grade 7 or Grade 8:

> Direct and indirect proportion

### 5.2 Annual Teaching Plan clarification notes

Grade 9's clarification material is headed:

> Ratio and rate problems

and includes:

> Include problems involving speed, distance and time. Learners should be
> familiar with the following formulae for these calculations:
> a) speed = distance / time
> b) distance = speed x time
> c) time = distance / speed

followed by an explicit "Examples" block containing two fully worked
problems, for example:

> A car travelling at a constant speed travels 60 km in 18 minutes. How
> far, travelling at the same constant speed, will the car travel in
> 1 hour 12 minutes?

and a second, comparable worked problem involving average speed over a
given distance and time.

**Evidence classification:** named skill (combined with "ratio"), with
explicit formulae and two located worked numeric examples.

**Grade:** G9.

---

## 6. Cross-grade evidence record

| Grade | Named skill | Worked numeric example located | Formulae given | Evidence tier |
|---|---|---|---|---|
| G7 | "Comparing two quantities of different kinds (rate)" | No | No | Named, with context guidance only |
| G8 | "Comparing two quantities of different kinds (rate)" (same wording, not marked as revision) | No | No | Named, with context guidance only |
| G9 | "Ratio and rate" (combined) | **Yes — two worked examples** | **Yes — speed/distance/time formulae** | Named-and-worked |

---

## 7. Notable structural asymmetry

This evidence pattern is the reverse of the pattern found in this
project's other reviewed mental-fluency candidates
(`multiplicationFactFluency`, `powersRootsFluency`), where Grade 7 and
Grade 8 carried the strongest (worked) evidence and Grade 9 evidence was
either absent or reframed outside the relevant heading.

For `ratioRate`, the Grade 7 and Grade 8 material reviewed here contains a
named skill plus non-worked contextual guidance, and no worked rate example
was located in that material during this review. Grade 9 is the only grade,
among those reviewed in this checkpoint, for which a worked numeric example
and explicit formulae were located. This is a statement about what this
review found in the reviewed Grade 7–9 material; it is not a claim that no
worked rate example exists anywhere else in CAPS or in material outside the
scope of this review.

This checkpoint records this asymmetry as a factual observation only. It
does not draw any conclusion from it about which grade or grades should be
authorized, and it does not apply any interpretive standard (such as the
"Mental calculations" heading test used for other candidates) to resolve
it. The Grade 7/8 material in this topic area is not presented under a
"Mental calculations" heading at any grade reviewed here, including Grade 9
— this differs from the heading-presence-or-absence pattern relevant to
`multiplicationFactFluency` and `powersRootsFluency`, where the heading
itself was part of the evidentiary picture at Grades 7–8. Whether that
difference matters, and if so how, is left entirely to a future Layer 2
judgment.

---

## 8. Separation from any Layer 2 judgment

No Layer 2 decision record exists yet for `ratioRate`. This checkpoint does
not create one.

In particular, this document does not:

- authorize any grade;
- exclude any grade;
- resolve the Grade 7/8 vs. Grade 9 asymmetry noted in §7;
- authorize generation;
- authorize implementation;
- modify the Generation Policy;
- establish a generation range, item form, or difficulty band beyond the
  CAPS wording recorded above; or
- treat the existing `ratioRate_Retrieval_Exhaustion_Checkpoint.md` as
  superseded, incorporated, or otherwise altered by this document.

A future, separate Project Owner decision is required before any scope or
grade authorization can be recorded for this candidate.

---

## 9. Provenance note

This checkpoint was produced by direct extraction and reading of
`CAPS_SP__MATHEMATICS_GR_7-9.pdf` in this session (`pdftotext -layout`,
followed by column-position verification of the Section 2 overview table
to correctly attribute each bullet to its grade column). It is a first-hand
extraction, not a secondhand or relayed quotation, and does not rely on any
prior session's characterization of this candidate.

---

## 10. Status

**EVIDENCE REVIEW CHECKPOINT — DRAFT**

No freeze.

No generation authorization.

No implementation authorization.

No policy amendment.

No new governance judgment.

No scope or grade authorization, for any grade, is implied by this
document.
