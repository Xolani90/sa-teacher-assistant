# CY79-PO-01 — `ratioRate` Generation Specification Decision Package

**STATUS: PROPOSED — DOES NOT CONSTITUTE PROJECT OWNER ACCEPTANCE**

> This document is PROPOSED and does not constitute Project Owner
> acceptance. It contains no "ACCEPTED", "FROZEN", or "AUTHORIZED"
> status of any kind. It exists to give the Project Owner a single,
> itemized list of the actual decisions required to move
> `ratioRate` toward generation eligibility, each traceable to the
> corresponding section of `CY79_RatioRate_Generation_Specification_DESIGN_PROPOSAL.md`.

Accepting, rejecting, or amending any single item below does not
accept, reject, or amend any other item. There is no bundled
"accept all" action implied by this document's existence, and no
action described here performs an ADR-023 §6 freeze act — that
remains a separate, dedicated act the Project Owner must perform
personally, in its own commit, after all relevant items below are
resolved.

---

## Decision items

### D1 — Item forms (spec §4)

Approve / reject / amend the proposed item-form taxonomy:

- RR-1: given speed & time, find distance (G9)
- RR-2: given distance & time, find speed (G9)
- RR-3: given distance & speed, find time (G9)
- Whether unit conversion is mandatory (spec §4.2, option a) or
  optional (spec §4.2, option b — this document's default proposal)
- Whether constant-speed/average-speed framing must be explicit in
  every generated item (spec §4.3)

**Decision required:** APPROVE / REJECT / AMEND, per sub-item if
desired.

### D2 — Grade restriction (spec §5)

Approve / reject the proposal to restrict generation-eligible item
forms to **G9 only**, despite the accepted G7–G9 scope authorization
permitting generation at G7/G8 in principle.

**Decision required:** APPROVE (generate G9 only) / REJECT (require
further evidence work to justify G7/G8 generation) / AMEND.

### D3 — Numeric/value ranges (spec §6)

Approve / reject / amend the proposed ranges:

- Speed: 1–200
- Time: 1–180 minutes or 1–12 hours
- Distance: 1–1000

**Decision required:** APPROVE / REJECT / AMEND.

### D4 — Rational/decimal domain (spec §7)

Approve / reject the proposal that generated quantities be
constrained so the unknown resolves to an exact terminating decimal
to at most 2 decimal places, with that exact decimal as the
canonical answer (no rounding, no fractional form).

**Decision required:** APPROVE / REJECT / AMEND.

### D5 — Generation constraints (spec §8)

Approve / reject the proposed constraint set (positive time/distance/
speed; internally consistent units before final calculation; exact-
to-2dp answer policy per D4).

**Decision required:** APPROVE / REJECT / AMEND.

### D6 — Exclusions (spec §9)

Approve / reject the proposed exclusion table:

- Direct/indirect proportion excluded from `ratioRate`
- `ratioSharing` content excluded from `ratioRate` (already governed
  by CY59-PO-02 — this item only confirms `ratioRate` does not
  silently absorb it)
- Ratio-only (non-rate) items excluded from `ratioRate`
- Zero/negative physical quantities excluded
- Multi-unknown / algebraic-manipulation items excluded

**Decision required:** APPROVE / REJECT / AMEND, per sub-item if
desired.

### D7 — `ratioSharing` G9 (not part of this specification, flagged for awareness only)

CY78 confirmed the "sharing in a given ratio" skill is absent from
the G9 solving-problems list entirely. This is new factual context,
not a proposal. The Project Owner may treat this as informative for
a separate `ratioSharing` decision act, but **no decision on this
point is requested as part of accepting or rejecting the `ratioRate`
specification** — `ratioRate`'s generation eligibility does not
depend on resolving it.

**Decision required:** NONE (informational only). A separate,
dedicated decision act would be needed if the Project Owner chooses
to act on this.

---

## What accepting D1–D6 in full would still NOT do

Even full approval of every item above would:

- NOT constitute an ADR-023 §6 freeze act;
- NOT grant implementation authority;
- NOT satisfy Ten-Point Review items 7, 8, 9, or 10 (§12 of the
  design proposal), which are independent of this candidate's
  generation content;
- NOT resolve `ratioSharing` G9;
- NOT authorize resolver/dispatch, generator, or test changes.

A subsequent, separate ADR-023 §6 freeze act — performed by the
Project Owner, in its own dedicated commit, explicitly distinguishing
evidence-derived findings from governance judgment per ADR-023 §9 —
would still be required before implementation could begin.

---

*End of decision package. PROPOSED ONLY. No item in this document has
been accepted, rejected, or amended by any authority other than the
Project Owner, and no such action is recorded here.*
