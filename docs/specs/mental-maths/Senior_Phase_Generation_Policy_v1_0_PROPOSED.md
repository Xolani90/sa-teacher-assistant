# Senior Phase Mental Maths — Generation Policy v1.0

**Status: PROPOSED FRAMEWORK — NOT YET FROZEN — NOT IMPLEMENTATION-AUTHORITATIVE**
**Generation specifications incomplete; no candidate generation-authorized.**

> This document is a proposed Generation Policy under ADR-022 §8
> (Specification / Authorization Lifecycle) and the Senior Phase Scope
> Resolution Framework. It authorizes no ADR-023 §6 freeze act, no
> `AUTHORIZED_FAMILIES` or `FAMILY_GRADE_AUTHORIZATION` change, no
> resolver or generator code, and no test. It is not suitable for
> implementation until it has passed a 10-point Policy Completeness
> Review and been explicitly frozen under ADR-023 §6. It is a
> **framework draft**: it names candidates and grade scopes but leaves
> item forms, numeric ranges, and generation constraints unresolved
> (§10) — it should not be read as a complete, generation-ready policy.

---

## 0. Governance chain this policy is derived from — with commit status verified line-by-line

Inspected directly at repository `HEAD`, and re-verified against
`git log --all --diff-filter=A` for every source document, before
drafting and again during this revision (Item 4 factual reconciliation,
`821e16b`).

- ADR-023 (Repository Governance) — **Accepted**, bootstrap commit
  `580fa45`.
- ADR-022 (Mental Maths R–12 Product Scope & Specification Governance)
  — **Added**, `5cea698`; **Accepted**, `b528f73`.
- `Senior_Phase_Scope_Resolution_Framework__PROPOSED.md` — methodology,
  committed.
- Evidence checkpoints — **committed**: `ratioSharing_Evidence_Review_Checkpoint.md`,
  `powersRootsFluency_Evidence_Review_Checkpoint.md`,
  `ratioRate_Retrieval_Exhaustion_Checkpoint.md`,
  `ratioRate_Evidence_Review_Checkpoint.md` (`880b081` — a later, fresh,
  independent Layer 1 evidence review, additional to the
  retrieval-exhaustion checkpoint; it does not itself constitute a
  grade-scope decision or authorization for `ratioRate` — see §7),
  `roundEstimate_Evidence_Review_Checkpoint.md`.
- `fracDecPercent_powersRootsFluency_RationalSquaresRoots_Scope_Decision_Record.md`
  — **committed**, `5b4c964`.
- `ratioSharing_Supersession_Record.md` — **committed**, `2ac6b93`. This
  document closes one specific factual premise (that no `ratioRate`
  evidence document existed in the repository); it does **not** resolve
  the `ratioSharing`↔`ratioRate` split-justification question, which
  remains open — see §7, §10 item 8.

**Correction from the previous draft of this policy — verified this
revision (Item 4 factual reconciliation record, `821e16b`):**

- `estimation_roundingOffAndCompensating_Grade_Scope_Decision_Record.md`
  and `multiplicationFactFluency_Grade_Scope_Authorization_Decision_Record.md`
  — **committed**, `cb1c143` (sandbox) / real-machine equivalent
  (verified via `git am` on the authoritative checkout in this
  session).
- **`ratioSharing_Grade_Scope_Decision_Record.md` (`6312ec8`) and
  `Powersrootsfluency_grade_scope_decision_record.md` (`27dd88a`) ARE
  committed to this repository.** The previous draft of this policy
  stated the opposite — that `git log --all --diff-filter=A
  --name-only` returned zero matches for both filenames. That was a
  factual error in the policy draft, not in the underlying evidence or
  judgment: both files are, and independently verified to be, present
  in this repository's committed history. **This is corrected in §1,
  §2, §3, §6, §7, §8, §10, and §12 below**: `ratioSharing` and
  `powersRootsFluency` (both domains) are moved from the exclusion
  table into the authorized-candidate tables, using exactly the same
  committed-status test already applied to
  `estimation`/`roundingOffAndCompensating` and
  `multiplicationFactFluency`. Their scope content is taken only from
  what their own decision records state — no scope is invented or
  broadened beyond that.
- **`roundEstimate_Evidence_Review_Checkpoint.md` (`1626549`) is the
  evidentiary ancestor of
  `estimation_roundingOffAndCompensating_Grade_Scope_Decision_Record.md`
  (`cb1c143`).** The later record's §1 explicitly states it is
  "traceable to `roundEstimate_Evidence_Review_Checkpoint.md`
  (committed) and independently re-verified against
  `CAPS_SP__MATHEMATICS_GR_7-9.pdf` directly." `roundEstimate` is
  therefore **not** reintroduced as a separate current candidate in
  this policy — the committed later record already establishes the
  successor lineage and the deliberate CAPS-native re-split into
  `estimation` and `roundingOffAndCompensating`. This citation is added
  for provenance completeness only; it changes nothing in §1–§2.

- `Senior_Phase_Cross_Candidate_Scope_Matrix.md` and
  `Candidate_Universe_Status_Consolidation.md` — read for completeness;
  neither is taxonomy authority.
- `Senior_Taxonomy_v1.0_Working_Skeleton.md` — read; explicitly
  NOT AUTHORITATIVE. Not used as a source of content here.

**This policy does not treat `services/mentalMathsService.js`,
`services/mentalMathsGrade5Service.js`, `FLAT_RANGES`,
`AUTHORIZED_FAMILIES`, or `FAMILY_GRADE_AUTHORIZATION` as evidence,
precedent, or a default, per ADR-022 §5 Governance Rule 2 and Round 1
judgments #9–#11/#13. No numeric range, item form, or grade boundary
in this document was copied from or inferred from existing code.**

---

## 1. Candidate Taxonomy

Only candidates whose grade-scope decision record is **committed to
the repository** are named below with an authorization status. This
is the operative test — content verification and Project Owner
confirmation in conversation are necessary but not sufficient; see §0
for the correction this revision made, and §7 for the candidates this
still excludes.

| Candidate | Taxonomy status | Source | Committed? |
|---|---|---|---|
| `estimation` | Separate named candidate (Project Owner taxonomy judgment; **not** a CAPS-derived distinction from `roundingOffAndCompensating` — see §3) | `estimation_roundingOffAndCompensating_Grade_Scope_Decision_Record.md` | **Yes**, `cb1c143` |
| `roundingOffAndCompensating` | Separate named candidate (same judgment) | Same | **Yes**, `cb1c143` |
| `multiplicationFactFluency` | Separate named candidate | `multiplicationFactFluency_Grade_Scope_Authorization_Decision_Record.md` | **Yes**, `cb1c143` |
| `ratioSharing` | Separate named candidate | `ratioSharing_Grade_Scope_Decision_Record.md` | **Yes**, `6312ec8` |
| `powersRootsFluency`, integer domain | Separate named candidate | `Powersrootsfluency_grade_scope_decision_record.md` | **Yes**, `27dd88a` |
| `powersRootsFluency`, rational domain | Separate named candidate | Same | **Yes**, `27dd88a` |

`ratioRate` is **not** included in this table — see §7. Its evidence
has been reviewed in two committed checkpoints
(`ratioRate_Retrieval_Exhaustion_Checkpoint.md`,
`ratioRate_Evidence_Review_Checkpoint.md` — `880b081`), but no
grade-scope decision record for `ratioRate` itself is committed, so
this policy does not treat it as a settled candidate. An evidence
checkpoint is not a grade-scope decision record and is not treated as
one anywhere in this policy.

Every taxonomy name above is this project's own abstraction. No name
listed is asserted to be a CAPS term or CAPS-given unit.

---

## 2. Grade Authorization

| Candidate | G7 | G8 | G9 | Authorization status |
|---|---|---|---|---|
| `estimation` | Not authorized | Not authorized | Not authorized | **Not authorized at any grade** |
| `roundingOffAndCompensating` | Not authorized | Not authorized | Not authorized | **Not authorized at any grade** |
| `multiplicationFactFluency` | Authorized (scope) | Authorized (scope) | Not authorized under current decision | Scope-authorized G7–G8 |
| `ratioSharing` | Authorized (scope) | Authorized (scope) | Not authorized / unresolved (verbatim source wording — see below) | Scope-authorized G7–G8, G9 not authorized / unresolved |
| `powersRootsFluency`, integer domain | Authorized (scope) | Authorized (scope) | Not authorized | Scope-authorized G7–G8 |
| `powersRootsFluency`, rational domain | Not authorized | Authorized (scope) | Not authorized | Scope-authorized G8-only |

**G9 for `multiplicationFactFluency` reads "Not authorized under
current decision," not simply "Not authorized."** This wording is
deliberate: the source decision record states explicitly that absence
of a located "Mental calculations" heading at G9 is not treated as
CAPS affirmatively excluding the construct at that grade — only that
no supporting evidence was found. **This does not constitute a CAPS
exclusion.** A future evidence pass could still change this without
contradicting anything already decided.

**G9 for `ratioSharing` reads "Not authorized / unresolved," the exact
wording used in its source decision record**, rather than being
collapsed into `multiplicationFactFluency`'s distinct G9 wording ("Not
authorized under current decision") or simplified to a bare
"Unresolved." The source record's §4 states G9 as "not authorized /
unresolved, pending further evidence or a future framework pass" —
this policy preserves both halves of that wording rather than
selecting one.

**"Authorized (scope)" means exactly what the source decision record
says it means and nothing more** — see §4 for what it explicitly does
not mean.

`ratioRate` is omitted from this table for the same reason given in
§1: it has no committed grade-scope decision record. See §7.

---

## 3. Evidence Boundaries

Each authorized or scoped grade above traces to a specific, named,
independently-verified CAPS passage in its source decision record.
This policy does not restate CAPS text; it cites the decision record
by name.

**Evidence tiers currently in the chain**:

- *Named-and-explicitly-revised* — CAPS names the construct and
  explicitly marks it as carried forward/revised at the next grade
  (`multiplicationFactFluency` G7→G8).
- *Named-but-unworked* — CAPS names the construct with no accompanying
  worked example at any grade examined (`estimation`,
  `roundingOffAndCompensating`, `ratioSharing`).
- *Named-and-worked* — CAPS names the construct and shows worked
  numeric examples. For `powersRootsFluency`, this evidence is
  domain-differentiated, not uniform across the candidate: integer
  domain has worked evidence at G7 and G8; rational domain has worked
  evidence at G8 only (no rational-domain phrase was located at G7 in
  the primary source). See `powersRootsFluency_Evidence_Review_
  Checkpoint.md` (`3ed9698`).

This policy does not treat these tiers as ranked authorization
triggers on their own — evidence-tier equality or difference between
candidates does not imply construct identity or non-identity, and does
not by itself determine authorization; each candidate's authorization
rests on its own committed decision record's explicit judgment, not on
tier alone.

---

## 4. Generation Eligibility

**No candidate in this policy is eligible for generation.**

**This proposed policy defines the following generation-eligibility
gate for consideration during the subsequent freeze process.** These
six conditions are **proposed policy rules being introduced by this
document**, not authority already established by any decision record
— no committed decision record states or implies a generation-
eligibility gate; this policy is where that gate is first proposed,
and it must survive the 10-point Policy Completeness Review and any
subsequent Project Owner review like any other new policy content:

1. A specified set of permitted item forms (question shapes).
2. Specified numeric/operand ranges, with their own CAPS-or-explicit-
   governance-judgment basis (ADR-022 §5 Governance Rule 2 — existing
   code ranges carry no evidentiary weight).
3. Specified generation constraints (e.g. exact-vs-rounded output
   rules, where applicable to a future rational-domain candidate).
4. Specified exclusions (difficulty distinctions, disallowed operand
   combinations, etc.).
5. A completed Policy Completeness Review (§10) confirming all of the
   above exist and are internally consistent, for every candidate this
   policy names.
6. An explicit ADR-023 §6 freeze act.

Until all six exist for a given candidate, and until this gate itself
is accepted as policy (not merely proposed), that candidate is
**scope-authorized but generation-ineligible**. This is a proposed
descriptive/lifecycle state this policy introduces; it is not yet a
formally recognized state under ADR-022 or ADR-023, and should be
treated as such until the Policy Completeness Review and any
necessary amendment to ADR-022's own lifecycle language (§8) confirm
whether it should become one.

---

## 5. Forbidden Extrapolation

- **G9 is not inferred for `multiplicationFactFluency` from its G7/G8
  authorization.**
- **G9 is not inferred for `ratioSharing` or `powersRootsFluency` from
  their G7/G8 authorization.**
- **Absence of a CAPS heading at G9 is not treated as CAPS
  affirmatively excluding that grade** — see §2's wording.
- **Evidence-tier equality does not imply construct identity** —
  `estimation`/`roundingOffAndCompensating`.
- **The retracted Round 1 item 3 premise does not reappear here.** No
  statement in this policy attributes a worked-instance distinction
  between `estimation` and `roundingOffAndCompensating` to CAPS.
- **`ratioRate_Evidence_Review_Checkpoint.md` (`880b081`) is not
  treated as a grade-scope decision or authorization for `ratioRate`.**
  It is evidence made available, not a scope conclusion — see §0, §1,
  §7.
- **`ratioSharing_Supersession_Record.md` (`2ac6b93`) is not treated as
  resolving the `ratioSharing`↔`ratioRate` split-justification
  question.** That question remains open — see §7, §10 item 8.
- **`roundEstimate_Evidence_Review_Checkpoint.md` is not treated as
  authorizing or scoping `estimation`/`roundingOffAndCompensating`
  beyond what their own committed decision record states.** It is
  cited only as evidentiary ancestry — see §0.
- **Existing code is not used to fill any generation-eligibility gap**
  named in §4.
- **CAPS topic/heading structure is not automatically decisive** for
  any bundling/splitting decision not yet made.
- **A document reviewed and approved in conversation is not treated as
  committed governance state merely because it was reviewed and
  approved.** This is the rule this policy previously applied to
  correct its own earlier draft regarding `ratioSharing` and
  `powersRootsFluency`'s *commit status* — that specific factual error
  is now corrected (§0), but the underlying rule itself remains a
  standing rule for any future revision of this policy.

---

## 6. Scope Enforcement

This policy's authority is limited to the six candidates named in §1.
It does not extend, by implication or by omission, to:

- Any Grade 5 candidate or specification.
- Any Foundation, Intermediate, or FET phase content.
- `ratioRate` — see §7; not included pending commit of its own
  grade-scope decision record.
- `mulDivFluency`, `addSub`, `fracDecPercent` as their own named
  candidates. **The incorporation of the rational-domain merge
  decision (`5b4c964`, accepted at the scope level) into
  `powersRootsFluency`'s rational-domain authorization does not
  authorize `fracDecPercent` as a candidate in its own right.**
  `fracDecPercent` itself has no committed grade-scope decision record
  and is not authorized, scoped, or otherwise addressed by anything in
  this policy — only the specific rational-squares/roots material that
  was scope-merged into `powersRootsFluency` is affected.
- The `addSub`↔`mulDivFluency` inverse-operations boundary decision
  (proposed, not frozen, `b6dba51`) — a boundary decision, not a
  grade-scope/authorization decision; not incorporated here.
- Any of the five remaining "Properties of whole numbers" siblings
  with no candidate name.
- `ratioSharing`'s relationship to `ratioRate` as a *split* — this
  policy takes no position on whether that pre-existing split was ever
  justified, notwithstanding that `ratioSharing` itself is now
  included in §1–§2. Inclusion of `ratioSharing` as an authorized
  candidate is not a resolution of the split question — see §7, §10
  item 8.

---

## 7. Candidates explicitly excluded from this policy (not silently authorized, not silently omitted)

| Candidate/question | Status | Why excluded here |
|---|---|---|
| `ratioRate` | Named as standalone candidate, G9-only, Round 1 item 2. Two evidence checkpoints committed: `ratioRate_Retrieval_Exhaustion_Checkpoint.md` and `ratioRate_Evidence_Review_Checkpoint.md` (`880b081`) | No committed grade-scope decision record of its own — evidence checkpoints alone do not constitute one |
| `mulDivFluency` | Assessed, scope open (Option C) | No committed grade-scope decision record |
| `addSub` ↔ `mulDivFluency` inverse-operations boundary | Proposed (not frozen) merge decision exists, `b6dba51` | Boundary decision exists; grade-scope/authorization decision does not |
| `addSub`'s other 6 sibling properties | Unresolved/unstatused | No candidate name, no evidence review at candidate level |
| `fracDecPercent` (as a whole) | Assessed, scope not yet reviewed | No committed grade-scope decision record |
| `ratioSharing` ↔ `ratioRate` split justification | Open question per Cross-Candidate Scope Matrix; `ratioSharing_Supersession_Record.md` (`2ac6b93`) closes one factual premise of this question (that no `ratioRate` evidence document existed) but does not resolve the question itself | Unresolved, separate question — `ratioSharing`'s own inclusion in §1–§2 as an authorized candidate does not resolve whether the `ratioSharing`/`ratioRate` split was ever justified |

**This policy does not authorize, deny, or take any position on the
mathematical merits of any row above.** `ratioRate`, `mulDivFluency`,
and `fracDecPercent` remain excluded solely because their own
grade-scope decision records are not committed — the same test applied
throughout this policy. The split-justification row remains a distinct,
open governance question, not a commit-status gap, and is not resolved
by anything in this policy.

---

## 8. Authorization vs. Implementation

| Layer | What it governs | Status for `estimation`/`roundingOffAndCompensating`/`multiplicationFactFluency`/`ratioSharing`/`powersRootsFluency` |
|---|---|---|
| Evidence | What CAPS says | Established, per source checkpoint |
| Evidence-review conclusion | What tier the evidence occupies | Established, per source checkpoint |
| Project Owner judgment | Taxonomy/scope/separation decisions | Established, per source decision record |
| Authorization | Scope-level "may eventually be generated" | Established (scope only) for `multiplicationFactFluency`, `ratioSharing`, `powersRootsFluency` (both domains); not authorized for `estimation`/`roundingOffAndCompensating` |
| Generation Policy | This document | **Proposed framework, not frozen** |
| Freeze | ADR-023 §6 act | **Not performed** |
| Implementation | Code, resolver, tests | **Not authorized; existing `AUTHORIZED_FAMILIES` entries are not retroactively validated by this policy** (Round 1 item 13 stands unmodified) |

The currently-live implementation (`mulDivFluency`, `powersRootsFluency`,
`ratioSharing` in `AUTHORIZED_FAMILIES`) is not reconciled, validated,
narrowed, or widened by this policy.

---

## 9. Freeze Prerequisites

Before any ADR-023 §6 freeze act may occur for any candidate this
policy names, the following must all be true:

1. This policy has passed a 10-point Policy Completeness Review (§10).
2. The generation-eligibility gaps in §4 are closed for the specific
   candidate being frozen.
3. **A freeze act must explicitly state the level of authority being
   frozen. A scope authorization alone does not authorize generation
   and must not be interpreted as generation-ready.** (This replaces
   a prior draft of this section, which proposed allowing a
   "scope-only freeze" outcome — removed, since no committed decision
   record or ADR establishes that as a recognized freeze category, and
   introducing one here risked blurring the scope-authorization →
   generation-specification → policy → freeze → implementation
   sequence this governance chain has been careful to keep distinct.)
4. A dedicated, standalone commit performs the freeze act, attributed
   to the Project Owner, per the same mechanism already used for the
   ADR-022 acceptance commit.
5. The freeze commit does not bundle taxonomy changes, policy content
   changes, or implementation changes.

**No freeze act is performed, proposed for immediate action, or
implied by this document.**

---

## 10. Unresolved Items (explicit, for the Policy Completeness Review)

1. Item forms — not specified for any candidate.
2. Numeric/operand ranges — not specified for any candidate; existing
   code values (`1–12`, `1–6`) carry no evidentiary weight and are not
   adopted here.
3. A future rational-domain generation specification (fraction/decimal
   forms, precision/rounding rules) — not authored. `powersRootsFluency`
   rational domain is now included in §1–§2 (scope-authorized G8-only),
   but this does not supply a generation specification for it.
4. Difficulty bands — out of scope for this policy entirely, per
   ADR-022 §5 Governance Rule 3.
5. Resolver/dispatch implications — not analyzed in this policy.
6. The §7 excluded-candidates table generally — none of those rows are
   resolved by this policy.
7. The `ratioSharing`↔`ratioRate` split-justification question —
   unresolved. `ratioSharing_Supersession_Record.md` (`2ac6b93`) closes
   one factual premise of this question but does not resolve it.
8. `ratioSharing`'s own G9 status — recorded as "unresolved" in its
   source decision record, distinct from "not authorized"; this policy
   does not attempt to resolve it, only to preserve the distinction.
9. ADR-023's own stale §1 body text (Round 1 item 12) — unrelated to
   this policy's content, still an outstanding mechanical step.
10. Whether the §4 generation-eligibility gate and the "scope-authorized
    but generation-ineligible" state (§4) should become formally
    recognized lifecycle concepts under ADR-022, or remain local to
    this policy document — not yet decided; flagged for the
    Completeness Review and, if warranted, a future ADR-022 amendment
    discussion (separate from this policy).

---

## 11. Governance Change Control / Interaction with ADR-023

- This policy sits at the "Generation Policy draft" stage of ADR-022
  §8's lifecycle and has not progressed further.
- Any future amendment to this policy's content is itself a governance
  act requiring the same review discipline applied to every decision
  record in this chain.
- This policy does not itself invoke, perform, or pre-authorize any
  ADR-023 §6 freeze act for any candidate.
- Nothing in this policy amends ADR-022 or ADR-023 themselves.
- The §4/§10 question of whether "generation-eligibility gate" and
  "scope-authorized but generation-ineligible" become ADR-022 lifecycle
  concepts is explicitly deferred, not decided, by this policy.

---

## 12. Provenance / Traceability

Committed sources this policy's authorized content (§1–§2) actually
rests on:

- ADR-023 — `580fa45` (bootstrap acceptance)
- ADR-022 — `5cea698` (add) / `b528f73` (acceptance)
- `Senior_Phase_Scope_Resolution_Framework__PROPOSED.md` — methodology
- `estimation_roundingOffAndCompensating_Grade_Scope_Decision_Record.md`
  — `cb1c143` (sandbox) / real-machine equivalent, verified via `git am`.
  Its own §1 records this as traceable to
  `roundEstimate_Evidence_Review_Checkpoint.md` (`1626549`, committed)
  as evidentiary ancestor, independently re-verified against
  `CAPS_SP__MATHEMATICS_GR_7-9.pdf`.
- `multiplicationFactFluency_Grade_Scope_Authorization_Decision_Record.md`
  — same commit
- `ratioSharing_Grade_Scope_Decision_Record.md` — `6312ec8`
- `Powersrootsfluency_grade_scope_decision_record.md` — `27dd88a`

Reviewed and cited, but not treated as authorizing content on its own:

- `ratioRate_Retrieval_Exhaustion_Checkpoint.md`,
  `ratioRate_Evidence_Review_Checkpoint.md` (`880b081`) — evidence
  checkpoints for `ratioRate`; committed, but do not constitute a
  grade-scope decision record — see §0, §1, §7
- `ratioSharing_Supersession_Record.md` (`2ac6b93`) — committed;
  closes one factual premise regarding `ratioRate` evidence
  availability, does not resolve the `ratioSharing`↔`ratioRate` split
  question — see §0, §7, §10 item 7
- `ratioSharing_Evidence_Review_Checkpoint.md`,
  `powersRootsFluency_Evidence_Review_Checkpoint.md` — committed;
  underlying evidence for the now-included `ratioSharing_Grade_Scope_
  Decision_Record.md` and `Powersrootsfluency_grade_scope_decision_
  record.md`
- `fracDecPercent_powersRootsFluency_RationalSquaresRoots_Scope_Decision_Record.md`
  — committed (`5b4c964`); its effect (rational-domain merge into
  `powersRootsFluency`) is realized in this policy now that
  `powersRootsFluency` itself is included — see §1, §2, §6
- `Senior_Phase_Cross_Candidate_Scope_Matrix.md`,
  `Candidate_Universe_Status_Consolidation.md` — read for §7
- `Senior_Phase_Project_Owner_Judgments_Round1.md`,
  `Senior_Phase_Project_Owner_Judgments_Round2.md` — conversation-
  recorded, not committed; items cited by number throughout
- `Item4_Factual_Reconciliation_Record.md` (`821e16b`) — the committed
  audit record this revision implements; see §0

---

## 13. Read-only self-check performed before presenting this revision

- **Re-ran the commit-status verification this revision corrects**:
  confirmed `ratioSharing_Grade_Scope_Decision_Record.md` (`6312ec8`)
  and `Powersrootsfluency_grade_scope_decision_record.md` (`27dd88a`)
  are committed, contrary to the previous draft's claim.
- Confirmed ADR-022's "Add" commit is `5cea698`, not `948bcf6` as
  previously stated; "Accept" commit `b528f73` re-confirmed correct.
- Confirmed `ratioRate_Evidence_Review_Checkpoint.md` (`880b081`) and
  `ratioSharing_Supersession_Record.md` (`2ac6b93`) are committed and
  now cited in §0/§7/§12; confirmed neither is treated as a grade-scope
  authorization or split-question resolution — see §5.
- Confirmed `roundEstimate_Evidence_Review_Checkpoint.md`'s lineage
  relationship to `estimation_roundingOffAndCompensating_Grade_Scope_
  Decision_Record.md` is cited in §0/§12 as provenance only, and that
  `roundEstimate` is not reintroduced as a separate candidate anywhere
  in §1–§2.
- Checked §2's new `ratioSharing` G9 wording ("Unresolved") is not
  collapsed into `multiplicationFactFluency`'s G9 wording ("Not
  authorized under current decision") — confirmed distinct, per §2.
- Checked §8's authorization table now includes `ratioSharing` and
  `powersRootsFluency` alongside the previously-listed three
  candidates, consistent with their §1–§2 inclusion — confirmed.
- Checked no numeric range, item form, or difficulty content was
  introduced anywhere — confirmed.
- Checked the retracted Round 1 item 3 premise does not reappear —
  confirmed.
- Checked the title/subtitle still states generation specifications
  are incomplete and no candidate is generation-authorized —
  confirmed; scope authorization for two additional candidates does
  not change this.
- **This revision does not resolve**: whether the §7 split-
  justification question or `ratioSharing`'s G9 status should be
  closed — both remain exactly as their source records leave them.

---

*End of proposed Generation Policy v1.0 (framework draft). PROPOSED —
NOT YET FROZEN — NOT IMPLEMENTATION-AUTHORITATIVE. Not committed.
Awaiting review.*
