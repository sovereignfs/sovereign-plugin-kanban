/**
 * K.11 Inbox — pure day-grouping, no server/React imports, same split as
 * `order.ts`/`filter.ts` so it's directly unit-testable. Assumes `items` is
 * already sorted newest-first (the DB query orders it that way) — grouping
 * is a single sequential pass, not a full re-sort/bucket.
 */
export interface DayGroup<T> {
  label: string;
  items: T[];
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "Today" / "Yesterday" / a formatted date (year included only when not the current year). */
export function dayLabel(ms: number, now: number = Date.now()): string {
  const diffDays = Math.round((startOfDay(now) - startOfDay(ms)) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  const date = new Date(ms);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  }).format(date);
}

export function groupByDay<T extends { createdAt: number }>(
  items: T[],
  now: number = Date.now(),
): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const item of items) {
    const label = dayLabel(item.createdAt, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}
