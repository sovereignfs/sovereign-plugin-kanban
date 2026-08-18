'use client';

import { useEffect, useState } from 'react';
import { timeAgo } from '../_lib/time';

/**
 * Hydration-safe relative-time display. `timeAgo()` (`_lib/time.ts`) calls
 * `Date.now()` internally, so calling it directly during render is a real
 * Next.js hydration-mismatch risk whenever meaningful wall-clock time passes
 * between the server render and the client's first hydration pass — e.g.
 * "2m ago" server-side vs "1m ago" client-side. React can't reconcile the
 * mismatched text and discards + rebuilds the whole affected subtree to
 * recover (a "Recoverable Error" in the dev overlay) — for a card detail
 * overlay, that means the entire dialog visibly remounts right after
 * opening, not just this one caption.
 *
 * Deferred to a client-only effect instead: both the server render and the
 * client's first paint (before hydration compares them) render the same
 * empty string, so there is nothing to mismatch. The real relative label
 * fills in immediately after mount — a normal client-side update, not a
 * hydration diff. This also sidesteps a second, separate hydration risk in
 * `timeAgo()`'s own >30-day fallback branch, which formats an absolute date
 * via `Intl.DateTimeFormat(undefined, ...)` — locale-dependent, so a server
 * whose Node locale differs from the client browser's could mismatch there
 * too; deferring the whole label to post-mount avoids that class of bug as
 * well, not just the relative-bucket one.
 */
export function TimeAgo({ ms }: { ms: number }) {
  const [label, setLabel] = useState('');

  useEffect(() => {
    setLabel(timeAgo(ms));
  }, [ms]);

  return <>{label}</>;
}
