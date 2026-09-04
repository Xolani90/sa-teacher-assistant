import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parseSqliteUtc, formatDate, formatDateTime } from './dateFormat';

// These assertions depend on running in SAST (UTC+2), which is where the
// defect was reproduced. Force the environment TZ for this suite so results
// are deterministic regardless of the CI runner's local timezone.
let originalTZ;
beforeAll(() => {
  originalTZ = process.env.TZ;
  process.env.TZ = 'Africa/Johannesburg';
});
afterAll(() => {
  process.env.TZ = originalTZ;
});

describe('parseSqliteUtc / formatDate', () => {
  it('reproduces the exact defect scenario: a UTC-late-night record must land on the correct SAST calendar day', () => {
    // stored: "2026-08-15 22:30:00" (UTC) -> true SAST instant: 16 Aug 00:30
    const formatted = formatDate('2026-08-15 22:30:00');
    expect(formatted).toBe('16 Aug 2026');
  });

  it('does not shift a same-day, mid-day timestamp', () => {
    // 2026-08-15 10:00:00 UTC -> 12:00 SAST, same calendar day
    const formatted = formatDate('2026-08-15 10:00:00');
    expect(formatted).toBe('15 Aug 2026');
  });

  it('passes through an already-qualified ISO string unchanged (no double conversion)', () => {
    // 2026-08-15T22:30:00Z -> 16 Aug SAST, same as the naive-space-separated case
    const formatted = formatDate('2026-08-15T22:30:00Z');
    expect(formatted).toBe('16 Aug 2026');
  });

  it('treats a bare date-only string as local midnight, not a UTC instant', () => {
    // A caller that accidentally passes a date-only fixture through this
    // helper should still get the same calendar day back - a naive
    // "always append Z" fix would break this by shifting it a day earlier
    // in a positive-offset timezone.
    const formatted = formatDate('2026-08-15');
    expect(formatted).toBe('15 Aug 2026');
  });

  it('returns null/empty for missing input', () => {
    expect(parseSqliteUtc(null)).toBeNull();
    expect(parseSqliteUtc(undefined)).toBeNull();
    expect(parseSqliteUtc('')).toBeNull();
    expect(formatDate(null)).toBe('');
    expect(formatDateTime(undefined)).toBe('');
  });

  it('formatDateTime includes the correct local time alongside the corrected date', () => {
    const formatted = formatDateTime('2026-08-15 22:30:00');
    expect(formatted).toContain('16 Aug 2026');
    expect(formatted).toContain('00:30');
  });

  it('returns null for an unparseable string rather than throwing', () => {
    expect(parseSqliteUtc('not-a-date')).toBeNull();
    expect(formatDate('not-a-date')).toBe('');
  });
});
