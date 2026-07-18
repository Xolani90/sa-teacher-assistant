# Architecture Decision Records

This directory records significant architectural decisions made during the
modularisation of `sa-teacher-assistant`, along with the evidence that
supports them.

## Convention

- **ADRs** (`ADR-NNN-title.md`) are decision records. They should stay
  concise and answer: what was decided, why, what alternatives were
  considered, and what is explicitly out of scope. An ADR should be
  readable on its own without needing to re-derive the reasoning from the
  codebase.
- **Analysis documents** (e.g. `generation-pipeline-analysis.md`) are
  supporting evidence — technical inventories, call graphs, dependency
  maps — gathered by inspecting the actual code rather than by inference.
  An ADR should cite the analysis document(s) that justify it rather than
  duplicating their content inline.
- Analysis documents are living documents and may be updated as
  implementation surfaces new information. ADRs, once accepted, are not
  rewritten — a changed decision gets a new ADR that supersedes the old
  one.

## Index

| Document | Type | Summary |
|---|---|---|
| [ADR-001](./ADR-001-flow-boundaries.md) | ADR | Defines what qualifies as an extractable flow module, based on the four completed extractions (observationFlow, workspaceFlow, worksheetFlow, assessmentFlow) and two investigated non-cases (lessonPlanFlow, onboardingFlow). |
| [generation-pipeline-analysis.md](./generation-pipeline-analysis.md) | Analysis | Dependency inventory, call graph, and state ownership analysis for `processGeneration()`, gathered before drafting ADR-002. |
| [ADR-002](./ADR-002-generation-pipeline.md) | ADR | Generation pipeline extraction boundary — scopes core/generationPipeline.js, informed by the analysis document above. |
| [generation-pipeline-interface-sketch.md](./generation-pipeline-interface-sketch.md) | Draft | triggerGeneration() public API — parameter shape, ownership boundaries, and control-flow contract, separated into evidence-backed (stable) vs. non-binding (deferred) sections. |

See `PROJECT_STATUS.md` at the repo root for current extraction progress
and metrics.
