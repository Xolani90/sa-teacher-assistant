# ADR-004: Class-Aware Learner Identity Resolution

**Status:** Accepted
**Depends on:** ADR-003 (Learner Identity Resolution — Foundation)
**Author context:** SA Teacher Assistant, `sa-teacher-assistant` repo

---

## Context

ADR-003 introduced `resolveLearner()` as the sole entry point for learner
identity resolution, with deterministic matching rules:

- Match only within the same teacher (`phone_hash`).
- If `classId` is known, match only within that class.
- If `classId` is null, match only against learners with `class_id IS NULL`.
- Never widen the search across classes automatically.
- Never move a learner between classes automatically.

ADR-003 deliberately shipped with `classId` always passed as `null` from
both write paths, on the grounds that class-context determination was a
separate concern from transactional identity resolution. This ADR picks up
that deferred concern.

## Current State (verified against the codebase, not assumed)

- Learner identity is currently resolved entirely in the unclassed domain:
  `(phone_hash, normalized_name)`.
- `flows/assessmentFlow.js` calls `processAssessmentData(phoneHash, assessmentData)`.
  `assessmentData` carries no `classId` field.
- `flows/observationFlow.js` calls
  `saveObservationSubmission(phoneHash, header, records)`. Neither `header`
  nor any argument carries a `classId`.
- Neither WhatsApp conversation flow ever asks the teacher which class a
  submission belongs to. There is no class-selection step in either flow
  today.
- `assessmentFlow.js` calls `getTeacherByPhone(from)` for the Pro
  entitlement check, then discards the returned teacher row — it is never
  used for identity context.
- `observationFlow.js` does not load a teacher row at all before calling
  `saveObservationSubmission()`.
- `teachers.default_class_id` exists (`utils/database.js`:
  `ALTER TABLE teachers ADD COLUMN default_class_id INTEGER`) and is
  returned by `getTeacherByPhone()` (a `SELECT *`).
- `default_class_id`'s actual behavior, traced in
  `teacherWorkspaceService.js`:
  - Set automatically only when a teacher creates their **first** class
    (`createClass()`, `classCount === 1` branch).
  - **Not** updated when a second, third, etc. class is created.
  - Can be changed explicitly via `setDefaultClass()`.
  - On deletion of the current default class, reassigned to an arbitrary
    remaining class (`SELECT id FROM classes WHERE phone_hash = ? LIMIT 1`,
    no ordering) or set to `NULL` if none remain.

### Key finding

> `default_class_id` is a user preference, not evidence of the teacher's
> current instructional context.

It is technically available and reliably populated for single-class
teachers, but nothing in its update logic ties it to what a teacher is
actually working on in a given conversation. For any teacher with 2+
classes, treating it as an implicit "current class" signal would silently
misattribute submissions for every class other than whichever one happened
to be created first.

Consequently, class context must be established independently before
learner identity resolution begins.

## Problem Statement

The system has no authoritative source for determining the class
associated with an assessment or observation at the moment it is
submitted. Class-aware learner identity cannot be implemented by simply
threading `default_class_id` through the repository layer — that field
answers a different question than the one identity resolution needs
answered.

ADR-004 must therefore define how current instructional context is
established before `resolveLearner()` can be called with a real `classId`.

## Design Space Considered

1. **Always ask** — every assessment/observation submission requires an
   explicit class selection, regardless of how many classes the teacher
   has.
2. **Ask only when ambiguous** — auto-select when there is exactly one
   valid class; ask only when more than one exists.
3. **Defer entirely** — keep all identity resolution unclassed until a
   richer scheduling/session concept exists elsewhere in the product.

## Decision Drivers

This decision is guided by the following principles:

- Preserve evidence correctness over convenience.
- Minimize friction for teachers with a single class.
- Avoid treating `default_class_id` as a proxy for the teacher's current
  instructional context.
- Keep learner identity deterministic and reproducible.
- Preserve existing repository contracts by establishing class context
  before learner identity resolution.

## Decision

**Option 2: ask only when ambiguous.**

Concretely:

| Teacher's class count | Behavior |
|---|---|
| 0 classes | Continue in unclassed mode (`classId = NULL`) — see Zero-class policy below |
| 1 class | Automatically use that class. No extra prompt. |
| 2+ classes | Ask explicitly: *"Which class is this assessment for?"* before processing. |

### Guiding principle

This decision is stated as a general rule so future contributors have a
consistent standard to apply wherever similar ambiguity arises elsewhere
in the product, not just for this feature:

> The system may automatically infer context only when there is exactly
> one valid interpretation. Whenever multiple valid interpretations exist,
> the teacher must explicitly choose.

### Why not the alternatives

- **Always ask** is correct in principle but adds friction to the common
  case (most teachers have one class) for no accuracy benefit in that
  case.
- **Defer entirely** avoids the UX problem but leaves ADR-003's
  `classId`-based matching rules permanently unused, and does not resolve
  the same-name-different-class collision risk that ADR-003 already flagged
  as a known gap.

## Consequences

- `assessmentFlow.js` and `observationFlow.js` both need a new step:
  resolve class count for the teacher before calling
  `processAssessmentData()` / `saveObservationSubmission()`.
  - 1 class → inject `classId` directly, no conversation change.
  - 2+ classes → add a class-selection turn to each flow's state machine.
- `default_class_id` is **not** read by either flow for this purpose. It
  remains scoped to whatever workspace/UX role it already serves
  (`teacherWorkspaceService.js`'s existing consumers) and must not be
  repurposed as an identity-resolution shortcut.
- Existing unclassed learners (created under ADR-003) are not
  retroactively reclassed by this ADR. Historical data remains in the
  unclassed bucket unless a separate backfill/migration is scoped later.
- `assessmentFlow.js`'s existing (currently discarded) `getTeacherByPhone()`
  call becomes reusable for class-count lookup — additive, no signature
  change needed there.
- `observationFlow.js` requires a **new** dependency injection (a teacher
  or class-count lookup) that does not exist in its `deps` shape today.

### Persistence impact

Establishing class context prior to learner identity resolution requires
the persistence model to retain that context, not just pass it through in
memory. Class is an attribute of the assessment/observation *event*
itself, not only of the learner identities inside it — without it, a
future "show me all assessments for Grade 5A" or class-level analytics
query has no way to resolve which assessments belong to which class,
even though the individual learner rows would.

Verified against the schema (`utils/database.js`): neither `assessments`
nor `observation_assessments` currently has a `class_id` column — only
`learners` does. Consequently, this ADR requires an additive migration on
both tables (`ALTER TABLE ... ADD COLUMN class_id INTEGER`), alongside
the application-layer changes above. The migration, flow changes, and
`resolveLearner()` call-site updates are treated as one implementation
unit rather than staged separately, to avoid an intermediate state where
class-aware identity resolution exists but the assessment/observation
records that identity is attached to still lack class context.

## Zero-class policy

Resolved as a transitional policy rather than deferred indefinitely:

Teachers with no classes may continue submitting assessments and
observations in unclassed mode (`class_id = NULL`). Once a teacher
creates at least one class, subsequent submissions follow the 0/1/2+
rule in the Decision table above. Existing unclassed data is not
retroactively reclassed by this policy (see Consequences).

This keeps onboarding and existing single-submission teachers unblocked
while class-aware resolution activates automatically as soon as a
teacher has any classes. A future ADR may revisit this if the product
later requires classes to be mandatory (e.g. district-level reporting).

## Non-goals

This ADR intentionally does not define:

- Fuzzy learner matching.
- Learner merge and split workflows.
- Timetable or scheduling-based inference of class context.
- Session-aware class persistence across multiple WhatsApp conversations.
- Migration or backfill strategies for existing unclassed learner
  identities.

These concerns remain future work and should be addressed in separate
ADRs or implementation proposals rather than expanding the scope of this
decision.

## Open Questions (explicitly out of scope for this ADR)

- Fuzzy matching, merge/split of learner identities across classes, and
  any backfill strategy for existing unclassed rows remain deferred, as
  originally scoped in ADR-003.
- Exact conversational copy/UX for the class-selection prompt is an
  implementation detail for the flows, not an architectural decision.
