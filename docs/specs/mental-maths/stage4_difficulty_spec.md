# Stage 4 — Difficulty Specification for C12 / C13 (Committed Checkpoint)

**Status:** Difficulty *model specification* only. No bands, cutoffs, scores, or product implementation. C1–C13 taxonomy and C12/C13 generation policy remain unmodified and frozen.

**Inputs used:** `c12_corpus.csv` (n=3,000), `c13_corpus.csv` (n=5,000), `generate.py`, `generation_meta.json`, `stage3b_findings.md`, Grade5_Arithmetic_Fluency_Draft_v0.1_Consolidated.md. No new corpus generation or sampling performed.

**Carried-forward open item:** the C12 equal-operand-addition ambiguity (Stage 3B finding) is referenced below where relevant, but is **not resolved** here.

---

## 1. Method

For each Stage 3B primitive, this stage records an explicit **accept / defer / reject** decision as a candidate difficulty-relevant feature, with justification grounded in (a) CAPS pedagogical reasoning already on record in the v0.1 spec, or (b) the empirical structure established in Stage 3B — never bare assumption. Redundant/derived features (established in Stage 3B) are excluded up front to avoid double-counting.

---

## 2. C12 — Candidate Features

| Feature | Decision | Justification |
|---|---|---|
| `operand_digit_tier_a` (= `_b`, redundant pair) | **ACCEPT** | CAPS-grounded: v0.1 spec treats 2-/3-/4-digit operand size as the primary CAPS-cited progression axis (Grade 4→6 digit-count scaling). Use one variable, not two (Stage 3B redundancy finding). |
| `carry_count` (addition) | **ACCEPT** | Empirically increases with `active_columns` (mean 1.01→1.52→1.46 across tiers 2→3→4) but is not fully determined by it (Stage 3B: spread confirmed at every active_columns value) — carries independent information about mental load beyond raw digit count. Pedagogically, carrying is a recognized source of mental-arithmetic difficulty. |
| `borrow_chain_length` (subtraction) | **ACCEPT** | Cleaner monotonic signal than carry_count: mean rises 0.39→0.88→1.40 across tiers 2→3→4, and is structurally bounded per tier (Stage 3B: {0,1} at tier 2, ≤3 at tier 4). Same pedagogical basis as carry_count, subtraction side. |
| `active_columns` | **DEFER** | Strongly related to `operand_digit_tier` (same underlying magnitude information) and to carry/borrow count. Stage 3B did not establish independence from operand tier as clearly as it did for carry/borrow vs. active_columns. Needs an explicit collinearity check against operand tier before being added as a separate model input — deferring rather than assuming it is additive. |
| `operand_closeness` | **DEFER** | No CAPS citation found linking operand closeness to difficulty, and no monotonic pattern across tiers in Stage 3B data (means 0.537 / 0.579 / 0.564 — flat, not trending). Plausible pedagogical rationale exists (close operands may reduce estimation shortcuts) but is not yet evidenced. Also entangled with the open equal-operand-addition ambiguity (closeness=1.0 cases). Defer pending either a CAPS grounding or a cleaner empirical signal. |
| `c_over_d_ratio` | **REJECT (for now)** | No CAPS grounding identified, no clear monotonic relationship tested, and its meaning differs by operation (defined differently for add vs. sub in the generator) — not a consistent cross-operation signal as currently computed. Would need redefinition before reconsideration. |
| `result_digit_tier` | **DEFER** | Deterministically related to operand tier + operation (not independent, per Stage 3B tier-crossing table) but not perfectly redundant (spread exists). Candidate for *secondary* signal only if operand tier + carry/borrow prove insufficient — do not add as a primary independent input without first checking overlap. |

**C12 provisional model shape:** a difficulty signal built from `operand_digit_tier` (primary) plus `carry_count` (addition items) or `borrow_chain_length` (subtraction items) as a secondary within-tier differentiator. This is a *shape*, not a scored formula — no weights or thresholds are specified here.

---

## 3. C13 — Candidate Features

| Feature | Decision | Justification |
|---|---|---|
| `b_value` | **ACCEPT** | Monotonic relationship with `product_digit_tier` confirmed in Stage 3B and reconfirmed here: mean product tier rises smoothly from 2.56 (b=2) to 2.98 (b=9). CAPS grounding: v0.1 spec cites multiplication-fact fluency (2–9) explicitly as the Grade 5 mental-calculation range: larger single-digit multipliers are recognized as a fluency progression axis. |
| `a_value` / `a_decade` | **ACCEPT** | Also monotonic (mean product tier 2.29 at decade 1 → flattens to 3.00 by decade 5+), and CAPS-grounded the same way as tens-range factor fluency. New Stage 4 finding: for `a_decade ≥ 5`, product_digit_tier is *always* 3 — meaning `a_decade` only carries difficulty-differentiating signal in the lower half of its range (decades 1–4). This ceiling effect must be accounted for in any model, not treated as linear across the full range. |
| `product_digit_tier` | **REJECT as independent input** | Confirmed in Stage 3B and here to be a deterministic function of (a_value, b_value) — 0 exceptions. Including it alongside a_value/b_value would double-count the same information. It may still be *reported* as a derived/display quantity, per Stage 3B's original disposition, but is not a model input. |
| `factor_ratio` | **DEFER** | Wide range (1.11–49.50) but no CAPS citation linking factor-ratio spread to difficulty, and no independence check yet performed against a_value/b_value (it's arithmetically `a/b`, so likely substantially collinear with both). Needs a collinearity check before consideration, same standard applied to C12's `active_columns`. |
| `nonzero_digit_count_a` | **DEFER** | Skewed (4,477 vs 523) but the skew is a direct consequence of a_value's own distribution (multiples of 10 are less numerous by definition, not by design choice), not a demonstrated difficulty driver on its own. No CAPS grounding identified. |

**C13 provisional model shape:** a difficulty signal built from `a_value` (or `a_decade`, with the ceiling effect above accounted for) combined with `b_value` — both accepted on the same evidentiary basis (monotonic empirical trend + CAPS fluency grounding), used jointly rather than either alone, since Stage 3B established their interaction (a_decade≥5 flattens b's differentiating effect on product tier).

---

## 4. Illustrative Examples (non-scored)

These illustrate how the accepted features would *differentiate* items — no numeric score or band is assigned.

- **C12:** `847 + 356` (tier 3, addition) has more carrying opportunity than `234 + 615` (tier 3, addition) even though both are the same operand tier — the model shape above would distinguish these via `carry_count`, not tier alone.
- **C13:** `12 × 2` (a_decade=1, b=2) sits at the low end of both accepted features; `88 × 9` (a_decade=8, b=9) sits at the high end of `b_value` but, per the ceiling finding, `a_decade` no longer differentiates once a≥50 — both a=51×9 and a=88×9 would look identical on the a_decade axis even though intuitively the operand size still differs. This is flagged as a real limitation of using `a_decade` (coarse) rather than raw `a_value` (fine) in the eventual model — not resolved here, just surfaced.

---

## 5. Checkpoint

| Item | Status |
|---|---|
| C12 candidate features evaluated | ✅ Complete (2 accept, 3 defer, 1 reject) |
| C13 candidate features evaluated | ✅ Complete (2 accept, 1 reject-as-independent, 2 defer) |
| Redundancy handling | ✅ Applied per Stage 3B findings (operand_digit_tier_a/b, product_digit_tier) |
| Model form | Shape specified (feature combination), not a scored formula |
| CAPS/Stage 3B grounding | ✅ Every accept/reject decision cites source |
| Bands / cutoffs | ❌ Not started (explicitly deferred) |
| Product implementation | ❌ Not started |
| Taxonomy / generation policy changes | ❌ None |
| Equal-operand-addition ambiguity | ⚠️ Still open, referenced not resolved |
| New corpus generation | ❌ None performed |

**Stage 4 — CLOSED** (specification only). Banding, if pursued, is a distinct future stage requiring its own authorization and checkpoint.
