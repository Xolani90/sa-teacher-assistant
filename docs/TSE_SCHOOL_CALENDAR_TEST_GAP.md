# Investigation: `[TSE] tagEvidence failed (non-fatal): no such table: school_calendar`

## Status: rollout complete

- PR A — complete
- PR B1 (7/7 files) — complete
- PR C — complete
- PR B2.1 (4/4 files) — complete
- PR B2.2 (5/5 files) — complete
- PR B2.3–B5 — complete (implemented after this document was last updated;
  detailed per-file history for these batches is preserved in `git log`,
  not reproduced here — see "Audit trail note" at the end of this
  document)
- Post-B5 audit — complete (see "Post-B5 audit" below)
- PR B6 (6/6 files) — complete (see "PR B6" below)
- **Production-backed hand-rolled-schema migration initiative: complete.**
  No remaining test file exercises real production code (`routes/webhook`,
  `utils/usageTracker`, or any service/repository) against a hand-rolled,
  non-migrated schema. See "Repository state" below for what remains on
  direct `better-sqlite3` and why that's no longer a schema-drift risk.

## Root cause

Not a production bug. The real migration chain (`utils/database.js`,
`runMigrations()`) creates `school_calendar` (Migration 033) and
`tse_evidence_links` (Migration 034) correctly and in the right order.

The warning came from ~36 older test files that build their own
hand-rolled `CREATE TABLE` schema instead of running the real migration
chain. Those hand-rolled schemas predate the TSE Evidence Engine and were
never updated when Migrations 033/034 landed. `tagEvidence()`
(`services/tseEvidenceService.js`) unconditionally calls `getCurrentTerm()`
→ queries `school_calendar` on every call, regardless of category. Its
catch block is a blanket `catch (err) { console.error(...); return false; }`
— non-fatal by design (evidence tagging must never break the write it's
attached to), but this also means the failure was indistinguishable from
any other error and silently swallowed.

**Consequence:** every test file with this gap was asserting things about
evidence tagging (or triggering a write path that calls `tagEvidence()`
incidentally) without ever actually exercising that code path — the
INSERT was failing every time, caught, logged, and ignored. Test coverage
in those files was, for this narrow slice, an illusion.

## Fix: shared migrated-test-db helper

`tests/helpers/createTestDb.js` runs the REAL `runMigrations()` against a
throwaway file-backed SQLite db (via a `node:sqlite` shim, since this
sandbox can't compile the native `better-sqlite3` addon). This pattern
already existed independently in a handful of newer test files
(`tests/adr003-learners-migration.test.js`,
`tests/phase-6-observation-repository.test.js`); this helper extracts it
into one shared, documented source of truth so every test file uses the
same approach instead of copy-pasting the shim, and so any future
migration automatically appears in every converted test with zero extra
work.

## Converted so far (proof of approach)

- `tests/workspace.test.js`
- `tests/blueprint-analytics.test.js`

Both pass in full against the real schema. Converting them required
fixing a small number of raw `INSERT` statements that had drifted from
the real schema's `NOT NULL` constraints (e.g. `assessments.assessment_type`,
`assessments.grade/subject/term`, `learner_results.mark/total_marks`) —
expected, and exactly the kind of drift this change is meant to catch.

**Bonus finding:** converting `blueprint-analytics.test.js` surfaced a
previously-hidden gap — its `curriculumCoverageService` stub is missing
`getExpectedTopics`, which `diagnosticWorkflowService` calls internally.
This was masked by the `school_calendar` failure firing first every time;
it's now visible as a caught-but-logged error inside
`diagnosticWorkflow`. Non-fatal, doesn't fail the test, but worth fixing
when this file (or its stub) is next touched.

## PR B1 — batch 1 (7 files, complete)

- `tests/tseEvidenceHooks.test.js`
- `tests/phase-6-observation-repository.test.js`
- `tests/phase-b2-hardening.test.js`
- `tests/class-intervention-pdf.test.js`
- `tests/learner-intervention-pdf.test.js`
- `tests/blueprint-pdf-report.test.js`
- `tests/migration-030-blueprint-marks-import.test.js`

All seven pass in full against the real migrated schema, no
regressions. Same category of drift as above turned up again — raw
`INSERT`s missing `NOT NULL` columns, and the `getExpectedTopics` stub
gap recurring in `migration-030-blueprint-marks-import.test.js`
(fixed the same way: added to that file's stub map).

### Update (after PR B1): `learner_results.created_at` was NOT a production defect

Converting `migration-030-blueprint-marks-import.test.js` initially
appeared to surface a second, distinct bug alongside the usual
`school_calendar` gap: a logged, non-fatal
`no such column: lr.created_at` error inside
`diagnosticWorkflowService`'s intervention-plan persistence
(`learnerRepository.getAssessmentHistory()`). This was flagged in that
file's commit message as a genuine defect worth a follow-up fix.

Follow-up verification disproved that:

- `PRAGMA table_info(learner_results)` against the real migrated
  schema confirms `created_at` has been present since the base
  `CREATE TABLE` in `utils/database.js` (line ~133,
  `DEFAULT (datetime('now'))`). No later migration touches it.
- All three `lr.created_at` references in `services/learnerRepository.js`
  (`getAssessmentHistory`, `getRecentAssessments`, `getClassHistory`)
  were always correct against that schema.
- The *original*, hand-rolled schema in
  `migration-030-blueprint-marks-import.test.js` never defined
  `created_at` on its fake `learner_results` table — the same class of
  drift as `school_calendar`, not a separate production issue.
- Converting the file to `createTestDb()` eliminated the error as a
  side effect; three repeat runs post-conversion show zero
  `created_at` errors.

**Conclusion:** no production code changes were required. The earlier
commit message overstated this as a genuine `diagnosticWorkflowService`
defect; it was test-schema drift, resolved by the same conversion that
surfaced it. Recorded here rather than amending the (already-pushed)
commit message, to preserve the investigation's audit trail.

## PR B2.1 — assessment-session batch (4 files, complete)

- `tests/assessment-session-flow.test.js`
- `tests/assessment-session-bulk-dispatch.test.js`
- `tests/assessment-session-print.test.js`
- `tests/assessment-session-undo-dispatch.test.js`

All four pass in full against the real migrated schema, no
regressions (34, 22, 27, and 22 assertions respectively). Clean
conversions across the board — the hand-rolled `sessions` table in
each of these files already matched the real migrated schema
exactly, so no `NOT NULL` drift or stub gaps surfaced. That's a
useful signal in its own right: for this batch, the schema debt was
purely about not running real migrations, not about the fake schema
being wrong.

**Inventory correction:** the batch was originally scoped at 5 files,
including `tests/routing-order-assessment-session-priority.test.js`.
That file is a source-inspection test — it reads
`core/messageProcessor.js` and `core/commandHandler.js` as text and
asserts dispatch-order invariants via string search. It never
instantiates `better-sqlite3` or `DatabaseSync` and has no
hand-rolled schema to drift, so there's nothing for `createTestDb()`
to fix. Confirmed by grepping all test files for the DB-shim pattern;
this file doesn't match it. B2.1 is complete at 4 real conversions.

## PR B2.2 — Auth batch (5 files, complete)

- `tests/authCodeRepository.test.js`
- `tests/teacherAuth.test.js`
- `tests/pr22-whatsapp-otp.test.js`
- `tests/pr25-dev-otp-bypass.test.js`
- `tests/update-teacher-profile.test.js`

All five pass in full against the real migrated schema, no
regressions (33, 48, 39, 12, and 2 assertions respectively). Unlike
B2.1, this batch wasn't uniformly mechanical — three files needed
real thought beyond a find-and-replace:

- **`pr22-whatsapp-otp.test.js`** called `resetDb()` 16 times mid-run,
  each originally swapping in a brand-new in-memory db. Since the real
  `utils/database.js`'s `getDb()` is a true process-wide singleton,
  `createTestDb()` can only run once per file — `resetDb()` now clears
  rows via `DELETE FROM` instead. That surfaced a real test-only bug:
  `DELETE` doesn't reset SQLite's autoincrement sequence, and one
  section (`VC-08`) relied on `insertTeacher()` reproducing an id
  captured by an earlier section under the old always-fresh-db
  semantics. Fixed by also clearing `sqlite_sequence` on every reset.
- **`update-teacher-profile.test.js`** previously couldn't run in the
  sandbox at all — it required the native `better-sqlite3` addon
  directly (with a hand-written two-file module-resolution stub)
  instead of going through any shim, hitting the sandbox's known
  `invalid ELF header` constraint. Converting it fixed that as a side
  effect. It also surfaced a genuine schema-drift finding: the
  hand-rolled schema declared `teachers.grade` as `INTEGER`, but the
  real migrated column is `TEXT` — `utils/usageTracker.js` deliberately
  stringifies integer grades before writing (a documented fix for a
  prior `"7.0"` coercion bug). The `INTEGER` hand-rolled schema masked
  that this codepath is ever exercised. Fixed the test assertion to
  expect the string `'7'`, matching real production behavior; no
  production code changed.
- `authCodeRepository.test.js`, `teacherAuth.test.js`, and
  `pr25-dev-otp-bypass.test.js` were clean, mechanical conversions —
  hand-rolled schemas already matched the real migrated schema exactly.

## PR C — `tagEvidence()` diagnostics (complete)

Implemented as originally proposed below: distinguishes missing-table
failures (still a quiet, non-fatal skip) from any other error inside
`tagEvidence()`'s catch block, rethrowing the latter when
`NODE_ENV === 'test'`.

Verified zero regressions: full suite (106 files) shows the identical
92/106 pass, same 14 pre-existing (unrelated) failures, with and
without the change.

**Important:** the rethrow is currently inert. Nothing in the project
sets `NODE_ENV=test` yet — not `tests/run-all.js`, not `package.json`'s
`test` script. This was deliberate, matching the original plan below:
flipping it on now would immediately start rethrowing whatever's still
hiding in the ~27 unconverted files, rather than genuinely resolved
issues. Enable `NODE_ENV=test` once PR B2 has converted most of the
remaining files.

## Post-B5 audit

After PR B2.3–B5 (see "Audit trail note" below), 8 test files remained
that either required the native `better-sqlite3` addon directly or
otherwise hadn't been swept by the earlier batches. Before declaring the
rollout complete, each was audited against four questions: does it
`require('better-sqlite3')` directly, does it hand-roll its own
`CREATE TABLE` schema, does it manually stub `../utils/database`, and does
it exercise real production code that should instead run through
`createTestDb()`.

| File | Direct `better-sqlite3` | Hand-rolled schema | Exercises real production code | Classification |
|---|---|---|---|---|
| `cancel-pending-save.test.js` | ✓ | ✓ (`teachers`, `sessions`, `saved_resources`) | ✓ `routes/webhook` | Convert |
| `generation-pipeline-last-intent.test.js` | ✓ | ✓ (`teachers`, `usage_events`, `rate_limit_events`, `sessions`) | ✓ `routes/webhook` | Convert |
| `menu-help-session-reset.test.js` | ✓ | ✓ (`teachers`, `sessions`) | ✓ `routes/webhook` | Convert |
| `phase1-delivery-rollback.test.js` | ✓ | ✓ (`teachers`, `usage_events`, `rate_limit_events`, `sessions`) | ✓ `routes/webhook` | Convert |
| `mark-user-as-pro.test.js` | ✓ | ✓ (`teachers`) | ✓ `utils/usageTracker` | Convert |
| `phase-e-usage-rollback.test.js` | ✓ | ✓ (`teachers`, `usage_events`) | ✓ `utils/usageTracker` | Convert |
| `learnerIdentityService.test.js` | ✗ | ✗ — already calls real `runMigrations()` | ✓ `services/learnerIdentityService` | Leave as-is |
| `migration-036-learner-intervention-writer.test.js` | ✗ | ✗ — already calls real `runMigrations()` | ✓ `services/interventionService` | Leave as-is |

**Outcome:** 6 of the 8 were genuine, production-backed hand-rolled-schema
debt — the same pattern PR B5 and earlier batches existed to eliminate.
The other 2 were already correct: they call the real `runMigrations()`
directly (predating the shared `createTestDb()` helper, same as
`tests/adr003-learners-migration.test.js`), and their sandbox failures were
purely environmental — the uncompiled native `better-sqlite3` addon
hitting the sandbox's known `invalid ELF header` constraint — not schema
drift. This distinction is why the rollout wasn't marked complete at the
audit stage: 6 files still had real architectural debt, scoped as PR B6.

## PR B6 — final production-backed schema conversions (6/6 files, complete)

- `mark-user-as-pro.test.js`
- `phase-e-usage-rollback.test.js`
- `menu-help-session-reset.test.js`
- `cancel-pending-save.test.js`
- `generation-pipeline-last-intent.test.js`
- `phase1-delivery-rollback.test.js`

All six were production-backed tests (four exercising `routes/webhook`,
two exercising `utils/usageTracker`) previously using a hand-rolled
schema plus a manual `Module._resolveFilename` + `require.cache` stub for
`../utils/database`, and in most cases a direct
`require('better-sqlite3')` that couldn't run in the sandbox at all
(`invalid ELF header`).

Conversion pattern, applied identically to each file, matching PR B1–B2.2:

1. Remove the hand-rolled `CREATE TABLE` schema and the direct
   `require('better-sqlite3')`.
2. Require `tests/helpers/createTestDb.js` first (before any
   service/repository module) and use its `db` instead.
3. Remove the database half of the manual `Module._resolveFilename`
   override; keep any stubs for other modules (`whatsappService`,
   `aiService`, `usageTracker`) as-is, since `createTestDb()` only shims
   `better-sqlite3`, not application services.
4. Add `testDb.cleanup()` on both the success and error exit paths.
5. Run each file three times to confirm stability, then spot-check
   against every previously-converted file in the batch for regressions.

No schema-drift findings turned up in this batch — all six hand-rolled
schemas already matched the real migrated schema's constraints. Two
smaller cleanups: `phase-e-usage-rollback.test.js`'s local
`hashPhoneForTest()` duplicate was dropped in favor of the real exported
`hashPhone()` from `utils/usageTracker` (same for
`generation-pipeline-last-intent.test.js` and
`phase1-delivery-rollback.test.js`), now that the real module is loaded
end to end.

**Verification:** each file passed individually (13, 5, 19, 13, 12, and 7
assertions respectively) and stably across 3 repeat runs. Running all six
converted files together as a final sweep: **69/69 assertions pass, zero
regressions.**

## Repository state

After PR B6, the only test files still directly requiring
`better-sqlite3` or `node:sqlite`'s `DatabaseSync` are ones that already
call the real `runMigrations()` chain rather than hand-rolling a schema
(`learnerIdentityService.test.js`,
`migration-036-learner-intervention-writer.test.js`,
`tests/adr003-learners-migration.test.js`). These are not schema-drift
risks — any future migration automatically appears in them the same way
it does in every `createTestDb()`-converted file — so they are
intentionally out of scope for this initiative rather than remaining
debt.

**The production-backed hand-rolled-schema migration initiative is
complete.** No test file exercising real production code (`routes/webhook`,
`utils/usageTracker`, or any service/repository) does so against a
hand-rolled, non-migrated schema.

## Audit trail note

Detailed implementation history for PRs B2.3 through B5 is preserved in
the repository commit history rather than reproduced here. This document
records the verified end state — the post-B5 audit and PR B6 — rather
than reconstructing intermediate implementation notes (file lists,
assertion counts, individual findings) for batches that predate this
update.

**Original PR C plan (implemented above, kept for reference):**

Keep production behavior unchanged (still never throws to its caller),
but distinguish missing-table failures from genuinely unexpected ones,
and rethrow unexpected errors when `NODE_ENV === 'test'` so a real bug
can't hide behind this same catch block again:

```js
} catch (err) {
  const isMissingTable = err.code === 'SQLITE_ERROR' && /no such table/i.test(err.message);
  if (isMissingTable) {
    console.error('[TSE] tagEvidence: schema not ready (missing table), skipping:', err.message);
  } else {
    console.error('[TSE] tagEvidence failed (non-fatal):', err.message);
    if (process.env.NODE_ENV === 'test') throw err;
  }
  return false;
}
```
