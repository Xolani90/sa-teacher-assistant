/**
 * dashboard/src/utils/dateFormat.js
 *
 * Client-side counterpart to the server's utils/dateUtils.js#parseSqliteUtc().
 *
 * SQLite's datetime('now') produces UTC-naive strings like '2026-08-15 22:30:00'
 * (no timezone marker). The browser's `new Date(str)` parses a space-separated
 * datetime string as LOCAL time, not UTC. For a South African user (SAST,
 * UTC+2, no DST) that silently shifts any timestamp from 22:00-23:59 UTC onto
 * the wrong calendar day.
 *
 * Always use parseSqliteUtc()/formatDate()/formatDateTime() from this module
 * for created_at/updated_at-style timestamps coming from the API. Do NOT use
 * this for date-only business values (e.g. incidentDate) that have no time
 * component — those are intentionally interpreted as local-midnight and
 * should keep using a plain `new Date(\`${dateStr}T00:00:00\`)` parse.
 */

/**
 * Parses a SQLite datetime string ('YYYY-MM-DD HH:MM:SS') as UTC.
 * Mirrors the server's parseSqliteUtc() so client and server agree on the
 * instant a given stored string represents.
 *
 * @param {string|null|undefined} sqliteDatetime
 * @returns {Date|null}
 */
export function parseSqliteUtc(sqliteDatetime) {
  if (!sqliteDatetime) return null;
  const trimmed = String(sqliteDatetime).trim();
  if (!trimmed) return null;

  // Already ISO with T/Z/offset, or a bare date-only string? Don't
  // reinterpret those — only the raw SQLite 'YYYY-MM-DD HH:MM:SS' shape
  // needs the UTC correction.
  if (/T/.test(trimmed) || /Z$/.test(trimmed) || /[+-]\d{2}:\d{2}$/.test(trimmed)) {
    const parsed = new Date(trimmed);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    // Date-only value with no time component - not this helper's concern,
    // but parse it as local-midnight rather than returning null.
    const parsed = new Date(`${trimmed}T00:00:00`);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  const isoLike = trimmed.replace(' ', 'T') + 'Z';
  const parsed = new Date(isoLike);

  if (isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

/**
 * Formats a SQLite UTC timestamp as a short local date, e.g. '16 Aug 2026'.
 * @param {string|null|undefined} iso
 * @returns {string}
 */
export function formatDate(iso) {
  const d = parseSqliteUtc(iso);
  if (!d) return '';
  return d.toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Formats a SQLite UTC timestamp as a short local date + time, e.g.
 * '16 Aug 2026, 00:30'.
 * @param {string|null|undefined} iso
 * @returns {string}
 */
export function formatDateTime(iso) {
  const d = parseSqliteUtc(iso);
  if (!d) return '';
  return d.toLocaleString('en-ZA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
