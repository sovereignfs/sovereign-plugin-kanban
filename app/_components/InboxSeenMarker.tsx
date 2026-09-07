'use client';

import { useEffect } from 'react';
import { markInboxSeen } from '../actions';

/**
 * Marks the Inbox as seen — deliberately a `useEffect` firing on a real
 * client mount, not a side effect of the page's own server render. Next.js
 * prefetches `<Link>` targets in the background (e.g. hovering the sidebar
 * entry), which would run this page's Server Component render without the
 * user ever actually visiting — a server-render-time write here would clear
 * "unseen" for activity nobody looked at. The action's own
 * `revalidatePath` already re-renders the current route tree (layouts and
 * their unseen-badge queries included) when it completes, so the badge
 * clears on this same visit without a second `router.refresh()`.
 */
export function InboxSeenMarker() {
  useEffect(() => {
    void markInboxSeen();
  }, []);

  return null;
}
