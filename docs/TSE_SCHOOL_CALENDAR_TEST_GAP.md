# Investigation: `[TSE] tagEvidence failed (non-fatal): no such table: school_calendar`

## Status: PR A, PR B1 (7/7 files), and PR C complete. PR B2 in progress.

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

## Remaining work

**PR B2 — continue incremental migration of the remaining ~27 files.**
No behavioral changes, infrastructure only. Same priority order as
before: TSE Evidence / Assessments / Observations / Reporting / QMS
first, since those are what the upcoming Reporting Centre will build
on.

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
