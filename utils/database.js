'use strict';

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

// ── DB_PATH ────────────────────────────────────────────────────────────────
// REQUIRED for production: set DB_PATH to a path on a Render persistent disk.
//   DB_PATH=/var/data/teacher_assistant.db
//
// The default resolves INSIDE the container filesystem, which Render resets
// on every deploy. All teacher records and Pro subscriptions will be wiped.
// This is intentionally loud so a missing env var cannot be missed.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'teacher_assistant.db');

// Warn loudly if running without a persistent path configured.
if (!process.env.DB_PATH) {
  console.warn('[DB] ⚠️  DB_PATH is not set — database will be stored inside the container.');
  console.warn('[DB] ⚠️  On Render, this means ALL data is wiped on every deploy.');
  console.warn('[DB] ⚠️  Mount a persistent disk and set DB_PATH=/var/data/teacher_assistant.db');
  // In production we should fail fast if no persistent path is configured
  if (process.env.NODE_ENV === 'production') {
    console.error('[DB] CRITICAL: No persistent DB_PATH in production. Exiting.');
    process.exit(1);
  }
}

let _db = null;

/**
 * Returns the shared SQLite database instance (singleton).
 * Creates the database file and schema on first call.
 *
 * @returns {import('better-sqlite3').Database}
 */
function getDb() {
  if (_db) return _db;

  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');   // Concurrent reads during writes
  _db.pragma('synchronous = NORMAL'); // Safe + fast
  _db.pragma('foreign_keys = ON');

  console.log(`[DB] Connected to SQLite at ${DB_PATH}`);
  return _db;
}

/**
 * Runs schema migrations. Safe to call every startup.
 * Each ALTER TABLE is wrapped in a try/catch so re-running is a no-op.
 */
function runMigrations() {
  const db = getDb();

  // ── Base schema ────────────────────────────────────────────────
  db.exec(`
    -- ── Teachers ──────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS teachers (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash                TEXT    NOT NULL UNIQUE,
      name                      TEXT,
      grade                     TEXT,
      subject                   TEXT,
      language                  TEXT    DEFAULT 'english',
      school                    TEXT,
      is_pro                    INTEGER NOT NULL DEFAULT 0,
      pro_expires               TEXT,
      created_at                TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at                TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Usage Events ──────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS usage_events (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash   TEXT    NOT NULL,
      month_key    TEXT    NOT NULL,
      intent_type  TEXT    NOT NULL,
      tokens_used  INTEGER,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (phone_hash) REFERENCES teachers(phone_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_usage_phone_month
      ON usage_events(phone_hash, month_key);

    -- ── Subscriptions (Yoco) ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS subscriptions (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash        TEXT    NOT NULL,
      yoco_checkout_id  TEXT,
      amount_zar        REAL    NOT NULL,
      status            TEXT    NOT NULL DEFAULT 'pending',
      -- pending | complete | cancelled | failed
      created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (phone_hash) REFERENCES teachers(phone_hash)
    );

    -- ── Onboarding ────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS onboarding (
      phone_hash   TEXT    PRIMARY KEY,
      step         TEXT    NOT NULL DEFAULT 'welcome',
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (phone_hash) REFERENCES teachers(phone_hash)
    );

    -- ── Assessments ────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS assessments (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash        TEXT    NOT NULL,
      title             TEXT    NOT NULL,
      grade             INTEGER NOT NULL,
      subject           TEXT    NOT NULL,
      term              INTEGER NOT NULL,
      assessment_type   TEXT    NOT NULL,
      total_marks       INTEGER NOT NULL,
      atp_topics        TEXT,
      created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (phone_hash) REFERENCES teachers(phone_hash)
    );

    -- ── Learner Results ────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS learner_results (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      assessment_id   INTEGER NOT NULL,
      learner_name    TEXT    NOT NULL,
      mark            INTEGER NOT NULL,
      total_marks     INTEGER NOT NULL,
      percentage      REAL NOT NULL,
      question_data   TEXT,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (assessment_id) REFERENCES assessments(id)
    );

    -- ── Item Analysis ─────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS item_analysis (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      assessment_id   INTEGER NOT NULL,
      question_number INTEGER NOT NULL,
      topic           TEXT    NOT NULL,
      difficulty      REAL NOT NULL,
      success_rate    REAL NOT NULL,
      cognitive_level TEXT,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (assessment_id) REFERENCES assessments(id)
    );

    -- ── Error Analysis ─────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS error_analysis (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      assessment_id   INTEGER NOT NULL,
      error_type      TEXT    NOT NULL,
      topic           TEXT    NOT NULL,
      frequency       INTEGER NOT NULL,
      description     TEXT,
      reteach_action  TEXT,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (assessment_id) REFERENCES assessments(id)
    );

    -- ── Intervention Plans ──────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS intervention_plans (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash      TEXT    NOT NULL,
      assessment_id   INTEGER,
      problem_area    TEXT    NOT NULL,
      target_group    TEXT NOT NULL,
      goals           TEXT NOT NULL,
      duration_days   INTEGER NOT NULL,
      strategies      TEXT NOT NULL,
      resources       TEXT,
      monitoring_plan TEXT,
      success_indicators TEXT,
      status          TEXT NOT NULL DEFAULT 'active',
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (phone_hash) REFERENCES teachers(phone_hash),
      FOREIGN KEY (assessment_id) REFERENCES assessments(id)
    );

    -- ── Curriculum Coverage ────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS curriculum_coverage (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash      TEXT    NOT NULL,
      grade           INTEGER NOT NULL,
      subject         TEXT    NOT NULL,
      term            INTEGER NOT NULL,
      topic           TEXT    NOT NULL,
      covered         INTEGER NOT NULL DEFAULT 0,
      date_covered    TEXT,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (phone_hash) REFERENCES teachers(phone_hash),
      UNIQUE(phone_hash, grade, subject, term, topic)
    );

    -- ── Assessment Blueprints (ADR-005) ───────────────────────────────────
    -- Reusable, versioned, CAPS-validated question metadata, decoupled
    -- from any single assessment run. assessments.blueprint_id (added
    -- below, Migration 029) is nullable — existing and future
    -- assessments work identically with or without a blueprint. This
    -- table does not replace or duplicate assessments/learner_results/
    -- item_analysis/error_analysis/intervention_plans/
    -- curriculum_coverage; those are unchanged and are consumed exactly
    -- as they are today regardless of whether an assessment originated
    -- from a blueprint.
    CREATE TABLE IF NOT EXISTS assessment_blueprints (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash        TEXT    NOT NULL,
      title             TEXT    NOT NULL,
      subject           TEXT    NOT NULL,
      grade             INTEGER NOT NULL,
      term              INTEGER,
      total_marks       INTEGER NOT NULL,
      version           INTEGER NOT NULL DEFAULT 1,
      previous_version_id INTEGER REFERENCES assessment_blueprints(id),
      status            TEXT    NOT NULL DEFAULT 'draft',
      -- draft | published | archived
      created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (phone_hash) REFERENCES teachers(phone_hash)
    );

    -- ── Blueprint Questions (ADR-005) ──────────────────────────────────────
    -- topic is required and CAPS-validated against CAPS_TOPICS
    -- (curriculumIntelligenceService.js) at write time by the
    -- application layer — not enforced at the SQLite layer, matching
    -- how every other free-text/validated field in this schema (e.g.
    -- assessments.subject) is handled. Remaining metadata columns are
    -- nullable per ADR-005 Section 4 — Phase 1 populates only
    -- question_number, topic, and max_marks; subtopic/bloom_level/
    -- atp_reference/expected_misconception remain NULL until a later
    -- phase needs them, avoiding a second schema migration.
    CREATE TABLE IF NOT EXISTS blueprint_questions (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      blueprint_id            INTEGER NOT NULL,
      question_number         INTEGER NOT NULL,
      topic                   TEXT    NOT NULL,
      subtopic                TEXT,
      bloom_level              TEXT,
      atp_reference            TEXT,
      expected_misconception  TEXT,
      max_marks               INTEGER NOT NULL,
      created_at              TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (blueprint_id) REFERENCES assessment_blueprints(id)
        ON DELETE CASCADE
    );
  `);

  // ── Additive migrations (safe to re-run) ───────────────────────
  // Each ALTER is guarded with try/catch — SQLite returns an error if the
  // column already exists, which is fine; we just continue.

  const alterations = [
    // Migration 001: encrypted phone for WhatsApp confirmation & renewal reminders
    `ALTER TABLE teachers ADD COLUMN phone_enc TEXT`,

    // Migration 002: renewal reminder tracking (avoids duplicate reminders)
    `ALTER TABLE teachers ADD COLUMN renewal_reminder_sent_at TEXT`,

    // Migration 003: encrypted phone stored at checkout creation time
    // (redundant if teachers.phone_enc is populated, but kept as fallback)
    `ALTER TABLE subscriptions ADD COLUMN phone_enc TEXT`,

    // Migration 004: POPIA opt-out compliance (STOP command)
    `ALTER TABLE teachers ADD COLUMN opted_out INTEGER NOT NULL DEFAULT 0`,

    // Migration 005: last intent storage for RETRY command
    `ALTER TABLE teachers ADD COLUMN last_intent TEXT`,

    // Migration 017: payment_failed_reason — records WHY a webhook's
    // pro-extension UPDATE was a no-op (e.g. row not found, already
    // upgraded by a faster concurrent call). Nullable; set only when a
    // payment.succeeded event does not result in an extension, so every
    // webhook is traceable rather than silently doing nothing.
    `ALTER TABLE subscriptions ADD COLUMN payment_failed_reason TEXT`,

    // Migration 006: Assessment data storage
    `ALTER TABLE teachers ADD COLUMN curriculum_coverage TEXT`,

    // Migration 007: conversation context for memory
    `ALTER TABLE teachers ADD COLUMN conversation_context TEXT`,

    // Migration 009: dedicated opted_out_at timestamp for reliable re-activation
    // Previously the code reused renewal_reminder_sent_at as a proxy, which broke
    // after multiple STOP cycles or when markUserAsPro() cleared renewal_reminder_sent_at.
    `ALTER TABLE teachers ADD COLUMN opted_out_at TEXT`,

    // Migration 010: Teacher Workspace - Classes table
    `ALTER TABLE teachers ADD COLUMN default_class_id INTEGER`,

    // Migration 011: Teacher Workspace - saved resources tracking
    `ALTER TABLE teachers ADD COLUMN saved_resources_count INTEGER NOT NULL DEFAULT 0`,

    // Migration 014: tracks the most recently-analysed assessment so the
    // REPORT / HOD report / parent report follow-up commands know which
    // assessment to pull. Previously written by handleDataAssessmentFlow
    // but silently dropped because it wasn't in updateTeacherProfile's
    // column whitelist — this migration plus the whitelist fix close that gap.
    `ALTER TABLE teachers ADD COLUMN last_assessment_id INTEGER`,

    // Migration 027: class_id on assessment-level entities (ADR-004).
    // learners.class_id (Migration 024) was sufficient for identity
    // resolution, but the assessment/observation event itself also needs
    // to carry class context independently — otherwise "all assessments
    // for Grade 5A" has no way to be answered without joining through
    // every individual learner_result/observation_record row. Nullable:
    // unclassed submissions (teachers with 0 classes) remain valid per
    // ADR-004's zero-class policy.
    `ALTER TABLE assessments ADD COLUMN class_id INTEGER REFERENCES classes(id)`,
    `ALTER TABLE observation_assessments ADD COLUMN class_id INTEGER REFERENCES classes(id)`,

    // Migration 028: observation corrections (supersedes model) + resolved
    // follow-up flag. corrects_assessment_id is nullable — most
    // observations are not corrections. resolved defaults to 0 so every
    // pre-existing observation_records row starts as an open follow-up,
    // which is correct: nothing was resolved before this column existed.
    //
    // NOTE: this was originally shipped as a standalone
    // migration_observation_corrections_resolution.sql file, which is NOT
    // executed anywhere in the app's startup path — only the ALTER
    // statements in this array run automatically against the live
    // Render database. That file never actually reached production,
    // which surfaced as "table observation_assessments has no column
    // named corrects_assessment_id" in production logs. Moved here so it
    // actually runs. The loose .sql file has been removed from the repo
    // to avoid this happening again.
    `ALTER TABLE observation_assessments ADD COLUMN corrects_assessment_id INTEGER REFERENCES observation_assessments(id)`,
    `ALTER TABLE observation_records ADD COLUMN resolved INTEGER NOT NULL DEFAULT 0`,

    // Migration 029: link assessments to an optional blueprint
    // (ADR-005). Nullable and purely additive — every existing
    // assessments row, and every assessment created without going
    // through the blueprint flow, continues to work identically with
    // blueprint_id NULL. REPORT / HOD REPORT / PARENT REPORT and the
    // Upload Marks flow require zero changes: they read from
    // learner_results/item_analysis/error_analysis/intervention_plans,
    // none of which this migration touches.
    `ALTER TABLE assessments ADD COLUMN blueprint_id INTEGER REFERENCES assessment_blueprints(id)`,

    // Migration 030: snapshot the blueprint's version at the moment this
    // assessment (AssessmentInstance, ADR-005 Section 4) was created.
    // Nullable and purely additive, same as blueprint_id above. Needed
    // because Blueprints are versioned-not-mutable (ADR-005 Section 5):
    // if a teacher later revises a published blueprint (Fractions Test
    // v1 -> v2), assessments already administered against v1 must keep
    // reporting against the questions/topics as they existed at v1, not
    // silently pick up v2's corrections. blueprint_id alone only tells
    // you which blueprint lineage was used, not which version — this
    // column is what lets a report reconstruct "what this class actually
    // wrote," independent of any later revision to the same blueprint_id.
    `ALTER TABLE assessments ADD COLUMN blueprint_version INTEGER`,

    // Migration 031: soft-delete marker for roster management (ADR-006
    // PR3). Nullable and purely additive. Removing a learner from a
    // class's roster (WhatsApp REMOVE LEARNER / CLEAR ROSTER) sets this
    // instead of deleting the row or nulling class_id — learner_id is
    // referenced by learner_results and observation_records (Migration
    // 025) and must survive roster cleanup so past marks/observations
    // stay attributable. Deliberately NOT modeled as class_id = NULL
    // ("unclassed"): that would collide with
    // idx_learners_identity_unclassed (Migration 026) the moment two
    // different classes each remove a same-named learner. getRoster()
    // (learnerRosterService.js) filters WHERE removed_at IS NULL; a
    // later ADD LEARNER / ROSTER paste that identity-matches a removed
    // learner un-removes them instead of creating a duplicate.
    `ALTER TABLE learners ADD COLUMN removed_at TEXT`,

    // Migration 019 and Migration 021 (grade data-repair) were moved out of
    // this array — see dataRepairMigrations below. They are UPDATE
    // statements, not ALTER TABLEs, so they don't belong under this loop's
    // blanket catch, which assumes "column already exists" and would
    // silently swallow a genuine data-repair failure.
  ];

  // Migrations 019 and 021 are one-time data-repair UPDATEs, not additive
  // ALTER TABLEs. Both are idempotent (re-running is a safe no-op once data
  // is already in the target format), so they run on every startup, but a
  // genuine failure (locked table, malformed data) is now logged instead of
  // being silently swallowed by the alterations loop's blanket catch.
  const dataRepairMigrations = [
    {
      name: "Migration 019: Convert 'Grade N' strings to integers",
      // parseGradeInput now returns integer (1-12) instead of "Grade N" string.
      // Idempotent: only affects rows matching the 'Grade N' pattern.
      sql: `UPDATE teachers SET grade = CAST(SUBSTR(grade, 7) AS INTEGER) WHERE grade LIKE 'Grade %'`,
    },
    {
      name: 'Migration 021: Fix "N.0" grade values',
      // better-sqlite3 binds a raw JS integer to the TEXT `grade` column via
      // its float string form (e.g. 7 -> "7.0"), not "7". One-time cleanup
      // of rows already written with the "N.0" pattern. Idempotent.
      sql: `UPDATE teachers SET grade = CAST(CAST(grade AS REAL) AS INTEGER) WHERE grade LIKE '%.0'`,
    },
  ];
  for (const { name, sql } of dataRepairMigrations) {
    try {
      db.exec(sql);
    } catch (err) {
      console.error(`[DB] ${name} FAILED:`, err.message);
    }
  }

  // Migration 008: persistent multi-turn session store
  // Replaces in-memory Maps so sessions survive process restarts and deploys.
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      phone_hash    TEXT    NOT NULL,
      session_type  TEXT    NOT NULL,
      state         TEXT    NOT NULL,           -- JSON blob
      updated_at    REAL    NOT NULL,            -- Unix ms timestamp
      PRIMARY KEY (phone_hash, session_type)
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_updated
      ON sessions(updated_at);
  `);

  // Migration 012: Teacher Workspace - Classes table
  db.exec(`
    CREATE TABLE IF NOT EXISTS classes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash      TEXT    NOT NULL,
      name            TEXT    NOT NULL,
      grade           INTEGER NOT NULL,
      subject         TEXT    NOT NULL,
      learner_count   INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (phone_hash) REFERENCES teachers(phone_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_classes_phone
      ON classes(phone_hash);
  `);

  // Migration 013: Teacher Workspace - Saved Resources table
  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_resources (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash      TEXT    NOT NULL,
      resource_type   TEXT    NOT NULL,
      title           TEXT    NOT NULL,
      content         TEXT    NOT NULL,
      grade           INTEGER,
      subject         TEXT,
      topic           TEXT,
      metadata        TEXT,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (phone_hash) REFERENCES teachers(phone_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_saved_resources_phone
      ON saved_resources(phone_hash);
    CREATE INDEX IF NOT EXISTS idx_saved_resources_type
      ON saved_resources(resource_type);
  `);

  // Migration 016: Idempotency key for SAVE command.
  // generation_id is the UUID minted in processGeneration() and stored in
  // lastGeneratedState.  Persisting it here means that if WhatsApp delivery
  // fails after a successful DB commit, the teacher's retry SAVE hits the
  // UNIQUE constraint instead of inserting a duplicate row.  The SAVE handler
  // detects the UNIQUE_CONSTRAINT error code, looks up the existing row to
  // reconstruct the confirmation message, then clears session state.
  // The column is nullable (TEXT) so that resources saved before this migration
  // (or via legacy paths) are not affected.
  for (const stmt of [
    `ALTER TABLE saved_resources ADD COLUMN generation_id TEXT`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_resources_generation
       ON saved_resources(phone_hash, generation_id)
       WHERE generation_id IS NOT NULL`,
  ]) {
    try { db.exec(stmt); } catch (_) { /* column / index already exists */ }
  }

  // Migration 015: Reports table - persists generated diagnostic / HOD /
  // parent reports so they survive restarts and can be re-fetched without
  // re-running the analysis pipeline. Previously these reports were
  // generated and discarded on every request (see saveInterventionReport,
  // which only logged to console).
  db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash      TEXT    NOT NULL,
      assessment_id   INTEGER NOT NULL,
      report_type     TEXT    NOT NULL,           -- 'diagnostic' | 'hod' | 'parent'
      learner_name    TEXT,                        -- set only for parent reports scoped to one learner
      content         TEXT    NOT NULL,            -- rendered report text
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (phone_hash) REFERENCES teachers(phone_hash),
      FOREIGN KEY (assessment_id) REFERENCES assessments(id)
    );
    CREATE INDEX IF NOT EXISTS idx_reports_phone
      ON reports(phone_hash);
    CREATE INDEX IF NOT EXISTS idx_reports_assessment
      ON reports(assessment_id);
  `);

  // Migration 022: Foundation Phase observation storage.
  // observation_assessments holds the per-submission header (grade/subject/
  // assessment name), mirroring how `assessments` separates header data from
  // `learner_results` in the numeric pipeline. observation_records holds one
  // row per (learner, domain) pair, using developmental_status (not the
  // generic "status") to match the developmentalStatus field name used
  // throughout utils/observationParser.js and services/observationAnalysisService.js.
  // No generation_id / idempotency key yet — that's deferred until the
  // WhatsApp handler exists and duplicate submissions become possible.
  db.exec(`
    CREATE TABLE IF NOT EXISTS observation_assessments (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash        TEXT    NOT NULL,
      grade             TEXT,
      subject           TEXT,
      assessment_name   TEXT,
      created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (phone_hash) REFERENCES teachers(phone_hash)
    );
    CREATE TABLE IF NOT EXISTS observation_records (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      assessment_id         INTEGER NOT NULL,
      learner_name          TEXT    NOT NULL,
      domain                TEXT    NOT NULL,
      developmental_status  TEXT    NOT NULL,
      notes                 TEXT,
      created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (assessment_id) REFERENCES observation_assessments(id)
    );
    CREATE INDEX IF NOT EXISTS idx_observation_assessments_phone
      ON observation_assessments(phone_hash);
    CREATE INDEX IF NOT EXISTS idx_observation_records_assessment
      ON observation_records(assessment_id);
  `);

  // Migration 018: Payment ledger — single source of truth for idempotency
  // and audit trail on payment.succeeded webhooks. checkout_id UNIQUE is
  // the ONLY mechanism relied on for idempotency (enforced via INSERT OR
  // IGNORE at webhook-receipt time, before any business logic runs) —
  // replaces the previous ad-hoc "SELECT ... WHERE status = 'complete'"
  // check against the subscriptions table, which worked but was not the
  // single canonical idempotency anchor Task 3 requires.
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_ledger (
      id                  TEXT    PRIMARY KEY,
      checkout_id         TEXT    UNIQUE,
      phone_hash          TEXT,
      amount              INTEGER,
      status              TEXT    NOT NULL DEFAULT 'received',
      -- received | applied | ignored | failed
      reason              TEXT,
      pro_expires_before  TEXT,
      pro_expires_after   TEXT,
      created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_payment_ledger_phone
      ON payment_ledger(phone_hash);
  `);

  // Migration 020: indexes on the core learner-analytics pipeline tables.
  // Every one of these is queried by assessment_id or phone_hash in
  // itemAnalysisService, errorAnalysisService, learnerGroupingService,
  // diagnosticWorkflowService, interventionReportsService, and
  // curriculumCoverageService — but had zero index coverage, unlike every
  // other table in this schema (usage_events, sessions, classes,
  // saved_resources, reports, payment_ledger all have theirs). At small
  // scale this doesn't show up; as assessment history grows across
  // teachers and terms, these become full table scans on the app's hottest
  // read path. CREATE INDEX IF NOT EXISTS is idempotent and safe to re-run.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_assessments_phone
      ON assessments(phone_hash);
    CREATE INDEX IF NOT EXISTS idx_learner_results_assessment
      ON learner_results(assessment_id);
    CREATE INDEX IF NOT EXISTS idx_item_analysis_assessment
      ON item_analysis(assessment_id);
    CREATE INDEX IF NOT EXISTS idx_error_analysis_assessment
      ON error_analysis(assessment_id);
    CREATE INDEX IF NOT EXISTS idx_intervention_plans_phone
      ON intervention_plans(phone_hash);
    CREATE INDEX IF NOT EXISTS idx_intervention_plans_assessment
      ON intervention_plans(assessment_id);
    CREATE INDEX IF NOT EXISTS idx_curriculum_coverage_phone
      ON curriculum_coverage(phone_hash);
  `);

  // Migration 023: Persistent per-phone rate limiting.
  // Replaces the in-memory Map-based sliding-window counters in
  // routes/webhook.js (aiCallTimestamps/classifierCallTimestamps), which
  // reset on every Render restart/redeploy — a teacher near the ceiling
  // effectively got a free reset on every deploy. One row per call attempt;
  // each write opportunistically deletes that phone's own stale rows for
  // the same limiter, so no separate cleanup job is needed (mirrors the
  // inline-cleanup style already used elsewhere, e.g. checkAndIncrementUsage).
  db.exec(`
    CREATE TABLE IF NOT EXISTS rate_limit_events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash    TEXT    NOT NULL,
      limiter_type  TEXT    NOT NULL,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rate_limit_events_lookup
      ON rate_limit_events(phone_hash, limiter_type, created_at);
  `);

  // Migration 024: Persistent learner identity (ADR-003).
  // Introduces `learners` as the canonical identity for learner history,
  // per docs/adr/ADR-003-longitudinal-learner-progress.md. This table is
  // deliberately conservative: identity fields only. Mastery, progress,
  // statistics, and intervention flags are derived projections (ADR-003
  // Decision 3 / System of Record) and belong in later tables once the
  // projection engine is built — not here.
  //
  // normalized_name is not declared UNIQUE. Identity is only meaningful
  // scoped to one teacher's one class (phone_hash, class_id,
  // normalized_name) — idx_learners_lookup below reflects that scope,
  // but enforcing uniqueness on it is a matching-policy decision left to
  // ADR-004, not assumed here.
  db.exec(`
    CREATE TABLE IF NOT EXISTS learners (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash        TEXT    NOT NULL,
      class_id          INTEGER,
      canonical_name    TEXT    NOT NULL,
      normalized_name   TEXT    NOT NULL,
      created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (phone_hash) REFERENCES teachers(phone_hash),
      FOREIGN KEY (class_id) REFERENCES classes(id)
    );
    CREATE INDEX IF NOT EXISTS idx_learners_phone
      ON learners(phone_hash);
    CREATE INDEX IF NOT EXISTS idx_learners_class
      ON learners(class_id);
    CREATE INDEX IF NOT EXISTS idx_learners_lookup
      ON learners(phone_hash, class_id, normalized_name);
  `);

  // Migration 025: link existing evidence tables to learner identity
  // (ADR-003). learner_id is nullable and additive only — no existing
  // learner_results or observation_records row is modified, and
  // learner_name is retained unchanged everywhere as the original
  // teacher-entered evidence. Population of learner_id happens at write
  // time once the identity-resolution service exists (ADR-003 PR 2);
  // historical rows are intentionally left unmatched (NULL) rather than
  // backfilled, per Phase 1 scope.
  for (const stmt of [
    `ALTER TABLE learner_results ADD COLUMN learner_id INTEGER REFERENCES learners(id)`,
    `ALTER TABLE observation_records ADD COLUMN learner_id INTEGER REFERENCES learners(id)`,
  ]) {
    try { db.exec(stmt); } catch (_) { /* column already exists */ }
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_learner_results_learner
      ON learner_results(learner_id);
    CREATE INDEX IF NOT EXISTS idx_observation_records_learner
      ON observation_records(learner_id);
  `);

  // Migration 026: enforce learner identity uniqueness (ADR-003 PR 2).
  // idx_learners_lookup (Migration 024) is a plain, non-unique index, so it
  // does not stop learnerIdentityService.resolveLearner() from racing two
  // concurrent inserts into a duplicate identity. A single
  // UNIQUE(phone_hash, class_id, normalized_name) index would not close
  // that gap either — SQLite treats every NULL as distinct from every
  // other NULL inside a UNIQUE index, so two "unmatched" (class_id IS
  // NULL) learners with the same name would still both insert. Two
  // partial unique indexes handle the classed and unclassed cases
  // explicitly. resolveLearner() relies on these: find -> insert -> catch
  // UNIQUE violation -> re-find.
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_learners_identity_classed
      ON learners(phone_hash, class_id, normalized_name)
      WHERE class_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_learners_identity_unclassed
      ON learners(phone_hash, normalized_name)
      WHERE class_id IS NULL;
  `);

  for (const sql of alterations) {
    try {
      db.exec(sql);
    } catch {
      // Column already exists — this is expected on subsequent startups
    }
  }

  // Indexes for Migration 027's class_id columns — created after the
  // alterations loop above, since the columns must exist first.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_assessments_class
      ON assessments(class_id);
    CREATE INDEX IF NOT EXISTS idx_observation_assessments_class
      ON observation_assessments(class_id);
  `);

  // Index for Migration 028's corrects_assessment_id column — same reason.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_observation_assessments_corrects
      ON observation_assessments(corrects_assessment_id);
  `);

  // Indexes for Migration 029's assessment_blueprints /
  // blueprint_questions / assessments.blueprint_id.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_assessment_blueprints_phone
      ON assessment_blueprints(phone_hash);
    CREATE INDEX IF NOT EXISTS idx_blueprint_questions_blueprint
      ON blueprint_questions(blueprint_id);
    CREATE INDEX IF NOT EXISTS idx_assessments_blueprint
      ON assessments(blueprint_id);
  `);

  // Migration 032: WhatsApp OTP persistence (ADR-008 PR22A). Standalone
  // table, not an ALTER — mirrors the rate_limit_events template
  // (Migration 023) rather than the alterations[] array, since this is a
  // brand-new table rather than a column added to an existing one.
  //
  // code_hash stores HMAC-SHA256(code, secret), not a plain SHA-256 of
  // the 6-digit code. A bare hash of a 6-digit space (1,000,000
  // possibilities) is brute-forceable offline from a stolen database
  // alone; a keyed HMAC means the attacker also needs the server secret.
  // See routes/auth.js (PR22B) for where that secret is supplied.
  //
  // expires_at / consumed_at / attempts model the full OTP lifecycle:
  // - expires_at: 5-minute validity window, checked via
  //   `expires_at > datetime('now')` directly in SQL (idx_auth_codes_lookup
  //   below), sidestepping JS Date/timezone parsing entirely — consistent
  //   with how other time-sensitive queries in this codebase work.
  // - consumed_at: NULL until successfully verified once; verify-code
  //   sets it, and getActiveAuthCode() only returns rows where this is
  //   still NULL, which is what makes each code one-time-use (replay
  //   protection).
  // - attempts: incremented on each failed verify-code check against a
  //   given code row; routes/auth.js (PR22B) enforces a max-attempts
  //   cap before forcing the teacher to request a fresh code.
  //
  // phone_hash (not a raw phone number) matches the convention already
  // used by rate_limit_events/learners/teachers — hashPhone() in
  // utils/usageTracker.js is the single canonical normalizer, reused
  // as-is with no new hashing logic introduced here.
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_codes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash    TEXT    NOT NULL,
      code_hash     TEXT    NOT NULL,
      expires_at    TEXT    NOT NULL,
      attempts      INTEGER NOT NULL DEFAULT 0,
      consumed_at   TEXT,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_auth_codes_phone
      ON auth_codes(phone_hash);
    CREATE INDEX IF NOT EXISTS idx_auth_codes_lookup
      ON auth_codes(phone_hash, expires_at);
  `);

  // Migration 033: School calendar — resolves a term (1-4) for a given
  // date, standalone reference table (not a per-teacher table). Seeded
  // with default SA public-school term dates below; a school/teacher-
  // specific override is not modeled yet (nothing consumes that today).
  db.exec(`
    CREATE TABLE IF NOT EXISTS school_calendar (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      year       INTEGER NOT NULL,
      term       INTEGER NOT NULL,
      start_date TEXT    NOT NULL,
      end_date   TEXT    NOT NULL,
      UNIQUE(year, term)
    );
  `);

  // Seed default terms (idempotent — INSERT OR IGNORE on the UNIQUE(year,term))
  // Approximate SA public school calendar.
  const calendarSeed = [
    [2025, 1, '2025-01-15', '2025-03-28'],
    [2025, 2, '2025-04-08', '2025-06-27'],
    [2025, 3, '2025-07-22', '2025-10-03'],
    [2025, 4, '2025-10-13', '2025-12-10'],
    [2026, 1, '2026-01-14', '2026-03-27'],
    [2026, 2, '2026-04-07', '2026-06-26'],
    [2026, 3, '2026-07-21', '2026-10-02'],
    [2026, 4, '2026-10-12', '2026-12-09'],
  ];
  const insertTerm = db.prepare(`
    INSERT OR IGNORE INTO school_calendar (year, term, start_date, end_date)
    VALUES (?, ?, ?, ?)
  `);
  for (const row of calendarSeed) insertTerm.run(...row);

  // Migration 034: TSE (Teacher Support Evidence) Evidence Engine links.
  // Every successful write to saved_resources / assessments / reports /
  // intervention_plans / curriculum_coverage / observation_assessments
  // gets a corresponding row here (see services/tseEvidenceService.js),
  // tagging it with a category so MY GROWTH / the dashboard can query
  // "what evidence does this teacher have" without joining six tables.
  //
  // UNIQUE(source_table, source_id, category) makes tagging idempotent —
  // both the live hooks and the one-time backfill script
  // (scripts/backfillTseEvidence.js) can call tagEvidence() safely more
  // than once for the same source row without creating duplicates.
  db.exec(`
    CREATE TABLE IF NOT EXISTS tse_evidence_links (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash    TEXT    NOT NULL,
      category      TEXT    NOT NULL,
      source_table  TEXT    NOT NULL,
      source_id     INTEGER NOT NULL,
      term          INTEGER,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source_table, source_id, category)
    );
    CREATE INDEX IF NOT EXISTS idx_tse_evidence_phone
      ON tse_evidence_links(phone_hash, category);
  `);

  // Migration 035: link intervention plans to learner identity, and add
  // a slot for the plan's eventual outcome (same convention as Migration
  // 025 — column shipped ahead of the writer). learner_id is nullable
  // and additive: no existing intervention_plans row is touched, and any
  // write path that doesn't yet resolve a single learner (e.g. a
  // group-level plan) continues to work with learner_id left NULL.
  // outcome_status is a free-form nullable TEXT slot for whenever a plan
  // is closed out (e.g. 'improved' | 'no_change' | 'escalated'). Nothing
  // writes to either column yet — that's deliberate. The follow-up (not
  // this migration) is updating interventionService.js's read-side
  // buildPlan() and whatever future write path persists an
  // InterventionPlan to actually populate learner_id. This unblocks
  // PR20 (GET /api/learners) without needing a second migration later.
  for (const stmt of [
    `ALTER TABLE intervention_plans ADD COLUMN learner_id INTEGER REFERENCES learners(id)`,
    `ALTER TABLE intervention_plans ADD COLUMN outcome_status TEXT`,
  ]) {
    try { db.exec(stmt); } catch (_) { /* column already exists */ }
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_intervention_plans_learner
      ON intervention_plans(learner_id);
  `);

  // Migration 036: intervention_plans.subject — the dedup key needed to
  // enforce "one active learner-level intervention plan per subject".
  // InterventionPlan (services/interventionService.js) is computed per
  // (learnerId, subject) from MasteryService, but until now
  // intervention_plans had no subject column, so persisting one of these
  // rollups had no reliable identity to dedup against short of
  // string-matching problem_area, which is fragile. Nullable and
  // additive: interventionPlanService.js's existing assessment-scoped
  // writer (saveInterventionPlan()) is untouched and continues to leave
  // this column NULL — only the new learner+subject writer
  // (interventionService.saveLearnerInterventionPlan(), added alongside
  // this migration) populates it.
  try {
    db.exec(`ALTER TABLE intervention_plans ADD COLUMN subject TEXT`);
  } catch (_) { /* column already exists */ }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_intervention_plans_learner_subject_status
      ON intervention_plans(learner_id, subject, status);
  `);

  // Migration 037: qms_reflections (ADR-011). First QMS-owned table —
  // teacher-authored reflection content, distinct from TSE's
  // tse_evidence_links (Migration 034), which only tags existing rows
  // and never stores authored content itself. phone_hash is the
  // ownership identifier, matching every other teacher-scoped table in
  // this schema (learners, assessments, tse_evidence_links) — ADR-011
  // §2 deliberately does not introduce teacher_id here to avoid a mixed
  // identity model.
  //
  // evidence_link_ids is a JSON array of tse_evidence_links.id values,
  // not a join table — ADR-011 §3 records this as a deliberate
  // low-complexity choice for now, with explicit triggers (moderation
  // queries, evidence-based search, district-scale reporting) for when
  // to revisit it as a relational join table instead.
  //
  // ai_assisted is a plain boolean (ADR-011 §4, Option A) — richer
  // generated/edited/approved/submitted lifecycle tracking is the
  // intended eventual direction but deferred until a moderator/reviewer
  // role exists to consume it.
  //
  // deleted_at is a nullable soft-delete marker (ADR-011 §7) — a
  // reflection may already be referenced by a generated portfolio
  // snapshot, so hard-deleting the row could leave that snapshot
  // pointing at nothing. Soft-deleted reflections are excluded from
  // future listings/portfolio generation but remain resolvable.
  db.exec(`
    CREATE TABLE IF NOT EXISTS qms_reflections (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash         TEXT    NOT NULL,
      term               INTEGER,
      content            TEXT    NOT NULL,
      ai_assisted        INTEGER NOT NULL DEFAULT 0,
      evidence_link_ids  TEXT,
      created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
      deleted_at         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_qms_reflections_phone_term
      ON qms_reflections(phone_hash, term);
  `);

  // Migration 038: qms_growth_plans (ADR-011 §2, §9). Second QMS-owned
  // table — a goal/target-area a teacher is tracking over time, with a
  // status lifecycle (active -> in_progress -> completed, or abandoned).
  // Schema is frozen exactly as specified in ADR-011's Data Model
  // section: phone_hash, term, goal_text, target_area, status, and
  // timestamps/soft-delete only. No reflection_id linkage or additional
  // planning fields (planned_actions, success_criteria, target_date) —
  // those were explicitly deferred to a future ADR once real usage
  // justifies the added relational/schema complexity (see PR29
  // discussion). Do not add columns here without amending ADR-011 first.
  //
  // deleted_at is a nullable soft-delete marker (ADR-011 §7), same
  // rationale as qms_reflections — a completed/abandoned plan may
  // already be referenced by a generated portfolio snapshot.
  db.exec(`
    CREATE TABLE IF NOT EXISTS qms_growth_plans (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash   TEXT    NOT NULL,
      term         INTEGER,
      goal_text    TEXT    NOT NULL,
      target_area  TEXT,
      status       TEXT    NOT NULL DEFAULT 'active',
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      deleted_at   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_qms_growth_plans_phone_term
      ON qms_growth_plans(phone_hash, term);
  `);

  // Migration 039: qms topic_id columns (PR32, ADR-013 §4.4). Adds the
  // controlled taxonomy identifier (utils/qmsTopics.js) to both QMS
  // tables. Nullable at the schema level — per ADR-013 §3.3/§4.4/§4.5,
  // nullability exists solely to permit pre-PR32 rows to remain
  // unmigrated; every *new* write must supply a valid topicId, enforced
  // at the service layer (reflectionService.js / growthPlanService.js),
  // not by a DB-level CHECK/FK/ENUM constraint. ADR-013 §4.4 records this
  // as a deliberate trade-off — a lookup-table migration would otherwise
  // be required every time the taxonomy gains a topic (§3.4) — and is
  // exactly why the coaching engine (PR33, ADR-013 §6.1) is required to
  // treat any persisted topic_id absent from the active taxonomy the same
  // way it treats a null one, rather than trusting the column blindly.
  //
  // qms_growth_plans.target_area is left in place rather than dropped —
  // SQLite's ALTER TABLE DROP COLUMN support is version-dependent and
  // dropping a column teachers' existing rows still populate is a higher-
  // risk change than leaving it present-but-unused. The service layer
  // (growthPlanService.js) exposes only topicId going forward (ADR-013
  // §4.3); target_area becomes a deprecated, unread legacy column after
  // this migration, not a second live source of truth.
  try {
    db.exec(`ALTER TABLE qms_reflections ADD COLUMN topic_id TEXT`);
  } catch (_) { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE qms_growth_plans ADD COLUMN topic_id TEXT`);
  } catch (_) { /* column already exists */ }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_qms_reflections_topic
      ON qms_reflections(topic_id);
    CREATE INDEX IF NOT EXISTS idx_qms_growth_plans_topic
      ON qms_growth_plans(topic_id);
  `);

  // Migration 040: coaching_snapshots (PR37, ADR-016 §6). Persisted
  // historical trend data sitting on top of the PR33 coaching engine.
  // Written exclusively by services/coachingSnapshotService.js as a side
  // effect of evidence changes (reflection saved, growth plan status
  // change) — never as a side effect of a read (MY COACHING, a future
  // dashboard route, or any other consumer). See ADR-016 §9 invariant 5:
  // history is append-only; a same-day write updates that day's row
  // in place (§2 dedup) but never deletes or rewrites a prior day's row.
  //
  // Stores the individual component scores (evidence_score,
  // consistency_score, recency_score) alongside the aggregate confidence
  // — not just the aggregate — per ADR-016 §6, so historical graphs and
  // debugging can explain *why* confidence moved rather than only *that*
  // it moved. rule_id is nullable: PR37 does not yet attribute a
  // snapshot to a specific triggering rule (no rules consume this table
  // until PR39); the column is added now so PR39 doesn't require its own
  // migration.
  //
  // topic_id is a plain TEXT column, not a taxonomy FK — same accepted
  // trade-off as qms_reflections.topic_id / qms_growth_plans.topic_id
  // (ADR-013 §4.4) — validity against the active taxonomy is enforced
  // by the writer service, not the database.
  db.exec(`
    CREATE TABLE IF NOT EXISTS coaching_snapshots (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash         TEXT    NOT NULL,
      topic_id           TEXT    NOT NULL,
      confidence         REAL    NOT NULL,
      confidence_label   TEXT    NOT NULL,
      evidence_score     REAL    NOT NULL,
      consistency_score  REAL    NOT NULL,
      recency_score      REAL    NOT NULL,
      rule_id            TEXT,
      captured_at        TEXT    NOT NULL,
      created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_coaching_snapshots_phone_topic
      ON coaching_snapshots(phone_hash, topic_id);
    CREATE INDEX IF NOT EXISTS idx_coaching_snapshots_captured_at
      ON coaching_snapshots(phone_hash, topic_id, captured_at);
  `);

  console.log('[DB] Migrations complete');
}

module.exports = { getDb, runMigrations };
