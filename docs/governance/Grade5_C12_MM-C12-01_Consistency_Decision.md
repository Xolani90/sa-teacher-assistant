# Grade 5 Mental Maths C12 Paired-Clause Answer Consistency

**STATUS: ACCEPTED — Project Owner Decision Act under ADR-023 §4**

**Traceability:** MM-C12-01 (Cycle 50 finding); Cycle 51 governance-ambiguity
STOP; `docs/adr/ADR-023-repository-governance-decision-authority.md`;
`docs/governance/Grade5_C12_C13_ADR023_Section6_Freeze_Act.md`;
`docs/specs/mental-maths/Grade5_Arithmetic_Fluency_Draft_v0.1_Consolidated.md`
§§2–3.

---

## 0. Project Owner acceptance act (ADR-023 §4)

**Project Owner decision: ACCEPTED.**

- **Named artifact:** this document,
  `docs/governance/Grade5_C12_MM-C12-01_Consistency_Decision.md`
  (previously drafted and reviewed as
  `..._Consistency_Decision__PROPOSED.md`), together with the
  underlying finding it resolves, MM-C12-01 (Cycle 50).
- **Explicit statement of the act:** the Project Owner has explicitly
  accepted the decision recorded in §2 of this document, in full, as
  drafted, with no substantive changes — attributed to Project Owner
  authority under ADR-023 §3 (role holder: Xolani Tshabalala), not
  merely to a commit being made.
- **Date of acceptance:** 2026-09-05.
- **Distinct commit:** this acceptance is recorded in its own dedicated
  commit, containing only this status/acceptance-record change and
  this file's rename from its `__PROPOSED` draft name — no
  implementation, test, or unrelated content change is bundled with
  it, per ADR-023 §7.

This satisfies all four ADR-023 §4 elements: named artifact, explicit
act, Project Owner attribution, and a distinct identifiable commit.
The decision content itself (§§1–7 below) is unchanged from the
version reviewed prior to acceptance.

---

## 1. Problem

- C12's first clause (`a + b = □` / `a - b = □`) establishes the
  learner-facing answer at the value that satisfies that first
  equation — call it `firstClauseValue`.
- The current implementation (`services/mentalMathsGrade5Service.js`,
  `generateC12()`) sets `canonicalAnswer = result`, where `result` is
  exactly `firstClauseValue` (`a+b` for addition, `a-b` for
  subtraction, via constructive ordering).
- The current second (displayed, "therefore") clause is
  `□ = result − b` (addition) / `□ = result + b` (subtraction), which
  algebraically evaluates to `a`, not `result` — confirmed
  independently across 20,000 generated samples (Cycle 50 finding
  MM-C12-01; re-confirmed with an independent 20,000-sample check in
  the Cycle 51 governance-ambiguity report), with **0** matches
  between the second clause's value and `canonicalAnswer`.
- The frozen specification (`Grade5_Arithmetic_Fluency_Draft_
  v0.1_Consolidated.md` §3, frozen by
  `Grade5_C12_C13_ADR023_Section6_Freeze_Act.md`) locks C12's operand
  tiers, subtraction ordering, result range, and operation balance —
  but contains no line analogous to C13's §4 "Arithmetic consistency"
  row. The taxonomy table's abstract form `a ± b = □ therefore
  □ = c ∓ d` never maps `c`/`d` to concrete values for C12. The
  relationship the second clause is meant to assert was never decided.
- Result: the implementation and the existing regression test
  (`tests/mentalMathsGrade5Service.test.js`, `ok('canonicalAnswer ===
  result', ...)`) encode a self-consistent-looking invariant that is
  nonetheless pedagogically contradictory once the *displayed* second
  clause is read literally — the frozen spec never actually decided
  this, so the existing test is not itself a governance decision under
  ADR-023 §4, only an implementation/test assertion.

## 2. Decision (accepted)

> For C12, `canonicalAnswer` represents the result of the primary
> equation `a op b = □`. Any paired/derived ("therefore") clause
> associated with that same blank must mathematically evaluate to
> that same `canonicalAnswer` — not to `a` or to any other value.

### 2.1 Addition

```
canonicalAnswer = a + b
```

The derived clause must be re-specified so that it evaluates to
`a + b`, subject to the existing frozen C12 operand/result
constraints (operand tiers, matched-length pairing, result range
10–9,999, no 5-digit result).

### 2.2 Subtraction

```
canonicalAnswer = a - b
```

The derived clause must be re-specified so that it evaluates to
`a - b`, subject to the same existing frozen constraints (constructive
ordering `a = max(x,y)`, `b = min(x,y)`; equal-operand draws
discarded).

This document does not itself specify the exact revised wording of the
derived clause (e.g. whether it re-expresses the same operands in a
different order, or restates the check differently) — that is
implementation detail left to the remediation cycle authorized in §4
below, constrained to satisfy the invariant in §2.

## 3. Relationship to C13 — explicitly unchanged

This decision applies to C12 only. It does not change, reinterpret, or
reopen C13's existing convention (`canonicalAnswer = a`, i.e. the
quotient), its magnitude envelope (LOCKED provisional), its guards, or
any other C13 content in
`Grade5_Arithmetic_Fluency_Draft_v0.1_Consolidated.md` §4. C12 and C13
remain separate frozen structures with independently governed
conventions.

## 4. Implementation authorization (accepted — now in effect)

This decision, now accepted, authorizes — and only authorizes — a
subsequent, narrowly scoped remediation to `services/mentalMathsGrade5Service.js`
`generateC12()`, solely to make the generated derived clause
mathematically consistent with the invariant in §2, above. This
authorization does not extend to:

- any change to C13;
- any change to C12's operand tiers, pairing rule, subtraction
  ordering, or result range;
- any new difficulty band, operation type, or database structure;
- any LLM-dependent or randomized answer correction;
- any change to `mentalMathsSessionService.js`'s architecture or the
  Mental Maths dispatch/quota/session machinery audited in Cycles
  48–50;
- any change to Senior Phase Mental Maths.

## 5. Testing authorization (accepted — now in effect)

This decision, now accepted, authorizes adding focused
regression/property tests to
`tests/mentalMathsGrade5Service.test.js` proving, for both the
addition and subtraction branches, in bulk (mirroring the existing
sample-based pattern already in that file):

```
firstClauseValue === canonicalAnswer
derivedClauseValue === canonicalAnswer
```

including cases where `a !== result` (i.e. `b !== 0`), since those are
the cases that expose the original defect. C13's existing tests must
remain unchanged and continue passing.

## 6. Scope boundary

Explicitly out of scope for this decision and any resulting
remediation:

- C13 (unchanged, per §3);
- any Grade 5 difficulty-band or sub-range treatment (remains "not yet
  started" per the Freeze Act §5 register);
- any Senior Phase Mental Maths candidate or its Generation Policy;
- any architectural change to Mental Maths generation, dispatch,
  quota, or session-state machinery;
- any change to C12's frozen operand/result ranges (§3 of the
  Consolidated spec) unless separately, explicitly approved.

## 7. What this document does not do

- It does not itself perform an ADR-023 §6 Freeze Act.
- It does not modify
  `Grade5_Arithmetic_Fluency_Draft_v0.1_Consolidated.md`,
  `Grade5_C12_C13_ADR023_Section6_Freeze_Act.md`, or any other existing
  frozen/historical document — those remain as originally recorded.
- It does not itself change any code or test file.
- It does not constitute Project Owner authority merely by being
  drafted, per ADR-023 §3.2.

---

*End of decision. ACCEPTED by the Project Owner under ADR-023 §4 on
2026-09-05. The implementation authorization in §4 and the testing
authorization in §5 are now in effect, scoped exactly as stated in §6.
No implementation or test file is modified by this acceptance act
itself — this document records the governance decision only.*
