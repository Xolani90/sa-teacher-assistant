# ADR-013: QMS Topic Taxonomy and Coaching Engine Foundation

## Status
Accepted

**Depends on:** ADR-010 (TSE evidence infrastructure), ADR-011 (QMS domain
model), ADR-012 (QMS action centre).

**Blocks:** PR33 (deterministic coaching engine) cannot begin until PR32
(this ADR's schema/flow decisions) is implemented and merged.

**Section ownership** — which PR implements which part of this ADR:

| Section | Implemented in |
|---|---|
| §3 Taxonomy | PR32 |
| §4 Architecture (helper, service contract, schema) | PR32 |
| §5 Flow Changes | PR32 |
| §6 Coaching Engine Foundation | PR33 |
| §7 Implementation Requirements | PR32 |
| §8 Testing Strategy — Sections 1–3.5, 4–7, migration | PR32 |
| §8 Testing Strategy — coaching engine sections | PR33 |

---

## 1. Status & Context

### Why PR32 exists

PR33 was originally scoped as "AI coaching and professional insights" —
deterministic rules over `qmsAnalyticsService` output, with an optional LLM
layer to rewrite recommendations into natural language. Designing that
engine's confidence scoring surfaced a hard dependency: every rule in the
design ("classroom management has appeared consistently across the last N
reflections") requires a canonical, comparable notion of *topic*.

Inspection of `services/reflectionService.js` and
`services/growthPlanService.js` confirmed no such canonical topic exists
today:

- `qms_reflections` has no topic/category/focus-area column at all. Topic
  is implicit inside free-text `content`.
- `qms_growth_plans` has a `target_area` column, but it is documented as
  "optional free-text focus area" — no enum, no validation, no shared
  vocabulary with reflections.

A parallel check of the observation subsystem (`utils/observationParser.js`,
`services/observationAnalysisService.js`) found the same pattern one layer
over: `domain` is also free text, parsed line-by-line from a WhatsApp
message with no `VALID_DOMAINS`-style enum. There is no existing controlled
vocabulary anywhere in the codebase to reuse — PR32 is a green-field design,
not a reconciliation of two competing taxonomies.

Without a controlled taxonomy, coaching rules would have to either (a)
infer topics from free text at read time — reintroducing exactly the kind
of non-deterministic classification this ADR's design principle (§9)
prohibits inside the coaching engine — or (b) treat every reflection as
topic-less, which defeats the purpose of pattern-based coaching entirely.

### Why this is one ADR, not two

PR32 (taxonomy foundation) and PR33 (coaching engine) were originally
planned as separate ADRs. They are consolidated here because the coaching
engine's confidence formula, evidence schema, and conflict-resolution rules
were designed *against* the taxonomy's shape — separating them risks the
two documents drifting out of sync. This ADR is the architectural contract
for both PRs; §3–5 govern PR32, §6 governs PR33.

---

## 2. Decision

1. Introduce a controlled QMS topic taxonomy — a fixed, closed set of
   `topicId` values, defined in a single shared module.
2. Standardize on `topicId` as the canonical field name everywhere a topic
   is stored or passed — in flows, services, and persistence.
3. Replace `qms_growth_plans.target_area` (free text) with a validated
   `topicId`. Add a new `topic_id` column to `qms_reflections`.
4. Historical rows remain untagged; no retroactive classification is
   performed. Untagged rows are excluded from coaching evidence (§6.6).
5. The observation subsystem's `domain` field is explicitly out of scope
   for this ADR (§9.3) — it is not migrated to this taxonomy now.
6. The coaching engine (PR33) consumes only validated `topicId` values.
   It performs no semantic classification of free text at any point.
7. Any future LLM integration is a presentation-layer concern only. It may
   rephrase deterministic output; it may never influence evidence
   selection, scoring, ranking, or recommendation generation (§10).

---

## 3. Taxonomy

### 3.1 Canonical topic list (initial release)

| topicId | Label |
|---|---|
| `TOPIC_CLASSROOM_MANAGEMENT` | Classroom Management |
| `TOPIC_ASSESSMENT` | Assessment |
| `TOPIC_LEARNER_ENGAGEMENT` | Learner Engagement |
| `TOPIC_DIFFERENTIATION` | Differentiation |
| `TOPIC_CURRICULUM_COVERAGE` | Curriculum Coverage |
| `TOPIC_PROFESSIONAL_PRACTICE` | Professional Practice |

This list is a provisional default for initial release, not a frozen
value set — see §3.4. Changes to the canonical taxonomy (adding, removing,
or renaming a `topicId`) require their own ADR or explicit architectural
review; an unreviewed edit to the constants module is not sufficient. The
taxonomy is a shared dependency of both flows and the coaching engine, so
casual expansion ("it's only a constants file") would undermine the same
determinism this ADR exists to protect.

### 3.2 `topicId` contract

Each taxonomy entry carries:

```js
{
  id: 'TOPIC_CLASSROOM_MANAGEMENT',   // stable, stored in DB, never renamed
  label: 'Classroom Management',       // human-readable, may change freely
  description: '...',                  // optional, for future onboarding UI
  order: 1,                            // optional, display ordering
}
```

`id` is the only value ever persisted. `label`/`description`/`order` may
change without a migration; `id` changing requires a migration. `order` is
schema-free but not behavior-free: it is a direct input to the coaching
engine's recommendation tie-break (§6.4). A change to `order` is a
behavioral change to coaching output, not a cosmetic UI edit, and should
go through the same review as any other change affecting recommendation
ranking — even though no migration is required to make it.

### 3.3 Validation rules

- Every write to `qms_reflections.topic_id` or `qms_growth_plans.topic_id`
  must validate against the current taxonomy's set of `id`s.
- Unknown `topicId` values are rejected at the service layer (same
  validation posture as `growthPlanService.js`'s existing `VALID_STATUSES`
  check).
- `topic_id` is nullable at the schema level, but that nullability exists
  solely to permit pre-PR32 legacy rows to remain unmigrated. New
  application writes must always provide a valid `topicId`; null is
  reserved exclusively for legacy rows and is never a valid value for a
  write originating from this PR onward.

### 3.4 Future extensibility

Adding a topic is additive (new entry in the shared module + no schema
change needed, since `topic_id` is a string column, not a DB-level enum).
Removing or renaming a topic's `id` is a breaking change requiring its own
migration and is out of scope for this ADR to pre-approve.

---

## 4. Architecture

### 4.1 Shared topic module

A single module (e.g. `utils/qmsTopics.js`) is the sole source of truth for
the taxonomy list in §3.1. No other file defines topic constants.

### 4.2 Shared stateless `qmsTopicSelection` helper

Both flows need identical topic-selection UX (render numbered list,
validate reply, map number → `topicId`). Rather than duplicate this in
`reflectionFlow.js` and `growthPlanFlow.js`, a shared helper (e.g.
`utils/qmsTopicSelection.js`) owns:

- rendering the numbered topic list from the shared module (§4.1),
- validating a teacher's numeric reply,
- mapping the reply to a `topicId`,
- returning the selected topic (or an explicit "invalid" result).

**The helper is stateless.** It takes input, returns output, and holds no
session data of its own. Conversation state (which step a teacher is on,
what they've entered so far) remains owned entirely by each flow's own
state map (`reflectionState`, `growthPlanState`), exactly as today. The
helper must not be extended later to own any part of session state — if a
future change seems to require that, it belongs in the flow, not the
helper. When rendering the numbered topic list, the helper must sort
topics by ascending `order` (§3.2) — never by module insertion order,
which is an implementation detail of §4.1's shared module and not a
guaranteed ordering.

### 4.3 Service-layer contract change

This is a public API rename, not a cosmetic one — audited and confirmed
during PR32 planning (see §5.2).

Before:
```js
createGrowthPlan(phoneHash, { goalText, term, targetArea, status })
```

After:
```js
createGrowthPlan(phoneHash, { goalText, term, topicId, status })
```

The reflection service takes the equivalent change, added here explicitly
rather than left implicit, since PR32 touches both services equally:

Before:
```js
createReflection(phoneHash, { lesson, wentWell, improvement })
```

After:
```js
createReflection(phoneHash, { lesson, wentWell, improvement, topicId })
```

**Canonical terminology:** the system standardizes on `topicId` as the
canonical identifier for instructional focus areas. Legacy free-text
concepts such as `targetArea` are replaced at the service boundary to
prevent semantic ambiguity between user-entered text and controlled
taxonomy identifiers. No parameter or column named `targetArea` may hold a
`topicId` value — the rename is atomic across flow, service, validation,
and persistence (§7.2).

**Analytics ownership boundary:** `qmsAnalyticsService` remains
responsible only for retrieving validated, tagged reflection and growth
plan data (i.e. querying by `topicId`, filtering nulls/mismatches per
§6.1). Topic aggregation, pattern detection, confidence scoring, and
recommendation generation belong exclusively to the coaching engine (PR33,
§6). `qmsAnalyticsService` does not compute confidence, does not rank, and
does not generate recommendations — it is a data-retrieval layer the
coaching engine sits on top of, not a partial implementation of it.

### 4.4 Database schema changes

- New migration adding `topic_id TEXT` (nullable) to `qms_reflections`.
- New migration adding `topic_id TEXT` (nullable) to `qms_growth_plans`,
  alongside removal (or deprecation) of `target_area` — exact column
  strategy (drop vs. rename vs. leave-and-ignore) is an implementation
  detail for the PR32 migration script, not frozen here, but the *service
  layer* must expose only `topicId` regardless of underlying column
  strategy.

**Database-level integrity:** `topic_id` is a plain `TEXT` column, not a
foreign key into a taxonomy lookup table, and no `CHECK` constraint
enforces membership in the current taxonomy. Validation is the service
layer's responsibility only (§3.3); the database will accept any string,
including one written outside the application (manual SQL, a future
migration, etc.). This is an accepted trade-off, not an oversight — it
avoids a lookup-table migration every time §3.4 adds a topic — and it is
exactly why §6.1 requires the coaching engine to treat any
taxonomy-mismatched `topic_id` as equivalent to null rather than trusting
the column's contents.

### 4.5 Migration strategy

Existing rows are not backfilled. They remain valid, readable, and
`topic_id IS NULL`. Coaching (PR33) treats untagged rows as excluded from
its evidence set (§6.6) — this is a deliberate product decision to avoid
speculative classification of historical free text, not an oversight.

---

The remainder of this ADR (§5–8) is normative rather than descriptive: it
exists to preserve behavioural compatibility already established by PR31
and PR31a, and to make PR32/PR33 implementable without further
interpretation. Where it reads like an implementation spec rather than a
typical ADR, that specificity is intentional.

## 5. Flow Changes

### 5.1 Reflection flow (`flows/reflectionFlow.js`)

Current state machine: `awaitingLesson → awaitingWentWell →
awaitingImprovement → reviewSummary`, with `awaitingCorrectionChoice`
dispatching back into any of the three collection steps.

**Placement decision:** `awaitingTopic` is inserted immediately before
`reviewSummary` — i.e. after `awaitingImprovement`, not at the start of the
flow. Rationale (settled during planning, not re-litigated here):

- Preserves the PR31a-verified guarantee that `REFLECT` and `reflect on my
  lesson` produce identical first prompts. Topic collection happening
  after all three content fields means the entry point is untouched.
- Matches teacher mental model: reflect first, categorize after — the
  question "which coaching area does this fit?" only makes sense once
  something has been written.
- Confines the regression surface to the tail of the state machine.

**Correction menu change:**

```
Before:                      After:
1. Lesson                    1. Lesson
2. What went well            2. What went well
3. What I would improve      3. What I would improve
4. Cancel                    4. Topic
                              5. Cancel
```

Cancel moves from option `4` to option `5`. No code may continue treating
`trimmed === '4'` as Cancel after this change — every literal check must be
updated, and a new `trimmed === '4'` branch added for Topic.

**Implementation constraints (from audit):**

- *Entry experience must remain unchanged.* `REFLECT`/`reflect on my
  lesson` first-prompt equivalence (PR31a) must continue to pass unchanged.
  Reflection still begins with `awaitingLesson`; no topic prompt appears
  before lesson capture.
- *State preservation.* The current implementation rebuilds explicit object
  literals (`{ lesson, wentWell, improvement }`) at every transition rather
  than spreading existing state. This must be refactored to immutable
  spread updates (`{ ...state, ... }`) throughout, so the newly added
  `topicId` field cannot be silently dropped by a transition that forgot
  to list it. This refactor is in scope for PR32 precisely because PR32 is
  already touching every transition in this file.

### 5.2 Growth plan flow (`flows/growthPlanFlow.js`)

Audited against the same three constraints as reflection flow, with the
following findings:

- **Entry experience:** unaffected. `NEW GOAL`'s first prompt is
  `awaitingGoal`, collected before `targetArea`/`topic`. No PR31a assertion
  touches this path.
- **Correction menu:** unaffected numerically. Current menu is `1. Goal /
  2. Focus area / 3. Cancel`. Relabeling `targetArea` → topic selection
  keeps the same three slots (`1. Goal / 2. Topic / 3. Cancel`) — topic
  *replaces* the second field rather than being inserted as a new one, so
  no renumbering occurs.
- **State preservation:** same defect pattern as reflection flow. All 8
  `growthPlanState.set(...)` call sites use explicit object literals
  naming `goalText`/`targetArea`. All 8 must be refactored to immutable
  spread updates.
- **Additional finding (not anticipated pre-audit):** `buildReviewSummaryMessage`
  and the call into `createGrowthPlan(...)` both destructure `targetArea`
  by name. These call sites must be renamed to `topicId` in the same PR as
  the service-layer contract change (§4.3) — the flow and service rename
  must land atomically, or the flow will pass a `topicId` value into a
  service parameter still named and documented as free-text `targetArea`.

---

## 6. Coaching Engine Foundation (governs PR33)

### 6.1 Why PR33 depends on taxonomy

Every rule in this section assumes `topicId` is present, validated, and
comparable across records. None of it is implementable against free text.

**Resilience against stale or invalid persisted `topicId` values.** §3.3
guarantees validation at write time, but does not guarantee every row the
coaching engine later reads still matches the *current* active taxonomy —
a topic could in principle be removed (§3.4) after rows referencing it
already exist, or a row could be modified outside the application (manual
SQL, data migration error). The coaching engine treats any persisted
`topic_id` that is not present in the current active taxonomy exactly like
a null `topic_id`: excluded from evidence, never surfaced, never a source
of an error or a recovery/inference attempt. This keeps the engine
resilient to data it doesn't fully control without weakening the
determinism guaranteed for data it does.

### 6.2 Evidence object shape

```json
{
  "type": "reflection",
  "id": 12
}
```

Structured `{ type, id }` references, not string identifiers like
`"reflection#12"`. Advantages: stable API, no parsing, extensible (e.g.
`term`, `createdAt` may be added later without breaking consumers).

### 6.3 Confidence formula (final, reconciled)

Earlier drafts of this ADR used two different weight sets. This is the
single canonical version; no other version is valid.

```
confidence = 0.40 × evidenceScore
           + 0.30 × consistencyScore
           + 0.30 × recencyScore
```

**evidenceScore** — normalized amount of supporting evidence:
```
evidenceScore = min(supportingEvidenceCount / DEFAULT_REQUIRED_EVIDENCE, 1.0)
```
where `DEFAULT_REQUIRED_EVIDENCE = 5`, a named configuration default (not
an inline magic number), defined alongside `DEFAULT_MAX_INSIGHTS` (§6.4).
Like the taxonomy and the insufficient-data thresholds, this value is a
provisional default rather than a calibrated one, but it must still be a
single named constant so the formula is reproducible from the ADR without
guessing.

**recencyScore** — freshness of the *newest* supporting evidence item only
(not averaged across evidence — a single recent item is often exactly why
an insight should surface, and averaging would penalize that):

| Age of newest supporting evidence | Score |
|---|---|
| ≤ 30 days | 1.00 |
| 31–90 days | 0.75 |
| 91–180 days | 0.50 |
| > 180 days | 0.25 |

**consistencyScore** — proportion of recent *tagged* reflections
supporting the same topic:
```
consistencyScore = matchingTaggedReflections / relevantTaggedReflections
```
where `relevantTaggedReflections` is drawn from the last 10 reflections,
**restricted to those with a non-null `topic_id`**. Untagged reflections
within that window are excluded from both numerator and denominator — a
teacher is never penalized for writing reflections outside the taxonomy.

**Why recency and consistency use different windows:** this is intentional,
not an inconsistency. Recency answers "how recently has this happened?" and
looks at the single newest matching item regardless of history depth.
Consistency answers "how consistently has this happened recently?" and is
bounded to the last 10 tagged reflections specifically to prevent
old history from diluting a current pattern as a teacher accumulates years
of data.

**Worked example** (multi-evidence, not single-item):

- 5 supporting evidence items, `DEFAULT_REQUIRED_EVIDENCE = 5` → `evidenceScore = 1.00`
- Newest supporting item is 14 days old → `recencyScore = 1.00`
- 7 of the last 10 tagged reflections match this topic → `consistencyScore = 0.70`

```
confidence = 0.40×1.00 + 0.30×0.70 + 0.30×1.00 = 0.91
```

Tests assert this exact value (`assertEq(confidence, 0.91)`), not a
threshold check.

**confidenceLabel** — a deterministic label derived from the numeric score,
exposed in the API (§6.7) so presentation layers never need to duplicate
thresholds or parse the `explanation` string to recover it. Evaluated in
this order, first match wins:

```
confidence >= 0.75             → "High"
0.45 <= confidence < 0.75      → "Medium"
confidence < 0.45              → "Low"
```

### 6.4 Recommendation precedence / conflict resolution

```
Generate all applicable candidate recommendations
  → attach confidence (§6.3)
  → group by topicId
  → keep only the highest-confidence recommendation per topic
  → sort remaining candidates by confidence, descending;
    ties broken by topic `order` (§3.2) ascending, and any remaining tie
    broken by `topicId` ascending (lexicographic)
  → return the first DEFAULT_MAX_INSIGHTS
```

`DEFAULT_MAX_INSIGHTS` is a configurable default (initial value: 3), not a
hardcoded magic number in the rules engine. This guarantees the engine
never emits two contradictory recommendations for the same topic (e.g.
"keep focusing on X" and "move on from X") — only the strongest survives
deduplication. The three-level tie-break (confidence → order → topicId)
guarantees stable ordering even if two topics are ever accidentally
assigned the same `order` value; `order` values are expected to be unique,
but the `topicId` fallback means uniqueness is a convention to maintain,
not a precondition the sort depends on.

Multiple rule types may emit candidate recommendations for the same topic.
Deduplication (§6.4, "keep only the highest-confidence recommendation per
topic") happens after all rules have run and produced their candidates —
never inside an individual rule. No rule may short-circuit or suppress
another rule's output; the deduplication step alone is responsible for
resolving same-topic conflicts.

**Rules execute independently of one another and of registration/execution
order.** Whatever order rules run in, each produces its candidates without
reading or depending on another rule's output, and final output (post
dedup, sort, truncate) must be identical regardless of that order. This is
what makes deduplication-after-generation (rather than short-circuiting
inside a rule) safe: order-independence is a property the pipeline design
guarantees, not an incidental behavior of today's implementation.

### 6.5 Explanation field (deterministic, not free text)

The `explanation` field returned alongside each recommendation must be
template-generated from the same inputs as the confidence score — never
free text, never LLM-authored at this layer (that would reintroduce
non-determinism into a field the coaching engine is supposed to own).

Fixed template:
```
"Supported by {evidenceCount} evidence item(s). Observed in {matching} of
the last {relevant} tagged reflections. Latest supporting evidence:
{ageDays} days ago. Confidence: {confidenceLabel}."
```

### 6.6 Insufficient-data guard

Implemented first, before any pattern/recommendation logic. Provisional
default thresholds (explicitly not calibrated — see note below):

```
IF reflections < 3 OR activeGrowthPlans < 1
THEN return { status: "insufficient_data", recommendations: [] }
```

`activeGrowthPlans` is defined precisely as: growth plans whose `status`
equals `'active'` (per `growthPlanService.js`'s existing
`VALID_STATUSES` — not `in_progress`, `completed`, or `abandoned`). This
is stated explicitly so the guard's implementation counts the same set
of rows regardless of who writes it, rather than leaving "active" open to
interpretation against the four-value status enum.

**Note:** these thresholds are configuration defaults chosen for initial
release, not derived from usage data. They are expected to be revisited
once real usage volume exists. This is stated explicitly so the values are
never mistaken for a calibrated product decision.

### 6.7 Public API

```
getCoachingInsights(phoneHash, options) → {
  status,
  summary,
  recommendations,   // [{ topicId, topicLabel, recommendation, confidence, confidenceLabel, evidence, explanation }]
  generatedAt
}
```

Returns structured data only — no formatting, no WhatsApp markup, no
markdown. Designed to be called synchronously and identically from both a
future `MY INSIGHTS` WhatsApp command and a dashboard route. If an LLM
rewrite layer is added later (PR34), it sits strictly downstream of this
function's output and must never block or alter it.

---

## 7. Implementation Requirements

1. **Immutable state updates.** Both `reflectionFlow.js` and
   `growthPlanFlow.js` must use `{ ...state, ... }` spread updates at every
   `*State.set(...)` call site touched by this PR, not explicit field
   lists.
2. **Service rename.** `targetArea` → `topicId` lands atomically across
   flow, service, validation, and persistence — never partially.
3. **Stateless helper.** `qmsTopicSelection` (§4.2) holds no session state;
   conversation state stays owned by each flow.
4. **Single source of truth.** The taxonomy list (§3.1) is defined in
   exactly one module; nothing else hardcodes topic ids or labels.

---

## 8. Testing Strategy

- **Section 1 — Topic constants:** unique ids, unique labels, no duplicate
  metadata.
- **Section 2 — Reflection service:** accepts valid `topicId`, rejects
  invalid, persists correctly, existing behaviour otherwise unchanged.
- **Section 3 — Growth plan service:** same, plus confirms existing
  `VALID_STATUSES` validation is unaffected by the rename.
- **Section 3.5 — `qmsTopicSelection` helper (pure unit tests, tested
  directly, not only indirectly through the two flows):** topic list
  rendering, number → `topicId` mapping, invalid-reply handling, boundary
  conditions (e.g. reply out of range), and confirmation that the helper
  remains stateless across calls.
- **Section 4 — Reflection flow:**
  - Regression: PR31a first-prompt equivalence still holds unchanged.
  - Regression: progression through `awaitingLesson` →
    `awaitingWentWell` → `awaitingImprovement` unchanged.
  - New: `awaitingTopic` follows `awaitingImprovement`.
  - New: review summary displays selected topic.
  - New: topic survives correction cycles (editing lesson / went-well /
    improvement does not lose the previously selected topic).
  - New: correction menu shows Topic as option 4, Cancel as option 5;
    selecting Topic returns to `awaitingTopic`; selecting Cancel still
    exits correctly.
- **Section 5 — Growth plan flow:** entry prompt unchanged; correction
  menu numbering unchanged (`1. Goal / 2. Topic / 3. Cancel`); topic
  survives correction cycles; service call passes `topicId`, not
  `targetArea`.
- **Section 6 — Migration:** existing rows migrate/remain readable with
  `topic_id IS NULL`; new rows require a valid `topicId`.
- **Section 7 — Ownership regression:** `phone_hash` isolation unchanged
  for both reflections and growth plans; no cross-teacher leakage.
- **(PR33) Coaching engine sections:** insufficient-data guard; pattern
  extraction; recommendation rules (exact recommendations fire, unrelated
  ones do not); confidence (exact value assertions per §6.3); evidence
  traceability; ownership isolation — mirroring the rigor of PR30/PR31.
- **(PR33) Unknown persisted `topic_id` regression (§6.1):** a reflection
  or growth plan with a `topic_id` not present in the active taxonomy
  loads without error; is excluded from evidence/consistency counts, same
  as a null `topic_id`; does not throw; does not affect confidence
  calculated for other, validly-tagged topics.

---

## 9. Consequences

### 9.1 Benefits

- Coaching recommendations become genuinely explainable: every confidence
  number and every recommendation traces back to a reproducible formula
  over stored, validated data.
- The taxonomy is a single shared vocabulary across reflections and growth
  plans, eliminating the "Classroom Management" vs "classroom mgmt" vs
  "Behaviour Management" fragmentation that free text would otherwise
  produce.
- PR33 becomes small and low-risk: it consumes guaranteed-clean input
  rather than performing its own inference.

### 9.2 Trade-offs

- Two existing flows require non-trivial state-machine changes (not a
  pure additive change) — most notably the reflection flow's correction
  menu renumbering.
- Historical reflections and growth plans remain permanently untagged
  unless a future, separately-scoped effort backfills them; coaching
  insights will only ever reflect data captured after PR32 ships.
- The initial taxonomy (§3.1) and thresholds (§6.6) are provisional and
  will likely need revision once real usage data exists — this ADR does
  not claim they are correct, only that they are a concrete, testable
  starting point.

### 9.3 Explicit non-goals

- The observation subsystem's `domain` field is **not** migrated to this
  taxonomy by this ADR. It has the same free-text problem, but unifying it
  would touch `observationParser.js`'s WhatsApp free-text parsing UX and
  expand this PR's blast radius well beyond what PR33 needs. Left as a
  separate future decision.
- No retroactive classification of historical reflections or growth plans.
- No LLM integration of any kind is implemented by PR32 or PR33 (see §10).

---

## 10. Design Principle

QMS coaching is built in layers. User interactions collect structured,
validated data (`topicId`, reflections, growth plans). Analytics derive
deterministic evidence and recommendations from that data. Any future LLM
integration is strictly a presentation layer that may rephrase or
summarize deterministic outputs but must never influence evidence
selection, confidence scoring, ranking, or recommendation generation.

This principle has held consistently across PR30, PR31, PR31a, and this
ADR's planning for PR32/PR33. It is stated here explicitly so future
contributors have a single rule to follow rather than needing to infer it
from scattered implementation details.
