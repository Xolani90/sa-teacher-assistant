# ADR-005: Assessment Blueprint (Reusable Question Metadata)

## 1. Status

**Accepted.** Extends the existing, already-integrated assessment pipeline (`assessments`, `learner_results`, `item_analysis`, `error_analysis`, `intervention_plans`, `curriculum_coverage`), and the identity models from ADR-003 (learner identity) and ADR-004 (class context).

This revises an earlier draft of ADR-005 that proposed a new parallel data model (`AssessmentBlueprint` / `AssessmentInstance` / `Question` / `LearnerResult` as new tables). A schema audit against the current codebase found that model would duplicate an assessment pipeline that already exists and is already wired end-to-end via `diagnosticWorkflowService.processAssessmentData()`. This version reflects that finding.

---

## 2. Context

### What prompted this ADR

A teacher submitted an Excel workbook ("Offline Test Analysis – Intermediate Phase") used to mark and analyse tests, asking for it to be incorporated into the bot. An audit of the workbook found real deficiencies worth solving properly rather than replicating: no automatic totals/percentages, ~24,000 recalculating array formulas causing performance problems, a fixed 400-row allocation regardless of actual class size, and unvalidated free-text topic tagging that silently fragments analytics.

### What the schema audit found

Before designing a new subsystem, the existing codebase was audited against six questions. The result changes the scope of this ADR substantially:

| Domain | Audit question | Finding |
|---|---|---|
| Learners | Is there exactly one canonical learner identity? | Yes — `learners` table (Migration 024), resolved via `resolveLearner()` (ADR-003), referenced by `learner_results.learner_id`. |
| Classes | Is there exactly one canonical class identity? | Yes — `classes` table (Migration 012), referenced by `learners.class_id` and `assessments.class_id` (Migration 027, ADR-004). |
| Assessments | Does an existing table already represent what a new `AssessmentInstance`/`Question`/`LearnerResult` model would add? | **Yes, almost entirely.** `assessments` + `learner_results` + `item_analysis` + `error_analysis` + `intervention_plans` + `curriculum_coverage` already implement per-question topic tagging, deterministic totals/percentages, learner grouping, reteaching recommendations, and curriculum coverage tracking — orchestrated end-to-end by `diagnosticWorkflowService.processAssessmentData()`. |
| Observations | Can observation records reference `LearnerResult` rather than duplicate assessment data? | Already the case — `observation_records.learner_id` (Migration 025) references the same `learners` table as `learner_results.learner_id`. |
| Curriculum | Is there already a CAPS topic repository? | Yes — `CAPS_TOPICS` is exported from `curriculumIntelligenceService.js`. Not yet consulted, however, when `item_analysis.topic` or a future blueprint's topic is written — that validation link does not exist yet. |
| Reporting | Can the existing PDF/report pipeline consume new deterministic analytics without a second reporting engine? | Yes — `pdfService.js` and `interventionReportsService.js` already consume `item_analysis`/`error_analysis`/`intervention_plans` and persist output via `reports`. |

**Conclusion:** the deterministic assessment engine this platform needs already exists. The one concept genuinely missing is **reusable, versioned question metadata decoupled from a single assessment run** — i.e. a Blueprint. Today, `assessments` is an isolated event: if three classes write the same test, question/topic metadata is re-entered three times, and there is no versioning if a topic tag is later found wrong.

---

## 3. Decision

### Extend, don't parallel-build

This ADR does not introduce a new assessment pipeline. It introduces exactly one new concept — the **Assessment Blueprint** — as an optional, nullable link in front of the existing `assessments` table. Everything downstream of `assessments` (learner results, item/error analysis, intervention plans, curriculum coverage, reports) is unchanged and is treated as an explicit, referenced dependency of this ADR, not something it recreates.

```
Today:              Assessment → Diagnostic Pipeline

This ADR:  Blueprint → Assessment → Diagnostic Pipeline
                       (unchanged)
```

### Canonical Data Principle (retained from the prior draft)

> Every educational insight in the platform must be derived from canonical assessment data, never from presentation artifacts.

WhatsApp, Excel, and PDF remain transport/import/export formats, not sources of truth. The source of truth is now:

```
Assessment Blueprint (new, optional)
        ↓
Assessment (existing)
        ↓
Learner Results (existing)
        ↓
Item / Error Analysis (existing)
        ↓
Intervention Plans / Curriculum Coverage (existing)
        ↓
Reports (existing)
```

### Deterministic Reproducibility Principle (retained from the prior draft)

> Every deterministic calculation must be reproducible from the database without AI.

This is already true of the existing pipeline (`item_analysis`, `error_analysis`, totals/percentages in `learner_results` are all computed server-side, not AI-inferred) and continues to hold for the Blueprint layer: CAPS validation and blueprint versioning are both deterministic, not AI-assisted.

---

## 4. Data Model

### New

```
assessment_blueprints {
    id
    title
    subject
    grade
    term
    version              // integer, starts at 1
    previous_version_id  // nullable, links revision chain
    status               // draft | published | archived
    phone_hash           // creator (FK -> teachers.phone_hash)
    created_at
}

blueprint_questions {
    id
    blueprint_id          // FK -> assessment_blueprints.id
    question_number
    max_marks
    topic                 // required, CAPS-validated (Section 7)

    -- nullable, populated as later phases need them:
    subtopic
    bloom_level
    atp_reference
    expected_misconceptions
    cognitive_level
}
```

### Extended (one column, nullable)

```
assessments {
    ...existing columns, unchanged...
    blueprint_id   INTEGER NULL REFERENCES assessment_blueprints(id)
}
```

No other existing table changes. `learner_results`, `item_analysis`, `error_analysis`, `intervention_plans`, `curriculum_coverage`, `observation_assessments`, `observation_records`, `learners`, `classes` are all referenced as-is.

---

## 5. Blueprint Lifecycle

Unchanged in principle from the prior draft, now scoped only to the new tables:

- **Draft** — freely editable while a teacher is designing the assessment. No `assessments` row may set `blueprint_id` to a draft blueprint.
- **Published** — locked as soon as the first `assessments` row references it. No further edits to `blueprint_questions` under that `blueprint_id`.
- **Archived** — retained for historical reference; no new assessments may reference it, but existing ones keep working.
- **Revision** — a correction creates a new `assessment_blueprints` row (`version + 1`, `previous_version_id` pointing at the prior version) rather than editing a published one.

```
Fractions Test v1  (assessment_blueprints.id = 1)
 ├── Assessment: Grade 6A Term 2   (assessments.blueprint_id = 1)
 ├── Assessment: Grade 6B Term 2   (assessments.blueprint_id = 1)

Teacher discovers Q7 should be "Decimals"

Fractions Test v2  (assessment_blueprints.id = 2, previous_version_id = 1)
 ├── Assessment: Grade 6C          (assessments.blueprint_id = 2)
```

Reports already generated for Grade 6A/6B continue to reflect what those classes actually wrote against v1 — nothing about `assessments`, `learner_results`, or `reports` changes retroactively.

---

## 6. Metadata Sources

Unchanged from the prior draft — three supported paths into `blueprint_questions`:

**A — AI-generated assessments.** The bot already generated the worksheet/test, so topic (and, once populated, subtopic/Bloom/ATP reference) is known at generation time. `assessment_blueprints` and `blueprint_questions` are created automatically; no teacher input required.

**B — Excel import.** The uploaded workbook already associates each question with a topic (`Maths Analysis` row 7, `Raw Data` topic list). This is parsed into a new `assessment_blueprints` row and its `blueprint_questions`, run through CAPS validation (Section 7), then presented to the teacher for confirmation before `assessments`/`learner_results` are populated via the existing `storeAssessment()` / `storeLearnerResults()`.

**C — Teacher-authored assessment.** The only path requiring manual entry. A guided flow (WhatsApp initially) asks, per question: topic and max marks, validated against `CAPS_TOPICS` as each is entered. Metadata is captured once at Blueprint creation, not re-requested on every subsequent upload against that blueprint.

---

## 7. CAPS Validation Rules

`blueprint_questions.topic` must resolve against `CAPS_TOPICS` (already exported from `curriculumIntelligenceService.js`) — this link does not exist today and is the primary new business rule introduced by this ADR.

```
Teacher enters "Fractions"   → ✓ exact match in CAPS_TOPICS → accepted
Teacher enters "Fraction"    → no exact match
                              → "Did you mean: Fractions / Decimal Fractions?"
```

A blueprint cannot move from `draft` to `published` while any `blueprint_questions.topic` is unresolved. This solves the exact failure mode the spreadsheet had (`Fractions`, `Fraction`, `fraction`, `Fractions & Decimals` tracked as four distinct topics) without touching `item_analysis.topic`, which continues to operate as it does today. Extending the same validation to `item_analysis.topic` directly is noted under Future Work (Section 9) rather than required here, since it touches the existing analysis pipeline rather than only the new tables.

---

## 8. Phase 1 Scope

**Goal:** introduce reusable, CAPS-validated, versioned question metadata in front of the existing assessment pipeline — without modifying that pipeline.

**In scope:**
- `assessment_blueprints` and `blueprint_questions` tables
- Nullable `assessments.blueprint_id`
- Blueprint lifecycle (draft / published / archived / versioned revision)
- CAPS validation at blueprint-question creation
- All three metadata sources (Section 6)
- Excel import producing a Blueprint, then flowing into the existing `storeAssessment()` / `storeLearnerResults()` / `diagnosticWorkflowService.processAssessmentData()` pipeline unchanged

**Explicitly out of scope for Phase 1** (already exists, referenced not rebuilt):
- Totals, percentages, topic totals, class averages — `learner_results` + `item_analysis` already compute these
- Learner grouping, intervention plans, reteaching recommendations — `learnerGroupingService`, `interventionPlanService`, `errorAnalysisService` already produce these
- Curriculum coverage tracking — `curriculumCoverageService` already exists
- PDF/diagnostic/HOD/parent reports — `pdfService.js` + `interventionReportsService.js` already exist
- Learner and class identity resolution — ADR-003/ADR-004, unchanged

**Also explicitly out of scope** (deferred to later phases, not part of this ADR):
- AI-generated misconception detection from distractor patterns
- Longitudinal blueprint-level trend reporting (e.g. "Fractions v1 vs v2 comparison across years")
- Retroactively validating existing `item_analysis.topic` rows against `CAPS_TOPICS`

---

## 8a. Implementation Order

1. **ADR-005 approval** — architecture only, no code.
2. **Schema audit** — complete (Section 2). Confirmed: reuse `learners`/`classes` as-is; no new identity tables; extend `assessments` rather than replace it.
3. **Database migration** — `assessment_blueprints`, `blueprint_questions`, plus `ALTER TABLE assessments ADD COLUMN blueprint_id`.
4. **CAPS validation** — wire `blueprint_questions.topic` writes through `CAPS_TOPICS`, including the "did you mean" fuzzy-match path.
5. **Blueprint intake pipeline** — all three metadata sources (Section 6), each terminating in a call to the existing `storeAssessment()` with `blueprint_id` populated.
6. **Excel import** — parse `Raw Data` + `Maths Analysis` into a Blueprint (Section 12), present for teacher confirmation, then hand off to the unchanged existing pipeline.
7. **No new deterministic-analytics or reporting work** — verify existing `item_analysis`, `error_analysis`, `intervention_plans`, `curriculum_coverage`, and `pdfService`/`interventionReportsService` output correctly for blueprint-originated assessments as an integration/regression check, not a build step.
8. **AI layer** — unchanged; already an enhancement layer on top of the existing deterministic pipeline (`interventionPlanService` etc.), not a dependency of it.

---

## 9. Future Work (non-normative)

- **Deriving `item_analysis.topic` from `blueprint_questions` (Phase 2).** Phase 1 deliberately leaves `item_analysis.topic` as free text, generated by the existing pipeline exactly as it is today — see the boundary in Section 10. The longer-term path, once enough assessments originate from a Blueprint, is:

  ```
  Blueprint Question
          │
          ▼
  Validated CAPS Topic
          │
          ▼
  Assessment
          │
          ▼
  Item Analysis
          │
          ▼
  Reports / Intervention Plans / Curriculum Coverage
  ```

  At that point every topic feeding analytics is guaranteed CAPS-valid, without normalizing or migrating any historical `item_analysis` row — legacy assessments without a `blueprint_id` simply keep using their existing stored topic values for backward compatibility.

  **Future Migration Trigger:** once more than approximately 90–95% of newly created assessments originate from Assessment Blueprints, the system may begin deriving `item_analysis.topic` from `blueprint_questions` instead of accepting arbitrary free text for blueprint-originated assessments. This is a condition to watch for, not a commitment made by this ADR — it should be evaluated (and, if pursued, proposed as its own ADR) once that adoption level is actually reached.

- Blueprint-level longitudinal analytics (cross-year, cross-version comparison of the same test).
- AI-driven misconception detection from distractor-level data, once question-level answer options are captured (not currently modeled anywhere in the schema).
- District/circuit/provincial-level analytics. Introduces multi-tenant data sharing and POPIA considerations that are a distinct architectural concern and must not influence this ADR's scope.

---

## 10. Consequences

**Positive:**
- No duplicate assessment pipeline to build, test, or maintain — reuses `diagnosticWorkflowService`, `itemAnalysisService`, `errorAnalysisService`, `interventionPlanService`, `curriculumCoverageService`, `pdfService`, `interventionReportsService`, ADR-003 identity, and ADR-004 class context as-is.
- Three classes writing the same test share one blueprint's question metadata instead of re-entering it three times.
- CAPS-validated topics at the blueprint layer prevent the exact fragmentation the spreadsheet allowed.
- Blueprint versioning preserves historical report integrity without touching `assessments` or `learner_results` retroactively.
- Minimal migration surface: two new tables plus one nullable column, versus the four-to-five-table parallel model in the prior draft.

**Costs / trade-offs accepted:**
- `item_analysis.topic` remains free text for now (Section 9) — CAPS validation only covers newly-created blueprints in Phase 1, not the existing analysis pipeline's topic field. This is a deliberate scope boundary, not an oversight, to avoid touching tested, working code as part of this ADR.
- Assessments created without a blueprint (`blueprint_id IS NULL`) remain fully supported — Blueprint adoption is optional, not mandatory, for Phase 1.

---

## 11. Alternatives Considered

- **Original ADR-005 draft — new parallel `AssessmentBlueprint`/`AssessmentInstance`/`Question`/`LearnerResult` model (rejected after audit).** Would duplicate `assessments`/`learner_results`/`item_analysis` functionality that already exists, is tested, and is integrated with identity, reporting, and intervention services. Rejected specifically because the audit found the deterministic engine already built.
- **Retrofitting CAPS validation directly onto `item_analysis.topic` instead of introducing a Blueprint layer (rejected for Phase 1).** Solves validation but not reuse — still requires re-entering question metadata per class/term. Deferred to Future Work as a smaller, separate change.
- **Mutable Blueprint, no versioning (rejected).** Silently changes the meaning of historical reports when a correction is made after classes have already written the test.

---

## 12. Migration Strategy from Excel

1. Parse `Raw Data`'s topic list and `Maths Analysis` row 7 (topic per question) and row 9 (max marks per question) into a new `assessment_blueprints` row and its `blueprint_questions`.
2. Run every parsed topic through CAPS validation (Section 7) before the blueprint can be published; surface any unresolved topic to the teacher for confirmation rather than guessing.
3. For each detected term block in the workbook, create an `assessments` row with `blueprint_id` set, then call the existing `storeLearnerResults()` with the parsed marks — no new storage logic required here.
4. From that point, the existing `diagnosticWorkflowService.processAssessmentData()` pipeline runs unchanged, producing item analysis, error analysis, learner grouping, intervention plans, curriculum coverage updates, and reports exactly as it does for any other assessment.

This gives teachers a concrete "upload your existing file, we do the rest" path while adding zero new code to the parts of the pipeline that already work.
