# Stage 3B — Findings (Committed Checkpoint)

**Corpus:** `c12_corpus.csv` (n=3,000), `c13_corpus.csv` (n=5,000)
**Generator:** `generate.py`, seed=20260824, reproducible
**Policy source:** Grade5_Arithmetic_Fluency_Draft_v0.1_Consolidated.md, Sections 3 & 4 (frozen)
**Invariant validation:** 0 violations across both corpora (result range, subtraction ordering, matched-length tiers for C12; factor domains, exact division, quotient=a, a≠b for C13)

No difficulty bands, scores, rankings, or interpretive labels are included below — descriptive/independence findings only, per Stage 3B scope.

---

## C12 findings

1. **op × tier joint** — roughly balanced across all six (op, tier) cells (257–598 items each); operation and tier vary independently, no collapse.
2. **operand tier → result tier** — genuine spread at every tier (e.g. tier-3 operands produce results across tiers 2, 3, and 4). Confirms operand tier alone does not determine result tier.
3. **active_columns vs carry_count / borrow_chain_length** — correlated but not redundant: `active_columns=4` addition spans carry_count 0–3; `active_columns=4` subtraction spans borrow_chain_length 0–3. Distinct axes.
4. **operand_digit_tier_a / operand_digit_tier_b** — 0 mismatches across 3,000 items (redundant by construction under matched-length sampling). Treat as one feature going forward, not two.
5. **Tier-4 addition carry_count** — observed domain {0,1,2,3}. 4 structurally excluded (proven: would force a 5-digit result, barred by the frozen result constraint).
6. **Tier-2 subtraction borrow_chain_length** — observed domain {0,1}. 2 structurally excluded (proven: a>b forces tens(a)≥tens(b), which is incompatible with the tens-column-borrow condition tens(a)≤tens(b) unless tens digits are equal, which then contradicts the units-borrow condition).
7. **operand_closeness** — range **0.101–1.000** (verified directly against `c12_corpus.csv`, not a reporting error). Definition used: `1 - |a-b|/max(a,b)`. Reaches 1.000 specifically when a=b on **addition** draws (e.g. a=33,b=33, tier 2) — permitted under the frozen policy, since the equal-operand exclusion in Section 3 is stated only for subtraction, not addition.
   - **Open item, not resolved here:** whether equal operands were intended to be allowed on the addition side is not addressed one way or the other in the frozen v0.1 policy. Flagged for explicit decision before this is treated as settled, not assumed either way.
8. **c_over_d_ratio** — range 0.0014–9.9000, wide spread, no interpretation attached.

## C13 findings

1. **b_value × product_digit_tier** — strong, monotonic dependency: 2-digit products drop from 44% at b=2 to 2.5% at b=9. product_digit_tier is a deterministic function of (a_value, b_value); exclude from independent-variation analysis to avoid double-counting.
2. **a_decade × product_digit_tier — new joint finding** (not previously reported at this granularity): for `a_decade ≥ 5` (a≥50), 2-digit products never occur. 2-digit products are only reachable when a_decade ∈ {1,2,3,4} *and* b is small — a genuine joint constraint between a_decade and b_value, not captured by looking at either variable alone.
3. **(a,b) combinatorial coverage** — 717 of 720 possible pairs present in the 5,000-item sample (near-complete; the small envelope makes full coverage achievable at this n).
4. **nonzero_digit_count_a** — skewed (4,477 vs 523) but not zero-variance; the 523 correspond to the ten a-values ending in 0 (10,20,...,90).
5. **factor_ratio** — range 1.111–49.500, both domain boundary combinations present, not sampling artifacts.

---

## Checkpoint

- Stage 2B — CLOSED
- Stage 2C — CLOSED
- Stage 3A — CLOSED
- **Stage 3B — CLOSED** (this document)
- No taxonomy reopening, no v0.2 document, no difficulty bands/scores/rankings
- Open item carried forward (not resolved): C12 addition equal-operand permissibility (finding #7 above)
- Next stage (Stage 4) not yet started
