# ADR-021: Application-Level SQLite Backup and Isolated Restore Verification

**Status:** Proposed (design only — not implemented)
**Depends On:** —
**Related:** ADR-020 (Render snapshot restore verification), RC1-MILESTONE.md (`Restore-from-backup tested at least once`)

## Relationship to ADR-020 (read this first)

ADR-020 remains the governing procedure for the RC1 criterion `Restore-from-backup tested at least once`, as originally scoped: it tests whether a **Render automatic disk snapshot** can be restored to a non-production target and validated. That investigation found no documented Render mechanism to restore a persistent-disk snapshot onto anything other than its originating disk, so ADR-020's stop condition applies and that criterion remains open by design.

This ADR does **not** close that criterion, does not amend ADR-020, and does not modify `RC1-MILESTONE.md`. It defines a **separate** capability: an application-level SQLite backup that the application itself produces, stores externally, and can restore into an isolated environment for validation — independent of whatever Render's disk-snapshot mechanism can or cannot do.

If the project later wants an application-level backup/restore test to count toward RC1 (either replacing or supplementing the Render-snapshot criterion), that requires an explicit, separate decision — a milestone edit and/or an ADR amendment — made deliberately, not an implicit substitution introduced by this document or its implementation.

**Binding implementation constraint:** no phase of this ADR's implementation may modify `ADR-020-render-snapshot-restore-verification.md` or `RC1-MILESTONE.md` in any way unless a separate, explicit decision authorizes it. This applies even to phases that produce positive restore-drill evidence. Positive evidence for *this* mechanism is not itself authorization to edit either document.

This ADR is a design proposal only. No code is implemented, no production system is touched, no Render configuration changes, and no automatic backup job runs as part of this ADR.

---

## Context

### Existing repository state

The following repository state was inspected before drafting this ADR:

* `docs/adr/ADR-INDEX.md` lists ADRs 001–018 and ADR-020. No prior ADR addresses database backup, export, or restore at the application level. ADR-020 is the only existing ADR touching backup/restore, and it is specifically scoped to Render's disk-snapshot mechanism.
* `DEPLOYMENT.md` documents the current backup story as: `"Backup: Render persistent disks have automatic daily snapshots."` No application-level export is currently documented.
* `render.yaml` confirms the production topology: a single Node web service, a persistent disk named `data` (1GB) mounted at `/var/data`, and `DB_PATH=/var/data/teacher_assistant.db`. No object storage or secondary storage service is currently configured.
* `package.json` specifies `better-sqlite3: ^9.4.5`, with installed version `9.6.0`. No backup-specific dependency or cloud-storage SDK currently exists.
* `utils/database.js` is the single source of database connection setup. It exposes a module-level singleton through `getDb()`, uses WAL mode, `synchronous = NORMAL`, and `foreign_keys = ON`, and reads `DB_PATH` from the environment. In production, the process exits if `DB_PATH` is unset.
* The existing scheduler convention in `server.js` consists of direct `setInterval` calls. Existing scheduled jobs wrap their work in `try/catch` and report failures through Sentry using `Sentry.captureException(err, { tags: { component: '...' } })`. No job-queue library is currently used.
* Existing environment secrets are read through `process.env.X`, declared in `render.yaml` with `sync: false`, and documented in `.env.example`. New backup credentials must follow the same convention.
* No S3, GCS, Backblaze, Cloudflare R2, rsync, or other external storage integration exists today. This is a genuinely new infrastructure capability.

### Why this capability is needed independently of ADR-020

ADR-020 investigated whether Render's snapshot mechanism provides a practical, non-destructive restore path. The documented mechanism did not provide a way to restore a snapshot onto an isolated target.

Therefore, the project currently has no **tested, independently restorable** database backup mechanism.

An application-level backup provides a recovery artifact that:

1. is produced by the application;
2. is stored outside the production disk;
3. can be downloaded independently;
4. can be restored into an isolated environment; and
5. can be validated with deterministic evidence.

This capability is therefore useful regardless of whether the RC1 milestone eventually accepts it as evidence.

---

# Decision

## 1. Scope

The project will design an application-level SQLite backup mechanism by which the application can:

1. Produce a consistent, point-in-time SQLite backup artifact from the live production database without corrupting the database or intentionally blocking normal application traffic.
2. Store that artifact in durable external storage separate from the Render persistent disk.
3. Restore the artifact into an isolated environment without opening or modifying the production database.
4. Validate the restored artifact using structural, data-level, and cryptographic checks.
5. Produce auditable evidence for the backup and restore operation.

Nothing in this ADR authorizes automatic scheduling, production deployment, Render configuration changes, or changes to RC1/ADR-020.

---

## 2. Backup mechanism

The proposed backup mechanism is **`better-sqlite3`'s `.backup()` API**, using SQLite's Online Backup API.

This is preferred over raw file copying or shelling out to the SQLite CLI.

### Rationale

* `better-sqlite3` is already a direct project dependency.
* The installed version is currently `9.6.0`.
* The Online Backup API is specifically intended to produce a consistent database backup while the source database remains available.
* It avoids copying the main WAL-mode database file independently from its WAL state.
* It avoids requiring the `sqlite3` command-line binary to be present in the Render runtime.
* It avoids introducing a new database or cloud dependency merely to create the SQLite artifact.
* The backup source can use the existing application database connection returned by `getDb()`.

### Mandatory implementation prerequisite

Before Phase 2 implementation begins, the exact `.backup()` API signature, return/completion behavior, error behavior, and relevant options for the **installed `better-sqlite3` 9.6.0 version** must be verified against that version's documentation and/or installed package source.

The implementation must not assume that behavior from another `better-sqlite3` release is identical.

---

## 3. Backup artifact naming and metadata

Each backup run produces:

1. one SQLite database artifact; and
2. one companion metadata manifest.

The filename format is:

```text
teacher_assistant-<ISO8601-UTC-timestamp>.db
```

For example:

```text
teacher_assistant-2026-08-20T03-00-00Z.db
```

The companion manifest uses the same timestamp:

```text
teacher_assistant-2026-08-20T03-00-00Z.json
```

The manifest must contain, at minimum:

```json
{
  "artifact": "teacher_assistant-2026-08-20T03-00-00Z.db",
  "created_at": "2026-08-20T03:00:00Z",
  "size_bytes": 385123,
  "sha256": "<digest>",
  "teachers_count": 0,
  "learners_count": 0,
  "schema_version": "<authoritative migration value>",
  "validation": {
    "integrity_check": "ok",
    "quick_check": "ok",
    "foreign_key_check": "ok"
  }
}
```

### Metadata requirements

`size_bytes` is the authoritative local artifact size recorded at backup creation and is used for remote-size verification.

`sha256` is the SHA-256 digest calculated from the completed backup artifact.

`teachers_count` and `learners_count` are counts taken from the completed backup artifact itself.

`schema_version` must use the repository's authoritative migration state. The implementation must not invent a separate backup-only schema version.

If the repository does not expose a formal schema-version table or `PRAGMA user_version`, the implementation must derive the value from the migration system's authoritative highest-applied migration number rather than creating a second source of truth.

The manifest must contain **no PII**.

The manifest may contain structural metadata, counts, timestamps, checksums, schema information, and validation results, but must not contain teacher phone numbers, names, encrypted values, learner names, or other record-level personal information.

No incremental or differential backups are part of this ADR.

---

## 4. External storage

Backup artifacts must ultimately be stored in **external object storage**, not on the same Render persistent disk as the production database.

The specific provider is intentionally not selected by this ADR.

Potential providers include S3-compatible services such as:

* AWS S3
* Backblaze B2
* Cloudflare R2
* another provider meeting the interface and security requirements below

The provider selection is a separate architectural decision because it introduces:

* account setup;
* credentials;
* cost;
* retention configuration;
* provider-specific operational responsibility.

### Provider-neutral interface

The application-side storage layer must expose a minimal provider-neutral interface:

```text
upload(artifactPath, objectKey, checksum) -> { success, objectKey }
download(objectKey, destinationPath) -> { success, path }
delete(objectKey) -> { success }
list(prefix) -> { keys: [...] }
```

The selected provider must support:

* durable external storage;
* private/non-public objects;
* authenticated access;
* TLS in transit;
* encryption at rest where supported;
* upload;
* download;
* deletion;
* object listing;
* sufficient metadata to verify object existence and size;
* a trustworthy mechanism for checksum verification, either directly or through independent download/recalculation.

### No-overwrite rule

A backup upload must never overwrite an existing backup object.

If the destination object key already exists, the upload must fail.

A successful upload must therefore create a new immutable backup artifact rather than silently replacing an existing artifact.

---

## 5. Concurrency and SQLite consistency

The backup source must be the existing database connection returned by `getDb()`.

The implementation must **not** create a second production database connection solely for backup purposes unless a later architecture review explicitly establishes a need.

This is an application-level safety and consistency rule for this repository.

### Single-flight guard

Only one backup operation may run at a time **within a single application process/instance**.

If a second invocation occurs while another backup is active:

* it must not start another backup;
* it must produce an explicit operational log;
* it must return a defined skipped/no-op result or equivalent operational status.

The current deployment topology is a single backup-capable application instance.

Cross-instance distributed locking is explicitly **out of scope** for this ADR.

If the deployment topology later changes to multiple concurrent backup-capable instances, distributed locking must be addressed through a separate design decision.

### Atomic local artifact handling

The backup must never write directly to its final artifact filename.

The implementation must:

1. Generate a unique temporary path.
2. Run `db.backup()` to that temporary path.
3. Validate the completed temporary database.
4. Calculate its SHA-256 digest.
5. Calculate its size.
6. Capture artifact-native row counts.
7. Generate the metadata manifest.
8. Atomically rename the temporary database to its final local artifact name only after the preceding steps succeed.
9. Upload the final artifact and manifest.
10. Verify the remote artifact.
11. Delete local production-data-equivalent artifacts only after successful remote verification.

A failed or interrupted backup must delete its incomplete temporary artifact.

An incomplete temporary artifact must never be uploaded or treated as a valid backup.

---

## 6. Encryption, credentials, and backup-data handling

The backup contains the same application data as the production database.

Existing column-level encryption remains unchanged. The backup does not perform an additional application-level encryption pass over the SQLite file during the initial implementation.

However, the `.db` artifact must be treated as **production-data equivalent**.

### Storage security requirements

The selected storage provider must provide:

* private objects;
* authenticated access;
* TLS for data transfer;
* encryption at rest where available;
* credentials with the minimum permissions necessary.

Application-level whole-file encryption is not required by this ADR's first implementation phase because it would introduce additional encryption-key management before the basic backup/restore mechanism has been proven.

That decision may be revisited later if the threat model or selected provider requires it.

### Credentials

Any storage credentials must:

* be read through `process.env`;
* be declared in `render.yaml` with `sync: false`;
* be documented in `.env.example`;
* never be committed to Git;
* never be hard-coded;
* never appear in logs.

### Backup artifact handling

Backup artifacts must:

* never be committed to Git;
* never be stored inside the repository;
* never be included in deployment artifacts;
* never be intentionally retained on developer machines after restore testing;
* be deleted from local/staging storage after confirmed successful upload unless explicitly required for an active restore test;
* be deleted after an isolated restore test completes.

A `.gitignore` entry alone is not considered sufficient protection because an untracked production-data copy can still represent a security exposure.

---

## 7. Retention

The initial proposed retention policy is:

**7 daily backups.**

This is configurable and is not a permanent architectural requirement.

The retention policy must be controlled through an environment variable such as:

```text
BACKUP_RETENTION_DAYS=7
```

The value must not be hard-coded into application logic.

### Pruning rules

Retention pruning must:

1. enumerate existing backup objects;
2. identify objects outside the retention window;
3. log the objects selected for deletion;
4. delete only artifacts confirmed to be outside the retention policy;
5. never delete the newest valid backup merely because a new backup attempt failed.

Most importantly:

**Pruning must not occur before the new backup has been successfully created, validated, uploaded, and remotely verified.**

A failed backup must therefore never cause the system to reduce the number of known-good recovery artifacts.

---

## 8. Restore isolation

The restore process must never write to the production database.

The configured production path is:

```text
/var/data/teacher_assistant.db
```

The restore process must instead use a throwaway destination outside the production database path.

### Enforced production-path protection

Isolation must be enforced by the restore-validation tooling rather than relying solely on operator discipline.

Before creating/opening the restore target, the tooling must:

1. resolve the configured production `DB_PATH` to a canonical absolute path;
2. resolve the requested restore target to a canonical absolute path where possible;
3. compare the two canonical paths;
4. reject the operation if they refer to the same location;
5. reject path-equivalent or symlink-based attempts to target the production database.

The validation tooling must fail closed if it cannot safely establish that the restore target is distinct from production.

### Read-only validation

The restored database must be opened using:

```javascript
new Database(path, { readonly: true })
```

All validation operations must use the read-only connection.

The restore validation process must never open the production database for writing.

The preferred restore target is a temporary/throwaway path created specifically for the restore drill.

---

## 9. Validation and evidence

The validation procedure consists of several independent gates.

### 9.1 File-level validation

Before the restored SQLite database is opened:

1. confirm the downloaded file exists;
2. confirm its size;
3. calculate SHA-256;
4. compare the calculated digest with the manifest digest.

A checksum mismatch is an immediate validation failure.

No SQLite validation should occur against a file that has failed checksum verification.

### 9.2 SQLite structural validation

After checksum verification succeeds, open the restored database read-only and verify:

* database opens successfully;
* `PRAGMA integrity_check` returns `ok`;
* `PRAGMA quick_check` returns `ok`;
* `PRAGMA foreign_key_check` returns zero rows;
* all expected application tables are present.

### 9.3 Schema validation

The restored database schema must be reconciled against the repository's expected schema baseline.

The validation must not invent a new schema baseline solely for backups.

Where the migration system provides an authoritative migration number, the restore evidence must record that value.

### 9.4 Artifact-native row-count evidence

The backup's `teachers` and `learners` counts must be captured **from the completed backup artifact itself**.

They must not be captured from production before the backup starts.

They must not be compared with live production after the backup completes.

The manifest therefore records the snapshot's own:

```text
teachers_count
learners_count
```

During restore validation, the downloaded/restored database must produce exactly the same values.

A mismatch is a restore-fidelity failure.

These counts are evidence that the restore reproduces the backup snapshot. They are **not** evidence that the snapshot represents the current state of production.

### 9.5 Checksum chain

The backup process establishes:

```text
Production DB
    ↓
SQLite Online Backup
    ↓
Validated local artifact
    ↓
SHA-256 + size
    ↓
External object
    ↓
Downloaded artifact
    ↓
SHA-256 + size verification
    ↓
Read-only SQLite validation
```

The SHA-256 digest must be identical across the artifact creation and restore stages.

### 9.6 Upload success criteria

An upload is successful only when all of the following are true:

1. the storage provider reports successful upload;
2. the remote object can be confirmed to exist;
3. the remote object size equals the manifest's `size_bytes`;
4. the remote object's SHA-256 is independently verified against the manifest digest.

If the provider exposes a trustworthy provider-generated checksum, it may be used.

A checksum merely echoed from client-supplied metadata is not sufficient.

If the provider cannot independently expose a trustworthy checksum, the implementation must:

1. download the uploaded object;
2. calculate its SHA-256 locally;
3. compare it with the original digest;
4. treat the upload as successful only if they match.

Because the current database is small, this independent verification is acceptable.

### 9.7 Evidence record

Each restore drill must record:

* backup artifact name;
* UTC creation timestamp;
* artifact size;
* original SHA-256;
* remote verification result;
* downloaded SHA-256;
* restore target path;
* confirmation that the target differs from production;
* schema/migration version;
* `teachers_count`;
* `learners_count`;
* integrity-check result;
* quick-check result;
* foreign-key-check result;
* expected-table check result;
* commands/scripts used;
* overall pass/fail result.

The evidence must live in a document specific to this capability.

It must **not** be added to `RC1-MILESTONE.md` unless a separate decision explicitly authorizes that change.

---

## 10. Failure handling

Any failed backup operation must:

* log the failure;
* report the exception to Sentry;
* use a distinct component tag such as:

```text
component: db-backup
```

This follows the existing scheduler error-reporting convention.

### Backup failure

If backup creation, validation, checksum calculation, upload, remote verification, or manifest creation fails:

* the run is considered failed;
* the failure must be visible in logs/monitoring;
* incomplete local artifacts must be cleaned up;
* the failed artifact must not be treated as a valid recovery point;
* retention pruning must not delete a known-good backup to compensate for the failure.

### Restore-validation failure

A failed restore drill must remain visible as a failed restore drill.

The system must not silently retry until the result becomes green.

A failed drill is operational evidence and must be investigated.

---

## 11. Manual versus automatic execution

No automatic backup scheduler is authorized by this ADR.

Phases 1–5 are manual.

A future implementation may expose a command such as:

```text
node scripts/backupDb.js
```

but the exact script name is an implementation detail and is not fixed by this ADR.

Automatic scheduling is deferred to Phase 6.

If scheduling is eventually implemented, it must follow the existing `server.js` `setInterval` convention rather than introducing a job-queue dependency without a separate architecture decision.

---

# 12. Alternatives considered

## Render disk snapshots only

**Status:** Existing mechanism; insufficient for tested recovery.

ADR-020 established that the project does not currently have a documented non-destructive method to restore a Render persistent-disk snapshot onto an isolated target.

Render snapshots therefore remain useful as an infrastructure-level protection mechanism, but they do not provide the independently demonstrated restore capability this ADR seeks.

This ADR does not claim Render snapshots are unreliable. It only recognizes that their restoration cannot currently be demonstrated under the documented mechanism investigated by ADR-020.

## Direct file copy

Examples:

```text
cp teacher_assistant.db backup.db
scp teacher_assistant.db backup.db
```

**Status:** Rejected.

The database uses WAL mode. Copying the main SQLite file independently of the associated WAL state can produce an inconsistent backup.

A raw filesystem copy is therefore not an acceptable production backup mechanism for this database.

## SQLite CLI `.backup`

**Status:** Rejected in favor of the in-process API.

The CLI would provide a viable SQLite backup mechanism, but:

* the `sqlite3` binary is not currently guaranteed by the application's runtime assumptions;
* it introduces process spawning;
* it introduces command/path handling;
* it provides no meaningful advantage over the already-installed `better-sqlite3` API.

## `better-sqlite3` `.backup()`

**Status:** Selected.

It is already available in the application dependency tree and provides direct access to SQLite's Online Backup API without requiring a separate CLI process.

## Same-disk backup storage

Example:

```text
/var/data/backups/
```

**Status:** Rejected as retained storage.

A failure or loss of the Render persistent disk would affect both the production database and same-disk backups.

A temporary local staging file is unavoidable during artifact creation, but that staging copy must be removed after successful external verification.

## External object storage

**Status:** Selected as the retained-storage architecture.

External storage provides the required failure-domain separation between:

```text
Production database → Render persistent disk
Backup artifact → External object storage
```

The specific provider remains a separate decision.

---

# 13. Consequences

## Positive consequences

* The project obtains an application-controlled database backup mechanism.
* The backup is independent of Render's persistent-disk restore limitations.
* Backup artifacts can be independently downloaded.
* Restore can be performed against an isolated target.
* SHA-256 verification provides cryptographic identity across the backup/restore path.
* SQLite integrity checks provide structural validation.
* Artifact-native row counts provide deterministic restore-fidelity evidence.
* The mechanism does not require a new database engine or backup-specific database connection.
* The mechanism can initially be implemented and tested manually before automation is introduced.
* The project gains an independently testable recovery path.

## Negative consequences

### Operational complexity

The project gains a new subsystem covering:

* backup generation;
* metadata generation;
* external storage;
* checksum verification;
* retention;
* restore tooling;
* restore drills;
* monitoring.

### Storage costs

External object storage introduces a new operational cost.

The current database is small, so initial storage requirements are expected to be low, but the database and therefore backup size may grow.

### Security responsibilities

Backup files are production-data equivalents.

The project therefore becomes responsible for:

* storage credentials;
* storage permissions;
* credential rotation;
* backup artifact access control;
* artifact deletion;
* storage-provider security configuration.

### Maintenance

A backup mechanism that is never tested again can silently fail.

The project therefore needs a defined restore-drill cadence after initial deployment.

### Important limitation

This ADR does **not** automatically satisfy or close the RC1 restore criterion.

It creates a separate backup/restore capability.

Whether that capability is accepted as RC1 evidence requires a later explicit decision.

---

# 14. Implementation phases

## Phase 1 — Design and approval

**Status:** Design only.

Acceptance criteria:

* ADR-021 is reviewed.
* The design is accepted, rejected, or returned for revision.
* No production code or infrastructure is changed merely by accepting this document.

## Phase 2 — Backup artifact generation

Before implementation:

* verify the installed `better-sqlite3` 9.6.0 `.backup()` API signature;
* verify its completion semantics;
* verify its error behavior;
* verify destination-file behavior;
* confirm implementation assumptions against the installed package/documentation.

Implementation:

* create a standalone manually invoked backup mechanism;
* use `getDb()` as the source;
* use `.backup()` rather than filesystem copying;
* write only to a unique temporary location;
* validate the temporary database;
* calculate SHA-256;
* calculate size;
* calculate artifact-native row counts;
* create the manifest;
* rename to the final artifact only after successful validation.

Acceptance:

* a non-production database can be backed up;
* the resulting artifact opens read-only;
* `PRAGMA integrity_check` returns `ok`;
* `PRAGMA quick_check` returns `ok`;
* foreign-key validation succeeds;
* artifact checksum and metadata are generated successfully.

No external storage is required in this phase.

## Phase 3 — External storage

Select an approved provider through a separate implementation decision.

Implement:

* private bucket/container;
* authentication;
* upload;
* download;
* list;
* delete;
* no-overwrite behavior;
* remote size verification;
* checksum verification.

Acceptance:

* a backup artifact uploads successfully;
* the remote object exists;
* remote size matches the local artifact;
* remote checksum is independently verified;
* the artifact can be downloaded;
* the downloaded checksum matches the original;
* local production-data-equivalent copies are removed after successful verification.

## Phase 4 — Validation

Implement a reusable restore-validation module.

It must perform, in order:

1. file existence;
2. file-size check;
3. SHA-256 verification;
4. production-path safety verification;
5. read-only SQLite open;
6. integrity check;
7. quick check;
8. foreign-key check;
9. expected-table check;
10. schema/migration validation;
11. artifact-native row-count comparison.

### Mandatory negative test

Take a known-good backup.

Create a copy.

Modify one or more bytes.

Run the restore-validation process against the corrupted copy.

Acceptance requires proof that:

1. the checksum comparison fails;
2. the failure occurs before SQLite structural checks;
3. the corrupted file is therefore rejected before `integrity_check` or `quick_check` is executed.

This test is mandatory.

## Phase 5 — Isolated restore test

Perform a complete end-to-end drill:

```text
Production
    ↓
SQLite backup
    ↓
External object storage
    ↓
Download
    ↓
Isolated restore target
    ↓
Checksum verification
    ↓
Read-only SQLite validation
    ↓
Evidence
```

The restore target must never be `/var/data/teacher_assistant.db`.

Acceptance requires:

* production-derived backup artifact;
* successful external upload;
* successful independent download;
* matching checksum;
* matching artifact-native row counts;
* successful integrity check;
* successful quick check;
* zero foreign-key violations;
* expected schema/tables present;
* evidence document completed;
* explicit evidence that the production `DB_PATH` was never used as the restore target and was not modified during validation.

This phase does **not** authorize changes to ADR-020 or `RC1-MILESTONE.md`.

## Phase 6 — Optional automatic scheduling

Only after Phase 5 evidence has been reviewed may automatic scheduling be considered.

Implementation should:

* follow the existing `server.js` `setInterval` pattern;
* use the existing Sentry error-reporting convention;
* use the single-flight guard;
* perform backup creation before pruning;
* apply configurable retention;
* log every successful and failed cycle.

Acceptance:

* at least 3 consecutive scheduled cycles complete successfully;
* evidence exists for each cycle;
* retention behavior is verified;
* failures are surfaced through Sentry.

## Phase 7 — Operational monitoring

Define:

* backup-failure alerting;
* retention monitoring;
* storage-access monitoring;
* restore-drill cadence;
* ownership/responsibility;
* incident procedure for a failed backup;
* incident procedure for a failed restore drill.

Acceptance:

* a re-drill cadence is documented;
* at least one post-go-live restore drill has passed.

---

# 15. Unresolved architectural decisions

The following items remain deliberately unresolved by ADR-021 and must be decided before the corresponding implementation phase.

## 15.1 Storage provider

The project must select an external object-storage provider.

Required characteristics:

* private objects;
* authenticated access;
* TLS;
* encryption at rest;
* upload/download/delete/list support;
* suitable checksum verification;
* reasonable cost;
* appropriate South African/international data-handling considerations.

The provider decision must not be hidden inside the implementation.

## 15.2 Restore execution environment

The project must decide where the isolated restore drill will execute.

Candidates include:

* local controlled development environment;
* CI environment;
* separate throwaway Render service;
* another isolated server/container.

The selected environment must preserve the production-path safety invariant.

## 15.3 Retention period

The initial proposal is:

```text
7 days
```

but this remains configurable and subject to operational review.

## 15.4 Backup schedule

No automatic schedule is selected by this ADR.

If Phase 6 proceeds, the project must explicitly choose a schedule, with daily backup being the initial expected direction.

## 15.5 Whole-artifact encryption

Initial implementation relies on:

* provider encryption at rest;
* TLS in transit;
* existing application-level column encryption;
* strict object access control.

Whole-database application-level encryption remains deferred unless a later security review determines it is necessary.

## 15.6 Restore-drill cadence

A post-go-live restore-drill frequency must be established before the backup mechanism is considered operationally mature.

## 15.7 RC1 treatment

The project must explicitly decide whether a successful ADR-021 restore drill:

1. remains independent from RC1;
2. supplements the existing Render snapshot criterion; or
3. replaces the Render snapshot criterion.

That decision must be recorded separately.

ADR-021 itself does not make that decision.

---

# 16. Security invariants

The following requirements are mandatory and must not be weakened during implementation without an explicit ADR amendment or separate security decision:

1. The production database must never be used as a restore target.
2. Restore tooling must actively reject production-path equivalence.
3. Backup artifacts must not be committed to Git.
4. Backup artifacts must not be bundled into deployment artifacts.
5. Backup credentials must not be committed or hard-coded.
6. Backup objects must be private.
7. Backup uploads must not overwrite existing backup objects.
8. Incomplete backup artifacts must not be uploaded.
9. Local backup artifacts must not be deleted until external upload verification succeeds.
10. A checksum mismatch must fail before SQLite validation.
11. Restore validation must use a read-only SQLite connection.
12. Failed restore validation must be surfaced rather than silently retried.
13. Retention pruning must never occur in a way that destroys known-good recovery points after a failed backup.
14. No implementation phase may modify ADR-020 or `RC1-MILESTONE.md` without separate explicit authorization.

---

# 17. Definition of success

ADR-021's capability is considered technically proven when Phase 5 has produced evidence showing:

```text
Production database
        ↓
SQLite Online Backup API
        ↓
Validated backup artifact
        ↓
SHA-256 recorded
        ↓
External object storage
        ↓
Verified remote object
        ↓
Independent download
        ↓
Matching SHA-256
        ↓
Isolated restore target
        ↓
Production-path safety check passed
        ↓
Read-only SQLite open
        ↓
integrity_check = ok
quick_check = ok
foreign_key_check = zero rows
expected tables = present
schema/migration = expected
teachers_count = manifest value
learners_count = manifest value
        ↓
RESTORE DRILL PASSED
```

This proves that the application-level backup artifact can be created, stored externally, retrieved, restored, and validated without touching the production database.

It does **not** by itself prove that Render's disk snapshots are restorable.

It does **not** by itself close the RC1 restore criterion.

---

# 18. Consequences of not implementing ADR-021

If this capability is never implemented, the project's backup story remains limited to Render's persistent-disk snapshots.

Because ADR-020 found no documented non-destructive mechanism for restoring those snapshots onto an isolated target, the project would continue to lack a demonstrated end-to-end database recovery path.

The RC1 restore criterion would therefore remain open unless the project later:

1. obtains a documented and testable Render snapshot restore mechanism; or
2. explicitly decides that another backup/restore mechanism should satisfy the milestone.

ADR-021 provides that second path without silently changing the meaning of the existing RC1 requirement.

---

# 19. Final status

**ADR-021 remains Proposed until explicitly accepted.**

Acceptance of this ADR authorizes implementation of the design through its defined phases, subject to the unresolved architectural decisions and security invariants above.

Acceptance does **not**:

* modify ADR-020;
* modify `RC1-MILESTONE.md`;
* deploy backup code;
* configure Render;
* create storage credentials;
* create a storage bucket;
* run a production backup;
* schedule automatic backups;
* declare the RC1 restore criterion complete.

Those actions require their respective implementation and decision gates.

**End of ADR-021**
