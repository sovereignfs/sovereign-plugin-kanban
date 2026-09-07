'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Button, EmptyState, Icon, Typography, useToast } from '@sovereignfs/ui';
import { restoreBoard } from '../actions';
import type { HomeBoard, HomeProject } from '../_lib/queries';
import { resolveBoardColor } from '../_lib/palette';
import styles from '../kanban.module.css';
import type { CurrentUser } from './BoardView';
import { NewBoardDialog, NewProjectDialog } from './HomeDialogs';
import { ManageProjectDialog } from './ManageProjectDialog';

/**
 * "New project" lives here (empty-state CTA); per-project management
 * (edit/share/delete, combined) is the settings-gear icon next to each
 * project's name in `ProjectSection` below — the single entry point.
 *
 * Grouped into "My projects" / "Shared with me", mirroring `KanbanSidebar`'s
 * own split (`role === 'owner'` vs not). `projects` arrives pre-sorted A–Z.
 *
 * Group labels use `variant="label"` (small, uppercase, muted), not a big
 * `h2` — every Typography heading variant shares the same weight, so an h2
 * label above h3 project names read as barely distinguishable. `as="h2"`
 * keeps the real heading level for a11y.
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
  // the (already fresh, re-rendered) `projects` prop below.
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
  const activeBoards = project.boards.filter((b) => b.archivedAt === null);
  const archivedBoards = project.boards.filter((b) => b.archivedAt !== null);
  const boardCount = activeBoards.length;
  const countLabel = boardCount === 1 ? '1 board' : `${boardCount} boards`;
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
        {activeBoards.map((board) => (
          <BoardTile key={board.id} board={board} />
        ))}
        {isOwner && (
          <Button variant="ghost" className={styles.newBoardCard} onClick={onNewBoard}>
            <Icon name="plus" size="sm" aria-hidden={true} /> New board
          </Button>
        )}
      </div>

      {archivedBoards.length > 0 && (
        <ArchivedBoards boards={archivedBoards} projectRole={project.role} />
      )}
    </section>
  );
}

function BoardTile({ board }: { board: HomeBoard }) {
  const resolvedColor = resolveBoardColor(board.color);
  return (
    <Link href={`/kanban/b/${board.id}`} className={styles.boardCardLink}>
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
          {board.description && (
            <span className={styles.boardCardDescription} title={board.description}>
              <Typography variant="caption">{board.description}</Typography>
            </span>
          )}
          {/* K.21 — a board the actor can open but not edit says so up
              front, rather than surprising them with a read-only banner
              after the click. */}
          {board.role === 'viewer' && (
            <span className={styles.viewOnlyBadge}>
              <Icon name="eye" size="xs" aria-hidden={true} />
              View only
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

/**
 * Archived boards sit behind a disclosure under their project — out of the
 * daily grid, but one click from a Restore. Only a board owner or a project
 * owner can restore (`requireBoardManager`); everyone else just sees them.
 */
function ArchivedBoards({
  boards,
  projectRole,
}: {
  boards: HomeBoard[];
  projectRole: HomeProject['role'];
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function restore(board: HomeBoard): void {
    setPendingId(board.id);
    startTransition(async () => {
      const result = await restoreBoard({ boardId: board.id });
      if (!result.ok) {
        toast.show({ title: 'Couldn’t restore board', message: result.error, category: 'error' });
      }
      setPendingId(null);
    });
  }

  return (
    <div className={styles.archivedBoards}>
      <button
        type="button"
        className={styles.archivedBoardsToggle}
        aria-expanded={open}
        aria-label={`${open ? 'Hide' : 'Show'} archived boards`}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size="sm" aria-hidden={true} />
        <Typography variant="caption">
          {boards.length === 1 ? '1 archived board' : `${boards.length} archived boards`}
        </Typography>
      </button>
      {open && (
        <ul className={styles.archivedBoardList}>
          {boards.map((board) => {
            const canRestore = board.role === 'owner' || projectRole === 'owner';
            return (
              <li key={board.id} className={styles.archivedCardRow}>
                <Link href={`/kanban/b/${board.id}`} className={styles.archivedBoardLink}>
                  <Icon name="archive" size="sm" aria-hidden={true} />
                  <Typography variant="body">{board.name}</Typography>
                </Link>
                {canRestore && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pendingId === board.id}
                    onClick={() => restore(board)}
                  >
                    Restore
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
