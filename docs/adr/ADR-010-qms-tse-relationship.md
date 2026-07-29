# ADR-010: TSE is the Evidence Infrastructure for the QMS Module

## Status
Accepted

## Context

Two independent planning efforts produced overlapping designs for the same
underlying capability:

- **TSE (Teacher Support Evidence)** was implemented directly across
  Migrations 034–036: `tse_evidence_links` (a phone_hash-scoped,
  category-tagged index pointing back at existing evidence rows —
  `assessments`, `saved_resources`, `reports`, `intervention_plans`,
  `curriculum_coverage`, `observation_assessments`), `tseEvidenceService.js`
  (`tagEvidence()` / `getStatusSnapshot()`), `tseGrowthInsightService.js`
  (rule-based gap detection), and the WhatsApp `MY GROWTH` command
  (`flows/tseMyGrowthFlow.js`) plus `GET /api/tse/status`.

- **QMS (Quality Management System)** was independently planned in two
  separate architecture-audit documents
  (`docs/SA_Teacher_QMS_Architecture_Audit.md` and `..._v2.md`), targeting
  IQMS/PGP/SACE-style teacher portfolios, professional growth plans,
  reflections, moderation, and SMT/HOD oversight. Both documents propose a
  `qms_evidence_tags`/`qms_evidence_links` table that is structurally
  near-identical to the already-shipped `tse_evidence_links` table, without
  awareness that it already existed.

Comparing the two: TSE's fixed evidence categories (`curriculum`,
`assessment`, `intervention`, `observation`, `resource`) map almost
one-to-one onto the QMS categories described in the audits (Curriculum
Coverage, Assessment, Moderation, Learner Support, Planning). This is not a
coincidence of two similar but separate features — it is the same
initiative, designed twice from different angles: TSE from the
implementation side, QMS from the product/compliance side.

## Decision

QMS and TSE are not competing designs and do not need to be reconciled by
picking one and discarding the other. They operate at different layers:

- **QMS is the product domain and user-facing capability.** Teacher
  portfolios, growth plans, reflections, evidence collection, moderation,
  readiness/gap checks, and SMT/HOD-facing compliance reporting. This is
  what teachers and the product should be described as.

- **TSE is the technical implementation layer that powers QMS.** The
  evidence index, tagging service, gap-detection rules, and snapshot
  generation already shipped and already proven in production.

Concretely:

1. `tse_evidence_links` remains the **canonical evidence table**. No
   parallel `qms_evidence_tags` or `qms_evidence_links` table will be
   created. Any future QMS capability that needs to know "what evidence
   exists for this teacher" reads from `tse_evidence_links` via
   `tseEvidenceService`.

2. `tseEvidenceService.js` and `tseGrowthInsightService.js` remain the
   implementation layer, unchanged in name and location. No `tse*` service
   or table is renamed to `qms_*`.

3. Genuinely new QMS capabilities that have no existing analogue —
   professional reflections, Personal Growth Plans, portfolio snapshot
   export, and a natural-language readiness/gap-check layer — are real,
   additive scope. They are not duplicates of TSE and should be built as
   new services/tables that sit on top of and reference the existing TSE
   evidence infrastructure, not beside it as a second evidence system.
   These live under a `modules/qms/` (or equivalent) namespace, e.g.
   `reflectionService.js`, `growthPlanService.js`, `portfolioService.js`,
   `readinessService.js`.

4. **User-facing terminology consistently uses QMS.** Command names,
   dashboard copy, and any teacher-facing documentation refer to "QMS" /
   "Quality Management System," not "TSE." `MY GROWTH` continues to exist
   as-is; whether future QMS commands sit under that same command or get a
   distinctly namespaced `QMS` command (per the naming-collision risk
   already flagged in the QMS audit docs, §4.2) is a follow-up decision,
   not resolved by this ADR.

5. Internally, code continues to call into the `tse*` services directly
   (e.g. `tseEvidenceService.getStatusSnapshot(...)`). There is no
   requirement to wrap or rename these calls for QMS-layer code to use
   them.

## Consequences

- One evidence engine, one source of truth. No risk of the two evidence
  indexes drifting out of sync or double-counting the same underlying rows.
- No churn on already-shipped, tested code (`tse_evidence_links`,
  `tseEvidenceService`, `tseGrowthInsightService`, `tseMyGrowthFlow`,
  `GET /api/tse/status` all stay as they are).
- Both existing QMS audit documents
  (`SA_Teacher_QMS_Architecture_Audit.md`, `_v2.md`) remain useful as
  product-scoping references for the genuinely new QMS capabilities
  (reflections, growth plans, portfolio, readiness/gap-check), but their
  proposed `qms_evidence_tags`/`qms_evidence_links` table designs are
  superseded by this ADR and should not be implemented.
- Anyone reading the codebase later has one place (`docs/adr/ADR-010`) that
  explains why both "QMS" and "TSE" appear throughout the project, and
  which one is the product name vs. the implementation name.
