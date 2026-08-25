# Senior Taxonomy v1.0 — Working Skeleton

> **NOT AUTHORITATIVE / NOT FROZEN**
> This document is a structural working artifact only. It contains no
> approved candidate-form decisions, no grade authorizations, and no
> generation policy content. It must not be treated as, cited as, or
> mistaken for the frozen Senior Taxonomy v1.0 specification. Nothing
> in this document authorizes implementation work.

## 1. Authority and Governance

- Governing decision record: **ADR-022** (Mental Maths R-12 Product
  Scope & Specification Governance)
- **Governance Rule 1** — No candidate form may be assigned a status
  (CLOSED / OPEN / DEFERRED / LOCKED) without documented CAPS
  evidence.
- **Governance Rule 2** — No grade may be authorized for generation
  without a corresponding frozen taxonomy decision covering that
  grade.
- **Specification lifecycle**: Evidence (draft → accepted/frozen) →
  Taxonomy draft → Taxonomy review → Taxonomy freeze → Generation
  Policy draft → Generation Policy review → Implementation
  authorization → Code.

## 2. Evidence Sources

| Source | Status |
|---|---|
| CAPS Evidence Set v0.1 | **Accepted / Frozen Evidence Baseline** |
| Grade 8 §3.3.2 (CAPS primary source) | **MISSING** — not yet retrieved |
| Grade 9 §3.3.3 (CAPS primary source) | **MISSING** — not yet retrieved |

## 3. Candidate-Form Evaluation Table

*No rows populated. Columns only — evaluation has not begun.*

| Candidate / Form Name | Mathematical Construct | CAPS Evidence | Evidence Category | Grade Applicability | Proposed Status | Rationale | Evidence Required |
|---|---|---|---|---|---|---|---|
| mulDivFluency | — | — | — | — | UNDECIDED | — | — |
| powersRootsFluency | — | — | — | — | UNDECIDED | — | — |
| ratioSharing | — | — | — | — | UNDECIDED | — | — |

**Implementation relationship**: Existing implementation code
(including `mentalMathsService.js`) has no evidentiary status and
cannot be used to fill evidence gaps, infer decisions, or substitute
for primary-source CAPS evidence.

## 4. Grade Authorization Matrix

| Grade | Authorization Status |
|---|---|
| G7 | UNDECIDED |
| G8 | UNDECIDED |
| G9 | UNDECIDED |

## 5. Explicit Decision Gates

1. No candidate status without documented evidence.
2. No grade authorization without taxonomy approval.
3. No generation range without an approved Generation Policy.
4. Existing implementation cannot serve as authority for taxonomy or
   evidence decisions.

## 6. Known Evidence Gap

- **Grade 8 §3.3.2** — primary-source CAPS evidence not yet
  retrieved.
- **Grade 9 §3.3.3** — primary-source CAPS evidence not yet
  retrieved. **Grade 9 Term 1 Whole Numbers is flagged as the most
  consequential single missing piece**, given its downstream effect
  on candidate-form evaluation.
- Locations already checked without success: repository contents,
  user uploads, external retrieval attempts. This gap should not be
  re-investigated via these same channels without new evidence
  becoming available.

---

*End of working skeleton. Section 4 remains UNDECIDED. No further
action on Senior Mental Maths taxonomy or code is authorized by this
document.*