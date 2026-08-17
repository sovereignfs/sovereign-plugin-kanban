'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@sovereignfs/ui';
import styles from '../kanban.module.css';

/** Plugin-local secondary nav (same precedent as Console's section nav). */
const NAV = [
  { href: '/kanban', label: 'Boards', icon: 'grid-2x2' as const },
  { href: '/kanban/inbox', label: 'Inbox', icon: 'bell' as const },
];

export function KanbanSidebar({ hasUnseenInbox }: { hasUnseenInbox: boolean }) {
  const pathname = usePathname();
  return (
    <nav className={styles.sidebar} aria-label="Kanban sections">
      {NAV.map((item) => {
        const active =
          item.href === '/kanban'
            ? pathname === '/kanban' || pathname.startsWith('/kanban/boards')
            : pathname.startsWith(item.href);
        const showUnseenBadge = item.href === '/kanban/inbox' && hasUnseenInbox;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={[styles.sidebarLink, active ? styles.sidebarLinkActive : '']
              .filter(Boolean)
              .join(' ')}
            aria-current={active ? 'page' : undefined}
          >
            <Icon name={item.icon} size="sm" aria-hidden={true} />
            {item.label}
            {showUnseenBadge && <span className={styles.sidebarUnseenBadge} aria-label="Unseen activity" />}
          </Link>
        );
      })}
    </nav>
  );
}
