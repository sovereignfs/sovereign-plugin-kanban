import { describe, expect, it } from 'vitest';
import { dayLabel, groupByDay } from '../inbox';

// A fixed "now" so tests don't depend on the real calendar date.
const NOW = new Date(2026, 2, 15, 12, 0, 0).getTime(); // Sun Mar 15 2026, noon

describe('dayLabel', () => {
  it('labels the same calendar day as Today', () => {
    expect(dayLabel(new Date(2026, 2, 15, 8, 0).getTime(), NOW)).toBe('Today');
  });

  it('labels the previous calendar day as Yesterday, even across a time-of-day boundary', () => {
    // 23:59 the day before "now" — less than a full 24h apart, but a different calendar day.
    expect(dayLabel(new Date(2026, 2, 14, 23, 59).getTime(), NOW)).toBe('Yesterday');
  });

  it('formats an older same-year date without the year', () => {
    expect(dayLabel(new Date(2026, 0, 3).getTime(), NOW)).toBe('January 3');
  });

  it('includes the year for a date in a different year', () => {
    expect(dayLabel(new Date(2025, 11, 20).getTime(), NOW)).toBe('December 20, 2025');
  });
});

describe('groupByDay', () => {
  it('groups consecutive same-day items into one bucket, preserving order', () => {
    const items = [
      { id: 'a', createdAt: new Date(2026, 2, 15, 10).getTime() },
      { id: 'b', createdAt: new Date(2026, 2, 15, 9).getTime() },
      { id: 'c', createdAt: new Date(2026, 2, 14, 20).getTime() },
      { id: 'd', createdAt: new Date(2026, 2, 13, 8).getTime() },
    ];
    const groups = groupByDay(items, NOW);
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', 'March 13']);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(groups[1]?.items.map((i) => i.id)).toEqual(['c']);
    expect(groups[2]?.items.map((i) => i.id)).toEqual(['d']);
  });

  it('returns an empty array for an empty feed', () => {
    expect(groupByDay([], NOW)).toEqual([]);
  });

  it('does not merge two non-consecutive runs of the same label', () => {
    // Same-day items with an out-of-order different-day item wedged between
    // them would be a data bug elsewhere (input isn't actually sorted), but
    // the grouping itself should still not silently merge non-adjacent runs.
    const items = [
      { id: 'a', createdAt: new Date(2026, 2, 15, 10).getTime() },
      { id: 'b', createdAt: new Date(2026, 2, 14, 10).getTime() },
      { id: 'c', createdAt: new Date(2026, 2, 15, 9).getTime() },
    ];
    const groups = groupByDay(items, NOW);
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', 'Today']);
  });
});
