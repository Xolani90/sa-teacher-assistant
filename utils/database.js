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

  for (const sql of alterations) {
    try {
      db.exec(sql);
    } catch {
      // Column already exists — this is expected on subsequent startups
    }
  }

  console.log('[DB] Migrations complete');
}

module.exports = { getDb, runMigrations };
