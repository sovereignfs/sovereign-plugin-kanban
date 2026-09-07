import type { ReactNode } from 'react';
import { KanbanSidebar } from '../_components/KanbanSidebar';
import { requireUser } from '../_lib/authz';
import { getHomeDataCached, hasUnseenInboxActivityCached } from '../_lib/request-cache';
import styles from '../kanban.module.css';

/**
 * Route-group layout for the Home (`/kanban`) and Inbox (`/kanban/inbox`)
 * pages only — adds the secondary sidebar around `{children}`. Board View
 * (`/kanban/b/[boardId]`) lives outside this group, so it gets the
 * root layout's header but no sidebar.
 *
 * Also fetches `getHomeData` for the sidebar's "My projects"/"Shared with
 * me" sections — the same query `(home)/page.tsx` runs for the Home page
 * body itself. Both go through the request-memoized wrappers in
 * `request-cache.ts`, so the layout and the page share one DB round trip
 * (and one directory resolution) per render instead of each running their
 * own copy.
 *
 * No `currentUser` fetch here — the sidebar is pure navigation now (no
 * per-row dialogs needing display names). `(home)/page.tsx` fetches its own
 * `currentUser` for `ManageProjectDialog` instead.
 */
export default async function KanbanHomeLayout({ children }: { children: ReactNode }) {
  const actor = await requireUser();
  const [hasUnseenInbox, projects] = await Promise.all([
    hasUnseenInboxActivityCached(actor.userId, actor.tenantId),
    getHomeDataCached(actor.userId, actor.tenantId),
  ]);

  return (
    <div className={styles.contentRow}>
      <KanbanSidebar hasUnseenInbox={hasUnseenInbox} projects={projects} />
      <div className={styles.main}>{children}</div>
    </div>
  );
}
