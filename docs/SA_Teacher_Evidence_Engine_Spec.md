# SA Teacher — Teacher Success Engine
## Phase 3: Evidence Engine — Implementation Specification

*Architecture only. No production code. Written to the level a senior engineer could implement against without further clarification, and structured so a reviewer can approve or push back on specific decisions before any table is created.*

---

## 1. Purpose & Scope

The Evidence Engine is the single layer that turns "things a teacher already did in SA Teacher" into "things that count as professional evidence" — without ever duplicating the underlying content. It has exactly three jobs: **tag** existing rows as they're created, **store** those tags cheaply, and **answer aggregate questions** about them fast. It does not generate content, does not compute mastery/coverage/progress (that stays in the ADR-007 chain), and does not know anything about WhatsApp or HTTP.

Everything above it in the Phase 2 spec — MY GROWTH, Classroom Visit Prep, Reflections, Growth Plans, Portfolio Builder, the AI Copilot — is a **consumer** of this layer, not a peer of it. Get this layer's shape right once, and every one of those features becomes a read query plus a bit of UI, not a new data-modelling exercise.

---

## 2. Entity Relationship Diagram

```
teachers ──< classes ──< learners
   │             │
   │             │ (nullable)
   │             ▼
   │        assessments ──< learner_results
   │             │
   │             ├──< item_analysis
   │             └──< error_analysis
   │
   ├──< saved_resources          (worksheet/test/lessonPlan/atp/sbaTask/examPaper/rubric/moderationPack)
   ├──< reports                  (diagnostic/hod/parent)
   ├──< intervention_plans
   ├──< curriculum_coverage
   └──< observation_assessments ──< observation_records

                          ┌─────────────────────────────┐
                          │      tse_evidence_links       │  ◄── the entire Evidence Engine
                          │  (phone_hash, class_id?,       │      data model. One row per
                          │   category, term, year,        │      tagged evidence event.
                          │   exactly one populated         │      Points AT existing rows,
                          │   source_*_id column)            │      never copies them.
                          └─────────────────────────────┘
                                       │
                                       ▼ (points to exactly one of)
                    saved_resources / reports / intervention_plans /
                    curriculum_coverage / assessments / observation_assessments

tse_portfolio_snapshots ──< references a frozen list of tse_evidence_links.id at build time
```

`tse_evidence_links` is the only new structural table in this phase. It has a many-to-one relationship to `teachers` (via `phone_hash`) and an optional many-to-one to `classes`, and a **conditional** relationship to exactly one of six existing tables (§4.2 explains why this is modelled as six nullable FK columns rather than a generic polymorphic pointer).

---

## 3. Design Decision: Six Nullable FK Columns, Not a Polymorphic Pointer

Two designs were considered:

**A — Polymorphic pointer:** `source_table TEXT, source_id INTEGER`, no `FOREIGN KEY`. Simplest schema, one column pair covers every source. But SQLite (and this codebase's own convention — every table declares real `FOREIGN KEY` constraints, e.g. `learner_results.assessment_id REFERENCES assessments(id)`) cannot express a conditional foreign key. A polymorphic pointer gets no referential-integrity checking, no `ON DELETE CASCADE`, and silently accepts a typo'd `source_table` value.

**B — Six nullable FK columns:** `resource_id`, `report_id`, `assessment_id`, `intervention_plan_id`, `coverage_id`, `observation_assessment_id` — all nullable, application layer enforces "exactly one is set." More columns, but every one is a real, checked `FOREIGN KEY`, consistent with how `assessments.blueprint_id`, `learner_results.learner_id`, and every other optional reference in this schema is already modelled.

**Decision: B.** It's more verbose but it's the pattern this codebase already trusts everywhere else, and referential integrity on the evidence layer matters — a dangling, silently-invalid pointer is exactly the kind of bug that would surface as a broken portfolio months later with no error anywhere. This is called out explicitly per the request to critique-and-simplify (§20) rather than defaulted to silently.

---

## 4. Complete Schema

### 4.1 `tse_evidence_links`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `phone_hash` | TEXT NOT NULL | `FOREIGN KEY → teachers(phone_hash)` |
| `class_id` | INTEGER, nullable | `FOREIGN KEY → classes(id)` — nullable because not every evidence event is class-scoped (e.g. a general reflection) |
| `category` | TEXT NOT NULL | Plain TEXT with an app-layer allowed-value list, **not** a separate lookup table — see §20.1. Allowed: `planning \| assessment \| moderation \| learner_support \| curriculum_coverage \| classroom_visit_prep \| reflection \| growth_plan` |
| `resource_id` | INTEGER, nullable | `FOREIGN KEY → saved_resources(id) ON DELETE CASCADE` |
| `report_id` | INTEGER, nullable | `FOREIGN KEY → reports(id) ON DELETE CASCADE` |
| `assessment_id` | INTEGER, nullable | `FOREIGN KEY → assessments(id) ON DELETE CASCADE` |
| `intervention_plan_id` | INTEGER, nullable | `FOREIGN KEY → intervention_plans(id) ON DELETE CASCADE` |
| `coverage_id` | INTEGER, nullable | `FOREIGN KEY → curriculum_coverage(id) ON DELETE CASCADE` |
| `observation_assessment_id` | INTEGER, nullable | `FOREIGN KEY → observation_assessments(id) ON DELETE CASCADE` |
| `term` | INTEGER, nullable | Denormalised (mirrors `usage_events.month_key`'s pattern of trading a join for a fast filter). Nullable because not every source row carries a term (e.g. `saved_resources` doesn't) — see §11 for derivation rule |
| `year` | INTEGER, nullable | Same rationale as `term` |
| `created_at` | TEXT NOT NULL DEFAULT `datetime('now')` | |

**App-layer invariant (enforced in the write function, not in SQL):** exactly one of the six `*_id` columns is non-null. `ON DELETE CASCADE` on all six means a deleted source row automatically removes its own evidence link — no orphaned rows possible, no manual cleanup job needed (§14 edge cases covers the one place this isn't quite enough on its own).

### 4.2 `tse_reflections`, `tse_growth_plans`, `tse_visits`, `tse_portfolio_snapshots`

Unchanged from the Phase 2 spec (§4.3–§4.6 there); repeated here only where Phase 3 refines them:

- `tse_portfolio_snapshots.evidence_link_ids` — confirmed as a JSON array of `tse_evidence_links.id` values, frozen at build time. This is deliberate: if a source row is later edited or deleted, a *previously generated* portfolio PDF's record of what it included must not silently change. The snapshot references link IDs, and the PDF content itself (already-rendered, stored via the existing `pdfService.js` convention) is the actual frozen artifact — the ID list is for audit/rebuild purposes only.

No other Phase 2 table needs a Phase 3 change.

---

## 5. Index Strategy

| Index | On | Serves |
|---|---|---|
| `idx_tse_evidence_phone_term` | `tse_evidence_links(phone_hash, year, term, category)` | The single hottest query — MY GROWTH's per-category-per-term aggregation. Column order matches filter order (always filtered by teacher first, then term/year, then optionally category) |
| `idx_tse_evidence_class` | `tse_evidence_links(class_id)` | Classroom Visit Prep and class-scoped evidence browsing |
| Six single-column indexes | one per `*_id` FK column | SQLite does not auto-index foreign keys; needed so `ON DELETE CASCADE` and any future "does this resource already have a link" check don't full-scan |
| `idx_tse_evidence_dedup` (unique, partial) | `UNIQUE(category, resource_id) WHERE resource_id IS NOT NULL` (and one equivalent partial unique index per `*_id` column) | Prevents double-tagging the same source row into the same category twice — see §14.2 |

This mirrors the existing schema's own style exactly (`idx_learners_identity_classed`/`idx_learners_identity_unclassed` are two partial unique indexes handling a similar "one of several nullable scopes" problem — Migration 026).

---

## 6. Migration Strategy

- **Migration 033**: `CREATE TABLE IF NOT EXISTS tse_evidence_links (...)` with all seven indexes above, in the same `db.exec()` block style as every prior migration, guarded the same way.
- **Migration 034**: `tse_reflections`, `tse_growth_plans`, `tse_visits`, `tse_portfolio_snapshots` (Phase 2 tables — grouped separately since they're additive but functionally independent of the evidence-linking mechanism itself; either could ship without the other blocking it).
- **Backfill (not a schema migration, a one-time data job)**: existing teachers already have months/years of `saved_resources`, `reports`, `assessments`, `intervention_plans`, `curriculum_coverage`, and `observation_assessments` rows that predate the Evidence Engine. A one-time backfill script (run once, manually, against production — not part of `runMigrations()`, which must stay fast and side-effect-light on every boot) walks each of those six tables and inserts the corresponding `tse_evidence_links` row for every existing record. This is the single largest data-correctness task in Phase 3 and should be scoped, tested against a copy of the production DB, and run once under supervision — not folded silently into automatic startup migrations.

## 7. Rollback Strategy

Identical profile to every prior additive migration in this schema (Phase 1 audit §6): `DROP TABLE tse_evidence_links` (and the Phase 2 tables) removes 100% of Phase 3/2's footprint with zero effect on `teachers`, `classes`, `assessments`, `learner_results`, `saved_resources`, `reports`, `intervention_plans`, `curriculum_coverage`, or `observation_assessments` — none of which gain a single new column in this phase. If the backfill script needs to be re-run after a rollback, it's idempotent by construction (the dedup unique indexes in §5 make a second run a no-op).

---

## 8. Evidence Lifecycle

```
CREATE ──────► TAG ──────► STORE ──────► RETRIEVE ──────► (ARCHIVE — not needed, see §19)
  │              │             │               │
  a teacher     the source   one row in    MY GROWTH / evidence
  action        service      tse_evidence_  browser / Copilot /
  already       calls a      links, FK'd    Portfolio Builder
  produces a    new tiny     to the         all read from here,
  row in an     "tag it"     source row,    never from the six
  existing      helper       never a        source tables
  table         (§9)         copy           directly
```

There is deliberately **no separate "update" or "archive" state** for an evidence link itself — the link is a pointer, not content. If the underlying evidence changes (e.g. a saved resource is edited), the link is unaffected because it never held a copy. If the underlying evidence is deleted, `ON DELETE CASCADE` removes the link automatically. This keeps the lifecycle to three real states instead of the five a stateful record would need.

---

## 9. Exact Integration Points With Every Existing Feature

This is the concrete answer to "which services will write evidence" — traced against the actual codebase, not a hypothetical:

| Existing write function | File | New Evidence Engine call added right after a successful write | Category |
|---|---|---|---|
| `saveResource()` | `services/teacherWorkspaceService.js` | Tag with `resource_id`; category derived from `resource_type` (`lessonPlan/atp/sbaTask/worksheet/test/examPaper` → `planning` or `assessment` depending on type; `rubric` → `assessment`; `moderationPack` → `moderation`) | planning / assessment / moderation |
| `processAssessmentData()` | `services/diagnosticWorkflowService.js` | Tag with `assessment_id`, right after its internal `INSERT INTO assessments` succeeds. This is the **single** commit path for both the upload-marks flow (`flows/assessmentFlow.js`) and the blueprint capture flow (`flows/assessmentSessionFlow.js`) — one hook covers both | assessment |
| `saveReport()` | `services/interventionReportsService.js` | Tag with `report_id`; category `moderation` if `report_type === 'hod'`, else `assessment` | moderation / assessment |
| `saveInterventionPlan()` | `services/interventionPlanService.js` | Tag with `intervention_plan_id` | learner_support |
| `markTopicCovered()` / `updateCoverageFromAssessment()` | `services/curriculumCoverageService.js` | Tag with `coverage_id` | curriculum_coverage |
| `saveObservationSubmission()` | `services/observationRepository.js` | Tag with `observation_assessment_id` | assessment *(Foundation Phase — never `classroom_visit_prep`, per the audit's naming-collision resolution)* |

Six hooks, six files, each a single added function call after an already-successful write — no existing function's signature, return value, or transaction boundary changes. `reflection` and `growth_plan` and `classroom_visit_prep` categories are written directly by their own new Phase 4/5 services when Phase 4/5 ship (they have no pre-existing source table to hook into), not retrofitted here.

**Which services consume evidence** (read-only, all new in Phase 3+):
- `tseEvidenceService.js` (new) — the only service that queries `tse_evidence_links` directly. Every other consumer (WhatsApp `MY GROWTH`, the Dashboard, the AI Copilot) calls *this* service, never the table directly — same "one narrow service in front of a table" discipline the ADR-007 chain already uses.

---

## 10. Event Flow Diagrams

**Evidence creation (example: a worksheet is saved)**
```
Teacher sends SAVE
   → core/generationPipeline.js's SAVE handler
      → teacherWorkspaceService.saveResource()  [existing, unchanged]
         → row inserted into saved_resources     [existing, unchanged]
         → tseEvidenceService.tagEvidence(...)    [NEW — one call added here]
            → row inserted into tse_evidence_links
   → confirmation sent to teacher                 [existing, unchanged —
                                                     optionally now includes
                                                     the §2.1 nudge text]
```

**MY GROWTH status query**
```
Teacher sends "MY GROWTH"
   → flows/tseMyGrowthFlow.js (new, stateless)
      → tseEvidenceService.getStatusSnapshot(phoneHash, term, year)
         → single indexed query against tse_evidence_links,
           grouped by category, counted
      → deterministic reply built from counts — no AI call
```

**Portfolio build**
```
Teacher sends "PORTFOLIO" → picks scope
   → flows/tsePortfolioFlow.js (new)
      → tseEvidenceService.getEvidenceForScope(phoneHash, scope)
         → resolves each tse_evidence_links row back to its source table
           (six simple lookups, one per possible FK column)
      → portfolioBuilderService.compile(...)  (new, Phase 6)
         → pdfService.generate(...)            [existing, unchanged]
      → tse_portfolio_snapshots row written (evidence_link_ids frozen)
   → PDF delivered
```

---

## 11. WhatsApp Integration Points

- No changes to `routes/webhook.js`'s existing dispatch beyond registering the new flows in `core/messageProcessor.js`'s mid-flow routing list and new commands in `core/commandHandler.js` (per Phase 2 §3).
- **Term/year derivation for evidence written via WhatsApp:** `saved_resources` and `reports` don't carry a term column today. At tag-time, `tseEvidenceService.tagEvidence()` derives `(term, year)` from the current date via the existing `curriculumIntelligenceService.js` SA school calendar (already used for ATP pacing). This is read-only reuse of an existing utility, not new calendar logic. Flagged risk: that calendar is currently hardcoded for 2025/2026 only (Phase 1 audit noted this indirectly) — it needs a year added before this derivation silently breaks in 2027 (§14.4).

## 12. Dashboard Data Sources

Every Dashboard page proposed in Phase 2 (§8 there) reads exclusively from the new `GET /api/tse/status` and `GET /api/tse/evidence` endpoints (Phase 2 §5), which in turn call `tseEvidenceService` — never queries `saved_resources`/`reports`/etc. directly from the API layer. This keeps the Dashboard and WhatsApp surfaces provably consistent (same service, same aggregation logic, two front doors) rather than risking two independently-maintained counting implementations drifting apart.

## 13. AI Copilot Query Flow

```
Natural-language query ("how ready am I", "find moderation documents")
   → intentClassifier.js — new intent types (tseStatus, tseFindEvidence, etc.)
      [regex fallback covers the exact-match commands in §3 of Phase 2 spec;
       AI classification is a convenience layer on top, not a requirement —
       consistent with how every other intent in this app already works]
   → flows/tseCopilotFlow.js routes to tseEvidenceService's deterministic
     queries — NOT to an AI generation call. The "AI" in "AI Copilot" is
     doing intent understanding, not fabricating the answer. The answer
     itself is always a real count/list from tse_evidence_links.
```

This is an important scoping decision: the Copilot never asks the AI model "how ready is this teacher" — that would risk a hallucinated answer about a teacher's real compliance status, which is precisely the kind of content that must be deterministic. AI is scoped strictly to *understanding the question*, never *computing the answer*.

---

## 14. Edge Cases

1. **Source row deleted after being tagged.** Handled by `ON DELETE CASCADE` (§4.1) for live status queries. Handled separately for *already-exported* portfolios by `tse_portfolio_snapshots` freezing the rendered PDF, not a live query (§4.2) — a past export never silently loses content because a resource was later deleted.
2. **Duplicate tagging** (e.g. a retried write, or a future bug calling `tagEvidence()` twice for the same source row/category). Prevented by the partial unique indexes in §5 — a second insert attempt is a no-op (caught and ignored by the write function, same `try { db.exec } catch` idiom already used throughout `utils/database.js`).
3. **Historical data predating the Evidence Engine.** Handled by the one-time backfill (§6) — flagged as its own reviewed task, not assumed to happen automatically.
4. **Term derivation for future years not yet in `SA_SCHOOL_CALENDAR`.** `curriculumIntelligenceService.js`'s calendar object currently only has 2025/2026 entries. `tagEvidence()`'s term/year derivation must handle a missing year gracefully (store `NULL` rather than throw) so this doesn't become a silent failure mode across the whole write path the moment the calendar isn't extended — this is a pre-existing limitation in a dependency this phase reuses, not something Phase 3 introduces, but it's a hard dependency worth naming.
5. **Zero-class / unclassed teachers.** `class_id` is nullable on the link table for exactly the same reason it's nullable on `assessments`/`observation_assessments` (ADR-004's zero-class policy) — no new decision needed here, just consistency.
6. **A single source event that logically belongs to two categories** (e.g. a moderation pack is simultaneously assessment content and moderation paperwork). Resolved by category being derived per-`resource_type` (§9) rather than per-event — `moderationPack` resources are tagged `moderation` only, not both, to keep MY GROWTH's counts non-double-counted. If a teacher wants that same resource visible under "assessment" too, that's a browsing/filter concern for the evidence browser UI, not a reason to write two link rows.

---

## 15. Performance Considerations

- **Write path:** one additional single-row insert per existing write, guarded by an indexed unique constraint check — the same order-of-magnitude cost as the existing `usage_events` insert that already happens on every AI generation. Not expected to be measurable against the AI call latency (seconds) that already dominates every one of these flows.
- **Read path:** `MY GROWTH`'s status query is a single `GROUP BY category` over an indexed `(phone_hash, year, term)` slice — expected to stay sub-millisecond at realistic per-teacher volumes (hundreds, not millions, of evidence rows per teacher per year) on the same SQLite/WAL setup the rest of the app already runs on.
- **No N+1 risk in portfolio building:** resolving each link back to its source row is six simple indexed lookups per link, not a per-link round trip through multiple services — `getEvidenceForScope()` batches by FK column type (one query per non-empty `*_id` group) rather than looping row-by-row.

## 16. Security Considerations

- No new PII surface: `tse_evidence_links` stores only integers, a category string, and a `phone_hash` — the same scoping key already used everywhere. Even a full table leak exposes no content, only "this teacher had N assessment-evidence events in term 2" — a strictly smaller exposure than any of the six tables it points at.
- Access control is unchanged from the rest of the app: every query is `WHERE phone_hash = ?`, resolved from the existing JWT (Dashboard) or `hashPhone(from)` (WhatsApp) — Phase 3 introduces no new authentication or authorization logic. (DSG's cross-teacher access, per the Phase 2 spec's §8, remains explicitly out of scope here.)
- `ON DELETE CASCADE` is itself a mild security-adjacent correctness property: it guarantees a teacher who deletes a resource can't end up with a dangling evidence link that still shows up somewhere in their own status view — deletion is honoured everywhere, not just at the source table.

## 17. Data Retention Strategy

No active retention/archival job is proposed for this phase. Evidence rows are small, teacher-scoped, and professionally meaningful for the long term by nature (a portfolio spanning several years of a teaching career is a feature, not a liability) — this mirrors how `saved_resources`/`reports`/`assessments` themselves already have no deletion-by-age policy in this codebase. If storage growth ever becomes a real concern at scale, the cheapest first lever is deleting old `tse_portfolio_snapshots` PDF files (large, regenerable) long before touching the tiny `tse_evidence_links` rows (small, not regenerable without the backfill process). Not a Phase 3 decision — flagged for a future data-volume review, not designed against a problem that doesn't exist yet.

## 18. Test Strategy

Following this codebase's existing convention (`node tests/run-all.js`, no external test framework, one file per unit/integration concern):

- **Unit:** `tseEvidenceService.test.js` — `tagEvidence()` invariant enforcement (exactly one FK set, rejects zero or multiple), dedup-on-retry, term/year derivation including the missing-year edge case (§14.4).
- **Integration, one per hook (§9):** verify that calling `saveResource()`, `processAssessmentData()`, `saveReport()`, `saveInterventionPlan()`, `markTopicCovered()`/`updateCoverageFromAssessment()`, and `saveObservationSubmission()` each produce exactly one correctly-categorised `tse_evidence_links` row, and that a **failed** write to the source table produces **zero** evidence rows (no partial-tag states).
- **Cascade test:** deleting a `saved_resources` row (via the existing `deleteSavedResource()`) removes its evidence link automatically; deleting an already-portfolio-included resource does not alter a previously generated `tse_portfolio_snapshots` PDF.
- **Aggregation correctness:** `getStatusSnapshot()` counts match a hand-constructed fixture across multiple categories/terms/classes, including a zero-evidence teacher (must not error, must return all-zero categories).
- **Backfill dry-run:** run the one-time backfill against a copied test DB seeded with pre-Phase-3 data, assert row-for-row coverage, assert re-running it is a no-op (idempotency).

## 19. Risks (Phase-3-specific, additive to the Phase 1 audit's risk list)

| Risk | Severity | Mitigation already designed in |
|---|---|---|
| Backfill script run incorrectly / partially against production | Medium | Scoped as its own supervised, idempotent, dry-run-tested task (§6, §18) — not silent auto-migration |
| `SA_SCHOOL_CALENDAR` missing future years breaks term derivation silently | Medium | Designed to degrade to `NULL` rather than throw (§14.4); still needs the calendar itself extended annually — an existing maintenance burden this phase inherits, doesn't create |
| A future engineer adds a 7th evidence source table and forgets a hook | Low | Six hook points are enumerated exhaustively here (§9) and should be captured in code comments at each hook site, matching this codebase's existing habit of explaining "why" inline |
| Double-counting via the two-category edge case (§14.6) resurfacing in a new resource type later | Low | Category derivation is centralised in one function (`tagEvidence()`'s category-mapping table), not scattered per call site — a new resource type only needs one new mapping-table entry |

## 20. Critique & Simplification Pass

As requested, before treating this as final:

**20.1 — Dropped: a `tse_evidence_categories` lookup table.** The Phase 2 draft proposed a small reference table for the category list. Reviewing this codebase's actual conventions (`assessment_blueprints.status`, `payment_ledger.status`, `subscriptions.status` are all plain `TEXT` columns with the allowed values documented in a SQL comment, never a joined lookup table) shows a lookup table would be inconsistent with how every other bounded-enum column in this schema is already modelled, and buys nothing — the category list is fixed, small, and known at code-review time, not user-editable data. **Simplified to a plain `TEXT category` column** in §4.1. This removes one table and one join from every query in the system for no loss of functionality.

**20.2 — Considered and rejected: merging `term`/`year` into a single `term_key` string** (mirroring `usage_events.month_key`). Rejected because `MY GROWTH`'s core query needs to filter by year and term independently in some cases (e.g. "this year across all terms" for an annual portfolio) — a composite string would require string-parsing or prefix-matching to support that, where two integer columns support it with a plain `WHERE`. Kept as two columns.

**20.3 — Considered and rejected: writing evidence links inside the same DB transaction as the source-table insert**, vs. the "call right after" approach in §9. A same-transaction write is marginally safer (true atomicity) but would require touching the transaction boundary of six existing functions across six files — a much larger, riskier diff than the "add one call after a successful write" approach, for a failure mode (the write succeeds but the process crashes microseconds before the tag call) that's already extremely rare and, worse case, only costs one missing evidence-status count, never data loss or a broken feature. **Kept as sequential, not transactional** — favouring a minimal, low-risk diff over theoretical perfect atomicity, consistent with how conservatively this codebase already treats touching existing write paths (see the audit's own emphasis on additive-only change).

**20.4 — Confirmed, not simplified further: the six-nullable-FK-column design (§3).** Revisited once more here given the instruction to look for simplification — a polymorphic pointer really would be less code. But "less code" here trades away the one property (real referential integrity, verified by `ON DELETE CASCADE`) that makes §14.1's edge case handling trivial instead of requiring a manual cleanup job. Kept as-is; this is the one place where the more verbose design is the actually-simpler one once orphan-handling is accounted for.

## 21. Future Extensibility

- A **DSG** access layer (Phase 2 spec §8) would read from exactly this same `tse_evidence_links` table, scoped through the new grant model — no schema change to this layer required when that phase is greenlit.
- A **7th+ evidence source** (e.g. a future CPD/training-log feature) adds one nullable FK column, one partial unique index, and one entry in `tagEvidence()`'s category-mapping table — the pattern established in §9 scales linearly, not combinatorially.
- **Analytics/reporting beyond the individual teacher** (e.g. a future school-level or district-level rollup, mentioned only in passing in `PROJECT_STATUS.md`'s "Other planned work") could aggregate `tse_evidence_links` across teachers *if* a school/tenant concept is ever introduced — flagged only as a future compatibility note, not a Phase 3 concern, since no such concept exists in the schema today.

---

*No production code is included in this document. Ready for review; recommend explicit sign-off on §3 (six-FK design) and §9 (the six hook points) specifically, since those are the two decisions every later phase will build on top of.*
