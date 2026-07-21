# ADR-005: Intermediate Phase Assessment Intelligence Engine

## 1. Status

Proposed — not yet implemented. Supersedes no prior ADR; extends the architectural direction of ADR-002 (generation pipeline extraction), ADR-003 (learner identity), and ADR-004 (class context).

---

## 2. Context

### Limitations of spreadsheet-based analysis

A teacher submitted an existing Excel workbook ("Offline Test Analysis – Intermediate Phase") used to mark and analyse tests, asking for it to be incorporated into the bot. An audit of the workbook found:

- **No total or percentage column.** Twenty topic-total columns are computed per learner, but nothing sums them or divides by the test's max marks — teachers do this by hand.
- **Severe performance cost.** Each of the 20 topic totals is a `SUMPRODUCT` array formula re-scanning 76 question columns, repeated across 400 pre-allocated learner rows × 3 terms — roughly 24,000 array formulas recalculating on every edit. This is the direct cause of the lag/freezing teachers experience.
- **Fixed, over-provisioned shape.** 400 rows per term regardless of actual class size (typically 35–45 learners); a hard ceiling of 76 questions.
- **Unvalidated topic tagging.** The topic assigned to each question is free text with no dropdown or validation, unlike marks entry (which does validate against each question's max). A misspelled topic silently drops that question from every topic total.
- **No error/sanity checking.** Nothing flags a learner total exceeding the test max, or distinguishes "no data" from "scored zero."
- **Analyses marks, not questions.** The workbook can report a topic score but has no way to surface which distractor learners chose, or what misconception a wrong answer implies.
- **No longitudinal or cross-term view.** Each term is a separate, disconnected block within the same sheet; there is no learner-history or class-trend concept.

### Requirements gathered from Intermediate Phase teachers

Distilled from what the spreadsheet's own design reveals teachers rely on:

- Capture learner marks, per question
- Map each question to a CAPS topic
- Compute per-topic and overall totals and percentages
- See class-level and learner-level breakdowns by topic
- Identify strongest/weakest topics
- Produce a printable report

---

## 3. Decision

### Assessment-centric architecture

The bot will not replicate the spreadsheet's structure (questions-as-columns, learners-as-rows, per-row recomputation). It will implement an **Assessment Intelligence Engine** built on a normalized relational model, where topic aggregation is a `GROUP BY / SUM` query rather than a per-cell formula.

### Blueprint / Instance separation

Question design (topic, subtopic, Bloom level, max marks, ATP reference) is decoupled from any single class's results. A **Blueprint** defines an assessment once; any number of **Assessment Instances** (one per class/group that writes it) reference that Blueprint and hold only that group's learner results. This avoids re-entering identical question metadata for every class that writes the same test, and enables direct class-vs-class and blueprint-vs-blueprint comparison.

### Canonical Data Principle

> Every educational insight in the platform must be derived from canonical assessment data, never from presentation artifacts.

WhatsApp is a transport layer. Excel and CSV are import/export formats. PDF and DOCX are generated report formats. None of these are the source of truth. The source of truth is:

```
Assessment Blueprint
        ↓
Assessment Instance
        ↓
Learner Results
        ↓
Topic Analytics
        ↓
Interventions
        ↓
Longitudinal Progress
```

This mirrors the separation of concerns already established across prior ADRs (generation pipeline, learner identity, class context) and prevents transport/file formats from driving data-model decisions.

### Deterministic Reproducibility Principle

> Every deterministic calculation must be reproducible from the database without AI.

Totals, percentages, topic strengths, class averages, learner rankings, and longitudinal trends are all derived from stored assessment data via queries, not AI inference. AI's role is limited to *interpreting* those results — generating intervention plans, naming likely misconceptions, drafting teaching recommendations — never to producing the underlying metrics. This keeps reports consistent, testable without mocking an AI service, and resilient if that service is unavailable.

---

## 4. Data Model

```
AssessmentBlueprint {
    id
    grade
    subject
    term
    title
    status              // draft | published
    version             // integer, starts at 1
    previousVersionId    // nullable, links revision chain
    createdAt
}

Question {
    id
    blueprintId
    questionNumber

    topic                   // Phase 1 (required, CAPS-validated)
    subtopic                // nullable
    bloomLevel              // nullable
    atpReference             // nullable
    expectedMisconceptions  // nullable

    maxMarks

    metadataVersion
}

AssessmentInstance {
    id
    blueprintId
    classId
    term
    dateAdministered
}

LearnerResult {
    id
    instanceId
    learnerId
    questionId
    marksAwarded
}
```

Topic exists once per Blueprint, not once per learner per instance. Aggregation (learner totals, topic totals, class averages) is computed via query, not stored redundantly.

---

## 5. Blueprint Lifecycle

Blueprints are **versioned, not mutable**.

- **Draft** — freely editable while a teacher is designing the assessment. No instances may reference a draft.
- **Published** — locked as soon as the first `AssessmentInstance` is created from it. No further edits to questions, topics, or marks.
- **Revision** — if an error is discovered after publication (e.g. a mistagged topic), the system creates a new Blueprint version (`version + 1`, `previousVersionId` pointing at the prior version) rather than editing the published one.

```
Fractions Test v1
 ├── Instance: Grade 6A Term 2
 ├── Instance: Grade 6B Term 2

 Teacher discovers Q7 should be "Decimals"

Fractions Test v2
 ├── Instance: Grade 6C
 └── (future instances)
```

Reports already generated against v1 continue to reflect what those classes actually wrote. Only new instances pick up the correction. This preserves historical integrity while still allowing correction.

---

## 6. Metadata Sources

Question metadata (topic, subtopic, Bloom level, etc.) can enter the system through exactly three supported paths. This is treated as an explicit, first-class design decision rather than left ambiguous:

**A — AI-generated assessments.** The bot already generated the worksheet/test, so it already knows topic, subtopic, Bloom level, and ATP reference at creation time. No additional capture step.

**B — Spreadsheet import.** The uploaded Excel already associates each question with a topic (row 7 of the `Maths Analysis` sheet, and the topic list in `Raw Data`). This mapping is parsed and reused directly rather than re-entered.

**C — Teacher-authored assessment.** The only path requiring manual metadata entry. A guided flow (WhatsApp-based initially, or a lightweight web form if that proves more efficient) asks the teacher, per question: topic, marks, and optionally subtopic/Bloom level. Metadata is captured once at Blueprint creation, never re-requested when marks are later uploaded against an Instance.

---

## 7. CAPS Validation Rules

Topics entered against a Question (Path C, and Path B on import) must resolve against the existing CAPS Topic Registry already used elsewhere in the bot (the same registry that grounds `curriculumIntelligenceService.js`), not accepted as free text.

```
Teacher enters "Fractions"        → ✓ matches registry, accepted
Teacher enters "Fraction"          → no exact match
                                    → "Did you mean: Fractions / Decimal Fractions?"
```

This prevents the exact fragmentation the spreadsheet allowed (`Fractions`, `Fraction`, `fraction`, `Fractions & Decimals` all being tracked as distinct topics), which would otherwise silently corrupt topic-level analytics.

A Blueprint cannot move from Draft to Published while it contains any unresolved topic.

---

## 8. Phase 1 Scope

**Goal:** deliver every capability teachers rely on today, while removing known spreadsheet limitations. This is deliberately not the same as "spreadsheet parity" — several of the spreadsheet's failure points are not features to be preserved:

| Spreadsheet limitation | Phase 1 behaviour |
|---|---|
| No automatic totals/percentages | Computed automatically |
| Fixed 400-row allocation | Dynamic, sized to actual class |
| ~24,000 recalculating array formulas | Server-side `GROUP BY / SUM` query |
| Unvalidated free-text topics | CAPS Topic Registry validation (Section 7) |
| No learner identity model | Reuses ADR-003 learner identity |
| No class context | Reuses ADR-004 class context |

These are corrected implementations of the existing workflow, not "Phase 2 intelligence" — they ship in Phase 1 alongside the capabilities the spreadsheet does offer today.

**In scope:**
- Blueprint creation (all three metadata sources)
- Marks capture: manual entry, WhatsApp upload, spreadsheet import
- Deterministic, non-AI calculations only:
  - Learner totals and percentages
  - Topic totals (learner-level and class-level)
  - Class averages
  - Strongest / weakest topics
- PDF report generation

**Explicitly out of scope for Phase 1:** AI-generated intervention plans, misconception detection, learner grouping, observation integration, longitudinal trend reporting. These require Phase 1's data model to exist first and are listed under Future Work.

The `Question` schema (Section 4) is implemented in full from Day 1 — `subtopic`, `bloomLevel`, `atpReference`, and `expectedMisconceptions` exist as nullable columns even though Phase 1 only populates `questionNumber`, `topic`, and `maxMarks`. This avoids a schema migration when Phase 2 begins populating the remaining fields.

---

## 8a. Implementation Order

This ADR covers architecture only — no code ships as part of approving it. Implementation proceeds in the following sequence, keeping the deterministic foundation testable before any AI-derived analysis is introduced:

1. **ADR-005 approval** — architecture only, no code.
2. **Schema audit** — before any migration is written, answer the following concretely against the current codebase:

   | Domain | Audit question | Desired outcome |
   |---|---|---|
   | Learners | Is there exactly one canonical learner identity? | Reuse ADR-003 learner IDs everywhere; `LearnerResult` stores only `learnerId`, never duplicated learner attributes. |
   | Classes | Is there exactly one canonical class identity? | Reuse ADR-004 class IDs everywhere. |
   | Assessments | Does an existing table already represent part of `AssessmentInstance`? | Extend it rather than introduce a parallel structure, if one already exists. |
   | Observations | Can observation records reference `LearnerResult` rather than duplicate assessment data? | Single source of truth between observations and assessments. |
   | Curriculum | Is there already a CAPS topic repository? | `Question.topic` references it (Section 7) rather than storing arbitrary text. |
   | Reporting | Can the existing PDF/report pipeline consume the new deterministic analytics? | Avoid building a second reporting engine. |

   The new subsystem must reference existing canonical IDs rather than introduce a parallel identity concept.
3. **Database migration** — `AssessmentBlueprint`, `AssessmentBlueprintQuestion`, `AssessmentInstance`, `LearnerResult`.
4. **Import pipeline** — Excel import, WhatsApp manual entry, AI-generated assessments (the three metadata sources from Section 6).
5. **Deterministic analytics** — topic totals, learner totals, percentages, class averages, topic averages, strongest/weakest topics.
6. **PDF parity** — reports at least equivalent to the spreadsheet's outputs.
7. **AI layer (Phase 2+, not part of this ADR's implementation)** — intervention plans, misconception detection, teaching recommendations, longitudinal insights.

---

## 9. Future Work (non-normative)

Not part of this ADR's implementation; listed to show the model was designed with headroom, without committing current architecture to them:

- **Phase 2 — Intelligence:** AI-driven misconception detection from distractor patterns, automatic intervention grouping, reteaching-lesson generation.
- **Phase 3 — Longitudinal:** learner-level topic growth across terms, class-to-class and cohort comparisons, term-over-term trend reporting.
- **Phase 4 — Education Intelligence Platform:** HOD/principal dashboards, district/circuit/provincial analytics, Department-level reporting.

Phase 4 in particular introduces multi-tenant data sharing, cross-school access control, and POPIA compliance considerations that are a distinct architectural concern and must not influence Phase 1 design decisions.

---

## 10. Consequences

**Positive:**
- Topic aggregation becomes a single `GROUP BY` query instead of thousands of recalculating array formulas — eliminates the spreadsheet's core performance problem.
- Class size is dynamic; no more 400-row over-provisioning.
- Blueprint reuse means three classes writing the same test share one set of question metadata, enabling direct comparison.
- CAPS-validated topics prevent analytics fragmentation from free-text entry.
- The canonical model (Blueprint → Instance → Results) is format-agnostic, so WhatsApp, spreadsheet import, and future channels are all just different ways to populate the same source of truth.

**Costs / trade-offs accepted:**
- More upfront schema and validation work than a "just parse the Excel" approach.
- Blueprint versioning adds complexity (revision chains, locked-published state) relative to freely-editable spreadsheet cells.
- Path C (teacher-authored) still requires manual metadata entry per question — this ADR does not eliminate that cost, only ensures it's paid once per Blueprint rather than repeatedly.

---

## 11. Alternatives Considered

- **Direct Excel replication (rejected).** Treating the workbook as the software spec rather than a requirements document would inherit its performance ceiling, its lack of validation, and its per-term-block disconnection — solving none of the underlying problems.
- **Mutable Blueprint, no versioning (rejected).** Simpler, but silently changes the meaning of historical reports when a correction is made after classes have already written the test.
- **Free-text topics with post-hoc normalization (rejected).** Deferring validation to a cleanup job risks the same fragmentation the spreadsheet has today, and delays CAPS-alignment checks that should happen at creation time.

---

## 12. Migration Strategy from Excel

To reduce friction for teachers who already have workbooks in this format:

1. Provide an import path (Path B) that parses the `Raw Data` sheet's topic list and the `Maths Analysis` sheet's row 7 topic tags and row 9 max-marks per question.
2. Auto-generate a Blueprint from the parsed structure, with all topics run through CAPS validation before the Blueprint can be published.
3. Auto-generate one Assessment Instance per detected term block, with learner marks pulled from the existing rows.
4. Present the teacher with the reconstructed Blueprint for confirmation before publishing, so any parsing ambiguity (e.g. an unmatched topic) is resolved by the teacher rather than silently guessed.

This gives teachers a concrete "upload your existing file, we do the rest" path rather than requiring manual re-entry, which is likely necessary for adoption given this request originated from a teacher scrutinizing the bot against their current tool.

---

## Note on identity mapping (pre-implementation check)

Given the learner-identity and class-context work already completed (ADR-003, ADR-004), `AssessmentInstance.classId` and `LearnerResult.learnerId` are expected to map directly onto those existing canonical tables. This ADR does not skip that verification, however — Section 8a step 2 requires the schema audit to confirm it explicitly before any migration is written, since the answer affects foreign keys and repository interfaces regardless of how likely it is.
