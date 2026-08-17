/**
 * Pure activity-pagination cursor helpers — deliberately no server-only
 * imports (no `sdk`, no DB client). `queries.ts` now imports
 * `@sovereignfs/sdk` (K.9's `sdk.directory.resolveUsers()` call in
 * `getBoardData`), and that import pulls in the SDK's `next/headers`-using
 * modules along with it. `CardActivity.tsx` is a client component that
 * needs `activityCursorFor` as a real runtime function (not just a type),
 * so if it imported this from `queries.ts`, webpack would bundle the whole
 * module — SDK included — into client code, which Next.js correctly
 * rejects ("You're importing a component that needs next/headers"). Keeping
 * this logic in its own sdk-free file is what makes it safe to import from
 * a client component at all; `queries.ts` re-exports it for server-side
 * callers so `actions.ts` and tests don't need to know it moved.
 */
export const ACTIVITY_PAGE_SIZE = 20;

export interface ActivityCursor {
  createdAt: number;
  id: string;
}

/** The cursor for the page *after* `items`, or null when `items` wasn't a full page (no more rows). */
export function activityCursorFor(
  items: Array<{ createdAt: number; id: string }>,
): ActivityCursor | null {
  if (items.length < ACTIVITY_PAGE_SIZE) return null;
  const last = items[items.length - 1];
  return last ? { createdAt: last.createdAt, id: last.id } : null;
}
