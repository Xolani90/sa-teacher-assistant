# Project Decisions

Quick-reference summary of major architectural decisions. This is a lookup
table, not a replacement for the ADRs themselves — when the summary isn't
enough, go read the linked file in `docs/adr/`.

**21 ADR/design documents exist in `docs/adr/`** (ADR-001 through ADR-018;
two files are both numbered "005" — `assessment-blueprint` and
`intermediate-phase-assessment-intelligence` — worth resolving the numbering
collision at some point, low priority).

## ✅ Resolved: ADR-014 vs VERIFIED.md discrepancy

`ADR-014-dashboard-snapshot-service.md` states its own status as "Accepted —
Implemented" and claims: **"Verified against real seeded data in the
dashboard UI. Analytics and Intervention sections render live values
correctly."**

This previously conflicted with `VERIFIED.md`, which marked Class Snapshot
as ⏳ (not yet browser-verified).

**Resolution (2026-08-06):** re-verified live — Grade 6A Mathematics (id 2),
`GET /api/classes/:id/detail` and `GET /api/classes/:id/snapshot` checked
against `ClassDetail.jsx` and `ClassSnapshotSection.jsx` field-by-field.
Outcome: (a) was correct — ADR-014's claim held up. `analytics` and
`interventions` return `status: "ok"` with real data; `qms` returns
`status: "unavailable"`, which is a deliberate, fully-handled state (per
ADR-014 §3.4 and the corresponding code comment), not a bug — it renders
"Not available at the class level yet." `VERIFIED.md` was simply being
appropriately conservative until independently re-checked. Both Class
Detail and Class Snapshot are now ✅ Browser in `VERIFIED.md` and
`RELEASE_CHECKLIST.md`.

## ✅ Resolved (2026-08-06): "Item Analysis" field-mismatch hypothesis disproven

`ACTIVE_WORK.md` previously carried a hypothesis that `averageFacilityValue`,
`averageDiscrimination`, and "Target group size" all zeroed out due to a
field-name mismatch in `question_data` between `assessmentCaptureService.js`
(write) and `itemAnalysisService.js` (read).

**Investigation:** ran `scripts/debugItemAnalysis.js` against assessment id
1 — a real 5-learner blueprint-backed assessment — dumping the raw
`assessments` row, every `learner_results` row's `question_data`, the
matching `blueprint_questions` rows, and the live `performItemAnalysis()`
output.

**Finding:** the hypothesis does not hold.

- `averageFacilityValue: 0.7` was independently recomputed by hand from
  the raw learner marks for all 4 questions and confirmed correct
- `averageDiscrimination: 0` and `itemQuality: "insufficient_data"` are
  correct, intentional output — the class has 5 learners, and
  `itemAnalysisService.js` deliberately reports 0/insufficient-data below
  10 learners rather than a misleading discrimination score. The tool's
  own generated summary text states this plainly.
- The blueprint-backed read path (`question_data` as
  `{ questionNumber: marksAwarded }`, joined against `blueprint_questions`
  for topic/maxMarks) is working correctly, matching what
  `blueprintAnalytics.js` already does for the same assessment (verified
  during PR28 browser verification, see `VERIFIED.md`)

**Open thread, not yet investigated:** "Target group size" reading 0 may
be a real, separate defect — but it lives in a different pipeline
(`interventionReportsService.js` / `interventionPlanService.js`), not item
analysis. Being tracked independently in `ACTIVE_WORK.md` rather than
assumed to share a root cause with the above.

## Authentication

- **Decision:** JWT + WhatsApp OTP (HMAC-SHA256 hashed), no passwords.
- **Reference:** ADR-008. Note: the ADR header itself says "Accepted
  (design) — not yet implemented" and describes the *prior* code path as
  still using `requireAdminSecret`. This is clearly stale — OTP login is
  confirmed working live (`VERIFIED.md`) — but the ADR file wasn't updated
  to reflect that. Worth a one-line status update in the ADR itself.

## Dashboard data orchestration

- **Decision:** dedicated snapshot service composes multiple independent
  backend services (`classAnalyticsService`, `classInterventionService`,
  QMS/TSE) into one dashboard-facing payload, with graceful "Not available"
  degradation when class-scoped data can't be derived.
- **Reference:** ADR-014, depends on ADR-015 (class analytics), ADR-009
  (class intervention).

## TSE / QMS relationship

- **Decision:** TSE (Teacher Support Evidence) is the canonical evidence
  infrastructure underlying QMS, not a separate parallel system. Two
  planning efforts had converged on overlapping designs; this ADR resolves
  which one is authoritative. `tse_evidence_links` is the canonical table.
- **Reference:** ADR-010.

## Open product decisions (not yet made)

These aren't architectural decisions with an ADR — they're unresolved
product questions surfaced by the evidence audit. Listed here so they don't
get silently resolved by whoever touches the code next.

- **Class Analytics / Class Intervention**: both have complete backend
  services and passing tests, but zero frontend consumers exist anywhere in
  `App.jsx`'s route table. Are these intended to ship in the dashboard, or
  were they deliberately deferred/superseded? Until answered, don't build a
  UI for them speculatively and don't delete the backend code either.
- **Standalone Learners list**: confirmed absent from `App.jsx`. Is a
  cross-class learner list actually wanted, or is the class-scoped roster
  (via Class Detail) the intended UX? See `PROJECT_ROADMAP.md`.

## Remaining decisions to summarize here

ADR-001 (flow boundaries), ADR-002 (generation pipeline), ADR-003/004
(learner identity, class-aware identity), ADR-005 ×2 (assessment blueprint /
intermediate-phase assessment), ADR-006 (assessment session engine), ADR-007
(progress/mastery/coverage services), ADR-009 (class intervention rollup),
ADR-011–013 (QMS domain model, action centre, topic taxonomy), ADR-015–018
(class analytics, coaching trend architecture, trend-based recommendations,
coaching message presentation) — not yet summarized in this pass. Add as
they come up rather than batch-summarizing speculatively.
