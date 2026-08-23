'use strict';

/**
 * Teacher Workspace Service
 * Manages teacher's classes, saved resources, and assessment history.
 * Provides a centralized workspace for teachers to organize their teaching materials.
 */

const { getDb } = require('../utils/database');
const logger = require('../utils/logger').child({ module: 'teacherWorkspace' });

/**
 * Creates a new class for a teacher.
 *
 * @param {string} phoneHash - Teacher's phone hash
 * @param {string} name - Class name (e.g., "Grade 7 Mathematics A")
 * @param {number} grade - Grade level
 * @param {string} subject - Subject name
 * @param {number} learnerCount - Number of learners in the class
 * @returns {Object} Created class
 */
function createClass(phoneHash, name, grade, subject, learnerCount = 0) {
  const db = getDb();

  try {
    const result = db.prepare(`
      INSERT INTO classes (phone_hash, name, grade, subject, learner_count)
      VALUES (?, ?, ?, ?, ?)
    `).run(phoneHash, name, grade, subject, learnerCount);

    const newClass = db.prepare(`
      SELECT * FROM classes WHERE id = ?
    `).get(result.lastInsertRowid);

    logger.info('Class created', { phoneHash, classId: newClass.id, name, grade, subject });

    // If this is the teacher's first class, set it as default
    const classCount = db.prepare(`
      SELECT COUNT(*) as count FROM classes WHERE phone_hash = ?
    `).get(phoneHash).count;

    if (classCount === 1) {
      db.prepare(`
        UPDATE teachers SET default_class_id = ? WHERE phone_hash = ?
      `).run(newClass.id, phoneHash);
    }

    return newClass;
  } catch (err) {
    logger.error('Failed to create class', { phoneHash, name, error: err.message });
    throw err;
  }
}

/**
 * Gets all classes for a teacher.
 *
 * @param {string} phoneHash - Teacher's phone hash
 * @returns {Array} Array of classes
 */
function getTeacherClasses(phoneHash) {
  const db = getDb();

  try {
    const classes = db.prepare(`
      SELECT * FROM classes WHERE phone_hash = ? ORDER BY created_at DESC
    `).all(phoneHash);

    logger.debug('Retrieved teacher classes', { phoneHash, count: classes.length });
    return classes;
  } catch (err) {
    logger.error('Failed to retrieve classes', { phoneHash, error: err.message });
    throw err;
  }
}

/**
 * Gets a specific class by ID.
 *
 * @param {number} classId - Class ID
 * @param {string} phoneHash - Teacher's phone hash (for authorization)
 * @returns {Object|null} Class object or null
 */
function getClass(classId, phoneHash) {
  const db = getDb();

  try {
    const classData = db.prepare(`
      SELECT * FROM classes WHERE id = ? AND phone_hash = ?
    `).get(classId, phoneHash);

    return classData || null;
  } catch (err) {
    logger.error('Failed to retrieve class', { classId, phoneHash, error: err.message });
    throw err;
  }
}

/**
 * Updates a class.
 *
 * @param {number} classId - Class ID
 * @param {string} phoneHash - Teacher's phone hash
 * @param {Object} updates - Fields to update
 * @returns {Object|null} Updated class or null
 */
function updateClass(classId, phoneHash, updates) {
  const db = getDb();

  try {
    const allowedFields = ['name', 'grade', 'subject', 'learner_count'];
    const setClauses = [];
    const values = [];

    for (const [field, value] of Object.entries(updates)) {
      if (allowedFields.includes(field)) {
        setClauses.push(`${field} = ?`);
        values.push(value);
      }
    }

    if (setClauses.length === 0) {
      return getClass(classId, phoneHash);
    }

    values.push(classId, phoneHash);

    db.prepare(`
      UPDATE classes SET ${setClauses.join(', ')}, updated_at = datetime('now')
      WHERE id = ? AND phone_hash = ?
    `).run(...values);

    logger.info('Class updated', { classId, phoneHash, updates });

    return getClass(classId, phoneHash);
  } catch (err) {
    logger.error('Failed to update class', { classId, phoneHash, error: err.message });
    throw err;
  }
}

/**
 * Deletes a class.
 *
 * @param {number} classId - Class ID
 * @param {string} phoneHash - Teacher's phone hash
 * @returns {boolean} Success status
 */
function deleteClass(classId, phoneHash) {
  const db = getDb();

  try {
    const result = db.prepare(`
      DELETE FROM classes WHERE id = ? AND phone_hash = ?
    `).run(classId, phoneHash);

    if (result.changes > 0) {
      // If this was the default class, clear the default
      const teacher = db.prepare(`
        SELECT default_class_id FROM teachers WHERE phone_hash = ?
      `).get(phoneHash);

      if (teacher && teacher.default_class_id === classId) {
        // Set another class as default if available
        const anotherClass = db.prepare(`
          SELECT id FROM classes WHERE phone_hash = ? LIMIT 1
        `).get(phoneHash);

        if (anotherClass) {
          db.prepare(`
            UPDATE teachers SET default_class_id = ? WHERE phone_hash = ?
          `).run(anotherClass.id, phoneHash);
        } else {
          db.prepare(`
            UPDATE teachers SET default_class_id = NULL WHERE phone_hash = ?
          `).run(phoneHash);
        }
      }

      logger.info('Class deleted', { classId, phoneHash });
      return true;
    }

    return false;
  } catch (err) {
    logger.error('Failed to delete class', { classId, phoneHash, error: err.message });
    throw err;
  }
}

/**
 * Sets the default class for a teacher.
 *
 * @param {number} classId - Class ID
 * @param {string} phoneHash - Teacher's phone hash
 * @returns {boolean} Success status
 */
function setDefaultClass(classId, phoneHash) {
  const db = getDb();

  try {
    const classExists = db.prepare(`
      SELECT id FROM classes WHERE id = ? AND phone_hash = ?
    `).get(classId, phoneHash);

    if (!classExists) {
      return false;
    }

    db.prepare(`
      UPDATE teachers SET default_class_id = ? WHERE phone_hash = ?
    `).run(classId, phoneHash);

    logger.info('Default class set', { classId, phoneHash });
    return true;
  } catch (err) {
    logger.error('Failed to set default class', { classId, phoneHash, error: err.message });
    throw err;
  }
}

/**
 * Saves a resource for a teacher.
 *
 * @param {string} phoneHash - Teacher's phone hash
 * @param {string} resourceType - Type of resource (worksheet, lessonPlan, test, etc.)
 * @param {string} title - Resource title
 * @param {string} content - Resource content
 * @param {Object} metadata - Additional metadata (grade, subject, topic, etc.)
 * @returns {Object} Saved resource
 */
function saveResource(phoneHash, resourceType, title, content, metadata = {}, generationId = null) {
  const db = getDb();

  // Guard: content must not be empty — a NULL content row is useless and
  // would silently succeed without this check.
  if (!content) {
    throw new Error('saveResource: content must not be null or empty');
  }

  // Guard: resourceType must be one of the known saveable types.
  const KNOWN_RESOURCE_TYPES = ['worksheet', 'test', 'lessonPlan', 'atp', 'sbaTask', 'examPaper', 'rubric', 'moderationPack', 'mentalMaths'];
  if (!resourceType || !KNOWN_RESOURCE_TYPES.includes(resourceType)) {
    throw new Error(`saveResource: unknown resourceType "${resourceType}"`);
  }

  try {
    // Wrap INSERT + counter UPDATE in a single transaction so neither can
    // partially succeed — if the UPDATE fails the INSERT is rolled back.
    // Manual BEGIN/COMMIT used instead of db.transaction() for compatibility
    // with both better-sqlite3 (production) and the node:sqlite test shim.
    let rowid;
    try {
      db.prepare('BEGIN').run();

      const result = db.prepare(`
        INSERT INTO saved_resources (phone_hash, resource_type, title, content, grade, subject, topic, metadata, generation_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        phoneHash,
        resourceType,
        title,
        content,
        metadata.grade ?? null,
        metadata.subject || null,
        metadata.topic || null,
        JSON.stringify(metadata),
        generationId || null
      );

      db.prepare(`
        UPDATE teachers SET saved_resources_count = saved_resources_count + 1 WHERE phone_hash = ?
      `).run(phoneHash);

      rowid = result.lastInsertRowid;

      // TSE Evidence Engine (Migration 034): tag this save as 'resource'
      // evidence. Non-fatal by design — see tseEvidenceService.tagEvidence().
      try {
        require('./tseEvidenceService').tagEvidence(
          phoneHash,
          'resource',
          'saved_resources',
          rowid
        );
      } catch (evidenceErr) {
        console.error('[TSE] saveResource evidence tagging failed:', evidenceErr.message);
      }
      db.prepare('COMMIT').run();
    } catch (txErr) {
      try { db.prepare('ROLLBACK').run(); } catch (_) { /* best-effort */ }
      throw txErr;
    }

    const resource = db.prepare(`SELECT * FROM saved_resources WHERE id = ?`).get(rowid);

    logger.info('Resource saved', { phoneHash, resourceId: resource.id, resourceType, title });

    return resource;
  } catch (err) {
    logger.error('Failed to save resource', { phoneHash, resourceType, title, error: err.message });
    throw err;
  }
}

/**
 * Gets saved resources for a teacher.
 *
 * @param {string} phoneHash - Teacher's phone hash
 * @param {Object} filters - Optional filters (resourceType, grade, subject)
 * @returns {Array} Array of saved resources
 */
function getSavedResources(phoneHash, filters = {}) {
  const db = getDb();

  try {
    let query = `SELECT * FROM saved_resources WHERE phone_hash = ?`;
    const params = [phoneHash];

    if (filters.resourceType) {
      query += ` AND resource_type = ?`;
      params.push(filters.resourceType);
    }

    if (filters.grade) {
      query += ` AND grade = ?`;
      params.push(filters.grade);
    }

    if (filters.subject) {
      query += ` AND subject = ?`;
      params.push(filters.subject);
    }

    query += ` ORDER BY created_at DESC, id DESC`;

    const resources = db.prepare(query).all(...params);

    logger.debug('Retrieved saved resources', { phoneHash, count: resources.length, filters });
    return resources;
  } catch (err) {
    logger.error('Failed to retrieve saved resources', { phoneHash, error: err.message });
    throw err;
  }
}

/**
 * Gets a specific saved resource by ID.
 *
 * @param {number} resourceId - Resource ID
 * @param {string} phoneHash - Teacher's phone hash
 * @returns {Object|null} Resource object or null
 */
function getSavedResource(resourceId, phoneHash) {
  const db = getDb();

  try {
    const resource = db.prepare(`
      SELECT * FROM saved_resources WHERE id = ? AND phone_hash = ?
    `).get(resourceId, phoneHash);

    return resource || null;
  } catch (err) {
    logger.error('Failed to retrieve saved resource', { resourceId, phoneHash, error: err.message });
    throw err;
  }
}

/**
 * Looks up a saved resource by its generation_id and phone_hash.
 * Used by the SAVE handler to detect duplicate saves after a WhatsApp retry:
 * if the DB write succeeded but the WhatsApp send failed, the second SAVE
 * attempt finds the existing row here instead of inserting a duplicate.
 *
 * @param {string} generationId - UUID from lastGeneratedState
 * @param {string} phoneHash - Teacher's phone hash
 * @returns {Object|null} Resource object or null
 */
function getSavedResourceByGenerationId(generationId, phoneHash) {
  const db = getDb();
  try {
    const resource = db.prepare(`
      SELECT * FROM saved_resources
      WHERE generation_id = ? AND phone_hash = ?
    `).get(generationId, phoneHash);
    return resource || null;
  } catch (err) {
    logger.error('Failed to look up resource by generationId', { generationId, phoneHash, error: err.message });
    return null;
  }
}

/**
 * Deletes a saved resource.
 *
 * @param {number} resourceId - Resource ID
 * @param {string} phoneHash - Teacher's phone hash
 * @returns {boolean} Success status
 */
function deleteSavedResource(resourceId, phoneHash) {
  const db = getDb();

  try {
    const result = db.prepare(`
      DELETE FROM saved_resources WHERE id = ? AND phone_hash = ?
    `).run(resourceId, phoneHash);

    if (result.changes > 0) {
      // Update saved resources count
      db.prepare(`
        UPDATE teachers SET saved_resources_count = saved_resources_count - 1 WHERE phone_hash = ?
      `).run(phoneHash);

      logger.info('Saved resource deleted', { resourceId, phoneHash });
      return true;
    }

    return false;
  } catch (err) {
    logger.error('Failed to delete saved resource', { resourceId, phoneHash, error: err.message });
    throw err;
  }
}

/**
 * Gets assessment history for a teacher.
 *
 * @param {string} phoneHash - Teacher's phone hash
 * @param {Object} filters - Optional filters (grade, subject, term)
 * @returns {Array} Array of assessments with summary statistics
 */
function getAssessmentHistory(phoneHash, filters = {}) {
  const db = getDb();

  try {
    let query = `
      SELECT 
        a.*,
        COUNT(lr.id) as learner_count,
        AVG(lr.percentage) as class_average,
        MAX(lr.percentage) as highest_mark,
        MIN(lr.percentage) as lowest_mark
      FROM assessments a
      LEFT JOIN learner_results lr ON a.id = lr.assessment_id
      WHERE a.phone_hash = ?
    `;
    const params = [phoneHash];

    if (filters.grade) {
      query += ` AND a.grade = ?`;
      params.push(filters.grade);
    }

    if (filters.subject) {
      query += ` AND a.subject = ?`;
      params.push(filters.subject);
    }

    if (filters.term) {
      query += ` AND a.term = ?`;
      params.push(filters.term);
    }

    query += ` GROUP BY a.id ORDER BY a.created_at DESC`;

    const assessments = db.prepare(query).all(...params);

    logger.debug('Retrieved assessment history', { phoneHash, count: assessments.length, filters });
    return assessments;
  } catch (err) {
    logger.error('Failed to retrieve assessment history', { phoneHash, error: err.message });
    throw err;
  }
}

/**
 * Gets a summary of the teacher's workspace.
 *
 * @param {string} phoneHash - Teacher's phone hash
 * @returns {Object} Workspace summary
 */
function getWorkspaceSummary(phoneHash) {
  const db = getDb();

  try {
    const classes = getTeacherClasses(phoneHash);
    const savedResources = getSavedResources(phoneHash);
    const assessmentHistory = getAssessmentHistory(phoneHash);
    const curriculumCoverage = getCurriculumProgress(phoneHash);

    const summary = {
      classes: {
        total: classes.length,
        items: classes.slice(0, 5), // Return first 5
      },
      savedResources: {
        total: savedResources.length,
        byType: groupByType(savedResources),
      },
      assessments: {
        total: assessmentHistory.length,
        recent: assessmentHistory.slice(0, 5), // Return first 5
      },
      curriculumCoverage,
    };

    logger.debug('Workspace summary retrieved', { phoneHash });
    return summary;
  } catch (err) {
    logger.error('Failed to retrieve workspace summary', { phoneHash, error: err.message });
    throw err;
  }
}

/**
 * Groups resources by type.
 */
function groupByType(resources) {
  const grouped = {};
  for (const resource of resources) {
    if (!grouped[resource.resource_type]) {
      grouped[resource.resource_type] = 0;
    }
    grouped[resource.resource_type]++;
  }
  return grouped;
}

/**
 * Gets curriculum progress for a teacher.
 */
function getCurriculumProgress(phoneHash) {
  const { getTeacherProgressReport } = require('./curriculumCoverageService');
  
  try {
    const progress = getTeacherProgressReport(phoneHash);
    return progress;
  } catch (err) {
    logger.warn('Could not retrieve curriculum progress', { phoneHash, error: err.message });
    return null;
  }
}

/**
 * Validates NEW CLASS command arguments before calling createClass.
 *
 * This is a pure function with no DB access so it is straightforward to
 * unit-test.  The webhook extracts `name` and `rawCount` from the user's
 * message and passes the teacher's existing class list for the duplicate
 * check.
 *
 * @param {string} name          - Class name parsed from the command (may be empty)
 * @param {string|number} rawCount - Learner count string as typed by the teacher
 * @param {Array}  existingClasses - Result of getTeacherClasses() for this teacher
 * @returns {{ valid: boolean, error?: string, name?: string, count?: number }}
 *   On success:  { valid: true,  name: <trimmed>, count: <integer> }
 *   On failure:  { valid: false, error: <error_code> }
 *
 * Error codes:
 *   missing_name        – name is absent or whitespace-only
 *   name_too_long       – name exceeds 80 characters
 *   name_invalid_chars  – name contains no letters or digits
 *   missing_count       – learner count is absent or whitespace-only
 *   count_not_a_number  – learner count is not parseable as an integer
 *   count_too_low       – learner count is less than 1
 *   count_too_high      – learner count exceeds 200
 *   duplicate_name      – a class with this name (case-insensitive) already exists
 */
function validateNewClassInput(name, rawCount, existingClasses = []) {
  // ── Name checks ──────────────────────────────────────────────────────────
  const trimmedName = (name || '').trim();

  if (!trimmedName) {
    return { valid: false, error: 'missing_name' };
  }

  if (trimmedName.length > 80) {
    return { valid: false, error: 'name_too_long' };
  }

  // Must contain at least one letter or digit (reject pure-symbol names)
  if (!/[a-zA-Z0-9]/.test(trimmedName)) {
    return { valid: false, error: 'name_invalid_chars' };
  }

  // ── Learner count checks ─────────────────────────────────────────────────
  const rawStr = String(rawCount || '').trim();

  if (!rawStr) {
    return { valid: false, error: 'missing_count' };
  }

  const count = parseInt(rawStr, 10);

  if (isNaN(count)) {
    return { valid: false, error: 'count_not_a_number' };
  }

  if (count < 1) {
    return { valid: false, error: 'count_too_low' };
  }

  if (count > 200) {
    return { valid: false, error: 'count_too_high' };
  }

  // ── Duplicate name check (case-insensitive) ───────────────────────────────
  const nameLower = trimmedName.toLowerCase();
  const isDuplicate = existingClasses.some(
    c => c.name.trim().toLowerCase() === nameLower
  );

  if (isDuplicate) {
    return { valid: false, error: 'duplicate_name' };
  }

  return { valid: true, name: trimmedName, count };
}

module.exports = {
  createClass,
  getTeacherClasses,
  getClass,
  updateClass,
  deleteClass,
  setDefaultClass,
  saveResource,
  getSavedResources,
  getSavedResource,
  getSavedResourceByGenerationId,
  deleteSavedResource,
  getAssessmentHistory,
  getWorkspaceSummary,
  validateNewClassInput,
};
