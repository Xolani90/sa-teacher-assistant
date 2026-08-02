'use strict';

// services/qmsAnalyticsService.js
//
// PR30 only aggregates structured QMS fields. Narrative reflection text
// is treated as records to count, not text to interpret. Semantic
// analysis of reflection content is intentionally deferred to the AI
// coaching layer (PR33).
//
// Schema reference (Migrations 037/038, ADR-011):
//   qms_reflections:   id, phone_hash, term, content, ai_assisted,
//                       evidence_link_ids, created_at, updated_at, deleted_at
//   qms_growth_plans:  id, phone_hash, term, goal_text, target_area,
//                       status, created_at, updated_at, deleted_at

const { getDb } = require('../utils/database');

/**
 * Dashboard summary: reflection count, growth plan counts by status,
 * most recent activity timestamp across both tables.
 */
function getSummary(phoneHash, { term } = {}) {
  const db = getDb();

  const reflectionParams = term != null ? [phoneHash, term] : [phoneHash];
  const reflectionTermClause = term != null ? 'AND term = ?' : '';

  const reflectionRow = db
    .prepare(
      `SELECT COUNT(*) AS count, MAX(created_at) AS latest
       FROM qms_reflections
       WHERE phone_hash = ? AND deleted_at IS NULL ${reflectionTermClause}`
    )
    .get(...reflectionParams);

  const planParams = term != null ? [phoneHash, term] : [phoneHash];
  const planTermClause = term != null ? 'AND term = ?' : '';

  const planRows = db
    .prepare(
      `SELECT status, COUNT(*) AS count
       FROM qms_growth_plans
       WHERE phone_hash = ? AND deleted_at IS NULL ${planTermClause}
       GROUP BY status`
    )
    .all(...planParams);

  const planLatest = db
    .prepare(
      `SELECT MAX(created_at) AS latest
       FROM qms_growth_plans
       WHERE phone_hash = ? AND deleted_at IS NULL ${planTermClause}`
    )
    .get(...planParams);

  const growthPlanCountsByStatus = planRows.reduce((acc, row) => {
    acc[row.status] = row.count;
    return acc;
  }, {});

  const latestActivity = [reflectionRow.latest, planLatest.latest]
    .filter(Boolean)
    .sort()
    .pop() || null;

  return {
    reflectionCount: reflectionRow.count,
    growthPlanCountsByStatus,
    latestActivity
  };
}

/**
 * Growth plan counts by status plus recent plans list.
 */
function getGrowthPlanSummary(phoneHash, { term, recentLimit = 5 } = {}) {
  const db = getDb();

  const params = term != null ? [phoneHash, term] : [phoneHash];
  const termClause = term != null ? 'AND term = ?' : '';

  const statusRows = db
    .prepare(
      `SELECT status, COUNT(*) AS count
       FROM qms_growth_plans
       WHERE phone_hash = ? AND deleted_at IS NULL ${termClause}
       GROUP BY status`
    )
    .all(...params);

  const countsByStatus = statusRows.reduce((acc, row) => {
    acc[row.status] = row.count;
    return acc;
  }, {});

  const recentPlans = db
    .prepare(
      `SELECT id, term, goal_text, target_area, status, created_at, updated_at
       FROM qms_growth_plans
       WHERE phone_hash = ? AND deleted_at IS NULL ${termClause}
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(...params, recentLimit)
    .map(row => ({
      id: row.id,
      term: row.term,
      goalText: row.goal_text,
      targetArea: row.target_area,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

  return { countsByStatus, recentPlans };
}

/**
 * Normalized target_area grouping — growth plans only, per PR30's
 * frozen rule (reflections are narrative, not aggregated by exact match).
 * Normalization: trim + lowercase + collapse internal whitespace.
 */
function getCommonFocusAreas(phoneHash, { term } = {}) {
  const db = getDb();

  const params = term != null ? [phoneHash, term] : [phoneHash];
  const termClause = term != null ? 'AND term = ?' : '';

  const rows = db
    .prepare(
      `SELECT target_area
       FROM qms_growth_plans
       WHERE phone_hash = ? AND deleted_at IS NULL
         AND target_area IS NOT NULL AND TRIM(target_area) != ''
         ${termClause}`
    )
    .all(...params);

  const counts = new Map(); // normalized -> { label, count }

  for (const row of rows) {
    const normalized = row.target_area
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');

    if (!counts.has(normalized)) {
      // first-seen casing becomes the display label
      counts.set(normalized, { label: row.target_area.trim(), count: 0 });
    }
    counts.get(normalized).count += 1;
  }

  return Array.from(counts.values()).sort((a, b) => b.count - a.count);
}

/**
 * Single growth plan detail, with age computed at query time from
 * created_at (not stored, so it's always accurate regardless of when
 * the row is read).
 */
function getGrowthPlanDetail(phoneHash, planId) {
  const db = getDb();

  const row = db
    .prepare(
      `SELECT id, phone_hash, term, goal_text, target_area, status,
              created_at, updated_at
       FROM qms_growth_plans
       WHERE id = ? AND phone_hash = ? AND deleted_at IS NULL`
    )
    .get(planId, phoneHash);

  if (!row) return null;

  const createdAtMs = Date.parse(`${row.created_at.replace(' ', 'T')}Z`);
  const ageDays = Number.isFinite(createdAtMs)
    ? Math.floor((Date.now() - createdAtMs) / (1000 * 60 * 60 * 24))
    : null;

  return {
    id: row.id,
    term: row.term,
    goalText: row.goal_text,
    targetArea: row.target_area,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ageDays
  };
}

module.exports = {
  getSummary,
  getGrowthPlanSummary,
  getCommonFocusAreas,
  getGrowthPlanDetail
};
