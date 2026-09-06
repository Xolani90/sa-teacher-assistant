# CY79 — `ratioRate` Generation Specification (Design Proposal)

**STATUS: PROPOSED — NOT FROZEN**
**GENERATION AUTHORITY: NOT GRANTED**
**PROJECT OWNER ACCEPTANCE: NONE**

This document supersedes CY72
(`CY72_RatioRate_Generation_Specification_PROPOSED.md`) as the working
proposal for `ratioRate`. CY72 deliberately populated every
generation-content field with `NOT ESTABLISHED` rather than propose
design content. This document takes the next step CY72 declined to
take: it proposes actual design content, but labels every rule with
its provenance so the Project Owner can see exactly which lines are
curriculum fact and which are this document's own invention.

This document does not modify `AUTHORIZED_FAMILIES` or
`FAMILY_GRADE_AUTHORIZATION`, or constitute an ADR-023 §6 freeze act.
It is a design artifact for Project Owner review, paired with a
separate decision package (`CY79_PO_01_Decision_Act__PROPOSED.md`).

**CY80 update:** D1–D6 below were finalized as the working production
design, and a gated (not production-wired) implementation and test
suite were prepared against them — see the "Implementation status"
section of `CY79_PO_01_Decision_Act__PROPOSED.md` for exactly what was
written and where. This is downstream engineering preparation, not a
Project Owner decision act; the status lines above remain accurate and
unchanged by it.

**Provenance labels used throughout:**

- `CAPS-EVIDENCED` — directly stated or shown in the primary CAPS
  source, independently verified against the actual PDF in CY78.
- `GOVERNANCE-PRECEDENT` — derived from an existing accepted Project
  Owner decision for this or a sibling candidate.
- `DESIGN-PROPOSAL` — this document's own invention. Not curriculum
  fact. Not precedent. Requires Project Owner approval or rejection.
- `NOT ESTABLISHED` — no evidence and no proposal; left open.

---

## 1. Evidence Basis

Primary source: `CAPS SP MATHEMATICS GR 7-9.pdf`, DBE, 2011,
ISBN 978-1-4315-0525-8. Directly inspected page-by-page in CY78
(SHA-256 `64dcd19ee1d67109ff4172d9b098259954a2e77a55aeae0d11ee7ec033b0d8f8`).

| Grade | CAPS-evidenced content | Page |
|---|---|---|
| G7 | Named skill "comparing two quantities of different kinds (rate)"; clarification note: "Contexts involving ratio and rate should include speed, distance and time problems." No worked example, no formula. | 42 |
| G8 | Identical skill and clarification wording to G7. No worked example, no formula. | 77 |
| G9 | Heading "Ratio and rate problems." Explicit formulae: speed = distance/time, distance = speed × time, time = distance/speed. Note: "Speed is usually given as constant speed or average speed." Note on unit conversion. Two worked examples (constant-speed distance-in-new-time problem; average-speed-to-match-new-time problem). Separately headed "Direct and Indirect proportion" subsection (not evidence for `ratioRate` item forms). | 120 |

CAPS supplies curriculum evidence, not a machine-generation
specification. Every field below that goes beyond the table above is
explicitly marked `DESIGN-PROPOSAL`.

---

## 2. Candidate Identity

`ratioRate` — distinct sibling of `ratioSharing`. **GOVERNANCE-PRECEDENT**
(CY59-PO-02, `a8b35e9`). Not reopened here.

---

## 3. Authorized Grade Scope

G7–G9. **GOVERNANCE-PRECEDENT** (CY62-PO-01, `e2c0c8c`). Scope
authorization only — does not itself grant generation authority, and
this document does not treat it as doing so.

---

## 4. Item Forms — `DESIGN-PROPOSAL`

CAPS shows exactly two worked example *shapes* at G9 and zero at
G7/G8. Neither example is presented by CAPS as an exhaustive or
prescriptive template. The taxonomy below is this document's own
generalization from those two examples plus the three-formula
triangle (speed/distance/time), not a CAPS-stated rule.

### 4.1 Core rate relationships — `DESIGN-PROPOSAL`

| Form ID | Known | Unknown | Operation | Grade(s) proposed | Basis |
|---|---|---|---|---|---|
| RR-1 | speed, time | distance | distance = speed × time | G9 | Directly mirrors CAPS formula (b); closest to worked example (a)'s underlying relationship |
| RR-2 | distance, time | speed | speed = distance / time | G9 | Directly mirrors CAPS formula (a) |
| RR-3 | distance, speed | time | time = distance / speed | G9 | Directly mirrors CAPS formula (c) |

All three forms are `DESIGN-PROPOSAL` as *generation templates* — CAPS
states the formulae (`CAPS-EVIDENCED`) but never says "generate
questions of exactly these three shapes and no others." Treating the
three algebraic rearrangements of one formula as three separate item
forms is this document's design choice, not a CAPS distinction.

### 4.2 Unit-conversion interactions — `DESIGN-PROPOSAL`

CAPS explicitly notes learners must "recognize and are able to convert
correctly between units for time and distance" (`CAPS-EVIDENCED`,
p.120), and both worked examples require a time-unit conversion
(minutes ↔ hours) mid-solution. Whether this is:

(a) a mandatory feature of every generated item, or
(b) an optional complication layered onto RR-1/RR-2/RR-3,

is **not stated by CAPS** and is proposed here as (b) —
`DESIGN-PROPOSAL` — on the reasoning that CAPS presents unit
conversion as a general competency check ("make sure learners
recognize...") rather than as a defining feature of the item type
itself. The Project Owner may reasonably prefer (a) instead; this
document does not consider its own choice self-evidently correct.

### 4.3 Constant-speed / average-speed framing — `DESIGN-PROPOSAL`

CAPS explicitly distinguishes "constant speed" from "average speed"
as a vocabulary point (`CAPS-EVIDENCED`, p.120: "Speed is usually
given as constant speed or average speed"), and both worked examples
use one framing each. Proposing that generated items must specify
which framing applies (rather than leaving "speed" unqualified) is
`DESIGN-PROPOSAL`, justified only by matching CAPS's own worked-example
practice — CAPS does not state this as a requirement.

### 4.4 Forms explicitly NOT proposed

- Any ratio-only item form (no rate/speed/distance/time element) —
  `NOT ESTABLISHED`. The G9 "Ratio and rate problems" block contains
  no ratio-only worked example; every example given is a rate example.
  Proposing a ratio-only `ratioRate` item form would extrapolate beyond
  even the loose G9 evidence.
- Direct/indirect proportion items — excluded; see §8 (Exclusions).
- Any G7/G8 worked-example-based form — `NOT ESTABLISHED`. No worked
  example exists at G7/G8 to generalize from.

---

## 5. Grade Differentiation — `DESIGN-PROPOSAL`, conservative

The evidence does **not** support a G7=easy/G8=medium/G9=hard
difficulty ladder — that would be inventing a difficulty band, which
is out of scope for this policy under ADR-022 §5 Rule 3, and CAPS
gives no numeric or structural basis for ranking the three grades
against each other.

What CAPS *does* support as a legitimate content-scope distinction:

- G7 and G8 (`CAPS-EVIDENCED`, identical wording both grades) name the
  rate-comparison skill and the speed/distance/time context, but
  supply **no formula and no worked example** at either grade.
- G9 (`CAPS-EVIDENCED`) is the only grade where CAPS itself supplies
  the S/D/T formula triangle and worked examples.

**Proposed grade differentiation (`DESIGN-PROPOSAL`):** restrict
generation-eligible item forms (§4.1–4.3) to **G9 only**, since G9 is
the only grade with any CAPS-evidenced worked-example basis to
generalize from. Do not propose generating rate items at G7/G8 under
this specification — CAPS gives a named skill at those grades but
nothing a generator could responsibly generalize from without
inventing content CAPS never showed for those grades specifically.

This is more conservative than the accepted G7–G9 scope authorization
(CY62-PO-01) would technically permit; the Project Owner may choose to
reject this narrowing and instead direct further evidence work for
G7/G8 rate items specifically, or accept the narrowing as this
document proposes it.

---

## 6. Numeric / Value Ranges — `DESIGN-PROPOSAL`

CAPS's two worked examples use specific values (60 km/18 min/1h12min;
100 km/h, 3h20min/2h40min) but never states these as bounds — using
them as a range would be the exact "example value ≠ generation range"
error this whole audit chain has been guarding against.

Proposed ranges (all `DESIGN-PROPOSAL`, no CAPS basis beyond general
plausibility for a Grade 7-9 arithmetic context):

| Quantity | Proposed range | Rationale |
|---|---|---|
| Speed | 1–200 (km/h or m/s, unit fixed per item) | Keeps results in a plausible real-world speed range; avoids trivial (0) and implausible (>200 km/h for a "car" context) values |
| Time | 1–180 minutes, or 1–12 hours | Matches the scale of both CAPS worked examples (minutes-to-hours range) |
| Distance | 1–1000 (km or m, matching the speed unit) | Keeps results within an intuitive magnitude; avoids requiring scientific notation |

These are starting points only. This document does **not** claim they
are correct, complete, or free of hidden difficulty assumptions — they
are offered so the Project Owner has something concrete to accept,
amend, or reject rather than an empty field.

---

## 7. Rational / Decimal Domain — `DESIGN-PROPOSAL`

CAPS does not state whether `ratioRate` answers must be integers,
terminating decimals, or exact fractions. Both worked examples happen
to produce clean numbers when solved correctly, but CAPS never states
this as a requirement, and nothing about "mental maths" in this
repository's other candidate reviews has been read as implying
integer-only by default.

**Proposed (`DESIGN-PROPOSAL`):** require that generated (speed, time)
or (distance, time) pairs be chosen so that the unknown resolves to an
exact terminating decimal to at most 2 decimal places — not because
CAPS says so, but as a generation-safety constraint to avoid producing
unanswerable-by-mental-arithmetic recurring decimals. This is a
generation-engineering judgment, not a curriculum one, and is exactly
the kind of choice this document is obligated to flag rather than
silently bake in.

**Canonical representation (`DESIGN-PROPOSAL`):** if adopted, the
canonical answer should be the exact decimal value in the unit stated
in the question (not a fraction, not a rounded value), since CAPS's
own worked examples produce exact values when solved correctly and
nothing suggests approximation is expected.

---

## 8. Generation Constraints — `DESIGN-PROPOSAL`

| Constraint | Provenance | Rationale |
|---|---|---|
| Time > 0 | DESIGN-PROPOSAL | Division by zero in speed = distance/time; not CAPS-stated but mathematically unavoidable |
| Distance > 0 | DESIGN-PROPOSAL | A meaningful physical distance; CAPS's examples are all positive-distance |
| Speed > 0 | DESIGN-PROPOSAL | Same reasoning |
| Units must be internally consistent before final calculation (matches §4.2) | DESIGN-PROPOSAL, informed by CAPS-EVIDENCED unit-conversion note (p.120) | CAPS explicitly flags unit-conversion competency; a generator must not silently mix incompatible units |
| No requirement for exact division vs. rounding — see §7 | DESIGN-PROPOSAL | Not CAPS-stated; proposed here as "exact to 2dp" per §7 |

No constraint here should be read as CAPS-evidenced; all are
generation-safety necessities or explicit engineering judgments.

---

## 9. Exclusions — `DESIGN-PROPOSAL` / `GOVERNANCE-PRECEDENT`

| Excluded content | Provenance | Rationale |
|---|---|---|
| Direct and indirect proportion (`y = kx`, `xy = k`) | DESIGN-PROPOSAL, informed by CAPS structure | CAPS presents this as a separately headed G9 subsection, not part of "Ratio and rate problems." Including it in `ratioRate` would silently absorb content CAPS itself separates. No governance decision has authorized a `directIndirectProportion` candidate at all — this is excluded from `ratioRate` specifically, not authorized elsewhere. |
| "Sharing in a given ratio where the whole is given" (ratioSharing content) | GOVERNANCE-PRECEDENT | CY59-PO-02 already treats this as `ratioSharing`'s exclusive content, not `ratioRate`'s. Confirmed in CY78: this skill does not appear in the G9 solving-problems list at all, so `ratioRate` absorbing it would have no G9 textual basis either. |
| Ratio-only comparison items with no rate element (e.g. "simplify 24:36") | DESIGN-PROPOSAL | No G9 (or any grade) worked example of this shape exists under the "Ratio and rate problems" heading; every example given is a rate example. Excluding this keeps `ratioRate` distinct from a hypothetical pure-ratio candidate that has never been evidenced or authorized. |
| Zero or negative physical quantities | DESIGN-PROPOSAL | See §8 constraints |
| Items requiring rational/algebraic manipulation beyond direct formula substitution (e.g. two unknowns) | DESIGN-PROPOSAL | Beyond both CAPS worked examples' complexity; would introduce content not evidenced for this candidate |

---

## 10. `ratioSharing` Boundary

**Not reopened.** `ratioSharing` G9 remains **unresolved / not
authorized**, per `ratioSharing_Grade_Scope_Decision_Record.md` —
unchanged by anything in this document.

CY78 independently confirmed (new data point, not a resolution): the
G9 "sharing in a given ratio" skill does not appear anywhere in the
G9 solving-problems list — only "ratio and rate" and "direct and
indirect proportion" do. This is *consistent with* `ratioSharing`
having no G9 evidence, but confirming an absence in the curriculum
text is not the same as a Project Owner decision, and this document
does not treat it as one. If the Project Owner wishes to use this data
point to finally resolve `ratioSharing` G9, that is a separate,
explicit decision item — not something this `ratioRate` proposal
performs on its behalf.

`ratioRate` does not absorb any `ratioSharing` content merely because
CAPS's G9 heading bundles "ratio and rate" together — see the
exclusion in §9.

---

## 11. Six-Condition Generation-Eligibility Gate

| Condition | Status | Basis |
|---|---|---|
| 1. Item forms | **POTENTIALLY SATISFIABLE BY PROPOSAL** — pending PO approval of §4 | This document proposes forms; none are yet approved |
| 2. Numeric/operand ranges with own evidence | **POTENTIALLY SATISFIABLE BY PROPOSAL** — pending PO approval of §6 | Proposed, not CAPS-derived, not yet approved |
| 3. Generation constraints | **POTENTIALLY SATISFIABLE BY PROPOSAL** — pending PO approval of §8 | Proposed, not yet approved |
| 4. Exclusions | **POTENTIALLY SATISFIABLE BY PROPOSAL** — pending PO approval of §9 | Proposed, not yet approved |
| 5. Completed 10-point Policy Completeness Review | **NOT SATISFIED** | See §12 — items 7, 8, 9, 10 remain open regardless of this proposal |
| 6. ADR-023 freeze act | **NOT SATISFIED** | No freeze act exists or is created by this document |

A proposal existing for conditions 1–4 is not the same as those
conditions being satisfied — satisfaction requires Project Owner
acceptance of the specific proposed content, which has not occurred.

---

## 12. Ten-Point Policy Completeness Review

1. **Item forms** — OPEN. Proposal exists (§4); not accepted.
2. **Numeric/operand ranges** — OPEN. Proposal exists (§6); not accepted.
3. **Rational-domain generation specification** — OPEN. Proposal exists (§7); not accepted.
4. **Difficulty bands** — N/A. Out of scope per ADR-022 §5 Rule 3; this document deliberately does not propose one (§5).
5. **Resolver/dispatch implications** — N/A to this document. Implementation-layer; not addressed, not authorized here.
6. **Excluded-candidate table** — N/A. `ratioRate` is an included candidate.
7. **`ratioSharing` ↔ `ratioRate` split justification** — OPEN. Candidate identity is settled (CY59-PO-02); the narrower pedagogical-justification question remains open per `ratioSharing_Supersession_Record.md`. Unaffected by this document.
8. **`ratioSharing` G9 status** — OPEN. Unresolved, as stated in §10. Not resolved by this document.
9. **ADR-023 stale §1 clarification** — OPEN. Unrelated mechanical matter; not addressed here.
10. **Whether the generation-eligibility gate should become ADR-022-recognized** — OPEN. Not decided by CY68-PO-01 or by this document.

---

## 13. Open Project Owner Decisions

See the companion decision package,
`CY79_PO_01_Decision_Act__PROPOSED.md`, for the itemized list of
approve/reject decisions this document generates.

---

## 14. Explicit Non-Authorizations

This document does NOT:

- grant generation authority to `ratioRate`;
- constitute Project Owner acceptance of any proposed rule;
- constitute an ADR-023 §6 freeze act;
- authorize implementation, resolver/dispatch changes, generator code,
  or tests;
- modify `AUTHORIZED_FAMILIES` or `FAMILY_GRADE_AUTHORIZATION`;
- resolve `ratioSharing` G9;
- resolve the `ratioSharing` ↔ `ratioRate` pedagogical-justification
  question;
- invent a difficulty band.

---

*End of CY79 design proposal. STATUS: PROPOSED — NOT FROZEN. Every
`DESIGN-PROPOSAL` line requires explicit Project Owner approval or
rejection before any implementation authority can exist.*
