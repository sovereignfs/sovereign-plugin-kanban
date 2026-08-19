import type { ReactNode } from 'react';
import { KanbanSidebar } from '../_components/KanbanSidebar';
import { requireUser } from '../_lib/authz';
import { getDb } from '../_lib/db';
import { getHomeData, hasUnseenInboxActivity } from '../_lib/queries';
import styles from '../kanban.module.css';

/**
 * Route-group layout for the Home (`/kanban`) and Inbox (`/kanban/inbox`)
 * pages only — adds the secondary sidebar around `{children}`. Board View
 * (`/kanban/boards/[boardId]`) lives outside this group, so it gets the
 * root layout's header but no sidebar.
 *
 * Also fetches `getHomeData` for the sidebar's "My projects"/"Shared with
 * me" sections — the same query `(home)/page.tsx` runs for the Home page
 * body itself. A second round trip rather than threading the data down,
 * matching this layout's own existing pattern for `hasUnseenInboxActivity`
 * (also independently fetched by both the layout and Inbox's page).
 */
export default async function KanbanHomeLayout({ children }: { children: ReactNode }) {
  const actor = await requireUser();
  const db = await getDb();
  const [hasUnseenInbox, projects] = await Promise.all([
    hasUnseenInboxActivity(db, actor),
    getHomeData(db, actor),
  ]);

  return (
    <div className={styles.contentRow}>
      <KanbanSidebar hasUnseenInbox={hasUnseenInbox} projects={projects} />
      <div className={styles.main}>{children}</div>
    </div>
  );
}
