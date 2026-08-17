import type { ReactNode } from 'react';
import { KanbanSidebar } from './_components/KanbanSidebar';
import styles from './kanban.module.css';

/**
 * Plugin shell: secondary sidebar (web) + content. The sidebar hides below
 * the mobile breakpoint (CSS media query — the full mobile layout is K.12);
 * pages own their PageContainer, this layout adds no gutter of its own.
 */
export default function KanbanLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <KanbanSidebar />
      <div className={styles.main}>{children}</div>
    </div>
  );
}
