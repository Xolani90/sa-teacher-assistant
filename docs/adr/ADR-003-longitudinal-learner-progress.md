# ADR-003: Longitudinal Learner Progress

**Status:** Proposed
**Related:** `docs/adr/ADR-001-flow-boundaries.md`, `docs/adr/ADR-002-generation-pipeline.md`
**Purpose:** Establishes whether and how the system should model learner
identity persistently, as the prerequisite for any feature that answers
questions about a learner's progress over time rather than a single
assessment or observation in isolation.

---

## Context

### Current architecture

Evidence collected directly from the schema and the services that write
to it (`utils/database.js`, `services/observationRepository.js`,
`services/diagnosticWorkflowService.js`):

- Learners are represented only as `learner_name TEXT` — a free-text
  string, never a foreign key.
- `learner_results` scopes each learner name to a single `assessment_id`.
- `observation_records` scopes each learner name to a single
  `observation_assessments.id`.
- `reports` carries an optional `learner_name` column, set only for
  parent reports scoped to one learner — again just a string, not a
  reference.
- `classes` stores `learner_count INTEGER` only. There is no roster table;
  a class does not know the names of the learners in it.
- No `learner_id` column exists anywhere in the schema. A grep for
  `learnerId`/`learner_id` across the codebase returns zero matches
  outside of variable names inside single-request processing.
- No foreign key or join anywhere relates a learner record in one
  assessment to a learner record in another assessment, or to an
  observation record, or to a class roster entry.
- Observation processing intentionally performs case-insensitive matching
  *within a single submission* — `services/observationRepository.js`
  documents this directly: `"sipho" and "Sipho" are the same learner
  throughout this pipeline` (line 162). This confirms the intent to treat
  near-duplicate names as one learner was already recognized as
  necessary — but the matching, and the identity it establishes, is
  discarded once that submission finishes processing. It is never
  written anywhere that a later submission could read.

### Consequences of the current state

Given this, the system can currently answer:

- How did learners perform on *this* assessment?
- What misconceptions occurred in *this* submission?

It cannot answer:

- Is Sipho improving over time?
- Which learners have a persistent (recurring) misconception, as opposed
  to a one-off?
- Which CAPS outcomes has a given learner actually mastered?
- Did a given intervention work?
- Which learners belong together in an intervention group, based on
  shared, ongoing need?

This is a structural limitation, not an algorithmic one. No amount of
smarter analysis on top of the current schema can answer these questions,
because the data needed to answer them — a stable link between the same
learner across multiple records — does not exist yet.

### Why this is separate from curriculum coverage

The existing `classes`/curriculum-coverage tracking
(`services/curriculumIntelligenceService.js`, the "MY PROGRESS" command)
answers a different question than this ADR does. Keeping the distinction
explicit is the reason this feature exists at all, not an incidental
detail:

| Existing system | New system |
|---|---|
| Tracks what the teacher has taught | Tracks what the learner has demonstrated |
| Curriculum coverage | Learning evidence |
| Teacher-centric | Learner-centric |
| Planning | Progress |

The two are complementary, not competing: coverage answers "was it
taught," learner progress answers "was it learned." Connecting them is a
non-goal of this ADR (see below).

---

## Requirements

Stated independently of any implementation.

### Functional

- Persist learner history across assessments, terms, and years.
- Preserve original assessment evidence unmodified (marks, item-level
  results, misconceptions) as the source of truth for any derived view.
- Support trend analysis (is this learner improving, stagnating, or
  declining on a given outcome).
- Support intervention history (what was tried, and against what
  evidence).
- Support class-level aggregation (whole-class mastery, coverage).
- Support district-level aggregation later, without redesigning the
  storage model (per the Learner → Class → Teacher → School → District
  hierarchy sketched during initial scoping).

### Non-functional

- Minimal teacher setup. Teachers already enter grade/subject/class
  context; this should not require a separate onboarding step per
  learner.
- Backward compatibility. Every existing `learner_results` and
  `observation_records` row, written before this feature exists, must
  continue to work exactly as it does today.
- Recomputable analytics. If the trend/mastery logic changes later, it
  should be possible to recompute derived views from the immutable
  evidence without touching historical records.
- Auditability. It should always be possible to trace a derived claim
  ("Sipho has mastered equivalent fractions") back to the specific
  assessment evidence that produced it.
- No data loss. No migration path considered may drop or irreversibly
  alter existing rows.

### Options considered for identity

Three approaches were evaluated against the requirements above before
settling on the Decision below.

**Option A — Soft-key matching on normalized learner name.** No schema
change; join rows for the same teacher/class where
`LOWER(TRIM(learner_name))` matches. Cheapest, but silent misattribution
is permanent and invisible ("Thabo M" and "Thabo Mahlangu" never link),
there's no entity to correct a mismatch on, and every downstream reader
has to reimplement the same fuzzy-matching logic. Rejected: satisfies
none of the functional requirements durably, since it produces no stable
identity to build on.

**Option B — Persistent `learners` table with nullable `learner_id`,
matched automatically at write time by teacher + class + normalized
name.** Satisfies every functional requirement; additive-only migration
satisfies backward compatibility and no-data-loss; mismatches are
correctable later since a real entity exists to repoint. Costs a
migration and a matching implementation, and some historical rows stay
unmatched (`learner_id IS NULL`) unless backfilled separately. **Selected
— see Decision.**

**Option C — Same schema as B, but require explicit teacher confirmation
for every non-exact-match name before linking.** Highest data-quality
ceiling, since every link is a decision the teacher actually made, but
meaningfully worse on minimal-teacher-setup — every spelling variation
becomes an interruption — and requires building a new WhatsApp
confirmation flow (session state, timeouts, ambiguous replies) on top of
Option B's schema work. Rejected for Phase 1: the setup cost is too high
relative to the benefit, though nothing here precludes layering a
confirmation flow on top of Option B later for ambiguous cases.

---

## Decision

### Decision Summary

The system will:

1. Introduce a persistent `learners` table as the canonical learner
   identity.
2. Preserve all assessment and observation records as immutable
   evidence.
3. Compute mastery, trends, and intervention priorities as derived
   projections.
4. Migrate existing data incrementally without breaking current teacher
   workflows.

### System of Record

The authoritative source of learner history is the immutable evidence
stored in assessment and observation records. Any tables containing
mastery, progress snapshots, trends, intervention priorities, or
analytics are caches or projections and may be deleted and regenerated
without data loss.

### Full decision

We will:

1. **Introduce a persistent `learners` table as the canonical identity
   for learner history.** Existing assessment and observation records
   retain their original `learner_name` fields as immutable evidence
   while gaining an optional `learner_id` foreign key during migration.
2. **Preserve immutable evidence.** Assessment results and observation
   records, once written, are never overwritten to reflect a later
   "corrected" understanding of what happened. They are the permanent
   record of what was measured, when.
3. **Compute progress as projections.** Mastery percentage, intervention
   priority, risk level, and trend direction are derived from immutable
   evidence and are never the system of record — they can be deleted and
   recomputed at any time as analytics logic improves.
4. **Migrate incrementally.** Automatic matching at write time uses
   teacher + class + normalized name; unmatched names are left as
   `learner_id = NULL` rather than guessed at; no existing row requires
   modification to keep working; manual merge tools are deferred; no
   existing teacher workflow changes.

> **Architectural principle:** Immutable evidence is never overwritten.
> All analytics, mastery estimates, intervention priorities, and progress
> snapshots are derived projections that may be recomputed at any time
> from the underlying evidence.
>
> This principle is scoped narrowly to learner progress here, but is
> expected to apply equally to future work on district reporting, AI
> recommendations, and intervention planning.

```
Assessment
     │
     ▼
Assessment Result (immutable)
     │
     ▼
Learner Outcome Evidence (immutable)
     │
     ▼
Progress Snapshot (derived)
```

### Phase 1 scope (deliberately narrow)

1. `learners` table introduced (id, `phone_hash`, canonical name,
   optional `class_id`).
2. Existing `learner_results` and `observation_records` rows optionally
   linked via nullable `learner_id` — no backfill required for Phase 1;
   new writes populate it going forward.
3. Automatic matching by teacher + class + normalized name at write
   time.
4. A basic learner history page/command (what has this learner done, in
   order).
5. A simple trend graph — scores over time — as the first Progress
   Snapshot–style derived view.

---

## Consequences

### Positive

- A stable learner identity exists for the first time, unblocking trend
  analysis, intervention history, and class/district aggregation without
  further schema redesign.
- Existing data and workflows are completely untouched — the migration
  is additive-only, so nothing currently in production can regress.
- Mismatches are correctable after the fact (re-point a `learner_id`)
  rather than requiring a silent, unauditable re-normalization.
- The immutable-evidence/derived-projection split means future changes
  to mastery or risk logic never require touching historical assessment
  records — only recomputing the derived layer.

### Negative

- Historical rows written before this feature ships will mostly remain
  unmatched (`learner_id = NULL`) unless a separate backfill pass is
  scoped — Phase 1 only covers new data going forward.
- Automatic matching will occasionally get it wrong (e.g. two different
  learners named "Sipho N" in the same class); until manual merge tools
  exist, correcting this requires direct data access rather than an
  in-product tool.
- A new table and matching step add write-path complexity and a new
  migration to verify before merge.

### Trade-offs accepted

- We are choosing automatic matching (Option B) over teacher-confirmed
  matching (Option C), trading some near-term data-quality risk for
  materially lower teacher setup friction. This is reconsidered in
  ADR-004 if match quality proves insufficient in practice.
- We are choosing to defer manual merge tooling rather than build it
  alongside Phase 1, trading immediate correctability for a smaller
  initial scope.

---

## Non-goals

This ADR does not define:

- Learner matching algorithms (normalization rules, fuzzy matching,
  merge policy)
- Mastery scoring
- Intervention recommendation logic
- District analytics
- Predictive models
- Connecting curriculum coverage tracking with learner outcome evidence

These are intentionally deferred to follow-on ADRs or later phases, not
overlooked.

---

## Future extensions

Recorded so future contributors understand these are intentionally
deferred rather than overlooked:

- Parent progress reports
- Cross-term learner trends
- Intervention effectiveness analysis
- Class grouping recommendations
- School and district aggregation
- Predictive risk indicators
- Import/export of learner rosters

---

## Follow-on ADRs

- **ADR-004** — Learner matching algorithm (normalization, fuzzy
  matching, merge policy)
- **ADR-005** — Skill mastery computation
- **ADR-006** — Intervention recommendation engine
