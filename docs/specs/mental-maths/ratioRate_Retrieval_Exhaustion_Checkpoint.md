# ratioRate — Retrieval-Exhaustion Checkpoint

> **NOT TAXONOMY AUTHORITY. NOT AN IMPLEMENTATION AUTHORIZATION.**
> This document records a read-only evidence-recovery search for a
> `ratioRate` scope-decision or evidence-review artifact, performed
> against this repository's full history and branch set. It freezes
> nothing, authorizes nothing, and creates no taxonomy, generation
> policy, or specification. It supersedes no existing document,
> including `ratioSharing_Scope_Decision_Review.md` or
> `ratioSharing_Evidence_Review_Checkpoint.md`, both of which remain
> historically intact and unmodified by this checkpoint.

## Purpose

`ratioSharing_Scope_Decision_Review.md` and
`Senior_Phase_Cross_Candidate_Scope_Matrix.md` both note that a
`ratioRate` scope review is referenced in prose by other project
documents (e.g. `mulDivFluency_Scope_Decision_Review.md`,
`Candidate_Universe_Status_Consolidation.md`) but that no
corresponding file could be located in the repository at the time of
those reviews. Those documents used "not locatable" language based on
the searches performed at the time.

This checkpoint records a more exhaustive, read-only recovery attempt
against the full repository — working tree, complete Git history
across all refs, and all local and remote branches — so that the
"not locatable" finding is either strengthened to "not locatable after
an exhaustive search" or overturned by an actual find. It does not
reopen or re-litigate the `ratioSharing` scope question itself, which
remains governed by the existing scope-decision review.

## Searches performed

1. **Working-tree filename search** — `find` for any path containing
   `ratio` (case-insensitive) across the full checked-out tree,
   excluding `.git/`. Reviewed every match for relevance.
2. **Full Git history, all refs** — `git log --all --full-history`
   for any path ever committed matching `*ratioRate*`,
   `*ratio_rate*`, or `*RatioRate*`, across every commit on every ref,
   not just the current branch tip.
3. **All local and remote branches** — `git branch -a`, to confirm
   which branches exist and could contain a `ratioRate` artifact not
   present on `main`.
4. **Commit messages, all branches** — `git log --all --oneline -i
   --grep="ratioRate"`, to catch a commit that might reference
   `ratioRate` in its message even if no file survived under that
   name.
5. **Full-text content search** — `grep -rn "ratioRate"` across the
   working tree (excluding `node_modules/` and `.git/`), to catch any
   mention of the term regardless of filename.

## Result

**No authoritative `ratioRate` evidence or scope-decision artifact was
located** by any of the above searches. Specifically:

- No file matching a `ratioRate`-named pattern exists in the current
  working tree.
- No commit in the full history of any ref ever added, modified, or
  removed a `ratioRate`-named file — the full-history filename search
  returned zero results.
- No branch, local or remote, contains such a file.
- The only commit message matching `ratioRate` (case-insensitive) is
  `63a1beb` ("Add ratioSharing scope-decision review (doc-only)"),
  which is the `ratioSharing` review itself, discussing the absence of
  a `ratioRate` review — not a `ratioRate` artifact.

### Where `ratioRate` does appear — and why none of it is evidence

The term `ratioRate` appears in ten files in the working tree. None
constitutes CAPS evidence or a scope-decision analysis for
`ratioRate`:

- **`services/mentalMathsService.js`** — legacy implementation only:
  a `genRatioRate` function, and a `ratioRate` entry in the legacy
  six-strand `STRANDS` list. Critically, `ratioRate` is **not** in
  `AUTHORIZED_FAMILIES` (`['mulDivFluency', 'powersRootsFluency',
  'ratioSharing']`) or in `FAMILY_GRADE_AUTHORIZATION`. Per this
  project's standing rule — already applied to `mulDivFluency`'s
  `genMulDiv`/`genMulDivFlat` and to `ratioSharing`'s own
  `genRatioSharing` — an existing code implementation is not treated
  as specification evidence and does not substitute for a CAPS
  retrieval.
- **`tests/mentalMathsService.test.js`** — tests against that same
  legacy code; same non-evidentiary status.
- **Nine `docs/specs/mental-maths/*.md` files**
  (`ratioSharing_Evidence_Review_Checkpoint.md`,
  `Senior_Phase_Cross_Candidate_Scope_Matrix.md`,
  `mulDivFluency_Scope_Decision_Review.md`,
  `powersRootsFluency_Scope_Decision_Review__RECONSTRUCTION.md`,
  `Candidate_Universe_Status_Consolidation.md`,
  `ratioSharing_Scope_Decision_Review.md`,
  `fracDecPercent_Evidence_Review_Checkpoint.md`,
  `ratioSharing_Retrieval_Gap_Checkpoint.md`,
  `roundEstimate_Evidence_Review_Checkpoint.md`) — each references
  `ratioRate` only in prose, either naming it as a sibling candidate
  or explicitly noting that its review file could not be found. None
  contains a CAPS evidence assessment, a worked example, grade
  coverage, or a scope/bundle-split analysis for `ratioRate` itself.

**No CAPS evidence for `ratioRate` was recovered** by this search, in
any form — first-hand, relayed, or reconstructed.

## What this checkpoint does not do

- It does not reconstruct a `ratioRate` taxonomy entry from the
  legacy `genRatioRate` implementation or from any other source. Per
  the non-inference constraints already in force for `ratioSharing`,
  implementation and naming are not specification authority.
- It does not infer, propose, or imply any boundary between
  `ratioSharing` and `ratioRate`.
- It does not search outside this repository (e.g. external CAPS
  document hosts, prior session uploads not present in this archive,
  or any storage location not part of this Git repository). Retrieval
  of an authoritative CAPS source for `ratioRate` from an external
  source remains a separate, not-yet-performed step, distinct from
  this repository-recovery search.
- It does not modify, supersede, or reopen
  `ratioSharing_Evidence_Review_Checkpoint.md`,
  `ratioSharing_Retrieval_Gap_Checkpoint.md`, or
  `ratioSharing_Scope_Decision_Review.md`, all of which remain
  historically intact.

## Conclusion

The repository-recovery route for `ratioRate` is exhausted. No
authoritative `ratioRate` evidence or scope-decision artifact exists
in this repository, in its full Git history, or on any branch.

`ratioSharing ↔ ratioRate` remains **C — explicitly OPEN**, per
`ratioSharing_Scope_Decision_Review.md`. This checkpoint strengthens
that finding's evidentiary basis (an exhaustive repository search, not
merely an unretrieved reference) but does not change its outcome. No
reconstruction or inference of a `ratioRate` boundary is authorized by
this or any prior document.

No taxonomy status, `AUTHORIZED_FAMILIES` entry, candidate ID,
Generation Policy, or implementation/test change is made or authorized
by this checkpoint.

---

*End of retrieval-exhaustion checkpoint. No taxonomy, Generation
Policy, implementation, or test changes are made by this document.*
