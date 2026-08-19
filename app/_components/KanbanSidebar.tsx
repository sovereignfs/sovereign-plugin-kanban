'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Icon, Typography } from '@sovereignfs/ui';
import type { HomeProject } from '../_lib/queries';
import styles from '../kanban.module.css';
import { DeleteProjectConfirm, EditProjectDialog, NewProjectDialog } from './HomeDialogs';

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
 * (`isCreator`) and "Shared with me" (everything else) — same precedent as
 * `sovereign-plugin-shopper`'s own sidebar ("My lists" header + "+" button,
 * hover-reveal pencil/trash per row). Each project links to its own
 * anchored section on the Home page (`#project-<id>`, `HomeView.tsx`'s
 * `ProjectSection`) rather than a dedicated per-project route, since Kanban
 * doesn't have one.
 *
 * New/edit/delete dialogs are owned entirely here, independent of
 * `HomeView` — every project mutation's server action calls
 * `revalidatePath('/kanban', 'layout')` (`actions.ts`'s `refresh()`), which
 * covers this sidebar's own layout-level data fetch too, so there's no need
 * to thread state between the two sibling trees.
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
  const [editing, setEditing] = useState<HomeProject | null>(null);
  const [deleting, setDeleting] = useState<HomeProject | null>(null);
  const myProjects = projects.filter((p) => p.isCreator);
  const sharedProjects = projects.filter((p) => !p.isCreator);

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

      <div className={styles.sidebarGroup}>
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
          <div key={project.id} className={styles.sidebarProjectRow}>
            <Link href={`/kanban#project-${project.id}`} className={styles.sidebarLink}>
              {project.name}
            </Link>
            <div className={styles.sidebarRowActions}>
              <button
                type="button"
                className={styles.sidebarRowAction}
                aria-label={`Edit ${project.name}`}
                onClick={() => setEditing(project)}
              >
                <Icon name="pencil" size="sm" aria-hidden={true} />
              </button>
              <button
                type="button"
                className={styles.sidebarRowAction}
                aria-label={`Delete ${project.name}`}
                onClick={() => setDeleting(project)}
              >
                <Icon name="trash-2" size="sm" aria-hidden={true} />
              </button>
            </div>
          </div>
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
      {editing && (
        <EditProjectDialog key={editing.id} project={editing} onClose={() => setEditing(null)} />
      )}
      {deleting && (
        <DeleteProjectConfirm
          key={deleting.id}
          project={deleting}
          onClose={() => setDeleting(null)}
        />
      )}
    </nav>
  );
}
