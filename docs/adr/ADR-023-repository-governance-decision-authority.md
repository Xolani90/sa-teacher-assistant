# ADR-023: Repository Governance — Decision Authority, Acceptance, and Freeze Mechanism

**Status:** Proposed (not yet accepted — see §11 Bootstrap Provision)
**Depends On:** —
**Related:** ADR-022 (Mental Maths R–12 Product Scope & Specification Governance), `docs/specs/mental-maths/Senior_Phase_Scope_Resolution_Framework__PROPOSED.md`

## 1. Status

Proposed. This ADR establishes repository-wide governance mechanics only — who may accept a governance decision, what constitutes acceptance, and what constitutes a freeze. It does not itself accept or freeze anything else; it does not resolve any Senior Phase candidate; it does not authorize any implementation beyond what other governing documents already require; and it does not retroactively validate any prior governance state.

## 2. Context

Governance reconnaissance conducted across four read-only passes (see the Senior Phase Mental Maths workstream, `docs/specs/mental-maths/`) found:

- No document in this repository defines who is authorized to move an ADR from "Proposed" to "Accepted."
- Git history shows every observed "Accepted" status was either (a) self-declared by the document's author at creation time, with no separate approval event, or (b) later corrected to match observed implementation reality on `main` (e.g. via `git merge-base --is-ancestor` confirmation) — a drift-correction, not an authorization act.
- The Grade 5 C12/C13 taxonomy freeze — the only precedent for a "frozen" specification in this repository — was declared informally within a working session ("Closed (this session)") and later committed as an already-frozen artifact. The commit that added it to the repository explicitly flagged its own gap: a file its own frozen content refers to as the location for "any future authorized change to the frozen invariants" does not exist anywhere in the repository.
- No `CODEOWNERS`, `GOVERNANCE.md`, `MAINTAINERS.md`, or equivalent file exists. No commit message anywhere asserts a named decision-maker role.
- Commit authorship across the ADR history is inconsistent and includes an automated/generic identity (`Release Prep <deploy@local>`) alongside named individuals — authorship alone does not indicate decision authority and is not treated as such by this ADR.

This is a genuine bootstrapping problem: any new governance mechanism proposed to fix the gap faces the identical open question about its own acceptance. This ADR resolves that by explicit, deliberate declaration rather than by inferring authority from any historical pattern.

## 3. Decision

This repository establishes a single, role-based governance authority: the **Project Owner**.

This ADR defines the Project Owner role and records its current holder as **Xolani Tshabalala**. The role and its governance powers take effect prospectively upon the bootstrap acceptance of this ADR described in §11. Before that acceptance, this document is a proposed governance mechanism only and confers no authority on anyone.

Recording Xolani Tshabalala as current holder is a statement of fact about who holds the role from the bootstrap acceptance forward — it is not a claim that this person held the role, or that this mechanism existed, at any point prior to that acceptance. Future succession — transferring the role to a different person, or changing how the role is held — requires its own explicit Project Owner succession/delegation mechanism, not addressed by this ADR.

### 3.1 What the Project Owner is authorized to do

1. **Accept or reject governance ADRs**, after review, by recording an explicit acceptance or rejection act in accordance with the audit-trail requirements of §4 and §7.
2. **Accept methodology or framework documents** where the governing process for that domain requires acceptance before the methodology may be applied (e.g. a proposed scope-resolution framework).
3. **Declare a taxonomy or specification decision frozen**, once the applicable evidence, decision record, and review steps required by the relevant governing document(s) are complete.
4. **Authorize implementation where the applicable domain governance explicitly requires Project Owner authorization after specification freeze.** This ADR does not itself create an implementation-authorization requirement where none otherwise exists — it establishes who performs that authorization *if and where* a domain's own governing documents (e.g. ADR-022's lifecycle) already require it, rather than expanding ADR-023 into a universal implementation gate.
5. **Delegate any of the above**, but only through an **explicit, recorded delegation** — a dated statement naming the delegate, the scope of the delegation, and any conditions or expiry. Delegation is never inferred from repository access, commit authorship, or session participation.

### 3.2 What the Project Owner role explicitly is not

- Not tied to any individual's Git identity, commit author string, or committer email.
- Not tied to any AI session, including sessions using Claude or any other assistant — a session may prepare, draft, and recommend, but a session does not hold Project Owner authority merely by virtue of producing a document or making a commit.
- Not equivalent to GitHub repository access or write permissions. Repository access is an implementation/control mechanism; it does not by itself constitute specification or governance authority.
- Not a majority-vote or multi-party mechanism. This ADR deliberately does not establish a second governance role or a two-person approval requirement, since no such second role currently exists in this repository and inventing one now would add an unnecessary dependency to the bootstrap.

## 4. Decision Act — what constitutes an actual decision

A governance decision (acceptance, rejection, freeze, or authorization under §3.1) requires all of the following, not merely discussion or a proposal existing in the repository:

1. **A named artifact** — the specific ADR, framework, or decision record being acted on, identified precisely (file path and, once committed, commit hash).
2. **An explicit statement of the act** — e.g. "Accepted," "Rejected," "Frozen," "Authorized for implementation" — stated in a way that cannot be confused with a draft, a proposal, or a status label applied by the document's own author at creation time.
3. **Attribution to the Project Owner role** — the record must state that the act is performed under Project Owner authority as established by this ADR, not merely that a commit was made.
4. **A distinct, identifiable commit** (§7) — the decision act must be visible in Git history as its own event, not folded silently into an unrelated content commit.

Absent all four elements, no decision has occurred under this ADR — a document remaining in "Proposed" or "OPEN" status, however long it has existed or however much analysis supports it, is not implicitly accepted or frozen by the passage of time or by repeated reference to it.

## 5. Acceptance Mechanism — Proposed → Accepted

**Except for the bootstrap acceptance defined in §11**, a governance ADR (including this one, for every acceptance after its own bootstrap) or a methodology/framework document moves from Proposed to Accepted only when:

1. It has been reviewed (by whatever process the Project Owner deems adequate — this ADR does not mandate a specific review format, only that review occurred).
2. The Project Owner records an explicit acceptance act meeting the §4 requirements, in a dedicated commit (§7) that changes the document's `Status` field to `Accepted` and states the acceptance explicitly in the commit message, distinct from any content or drift-correction change.

This differs deliberately from the historical pattern found in reconnaissance (self-declared-at-authoring, or corrected-to-match-implementation) — under this ADR, "Accepted" must always trace to an identifiable Project-Owner acceptance commit, never to authoring intent or to implementation having already occurred.

## 6. Freeze Mechanism — Decision → Frozen

A taxonomy, specification, or generation-policy decision becomes **frozen** only when:

1. The applicable evidence, methodology, and decision-record chain required by the relevant governing framework is complete (e.g., for Senior Phase Mental Maths: evidence checkpoint → scope-decision review → accepted scope-resolution framework → explicit decision record applying that framework, per the existing Senior Phase framework's own §14).
2. The Project Owner records an explicit freeze act meeting the §4 requirements, in its own dedicated commit.
3. The freeze commit explicitly distinguishes evidence-derived findings from governance judgment wherever the underlying decision record contains governance judgment (per the Senior Phase framework's §12 principle, which this ADR endorses as a general repository-wide rule, not one scoped only to Mental Maths).

A frozen decision is not self-declared by the document that proposes it, regardless of how thorough that document's own reasoning is. "Ready to checkpoint" or "ready for review" language, already used throughout the existing Senior Phase documents, is explicitly **not** equivalent to frozen under this ADR — it is, at most, a signal that the document is ready for the Project Owner's review under §5/§6.

## 7. Audit Trail

Every acceptance act, rejection act (§5, §3.1(1)), and every freeze act (§6) must be:

- Recorded in its own distinct commit, never combined with unrelated content changes, mirroring this repository's existing "doc-only commits kept separate from implementation" convention.
- Identifiable later purely from Git history — a future reader must be able to locate the exact commit that performed the acceptance, rejection, or freeze without needing session context, chat history, or external memory.
- Cross-referenced from the affected document itself (the document's own `Status` field and, where applicable, a "Frozen by commit `<hash>`" or equivalent note) once the act has occurred.

## 8. Prospective Effect — explicit non-retroactivity

**Project Owner authority, as established by this ADR, takes effect from this ADR's own bootstrap acceptance point forward. It does not retroactively:**

- Validate the informal Grade 5 C12/C13 freeze (`e02bb2a` and the "Closed (this session)" labels within `Grade5_Arithmetic_Fluency_Draft_v0.1_Consolidated.md`) as having been performed under Project-Owner authority. That freeze remains a historical fact — the specification content it recorded is not reopened or invalidated by this ADR — but its *authorization status* is not upgraded by this ADR into a decision meeting §4/§6.
- Validate any existing "Accepted" ADR header as having been accepted under this mechanism. Existing Accepted ADRs (ADR-001 through ADR-018, ADR-020 per the index, less those still Proposed) remain in their current, practically-relied-upon state; this ADR does not reopen or invalidate them. It simply does not claim they were accepted *under this process*, since this process did not yet exist when they were authored.
- Create authority for any decision made prior to this ADR's own bootstrap acceptance commit, by anyone, under any label.

This ADR fixes the mechanism going forward. It does not rewrite history to make the mechanism appear to have always existed.

## 9. Evidence vs. Governance Judgment

Restating and generalizing the principle already established in the Senior Phase Scope Resolution Framework (§12 there): **a Project Owner governance judgment may resolve a question that evidence alone does not resolve, but any resulting decision record must identify that judgment as governance judgment, distinctly from any CAPS-derived, empirically-derived, or otherwise evidence-derived conclusion.** This applies repository-wide, not only to Mental Maths — any future domain-specific framework inherits this rule from this ADR rather than needing to restate it.

## 10. Scope

In scope for this ADR: establishing the Project Owner role, naming its current holder, establishing the five authorized acts (§3.1, narrowed at (4)), establishing decision/acceptance/rejection/freeze mechanics (§4–§7), audit-trail requirement (§7), prospective-only effect (§8), and the generalized evidence-vs-judgment principle (§9).

Explicitly out of scope: any Senior Phase Mental Maths candidate decision; any change to the Senior Phase Scope Resolution Framework's content; any taxonomy status, Generation Policy, or implementation authorization for any feature area beyond what §3.1(4) narrowly permits; retroactive validation of any prior ADR's Accepted status or the Grade 5 freeze; a second governance role or multi-party approval mechanism; any Project Owner succession mechanism (named as a future need, not created here).

## 11. Consequences and Bootstrap Provision

The repository gains, for the first time, an explicit, named mechanism for turning a proposed governance or specification document into an accepted or frozen one, and an explicitly named individual holding that authority. Every future ADR and framework document can trace its acceptance to a specific Project-Owner commit rather than to authoring intent or a self-chosen status label. The Senior Phase Mental Maths framework (currently Proposed) can, after this ADR's own bootstrap acceptance, itself be accepted under this mechanism, and the eventual five-candidate decision record can later be frozen under it.

**Bootstrap provision:** Because no prior repository governance mechanism establishes an authority capable of accepting this ADR, the first acceptance of ADR-023 is an explicit bootstrap act by the person designated as Project Owner in this ADR (§3). That act establishes ADR-023 as the prospective governance mechanism from that acceptance commit onward. No prior rule is claimed as authority for the bootstrap act, and this document does not instruct or authorize its own acceptance — the bootstrap act originates outside the mechanism this ADR defines, not from within it.

## 12. Non-Goals

This ADR does not: create a second governance role or approval body; resolve any Senior Phase Mental Maths candidate's bundle/split/OPEN/deferred status; modify the Senior Phase Scope Resolution Framework; retroactively authorize any prior "Accepted," "CLOSED," "Frozen," or equivalent label anywhere in the repository's history; establish a Project Owner succession mechanism; or authorize implementation beyond what §3.1(4) narrowly permits.

## 13. References

- `docs/specs/mental-maths/Senior_Phase_Scope_Resolution_Framework__PROPOSED.md`
- `docs/specs/mental-maths/Grade5_Arithmetic_Fluency_Draft_v0.1_Consolidated.md`
- `docs/adr/ADR-022-mental-maths-r12-product-scope-governance.md`
- `docs/adr/ADR-INDEX.md`
- Governance reconnaissance findings (four read-only passes, Senior Phase Mental Maths workstream, commits `2015a10` through `1ffa9cb`)

---

*End of ADR-023, as proposed. Not yet accepted. Confers no authority to anyone until the bootstrap acceptance described in §11 occurs, as its own separate, explicit commit.*
