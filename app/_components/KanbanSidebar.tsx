'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Icon, Typography } from '@sovereignfs/ui';
import type { HomeProject } from '../_lib/queries';
import styles from '../kanban.module.css';
import { NewProjectDialog } from './HomeDialogs';

/** Plugin-local secondary nav (same precedent as Console's section nav). */
const NAV = [
  { href: '/kanban', label: 'Boards', icon: 'grid-2x2' as const },
  { href: '/kanban/inbox', label: 'Inbox', icon: 'bell' as const },
];

/**
 * Scoped to the Home/Inbox routes only (their own `(home)/layout.tsx`) —
 * Board View has no secondary sidebar. The "back to Launcher" affordance
 * (minimal-shell nav convention) now lives in `KanbanHeader`, which renders
 * on every page, so it doesn't need to be duplicated here too.
 *
 * Below the Boards/Inbox nav, `projects` is split into "My projects"
 * (`role === 'owner'`) and "Shared with me" (`role === 'member'`) — same
 * precedent as `sovereign-plugin-shopper`'s own sidebar. Grouped by
 * `kanban_project_members` role (K.18/K.19), not `isCreator` — a project
 * supports co-owners. Each project links to its own anchored section on the
 * Home page (`#project-<id>`, `HomeView.tsx`'s `ProjectSection`) rather
 * than a dedicated per-project route, since Kanban doesn't have one.
 *
 * Rows are plain links, no per-row icons — a previous iteration had
 * hover-reveal Share/Edit/Delete icons here, but they became a second,
 * inconsistent entry point once `HomeView`'s project header grew a single
 * combined "Manage" affordance (settings gear, covering edit + share +
 * delete). That gear icon is now the only project-management entry point;
 * the sidebar is pure navigation. Only "New project" (the "+" button) still
 * lives here, since it isn't a per-project action.
 */
export function KanbanSidebar({
  hasUnseenInbox,
  projects,
}: {
  hasUnseenInbox: boolean;
  projects: HomeProject[];
}) {
  const pathname = usePathname();
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const myProjects = projects.filter((p) => p.role === 'owner');
  const sharedProjects = projects.filter((p) => p.role !== 'owner');

  return (
    <nav className={styles.sidebar} aria-label="Kanban sections">
      {NAV.map((item) => {
        const active =
          item.href === '/kanban'
            ? pathname === '/kanban' || pathname.startsWith('/kanban/b')
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

      <div className={styles.sidebarDivider} />

      <div className={`${styles.sidebarGroup} ${styles.sidebarGroupAfterDivider}`}>
        <div className={styles.sidebarGroupHeader}>
          <Typography variant="label" className={styles.sidebarGroupLabel}>
            My projects
          </Typography>
          <button
            type="button"
            className={styles.sidebarGroupAddButton}
            aria-label="New project"
            onClick={() => setNewProjectOpen(true)}
          >
            <Icon name="plus" size="sm" aria-hidden={true} />
          </button>
        </div>
        {myProjects.map((project) => (
          <Link
            key={project.id}
            href={`/kanban#project-${project.id}`}
            className={styles.sidebarLink}
          >
            {project.name}
          </Link>
        ))}
      </div>

      <div className={styles.sidebarGroup}>
        <Typography variant="label" className={styles.sidebarGroupLabel}>
          Shared with me
        </Typography>
        {sharedProjects.length === 0 ? (
          <Typography variant="caption" className={styles.sidebarGroupEmpty}>
            Nothing shared with you yet
          </Typography>
        ) : (
          sharedProjects.map((project) => (
            <Link
              key={project.id}
              href={`/kanban#project-${project.id}`}
              className={styles.sidebarLink}
            >
              {project.name}
            </Link>
          ))
        )}
      </div>

      <NewProjectDialog open={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
    </nav>
  );
}
