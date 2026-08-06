# Project Decisions

Quick-reference summary of major architectural decisions. This is a lookup
table, not a replacement for the ADRs themselves — when the summary isn't
enough, go read the linked file in `docs/adr/`.

**21 ADR/design documents exist in `docs/adr/`** (ADR-001 through ADR-018;
two files are both numbered "005" — `assessment-blueprint` and
`intermediate-phase-assessment-intelligence` — worth resolving the numbering
collision at some point, low priority).

## ⚠️ Discrepancy found during this audit

`ADR-014-dashboard-snapshot-service.md` states its own status as "Accepted —
Implemented" and claims: **"Verified against real seeded data in the
dashboard UI. Analytics and Intervention sections render live values
correctly."**

This conflicts with `VERIFIED.md`, which currently marks Class Snapshot as
⏳ (not yet browser-verified), based on the release-checklist standard of
"personally proven end-to-end in a browser."

Two possibilities: (a) it was genuinely verified at the time ADR-014 was
written and `VERIFIED.md` is being conservative because that session isn't
independently confirmed here, or (b) "seeded data" verification is being
counted more loosely than the checklist standard intends. Recommend
resolving this explicitly next session rather than picking one silently —
either downgrade the ADR-014 claim or upgrade `VERIFIED.md` with a dated
note of what was actually checked.

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
