# Senior Phase Candidate-Scope Resolution Framework (ACCEPTED — methodology only)

> **ACCEPTED AS METHODOLOGY under ADR-023 §5. NOT TAXONOMY AUTHORITY. NOT IMPLEMENTATION AUTHORIZATION.**
> Acceptance establishes this document's reasoning rules (§2–§12) as the
> methodology this project uses to reason about Senior Phase candidate
> scope. It does not resolve any candidate's scope question, assign any
> taxonomy status, or authorize any implementation. Approving this
> framework's reasoning rules is a distinct act from authorizing anyone
> to apply them and declare a result frozen (see §13) — that authority
> now exists under ADR-023's Project Owner role, but its exercise for
> any specific candidate is a separate, later governance act, not a
> consequence of this acceptance. This document supersedes no existing
> document. See acceptance commit for the act's details.

## 1. Purpose and status

This is a draft proposal for review only. It resolves none of the five
candidates (`mulDivFluency`, `powersRootsFluency`, `ratioSharing`,
`addSub`, `fracDecPercent`), assigns no taxonomy status, and creates no
Generation Policy or specification.

It exists to answer a question none of the five scope-decision reviews
could answer on their own: not "is this candidate's evidence sufficient
to conclude bundle or split," but "what rule would this project use to
reach that conclusion at all." Governance reconnaissance
(`docs/specs/mental-maths/`, ADR-022, `Senior_Taxonomy_v1.0_Working_Skeleton.md`)
found no such rule anywhere in the repository prior to this document.

## 2. Candidate definition

A **candidate** is the unit at which CAPS evidence is gathered, a
generation policy is eventually written, and grade authorization is
granted or withheld. A candidate is proposed to require both:

- **(a) Evidentiary coherence** — the CAPS material grouped under it
  can be evidenced (named, worked, or both) as a recognizable unit, not
  merely co-located text.
- **(b) Generation coherence** — items generated under the candidate
  would plausibly represent the same underlying practice target at the
  relevant grade, even where item forms or numerical representations
  vary.

Neither condition alone is sufficient. Internal variation in item form
(squares vs. roots vs. exponent laws, all under one coherent domain) is
not itself evidence for splitting — the test is whether the practice
target is shared, not whether the surface forms are identical.

## 3. CAPS topic headings ≠ generation units

**A CAPS topic heading is evidence of relatedness, never proof of a
single generation unit, and never proof of separateness either.** This
holds regardless of direction — a single heading over multiple
mechanisms ("Exponents") does not by itself justify bundling; multiple
sibling bullets ("Properties of whole numbers") do not by itself
justify splitting.

The worked-example criterion should distinguish **independently
demonstrated mechanisms** (each sub-item gets its own worked example,
at its own point in the text) from **multiple examples within one
shared clarification passage** (several instances illustrating what is
presented as a single mechanism). The former is weaker evidence for
bundling than the latter; the `fracDecPercent` deeper evidence pass is
the clearest instance of this distinction actually changing an
evidence read in this project.

## 4. Grade progression and continuity

CAPS continuity language (e.g. "learners consolidate... developed in
Grade 8") is evidence of longitudinal development. It is **not, by
itself, evidence that all grade-specific content constitutes one
candidate.** CAPS can state that a skill continues across grades while
the generation targets at each grade remain materially distinct enough
to warrant separate treatment. Continuity is one input toward §2(b)
coherence, not a decisive rule — this distinction matters specifically
for `powersRootsFluency`, where G7 content (squares/cubes/roots) and G9
content (integer exponent laws, negative scientific notation) sit under
one continuity statement but are not obviously the same practice
target.

## 5. Evidence of internal coherence

A candidate's internal coherence is supported by: shared practice
target across sub-items (§2b); independently-worked-but-thematically-
unified examples (§3); and stated CAPS continuity (§4) — each weighted,
none decisive on its own, and none ever derived from legacy
implementation structure (§7).

## 6. Shared-sentence vs. shared-mechanism-family overlap

Two distinct overlap types require two distinct treatments, neither
defaulting to a resolution:

- **Shared-sentence overlap** (the same CAPS worked material is cited
  as evidence for two different candidates — e.g. `addSub` ↔
  `mulDivFluency`'s inverse-operations sentence): this is a
  **mandatory boundary-resolution flag**, not a default toward
  merging. It establishes that the boundary between the two candidates
  is unresolved and requires explicit treatment. The eventual
  governance decision must determine whether the shared material
  represents one underlying practice target evidenced twice, or two
  genuinely distinct targets that happen to share a source passage.
  Repeated independent use of the same mechanism across grades or
  contexts may become evidence *toward* bundling, but it is not itself
  the outcome.
- **Shared-mechanism-family overlap** (different CAPS material, same
  underlying mechanism applied to different number types — e.g.
  `fracDecPercent` ↔ `powersRootsFluency`'s squares/roots-of-fractions
  material): proposed treatment is to **preserve the boundary as
  unresolved pending explicit analysis of whether the number-type
  distinction is generation-relevant** — not a default toward either
  merging or a stated "extends to" relationship. The number-type
  distinction may turn out to matter or may not; that determination
  belongs to the governance pass, not to this framework.

## 7. Legacy implementation firewall

A candidate's existing code name or existing `AUTHORIZED_FAMILIES`
membership must never be treated as input to §2(a) or §2(b), nor to any
overlap resolution under §6. This has been followed as a per-document
non-inference constraint in every scope review to date; this framework
elevates it to a standing rule so it need not be re-asserted in every
future document.

## 8. Evidence sufficiency and decision readiness

Evidence sufficiency is not one threshold — it is at least three
distinct thresholds, and conflating them is a defect this revision
specifically corrects:

- **Sufficient to characterize** — enough evidence exists to describe
  what CAPS says about the candidate (this is what every evidence-
  review checkpoint already achieves for all five candidates).
- **Sufficient to support a proposed decision** — enough evidence
  exists that an authorized governance judgment could reasonably choose
  bundle, split, or explicit deferral, and defend that choice against
  the evidence on record. This does not require named-and-worked
  coverage at every grade as a universal prerequisite — CAPS itself is
  sometimes uneven (detailed clarification notes at one grade, a bare
  topic name at another), and a decision may still be proposable on the
  evidence that does exist.
- **Sufficient to freeze** — the proposed decision has additionally
  passed whatever authorization step ADR-022's lifecycle calls for
  (§13) and been recorded as a freeze checkpoint (§15).

A candidate may be at "sufficient to characterize" without being at
"sufficient to support a proposed decision," and may be at the latter
without ever reaching "sufficient to freeze" if no authorization step
exists yet — which is the repository's actual current state for all
five candidates.

## 9. OPEN criteria

A candidate's scope question should remain recorded as OPEN whenever
any of the following hold: evidence tier is uneven across sub-
constructs without a stated CAPS reason for the unevenness; no CAPS or
governance statement affirmatively supports the specific bundle/split
outcome under consideration; a pre-existing implementation split or
bundle has no locatable justification; or a relevant cross-candidate
overlap (§6) has not itself been resolved.

**OPEN is a valid governance outcome, not merely a temporary failure to
decide.** A future reader should not read an OPEN status as unfinished
administrative work — it may represent a considered conclusion that the
evidence genuinely does not resolve the question, and that no
governance judgment has yet been made (or should yet be made) to
resolve it in evidence's absence.

## 10. Resolution outcomes: Bundled / Split / OPEN / Deferred

Four distinct possible outputs:

- **A — Bundled**: the evidence supports the bundle, or — where
  evidence does not determine the boundary — an authorized governance
  judgment explicitly chooses bundling for stated reasons.
- **B — Split**: the evidence supports the split, or — where evidence
  does not determine the boundary — an authorized governance judgment
  explicitly chooses splitting for stated reasons.
- **C — OPEN**: no bundle/split determination has been made.
- **D — DEFERRED**: an authorized governance judgment deliberately
  postpones the determination, with a stated reason and, where
  possible, a stated trigger condition for revisiting it.

DEFERRED is not a synonym for OPEN — it records that a choice was
actively made to postpone, not merely that no choice has been made. All
five candidates' current scope reviews conclude C (OPEN), not D — no
deferral judgment has been made for any of them; the question has
simply not yet been addressed by an authorized decision process.

## 11. Cross-candidate sequencing

Overlapping candidates — `addSub` ↔ `mulDivFluency` (shared-sentence)
and `fracDecPercent` ↔ `powersRootsFluency` (shared-mechanism-family) —
must be **considered together in the same governance decision record**,
never resolved independently. Resolving one side of an overlap first
would implicitly constrain the other side's outcome without that
constraint ever being reviewed as its own decision. Recording both
sides in the same decision record (rather than merely discussing them
in the same session) preserves a durable audit trail of that joint
consideration.

## 12. Evidence-derived conclusion vs. governance judgment

**A governance judgment may resolve a question that the evidence alone
does not resolve, but the resulting decision must identify that
judgment as governance judgment rather than represent it as a
CAPS-derived conclusion.**

This is the framework's central philosophical safeguard. Concretely: it
is legitimate to write "CAPS evidence does not establish whether A and
B should be one generation candidate; governance nevertheless bundles
them for stated product-taxonomy reasons X, Y." It is not legitimate to
write "CAPS therefore requires A and B to be bundled" when no CAPS
statement says so. Every future taxonomy decision produced under this
framework must carry this distinction explicitly, **sentence by
sentence where relevant** — not as a general disclaimer at the top of
the document. A generic disclaimer is not sufficient if the body
subsequently states "CAPS requires..." when the source only supports a
governance judgment.

## 13. Governance authorization

This framework proposes criteria for reasoning about bundle/split/
OPEN/deferred. It does **not** establish who is authorized to apply
those criteria and declare a candidate's status frozen — and,
critically, **approving this framework as methodology does not itself
create that authority.** Two separate questions exist:

- **Methodology authority** — "what rules should we use to reason
  about scope?" This framework, if reviewed and accepted, would answer
  this question.
- **Decision authority** — "who or what is authorized to declare a
  resulting taxonomy decision frozen?" Nothing in this framework,
  ADR-022, or `Senior_Taxonomy_v1.0_Working_Skeleton.md` answers this
  question, and this framework does not attempt to manufacture an
  answer. This gap is the governance blocker the reconnaissance
  surfaced, and it remains open regardless of this framework's own
  status.

Any bundle/split/OPEN/deferred determination produced using this
framework is, until that second question is answered, only a
**proposed taxonomy outcome** — never a frozen one.

## 14. Freeze requirements

Using the Grade 5 C12/C13 chain as the repository's existing freeze
precedent (not a hypothetical process, and not evidence of who is
authorized to freeze Senior Phase — only evidence of how a freeze was
documented once authorization existed), a Senior Phase taxonomy
decision would require: (a) an evidence checkpoint, (b) a scope-
decision review, (c) an explicit decision document applying a stated
rule (this framework, if authorized, or a successor) and explicitly
separating evidence-derived findings from governance judgment per §12,
(d) explicit sign-off from whatever authority §13's open question
eventually designates, and (e) a checkpoint recording the freeze itself
as its own distinct commit.

Steps (a)–(b) exist today for all five candidates; (c)–(e) exist for
none of them, and (c) cannot exist until this framework or a successor
is itself reviewed and accepted — and even then, (d) remains blocked
pending §13.

## 15. Non-inference constraints

- This framework does not resolve any of the five candidates' scope
  questions.
- This framework does not itself constitute the "Taxonomy review" or
  "Taxonomy freeze" stages of ADR-022's lifecycle — it is a proposed
  input to those stages, not a substitute for them.
- Acceptance of this framework's methodology must not be read, cited,
  or later represented as also having resolved §13's decision-authority
  question.
- No cell, rule, or example in this framework should be read as
  pre-resolving any specific candidate's overlap or bundle/split
  status — the `addSub`/`mulDivFluency` and `fracDecPercent`/
  `powersRootsFluency` examples used throughout are illustrative of the
  *rule type*, not a preview of the outcome.
- The Grade 5 precedent (§14) is cited for documentation-pattern
  purposes only, never as authorization precedent.

## What can now be checkpointed

This proposed framework is ready to checkpoint as a doc-only artifact.
It does not resolve any of the five candidates' scope questions, assign
any taxonomy status, create any Generation Policy, or authorize any
implementation. The five candidates remain **C — OPEN**. The
decision-authority question in §13 remains unresolved and is not
addressed by this document.

## Next steps (not authorized by this document)

1. This framework itself should be reviewed and either accepted,
   revised, or rejected as methodology — a decision distinct from, and
   prior to, applying it to any candidate.
2. Separately from this framework, §13's decision-authority question
   (who/what may approve and freeze a Senior Phase taxonomy decision)
   should be addressed — this is a governance blocker independent of
   this framework's own acceptance.
3. Two stale documents remain queued for their own, separate
   documentation-maintenance commits: `Candidate_Universe_Status_Consolidation.md`
   and `Senior_Phase_Cross_Candidate_Scope_Matrix.md`'s repository-record
   caveat.
4. Only after 1–2 are resolved should the five candidates' bundle/
   split/OPEN/deferred determinations be attempted.

---

*End of proposed framework. No taxonomy status assigned. No Generation
Policy. No implementation or test changes. `public/*` WIP untouched.*
