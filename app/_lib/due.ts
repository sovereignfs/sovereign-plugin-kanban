/**
 * Due-date state for card tiles and the card header — pure, so it's
 * unit-testable without React. Day-granular (a due date is a day, not an
 * instant): a card due earlier today is "today", not overdue, until
 * midnight passes.
 */
export type DueState = 'overdue' | 'today' | 'soon' | 'later';

/** Cards due within this many days (after today) count as "soon". */
export const DUE_SOON_DAYS = 2;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function dueState(dueDate: number, now: number = Date.now()): DueState {
  const today = startOfDay(now);
  const due = startOfDay(dueDate);
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  const daysAhead = Math.round((due - today) / 86_400_000);
  return daysAhead <= DUE_SOON_DAYS ? 'soon' : 'later';
}

/** Short user-facing wording for a tooltip / screen reader label. */
export function describeDueState(state: DueState): string {
  switch (state) {
    case 'overdue':
      return 'Overdue';
    case 'today':
      return 'Due today';
    case 'soon':
      return 'Due soon';
    default:
      return 'Due';
  }
}
