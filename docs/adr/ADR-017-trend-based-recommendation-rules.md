# ADR-017: Trend-Based Recommendation Rule Integration

## Status
Accepted

**Depends on:** ADR-013 (QMS topic taxonomy and coaching engine foundation),
ADR-016 (Coaching Trend Architecture).

**Implements:** PR39 (trend recommendation rules), the third stage of the
PR37 → PR38 → PR39 → PR40 sequence set out in ADR-016.

---

## Context

PR36 established a recommendation engine built on mutually exclusive
recommendation rules evaluated per topic, ordered by confidence.

PR38 introduced `coachingTrendService`, which exposes trend analytics
(`baseline`/`trend` status, `trendDirection`, `trendStrength`,
`evidenceTransition`) but — per ADR-016 §9 — deliberately makes no coaching
decisions itself.

PR39 integrates those analytics into the existing recommendation pipeline
by adding trend-aware rules to the same catalogue, rather than building a
second decision layer.

---

## Decisions

### 1. Single recommendation pipeline

Trend recommendations are implemented as standard recommendation rules in
the existing catalogue. No secondary recommendation engine or
post-processing stage is introduced. This satisfies ADR-016 §9's invariant
that trend augments the existing engine rather than replacing it.

### 2. Baseline handling

Trend rules evaluate only when `ctx.trend.status === "trend"`. Baseline
topics (insufficient snapshot history) contribute no trend-based
recommendations and fall through to the existing PR36 rules unchanged.

### 3. Rule priority

Each recommendation rule declares an explicit numeric `priority` field.
Higher values take precedence. Priority values are intentionally spaced by
increments of ten so future rules can be inserted without renumbering the
catalogue.

| Priority | Rule |
|---|---|
| 100 | `growth_plan_missing` |
| 90 | `evidence_removed` |
| 80 | `stale_evidence` |
| 70 | `trend_falling` |
| 60 | `evidence_gained` |
| 50 | `low_confidence_recommendation` |
| 40 | `trend_rising` |
| 10 | `recurring_topic_pattern` |

### 4. Recommendation ordering

Recommendations are sorted by:

1. `priority` (descending)
2. `confidence` (descending)
3. existing stable/topic order

This changes `sortRecommendations()`'s contract from confidence-first to
priority-first, while preserving the previous confidence-then-stable-order
behavior whenever two candidates share the same priority. This is a
modification to existing, already-tested code (P-03–P-05), not a purely
additive change, and is called out explicitly here for that reason.

### 5. Trend strength

`trendStrength` enriches recommendation messaging only. It never
determines whether a recommendation rule fires — only `trendDirection` and
`evidenceTransition` gate rule activation.

### 6. Mutual exclusivity

Exactly one recommendation is emitted per topic, re-proving the existing
PR36 invariant across the combined (PR36 + PR39) catalogue — at both the
high-priority end (e.g. `growth_plan_missing` beating `trend_falling`) and
the low-priority end (e.g. `stale_evidence` beating `trend_falling`).

### 7. Validation

All recommendation rules must declare a numeric `priority`. A rule with a
missing or non-numeric priority is a configuration error and fails at
application startup, not silently at sort time:

```javascript
function validateRecommendationRules(rules) {
  for (const rule of rules) {
    if (!Number.isFinite(rule.priority)) {
      throw new Error(
        `Recommendation rule '${rule.id}' is missing a numeric priority`
      );
    }
  }
}
```

---

## Implementation sequencing

Four phases, each isolating one variable so failures are cheap to
localize:

1. **Comparator only** — add `priority` to all eight existing PR36 rules,
   update `sortRecommendations()`, validate against R8/R9/R10 with zero new
   rule behavior.
2. **Trend rule scaffolding** — add `trend_rising`, `trend_falling`,
   `evidence_gained`, `evidence_removed` one at a time, each proven against
   R1's baseline guard before moving to the next.
3. **Mutual exclusivity** — enable dedup across the full combined catalogue,
   prove R6/R7.
4. **Regression** — full coaching engine suite, full PR36 suite unchanged,
   full PR39 suite, full repository run.

---

## Consequences

- One recommendation per topic remains invariant across the combined
  catalogue.
- Existing recommendation infrastructure (rule shape, dedup, delivery) is
  preserved; only the sort key changes.
- Trend analytics (PR38) remain read-only and decision-free, per ADR-016.
- Future recommendation rules can be added without modifying comparator
  logic — only a priority value and gap convention.
- `sortRecommendations()`'s contract change is a deliberate, tested
  behavior change and must be called out in the PR39 description rather
  than framed as purely additive.

## Alternatives Considered

- **Confidence-only ordering retained, trend rules slotted in via
  confidence tuning alone:** rejected — confidence is a continuous,
  evidence-derived value and not a reliable proxy for the categorical
  precedence needed (e.g. a missing growth plan must always outrank a
  falling trend regardless of either rule's confidence score).
- **Separate trend-recommendation post-processing stage layered on top of
  PR36 output:** rejected — violates ADR-016 §9 (augment, not replace) and
  reintroduces a second decision layer the coaching engine was
  specifically designed to avoid.
