# ADR-011: QMS Domain Model

## Status
Proposed — design only, no implementation.

**Depends on:** ADR-010 (TSE is the evidence infrastructure for QMS).

---

## Context

ADR-010 resolved the boundary between TSE (the evidence infrastructure)
and QMS (the user-facing product domain), and settled that `tse_evidence_links`
remains the single canonical evidence index — no parallel evidence table.

What ADR-010 deliberately left open is the shape of QMS's own domain: the
genuinely new content types it introduces (reflections, growth plans,
portfolios) that have no existing home in the schema, how they reference
TSE evidence without duplicating it, and what rules govern editability,
immutability, and AI-assisted authorship. Those decisions are expensive to
change once teachers are actively writing reflections and growth plans
against a live schema, so this ADR settles them before PR27 (the first QMS
implementation PR) rather than letting them be decided implicitly during
that PR.

---

## Decision

### 1. Boundary between TSE evidence and QMS artifacts

Unchanged from ADR-010, restated for this ADR's scope: TSE owns evidence
*references* (pointers into `assessments`, `intervention_plans`,
`curriculum_coverage`, `observation_assessments`, `saved_resources`, via
`tse_evidence_links`). QMS never duplicates the content those tables hold.
QMS-owned tables either reference TSE evidence links or stand alone as new
teacher-authored content with no existing analogue.

```
Assessment / Intervention / Observation / Coverage
        |
        v
tse_evidence_links   (TSE — canonical, unchanged by this ADR)
        |
        v
QMS artifacts (reflections, growth plans, portfolio snapshots)
```

**Ownership table — stated explicitly so a future contributor never adds
a "convenience copy" of existing data into a QMS table:**

| Data | Owner | QMS may... |
|---|---|---|
| Assessment marks | Assessment system (`assessments`, `learner_results`) | Reference via `tse_evidence_links`. Never copy. |
| Curriculum coverage | Curriculum system (`curriculum_coverage`) | Reference via `tse_evidence_links`. Never copy. |
| Observation records | Observation system (`observation_assessments`) | Reference via `tse_evidence_links`. Never copy. |
| Intervention plans | Intervention system (`intervention_plans`) | Reference via `tse_evidence_links`. Never copy. |
| Saved resources (worksheets, lesson plans) | Resource system (`saved_resources`) | Reference via `tse_evidence_links`. Never copy. |
| Evidence tagging/indexing | TSE (`tse_evidence_links`, `tseEvidenceService`) | Query it. Never re-model it, never write to it directly from QMS code. |
| Teacher reflections | **QMS** (`qms_reflections`) | Owns this outright — no other system reads/writes it. |
| Growth plans | **QMS** (`qms_growth_plans`) | Owns this outright. |
| Portfolio snapshots | **QMS** (`qms_portfolio_snapshots`) | Owns this outright. |

If a future QMS feature seems to need, say, a learner's mastery score
copied onto a portfolio snapshot for faster rendering, the answer is to
compute it at generation time from the owning system (`masteryService.js`
et al.) and store the *rendered result* in the immutable snapshot (§2) —
not to introduce a standing duplicate column that can drift out of sync
with the system that actually owns that data.

### 2. QMS-owned entities

**Reflection** (`qms_reflections`) — teacher-authored prose reflecting on
their own practice for a term, optionally informed by evidence. Editable,
teacher-owned, term-scoped.

**Growth plan** (`qms_growth_plans`) — a goal/target-area a teacher is
tracking over time, with a status lifecycle. Editable, teacher-owned.

Status lifecycle: `active` → `in_progress` → `completed` (a plan may also
move to an `abandoned` terminal state; exact transition rules are an
implementation detail for PR28, not frozen here).

**Portfolio snapshot** (`qms_portfolio_snapshots`) — a compiled,
point-in-time export of a teacher's evidence + reflections + growth plan
for a term. **Immutable once generated** — this is a historical record
of what was true at compilation time, not a live document. Regenerating
produces a new snapshot row; it never edits an existing one. This mirrors
the existing `reports` table's "persist the rendered output" pattern.

### 3. Evidence linking strategy — no duplication of TSE relationships

`qms_reflections` and (if a future phase needs it) `qms_growth_plans` may
relate to one or more TSE evidence links. A reflection is not
one-to-one with a single evidence row — a teacher may reflect on several
assessments and an intervention plan in the same entry.

**Decision: do not create a `qms_reflection_evidence` join table yet.**
Store the association as a JSON array of `tse_evidence_links.id` values in
a single column on `qms_reflections` (e.g. `evidence_link_ids`):

```json
{ "evidence_link_ids": [12, 15, 22] }
```

Rationale: ADR-010 exists specifically to prevent evidence-relationship
duplication proliferating across parallel tables. A join table is the
"correct" relational shape, but introducing it before any real usage data
exists is premature relational complexity — the same anti-pattern ADR-010
already rejected once, applied one level down. If usage shows the
JSON-array approach is insufficient (e.g. needing to query "which
reflections reference evidence X" efficiently at scale), a join table can
be introduced in a later migration with a straightforward one-time
backfill from the JSON column. Reversing that decision later is cheap;
committing to relational complexity now, before there's a single real
reflection row, is not justified by any known requirement.

**This tradeoff is recorded explicitly so it isn't re-litigated from
scratch later:**

Chosen now, specifically, because:
- Low implementation complexity — no join table, no extra query joins,
  no migration to design before PR27 has a single real row to validate
  against.
- No moderation workflow exists yet (§6) that would need to query
  "which reflections/portfolios reference evidence X" from the other
  direction.
- No cross-teacher/district reporting requirement exists yet that would
  need to aggregate or filter on evidence relationships at scale.

**Migration trigger — revisit the JSON-array approach when any of these
becomes real, not before:**
- An HOD/SMT moderation workflow (§6) needs to query evidence-to-artifact
  relationships from the evidence side (e.g. "show me every reflection
  that cites this assessment").
- Evidence-based filtering or search across reflections is needed in the
  dashboard or WhatsApp ("find my reflections about fractions coverage").
- District-level reporting/analytics needs to join across many teachers'
  evidence-artifact relationships at a volume where JSON parsing per row
  becomes a real query-performance cost, not a theoretical one.

None of these three conditions exists today. This decision should not be
revisited pre-emptively "for correctness" — only when one of the above
triggers actually arrives as a real, scoped requirement.

### 4. AI-assisted content authorship policy

QMS reflection (and potentially growth-plan) content may be AI-drafted,
teacher-edited, or both. For a professional portfolio that may eventually
be submitted for institutional review, authorship provenance matters.

Two options were considered:

- **Option A — boolean flag.** A single `ai_assisted: true/false` column.
  Simple, cheap, answers "did AI touch this at all."
- **Option B — lifecycle tracking.** Track distinct states: `generated`
  (AI draft exists) → `edited` (teacher has modified it) → `approved` (teacher
  has explicitly signed off on the current content) → `submitted` (included
  in a portfolio snapshot).

**Decision: Option A (`ai_assisted` boolean) for PR27; Option B is the
intended eventual direction but is explicitly deferred, not built now.**

Rationale: Option B is the right answer for education-compliance
contexts where provenance needs to survive scrutiny (e.g. an HOD or SACE
reviewer wanting to know whether a reflection was substantively
teacher-written). But building that lifecycle machinery before a single
moderator/reviewer role exists (see §6) is solving a problem with no
consumer yet. `ai_assisted` boolean is forward-compatible — a later
migration can add lifecycle state without needing to unwind anything the
boolean approach commits to. This mirrors this ADR's own §3 reasoning:
defer relational/state complexity until a real requirement forces it.

### 5. Immutability rules

- `qms_portfolio_snapshots` rows are immutable once written (§2).
- `qms_reflections` and `qms_growth_plans` rows are mutable — teachers can
  edit their own content freely. No edit-history/versioning table is
  introduced in this ADR; if audit history becomes a requirement (likely
  alongside Option B authorship tracking, §4), it is a future, separate
  decision.
- TSE evidence rows themselves (anything in `tse_evidence_links` and the
  tables it points to) are never written to by QMS code, per ADR-010 —
  restated here as a hard boundary, not just a convention.

### 6. Future moderation/HOD role boundary — explicitly out of scope

No HOD, moderator, SMT, or district role or identity exists anywhere in
this codebase today. Every identity concept (WhatsApp phone-hash, JWT
`sub` = `teacher.id`, ADR-008) is teacher-scoped only. `saved_resources`
already has a `moderationPack` resource type, but there is no mechanism
for a second party to review or sign off on one.

```
Teacher
   |
  HOD        <- role/auth model does not exist yet
   |
  SMT        <- role/auth model does not exist yet
   |
 District    <- role/auth model does not exist yet
```

**Decision: this ADR does not design a `qms_moderation_records` table or
any second-party review mechanism.** Doing so now would mean guessing at
a data model for a role system that doesn't exist, ahead of the auth ADR
that would actually define who an HOD is and how they authenticate. When
that role/auth ADR exists, moderation records become a well-scoped
follow-on to this document, referencing `qms_portfolio_snapshots` /
`qms_reflections` the same way this ADR's tables reference TSE.

### 7. Deletion, editing, and versioning rules

Stated per entity so PR27–29 don't each have to re-decide this:

**Reflections (`qms_reflections`):**
- Can be edited after creation: **yes**, freely, by the owning teacher.
- Can be deleted: **soft delete** (`deleted_at` nullable timestamp), not
  hard delete. Rationale: a reflection may have already been compiled
  into a `qms_portfolio_snapshots.included_evidence_ids`-style reference
  at generation time; hard-deleting the source row would leave a
  portfolio snapshot referencing content that no longer exists anywhere.
  A soft-deleted reflection is simply excluded from future
  listings/portfolio generation while remaining resolvable for any
  snapshot that already captured its content at generation time.
- No edit-history/versioning table in this ADR (§5) — only the current
  content is stored. Revisit if Option B authorship tracking (§4) is
  ever built, since "what did the teacher edit and when" starts to
  matter for that.
- Can AI generate it: **yes**, subject to `ai_assisted` disclosure (§4).
- Can it exist without any linked evidence: **yes** — a reflection is
  valid teacher content on its own; `evidence_link_ids` may be an empty
  array. Forcing every reflection to cite evidence would block
  legitimate general reflection ("this term was hard because...") that
  doesn't reduce to specific assessment/observation rows.

**Growth plans (`qms_growth_plans`):**
- Can be edited: **yes**, status and content both, by the owning teacher.
- Can be deleted: **soft delete**, same rationale as reflections — a
  completed/abandoned plan may still be referenced by a portfolio
  snapshot that already ran.
- No versioning table in this ADR; status transitions (§2) are tracked
  via the single `status` column, not a history table.

**Portfolio snapshots (`qms_portfolio_snapshots`):**
- Can be regenerated: **yes** — always produces a **new** row (§2, §5).
  Never updates an existing snapshot in place.
- Can old versions be viewed: **yes** — every snapshot is retained by
  default; there is no automatic pruning in this ADR. If storage cost
  becomes a real concern (many snapshots × PDF size), a retention policy
  is a future decision, not assumed here.
- Can a teacher delete a submitted snapshot: **not decided in this ADR.**
  This genuinely depends on the moderation/roles question in §6 — if a
  snapshot has been submitted to an HOD/SMT for review, unilateral
  teacher deletion may not be appropriate once that workflow exists.
  Until that role model exists, snapshots have no "submitted" state to
  make this question concrete (§4 Option A has no submission step), so:
  **for PR29, no deletion is exposed for portfolio snapshots at all**
  (neither soft nor hard) — this is deliberately more restrictive than
  reflections/growth plans until the moderation ADR resolves who else
  might have a stake in a given snapshot.

### 8. Acceptance criteria — required before PR27 begins

This ADR is not accepted, and PR27 should not start, until each of the
following has an unambiguous answer. Answers as currently decided by this
ADR are given inline; this section exists so review can check each one
explicitly rather than accepting the document as a whole and missing a
gap.

**Reflections:**
- [x] Can be edited after creation? — Yes (§7)
- [x] Can be deleted, and how (soft/hard)? — Soft delete (§7)
- [x] Can AI generate it? — Yes (§4)
- [x] Must AI assistance be disclosed? — Yes, via `ai_assisted` boolean (§4)
- [x] Can it exist without evidence? — Yes (§7)

**Growth plans:**
- [x] Can be edited after creation? — Yes (§7)
- [x] Can be deleted, and how? — Soft delete (§7)
- [x] Status lifecycle states frozen? — `active`/`in_progress`/`completed`/`abandoned` (§2)

**Portfolio snapshots:**
- [x] Can it be regenerated? — Yes, always as a new row (§7)
- [x] Can old versions be viewed? — Yes, retained by default (§7)
- [x] Can a teacher delete a submitted snapshot? — Deletion not exposed
      at all in PR29; explicitly deferred to the future moderation ADR (§7)

If any box above is unchecked or disputed at review time, this ADR is not
ready to move from Proposed to Accepted.

### 9. Migration sequence (037–039)

Each ships as its own PR, schema-first with no WhatsApp/dashboard surface
in the same PR — matching the pattern that worked for TSE (Migrations
034–036 landed before `MY GROWTH` consumed them).

| Migration | Table | PR | Notes |
|---|---|---|---|
| 037 | `qms_reflections` | PR27 | `reflectionService.js`; no WhatsApp command yet |
| 038 | `qms_growth_plans` | PR28 | `growthPlanService.js` |
| 039 | `qms_portfolio_snapshots` | PR29 | `portfolioService.js`; depends on 037+038 having real data to compile |

Next migration number available: **037** (last used: 036, per ADR-010's
context section).

---

## Data Model

```sql
-- Migration 037
CREATE TABLE IF NOT EXISTS qms_reflections (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_hash         TEXT    NOT NULL,
  term               INTEGER,
  content            TEXT    NOT NULL,
  ai_assisted        INTEGER NOT NULL DEFAULT 0,   -- boolean, §4 Option A
  evidence_link_ids  TEXT,                          -- JSON array, §3
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at         TEXT                            -- soft delete, §7
);

-- Migration 038
CREATE TABLE IF NOT EXISTS qms_growth_plans (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_hash   TEXT    NOT NULL,
  term         INTEGER,
  goal_text    TEXT    NOT NULL,
  target_area  TEXT,
  status       TEXT    NOT NULL DEFAULT 'active',  -- active|in_progress|completed|abandoned
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at   TEXT                                 -- soft delete, §7
);

-- Migration 039
CREATE TABLE IF NOT EXISTS qms_portfolio_snapshots (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_hash            TEXT    NOT NULL,
  term                  INTEGER,
  pdf_path              TEXT,
  included_evidence_ids TEXT,    -- JSON array of tse_evidence_links.id
  generated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
  -- no updated_at: immutable, §2/§5
);
```

No changes to any existing table. All three tables are additive,
reference `teachers.phone_hash` the same way every other table in this
schema already does, and require no change to `runMigrations()`'s
existing blocks. Rollback for any subset is `DROP TABLE` — same profile
as every other additive migration in this schema's history.

---

## Consequences

- QMS gains a defined, minimal domain model before any code is written
  against it, reducing the risk of an expensive schema change once
  teachers have real reflections/growth plans stored.
- The evidence-duplication risk ADR-010 identified is closed at one more
  layer down: QMS tables reference TSE evidence, they never re-model it.
- The AI-authorship question is answered for PR27 (boolean) without
  foreclosing the richer lifecycle model this product will likely need
  once portfolios face institutional review — deferred deliberately, not
  by omission.
- The role/moderation gap is named explicitly rather than left implicit,
  so a future contributor doesn't discover mid-PR27/28/29 that
  "moderation" has no auth model to attach to.

---

## Alternatives Considered

- **A `qms_evidence_links` table mirroring TSE's shape.** Rejected —
  this is exactly the duplication ADR-010 already resolved against.
- **A `qms_reflection_evidence` join table now.** Rejected for this ADR
  (§3) as premature relational complexity ahead of any real usage data;
  documented as the likely eventual shape if the JSON-array approach
  proves insufficient.
- **Option B (lifecycle) authorship tracking now.** Rejected for PR27
  (§4) — no moderator/reviewer role exists yet to consume that
  granularity; boolean is forward-compatible with adding it later.
- **Designing `qms_moderation_records` now, ahead of a roles/auth ADR.**
  Rejected (§6) — would require guessing at an identity model this
  codebase doesn't have.
