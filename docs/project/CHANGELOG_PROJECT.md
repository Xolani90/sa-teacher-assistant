# Project Changelog

Human-readable milestones. Coarser than the ADRs, finer than a vague "recent
months" summary. Add an entry when something ships and is confirmed working
— not when it's merely started.

Note: dates below for milestones prior to the docs/project layer are
approximate, reconstructed from ADR content and session context — the
archive this was originally built from had no `.git` history. Git history
now exists from commit `4483866` onward (docs/project layer, base
`dd6ec21`); anything after that point should use real commit dates.

## 2026 (approximate)

- **Evidence Engine rebuild (TSE Sprints 1–2):** migrations 033–034,
  `schoolCalendarRepository.js`, `tseEvidenceService.js`, six evidence hooks,
  `tseMyGrowthFlow.js`, `GET /api/tse/status`. Followed loss of uncommitted
  work to an ephemeral container — established the rule to `git push` after
  every milestone.
- **ADR-010:** resolved TSE/QMS naming ambiguity — `tse_evidence_links` is
  canonical.
- **Dashboard frontend scaffolded:** Tailwind v3 consuming existing CSS
  variables as design tokens; command-center-style AI-first homepage as
  pilot (`Home.jsx`).
- **PR22 — WhatsApp OTP auth:** migration 032, `authCodeRepository.js`,
  HMAC-SHA256 OTP hashing, routes. Debugged a silent failure caused by phone
  number format mismatch and a text-vs-template message constraint in
  Meta's API.
- **PR24 — Authentication, browser-verified:** OTP request → devOtp
  auto-fill → verify-code → JWT → protected routes → Home dashboard
  rendering real data (4 classes, 10 learners). Root cause of an earlier
  proxy/CORS failure: `dashboard/.env` had `VITE_API_BASE_URL` pointed at
  Render, bypassing the Vite dev proxy.
- **PR27 — Observation Detail:** implemented, recently verified with seeded
  test data (see `PROJECT_DECISIONS.md` for a note on what "verified" means
  here vs. the stricter browser-checklist standard).
- **PR28 — Assessment Detail:** service + two route handlers authored and
  spliced into `routes/api.js`; in progress, being curl-tested.
- **Repo audit (this session):** confirmed Classes/ClassDetail/LearnerDetail
  frontend pages are genuinely wired to real backend endpoints (no mocks).
  Found zero test files in `dashboard/`. Found ADR-014's own "verified"
  claim conflicts with the stricter release-checklist standard. Created the
  `docs/project/` documentation layer (nine files).
- **docs/project layer committed and pushed:** commit `4483866` on
  `origin/main`, base `dd6ec21`. All nine files (`PROJECT_STATUS.md`,
  `PROJECT_INVENTORY.md`, `VERIFIED.md`, `PROJECT_ROADMAP.md`,
  `PROJECT_DECISIONS.md`, `CHANGELOG_PROJECT.md`, `RELEASE_CHECKLIST.md`,
  `PROJECT_MANIFEST.md`, `NEXT_SESSION.md`) are now real, tracked files in
  the repo — this is the first point where git history exists for any of
  this documentation.

## Earlier context (dates unknown, predates this changelog)

- PR13–PR14: class intervention PDF generation + WhatsApp delivery.
- PR21–PR22: auth infrastructure completed.
- ADR-005–007: PDF parity, generation pipeline extraction,
  Progress/Coverage/Mastery service layers.
- ADR-003/004: persistent learner identity (`resolveLearner()`),
  class-context auto-selection; migration 026 partial unique indexes.
- Modularization: extracted `flows/observationFlow.js`, `assessmentFlow.js`,
  `worksheetFlow.js` from the monolithic `routes/webhook.js` (~3390 →
  ~2840 lines); `core/generationPipeline.js` planned via ADR-002.
- `learnerRepository.js` built with history retrieval across
  `learner_results` and `observation_records`.
- Bulk mark capture (ADR-006), class roster management, `EDIT <learner>`
  correction command.
- PDF visual enhancements merged (confirmed via commit `ede092d` and visual
  inspection — this predates the current git-less archive).
- Assessment blueprint intelligence (ADR-005, migrations 029–030).

## Production hardening (earlier, foundational)

Webhook signature verification, SQLite-backed rate limiting, usage rollback
consistency, payment ledger idempotency (Yoco subscriptions), Foundation
Phase/Grade R support (`utils/gradeUtils.js`, phase-aware prompt branches).
