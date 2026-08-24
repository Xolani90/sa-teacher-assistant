# Grade 5 Arithmetic Fluency — Draft v0.1 Consolidated Frozen State

**Purpose:** Single authoritative reference consolidating all taxonomy decisions, generation-policy decisions, and test evidence produced to date. This document is the handoff point — difficulty-spec work does not begin until this is accepted as accurate.

---

## 1. Status / Authority Rules

Three distinct categories of statement appear in this document. They must never be conflated.

| Category | Definition | Can it be cited as CAPS fact? |
|---|---|---|
| **Taxonomy fact** | Directly evidenced by CAPS source material (demonstrated worked examples, or explicit CAPS text) | Yes |
| **Generation policy** | A choice made for the item generator (sampling method, magnitude envelope, guard rule, ordering rule) | **No — never.** These are engineering/design decisions, not claims about what CAPS specifies |
| **Test finding** | Empirical output of running a generator batch under a stated policy | No — describes generator behavior only, not CAPS |

**Explicit prohibition:** No generation-stage decision (magnitude envelope, sampling policy, guard, ordering rule) may be written back into a candidate's taxonomy row as if it were CAPS-derived evidence. Where a generation decision was informed by a CAPS data point (e.g., "demonstrated 4-digit coverage"), that data point remains labeled as a data point, not a ceiling/floor, unless the taxonomy row itself says otherwise.

**Status labels used throughout:**
- **CLOSED** — decision made, not currently subject to revision without a new bounded reason
- **LOCKED (provisional)** — decision made, but explicitly pending a further validation stage before being treated as final
- **OPEN** — decision deliberately not yet made
- **DEFERRED** — decision explicitly postponed, with the postponement itself on record
- **FLAGGED** — a characteristic observed and recorded, but neither accepted nor corrected; parked for a named future review stage

---

## 2. Complete C1–C13 Taxonomy Table

*(Taxonomy status only — carried forward from the last full freeze. Generation-policy detail for C12/C13 is in Sections 3–4, not here, to keep this table taxonomy-only.)*

| Candidate | Scope/form status | Numeric-range status | Evidence status | Open/deferred decisions |
|---|---|---|---|---|
| **C1** | OPEN — taxonomy scope decision deliberately deferred (Doubling/Halving) | OPEN | Demonstrated: doubling as estimation aid (near-equal addends). Named-but-unworked: "doubling and halving" appears as a general bullet in 3 locations, no Grade 5 worked example for halving-for-division or doubling-for-multiplication | **OPEN**: must decide whether named-but-unworked tier can ever license specific item forms (e.g., "halve to divide"). Non-inference rule in force: named-but-unworked bullet must NOT be treated as evidence for specific item structures |
| **C3** | Confirmed | OPEN + CAPS floor ("at least 4-digit") | — | Numeric ceiling undecided |
| **C5** | Confirmed | OPEN + CAPS floor ("at least 4-digit") | — | Numeric ceiling undecided |
| **C6** | Confirmed (worked evidence in Add/Sub topic) | OPEN | — | Numeric ceiling undecided |
| **C7** | Closed (prior session) | OPEN, floor evidence not adopted | — | — |
| **C8** | Closed (prior session) | **CLOSED** — any 4-digit (max 9,999) | — | — |
| **C12** | Closed (this session) — Block B paired form: `a ± b = □ therefore □ = c ∓ d` | OPEN (taxonomy) — see Section 3 for generation-stage magnitude, which is separate | Confirmed structural form; unknown-position confirmed result-only | — |
| **C13** | Closed (this session) — Block B paired form: `a × b = □ therefore □ = c ÷ d` | OPEN (taxonomy) — see Section 4 for generation-stage magnitude, which is separate | Confirmed structural form; unknown-position confirmed result-only | — |
| **C4** | DEFERRED | DEFERRED | — | Entire candidate deferred, not reopened this session |

**On C1 specifically:** this remains the one taxonomy candidate with an explicitly tracked (not assumed) open dependency. Generation-design exploration of C1's two evidence tiers is permitted, but neither tier may become an authoritative C1 item form without an explicit return to this taxonomy decision.

---

## 3. C12 Generation Specification — CLOSED (generation-policy level)

**Status:** CLOSED. This is a generation-stage decision. It establishes no CAPS numeric ceiling or floor.

| Dimension | Locked rule |
|---|---|
| Operand digit tier | 2-, 3-, or 4-digit |
| Tier selection | Equal probability across the three tiers |
| Pair structure | Both operands drawn from the same digit tier (matched-length; cross-length pairs eliminated) |
| Subtraction ordering | **Constructive**: draw two values `x, y` at the tier; assign `a = max(x,y)`, `b = min(x,y)` — not symmetric-draw-and-reject |
| Equal-operand subtraction draw (`x = y`) | Discarded. This is a mechanical consequence of the result floor (result would be 0, violating `result ≥ 10`) — **not** a new Block-A or pedagogical exclusion |
| Result range | 10–9,999, enforced as an explicit, independent constraint (not inferred from operand range) |
| 5-digit result | Forbidden — confirmed eliminated in testing (0 occurrences) |
| Operation balance | ~50/50 addition/subtraction, empirically achieved as a natural consequence of constructive ordering — **no separate rebalancing mechanism required or used** |
| Observed operand distribution (test batch) | ~34% / 39% / 27% across 2-/3-/4-digit tiers |
| Observed result distribution (test batch) | ~27% / 38% / 35% across 2-/3-/4-digit results |
| **`<20` operand characteristic** | **~7% of accepted items include an operand under 20 — FLAGGED, explicitly not filtered.** Recorded as a distribution characteristic for later difficulty-spec review, not a validity concern |

---

## 4. C13 Generation Specification — Magnitude LOCKED (provisional); Sampling CLOSED

**Status:** Magnitude envelope is LOCKED provisionally (pending downstream difficulty/generation-spec validation). Sampling policy within that envelope is CLOSED. Neither establishes a CAPS numeric ceiling.

| Dimension | Locked rule |
|---|---|
| Factor `a` | 10–99 |
| Factor `b` | 2–9 |
| Sampling method | Uniform, independent draw of `a` and `b` |
| Acceptance rate | 100% — confirmed via audit, not assumed |
| Product (natural range) | 20–891 |
| Structural form | Unchanged Block B paired construction: `a × b = □ therefore □ = c ÷ d`; `□` in result position only, both sentences |
| Operation reversal | Mandatory: × → ÷ |
| Arithmetic consistency | Mandatory: `c = a×b`; `d = b`; quotient must equal `a` — guaranteed by construction, not by post-hoc rejection |
| Exact division | Mandatory: `c % d == 0` |
| **Guards retained (formal safeguards)** | `a≠0`, `b≠0`, `a≠1`, `b≠1`, `divisor≠1`, `divisor≠dividend`, `a≠b` |
| **Guard status at current envelope** | **All seven numeric guards are confirmed structurally unreachable** (0 triggers across 100,000-attempt audit) — mathematically impossible given the disjoint domains, not merely rare. Guards remain in the formal rule set because they would activate immediately if the envelope is ever widened |
| `a ≠ b` guard — nature | Generation-design constraint preserving Block B's factor-pair fluency character (excludes perfect-square-adjacent items) — **not** a taxonomy/Block-A exclusion |
| 4-digit product generation | **Explicitly not required or pursued** under this envelope. CAPS' demonstrated 4-digit example remains a data point, not a generation target |
| Observed product-digit distribution | **14.8% 2-digit / 85.2% 3-digit / 0% 4-digit — FLAGGED for downstream difficulty review, not corrected.** This is a direct, expected consequence of the locked envelope, not a sampling defect |
| Observed `a`/`b` draw distribution | Flat across full range in both dimensions (all 90 values of `a`, all 8 values of `b`, roughly equal frequency) |

---

## 5. Source Anomalies On Record

These remain logged as source-material observations. Neither is attached as evidence to any candidate's taxonomy row, and neither is usable as reconstructed numeric evidence.

1. **`32×3 = □ therefore □ = 6÷3`** (found on C13's Term 1 Number Sentences source page) — internally inconsistent (32×3=96, not 6; 6÷3=2, not 32). Retained as structural evidence only (confirms the paired-sentence Block B *form* appears in source) — explicitly disqualified as magnitude/consistency evidence, and used in this session as the negative test case the C13 generation-time consistency guard was built to prevent from recurring.
2. **Missing numeral in "Learners add and subtract numbers with up to ___ digits"** (Addition/Subtraction topic, CAPS source) — genuine, non-reconstructible source gap. Not usable as ceiling evidence for C1, C6, C8, C12, or any other candidate.

---

## 6. Generation-Stage Decisions and Test Evidence

This section distinguishes evidence that **closed** a decision from evidence that **merely informed** a later or still-open decision.

### 6.1 C12 — Evidence trail (all closing)
- **Initial batch (uniform 10–9,999, no result constraint):** exposed Finding 1 — 35% of results exceeded 9,999. This finding **closed** the decision to add an explicit, independent result constraint.
- **Result-constraint fix verified:** 0% of results exceed 9,999 post-fix. **Closed.**
- **Sampling comparison — uniform vs. balanced-independent vs. matched-length:** exposed that balanced-independent introduced an unrequested cross-length item class and a 65.7/34.3 addition/subtraction skew. This **informed** (did not yet close) the choice of matched-length over balanced-independent.
- **Mechanism audit (four-stage instrumented trace):** determined the skew's true cause was the interaction between operand-magnitude distribution and the addition-overflow guard — not the subtraction ordering rule, and not retry mechanics (confirmed no retry occurs at any rejection point). This **closed** the misattribution from the prior step and **informed** the decision to separate magnitude-sampling from subtraction-ordering as two distinct design choices.
- **Constructive-subtraction-ordering test:** confirmed ~50/50 operation balance restored without a separate rebalancing mechanism, and 85.9% acceptance efficiency. This **closed** C12's full sampling policy.

### 6.2 C13 — Evidence trail (mixed: some closing, some informing)
- **Three-envelope comparison (2–9 / 2–19 / 2–99), pre equal-factor guard:** established the trade-off between 4-digit coverage and preservation of single-digit-factor fluency character. **Informed**, did not close, the envelope decision.
- **Equal-factor (`a=b`) form decision:** resolved as excluded — a generation-design constraint, not a taxonomy exclusion. **Closed.**
- **Rerun of three envelopes with `a≠b` guard added:** confirmed the guard's effect on magnitude distributions was negligible (≤1.05% rejection at any tested envelope) while correctly removing perfect-square-adjacent items from the sample (e.g., replaced `99×99` with `99×98` in the 2–99 high sample). **Closed** the question of whether the guard would distort the envelope comparison; **informed** the final envelope choice.
- **Envelope decision (10–99 × 2–9):** locked provisionally on the basis that preserving computational character (factor-pair fluency, not two-digit multiplication) outweighed reaching CAPS' demonstrated 4-digit coverage, which was explicitly reaffirmed as non-required. **LOCKED (provisional)** — not fully closed, pending downstream difficulty validation.
- **Sampling/mechanism audit (100,000-attempt instrumented trace):** confirmed all eight guards structurally unreachable (not merely rare) and confirmed accepted distribution equals raw distribution exactly (100% acceptance, no rejection-driven skew). **Closed** C13's sampling policy specifically.

---

## 7. Open-Dependency Register

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | C1 taxonomy scope decision (A vs B) | OPEN | Untouched this session; non-inference rule remains in force |
| 2 | C12 difficulty/sub-range treatment | Not yet started | May or may not be required — depends on broader generation-spec definition |
| 3 | C12 `<20` operand characteristic (~7%) | FLAGGED | Parked for difficulty-spec review |
| 4 | C13 product-digit distribution (14.8/85.2/0) | FLAGGED | Parked for difficulty-spec review |
| 5 | C13 overall provisional status | LOCKED (provisional) | Pending downstream difficulty/generation-spec validation before treated as final |
| 6 | Broader Grade 5 generation-spec constraints | Not yet defined | Difficulty progression across C3/C5/C6/C7/C8/C12/C13 as a coordinated set has not yet been addressed |

---

## 8. Explicit Next-Stage Gate

**Difficulty-spec work does not begin until this consolidated document is reviewed and accepted as the authoritative Draft v0.1 handoff.**

Once accepted, this document — not the preceding conversational chain — is the reference against which difficulty-spec proposals, further generation tests, and any reopening of provisional locks (C13 magnitude in particular) should be checked.
