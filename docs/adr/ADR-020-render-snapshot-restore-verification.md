# ADR-020: Controlled Render Persistent-Disk Snapshot Restore Verification

**Status:** Proposed
**Depends On:** —
**Related:** RC1-MILESTONE.md ("Restore-from-backup tested at least once")

## Context

RC1-MILESTONE.md contains two distinct Infrastructure criteria:

- `[x] Database backups tested` — closed (commit `6b797b0`), verified via
  direct read-only inspection of the Render production control plane:
  the `data` disk mounted at `/var/data` has automatic daily snapshots
  enabled and actively executing (7 consecutive dated snapshots,
  Aug 14-20 2026, each with an available Restore action; Render states
  a 24-hour cadence and 7-day retention).
- `[ ] Restore-from-backup tested at least once` — still open, and
  references "ADR-020" as its governing procedure.

Investigation (2026-08-20) confirmed no ADR-020 exists anywhere in the
repository, working tree, or git history (`git log --oneline --all --
'docs/adr/ADR-020*'` and a filesystem search both returned empty). No
alternative document anywhere in `docs/project/` or `docs/adr/`
establishes a restore procedure - all "snapshot"/"restore" hits found
elsewhere refer to the unrelated Class Snapshot application feature
(ADR-014).

This means the restore criterion currently has no safe, approved
procedure to follow. Render's own UI warns that restoring a disk
discards all changes made after the selected snapshot. This is a
destructive operation against whichever disk it targets because
changes made after the selected snapshot are discarded. Improvising
the procedure in the moment, without a reviewed plan, is the exact
risk this ADR exists to prevent.

## Decision

Establish a controlled, one-time restore-verification procedure that
proves a Render snapshot produces a usable SQLite database, **without
ever restoring over the live production disk**.

### 1. Purpose
Demonstrate that a snapshot taken by Render's automatic daily
disk-snapshot mechanism can be restored and read back as a structurally
and materially intact SQLite database - closing the gap between
"backups are being generated" (already proven) and "a backup is usable"
(not yet proven).

### 2. Safety boundary
The production disk (`data`, mounted at `/var/data` on service
`srv-d8js9q57vvec73e2teg0`) **must never be the restore target** for
this verification, under any circumstance - no exception for
testing, no "we'll snapshot first," no maintenance-window carve-out.
Render's Restore action for that disk must not be invoked as part of
this ADR's procedure.

**Precondition (procedural gate):** before any Restore action is
invoked, the operator must positively identify the restore target as
non-production and record its service/disk identity in the evidence.
If there is any ambiguity about which disk a Restore action would
affect, stop and do not proceed. The most dangerous failure mode here
is not SQLite corruption - it is restoring the correct snapshot onto
the wrong disk.

If Render's platform offers no non-destructive snapshot-restore path
(i.e., restore can only be performed onto the originating disk), **stop
the procedure.** Do not substitute a manual copy of the live database,
`restore-test.db`, or any other file for a snapshot restore. Such a
copy may be useful for separate database-integrity testing, but it does
not satisfy this ADR or the RC1 restore criterion, and must not be
represented as having done so.

### 3. Selected snapshot
Select one existing snapshot with a clearly recorded timestamp. Prefer
a recent snapshot that predates the test execution by at least several
hours (not necessarily exactly 24 - actual cadence/timing may vary) and
remains within Render's retention window. Record the exact displayed
timestamp used (e.g. "August 20, 2026 at 2:27 AM") in the resulting
evidence - do not select "whichever is most recent" implicitly at
write time.

### 4. Restore target
A separate, throwaway Render disk/service created solely for this
test, disconnected from the production service, and deleted afterward.
This must be explicitly named in the evidence, with confirmation it is
not the production service (per the §2 precondition). If no such
non-destructive path exists on the current Render plan, this ADR is
not satisfied and the criterion stays open - see §2's stop condition
and Alternatives Considered.

### 5. Pre-restore evidence
Capture production row counts for `teachers` and `learners`
immediately before the restore test begins, and record the selected
snapshot's timestamp. No personal data (e.g. phone numbers) is
recorded as part of this baseline - counts and structural
fingerprints only. Also record the same schema baseline already
established for the Database Migration criterion: 29 application
tables + `sqlite_sequence`, 56 total indexes (47 explicit + 9 SQLite
autoindexes).

### 6. Post-restore validation
All of the following must pass against the restored database, not
merely be asserted:
- Database file opens successfully via `better-sqlite3`
  (`{readonly: true}` - never open a restored/unknown-provenance file
  read-write during verification).
- `PRAGMA integrity_check` -> `ok`.
- `PRAGMA quick_check` -> `ok`.
- `PRAGMA foreign_key_check` -> zero rows.
- All 29 expected application tables + `sqlite_sequence` present,
  matching by name.
- Index count reconciles the same way as the production migration
  evidence (explicit + autoindex split), not just a raw total.
- `teachers` and `learners` row counts are compared with the §5
  production baseline. Any discrepancy must be explained by
  documented writes occurring after the selected snapshot timestamp
  and before baseline capture; unexplained discrepancies are a
  validation failure.
- The application itself is not required to run against the restored
  database for this ADR to be satisfied - schema/data-level SQLite
  validation is sufficient. An application-level smoke test is out of
  scope here and belongs to the separate "Deployment smoke test"
  criterion, not this one.

### 7. Evidence requirements
The resulting RC1-MILESTONE.md evidence text must include: the exact
snapshot timestamp used, the restore target (and explicit confirmation
it was not production), the commands run, and the pass/fail result of
each check in §6 - following the same direct-command-output evidence
style already used for the migration and backup criteria in this
session.

### 8. Failure handling
If any check in §6 fails, the criterion stays `[ ]` and the failure is
documented as a genuine finding (not silently retried until it passes,
and not soft-pedaled). A failed restore-verification is itself valuable
information about the backup mechanism's reliability and should be
escalated, not hidden.

### 9. Production protection
Explicitly prohibited, without exception, as part of this ADR's
procedure:
- Invoking Render's Restore action on the production `data` disk.
- Any write operation against `/var/data/teacher_assistant.db` on the
  live production service.
- Deleting or modifying any existing snapshot.

### 10. RC1 completion threshold
`[ ] Restore-from-backup tested at least once` may be changed to `[x]`
only when all of the following are true, with evidence text citing
each:
- A specific snapshot (named by timestamp) was restored to a
  confirmed non-production target.
- All checks in §6 passed.
- The evidence explicitly distinguishes this from the already-closed
  "Database backups tested" criterion, per the same discipline used for
  that commit.

## Consequences

- Restoring to a throwaway environment costs Render resources
  (a temporary disk/service) and manual cleanup afterward.
- If Render's platform truly has no non-destructive restore path, this
  criterion may remain permanently open (or require a revised ADR)
  rather than being closed via a workaround - that would itself be a
  legitimate, documented finding.
- This procedure deliberately does not prove recovery-point objectives
  (RPO), recovery-time objectives (RTO), or complete disaster-recovery
  readiness. It proves only that at least one Render snapshot can be
  restored and that the resulting SQLite database passes the defined
  structural and data validation checks. The `[x]` checkbox must not be
  read as "disaster recovery is fully tested."
- This ADR does not cover repeatable disaster-recovery drills - only a
  one-time technical verification, matching the RC1 criterion's literal
  wording ("tested at least once").

## Alternatives Considered

- **Restore directly onto the production disk and treat the live
  redeploy as validation.** Rejected - directly contradicts Render's
  own warning about discarding post-snapshot changes, and conflates a
  destructive production action with a verification exercise.
- **Treat "Restore button exists in the UI" as sufficient evidence.**
  Rejected earlier in this session, explicitly, by both parties - an
  available action is not evidence the action produces a valid result.
- **Skip restore verification entirely and rely on `PRAGMA
  integrity_check` on the live production DB as a proxy.** Rejected -
  proves the *current* live file is intact, not that a *snapshot* of
  it can be successfully restored and read back; these are different
  claims.
- **Substitute a manual file copy (`scp`/`restore-test.db`) for a
  snapshot restore.** Rejected - this validates the live file's current
  integrity, not the snapshot/restore mechanism itself; conflating the
  two would let this criterion be closed without ever exercising
  Render's actual backup-restore path.
