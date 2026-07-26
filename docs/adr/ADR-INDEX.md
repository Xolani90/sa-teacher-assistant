# Architecture Decision Record Index

Entry point for understanding `sa-teacher-assistant`'s architecture before touching the code. Each row links to the full ADR under `docs/adr/`. Read in dependency order, not necessarily numeric order, if you're new to the codebase.

| ADR | Status | Depends On | Purpose |
|---|---|---|---|
| [ADR-001](./ADR-001-flow-boundaries.md) | Accepted (retroactive) | — | Flow module boundaries — the extraction pattern already used across four flows before this ADR documented it. |
| [ADR-002](./ADR-002-generation-pipeline.md) | Accepted | ADR-001 | Generation pipeline boundary — separates the AI generation step from the surrounding request/delivery flow. |
| [ADR-003](./ADR-003-longitudinal-learner-progress.md) | Accepted | ADR-001, ADR-002 | Learner identity model — the `learners` table and `resolveLearner()`, enabling any feature to track a learner across submissions rather than treating each as an isolated free-text name. Status confirmed via `git merge-base --is-ancestor`: the implementing commit (`c377f55`) is on `main`, and `tests/adr003-learners-migration.test.js` covers it. The file's own header previously said "Proposed" and was stale — corrected as part of this index. |
| [ADR-004](./ADR-004-class-aware-learner-identity.md) | Accepted | ADR-003 | Class-aware identity resolution — scopes a learner name to `(phone_hash, class_id)` rather than just `phone_hash`, so the same name in two different classes isn't merged into one learner. |
| [ADR-005](./ADR-005-assessment-blueprint.md) | Accepted | ADR-003, ADR-004 | Assessment Blueprints — reusable, versioned, CAPS-validated question metadata sitting in front of the existing diagnostic pipeline (`assessments`, `learner_results`, `item_analysis`, `error_analysis`, `intervention_plans`, `curriculum_coverage`), which ADR-005 explicitly does not rebuild. |
| [ADR-006](./ADR-006-assessment-session-engine.md) | Accepted (retroactive); PR4/PR5 not yet implemented | ADR-003, ADR-004, ADR-005 | Assessment Session Engine — the multi-turn WhatsApp state machine (`assessmentSessionFlow.js`/`assessmentCaptureService.js`) that captures marks per learner/question and commits once via the existing `processAssessmentData()` pipeline; optional roster prefill (PR2.5/PR3, `learnerRosterService.js`/`rosterFlow.js`); documents the invariant that any future bulk-capture (PR4) or corrections/undo (PR5) work must respect. |
| [ADR-007](./ADR-007-progress-mastery-coverage-services.md) | Accepted (implemented — PR4–PR10 merged to `main`) | ADR-003, ADR-004, ADR-005, `learnerTimelineService` (ADR-003 PR3) | Progress/Coverage/Mastery/Intervention service layer plus three independent delivery surfaces (WhatsApp, PDF, internal API) consuming the same `InterventionPlan[]`. This row previously read "Proposed; not yet implemented" and was stale relative to `main` — corrected alongside the ADR-007 file's own header, which had the same drift. |
| [ADR-008](./ADR-008-teacher-authentication.md) | Proposed — scoping only | ADR-003, ADR-004, ADR-007 | Teacher authentication for HTTP-facing surfaces (dashboard/mobile). Deliberately contains no implementation — records the open questions (identity proof, token issuance, teacher→class→learner ownership checks, WhatsApp-vs-dashboard identity) that need answers before `/api`'s current `ADMIN_SECRET` placeholder is replaced. |

## Reading this table

- **ADR-005 depends on both ADR-003 and ADR-004**, not because it introduces new identity concepts, but because it reuses learner identity (ADR-003) and class context (ADR-004) as-is — `assessment_blueprints`/`blueprint_questions` are new, but everything they feed into already resolves learners and classes through those two ADRs.
- **ADR-005 also depends implicitly on the pre-existing diagnostic pipeline** (`assessments` → `learner_results` → `item_analysis`/`error_analysis` → `intervention_plans`/`curriculum_coverage` → reports), which predates ADR-001 through ADR-004 and was never itself formalized as an ADR. If that pipeline's design is ever revisited, it may be worth retroactively documenting it the way ADR-001 retroactively documented flow boundaries.

## Notes for maintainers

- **Single source of truth per number.** `docs/adr/` must contain exactly one document per ADR number. Before this index was written, `docs/adr/ADR-005-intermediate-phase-assessment-intelligence.md` existed alongside the accepted `ADR-005-assessment-blueprint.md` — an earlier, superseded draft (a four/five-table parallel data model) left in the repo describing a different architecture than the one actually accepted. That file should be deleted (or, if you prefer an audit trail, moved to a `docs/adr/superseded/` folder and its own header updated to say `Superseded by ADR-005-assessment-blueprint.md`) — not left in `docs/adr/` under the same number as the accepted version.
- **Numbering vs. acceptance order.** ADRs are numbered in the order they were proposed, not the order they were accepted — ADR-003 was proposed before ADR-004 but its status header wasn't updated to `Accepted` until this index was written, well after ADR-004 (which depends on it) had already shipped.

## How to add a new ADR

1. Create `docs/adr/ADR-00N-short-title.md` following the structure of ADR-005 (Status → Context → Decision → Data Model → Consequences → Alternatives Considered).
2. Add a row to the table above, including its `Depends On` column.
3. If the new ADR changes the status or scope of an earlier one, update that ADR's own Status line to point at the superseding document rather than leaving both silently in force — and delete or clearly mark superseded any document sharing its number.
