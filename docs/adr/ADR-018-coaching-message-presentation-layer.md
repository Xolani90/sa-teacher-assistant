# ADR-018: Coaching Message Presentation Layer

## Status
Accepted

**Depends on:** ADR-013 (QMS topic taxonomy and coaching engine foundation),
ADR-016 (Coaching Trend Architecture), ADR-017 (Trend-Based Recommendation
Rule Integration).

**Implements:** PR40 (presentation layer), the fourth and final stage of the
PR37 → PR38 → PR39 → PR40 sequence set out in ADR-016.

---

## Context

Through PR36 and PR39 (ADR-017), each recommendation rule's `evaluate()`
returns a `recommendation` field containing a fully composed, teacher-facing
sentence — e.g. `growth_plan_missing` returns the literal string `"You have
identified a recurring pattern in ${ctx.topic.label} but don't yet have an
active growth plan."` `qmsFlow.js`'s `MY COACHING` handler renders that
string into the WhatsApp reply verbatim.

This conflates two concerns that ADR-016 §9 and ADR-017 already went to
some lengths to keep apart at the analytics/decision boundary
(`coachingTrendService` computes; `coachingEngineService` decides): the
recommendation engine decides *which* rule applies to a topic, but it also
currently decides the exact English wording a teacher reads. There is no
layer between "rule fired" and "text on screen."

This has three concrete costs today:

1. **No reuse.** A dashboard, district report, or future API consumer that
   wants the same recommendation cannot get it without either duplicating
   the WhatsApp-specific phrasing or importing `coachingEngineService` and
   parsing its sentences back apart.
2. **No localization path.** Wording is baked into the rule's `evaluate()`
   function; supporting a second language means either forking rules or
   threading a language parameter through the analytical engine, which has
   no business knowing about presentation concerns.
3. **Untestable wording changes.** Any copy edit today is a change to
   `coachingEngineService.js` and must be verified through the same tests
   that prove which rule fired — Test R-01 (ADR-017) checks
   `recommendation.recommendation.includes("don't yet have an active
   growth plan")`, coupling a wording assertion to a decision-correctness
   test.

PR40 introduces a presentation layer that separates "which rule fired" from
"what the teacher reads," without touching the analytical engine's
decision logic (ADR-017's rule catalogue, priority ladder, and mutual
exclusivity are unchanged by this ADR).

---

## Decisions

### 1. The recommendation engine returns structured data, not sentences

Each rule's `evaluate()` stops returning a `recommendation` string. It
returns a structured recommendation object instead:

```js
{
  ruleId: 'trend_falling',
  messageId: 'trend_decline_standard',
  topicId: 'TOPIC_CURRICULUM_COVERAGE',
  priority: 70,
  confidence: 0.61,
  confidenceLabel: 'Medium',
  evidence: [ /* unchanged — {type, id} refs, per ADR-013 §6.2 */ ],
  templateData: {
    topicLabel: 'Curriculum Coverage',
    currentConfidence: 0.61,
    previousConfidence: 0.78,
  },
}
```

`getCoachingInsights()`'s public shape changes accordingly: each entry in
`recommendations[]` carries `ruleId`, `messageId`, and `templateData`
instead of a pre-rendered `recommendation` string. `explanation` (the
evidence-count/recency/confidence-label summary generated separately by
`generateExplanation()`) is unaffected — it was already structured data
turned into a sentence by a dedicated function, which is exactly the
pattern this ADR extends to the primary recommendation text.

`templateData` is deliberately per-rule and minimal: each rule's
`evaluate()` includes only the facts its own template needs (e.g.
`trend_falling` needs `currentConfidence`/`previousConfidence`;
`growth_plan_missing` needs nothing beyond `topicLabel`). The renderer
never reaches back into `ctx` or re-derives facts the engine already had
in hand at decision time — see Decision 3.

### 2. `messageId` is separate from `ruleId`

A rule object gains a `messageId` field alongside its existing `id`
(`ruleId` in the recommendation output). Today every rule maps to exactly
one `messageId` — `trend_falling` → `trend_decline_standard`,
`growth_plan_missing` → `growth_plan_missing_standard`, and so on — but the
two are not the same concept:

- `ruleId` identifies *why* a recommendation exists — the analytical
  decision, owned by `coachingEngineService`, used in tests that prove
  which rule fired (ADR-017 §Phase 3/4).
- `messageId` identifies *how* it should be phrased — owned by the
  renderer, and free to vary by channel, tone, or A/B variant without the
  engine's decision logic changing at all.

This costs one extra field on every rule today and pays for itself the
first time a rule needs channel-specific wording (a WhatsApp-length
message vs. a longer dashboard card) without forking the rule itself.

### 3. Rendering moves to a dedicated `coachingMessageRenderer` module

A new module, `services/coachingMessageRenderer.js`, exports a single
primary function:

```js
renderRecommendation(recommendation) -> string
```

Internally, it holds a `messageId -> template function` map. Each template
function takes only `templateData` (plus `topicLabel`, threaded through
`templateData` rather than requiring the renderer to resolve topics
itself — the renderer never imports `utils/qmsTopics`) and returns a
string:

```js
const TEMPLATES = {
  trend_decline_standard: (data) =>
    `Learner confidence in ${data.topicLabel} has declined since the ` +
    `previous coaching snapshot. Consider revisiting this topic before ` +
    `introducing new work.`,
  growth_plan_missing_standard: (data) =>
    `You have identified a recurring pattern in ${data.topicLabel} but ` +
    `don't yet have an active growth plan.`,
  // ...one entry per messageId
};
```

An unknown `messageId` (a rule added without a corresponding template) is
a configuration error, not a silent fallback — `renderRecommendation()`
throws, the same fail-loud posture ADR-017 established for
`validateRecommendationRules()`. A `validateMessageTemplates()` function,
run at module load exactly like ADR-017's rule validator, checks that
every `messageId` referenced by `RECOMMENDATION_RULES` has a matching
template and vice versa, so a missing template is caught at startup, not
the first time a particular rule fires in production.

### 4. The renderer is presentation-only — it makes no coaching decisions

The renderer's template functions read only the fields handed to them in
`templateData`. They do not branch on `trend.direction`,
`evidenceTransition`, confidence thresholds, or any other analytical
concept — those decisions are already fully resolved by the time
`ruleId`/`messageId` reach the renderer. A template function that
inspects `templateData.trend.direction === 'falling'` to decide *whether*
to mention the decline (as opposed to simply formatting a value it's
already been told to include) would be re-implementing a decision the
engine already made, and is a violation of this ADR's boundary in code
review, not just in spirit.

This mirrors ADR-016 §9's original invariant for `coachingTrendService`
("trend augments rather than replaces the existing engine") one layer up:
just as trend analytics must not make coaching decisions, presentation
must not make them either. Three layers, three responsibilities:

- `coachingTrendService` — computes trend facts, decides nothing.
- `coachingEngineService` — decides which rule applies, computes no
  wording.
- `coachingMessageRenderer` — renders wording, decides nothing.

### 5. Consumers call the renderer, not the engine's raw output

`qmsFlow.js`'s `MY COACHING` handler is updated to call
`renderRecommendation(rec)` for each entry in
`getCoachingInsights().recommendations` rather than reading a
`recommendation` field directly. Any future consumer (a dashboard
endpoint, a district report generator) does the same. This is the payoff
of Decision 1: the engine's output is consumer-agnostic, and every
consumer goes through the same rendering contract.

### 6. Scope: English WhatsApp templates only, for now

This ADR introduces the *seam* for multiple renderers (per channel, per
language) but does not implement more than one. `coachingMessageRenderer`
ships with the same English wording PR36/PR39 already had, moved
verbatim into templates — this is a refactor of where wording lives, not
a copy rewrite. Localization, channel-specific variants, and tone
personalization are explicitly out of scope for PR40 and are follow-on
work enabled by, but not delivered in, this change.

---

## Data Model

No database schema changes. This ADR is entirely in-process:
`getCoachingInsights()`'s return shape changes (see Decision 1), and one
new stateless module is added. No new tables, no new persisted fields.

---

## Consequences

**Positive:**

- The recommendation engine's tests (ADR-017 Phase 3/4) can now assert
  `ruleId` directly instead of substring-matching rendered sentences —
  removing the wording/decision coupling flagged in Context point 3.
- A new consumer (dashboard, API, report) needs only
  `getCoachingInsights()` + `renderRecommendation()`; it never touches
  rule internals.
- Localization becomes additive: a second `coachingMessageRenderer`
  variant (or a `locale` parameter threaded through the existing one) can
  ship without any change to `coachingEngineService.js`.

**Costs:**

- Every existing rule's `evaluate()` must be rewritten to emit
  `templateData` instead of a sentence, and every existing test that
  substring-matches `recommendation.recommendation` must be rewritten to
  either check `ruleId`/`messageId` directly or render first. This touches
  all eight rules from ADR-017's catalogue, not just the four trend rules.
- One more indirection (`messageId` lookup) for a reader tracing "why did
  the teacher see this text" — mitigated by `ruleId` and `messageId` being
  identical in practice for the foreseeable future, so the indirection is
  free until it's actually needed.

---

## Alternatives Considered

**Keep sentences in the engine, add a post-processing rewrite step.**
Rejected — this still couples wording to decision logic; a "rewrite step"
downstream of already-composed sentences is strictly worse than never
composing them there in the first place, and gives no clean seam for
`messageId` variants.

**Merge `ruleId` and `messageId` into one field.** Simpler today, but
forecloses per-channel/per-locale variants without a breaking change to
the engine's output shape later. Given this subsystem's established
pattern of paying a small, cheap cost now for a documented later need
(ADR-017's `priority` field being the clearest precedent), the two-field
split is kept.

**Have the renderer resolve `topicLabel` from `utils/qmsTopics` itself
instead of receiving it in `templateData`.** Rejected — it would give the
renderer a second source of truth for topic data and a second import
surface, for no benefit; the engine already resolves `ctx.topic` for every
rule today, so passing `topicLabel` through costs nothing extra.

---

## Implementation Sequencing

Consistent with ADR-017's phased approach:

- **Phase 1:** Add `messageId` to every existing rule in
  `RECOMMENDATION_RULES`; add `coachingMessageRenderer.js` with templates
  matching current wording verbatim; add `validateMessageTemplates()`.
  Rules still return `recommendation` strings unchanged — no consumer
  breakage yet.
- **Phase 2:** Switch every rule's `evaluate()` to return `templateData`
  instead of `recommendation`; update `getCoachingInsights()`'s output
  shape; update `qmsFlow.js` to call `renderRecommendation()`.
- **Phase 3:** Rewrite existing tests that substring-match rendered text
  to assert `ruleId`/`messageId` instead; add renderer-specific tests
  (one per template, plus the unknown-`messageId` throw case).
- **Phase 4:** Full regression — `coachingEngineService.test.js`,
  `qmsFlow.test.js`, `qmsCoachingWorkflow.test.js` all green with the new
  shape.
