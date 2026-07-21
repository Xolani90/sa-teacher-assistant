'use strict';

/**
 * Assessment Blueprint repository (ADR-005) — Phase 1.
 *
 * Persistence layer over assessment_blueprints / blueprint_questions
 * (Migration 029). Mirrors observationRepository.js's shape: manual
 * BEGIN/COMMIT/ROLLBACK (not db.transaction()) for compatibility with
 * both better-sqlite3 (production) and the node:sqlite test shim used
 * elsewhere in this test suite.
 *
 * Scope note: this is a pure persistence layer, matching Migration 029's
 * own scope boundary. It does NOT:
 *   - validate blueprint_questions.topic against the CAPS Topic Registry
 *     (ADR-005 Section 7) — that is application-layer work that sits in
 *     front of createBlueprint()/createBlueprintVersion(), not inside
 *     this repository. This repository stores whatever topic string it
 *     is given.
 *   - touch assessments / storeAssessment() / storeLearnerResults() —
 *     wiring blueprint_id through those flows is explicitly future work
 *     per MIGRATION-029-assessment-blueprints.md's "Backwards
 *     compatibility" section.
 *   - implement AssessmentInstance / LearnerResult (ADR-005 Section 4) —
 *     those reuse the existing assessments / learner_results tables
 *     (assessments.blueprint_id, added by Migration 029, is the link),
 *     not a new table.
 *
 * Blueprint lifecycle (ADR-005 Section 5):
 *   draft     — freely editable. No assessment may reference it yet.
 *   published — locked. Set by publishBlueprint() once the caller has
 *               confirmed the first assessment/instance now references
 *               it. This repository does not itself decide *when* to
 *               publish (that's the caller's business rule); it only
 *               enforces that a published blueprint's questions can no
 *               longer be mutated via updateQuestion()/deleteQuestion()/
 *               addQuestion().
 *   archived  — soft-deleted. Excluded from listBlueprints() by default,
 *               same "insert-only, nothing destructively lost" pattern
 *               as observationRepository.js's resolve-followup flag.
 *
 * Revisions are a NEW row (version + 1, previous_version_id pointing at
 * the prior version), never an edit to a published blueprint — see
 * createBlueprintVersion(). This preserves historical integrity for any
 * assessment instance already referencing the earlier version.
 *
 * See: docs/adr/ADR-005-intermediate-phase-assessment-intelligence.md
 *      MIGRATION-029-assessment-blueprints.md
 */

const { getDb } = require('../utils/database');
const { validateBlueprintTopics } = require('./blueprintTopicValidation');
const logger = require('../utils/logger').child({ module: 'blueprintRepository' });

const VALID_STATUSES = ['draft', 'published', 'archived'];

/**
 * Creates a new blueprint (version 1) and its questions atomically. If
 * any question insert fails, the whole transaction — including the
 * blueprint header row — is rolled back, matching
 * saveObservationSubmission()'s no-orphaned-header guarantee.
 *
 * @param {string} phoneHash - Teacher's phone hash
 * @param {{ title: string, subject: string, grade: number, term?: number|null, totalMarks: number }} header
 * @param {Array<{ questionNumber: number, topic: string, maxMarks: number, subtopic?: string|null, bloomLevel?: string|null, atpReference?: string|null, expectedMisconception?: string|null }>} questions
 * @returns {{ blueprintId: number, questionCount: number }}
 */
function createBlueprint(phoneHash, header, questions) {
  const db = getDb();

  if (!phoneHash) {
    throw new Error('createBlueprint: phoneHash must not be null or empty');
  }
  if (!header || !header.title || !header.subject || header.grade == null || header.totalMarks == null) {
    throw new Error('createBlueprint: header must include title, subject, grade, and totalMarks');
  }
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('createBlueprint: questions must be a non-empty array');
  }
  for (const q of questions) {
    if (q.questionNumber == null || !q.topic || q.maxMarks == null) {
      throw new Error('createBlueprint: every question requires questionNumber, topic, and maxMarks');
    }
  }

  try {
    let blueprintId;
    try {
      db.prepare('BEGIN').run();

      const blueprintResult = db.prepare(`
        INSERT INTO assessment_blueprints (phone_hash, title, subject, grade, term, total_marks, version, status)
        VALUES (?, ?, ?, ?, ?, ?, 1, 'draft')
      `).run(
        phoneHash,
        header.title,
        header.subject,
        header.grade,
        header.term ?? null,
        header.totalMarks
      );

      blueprintId = blueprintResult.lastInsertRowid;

      const insertQuestion = db.prepare(`
        INSERT INTO blueprint_questions (blueprint_id, question_number, topic, subtopic, bloom_level, atp_reference, expected_misconception, max_marks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const q of questions) {
        insertQuestion.run(
          blueprintId,
          q.questionNumber,
          q.topic,
          q.subtopic ?? null,
          q.bloomLevel ?? null,
          q.atpReference ?? null,
          q.expectedMisconception ?? null,
          q.maxMarks
        );
      }

      db.prepare('COMMIT').run();
    } catch (txErr) {
      try { db.prepare('ROLLBACK').run(); } catch (_) { /* best-effort */ }
      throw txErr;
    }

    logger.info('Blueprint created', { phoneHash, blueprintId, questionCount: questions.length });

    return { blueprintId, questionCount: questions.length };
  } catch (err) {
    logger.error('Failed to create blueprint', { phoneHash, error: err.message });
    throw err;
  }
}

/**
 * Creates a new version of an existing blueprint (ADR-005 Section 5 —
 * "Revision"). The prior version's row and its questions are never
 * mutated; a new assessment_blueprints row is inserted with
 * version = priorVersion.version + 1 and previous_version_id pointing
 * back at it, plus its own fresh set of blueprint_questions. Reports
 * already generated against instances referencing the prior version
 * continue to reflect what those classes actually wrote.
 *
 * The prior version does not need to be 'published' to be revised —
 * a teacher may also choose to revise a draft rather than edit it in
 * place, though updateBlueprintMetadata()/addQuestion()/etc. remain the
 * simpler path while still in draft. Only ownership is enforced here.
 *
 * @param {number} priorBlueprintId
 * @param {string} phoneHash - Calling teacher's phone hash, for ownership check
 * @param {{ title?: string, subject?: string, grade?: number, term?: number|null, totalMarks?: number }} [headerUpdates]
 *   Any field omitted is carried over unchanged from the prior version.
 * @param {Array<{ questionNumber: number, topic: string, maxMarks: number, subtopic?: string|null, bloomLevel?: string|null, atpReference?: string|null, expectedMisconception?: string|null }>} questions
 *   The new version's full question set — not a diff/patch against the
 *   prior version's questions.
 * @returns {{ blueprintId: number, version: number, previousVersionId: number, questionCount: number }}
 */
function createBlueprintVersion(priorBlueprintId, phoneHash, headerUpdates = {}, questions) {
  const db = getDb();

  if (!phoneHash) {
    throw new Error('createBlueprintVersion: phoneHash must not be null or empty');
  }
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('createBlueprintVersion: questions must be a non-empty array');
  }

  const prior = db.prepare(`SELECT * FROM assessment_blueprints WHERE id = ?`).get(priorBlueprintId);
  if (!prior) {
    throw new Error('createBlueprintVersion: prior blueprint does not exist');
  }
  if (prior.phone_hash !== phoneHash) {
    throw new Error("createBlueprintVersion: cannot version another teacher's blueprint");
  }

  try {
    let blueprintId;
    const version = prior.version + 1;
    try {
      db.prepare('BEGIN').run();

      const blueprintResult = db.prepare(`
        INSERT INTO assessment_blueprints (phone_hash, title, subject, grade, term, total_marks, version, previous_version_id, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')
      `).run(
        phoneHash,
        headerUpdates.title ?? prior.title,
        headerUpdates.subject ?? prior.subject,
        headerUpdates.grade ?? prior.grade,
        headerUpdates.term !== undefined ? headerUpdates.term : prior.term,
        headerUpdates.totalMarks ?? prior.total_marks,
        version,
        prior.id
      );

      blueprintId = blueprintResult.lastInsertRowid;

      const insertQuestion = db.prepare(`
        INSERT INTO blueprint_questions (blueprint_id, question_number, topic, subtopic, bloom_level, atp_reference, expected_misconception, max_marks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const q of questions) {
        if (q.questionNumber == null || !q.topic || q.maxMarks == null) {
          throw new Error('createBlueprintVersion: every question requires questionNumber, topic, and maxMarks');
        }
        insertQuestion.run(
          blueprintId,
          q.questionNumber,
          q.topic,
          q.subtopic ?? null,
          q.bloomLevel ?? null,
          q.atpReference ?? null,
          q.expectedMisconception ?? null,
          q.maxMarks
        );
      }

      db.prepare('COMMIT').run();
    } catch (txErr) {
      try { db.prepare('ROLLBACK').run(); } catch (_) { /* best-effort */ }
      throw txErr;
    }

    logger.info('Blueprint version created', { phoneHash, blueprintId, priorBlueprintId, version });

    return { blueprintId, version, previousVersionId: prior.id, questionCount: questions.length };
  } catch (err) {
    logger.error('Failed to create blueprint version', { phoneHash, priorBlueprintId, error: err.message });
    throw err;
  }
}

/**
 * Retrieves one blueprint and all its questions, ordered by question
 * number.
 *
 * @param {number} blueprintId
 * @returns {{
 *   id: number,
 *   phoneHash: string,
 *   title: string,
 *   subject: string,
 *   grade: number,
 *   term: number|null,
 *   totalMarks: number,
 *   version: number,
 *   previousVersionId: number|null,
 *   status: string,
 *   createdAt: string,
 *   updatedAt: string,
 *   questions: Array<{ id: number, questionNumber: number, topic: string, subtopic: string|null, bloomLevel: string|null, atpReference: string|null, expectedMisconception: string|null, maxMarks: number }>
 * }|null}
 */
function getBlueprintById(blueprintId) {
  const db = getDb();

  try {
    const row = db.prepare(`SELECT * FROM assessment_blueprints WHERE id = ?`).get(blueprintId);
    if (!row) return null;

    const questionRows = db.prepare(`
      SELECT * FROM blueprint_questions WHERE blueprint_id = ? ORDER BY question_number ASC
    `).all(blueprintId);

    return mapBlueprint(row, questionRows);
  } catch (err) {
    logger.error('Failed to retrieve blueprint', { blueprintId, error: err.message });
    throw err;
  }
}

/**
 * Lists a teacher's blueprints, most recently updated first. Excludes
 * archived blueprints by default (same "insert-only, nothing
 * destructively lost" pattern as observationRepository.js's
 * getObservationHistory()/includeSuperseded).
 *
 * @param {string} phoneHash
 * @param {{ subject?: string, grade?: number, status?: string, includeArchived?: boolean, limit?: number }} [filters]
 * @returns {Array<{ id: number, title: string, subject: string, grade: number, term: number|null, totalMarks: number, version: number, status: string, questionCount: number, updatedAt: string }>}
 */
function listBlueprints(phoneHash, filters = {}) {
  const db = getDb();

  if (!phoneHash) {
    throw new Error('listBlueprints: phoneHash must not be null or empty');
  }

  try {
    let query = `
      SELECT b.*, COUNT(q.id) as question_count
      FROM assessment_blueprints b
      LEFT JOIN blueprint_questions q ON q.blueprint_id = b.id
      WHERE b.phone_hash = ?
    `;
    const params = [phoneHash];

    if (filters.subject) {
      query += ` AND b.subject = ?`;
      params.push(filters.subject);
    }
    if (filters.grade != null) {
      query += ` AND b.grade = ?`;
      params.push(filters.grade);
    }
    if (filters.status) {
      query += ` AND b.status = ?`;
      params.push(filters.status);
    } else if (!filters.includeArchived) {
      query += ` AND b.status != 'archived'`;
    }

    query += ` GROUP BY b.id ORDER BY b.updated_at DESC, b.id DESC`;

    if (filters.limit) {
      query += ` LIMIT ?`;
      params.push(filters.limit);
    }

    const rows = db.prepare(query).all(...params);

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      subject: row.subject,
      grade: row.grade,
      term: row.term,
      totalMarks: row.total_marks,
      version: row.version,
      status: row.status,
      questionCount: row.question_count,
      updatedAt: row.updated_at,
    }));
  } catch (err) {
    logger.error('Failed to list blueprints', { phoneHash, error: err.message });
    throw err;
  }
}

/**
 * Updates a draft blueprint's header metadata (title/subject/grade/term/
 * totalMarks). Blocked once the blueprint is published or archived —
 * ADR-005 Section 5: "Published — locked ... No further edits to
 * questions, topics, or marks." Metadata is included in that lock for
 * the same reason: changing subject/grade/totalMarks after instances
 * exist would retroactively change what those instances mean.
 *
 * @param {number} blueprintId
 * @param {string} phoneHash - Calling teacher's phone hash, for ownership check
 * @param {{ title?: string, subject?: string, grade?: number, term?: number|null, totalMarks?: number }} updates
 * @returns {{ blueprintId: number, updated: true }}
 */
function updateBlueprintMetadata(blueprintId, phoneHash, updates = {}) {
  const db = getDb();

  const blueprint = requireOwnedDraft(db, blueprintId, phoneHash, 'updateBlueprintMetadata');

  const fields = [];
  const params = [];

  if (updates.title !== undefined) { fields.push('title = ?'); params.push(updates.title); }
  if (updates.subject !== undefined) { fields.push('subject = ?'); params.push(updates.subject); }
  if (updates.grade !== undefined) { fields.push('grade = ?'); params.push(updates.grade); }
  if (updates.term !== undefined) { fields.push('term = ?'); params.push(updates.term); }
  if (updates.totalMarks !== undefined) { fields.push('total_marks = ?'); params.push(updates.totalMarks); }

  if (fields.length === 0) {
    return { blueprintId: blueprint.id, updated: false };
  }

  fields.push(`updated_at = datetime('now')`);
  params.push(blueprintId);

  try {
    db.prepare(`UPDATE assessment_blueprints SET ${fields.join(', ')} WHERE id = ?`).run(...params);

    logger.info('Blueprint metadata updated', { phoneHash, blueprintId });

    return { blueprintId, updated: true };
  } catch (err) {
    logger.error('Failed to update blueprint metadata', { phoneHash, blueprintId, error: err.message });
    throw err;
  }
}

/**
 * Adds a question to a draft blueprint. Blocked once published/archived
 * — see updateBlueprintMetadata()'s docstring for why.
 *
 * @param {number} blueprintId
 * @param {string} phoneHash
 * @param {{ questionNumber: number, topic: string, maxMarks: number, subtopic?: string|null, bloomLevel?: string|null, atpReference?: string|null, expectedMisconception?: string|null }} question
 * @returns {{ questionId: number }}
 */
function addQuestion(blueprintId, phoneHash, question) {
  const db = getDb();

  requireOwnedDraft(db, blueprintId, phoneHash, 'addQuestion');

  if (!question || question.questionNumber == null || !question.topic || question.maxMarks == null) {
    throw new Error('addQuestion: question requires questionNumber, topic, and maxMarks');
  }

  try {
    const result = db.prepare(`
      INSERT INTO blueprint_questions (blueprint_id, question_number, topic, subtopic, bloom_level, atp_reference, expected_misconception, max_marks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      blueprintId,
      question.questionNumber,
      question.topic,
      question.subtopic ?? null,
      question.bloomLevel ?? null,
      question.atpReference ?? null,
      question.expectedMisconception ?? null,
      question.maxMarks
    );

    touchBlueprint(db, blueprintId);

    logger.info('Question added to blueprint', { phoneHash, blueprintId, questionId: result.lastInsertRowid });

    return { questionId: result.lastInsertRowid };
  } catch (err) {
    logger.error('Failed to add question', { phoneHash, blueprintId, error: err.message });
    throw err;
  }
}

/**
 * Updates a single question's fields. Blocked once the parent blueprint
 * is published/archived.
 *
 * @param {number} questionId
 * @param {string} phoneHash
 * @param {{ questionNumber?: number, topic?: string, subtopic?: string|null, bloomLevel?: string|null, atpReference?: string|null, expectedMisconception?: string|null, maxMarks?: number }} updates
 * @returns {{ questionId: number, updated: true }}
 */
function updateQuestion(questionId, phoneHash, updates = {}) {
  const db = getDb();

  const row = db.prepare(`
    SELECT q.*, b.phone_hash, b.status, b.id as blueprint_id
    FROM blueprint_questions q
    JOIN assessment_blueprints b ON b.id = q.blueprint_id
    WHERE q.id = ?
  `).get(questionId);

  if (!row) {
    throw new Error('updateQuestion: question does not exist');
  }
  if (row.phone_hash !== phoneHash) {
    throw new Error("updateQuestion: cannot edit a question on another teacher's blueprint");
  }
  if (row.status !== 'draft') {
    throw new Error(`updateQuestion: cannot edit a question on a ${row.status} blueprint`);
  }

  const columnMap = {
    questionNumber: 'question_number',
    topic: 'topic',
    subtopic: 'subtopic',
    bloomLevel: 'bloom_level',
    atpReference: 'atp_reference',
    expectedMisconception: 'expected_misconception',
    maxMarks: 'max_marks',
  };

  const fields = [];
  const params = [];
  for (const [key, column] of Object.entries(columnMap)) {
    if (updates[key] !== undefined) {
      fields.push(`${column} = ?`);
      params.push(updates[key]);
    }
  }

  if (fields.length === 0) {
    return { questionId, updated: false };
  }

  params.push(questionId);

  try {
    db.prepare(`UPDATE blueprint_questions SET ${fields.join(', ')} WHERE id = ?`).run(...params);

    touchBlueprint(db, row.blueprint_id);

    logger.info('Question updated', { phoneHash, questionId });

    return { questionId, updated: true };
  } catch (err) {
    logger.error('Failed to update question', { phoneHash, questionId, error: err.message });
    throw err;
  }
}

/**
 * Deletes a single question from a draft blueprint. Blocked once
 * published/archived.
 *
 * @param {number} questionId
 * @param {string} phoneHash
 * @returns {{ questionId: number, deleted: true }}
 */
function deleteQuestion(questionId, phoneHash) {
  const db = getDb();

  const row = db.prepare(`
    SELECT q.id, b.phone_hash, b.status, b.id as blueprint_id
    FROM blueprint_questions q
    JOIN assessment_blueprints b ON b.id = q.blueprint_id
    WHERE q.id = ?
  `).get(questionId);

  if (!row) {
    throw new Error('deleteQuestion: question does not exist');
  }
  if (row.phone_hash !== phoneHash) {
    throw new Error("deleteQuestion: cannot delete a question on another teacher's blueprint");
  }
  if (row.status !== 'draft') {
    throw new Error(`deleteQuestion: cannot delete a question on a ${row.status} blueprint`);
  }

  try {
    db.prepare(`DELETE FROM blueprint_questions WHERE id = ?`).run(questionId);

    touchBlueprint(db, row.blueprint_id);

    logger.info('Question deleted', { phoneHash, questionId });

    return { questionId, deleted: true };
  } catch (err) {
    logger.error('Failed to delete question', { phoneHash, questionId, error: err.message });
    throw err;
  }
}

/**
 * Transitions a draft blueprint to 'published'. The caller (not this
 * repository) decides *when* — per ADR-005 Section 5, that's "as soon
 * as the first AssessmentInstance is created from it." CAPS validation
 * CAPS validation is now enforced here directly (ADR-005 Section 7 —
 * "A Blueprint cannot move from Draft to Published while it contains
 * any unresolved topic"): every question's topic is checked against
 * blueprintTopicValidation.js immediately before the status flip. This
 * does not contradict Migration 029's note that topic validation "is
 * not enforced at the SQLite layer" — the SQLite schema still accepts
 * any TEXT value; the enforcement point is this application-layer gate,
 * exactly where ADR-005 places it. A grade/subject with no CAPS
 * registry coverage (dataAvailable: false) does not block publishing —
 * see blueprintTopicValidation.js's own coverage-gap note.
 *
 * @param {number} blueprintId
 * @param {string} phoneHash
 * @returns {{ blueprintId: number, status: 'published' }}
 */
function publishBlueprint(blueprintId, phoneHash) {
  const db = getDb();

  const blueprint = db.prepare(`SELECT * FROM assessment_blueprints WHERE id = ?`).get(blueprintId);
  if (!blueprint) {
    throw new Error('publishBlueprint: blueprint does not exist');
  }
  if (blueprint.phone_hash !== phoneHash) {
    throw new Error("publishBlueprint: cannot publish another teacher's blueprint");
  }
  if (blueprint.status !== 'draft') {
    throw new Error(`publishBlueprint: cannot publish a blueprint that is already ${blueprint.status}`);
  }

  const questionRows = db.prepare(`SELECT * FROM blueprint_questions WHERE blueprint_id = ? ORDER BY question_number ASC`).all(blueprintId);
  if (questionRows.length === 0) {
    throw new Error('publishBlueprint: cannot publish a blueprint with no questions');
  }

  const topicCheck = validateBlueprintTopics(
    blueprint.grade,
    blueprint.subject,
    blueprint.term,
    questionRows.map((q) => ({ questionNumber: q.question_number, topic: q.topic }))
  );

  if (!topicCheck.allValid) {
    const unresolved = topicCheck.results.filter((r) => !r.valid);
    const err = new Error(
      `publishBlueprint: cannot publish - unresolved topic(s) on question(s) ${unresolved.map((r) => r.questionNumber).join(', ')}`
    );
    err.unresolvedTopics = unresolved;
    throw err;
  }

  try {
    db.prepare(`UPDATE assessment_blueprints SET status = 'published', updated_at = datetime('now') WHERE id = ?`).run(blueprintId);

    logger.info('Blueprint published', { phoneHash, blueprintId });

    return { blueprintId, status: 'published' };
  } catch (err) {
    logger.error('Failed to publish blueprint', { phoneHash, blueprintId, error: err.message });
    throw err;
  }
}

/**
 * Soft-deletes a blueprint by setting status = 'archived'. Available
 * from either draft or published state — archiving a published
 * blueprint does not affect any assessment already referencing it
 * (assessments.blueprint_id is a plain FK, not cascaded), it only
 * removes the blueprint from listBlueprints()'s default view and
 * prevents further versions/instances being created from it going
 * forward. Nothing is destructively lost — getBlueprintById() still
 * returns it directly.
 *
 * @param {number} blueprintId
 * @param {string} phoneHash
 * @returns {{ blueprintId: number, status: 'archived' }}
 */
function archiveBlueprint(blueprintId, phoneHash) {
  const db = getDb();

  const blueprint = db.prepare(`SELECT * FROM assessment_blueprints WHERE id = ?`).get(blueprintId);
  if (!blueprint) {
    throw new Error('archiveBlueprint: blueprint does not exist');
  }
  if (blueprint.phone_hash !== phoneHash) {
    throw new Error("archiveBlueprint: cannot archive another teacher's blueprint");
  }
  if (blueprint.status === 'archived') {
    return { blueprintId, status: 'archived' };
  }

  try {
    db.prepare(`UPDATE assessment_blueprints SET status = 'archived', updated_at = datetime('now') WHERE id = ?`).run(blueprintId);

    logger.info('Blueprint archived', { phoneHash, blueprintId });

    return { blueprintId, status: 'archived' };
  } catch (err) {
    logger.error('Failed to archive blueprint', { phoneHash, blueprintId, error: err.message });
    throw err;
  }
}

/**
 * Hard-deletes a draft blueprint and its questions. Only permitted while
 * still in 'draft' — a published blueprint must be archived instead
 * (archiveBlueprint()), never hard-deleted, since assessments may
 * already reference it (ON DELETE CASCADE is intentionally NOT set on
 * assessments.blueprint_id — see Migration 029 — so a hard delete of a
 * referenced blueprint would either fail or, worse, leave assessments
 * pointing at a nonexistent row).
 *
 * @param {number} blueprintId
 * @param {string} phoneHash
 * @returns {{ blueprintId: number, deleted: true }}
 */
function deleteBlueprint(blueprintId, phoneHash) {
  const db = getDb();

  const blueprint = requireOwnedDraft(db, blueprintId, phoneHash, 'deleteBlueprint');

  try {
    db.prepare('BEGIN').run();
    // blueprint_questions has ON DELETE CASCADE (Migration 029), but the
    // explicit delete here keeps behavior correct even under the
    // node:sqlite test shim, which does not always enforce
    // PRAGMA foreign_keys = ON the way better-sqlite3 does in production.
    db.prepare(`DELETE FROM blueprint_questions WHERE blueprint_id = ?`).run(blueprintId);
    db.prepare(`DELETE FROM assessment_blueprints WHERE id = ?`).run(blueprintId);
    db.prepare('COMMIT').run();
  } catch (txErr) {
    try { db.prepare('ROLLBACK').run(); } catch (_) { /* best-effort */ }
    logger.error('Failed to delete blueprint', { phoneHash, blueprintId, error: txErr.message });
    throw txErr;
  }

  logger.info('Blueprint deleted', { phoneHash, blueprintId });

  return { blueprintId: blueprint.id, deleted: true };
}

// ── Internal helpers ─────────────────────────────────────────────────────

function mapBlueprint(row, questionRows) {
  return {
    id: row.id,
    phoneHash: row.phone_hash,
    title: row.title,
    subject: row.subject,
    grade: row.grade,
    term: row.term,
    totalMarks: row.total_marks,
    version: row.version,
    previousVersionId: row.previous_version_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    questions: questionRows.map((q) => ({
      id: q.id,
      questionNumber: q.question_number,
      topic: q.topic,
      subtopic: q.subtopic,
      bloomLevel: q.bloom_level,
      atpReference: q.atp_reference,
      expectedMisconception: q.expected_misconception,
      maxMarks: q.max_marks,
    })),
  };
}

/**
 * Loads a blueprint, verifies ownership, and verifies it is still in
 * 'draft' status — the shared guard behind every mutation that ADR-005
 * Section 5 locks once a blueprint is published.
 */
function requireOwnedDraft(db, blueprintId, phoneHash, callerName) {
  if (!phoneHash) {
    throw new Error(`${callerName}: phoneHash must not be null or empty`);
  }

  const blueprint = db.prepare(`SELECT * FROM assessment_blueprints WHERE id = ?`).get(blueprintId);
  if (!blueprint) {
    throw new Error(`${callerName}: blueprint does not exist`);
  }
  if (blueprint.phone_hash !== phoneHash) {
    throw new Error(`${callerName}: cannot modify another teacher's blueprint`);
  }
  if (blueprint.status !== 'draft') {
    throw new Error(`${callerName}: cannot modify a blueprint that is already ${blueprint.status}`);
  }

  return blueprint;
}

function touchBlueprint(db, blueprintId) {
  db.prepare(`UPDATE assessment_blueprints SET updated_at = datetime('now') WHERE id = ?`).run(blueprintId);
}

module.exports = {
  createBlueprint,
  createBlueprintVersion,
  getBlueprintById,
  listBlueprints,
  updateBlueprintMetadata,
  addQuestion,
  updateQuestion,
  deleteQuestion,
  publishBlueprint,
  archiveBlueprint,
  deleteBlueprint,
  VALID_STATUSES,
};
