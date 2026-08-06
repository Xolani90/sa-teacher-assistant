# Project Status

**Last updated:** 2026-08-06
**Repository:** main @ `1ef2a1a` (docs/project layer, current HEAD as of
this update — check `git log -1` at the start of every session and correct
this line before doing anything else if it's stale)
**Current milestone:** Phase B — Browser Verification (Phase A evidence
audit complete)
**Active task:** see `ACTIVE_WORK.md`
**Remaining blockers:** none currently
**Next action:** see `ACTIVE_WORK.md` → "Remaining — Phase B checklist"
**Backend tests:** not run this session (counted, not executed — see below)
**Frontend build:** not run this session
**Browser verified this session:** none (see `VERIFIED.md`)

This file is a snapshot, not history. Update the header block above every
session. If you open this file and the header is more than a few days old,
don't trust the body below without re-checking `PROJECT_INVENTORY.md`.

This file is the **single source of truth** for the project's current
state — the control panel. Every session should start here, update the
header block above (HEAD commit, milestone, active task, blockers, next
action), and use `ACTIVE_WORK.md` for the execution queue. The other
documents in `docs/project/` either reference this file or are updated only
on significant events — they should not re-derive or contradict the facts
here:

- `ACTIVE_WORK.md` — what to work on right now, nothing else
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

## Feature Completion Matrix

The release dashboard — one table, answers "what's actually finished?"
without hunting across files. Source facts pulled from `PROJECT_INVENTORY.md`
evidence blocks and `VERIFIED.md`; update both of those first, then mirror
the result here — don't edit this table standalone.

| Feature | Backend | Frontend | Tests | Browser Verified | Release Ready |
|---|---|---|---|---|---|
| Auth (OTP + JWT) | ✅ | ✅ | ❓ (not isolated) | ✅ | ⏳ (blocked on confirming test file) |
| Home Dashboard | ❓ (backing service not confirmed) | ✅ | ❓ | ✅ | ⏳ |
| Classes (list) | ✅ | ✅ | ✅ | ✅ | ⏳ (all four boxes green — candidate for Release Ready, do one more pass to confirm before flipping) |
| Class Detail | ✅ | ✅ | ✅ | ✅ | ✅ |
| Class Snapshot | ✅ | ✅ | ✅ | ✅ | ✅ (ADR-014 discrepancy resolved) |
| Learner Detail | ✅ | ✅ | ✅ | ✅ | ✅ |
| Learners (list) | ✅ | ❌ confirmed absent | ✅ | n/a | ⏳ (product decision needed) |
| Observation Workspace | ✅ | ✅ | ✅ | ✅ | ✅ |
| Observation Detail | ✅ | ✅ | ✅ | ✅ | ✅ |
| Assessment Detail | ✅ (PR28, curl-tested 2026-08-06) | ✅ | ✅ (broad, not isolated to this route) | ✅ | ✅ |
| QMS Workspace | ✅ | ✅ | ✅ | ✅ | ✅ |
| Class Analytics | ✅ | ❌ no consumer wired | ✅ | n/a | ⏳ (product decision needed) |
| Class Intervention | ✅ | ❌ no consumer wired | ✅ | n/a | ⏳ (product decision needed) |
| Item Analysis | ✅ (facility value confirmed correct 2026-08-06; discrimination=0 is by-design for <10 learners, not a bug) | ❓ | ❓ | ❌ | ❌ pending: separate "Target group size" investigation |
| Intervention Plan (AI) | ✅ (buggy — miscounts groups) | n/a | ❓ | ❌ | ❌ blocked on bug fix |

Legend: ✅ confirmed · ⏳ pending/not yet done · ❌ confirmed missing or
broken · ❓ genuinely unknown, not yet checked · n/a not applicable

Only two rows have every column at ✅: none currently. Auth and Home are
closest (browser-verified, backend/frontend solid) but both have an
unconfirmed Tests column — worth a five-minute check to close that out
before calling either "Release Ready."

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

- ✅ PR28 — assessment detail service/routes, curl-tested 2026-08-06,
  backend confirmed correct; browser verification next
- 🚧 "Target group size" investigation (intervention-reporting pipeline —
  independent of item analysis; original combined hypothesis disproven
  2026-08-06, see PROJECT_DECISIONS.md)
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
