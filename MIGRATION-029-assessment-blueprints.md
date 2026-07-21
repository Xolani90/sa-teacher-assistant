MIGRATION 029 — Assessment Blueprints (ADR-005)
=================================================

Corrected numbering: the requested "Migration 028" is already taken in
utils/database.js (observation corrections — corrects_assessment_id /
resolved, tests/migration-028-observation-corrections.test.js). This is
Migration 029.

Also corrected: assessment_blueprints uses `phone_hash`, not
`teacher_hash`, to match every other table in the schema (teachers,
assessments, classes, learners, intervention_plans,
curriculum_coverage all use phone_hash as the teacher identifier).

Apply as two separate edits to utils/database.js, matching the existing
structure exactly.

---------------------------------------------------------------------
EDIT 1 — new CREATE TABLE block
---------------------------------------------------------------------
Add this immediately after the `curriculum_coverage` table definition,
inside the same `db.exec(`...`)` base-schema block (i.e. before the
closing backtick that currently follows curriculum_coverage's closing
`);`, around line 197 of the current file). Keeping it inside the same
db.exec() call — rather than a separate one — matches how every other
Phase-1 table (assessments, learner_results, item_analysis, etc.) in
that same block is declared.

    -- ── Assessment Blueprints (ADR-005) ──────────────────────────────────
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

    -- ── Blueprint Questions (ADR-005) ─────────────────────────────────────
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

---------------------------------------------------------------------
EDIT 2 — additive migration entries
---------------------------------------------------------------------
Add to the `alterations` array (the same array Migrations 006, 007,
009–011, 014, 027, 028 live in), immediately after the existing
Migration 028 entries (after the `observation_records ADD COLUMN
resolved` line, before the "Migration 019 and Migration 021 ... moved
out of this array" comment):

    // Migration 029: link assessments to an optional blueprint
    // (ADR-005). Nullable and purely additive — every existing
    // assessments row, and every assessment created without going
    // through the blueprint flow, continues to work identically with
    // blueprint_id NULL. REPORT / HOD REPORT / PARENT REPORT and the
    // Upload Marks flow require zero changes: they read from
    // learner_results/item_analysis/error_analysis/intervention_plans,
    // none of which this migration touches.
    `ALTER TABLE assessments ADD COLUMN blueprint_id INTEGER REFERENCES assessment_blueprints(id)`,

---------------------------------------------------------------------
EDIT 3 — indexes
---------------------------------------------------------------------
Add a new db.exec() block, placed after the "Indexes for Migration
027's class_id columns" block (after line ~604 in the current file),
following the same "index added after the alterations loop, once the
column exists" ordering used for Migrations 027 and 028's indexes:

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

---------------------------------------------------------------------
Backwards compatibility (per ADR-005 addition requested)
---------------------------------------------------------------------
- assessments.blueprint_id is nullable with no default constraint
  requiring it — every existing row remains valid as-is.
- storeAssessment() / storeLearnerResults() / processAssessmentData()
  in diagnosticWorkflowService.js are untouched by this migration.
  Passing a blueprint_id through storeAssessment() is new, optional
  behavior to be added in the BlueprintRepository/import work that
  follows this migration — not part of Migration 029 itself.
- item_analysis.topic, error_analysis.topic, and every downstream
  consumer (learnerGroupingService, interventionPlanService,
  curriculumCoverageService, pdfService, interventionReportsService)
  read from the same tables they always have. None of them reference
  assessment_blueprints or blueprint_questions, so none of them need
  to change for this migration to be safe to deploy.
- REPORT / HOD REPORT / PARENT REPORT commands query reports /
  item_analysis / error_analysis / intervention_plans by
  assessment_id, never by blueprint_id — unaffected.

---------------------------------------------------------------------
Verification after applying
---------------------------------------------------------------------
1. Run the existing full suite (`npm test`) — this migration should
   produce zero regressions since it only adds tables/columns/indexes
   guarded by IF NOT EXISTS, matching the idempotent pattern already
   used throughout runMigrations().
2. Confirm on a fresh DB and on a DB carried over from before this
   change that `SELECT blueprint_id FROM assessments LIMIT 1;` returns
   NULL for all pre-existing rows without error.
3. Add a `tests/migration-029-assessment-blueprints.test.js` following
   the shape of `tests/adr003-learners-migration.test.js` and
   `tests/migration-028-observation-corrections.test.js` — insert a
   blueprint, a blueprint_question, an assessment referencing it, and
   an assessment with blueprint_id left NULL; assert both read back
   correctly and that the existing diagnostic pipeline still runs
   against the NULL case unchanged.

Next step after this migration lands (per the agreed implementation
order): a BlueprintRepository (CRUD for assessment_blueprints /
blueprint_questions) plus CAPS validation of blueprint_questions.topic
against CAPS_TOPICS from curriculumIntelligenceService.js.
