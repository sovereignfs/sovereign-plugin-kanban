'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { markInboxSeen } from '../actions';

/**
 * Marks the Inbox as seen — deliberately a `useEffect` firing on a real
 * client mount, not a side effect of the page's own server render. Next.js
 * prefetches `<Link>` targets in the background (e.g. hovering the sidebar
 * entry), which would run this page's Server Component render without the
 * user ever actually visiting — a server-render-time write here would clear
 * "unseen" for activity nobody looked at. `router.refresh()` re-fetches the
 * layout (and its sidebar unseen-badge query) so the badge clears on this
 * same visit instead of only on the next navigation.
 */
export function InboxSeenMarker() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    void markInboxSeen().then(() => {
      if (!cancelled) router.refresh();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
