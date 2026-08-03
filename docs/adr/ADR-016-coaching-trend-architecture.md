# ADR-016: Coaching Trend Architecture

## Status
Accepted

**Depends on:** ADR-013 (QMS topic taxonomy and coaching engine foundation).

**Blocks:** PR38 (trend calculations) and PR39 (trend recommendation rules)
cannot begin until PR37 (snapshot persistence, this ADR's schema) is
implemented and merged. PR40 (presentation) depends on PR38 and PR39.

**Section ownership** — which PR implements which part of this ADR:

| Section | Implemented in |
|---|---|
| §1 Source of history | PR37 |
| §2 Snapshot timing | PR37 |
| §3 Trend window | PR38 |
| §4 What counts as improvement | PR39 |
| §5 Augment vs. replace | PR39, PR40 |
| §6 Schema | PR37 |
| §7 Consequences | — |
| §8 Non-goals | applies to PR37–PR40 |
| §9 Architectural invariants | applies to PR37–PR40 |
| §10 Alternatives Considered | — |

---

## 1. Source of history

**Question:** where does trend history come from — persisted snapshots, or
on-demand recomputation from raw evidence?

**Decision: persisted snapshots**, written to a new table, not recomputed
on each read.

**Rationale:**

- The coaching engine's confidence formula (ADR-013 §6.3) is a function of
  evidence *at a point in time* (`recencyScore` in particular is relative
  to "now"). Recomputing "what would confidence have been on date X"
  requires either replaying evidence as of that date (expensive, and only
  possible if evidence rows are never deleted/edited in place) or storing
  the computed value at the time it was true. Storing is simpler and
  strictly cheaper at read time.
- On-demand recomputation would require every trend read to re-run the
  full confidence formula across however many historical points are being
  compared, against a growing evidence table, on every `MY COACHING` call.
  Snapshots make trend reads O(number of snapshots), not O(evidence
  history).
- Persisted snapshots give trend data a durable audit trail independent of
  future changes to the confidence formula itself — if §6.3's weights are
  ever revised, historical snapshots still reflect what the teacher was
  actually told at the time, rather than being silently rewritten by a
  formula change.

## 2. Snapshot timing

**Question:** when is a snapshot created?

**Decision (revised from the initial draft): snapshot creation is
triggered by evidence changes, not by command usage.**

The initial draft of this ADR proposed creating a snapshot whenever
`MY COACHING` was called, deduplicated per day. That was rejected during
review: tying history to command usage means two teachers with identical
underlying evidence can end up with completely different trend
histories purely because one checks `MY COACHING` more often than the
other. A teacher who writes reflections steadily but rarely runs the
command would show *no* history at all from the trend engine's
perspective, even though their evidence changed continuously. That
inverts the feature's purpose — trend should measure how the evidence
changed, not how often the teacher looked.

**Trigger philosophy (revised after PR37 shipped): evidence-event, not
milestone.** A coaching snapshot represents the coaching state immediately
following *any* operation that changes the evidence
`coachingEngineService.buildTopicContexts()` reads — not a curated subset
of "significant" lifecycle events. The alternative (snapshotting only
selected milestones, e.g. status transitions but not creation/deletion/
reassignment) was considered and rejected: it makes the historical record
reflect which operations happened to be wired as triggers rather than how
the teacher's evidence actually evolved, which is precisely the failure
mode §2 already rejected command-triggered snapshots for for the same
underlying reason. The dedup/threshold mechanics below exist so that this
philosophy doesn't get expensive: most evidence-changing events result in
no additional stored row unless the coaching state changed meaningfully.

**Snapshot triggers — every write path that changes what
`buildTopicContexts()` sees:**

- `reflectionService.createReflection` — new evidence.
- `reflectionService.updateReflection`, **only when `topicId` changes** —
  content/aiAssisted/evidenceLinkIds are not read by `buildTopicContexts()`
  (evidence is grouped and scored by `topicId` + `createdAt` only), so
  editing those alone is not a trigger; reassigning `topicId` moves this
  reflection's evidence from one topic to another and is.
- `reflectionService.deleteReflection` — evidence removed entirely.
- `growthPlanService.createGrowthPlan` — new evidence (growth plans are
  evidence regardless of status — `getTaggedGrowthPlans()` is not
  status-filtered).
- `growthPlanService.updateGrowthPlan`, when `status` changes **or**
  `topicId` changes — a plain `goalText` edit (both false) changes nothing
  `buildTopicContexts()` reads, so it stays a non-trigger.

`MY COACHING` (and any future dashboard equivalent) remains purely a
**consumer** of snapshot history, never a trigger for creating it.

**Deduplication (to keep storage small despite event-driven writes):**

- at most one snapshot per `(phoneHash, topicId)` per day — a trigger
  firing multiple times in one day updates that day's row rather than
  inserting a new one;
- within that daily cap, a snapshot is only persisted if `confidence`
  changed by more than a named noise threshold since the last stored
  snapshot for that `(phoneHash, topicId)`. This reuses the same
  "meaningful change" judgment ADR-013 already makes for recommendation
  ranking, rather than inventing a second threshold concept — see §4 for
  the exact value and its shared use.

This still avoids introducing a scheduler or cron job (the original
design goal), while making history represent changes in evidence rather
than usage of a command.

## 3. Trend window

**Question:** what time range does a "trend" cover?

**Decision:** the trend window is **last-snapshot-to-now** — i.e. compare
the most recent stored snapshot for a topic against the current
(freshly computed) confidence. "Last term" or any other calendar-bound
framing is a **presentation** choice made by PR40 when displaying trend
data to a teacher (e.g. "this term" may filter which snapshots are shown),
not a second trend-calculation engine. PR38 computes one deterministic
trend value per topic — the delta between the latest snapshot and current
confidence — and PR40 decides how to label or filter that data for
display. There is exactly one trend engine; calendar framing never
forks it.

## 4. What counts as improvement

**Question:** what threshold distinguishes "improving" from "stable" from
"declining"?

**Decision: confidence delta alone**, compared against a single named
noise threshold — not a compound AND-rule combining confidence delta with
other signals (e.g. evidence count, consistency score movement
independently).

```
DEFAULT_TREND_NOISE_THRESHOLD = 0.05
```

```
delta = currentConfidence - lastSnapshotConfidence

delta >  DEFAULT_TREND_NOISE_THRESHOLD   → "improving"
delta < -DEFAULT_TREND_NOISE_THRESHOLD   → "declining"
otherwise                                → "stable"
```

This constant is shared between the trend-classification rule (PR39) and
the snapshot-write dedup check (§2) — both are answering the same
underlying question ("has this changed enough to matter?"), so a single
named constant is defined once (alongside `DEFAULT_REQUIRED_EVIDENCE` and
`DEFAULT_MAX_INSIGHTS` in the coaching engine's configuration constants,
per ADR-013's convention) rather than two independently-tuned values that
could drift apart.

Like ADR-013's own thresholds, `0.05` is a provisional default for initial
release, not a calibrated value — stated explicitly so it isn't mistaken
for a product decision informed by usage data.

## 5. Augment vs. replace

**Question:** does trend data replace snapshot-based recommendations, or
sit alongside them?

**Decision: augment, never replace.**

Teachers ask two different questions that must not compete for the same
output slot:

- *"What should I work on today?"* — answered by the existing snapshot
  recommendation (ADR-013 §6.7's `recommendations[]`).
- *"Am I getting better?"* — answered by trend data (PR38/PR39).

Trend is added as an **additive field** on each recommendation object
(e.g. `trend: { direction, delta, since }`), never as a replacement
recommendation, and never as a value that overrides or reorders the
existing confidence-based ranking (ADR-013 §6.4). A topic's trend
direction has no influence on whether that topic's recommendation
survives deduplication or where it sorts — trend is purely informational
context attached after ranking is already final.

## 6. Schema (PR37)

**Amendment (post-PR37 hardening):** `coachingEngineService.buildTopicContexts()`
(ADR-013 §6.1/§6.2) originally omitted any topic with zero currently-usable
evidence. Under a persisted-history model that silently breaks: a topic
whose only evidence is later deleted, or reassigned to another topic,
simply disappears from the context map, so nothing ever records that its
confidence dropped — trend history for that topic freezes at its last
value with no signal that the evidence is gone. `buildTopicContexts()` now
returns a context for **every** taxonomy topic, with `hasEvidence: false`
and `confidence: 0` for topics with none. The snapshot writer
(`coachingSnapshotService.writeSnapshotForTopic`) still only persists a
row for a zero-evidence topic if that topic already has a prior stored
snapshot (i.e. it had evidence at some point) — a topic the teacher has
never touched at all produces no row, so this does not spam a fresh
zero-confidence snapshot for every topic in the taxonomy on a teacher's
very first reflection. Rules that would otherwise misfire against a
zero-evidence context (`low_confidence_recommendation`, whose 0 <
`LOW_CONFIDENCE_THRESHOLD` would otherwise be true for every untouched
topic) are gated on `ctx.hasEvidence`/`ctx.evidenceCount > 0`.

New table, e.g. `coaching_snapshots`:

```
phone_hash          TEXT NOT NULL
topic_id            TEXT NOT NULL
confidence          REAL NOT NULL
confidence_label    TEXT NOT NULL
evidence_score      REAL NOT NULL
consistency_score   REAL NOT NULL
recency_score       REAL NOT NULL
rule_id             TEXT
captured_at         TEXT NOT NULL   -- ISO UTC, per dateUtils convention
```

Storing the three component scores (not just the final `confidence`)
alongside `rule_id`, rather than only the aggregate number, is deliberate:
it makes historical graphs able to explain *why* confidence moved (was it
new evidence, or recency decay, or a consistency shift?), makes debugging
possible without recomputing history from raw evidence, and keeps future
analytics options open without a schema change. The storage cost of five
extra `REAL`/`TEXT` columns per row is negligible against that
flexibility.

Snapshot rows are **append-only** (§9) — a deduplicated write within the
same day updates that day's row's values but never deletes or rewrites a
prior day's row.

---

## 7. Consequences

### 7.1 Benefits

- Trend history reflects genuine evidence change, not teacher usage
  patterns of `MY COACHING` — two teachers with the same underlying
  reflections/growth-plan activity get comparable trend histories
  regardless of how often either one checks the command.
- Storing component scores, not just aggregate confidence, keeps
  historical debugging and future analytics options open without a
  later migration.
- Sharing one named noise threshold between the write-dedup check and the
  trend-classification rule avoids the two ever silently drifting apart.

### 7.2 Trade-offs

- Evidence-driven snapshot triggers touch two existing write paths
  (`reflectionService.createReflection`, growth plan status transitions)
  rather than a single new call site inside `MY COACHING` — more
  integration surface than the (rejected) command-triggered design, though
  still no scheduler.
- `DEFAULT_TREND_NOISE_THRESHOLD` is a provisional default, not a
  calibrated value; it may need revision once real usage data exists.
- No history exists before PR37 ships — trend data starts from zero for
  every teacher regardless of how long they've been using QMS.

---

## 8. Non-goals

This ADR does not introduce:

- predictive coaching (no forecasting of future confidence);
- machine learning models of any kind;
- cross-teacher benchmarking or comparison;
- district-level or school-level analytics;
- trend visualisations (charts/graphs) — PR40 is limited to a textual
  trend indicator on existing recommendations;
- persistence of historical *recommendation text* — only the numeric
  scores in §6 are stored, never the rendered `explanation` string
  (ADR-013 §6.5), which is regenerated fresh from stored scores if ever
  needed.

Any of the above would require its own ADR before implementation.

## 9. Architectural invariants

These hold across PR37–PR40 and must not be violated by any future PR
building on this one:

1. **Snapshot recommendations remain authoritative.** The current,
   freshly-computed recommendation (ADR-013 §6.7) is always what a teacher
   acts on; trend is context, never a competing directive.
2. **Trend analysis augments, never replaces, snapshot coaching** (§5).
3. **Trend calculations are deterministic** — same inputs (stored
   snapshots + current confidence) always produce the same trend
   direction and delta, consistent with ADR-013's design principle (§10)
   that the coaching engine performs no non-deterministic inference.
4. **Trend calculations never modify historical snapshots.** Computing a
   trend is a read-only operation over `coaching_snapshots`.
5. **Snapshot history is append-only** (§6) — a row, once written for a
   given day, is only ever updated within that same day's dedup window
   (§2), never deleted or rewritten by a later trend calculation.

## 10. Alternatives Considered

- **Command-triggered snapshots** (create a snapshot on each `MY COACHING`
  call, deduplicated per day). Rejected: makes trend history a function of
  how often a teacher checks the command rather than how their evidence
  changed — see §2 for the full rationale. This was the original proposal
  in an earlier draft of this ADR and was revised after review.
- **On-demand recomputation** (no snapshot table; replay evidence history
  at read time to reconstruct past confidence). Rejected: expensive at
  read time, and fragile against future changes to the confidence formula
  itself (ADR-013 §6.3) silently rewriting historical trend data. See §1.
- **Calendar-bound trend engine** (a second computation path specifically
  for "this term" comparisons). Rejected: multiplies the number of
  deterministic engines that must independently satisfy ADR-013's design
  principle; calendar framing is better handled as a presentation-layer
  filter over one trend engine's output. See §3.
