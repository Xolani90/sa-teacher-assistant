/**
 * ============================================================================
 * TIMESTAMP CONVENTION
 * ============================================================================
 *
 * All subscription expiry timestamps (e.g. pro_expires) are stored as UTC-based
 * SQLite datetime('now', ...) strings ("YYYY-MM-DD HH:MM:SS"), with NO
 * 'localtime' modifier.
 *
 * JavaScript's Date parser interprets this SQLite format as local time rather
 * than UTC on many runtimes. Always use parseSqliteUtc() when converting these
 * database values into JavaScript Date objects.
 *
 * If a future write path stores local-time values or uses a different timestamp
 * format, this parser and its callers must be reviewed together.
 */

/**
 * Parses a SQLite datetime string (format: 'YYYY-MM-DD HH:MM:SS') as UTC.
 *
 * SQLite's datetime('now') and datetime(..., '+N days') always produce
 * UTC timestamps in space-separated format. However, JavaScript's
 * new Date(str) parses space-separated datetime strings as LOCAL time,
 * not UTC. On a server running outside UTC (or during DST shifts), this
 * silently shifts every expiry/renewal calculation by the local offset.
 *
 * This helper converts the space to 'T' and appends 'Z' so the JS Date
 * parser treats it as the UTC timestamp it actually is.
 *
 * @param {string|null|undefined} sqliteDatetime - e.g. '2026-08-15 14:30:00'
 * @returns {Date|null}
 */
function parseSqliteUtc(sqliteDatetime) {
  if (!sqliteDatetime) return null;
  const trimmed = String(sqliteDatetime).trim();
  if (!trimmed) return null;

  // Already ISO with T/Z/offset? Don't double-convert.
  if (/T/.test(trimmed) || /Z$/.test(trimmed) || /[+-]\d{2}:\d{2}$/.test(trimmed)) {
    return new Date(trimmed);
  }

  const isoLike = trimmed.replace(' ', 'T') + 'Z';
  const parsed = new Date(isoLike);

  if (isNaN(parsed.getTime())) {
    console.warn('[dateUtils] parseSqliteUtc failed to parse:', sqliteDatetime);
    return null;
  }

  return parsed;
}

module.exports = { parseSqliteUtc };
