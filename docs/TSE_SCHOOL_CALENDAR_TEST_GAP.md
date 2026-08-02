# Investigation: `[TSE] tagEvidence failed (non-fatal): no such table: school_calendar`

## Status: PR A complete (shared helper + 2 files converted). PR B/C not started.

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

## Remaining work

**PR B — incremental migration of the other ~34 files.** No behavioral
changes, infrastructure only. Priority order (per project discussion):
TSE Evidence / Assessments / Observations / Reporting / QMS first, since
those are what the upcoming Reporting Centre will build on.

**PR C — tighten `tagEvidence()` diagnostics.** Keep production behavior
unchanged (still never throws to its caller), but distinguish
missing-table failures from genuinely unexpected ones, and rethrow
unexpected errors when `NODE_ENV === 'test'` so a real bug can't hide
behind this same catch block again:

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

Do PR C after PR B is further along — rethrowing in test mode will
immediately surface remaining unconverted files' gaps loudly, which is
useful feedback but noisy until most files have already been migrated.
