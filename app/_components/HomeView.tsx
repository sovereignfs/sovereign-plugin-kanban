'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button, EmptyState, Icon, Typography } from '@sovereignfs/ui';
import type { HomeProject } from '../_lib/queries';
import { resolveBoardColor } from '../_lib/palette';
import styles from '../kanban.module.css';
import type { CurrentUser } from './BoardView';
import { NewBoardDialog, NewProjectDialog } from './HomeDialogs';
import { ManageProjectDialog } from './ManageProjectDialog';

/**
 * "New project" lives here (empty-state CTA); per-project management
 * (edit/share/delete, combined) is the settings-gear icon next to each
 * project's name in `ProjectSection` below — the sidebar no longer has its
 * own separate Edit/Delete/Share icons, this is the single entry point.
 *
 * Grouped into "My projects" / "Shared with me", mirroring `KanbanSidebar`'s
 * own split (`role === 'owner'` vs not) — previously a flat list here while
 * the sidebar already had two sections, developer-requested consistency.
 * `projects` itself arrives pre-sorted A–Z (`getHomeData`'s own
 * `localeCompare` sort), so each group's `.filter()` preserves that order
 * without needing its own sort.
 *
 * Group labels use `variant="label"` (small, uppercase, muted), not a big
 * `h2` — every Typography heading variant (h1–h4) shares the same
 * font-weight, differing only in size, so an h2 label sitting directly
 * above h3 project names and h4 board names read as barely distinguishable
 * (developer feedback). `variant="label"` is a genuinely different style
 * axis (colour + case, not just size) and matches `KanbanSidebar`'s own
 * "MY PROJECTS"/"SHARED WITH ME" treatment for the identical semantic
 * content. `as="h2"` keeps the real heading level for a11y while using the
 * label's visual style — same pattern `ProjectSection`'s own project-name
 * heading already uses (`variant="h3" as="h2"`).
 */
export function HomeView({
  projects,
  currentUser,
}: {
  projects: HomeProject[];
  currentUser: CurrentUser;
}) {
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newBoardFor, setNewBoardFor] = useState<HomeProject | null>(null);
  // An id, not a captured project object — the dialog stays open across
  // repeated mutations and needs live data on every render, derived from
  // the (already fresh, re-rendered) `projects` prop below. Storing the
  // object itself reproduced K.8's CardActivity staleness bug once already
  // in this feature's first version (see SPEC.md's K.19 entry) — don't
  // repeat it here.
  const [managingId, setManagingId] = useState<string | null>(null);
  const managingProject = projects.find((p) => p.id === managingId) ?? null;

  const empty = projects.length === 0;
  const myProjects = projects.filter((p) => p.role === 'owner');
  const sharedProjects = projects.filter((p) => p.role !== 'owner');

  return (
    <>
      {empty ? (
        <>
          <EmptyState
            icon="grid-2x2"
            heading="Create your first project"
            description="Projects group your boards — one per team, client, or area of life."
            action={
              <Button variant="primary" onClick={() => setNewProjectOpen(true)}>
                New project
              </Button>
            }
          />
          <div className={styles.centered}>
            <Typography variant="caption">
              Boards shared with you appear here automatically — no setup needed.
            </Typography>
          </div>
        </>
      ) : (
        <>
          <div className={styles.projectGroup}>
            <Typography variant="label" as="h2" className={styles.projectGroupLabel}>
              My projects
            </Typography>
            {myProjects.length === 0 ? (
              <Typography variant="caption" className={styles.projectGroupEmpty}>
                You haven&apos;t created a project yet
              </Typography>
            ) : (
              myProjects.map((project) => (
                <ProjectSection
                  key={project.id}
                  project={project}
                  onNewBoard={() => setNewBoardFor(project)}
                  onManage={() => setManagingId(project.id)}
                />
              ))
            )}
          </div>

          <div className={styles.projectGroup}>
            <Typography variant="label" as="h2" className={styles.projectGroupLabel}>
              Shared with me
            </Typography>
            {sharedProjects.length === 0 ? (
              <Typography variant="caption" className={styles.projectGroupEmpty}>
                Nothing shared with you yet
              </Typography>
            ) : (
              sharedProjects.map((project) => (
                <ProjectSection
                  key={project.id}
                  project={project}
                  onNewBoard={() => setNewBoardFor(project)}
                  onManage={() => setManagingId(project.id)}
                />
              ))
            )}
          </div>
        </>
      )}

      <NewProjectDialog open={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
      {newBoardFor && (
        <NewBoardDialog
          key={newBoardFor.id}
          project={newBoardFor}
          onClose={() => setNewBoardFor(null)}
        />
      )}
      {managingProject && (
        <ManageProjectDialog
          key={managingProject.id}
          project={managingProject}
          currentUser={currentUser}
          onClose={() => setManagingId(null)}
        />
      )}
    </>
  );
}

function ProjectSection({
  project,
  onNewBoard,
  onManage,
}: {
  project: HomeProject;
  onNewBoard: () => void;
  onManage: () => void;
}) {
  const boardCount = project.boards.length;
  const countLabel =
    boardCount === 1 ? '1 board' : `${boardCount} board${boardCount === 0 ? 's' : 's'}`;
  const isOwner = project.role === 'owner';

  return (
    <section
      id={`project-${project.id}`}
      className={styles.projectSection}
      aria-label={project.name}
    >
      <div className={styles.projectHeader}>
        <div className={styles.projectTitleColumn}>
          <div className={styles.projectTitleRow}>
            <Typography variant="h3" as="h2">
              {project.name}
            </Typography>
            <Typography variant="caption">
              {countLabel}
              {isOwner ? '' : ' · shared with you'}
            </Typography>
          </div>
          {project.description && (
            <Typography variant="caption" className={styles.projectDescription}>
              {project.description}
            </Typography>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className={styles.projectManageButton}
          aria-label={isOwner ? `Manage ${project.name}` : `${project.name} members`}
          onClick={onManage}
        >
          <Icon name="settings" size="xs" aria-hidden={true} />
        </Button>
      </div>

      <div className={styles.projectGrid}>
        {project.boards.map((board) => {
          const resolvedColor = resolveBoardColor(board.color);
          return (
            <Link key={board.id} href={`/kanban/b/${board.id}`} className={styles.boardCardLink}>
              <div className={styles.boardCardTile}>
                <div
                  className={styles.boardCardBanner}
                  style={resolvedColor ? { backgroundColor: resolvedColor.value } : undefined}
                  aria-hidden
                />
                <div className={styles.boardCardFooter}>
                  <Typography variant="h4" as="span" className={styles.boardCardName}>
                    {board.name}
                  </Typography>
                </div>
              </div>
            </Link>
          );
        })}
        {isOwner && (
          <Button variant="ghost" className={styles.newBoardCard} onClick={onNewBoard}>
            <Icon name="plus" size="sm" aria-hidden={true} /> New board
          </Button>
        )}
      </div>
    </section>
  );
}
