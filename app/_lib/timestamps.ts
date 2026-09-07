/**
 * Timestamp coercion at the read boundary.
 *
 * Application code queries through the sqlite-core schema on both dialects
 * (docs/plugin-database.md). On Postgres, every timestamp column is a
 * `bigint` (plain `integer` overflows on a Unix-ms value — see SPEC.md's
 * `0.17.1` entry), and node-postgres returns `int8` as a *string* by
 * default; the sqlite-core `integer` column has no driver-value mapping of
 * its own, so those strings would pass straight through into
 * `createdAt`/`dueDate`/`lastSeenAt`. `new Date("1780000000000")` is
 * Invalid Date, and `Intl.DateTimeFormat().format(Invalid Date)` throws a
 * `RangeError` — so without this, due dates rendered as "Invalid Date" and
 * the Inbox's day grouping crashed the page on any Postgres instance.
 *
 * Every read in `queries.ts` (and `portability.ts`) routes its timestamp
 * columns through these helpers, so the rest of the plugin only ever sees
 * numbers regardless of dialect. Pure, so it's unit-tested directly with
 * string inputs (`__tests__/timestamps.test.ts`) — the one place this
 * Postgres-only behavior can be exercised without a live Postgres.
 */

/** A required timestamp — a number, or a numeric string from node-postgres. */
export function asMs(value: number | string | bigint): number {
  if (typeof value === 'number') return value;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new TypeError(`Expected a numeric timestamp, got ${String(value)}`);
  }
  return n;
}

/** A nullable timestamp column (`due_date`, `last_seen_at`, `archived_at`). */
export function asMsOrNull(value: number | string | bigint | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return asMs(value);
}
