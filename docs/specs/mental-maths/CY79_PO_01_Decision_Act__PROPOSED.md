# CY79-PO-01 — `ratioRate` Generation Specification Decision Package

**STATUS: PROPOSED — AWAITING PROJECT OWNER ACCEPTANCE**

**Revision:** CY80 finalized D1–D7 below as the working production
design (see `CY79_RatioRate_Generation_Specification_DESIGN_PROPOSAL.md`,
CY80 revision, for full detail) and a gated implementation + tests have
been prepared against it (§"Implementation status" below). Finalizing
the design and preparing code does **not** constitute Project Owner
acceptance. This document still contains no "ACCEPTED", "FROZEN", or
"AUTHORIZED" status of any kind.

> This document is PROPOSED and does not constitute Project Owner
> acceptance. It exists to give the Project Owner a single, itemized
> list of the actual decisions required to move `ratioRate` toward
> generation eligibility, each traceable to the corresponding section
> of `CY79_RatioRate_Generation_Specification_DESIGN_PROPOSAL.md`.

Accepting, rejecting, or amending any single item below does not
accept, reject, or amend any other item. There is no bundled
"accept all" action implied by this document's existence, and no
action described here performs an ADR-023 §6 freeze act — that
remains a separate, dedicated act the Project Owner must perform
personally, in its own commit, after all relevant items below are
resolved.

---

## Decision items (CY80-finalized production design)

### D1 — Item forms (spec §4) — FINALIZED PROPOSAL

Three deterministic forms, each with exactly one unknown solved by a
plain-arithmetic resolver (never the LLM):

- **RR-1**: given speed & time, find distance (`distance = speed × time`)
- **RR-2**: given distance & time, find speed (`speed = distance ÷ time`)
- **RR-3**: given distance & speed, find time (`time = distance ÷ speed`)

Unit conversion is **not** required within a single item: each
generated item draws one time unit (minutes or hours) and stays
internally consistent in that unit throughout, per CY80 §2/D1.
Constant/average-speed framing is implicit in the "travels at X km/h"
phrasing used by every generated item.

**Decision required:** APPROVE / REJECT / AMEND, per sub-item if
desired.

### D2 — Grade restriction (spec §5) — FINALIZED PROPOSAL

Restrict generation-eligible item forms to **G9 only**, despite the
accepted G7–G9 scope authorization (CY62-PO-01) permitting generation
at G7/G8 in principle. This is recorded as a conservative
implementation-scope choice for production safety, not a claim that
CAPS requires G9-only treatment.

**Decision required:** APPROVE (generate G9 only) / REJECT (require
further evidence work to justify G7/G8 generation) / AMEND.

### D3 — Numeric/value ranges (spec §6) — FINALIZED PROPOSAL

- Speed: 1–200 (km/h)
- Time: 1–180 minutes, or 1–12 hours (one unit per item)
- Distance: 1–1000 (km)

These are implementation-generation constraints, not CAPS claims, and
are held in one versioned constant block
(`RATIO_RATE_RANGES` in `services/mentalMathsService.js`) rather than
scattered through the generator.

**Decision required:** APPROVE / REJECT / AMEND.

### D4 — Rational/decimal domain (spec §7) — FINALIZED PROPOSAL

Generated quantities are constrained so the unknown resolves to an
exact terminating decimal at at most 2 decimal places, used as-is as
the canonical answer (no rounding of an inexact value, no fractional
form). An item whose resolver output cannot satisfy this exactly,
within the configured D3 ranges, is discarded and regenerated (bounded
retry — 100 attempts — after which generation raises rather than
returning an inexact item).

**Decision required:** APPROVE / REJECT / AMEND.

### D5 — Generation constraints (spec §8) — FINALIZED PROPOSAL

Every generated item satisfies: exactly one unknown; exactly two known
quantities; all quantities positive; a single consistent time unit;
deterministic formula resolution and canonical answer; the D4
precision rule; and the D6 exclusions below.

**Decision required:** APPROVE / REJECT / AMEND.

### D6 — Exclusions (spec §9) — FINALIZED PROPOSAL

- Direct/indirect proportion excluded from `ratioRate`
- `ratioSharing` content excluded from `ratioRate` (already governed
  by CY59-PO-02 — this item only confirms `ratioRate` does not
  silently absorb it)
- Ratio-only (non-rate) items excluded from `ratioRate`
- Zero/negative physical quantities excluded
- Multi-unknown / algebraic-manipulation items excluded
- Ambiguous or incompatible units excluded
- Items requiring uncontrolled rounding excluded

**Decision required:** APPROVE / REJECT / AMEND, per sub-item if
desired.

### D7 — `ratioSharing` G9 (not part of this specification, informational only)

Unchanged from the original CY79 package. `ratioSharing` G9 status
remains **unresolved / not authorized**. No decision on this point is
requested or made as part of this document, and no authorization is
inferred merely because the G9 CAPS section presents ratio-and-rate
material together.

**Decision required:** NONE (informational only). A separate,
dedicated decision act would be needed if the Project Owner chooses
to act on this.

---

## Implementation status (CY80)

Per CY80's instruction to prepare implementation without bypassing
ADR-023, the following has been written **behind an explicit
governance gate**, not wired into any production dispatch path:

- `services/mentalMathsService.js`: a `PROPOSED_FAMILIES = ['ratioRate']`
  list, structurally separate from `AUTHORIZED_FAMILIES`; a
  `PROPOSED_FAMILY_GRADE_AUTHORIZATION` map (G9 only, per D2); the
  deterministic RR-1/2/3 resolver (`genRatioRateItem`); and a
  `generateProposedFamilySession()` entry point used only by tests.
  `generateFamilySession()` — the function actually called by
  `mentalMathsGrade7Service.js` / `mentalMathsGrade8Service.js` — is
  untouched and has no reference to any of this.
- `tests/ratioRate.test.js`: 32 tests covering RR-1/2/3 correctness
  (independently re-derived from each prompt, not just checked against
  the generator's own output), D3 ranges, D4 exactness, D5 constraints,
  D6 exclusions, session determinism/reproducibility, and the
  governance gating itself (`ratioRate` is asserted to be absent from
  `AUTHORIZED_FAMILIES`).

This code exists so that, if and when the Project Owner performs an
ADR-023 §6 freeze act, the only remaining production step is moving
`ratioRate` from `PROPOSED_FAMILIES` into `AUTHORIZED_FAMILIES` (and
its grade entry into `FAMILY_GRADE_AUTHORIZATION`) — a small, separate,
reviewable commit — rather than a design-and-build cycle. Writing and
testing this code is not itself a decision act and does not change any
item's status above.

---

## What accepting D1–D6 in full would still NOT do

Even full approval of every item above would:

- NOT constitute an ADR-023 §6 freeze act;
- NOT grant implementation authority;
- NOT itself move `ratioRate` into `AUTHORIZED_FAMILIES` — that wiring
  change still requires its own dedicated commit, made only after a
  freeze act;
- NOT resolve `ratioSharing` G9;

A subsequent, separate ADR-023 §6 freeze act — performed by the
Project Owner, in its own dedicated commit, explicitly distinguishing
evidence-derived findings from governance judgment per ADR-023 §9 —
would still be required before the prepared implementation could be
wired into production.

---

*End of decision package. PROPOSED ONLY. No item in this document has
been accepted, rejected, or amended by any authority other than the
Project Owner, and no such action is recorded here.*
