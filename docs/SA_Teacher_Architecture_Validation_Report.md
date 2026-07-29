# SA Teacher — Teacher Success Engine
## Architecture Validation Report: Evidence Engine Design

*Purpose: stress-test the Phase 3 design, not re-confirm it. Each section tries to break the design first, then states what actually holds up and what doesn't. No implementation, no new proposals beyond what's needed to name a weakness precisely.*

---

## 1. Scale Scenarios

### 1.1 At 10,000 teachers
**The Evidence Engine itself holds up fine at this scale** — `tse_evidence_links` rows are tiny (a handful of integers), and the indexed `(phone_hash, year, term, category)` query stays a narrow, cheap slice regardless of total table size, because every real query is scoped to one teacher first.

**What doesn't hold up is something the Evidence Engine inherits, not something it causes:** this entire application is a single SQLite file (`better-sqlite3`, WAL mode) accessed by (as far as this audit found) a single Node process. WAL mode allows concurrent *readers* but still serializes *writers* through one connection. At 10,000 teachers texting concurrently during, say, a common lesson-planning window (Sunday evening, or the last week of a term when Evidence Engine + AI generation + portfolio builds are all firing at once), every write — including the new evidence-tagging insert — queues behind the same single writer as every existing `usage_events`/`sessions`/`rate_limit_events` write. This ceiling exists today, independent of Phase 3; Phase 3 adds one more small write to an already-serialized path, which is a marginal cost, not a new bottleneck class. **Flagged as a platform-level scaling question the product should have an answer to well before 10,000 teachers, not an Evidence Engine defect.**

### 1.2 At 100,000 evidence records
Trivial for the schema as designed. At even a generous 500 evidence events/teacher/year, 100,000 rows represents roughly 200 teacher-years of activity — the indexed aggregation query described in §5 of the Phase 3 spec doesn't change shape as this number grows, because it never scans across teachers.

### 1.3 At 10 years of history for one teacher
This is where a **real, previously under-specified weakness** shows up: a "build my whole-career portfolio" request for a 10-year veteran could touch several thousand evidence-linked rows. The Phase 3 spec's event-flow diagram (§10 there) says resolution happens as "six simple lookups, one per possible FK column" — correct in shape, but doesn't address that each of those six lookups is a `WHERE id IN (...)` over a potentially large ID list. SQLite has a bound-parameter limit (historically 999, now 32,766 in current `better-sqlite3`/SQLite builds, but not guaranteed across environments) — a naive single `IN` query with thousands of IDs can hit this. **This needs explicit chunking (batch the `IN` clause in fixed-size groups, e.g. 500 at a time) in the actual implementation of `getEvidenceForScope()` — this was not called out clearly enough in the Phase 3 spec and should be treated as a required implementation detail, not an optional optimization.**

---

## 2. Index Adequacy

The five index groups specified (composite phone/year/term/category, class_id, six FK single-column indexes, and the partial-unique dedup indexes) cover every query pattern named in the spec. One gap found on review: **there is no index supporting "all evidence for a teacher regardless of term/year"** (a full-career query, relevant to §1.3's portfolio scenario) as efficiently as it could be — the composite index still works for this (it's a valid leftmost-prefix query on `phone_hash` alone), so this is not a correctness problem, but a full-career scan without a term/year filter reads a wider index range than a single-term query does. At realistic per-teacher volumes this is not worth a second index; flagged only so it isn't mistaken for an oversight in a future review.

---

## 3. Slow-Query Candidates

Two identified beyond what the spec already names:

1. **Unfiltered cross-category evidence browsing on the Dashboard** (a teacher scrolling "show me everything," not just one category) — same `IN`-clause chunking concern as §1.3, same fix.
2. **The backfill script (Phase 3 spec §6)**, run once against a production-sized `saved_resources`/`assessments`/etc. — not a live-query risk, but a one-time operation whose runtime should be estimated against real row counts before it's scheduled, since it's a full scan of six tables. Recommend a dry-run against a production DB copy with a timer, not an assumption that "it's a one-time script" makes its runtime unimportant — if it takes hours, it needs an off-peak maintenance window, which is a scheduling decision, not just a technical one.

---

## 4. Circular Dependency Check

Traced the actual call graph the six hooks introduce: `teacherWorkspaceService`, `diagnosticWorkflowService`, `interventionReportsService`, `interventionPlanService`, `curriculumCoverageService`, and `observationRepository` would each gain a one-directional `require('./tseEvidenceService')`. `tseEvidenceService` itself only touches `tse_evidence_links` directly and (for term derivation) reads from `curriculumIntelligenceService` — it does not call back into any of the six. **No circular dependency found.**

One adjacent finding worth naming: this makes `tseEvidenceService` a dependency of six previously-independent services that had no reason to know about each other before. That's not circular, but it is a new **fan-in** — six services now share one dependency they didn't before. If `tseEvidenceService` ever gets something wrong (a bug, a lock contention issue, a schema change), the blast radius touches six unrelated features simultaneously. This is an acceptable, deliberate trade-off for the value the Evidence Engine provides, but it should be named as a real coupling cost, not treated as free.

---

## 5. Separation-of-Concerns Check

Two real findings here, not zero:

### 5.1 Category-mapping duplication risk (found, not previously flagged)
`teacherWorkspaceService.js` defines `KNOWN_RESOURCE_TYPES` (`worksheet, test, lessonPlan, atp, sbaTask, examPaper, rubric, moderationPack`). The Phase 3 spec's `tagEvidence()` needs its own mapping from each of those same eight values to an evidence category (§9 of the Phase 3 spec). **These are now two independent lists that must stay in sync by hand.** If a ninth resource type is ever added to `KNOWN_RESOURCE_TYPES` without a corresponding entry in the category-mapping table, the failure mode is silent: the resource saves fine, nothing errors, it simply never becomes evidence. This is exactly the kind of gap that survives code review because nothing breaks visibly.
**Recommended hardening (still no code, but a concrete test requirement):** an integration test that asserts every value in `KNOWN_RESOURCE_TYPES` has a corresponding category mapping, that fails loudly the moment the two lists drift. This should be added to the test plan in Phase 3 §18, not left implicit.

### 5.2 Cross-cutting concern injected into single-purpose services (found, acknowledged trade-off)
`curriculumCoverageService.js`'s own module comment (quoted in the Phase 1 audit) states these ADR-007-chain-adjacent services are deliberately narrow. Adding an evidence-tagging call inside `markTopicCovered()` gives that function a second responsibility (track coverage, *and* now emit a side effect for an unrelated feature) it didn't have before. The Phase 3 spec's own §20.3 already chose direct calls over an event/observer pattern for minimal-diff reasons — that reasoning holds for six hook points, but **should be revisited if this pattern grows past roughly this many call sites.** A lightweight internal event emitter ("evidenceable action occurred") that `tseEvidenceService` subscribes to, rather than six services each explicitly calling it, would restore single-responsibility at the six existing sites at the cost of one small piece of new infrastructure. **Not recommended now** — the same minimal-diff logic that justified §20.3 applies here — but worth a named trigger for revisiting: *if a 7th, 8th, 9th evidence source is added and each needs another direct call threaded through another unrelated service, that's the point to switch to an event-based model instead of continuing to add direct calls.*

---

## 6. Extensibility to Named Future Modules

| Proposed future module | Fits the current design as a 7th+ source table? | Real gap found |
|---|---|---|
| SACE CPD tracking | Yes — new `cpd_records` table, one new nullable FK column on `tse_evidence_links`, one migration | None beyond the expected, budgeted work of adding a source |
| Subject advisor visits | Yes — extends `tse_visits.visitor_role` (already a free-text field per the Phase 2 spec), no new table needed | None |
| Teacher mentoring | Partial fit — mentoring *records* (a mentor's notes, session log) fit the same pattern as reflections. **But "mentoring" implies a mentor who isn't the teacher themselves reading/writing this data — the same open question as DSG (Phase 2 §8), not a new one** |
| Annual appraisal support | Yes — composition of growth plan + portfolio + reflection, all already modelled | None |
| Professional portfolios / accreditation evidence | Yes — this is what Portfolio Builder already is | None |
| **School Improvement Plans** | **No — genuine gap.** A School Improvement Plan is a school-level entity, not a teacher-level one. The schema has no `schools` table at all; `teachers.school` is a free-text `TEXT` column (confirmed in `utils/database.js`), not a foreign key to anything. There is no way today to reliably group teachers by school for a shared plan — two teachers who both type "Ndlovu Primary" and "Ndlovu Primary School" are, to this schema, unrelated strings | **Real, load-bearing gap** |
| **District reporting** | **No — same root cause as above**, one level up: no school entity means no district entity either. This is not an Evidence Engine limitation specifically — it's a whole-application limitation the Evidence Engine happens to make visible, because it's the first feature where "roll this up across teachers" becomes a plausible product ask | **Real, load-bearing gap, out of Evidence Engine's scope to fix** |

**This is the most important finding in this report.** Everything the Phase 2/3 documents already scoped (Copilot, Portfolio, Visit Prep, Reflections, Growth Plans, and even the deferred DSG) is fundamentally teacher-scoped, and the Evidence Engine's `phone_hash`-first design serves that well. But **School Improvement Plans and district reporting are not teacher-scoped — they're organization-scoped**, and this application currently has no normalized concept of an organization at all. This is a bigger foundational gap than DSG (which at least has a clear teacher-to-teacher grant model to design against, per Phase 2 §8) — a `schools`/`districts` entity is a genuinely new layer of the data model, not an extension of the Evidence Engine's existing pattern. **Recommend this be named explicitly as a separate, later architectural decision** — "do we need a normalized schools/districts model" — rather than assumed to be covered by "the Evidence Engine can support it," which it cannot, as designed, without that layer existing first.

---

## 7. What Survived Scrutiny Unchanged

To be direct about what did *not* turn up a problem, so this reads as an honest stress-test rather than a search for things to criticize:

- The six-nullable-FK design (§3 of the Phase 3 spec) — held up; the alternative considered here (§1.3's `IN`-clause volume) is a query-batching detail, not a reason to revisit the schema shape itself.
- The dropped lookup table for categories (§20.1 of the Phase 3 spec) — held up; nothing in this review found a reason a lookup table would have prevented any of the issues found here.
- The sequential-not-transactional write choice (§20.3) — held up on its own terms, though §5.2 above adds a *different* reason (single-responsibility, not atomicity) to keep revisiting it as the hook count grows.
- No circular dependencies (§4).
- Retention strategy (Phase 3 §17) — no scale scenario examined here changes that conclusion; evidence-link rows stay small even at 10-year/10,000-teacher scale.

---

## 8. Summary of Required Follow-ups

Ranked by how much they should affect near-term work, not by severity of wording:

1. **Chunk `IN`-clause lookups** in `getEvidenceForScope()`/full-career queries — an implementation requirement, not optional (§1.3, §3).
2. **Add a category-mapping completeness test** (§5.1) to the Phase 3 test plan before implementation, not after a real gap is discovered in production.
3. **Name the schools/districts gap explicitly as its own future architecture question** (§6) — don't let "School Improvement Plans" or "district reporting" sit on the roadmap implying the Evidence Engine already supports them structurally, because it doesn't.
4. **Time-box the backfill script against a real data copy before scheduling it** (§3.2) — operational, not architectural, but easy to under-estimate.
5. **Revisit direct-call coupling (§5.2) only if/when a 7th+ hook point is added** — not now; named as a trigger condition, not a current action item.

Everything else reviewed here — scale at 10,000 teachers for the Evidence Engine's own footprint, index coverage, retention, and the core schema decisions from Phase 3 — held up under scrutiny.

---

*No implementation performed. This report evaluates the design as documented in the Phase 3 spec; none of its findings require reopening decisions already made there except where explicitly noted (§1.3's chunking requirement and §5.1's test addition are refinements within the existing design, not reversals of it).*
