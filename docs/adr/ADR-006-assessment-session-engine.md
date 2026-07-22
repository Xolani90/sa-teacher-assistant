# ADR-006: Blueprint Assessment Sessions (Marks Capture Engine)

## 1. Status

**Accepted (retroactive).** PR1–PR3 are implemented, tested, and referenced
throughout the codebase (`flows/assessmentSessionFlow.js`,
`services/assessmentCaptureService.js`, `services/learnerRosterService.js`,
`flows/rosterFlow.js`, Migration 031 in `utils/database.js`) — this document
formalizes a design that predates it, matching the pattern ADR-001 used for
flow boundaries. PR4 (bulk paste capture) and PR5 (corrections/undo/audit
history) are **not yet implemented**; they are recorded here as the intended
next steps so the invariant they must respect is decided before either is
built, not after.

Depends on: ADR-003 (learner identity), ADR-004 (class-aware identity),
ADR-005 (assessment blueprints — the `blueprint`/`questions` shape this
session engine consumes).

---

## 2. Context

ADR-005 established the Assessment Blueprint as reusable, versioned question
metadata sitting in front of the existing `assessments` /
`diagnosticWorkflowService.processAssessmentData()` pipeline. That answered
*what a test's questions look like*. It did not answer *how a teacher
actually gets marks for 30+ learners, one blueprint, from WhatsApp into that
pipeline* without either:

- forcing an all-or-nothing single message (unworkable for a full class), or
- inventing a second, parallel persistence path that bypasses the
  already-built diagnostic pipeline.

A teacher marking a class needs a **multi-turn conversation** — pick a
blueprint, pick a class, then supply each learner's marks — that can be
paused and resumed (a teacher marking during a free period will not finish
in one sitting), and that only ever writes to the database once, on
completion, using the exact same `processAssessmentData()` path a
single-shot assessment would use.

---

## 3. Decision

### 3.1 A session state machine, not a new persistence model

`flows/assessmentSessionFlow.js` owns a `SessionStore`-backed state machine
(`assessmentSessionState`, 24-hour TTL — deliberately long, since a teacher
may resume the next day):

```
SELECT_BLUEPRINT → SELECT_CLASS → ACTIVE (capture) → complete
                                      │
                                      └─ CANCEL from anywhere → session discarded
```

`services/assessmentCaptureService.js` implements the `ACTIVE` step as a
**pure function** (`submitReply(state, text) -> { state, event }`) with no
knowledge of WhatsApp, SessionStore, or the database — mirroring the
separation `blueprintAnalytics.js` / `blueprintRepository.js` already have.
This makes the capture logic (name → per-question marks → next learner →
completion) unit-testable without a database, and keeps `assessmentSessionFlow.js`
responsible only for prompts, persistence, and dispatch.

**Nothing is written to `learner_results` during capture.** Marks accumulate
in session state (autosaved by `SessionStore` after every turn) and are only
committed via `processAssessmentData()` — the same function a single-shot
assessment uses — once the last learner's last question is answered. A
teacher who abandons a session mid-capture leaves the database exactly as it
was before they started: no partial rows.

### 3.2 Roster is optional, layered on top (PR2.5 / PR3)

Migration 012's `classes.learner_count` is a number, not a named roster —
so PR2's original capture asked for each learner's name as it went,
matching how `resolveLearner()` already keys identity off a free-text name
rather than assuming a roster that doesn't exist.

PR2.5 / PR3 added an optional, genuinely-named roster
(`services/learnerRosterService.js`, Migration 031's soft-delete column) that
a teacher populates once via `flows/rosterFlow.js` (`ROSTER` / `ADD LEARNER`
/ `REMOVE LEARNER` / `CLEAR ROSTER`). When a class has a saved roster,
`initCapture()` prefills learner names from it in order and skips the NAME
step entirely for however many learners the roster covers, falling back to
PR2's ask-every-name behaviour once it runs past the roster's end. A class
with no roster is functionally unchanged from PR2.

### 3.3 The invariant that governs everything not yet built

This is the decision PR4 and PR5 must not violate, decided now rather than
discovered mid-implementation:

> **A capture *input mechanism* is not a *persistence mechanism*.** Every
> entry path into an assessment session — single-turn name/marks prompts,
> a roster-prefilled walkthrough, or a future bulk paste — must normalize
> to the same in-memory session state shape before `processAssessmentData()`
> is ever called. `processAssessmentData()`, `item_analysis`,
> `error_analysis`, and everything downstream of it must never branch on
> *how* the marks arrived.

Concretely, this rules out code shaped like:

```js
if (bulkMode) {
  // a second way of writing to learner_results
}
```

and requires instead that a bulk path (PR4) produce the *same*
`{ learnerName, questionData }` shape PR2's per-turn capture already
produces, via a pure adapter, before it ever reaches the existing
completion/persistence code path.

### 3.4 Deferred to PR4 (not yet implemented)

**Bulk paste capture.** A teacher pastes multiple learners' marks in one
message instead of answering one prompt per learner/question. Per §3.3,
this must be implemented as a pure parser/adapter converting pasted text
into the same shape `submitReply()`'s per-turn state already produces, then
routed into the existing `ACTIVE` step and existing completion/persistence
code — not a parallel capture or persistence path.

### 3.5 Deferred to PR5 (not yet implemented)

**Corrections, undo, and audit history.** Once a session (or a completed
assessment) has committed marks, a teacher will need to correct a mistake.
This is intentionally out of scope for PR1–PR4: it touches already-persisted
`learner_results` rows rather than in-flight session state, and deserves its
own design (e.g. whether corrections are edits-in-place or append-only audit
entries) rather than being folded into the capture engine.

---

## 4. Consequences

- Capture logic is unit-testable in isolation from WhatsApp/DB (pure state
  machine in `assessmentCaptureService.js`).
- No new persistence path was introduced; `assessments` / `learner_results`
  / `item_analysis` / `error_analysis` / `intervention_plans` /
  `curriculum_coverage` (ADR-005) remain the single pipeline all capture
  modes feed into.
- Abandoned sessions cannot corrupt the database — writes only happen once,
  atomically, on completion.
- The roster (PR2.5/PR3) is additive and optional; removing it or a class
  never having one falls back cleanly to PR2's original behaviour.
- The §3.3 invariant is now a documented constraint that code review for
  PR4 and PR5 can check against, rather than an implicit assumption.

## 5. Alternatives Considered

- **Single-message-only capture** (no session state machine): rejected —
  unworkable for classes of 30+ learners against WhatsApp's message-length
  practicalities.
- **A parallel bulk-capture persistence path** for PR4 (writing directly to
  `learner_results` from parsed bulk text, bypassing session state): rejected
  up front via §3.3 — it would duplicate validation already implemented in
  `processAssessmentData()` and create two divergent code paths to maintain.
