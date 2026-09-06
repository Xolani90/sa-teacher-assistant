# CY72 — `ratioRate` Generation Specification (Proposal)

**STATUS: PROPOSED — NOT FROZEN**

This document is a proposal prepared for Project Owner review. It does
not constitute Project Owner acceptance, authorization, or freeze. It
does not grant generation eligibility to `ratioRate`. It does not
authorize implementation, resolver/dispatch changes, production code,
tests, or any `AUTHORIZED_FAMILIES`/`FAMILY_GRADE_AUTHORIZATION`
change.

This proposal is evaluated against the Generation Policy v1.0
methodology, accepted as governance methodology only under CY68-PO-01
(commit `43e7e3f`, provenance-corrected in CY70, commit `ef264d3`).
Acceptance of that methodology does not authorize any content in this
document.

---

## A. Candidate Identity

- **Candidate name:** `ratioRate`
- **Sibling relationship:** distinct sibling of `ratioSharing` —
  **AUTHORITATIVE ACCEPTED DECISION**, CY59-PO-02 (`a8b35e9`). Rationale
  recorded there: materially distinct G7/G8 curriculum content
  (`ratioSharing` = sharing a whole in a given ratio; `ratioRate` =
  comparing two quantities of different kinds, including rate contexts
  such as speed/distance/time).
- **Authorized grade scope:** **G7–G9** — **AUTHORITATIVE ACCEPTED
  DECISION**, CY62-PO-01 (`e2c0c8c`). This proposal does not broaden,
  narrow, or reinterpret that scope.

---

## B. Governance Status

| Dimension | Current state |
|---|---|
| Candidate identity | ACCEPTED (CY59-PO-02) |
| Grade scope | ACCEPTED — G7–G9 (CY62-PO-01) |
| Generation authority | NOT GRANTED |
| Item forms | NOT ESTABLISHED |
| Numeric/value ranges | NOT ESTABLISHED |
| Generation constraints | NOT ESTABLISHED |
| Exclusions | NOT ESTABLISHED |
| Difficulty | NOT APPLICABLE TO THIS POLICY — out of scope per ADR-022 §5 Governance Rule 3 |
| Canonical answer | NOT ESTABLISHED |
| Randomization | NOT ESTABLISHED |
| Resolver/dispatch | NOT ANALYZED — implementation-layer concern, outside this proposal's authority |
| Freeze status | NOT FROZEN — no ADR-023 §6 freeze act exists for `ratioRate` or any candidate |

---

## C. Evidence-Derived Generation Requirements

### C.1 Item forms

**NOT ESTABLISHED.**

Repository evidence (`ratioRate_Evidence_Review_Checkpoint.md`,
`ratioRate_Retrieval_Exhaustion_Checkpoint.md`) names the skills
("comparing two quantities of different kinds," combined "ratio and
rate" at G9) and records two worked examples at G9 involving
speed/distance/time, but does not itself define a generation-ready
item-form taxonomy (e.g. "given rate and time, find distance," "given
two rates, compare," etc.). The evidence checkpoint explicitly states
it does not establish a generation range, item form, or difficulty
band (§8 of that document).

No item form is proposed here as a design judgment either — this
section is left unpopulated by design, per the instruction to prefer
`NOT ESTABLISHED` over invented content for anything touching exact
generation behavior.

### C.2 Numeric/value ranges

**NOT ESTABLISHED.**

No repository document specifies operand ranges, ratio ranges, rate
ranges, quantity bounds, units, denominators, integer/decimal domains,
or percentage relationships for `ratioRate`. Per ADR-022 §5 Governance
Rule 2 and the Generation Policy §0, existing code values (`FLAT_RANGES`
and similar) carry no evidentiary weight and are explicitly excluded
as a source for this section.

### C.3 Exactness

**NOT ESTABLISHED.**

No repository document states whether `ratioRate` items require exact
division, terminating decimals, integer answers, acceptable fractional
answers, rounding, or tolerance. This proposal does not infer any of
these from general mathematical convention.

### C.4 Generation constraints

**NOT ESTABLISHED.**

No constraint (e.g. exact-vs-rounded output rules) is recorded for
`ratioRate` anywhere in the repository.

### C.5 Exclusions

**NOT ESTABLISHED.**

No exclusion (disallowed operand combination, disallowed item shape,
etc.) is recorded for `ratioRate`. None is manufactured here to
simulate completeness.

---

## D. G7 / G8 / G9 Analysis

This section is **REPOSITORY EVIDENCE**, drawn directly from
`ratioRate_Evidence_Review_Checkpoint.md` §6–§7. It is not a proposal
design judgment.

| Grade | Named skill | Worked numeric example | Formulae given | Evidence tier |
|---|---|---|---|---|
| G7 | "Comparing two quantities of different kinds (rate)" | No | No | Named, with context guidance only |
| G8 | "Comparing two quantities of different kinds (rate)" (same wording, not marked as revision) | No | No | Named, with context guidance only |
| G9 | "Ratio and rate" (combined with `ratioSharing`'s ratio content) | **Yes — two worked examples** | **Yes — speed/distance/time formulae** | Named-and-worked |

**Notable structural asymmetry (REPOSITORY EVIDENCE, factual
observation only):** unlike other reviewed candidates
(`multiplicationFactFluency`, `powersRootsFluency`), where G7/G8
carried the strongest evidence and G9 was weaker or absent, `ratioRate`
shows the reverse pattern — G7/G8 evidence is named-but-unworked, and
G9 is the only grade with worked examples and explicit formulae. The
evidence checkpoint records this without drawing any authorization or
generation conclusion from it.

**G9 caveat — classified as `DRAFTING CONSTRAINT`:**

CY62-PO-01 §4 and §6 disclose, and this proposal preserves without
resolution, that the relationship between the G9 "Ratio and rate"
treatment and the G7/G8 rate-comparison construct is not established
as being:

1. a straightforward continuation of the earlier construct;
2. a broadened or restructured treatment; or
3. a distinct curricular treatment.

This proposal does not assume any of the three. Any future
item-form/range work for G9 must treat this as an open structural
question, not silently resolve it toward whichever interpretation is
most convenient for drafting.

Whether the evidence is sufficient to support a **common construct**
across G7–G9, or whether grade-specific generation constraints are
necessary, is itself **NOT ESTABLISHED** — this proposal takes no
position on it.

---

## E. `ratioSharing` Separation

`ratioSharing ≠ ratioRate` is preserved exactly as decided in
CY59-PO-02 — **AUTHORITATIVE ACCEPTED DECISION**, not reopened,
reinterpreted, or expanded by this document.

The available evidence (distinct G7/G8 curriculum content, per
CY59-PO-02 §2) is sufficient to justify their governance separation as
distinct candidates. Whether their combined G9 curriculum presentation
was ever independently pedagogically justified (a narrower, historical
question distinct from candidate identity) remains **UNRESOLVED** —
see `ratioSharing_Supersession_Record.md`. This proposal does not
resolve that question and does not need to in order to describe
`ratioRate`'s own generation-readiness state.

`ratioSharing` G9 status: **UNRESOLVED** (recorded as "not authorized
/ unresolved" in `ratioSharing_Grade_Scope_Decision_Record.md`). This
proposal does not resolve it and does not expand its own scope to
cover `ratioSharing`. Because both candidates' G9 evidence derives from
the same merged "Ratio and rate" G9 curriculum bullet, this unresolved
status is evidentiarily relevant context for §D's G9 caveat above, but
is not itself part of `ratioRate`'s own authorized scope or generation
content.

---

## F. Six-Condition Generation-Eligibility Gate

| Gate condition | Status | Evidence / blocker |
|---|---|---|
| 1. Item forms | NOT SATISFIED | §C.1 — no item form established |
| 2. Numeric/operand ranges with own evidence | NOT SATISFIED | §C.2 — no range established; existing code values excluded per ADR-022 §5 Rule 2 |
| 3. Generation constraints | NOT SATISFIED | §C.4 — none established |
| 4. Exclusions | NOT SATISFIED | §C.5 — none established |
| 5. Completed 10-point Policy Completeness Review | NOT SATISFIED | See §G below — multiple open items |
| 6. ADR-023 §6 freeze act | NOT SATISFIED | No freeze commit exists for `ratioRate` or any candidate |

**No condition is satisfied.** The existence of this proposal does not
itself satisfy any gate condition, and does not imply generation
eligibility for `ratioRate`.

---

## G. Ten-Point Policy Completeness Review — Applied to This Proposal

1. **Item forms**
   STATUS: Open
   EVIDENCE: §C.1 — not established
   IMPLICATION: Blocks gate condition 1; blocks freeze

2. **Numeric/operand ranges**
   STATUS: Open
   EVIDENCE: §C.2 — not established
   IMPLICATION: Blocks gate condition 2; blocks freeze

3. **Rational-domain generation specification**
   STATUS: Not applicable to `ratioRate` as currently evidenced
   EVIDENCE: No rational-number ratio/rate evidence has been reviewed for this candidate anywhere in the repository
   IMPLICATION: No rational-domain rule exists to evaluate; not a current blocker distinct from §C.2/§C.4, but no substitute exists either

4. **Difficulty bands**
   STATUS: Not applicable
   EVIDENCE: ADR-022 §5 Governance Rule 3 places difficulty bands out of scope for this policy entirely
   IMPLICATION: No effect on this proposal's readiness

5. **Resolver/dispatch implications**
   STATUS: Not analyzed
   EVIDENCE: Outside this policy's and this proposal's authority — an implementation-layer concern
   IMPLICATION: No effect on proposal readiness; relevant only at implementation time, which is not authorized here

6. **Excluded-candidate table**
   STATUS: Not applicable
   EVIDENCE: `ratioRate` is an included candidate (Generation Policy §1–§2), not an excluded one
   IMPLICATION: No effect

7. **`ratioSharing` ↔ `ratioRate` split justification**
   STATUS: Partial / open
   EVIDENCE: Candidate identity resolved (CY59-PO-02); the narrower question of whether the original split was ever pedagogically justified remains open (`ratioSharing_Supersession_Record.md`)
   IMPLICATION: Does not block this proposal's own drafting; remains a disclosed open item

8. **`ratioSharing` G9 status**
   STATUS: Open
   EVIDENCE: `ratioSharing_Grade_Scope_Decision_Record.md` — "not authorized / unresolved"
   IMPLICATION: Evidentiarily relevant to `ratioRate`'s own G9 drafting constraint (§D); not itself resolved by, or a blocker to, this proposal

9. **ADR-023 stale §1 clarification**
   STATUS: Not an outstanding blocker
   EVIDENCE: Unrelated mechanical ADR-023 matter, not connected to `ratioRate` content
   IMPLICATION: No effect

10. **Whether the generation-eligibility gate should become ADR-022-recognized**
    STATUS: Deferred
    EVIDENCE: Generation Policy §10 item 10; not decided by CY68-PO-01's acceptance of the methodology
    IMPLICATION: No effect on this proposal; remains an open, separate question

---

## H. Proposal vs. Established Rules

No content in Sections C, D, or E is presented as CAPS evidence,
accepted Project Owner decision, frozen specification, or Generation
Policy authorization unless explicitly cited as such. Every
generation-content field in Section C is marked `NOT ESTABLISHED`
rather than populated with a design judgment, because this proposal
contains no `PROPOSED DESIGN — NOT AUTHORITATIVE` content — none was
introduced, since doing so would require design choices not
supportable by any current repository evidence, and this cycle's
governing instructions direct `NOT ESTABLISHED` over invention.

---

## I. Project Owner Decision Boundary

### Already accepted
- `ratioRate` candidate identity (CY59-PO-02)
- `ratioRate` G7–G9 grade scope (CY62-PO-01)
- Generation Policy v1.0 as governance methodology only (CY68-PO-01)

### Still requiring establishment/approval
- A candidate-specific `ratioRate` generation specification (item
  forms, numeric/operand ranges, constraints, exclusions,
  exactness/`canonicalAnswer` rules) — none of which this proposal
  establishes
- Resolution (or an explicit decision to proceed despite non-
  resolution) of the G9 structural caveat (§D)
- Satisfaction of all six generation-eligibility gate conditions (§F)
- Completion of the ten-point Policy Completeness Review for this
  specific candidate (§G) — currently open on items 1, 2, 3 (partial),
  7 (partial), 8
- A dedicated ADR-023 §6 freeze act, performed personally by the
  Project Owner, before any of the above could become
  implementation-authoritative

This document does not state or imply that the Project Owner has
accepted any of the above. It is prepared for review only.

---

*End of CY72 proposal. STATUS: PROPOSED — NOT FROZEN. No generation
eligibility, generation authority, or implementation authority is
established by this document.*
