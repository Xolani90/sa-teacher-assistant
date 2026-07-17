# SA Teacher Assistant – Project Status

_Last updated: 2026-07-17_

## Repository
- **Canonical repo:** `~/Downloads/sa-teacher-assistant`
- **Branch:** `main`
- **Remote:** `origin/main`
- **Old repos** (`sa-teacher-assistant-archive/`, `sa-teacher-assistant-archive-stale/`, and the various dated `.zip`/`.tar.gz` snapshots in `~/Downloads`) are **retired** — read-only backups only. Do not develop in them.

## Current Health
Stable. `git status` clean, in sync with `origin/main`. 27/30 test suites passing as of last full run; the 3 failures are:
- `phase-classifier-disambiguation.test.js` — not a code bug, blocked on Anthropic API credit balance (see Blockers below)
- `phase-d-payment-renewal.test.js`, `phase-d-replay-stress.test.js` — **fixed**, duplicate stale local `parseSqliteUtc()` declarations removed (both now import the canonical version from `utils/dateUtils.js`)

## Recently Completed
- `rollbackUsage()` shared helper for quota rollback consistency (`bcbaff3`, 2026-07-13)
- SQLite-backed rate limiting, replacing in-memory Maps that reset on Render restart (`00d65d5`)
- Delivery rollback feature + regression test rewrite (`c705c1b`, `aa04b94`)
- `buildPdfUrl()` consolidation of PDF signing logic (`1a37d97`)
- Observation workflow (OBSERVATION intent, submission flow, MY OBSERVATIONS command)
- `parseSqliteUtc()` UTC timestamp fix + documented invariant (`9e62f70`)
- Subscription renewal stacking fix, `markUserAsPro()` fix, `/admin/grant-pro` fix
- PDF rendering fixes: bullet bold-span rendering, page-total footer, number line realignment
- Duplicate `parseSqliteUtc` declarations removed from `tests/phase-d-payment-renewal.test.js` and `tests/phase-d-replay-stress.test.js`

## Outstanding Work

### High Priority
- Worksheet/PDF branding and layout polish (`prompts/worksheet.js`)
- Teacher analytics

### Medium Priority
- `routes/webhook.js` modularisation — currently ~3700 lines. First step: extract coherent handler blocks into a `flows/` directory (`worksheetFlow.js`, `testFlow.js`, `lessonPlanFlow.js`, `observationFlow.js`, `interventionFlow.js`, `pdfFlow.js`), leaving `webhook.js` as routing/orchestration only. Incremental, one flow at a time — no architecture redesign.
- School administration features
- District dashboard
- Department of Education reporting
- Subscription/payment improvements

### Blocked
- AI classifier improvements — blocked on Anthropic API credit balance (account tied to the API key used by `phase-classifier-disambiguation.test.js` is depleted; regex fallback works correctly in the meantime)

### Audit follow-up
- Item 5 (stale code comment): **resolved**. Located and removed — a leftover '// Report comment conversation state (in-memory)' header comment at routes/webhook.js:164, which contradicted the correct comment directly below it describing the SessionStore SQLite-backed migration. Backlog audit is now fully closed.
