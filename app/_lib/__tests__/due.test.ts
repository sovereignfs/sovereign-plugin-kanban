import { describe, expect, it } from 'vitest';
import { DUE_SOON_DAYS, describeDueState, dueState } from '../due';

// Wed Mar 18 2026, 15:00 local — mid-afternoon so "earlier today" is testable.
const NOW = new Date(2026, 2, 18, 15, 0).getTime();
const DAY = 86_400_000;

describe('dueState', () => {
  it('is overdue for any day before today, however close', () => {
    expect(dueState(new Date(2026, 2, 17, 23, 59).getTime(), NOW)).toBe('overdue');
    expect(dueState(NOW - 30 * DAY, NOW)).toBe('overdue');
  });

  it('is "today" for the whole of the current day, including hours already past', () => {
    expect(dueState(new Date(2026, 2, 18, 8, 0).getTime(), NOW)).toBe('today');
    expect(dueState(new Date(2026, 2, 18, 23, 0).getTime(), NOW)).toBe('today');
  });

  it('is "soon" up to DUE_SOON_DAYS ahead, then "later"', () => {
    expect(dueState(new Date(2026, 2, 19).getTime(), NOW)).toBe('soon');
    expect(dueState(new Date(2026, 2, 18 + DUE_SOON_DAYS).getTime(), NOW)).toBe('soon');
    expect(dueState(new Date(2026, 2, 19 + DUE_SOON_DAYS).getTime(), NOW)).toBe('later');
  });
});

describe('describeDueState', () => {
  it('has user-facing wording for every state', () => {
    expect(describeDueState('overdue')).toBe('Overdue');
    expect(describeDueState('today')).toBe('Due today');
    expect(describeDueState('soon')).toBe('Due soon');
    expect(describeDueState('later')).toBe('Due');
  });
});
