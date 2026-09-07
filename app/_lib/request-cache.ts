/**
 * Per-request memoization for reads that several server components in one
 * render tree all need. `(home)/layout.tsx` (sidebar) and `(home)/page.tsx`
 * (body) both need `getHomeData`; the root layout, the home layout, and the
 * Inbox page all need `hasUnseenInboxActivity` — previously each ran its
 * own copy (two directory-resolution round trips per Home render).
 *
 * React's `cache()` dedupes by argument identity within a single request,
 * so these wrappers take primitive ids rather than an `Actor` object (a
 * fresh object per call site would never hit). Server-only by nature —
 * nothing here is imported from a client component.
 */
import { cache } from 'react';
import { getDb } from './db';
import { getHomeData, hasUnseenInboxActivity, type HomeProject } from './queries';

export const getHomeDataCached = cache(
  async (userId: string, tenantId: string): Promise<HomeProject[]> =>
    getHomeData(await getDb(), { userId, tenantId }),
);

export const hasUnseenInboxActivityCached = cache(
  async (userId: string, tenantId: string): Promise<boolean> =>
    hasUnseenInboxActivity(await getDb(), { userId, tenantId }),
);
