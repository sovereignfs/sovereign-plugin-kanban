import type { ReactNode } from 'react';
import { KanbanSidebar } from './_components/KanbanSidebar';
import { requireUser } from './_lib/authz';
import { getDb } from './_lib/db';
import { hasUnseenInboxActivity } from './_lib/queries';
import styles from './kanban.module.css';

/**
 * Plugin shell: secondary sidebar (web) + content. The sidebar hides below
 * the mobile breakpoint (CSS media query — the full mobile layout is K.12);
 * pages own their PageContainer, this layout adds no gutter of its own.
 *
 * K.11: the sidebar's Inbox unseen badge is computed here (a layout runs on
 * every navigation within the plugin, not just on `/kanban/inbox` itself) so
 * it stays current without the sidebar — a client component — needing its
 * own data fetch.
 */
export default async function KanbanLayout({ children }: { children: ReactNode }) {
  const actor = await requireUser();
  const db = await getDb();
  const hasUnseenInbox = await hasUnseenInboxActivity(db, actor);

  return (
    <div className={styles.shell}>
      <KanbanSidebar hasUnseenInbox={hasUnseenInbox} />
      <div className={styles.main}>{children}</div>
    </div>
  );
}
