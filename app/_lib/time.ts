/**
 * Coarse relative time for comments/activity timestamps — no date library,
 * matching `plugins/account`'s `timeAgo` precedent but ms-based (this
 * plugin's timestamps are Unix ms integers, not ISO strings). Falls back to
 * an absolute date past 30 days, where "42d ago" stops being useful.
 */
export function timeAgo(ms: number): string {
  const diff = Math.floor((Date.now() - ms) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(
    new Date(ms),
  );
}
