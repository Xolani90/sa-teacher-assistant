# Senior Phase Generation Policy — Item 4 Factual Reconciliation Record

**Status:** DRAFT FOR REVIEW ONLY
**Layer:** Item 4 — Generation Policy factual reconciliation
**Artifact under audit:** `Senior_generation_policy_v1_0_proposed_.md` (uploaded,
non-authoritative; treated as the artifact under audit, not as source of
truth)

> **NOT A POLICY AMENDMENT. NOT A PATCH. NOT A COMMIT. NOT A SCOPE
> DECISION.**
> This record captures the completed Item 4 factual audit for Project
> Owner review. It does not itself edit
> `Senior_generation_policy_v1_0_proposed_.md`, does not create a
> repository patch, does not commit anything, and does not modify
> taxonomy, scope, Generation Policy authority, or implementation
> authorization. It is a review artifact only.

---

## 1. Purpose

To record, as a single reviewable document, the six factual-audit
findings established in the course of Item 4, with each finding
classified precisely as one of:

- **FACTUAL ERROR** — the policy's claim is objectively wrong against
  the repository.
- **STALE/INCOMPLETE PROVENANCE** — the policy's claim is not wrong,
  but omits a later-committed document that bears on the same subject.
- **PROVENANCE-CHAIN GAP** — a lineage question, now resolved by
  evidence, that the policy's provenance section does not reflect.

This classification distinction is preserved throughout and must not
be collapsed. A factual error requires correction of the policy text
itself; stale provenance and a provenance-chain gap require the
policy's citations to be extended, not its substantive scope
conclusions to be changed.

---

## 2. Governing non-inference constraints

The following constraints governed the audit and continue to govern
this record:

1. Implementation code (`genRoundEstimate`, `genRatioSharing`, or any
   other generator) is not treated as specification or provenance
   evidence anywhere in this record.
2. No finding in this record authorizes generation, implementation, a
   taxonomy edit, a Generation Policy amendment, or a freeze act for
   any candidate.
3. No finding in this record merges, splits, renames, or otherwise
   makes a scope judgment about any candidate. Where a committed
   record already makes such a judgment (Finding 6), this record
   reports that fact; it does not make the judgment itself.
4. Absence of a provenance citation is not treated as proof of
   non-existence, and presence of a provenance citation is not treated
   as proof of authorization. Each finding below is stated only to the
   level the cited commit itself supports.
5. This record does not resolve any outstanding OPEN or unresolved
   status recorded in any existing document (e.g. the
   `ratioSharing`/`ratioRate` bundle-vs-split question, `ratioSharing`
   G9 continuity, `roundEstimate`'s form-level scope). Those remain
   exactly as recorded in their respective source documents.

---

## 3. Reconciliation findings

### Finding 1 — `ratioSharing` decision record wrongly reported as uncommitted

**Policy's claim:** `ratioSharing_Grade_Scope_Decision_Record.md` "is
NOT committed anywhere in this repository... zero matches."

**Actual fact:** Committed at `6312ec8` ("Add ratioSharing grade scope
decision record (doc-only)"). Its recorded content — G7–G8 scoped,
G9 unresolved, status `PROPOSED DECISION RECORD — NOT YET FROZEN` — is
unchanged by this finding.

**Classification:** FACTUAL ERROR.

**Sections affected:** §0 (provenance list), §1 (candidate table), §2
(grade-authorization table), §7 (exclusion table), §10 item 6, §12
(provenance table).

---

### Finding 2 — `powersRootsFluency` decision record wrongly reported as uncommitted

**Policy's claim:** `Powersrootsfluency_grade_scope_decision_record.md`
"is NOT committed anywhere in this repository... zero matches."

**Actual fact:** Committed at `27dd88a` ("Add powersRootsFluency grade
scope decision record, integer and rational domains (doc-only)"). Its
recorded content — integer domain G7–G8, rational domain G8-only, G9
not authorized for either domain, status `PROPOSED DECISION RECORD —
NOT YET FROZEN` — is unchanged by this finding.

**Classification:** FACTUAL ERROR.

**Sections affected:** §0, §1, §2, §7, §10 item 6, §12.

---

### Finding 3 — `ratioRate` evidence accounting omits the later evidence-review checkpoint

**Policy's claim:** §7's `ratioRate` row cites only
`ratioRate_Retrieval_Exhaustion_Checkpoint.md` as the committed
evidence for this candidate.

**Actual fact:** `ratioRate_Evidence_Review_Checkpoint.md` is also
committed, at `880b081` — an independent, fresh Layer 1 evidence
review containing G7/G8 named-with-context evidence and G9
named-and-worked evidence (two worked examples, explicit formulae) not
reflected in the retrieval-exhaustion checkpoint alone.

**Classification:** STALE/INCOMPLETE PROVENANCE. `880b081` does not
create a grade-scope authorization for `ratioRate` — no grade-scope
decision record exists for this candidate, and this finding does not
change that. It only means the policy's evidentiary picture for
`ratioRate` understates what is actually on record.

**Sections affected:** §0, §7, §12.

---

### Finding 4 — `ratioSharing` supersession record omitted

**Policy's claim:** §0/§12 provenance never mentions
`ratioSharing_Supersession_Record.md`.

**Actual fact:** Committed at `2ac6b93` — this document closes one
specific factual premise in `ratioSharing_Scope_Decision_Review.md`
(that no `ratioRate` evidence document existed in the repository) and
directly bears on §7's "split justification... unresolved" row and
§10 item 8.

**Classification:** STALE/INCOMPLETE PROVENANCE. `2ac6b93` explicitly
does not resolve the `ratioSharing`/`ratioRate` bundle-vs-split
question — that question remains OPEN exactly as recorded in
`ratioSharing_Scope_Decision_Review.md`. This finding only means the
policy is silent on the latest state of a question it otherwise
discusses.

**Sections affected:** §0, §7, §10 item 8.

---

### Finding 5 — ADR-022 "Add" commit hash incorrect

**Policy's claim:** §12's provenance table gives ADR-022's "Add"
commit as `948bcf6`.

**Actual fact:** The "Add ADR-022" commit is `5cea698` ("Add ADR-022:
Mental Maths R-12 Product Scope & Specification Governance"). The
policy's separately-cited "Accept ADR-022" commit, `b528f73`, is
correct and independently confirmed.

**Classification:** FACTUAL ERROR — PARTIAL (one of the two cited
hashes for this ADR is wrong; the other is right).

**Sections affected:** §12 (provenance table).

---

### Finding 6 — `roundEstimate` lineage investigation

**Question investigated:** Is `roundEstimate` the same
candidate/evidence lineage as `estimation`/`roundingOffAndCompensating`,
or a distinct candidate the proposed policy failed to account for?

**Documents compared:**
- `roundEstimate_Evidence_Review_Checkpoint.md` (committed `1626549`)
- `estimation_roundingOffAndCompensating_Grade_Scope_Decision_Record.md`
  (committed `cb1c143`)

**What each document calls the candidate:**
- The earlier document uses the single bundled legacy name
  `roundEstimate`, and explicitly lists it in its "Candidate universe"
  section as one of seven candidates, separate from `mulDivFluency`,
  `powersRootsFluency`, `ratioSharing`, and the other legacy generators.
- The later document uses two separate CAPS-native technique names,
  `estimation` and `rounding off and compensating`, both drawn from the
  same CAPS bullet list.

**What CAPS skill/phrase each document is about:** Both concern the
same CAPS "Calculation techniques" bullet list (Numbers, Operations and
Relationships → Whole numbers) at G7/G8/G9, which lists, in identical
form at each grade: estimation; adding, subtracting and multiplying in
columns; long division; rounding off and compensating; using a
calculator.

**Explicit supersession/derivation statement located:** Yes.
`estimation_roundingOffAndCompensating_Grade_Scope_Decision_Record.md`
§1 states directly: "Traceable to
`roundEstimate_Evidence_Review_Checkpoint.md` (committed) and
independently re-verified against `CAPS_SP__MATHEMATICS_GR_7-9.pdf`
directly." This is an explicit, first-hand-stated derivation, not an
inference drawn from naming similarity.

**Evidence/grade-scope material — same or materially different:**
Substantively continuous. Both documents record that no worked example
exists at any grade for this material. The later document re-verifies
the same primary source directly rather than introducing new evidence,
and narrows the bundled legacy name into the two CAPS-literal technique
names appearing in the source bullet list.

**Explicit provenance record establishing the rename/re-split:** Yes —
the later document's §1 citation, described above, constitutes that
record. It is also framed as "correcting an evidentiary premise
asserted in `Senior_Phase_Project_Owner_Judgments_Round1.md`, item 3,"
indicating the re-split was itself a recorded Project Owner judgment,
not a silent or undocumented rename.

**Determination: (A) same candidate lineage.** Not (B) a distinct,
unaccounted-for candidate, and not (C) genuinely unresolved.

**Consequence for the proposed policy:**

- The policy's use of `estimation`/`roundingOffAndCompensating` as the
  current candidate naming is **not factually wrong on candidate
  identity** — this is the correct, current successor naming for the
  evidentiary lineage that began as `roundEstimate`.
- The policy's provenance sections (§0, §12) do not cite
  `roundEstimate_Evidence_Review_Checkpoint.md` or `1626549` anywhere,
  even as ancestry, which breaks the traceability chain that
  `cb1c143` itself explicitly relies on.

**Classification:** PROVENANCE-CHAIN GAP, resolved as to lineage. This
is not classified as a factual error (the policy's substantive claim
about current candidate naming is correct) and not as a
candidate-accounting omission (no additional current candidate is
missing from the policy's tables). It is classified as an incomplete
ancestry citation only.

**Sections affected:** §0, §12 (provenance only — no effect on §1, §2,
or §7's substantive content for `estimation`/`roundingOffAndCompensating`).

---

## 4. What this reconciliation establishes

- Two findings (#1, #2) are factual errors requiring textual correction
  of the policy's commit-status claims. The underlying scope/grade
  content those two decision records describe is otherwise consistent
  with what the policy already says about them elsewhere (where it
  discusses their content hypothetically) — only their committed
  status was misreported.
- One finding (#5) is a factual error in a single citation, with the
  paired citation for the same ADR already correct.
- Two findings (#3, #4) are stale/incomplete provenance — citations
  that should be added, without changing any substantive scope
  conclusion the policy currently states.
- One finding (#6) is a resolved provenance-chain gap — the lineage
  question has a definitive answer (same lineage, deliberate re-split,
  explicitly documented), and the only corrective action indicated is
  adding an ancestry citation, not adding, removing, or re-merging any
  candidate.

## 5. What remains unresolved (not addressed by this record)

- The `ratioSharing`/`ratioRate` bundle-vs-split scope question
  (recorded as **C — OPEN** in `ratioSharing_Scope_Decision_Review.md`).
- `ratioSharing`'s own G9 continuity question.
- `roundEstimate`'s (now `estimation`/`roundingOffAndCompensating`'s)
  form-level scope question, recorded as OPEN in
  `roundEstimate_Evidence_Review_Checkpoint.md`.
- Whether any further discrepancies exist in policy sections not
  covered by the six findings audited here (this record does not claim
  the audit was exhaustive beyond the six items instructed).

## 6. Governance status of this record

This reconciliation record:

- does **not** amend `Senior_generation_policy_v1_0_proposed_.md`;
- does **not** create a repository patch;
- does **not** commit anything;
- does **not** modify taxonomy, scope, Generation Policy authority, or
  implementation authorization for any candidate;
- does **not** resolve any OPEN question listed in §5.

## 7. Proposed next governance step

Project Owner review and approval of this reconciliation record. Only
following that approval should an isolated correction patch to
`Senior_generation_policy_v1_0_proposed_.md` be prepared — addressing
Findings 1, 2, and 5 as textual corrections, and Findings 3, 4, and 6
as added citations — as a separate, later operation, consistent with
the evidence → review → approval → repository-operation sequence used
for Items 1–3.

---

**Status: DRAFT FOR REVIEW ONLY. No repository action taken.**
