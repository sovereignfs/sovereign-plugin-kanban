/**
 * The Postgres read path: `bigint` timestamp columns arrive from
 * node-postgres as strings, and the sqlite-core schema application code
 * queries through has no driver-value mapping for them. These helpers are
 * the one seam where that's corrected, so they're exercised here with the
 * exact shapes a Postgres row produces — the only way this dialect-specific
 * behaviour can be tested without a live Postgres.
 */
import { describe, expect, it } from 'vitest';
import { dayLabel, groupByDay } from '../inbox';
import { asMs, asMsOrNull } from '../timestamps';
import { timeAgo } from '../time';

const MS = 1_780_000_000_000; // a 13-digit Unix-ms value, past int32 range

describe('asMs', () => {
  it('passes a number through untouched', () => {
    expect(asMs(MS)).toBe(MS);
    expect(asMs(0)).toBe(0);
  });

  it('coerces the numeric string node-postgres returns for int8', () => {
    expect(asMs(String(MS))).toBe(MS);
  });

  it('coerces a bigint', () => {
    expect(asMs(BigInt(MS))).toBe(MS);
  });

  it('throws on a non-numeric value rather than returning NaN', () => {
    expect(() => asMs('not-a-timestamp')).toThrow(TypeError);
    expect(() => asMs('')).not.toThrow(); // Number('') is 0 — a legitimate (if odd) epoch
  });
});

describe('asMsOrNull', () => {
  it('keeps null and undefined as null', () => {
    expect(asMsOrNull(null)).toBeNull();
    expect(asMsOrNull(undefined)).toBeNull();
  });

  it('coerces a present value', () => {
    expect(asMsOrNull(String(MS))).toBe(MS);
    expect(asMsOrNull(MS)).toBe(MS);
  });
});

describe('the date helpers downstream of the read boundary', () => {
  // These document *why* the coercion matters: fed the raw string a
  // Postgres row carries, each helper either renders "Invalid Date" or
  // throws — the exact failure the coercion exists to prevent.
  it('dayLabel throws a RangeError on a string timestamp (so the Inbox would crash)', () => {
    expect(() => dayLabel(String(MS) as unknown as number)).toThrow(RangeError);
    expect(() => dayLabel(asMs(String(MS)))).not.toThrow();
  });

  it('groupByDay works once timestamps are coerced', () => {
    const items = [{ id: 'a', createdAt: asMs(String(MS)) }];
    expect(groupByDay(items, MS)[0]?.label).toBe('Today');
  });

  it('timeAgo formats a coerced timestamp older than 30 days without throwing', () => {
    const old = asMs(String(MS - 40 * 86_400_000));
    expect(() => timeAgo(old)).not.toThrow();
    expect(timeAgo(old)).not.toContain('Invalid');
  });
});
