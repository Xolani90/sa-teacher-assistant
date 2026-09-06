# CY79-PO-01 — `ratioRate` Generation Specification Decision Package

**STATUS: ACCEPTED — FROZEN (ADR-023 §6 freeze act recorded below)**

**Acceptance record:**
- **Project Owner:** Xolani Tshabalala
- **Date:** 6 September 2026
- **Scope of acceptance:** D1–D6 below, exactly as CY80-finalized, plus
  an explicit ADR-023 §6 freeze act over that same scope. D7
  (ratioSharing G9) is explicitly excluded — this acceptance does NOT
  authorize ratioSharing at any grade.
- This acceptance was given directly, in conversation with the
  engineering assistant carrying out this change, and is recorded here
  as stated by the Project Owner. It supersedes the "PROPOSED —
  AWAITING PROJECT OWNER ACCEPTANCE" status this document previously
  carried.

**Revision:** CY80 finalized D1–D7 below as the working production
design (see `CY79_RatioRate_Generation_Specification_DESIGN_PROPOSAL.md`,
CY80 revision, for full detail); a gated implementation + tests were
then prepared against it, and — per the acceptance above — that
implementation has now been wired into production (see "Implementation
status" below, updated post-acceptance).

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

## Implementation status (post-acceptance, wired into production)

Following the Project Owner acceptance recorded above, `ratioRate` has
been moved from its prior gated/PROPOSED state into production:

- `services/mentalMathsService.js`: `ratioRate` is now listed in
  `AUTHORIZED_FAMILIES` and in `FAMILY_GRADE_AUTHORIZATION` (`[9]`, per
  D2); `genRatioRateItem` (the deterministic RR-1/2/3 resolver,
  unchanged from the CY80 gated version) is wired into
  `GENERATORS_FAMILY`. The prior `PROPOSED_FAMILIES` /
  `PROPOSED_FAMILY_GRADE_AUTHORIZATION` / `generateProposedFamilySession`
  scaffolding has been removed — `generateFamilySession()` is now the
  one production entry point for `ratioRate`, same as
  `mulDivFluency`/`powersRootsFluency`/`ratioSharing`.
- `services/mentalMathsGrade9Service.js` (new): mirrors
  `mentalMathsGrade7Service.js` / `mentalMathsGrade8Service.js` exactly,
  exposing only the families `FAMILY_GRADE_AUTHORIZATION` lists for
  grade 9 (currently just `ratioRate`).
- `services/mentalMathsSessionService.js`: grade 9 added to the
  session-layer's grade-service map and to `FAMILY_LABELS`. Grade 9 now
  appears in `SUPPORTED_GRADES` (derived automatically, not
  hard-coded) and in the teacher-facing grade menu.
- `tests/ratioRate.test.js`: rewritten to exercise the production
  `generateFamilySession()` / Grade 9 dispatch path instead of the
  removed PROPOSED wrapper; RR-1/2/3 correctness, D3–D6 checks, and
  session determinism are all still independently re-verified from the
  prompt text, not just against the generator's own output.
- `tests/mentalMathsSessionService.test.js`,
  `tests/rc1-mentalmaths-dispatch.test.js`,
  `tests/rc1-mentalmaths-grade5-dispatch.test.js`: updated to reflect
  that Grade 9 is now genuinely available (these previously asserted,
  correctly at the time, that Grade 9 had no generation path at all).
- `ratioSharing` (D7) is untouched: still `[7]` only in
  `FAMILY_GRADE_AUTHORIZATION`, no G9 entry, no change to its generator.

---

## What accepting D1–D6 has done, and what it still does NOT do

The acceptance recorded above:

- IS an ADR-023 §6 freeze act over D1–D6;
- DID grant implementation authority for `ratioRate` at G9;
- DID move `ratioRate` into `AUTHORIZED_FAMILIES` (see "Implementation
  status" above) and wire it into production dispatch;

It still does NOT:

- resolve `ratioSharing` G9 (D7) — that remains separate and
  unresolved, and is explicitly excluded from this acceptance;
- authorize `ratioRate` at any grade other than 9;
- retroactively validate any other Senior Phase family's specification
  status (see the PROVENANCE NOTICE in `mentalMathsService.js`).

---

*End of decision package. D1–D6 ACCEPTED and FROZEN under ADR-023 §6 by
the Project Owner (Xolani Tshabalala, 6 September 2026), as recorded
above. D7 (ratioSharing) remains unresolved and outside this
acceptance's scope.*
