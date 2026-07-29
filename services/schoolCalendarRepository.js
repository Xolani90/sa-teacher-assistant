'use strict';

/**
 * School calendar repository (Migration 033).
 *
 * Pure persistence/lookup layer over school_calendar — resolves which
 * term (1-4) a given date falls in. Mirrors authCodeRepository.js's
 * shape: plain prepared statements, no db.transaction(), compatible
 * with both better-sqlite3 (production) and the node:sqlite test shim.
 *
 * Scope note: this does not compute or validate term boundaries — it
 * only reads rows seeded by Migration 033. A school-specific override
 * is not modeled today; every teacher shares the same default SA
 * public-school calendar.
 */

const { getDb } = require('../utils/database');

/**
 * Resolves the term number for a given date (defaults to today).
 *
 * @param {string} [dateStr] - 'YYYY-MM-DD'. Defaults to today (UTC).
 * @returns {{ year: number, term: number, startDate: string, endDate: string }|null}
 */
function getTermForDate(dateStr = null) {
  const db = getDb();
  const date = dateStr || new Date().toISOString().slice(0, 10);

  const row = db
    .prepare(
      `SELECT year, term, start_date, end_date
       FROM school_calendar
       WHERE ? BETWEEN start_date AND end_date
       ORDER BY year DESC, term DESC
       LIMIT 1`
    )
    .get(date);

  if (!row) return null;

  return {
    year: row.year,
    term: row.term,
    startDate: row.start_date,
    endDate: row.end_date,
  };
}

/**
 * Convenience wrapper — returns just the term number for today, or
 * null if no calendar row covers today's date (e.g. school holidays
 * outside any seeded term).
 *
 * @returns {number|null}
 */
function getCurrentTerm() {
  const result = getTermForDate();
  return result ? result.term : null;
}

module.exports = {
  getTermForDate,
  getCurrentTerm,
};
