# Project Status

**Last updated:** 2026-08-06
**Repository:** main @ `4483866` (docs/project layer commit, pushed to
`origin/main`, base was `dd6ec21`)
**Backend tests:** not run this session (counted, not executed — see below)
**Frontend build:** not run this session
**Browser verified this session:** none (see `VERIFIED.md`)
**Current focus:** PR28 (assessment detail) + item-analysis bug + intervention-plan prompt bug

This file is a snapshot, not history. Update the header block above every
session. If you open this file and the header is more than a few days old,
don't trust the body below without re-checking `PROJECT_INVENTORY.md`.

This file is the **single source of truth** for the project's current
state. The other documents in `docs/project/` either reference this file or
are updated only on significant events — they should not re-derive or
contradict the facts here:

- `PROJECT_INVENTORY.md` — full per-feature detail (this file's summary table expanded)
- `VERIFIED.md` / `RELEASE_CHECKLIST.md` — browser-verification tracking, derived from the same facts
- `PROJECT_ROADMAP.md` — updated when scope changes
- `PROJECT_DECISIONS.md` — updated when a new architectural decision is made
- `CHANGELOG_PROJECT.md` — updated when a milestone ships
- `NEXT_SESSION.md` — updated every session, always

If any of those ever disagree with this file, this file wins — go fix the
other one rather than trusting it.

This file is a snapshot, not history. Update the header block above every
session. If you open this file and the header is more than a few days old,
don't trust the body below without re-checking `PROJECT_INVENTORY.md`.

See `PROJECT_INVENTORY.md` for the full per-feature table and
`VERIFIED.md` for what's actually been clicked through in a browser.

## Snapshot

- **Backend**: extensive — services + routes exist for every major area
  (auth, classes, learners, observations, assessments, QMS, interventions),
  backed by 57 test files in `tests/`.
- **Frontend**: 9 pages exist in `dashboard/src/pages/`, all wired to real
  API calls via `authedFetch` (no mocks found). **Zero test files in
  `dashboard/`.**
- **Integration**: confirmed by reading code (frontend calls match registered
  backend routes) for Classes, ClassDetail, LearnerDetail. Not confirmed by
  running the app, except Auth and Home.
- **Known active bugs**: item analysis values zeroing out (field-name
  mismatch, write path vs. read path), AI intervention plan prompt
  misstating group counts.

## In progress

- 🚧 PR28 — assessment detail service/routes (per prior session, being
  curl-tested)
- 🚧 Item analysis bug investigation
- 🚧 Intervention plan prompt bug investigation

## Believed complete, not yet browser-verified

- Classes list, Class detail, Class snapshot, Learner detail, Observation
  workspace, QMS workspace — all have matching frontend + backend + passing
  unit tests, but no confirmed browser click-through in this audit.

## Explicitly not started / not located this session

- Frontend test coverage
- Class analytics UI wiring (service exists, no confirmed frontend consumer)
- Class intervention UI wiring (service exists, no confirmed frontend consumer)
- Learners list page (backend + tests exist; page not yet located)
- Deployment/CI/monitoring — not audited this session

## Measured counts (2026-08-06 audit)

Counted directly from the repo, not estimated:

| Metric | Count |
|---|---|
| ADR documents | 21 (numbered ADR-001 through ADR-018, two share "005") |
| Backend API routes (`routes/api.js`) | 15 |
| Auth routes (`routes/auth.js`) | 2 |
| Backend test files (`tests/*.test.js`) | 116 |
| Frontend test files (`dashboard/`) | 0 |
| Frontend pages (`dashboard/src/pages/*.jsx`) | 9 |
| Frontend pages browser-verified | 2 (Login, Home) |
| Frontend pages with confirmed API wiring (code-read, not browser) | 8 of 9 (all except Login, which uses direct client calls not authedFetch — also fine, just different pattern) |
| Backend features with no confirmed frontend consumer | 2 (Class Analytics, Class Intervention — services + tests exist, no UI wired) |
| Frontend routes/pages confirmed genuinely missing | 1 (standalone Learners list — confirmed absent from `App.jsx`'s route table, not just unfound) |

**Evidence audit status: complete.** Every page in `dashboard/src/pages/`
has been traced to its backend route, service, and test files (see
`PROJECT_INVENTORY.md` for full evidence blocks). `App.jsx`'s route table
was read directly to confirm what does and doesn't exist, rather than
inferring from filenames. Next phase is browser verification, not further
code archaeology.

This replaces the earlier 82%-style estimate. No blended percentage is
given here on purpose — "9 pages, 2 verified" is more useful and harder to
misread than "78% frontend complete." If a single number is wanted later,
compute it explicitly from this table and say how (e.g. verified ÷ total
pages) rather than eyeballing it.
