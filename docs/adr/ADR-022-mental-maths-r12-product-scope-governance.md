# ADR-022: Mental Maths R–12 Product Scope & Specification Governance

**Status:** Accepted
**Depends On:** —
**Related:** `docs/specs/mental-maths/Grade5_Arithmetic_Fluency_Draft_v0.1_Consolidated.md`, `docs/specs/mental-maths/stage3b_findings.md`, `docs/specs/mental-maths/stage4_difficulty_spec.md`, `utils/capsPhase.js`, `RC1-MILESTONE.md` ("Out-of-Scope Feature Work — Mental Maths")

## 1. Status

Proposed. This ADR establishes product scope and specification
governance only. It does not authorize any implementation, does not
modify any existing code, and does not itself constitute a
specification for any phase or grade.

## 2. Context

Mental Maths currently exists as two independent, ungoverned-by-ADR
implementations:

- **Senior Phase (Grades 7–9)** — `services/mentalMathsService.js`,
  the earliest Mental Maths work (`0f067e0`). No frozen specification
  document exists for it anywhere in `docs/specs/mental-maths/`; it
  predates the specification discipline the Grade 5 work later
  established.
- **Grade 5 (Candidates C12/C13)** — `services/mentalMathsGrade5Service.js`,
  built against a frozen spec chain
  (`Grade5_Arithmetic_Fluency_Draft_v0.1_Consolidated.md` →
  `stage3b_findings.md` → `stage4_difficulty_spec.md`). This chain
  freezes the C12/C13 taxonomy and generation policy, and separately
  freezes a difficulty *feature-shape* analysis (Stage 4) — explicitly
  not bands, cutoffs, scores, or product implementation.

Neither implementation was authorized by an ADR. Both are recorded in
`RC1-MILESTONE.md` as out-of-scope feature work: excluded from RC1
PASS/FAIL scoring, not introduced to fix an RC1 blocker, and therefore
not covered by the Feature Freeze exception.

A recent audit found that a Grade 5 implementation detail — difficulty
banding (`c12Band()`/`c13Band()`, `C13_BAND_CUT_1/2`) — had been built
and shipped with production-facing tests, citing a
`stage5_difficulty_bands.md` source document that does not exist, while
Stage 4's own checkpoint explicitly recorded difficulty banding as "not
started (explicitly deferred)." The banding was removed (commit
`0236ecb` on `origin/main`) after governance review confirmed it had no
legitimate specification authority.

Neither the Senior Phase nor the Grade 5 implementation covers all of
CAPS Grades R–12. Foundation Phase (R–3), Grades 4 and 6, and FET
(10–12) have no Mental Maths implementation and no specification of any
kind. `utils/capsPhase.js` already exists as shared infrastructure
defining the four CAPS phase boundaries (Foundation R–3, Intermediate
4–6, Senior 7–9, FET 10–12), but is not currently referenced by either
Mental Maths service, both of which define their own independent grade
constants.

The product direction has now been set: Mental Maths has a product
target of covering all CAPS Grades R–12. That direction needs to be
recorded as a governed decision before any further specification or
implementation work begins, precisely because the banding incident
demonstrated what happens when implementation outruns explicit
authorization.

## 3. Decision

Mental Maths is established as a product direction with a product
target of covering all CAPS Grades R–12, spanning all four CAPS
phases:

- **Foundation** — Grades R–3
- **Intermediate** — Grades 4–6
- **Senior** — Grades 7–9
- **FET** — Grades 10–12

This decision authorizes the *product direction and the governance
process* for reaching that target. It does not authorize any specific
mathematical content, candidate item forms, number ranges, difficulty
model, or code for any phase not already implemented, and it does not
retroactively elevate the existing Grades 7–9 implementation to
specification authority.

## 4. Scope

In scope for this ADR:

- Declaring the R–12 product target.
- Establishing the specification lifecycle every phase/grade must pass
  through before implementation is authorized.
- Declaring `utils/capsPhase.js` as canonical for grade-to-phase
  mapping.
- Declaring the standing rule that difficulty modeling is never
  implicitly authorized by a taxonomy or generation specification.
- Naming the four future phase-specification tracks and a provisional
  sequencing preference.
- Recording the current governance status of existing Mental Maths
  work (Grade 5, Senior Phase) so this ADR does not silently alter it.

Explicitly out of scope for this ADR — these are downstream artifacts
requiring their own future work, review, and (where applicable) their
own frozen specification and checkpoint:

- Any new candidate taxonomy (e.g. no C14/C15/etc. is defined here).
- Any number range, magnitude envelope, or generation policy for any
  ungoverned phase or grade.
- Any difficulty band, score, cutoff, or weight, for any phase.
- Closing Grade 5's existing OPEN/DEFERRED taxonomy items (C1, C4, and
  the open numeric-range items on C3/C5–C8).
- Producing a frozen specification for Senior Phase (7–9) — this ADR
  authorizes that backfill as future work; it does not perform it.
- Producing any Foundation, Intermediate (4/6), or FET specification.
- Any change to `utils/capsPhase.js`.
- Any change to `services/mentalMathsService.js` or
  `services/mentalMathsGrade5Service.js`.
- Any new or modified tests.

## 5. Governance Rules

1. **No implementation without a frozen specification.** No new Mental
   Maths implementation, for any phase or grade, may be treated as
   authoritative until its applicable specification has been authored,
   reviewed, frozen, and explicitly checkpointed — mirroring the
   process already used for Grade 5's taxonomy and generation-policy
   chain.
2. **Existing code is not specification authority.** Code that exists
   today (most importantly, the Grades 7–9 Senior Phase service) does
   not itself constitute an authoritative specification merely by
   virtue of already being deployed. Where implementation and
   specification are both wanted for an existing feature, the
   specification is produced and reviewed first, documenting and
   validating the intended design — it is not permitted to reverse the
   order and declare existing behavior retroactively correct without
   that review.
3. **Difficulty modeling requires independent authorization.**
   Difficulty bands, scores, cutoffs, weights, or any other difficulty
   model are never authorized implicitly by a taxonomy specification or
   a generation-policy specification, regardless of phase. Each
   requires its own explicit authorization and its own specification
   and checkpoint, following the accept/defer/reject, CAPS-or-empirical
   grounded methodology Stage 4 already established as precedent. This
   rule exists specifically because the recently removed Grade 5
   banding was built without this authorization.
4. **This ADR does not retroactively close open items.** Nothing in
   this ADR resolves, closes, or reinterprets any OPEN, DEFERRED, or
   otherwise unresolved status recorded in existing Mental Maths
   specification documents.

## 6. Relationship to Existing Mental Maths Work

- **Grade 5 (C12/C13):** The frozen generation policy in
  `Grade5_Arithmetic_Fluency_Draft_v0.1_Consolidated.md` (Sections 3–4)
  remains authoritative and unchanged by this ADR. Existing OPEN and
  DEFERRED taxonomy items (C1's taxonomy-scope decision, C4's full
  deferral, and the open numeric-range status on C3/C5–C8) remain in
  their current status; this ADR does not close them. The difficulty
  banding removed in commit `0236ecb` remains removed; this ADR creates
  no authorization, implicit or explicit, to reintroduce it. Stage 4's
  difficulty feature-shape analysis remains scoped to C12/C13
  specifically and is not generalized to other candidates or phases by
  this ADR.
- **Senior Phase (Grades 7–9):** The existing implementation is
  recognized as legacy — functioning, deployed, and covered by its own
  tests, but built prior to the specification discipline and without a
  frozen spec of its own. This ADR authorizes producing a new,
  authoritative specification for Senior Phase, informed by CAPS and
  empirical evidence. The existing service may be inspected as
  implementation reference and for compatibility considerations, but
  CAPS requirements and empirical evidence govern the specification —
  existing behavior is not presumed correct merely because it is
  implemented or deployed. This ADR does not authorize modifying the
  service itself as part of that specification work.

## 7. CAPS Phase Authority

`utils/capsPhase.js` is declared the canonical source for CAPS
grade-to-phase boundary mapping (`PHASES`, `getPhase()`, and related
utilities) for all Mental Maths specification and implementation work
going forward. New phase specifications should reference it rather than
independently redefining phase boundaries.

This does not require Mental Maths generators themselves to share a
single implementation or a single grade-range constant across phases.
Grade 5's deliberate architectural isolation from the Senior Phase
service (independent `MIN_GRADE`/`MAX_GRADE`, no shared fork) is a
service-boundary decision and is orthogonal to phase-boundary
canonicity — both can hold at once. This ADR resolves only the
phase-boundary-source question; it does not mandate a shared service
architecture.

## 8. Specification / Authorization Lifecycle

Every phase or grade brought into Mental Maths scope, existing or new,
follows this lifecycle before implementation is authorized:

```
Taxonomy / candidate-form specification
   ↓
Generation policy
   ↓
CAPS / empirical validation
   ↓
Specification freeze + checkpoint
   ↓
[Difficulty analysis — only if explicitly opened]
   ↓
[Difficulty bands — only if separately authorized]
   ↓
Implementation
   ↓
Runtime / test verification
```

The bracketed stages are not mandatory deliverables for every phase or
grade. A specification may reach Implementation with those stages left
untouched and deferred; nothing in this lifecycle requires a difficulty
model to be produced merely because the stage exists in the diagram.
Requiring difficulty analysis by default would recreate the same
pressure that produced the unauthorized Grade 5 banding this ADR exists
to prevent a repeat of. Each bracketed stage is opened only by its own
explicit, separate authorization, per Governance Rule 3 above.

Four phase-specification tracks are established by this ADR as the
future work items this lifecycle will apply to. None are authored,
reviewed, or frozen by this ADR:

- Foundation specification — Grades R–3
- Intermediate specification — Grades 4–6. Grade 5 C12/C13 remains
  governed by its existing frozen specification chain; that existing
  chain is not invalidated or required to be rewritten merely because
  this umbrella ADR establishes the broader Intermediate track. Any
  future expansion of Grade 5 beyond the frozen C12/C13 scope requires
  its own specification work and authorization.
- Senior specification — Grades 7–9 (new authoritative specification,
  informed by CAPS and empirical evidence; existing implementation may
  be used only as an implementation reference and compatibility input,
  not as specification authority)
- FET specification — Grades 10–12

Individual candidate item forms, number ranges, and other mathematical
content are not prescribed here; they belong in each phase's own
specification once that work begins.

Sequencing of the four specification tracks is intentionally left to
subsequent planning decisions and does not form part of this ADR's
authorization.

## 9. RC1 Relationship

This ADR and the R–12 Mental Maths programme it authorizes are
explicitly outside RC1 acceptance and scoring. They do not alter the
frozen RC1 baseline, do not satisfy any RC1 acceptance criterion, and
do not change the "Out-of-Scope Feature Work — Mental Maths" status
already recorded in `RC1-MILESTONE.md`. Any future Mental Maths
specification or implementation work performed under this ADR remains
out-of-scope for RC1 unless a separate, deliberate decision changes
that.

## 10. Consequences

- Mental Maths has, for the first time, an ADR-level record of its
  intended product scope and the process by which that scope may be
  reached.
- Future Mental Maths work for any phase has an explicit lifecycle to
  follow, reducing the chance of a repeat of the unauthorized-banding
  incident.
- The Senior Phase implementation is formally acknowledged as
  unspecified legacy work, creating an explicit (if not yet scheduled)
  obligation to backfill its specification.
- `utils/capsPhase.js` gains a documented role as the canonical phase
  boundary source for this feature area, without forcing architectural
  convergence between existing or future Mental Maths services.
- No immediate change to any running code, test, or user-facing
  behavior results from this ADR.

## 11. Non-Goals

This ADR does not:

- Define any new candidate taxonomy item (no C14/C15/etc.).
- Define any number range, magnitude envelope, or generation policy for
  Foundation, Intermediate (4/6), Senior, or FET.
- Define, authorize, or imply any difficulty band, score, cutoff, or
  weight for any phase.
- Close any of Grade 5's existing OPEN or DEFERRED taxonomy items.
- Retroactively treat the existing Senior Phase implementation as an
  authoritative specification.
- Modify `utils/capsPhase.js`.
- Modify `services/mentalMathsService.js` or
  `services/mentalMathsGrade5Service.js`.
- Add, modify, or remove any test.
- Author any phase specification document.
- Alter RC1 scope, acceptance criteria, or the current
  `RC1-MILESTONE.md` status of Mental Maths.

## 12. References

- `docs/specs/mental-maths/Grade5_Arithmetic_Fluency_Draft_v0.1_Consolidated.md`
- `docs/specs/mental-maths/stage3b_findings.md`
- `docs/specs/mental-maths/stage4_difficulty_spec.md`
- `utils/capsPhase.js`
- `services/mentalMathsService.js`
- `services/mentalMathsGrade5Service.js`
- `RC1-MILESTONE.md` — "Out-of-Scope Feature Work — Mental Maths"
- Commit `0236ecb` (`origin/main`) — removal of unauthorized Grade 5
  difficulty banding
- `docs/adr/ADR-INDEX.md` — ADR numbering and index conventions
