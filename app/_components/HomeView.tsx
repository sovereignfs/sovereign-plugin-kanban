'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button, EmptyState, Icon, Typography } from '@sovereignfs/ui';
import type { HomeProject } from '../_lib/queries';
import { resolveBoardColor } from '../_lib/palette';
import styles from '../kanban.module.css';
import { NewBoardDialog, NewProjectDialog } from './HomeDialogs';

/**
 * "New project" and per-project edit/delete now live in `KanbanSidebar`
 * ("My projects" section), not here — this view only still owns "New
 * board" (per-project, opened from each `ProjectSection`). The empty state
 * keeps its own "New project" CTA/dialog since the sidebar's version isn't
 * a substitute for a first-run affordance placed where the user is looking.
 */
export function HomeView({ projects }: { projects: HomeProject[] }) {
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newBoardFor, setNewBoardFor] = useState<HomeProject | null>(null);

  const empty = projects.length === 0;

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
        projects.map((project) => (
          <ProjectSection
            key={project.id}
            project={project}
            onNewBoard={() => setNewBoardFor(project)}
          />
        ))
      )}

      <NewProjectDialog open={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
      {newBoardFor && (
        <NewBoardDialog
          key={newBoardFor.id}
          project={newBoardFor}
          onClose={() => setNewBoardFor(null)}
        />
      )}
    </>
  );
}

function ProjectSection({
  project,
  onNewBoard,
}: {
  project: HomeProject;
  onNewBoard: () => void;
}) {
  const boardCount = project.boards.length;
  const countLabel =
    boardCount === 1 ? '1 board' : `${boardCount} board${boardCount === 0 ? 's' : 's'}`;

  return (
    <section
      id={`project-${project.id}`}
      className={styles.projectSection}
      aria-label={project.name}
    >
      <div className={styles.projectHeader}>
        <Typography variant="h3" as="h2">
          {project.name}
        </Typography>
        <Typography variant="caption">
          {countLabel}
          {project.isCreator ? '' : ' · shared with you'}
        </Typography>
      </div>

      <div className={styles.projectGrid}>
        {project.boards.map((board) => {
          const resolvedColor = resolveBoardColor(board.color);
          return (
            <Link key={board.id} href={`/kanban/boards/${board.id}`} className={styles.boardCardLink}>
              <div className={styles.boardCardTile}>
                <div
                  className={styles.boardCardBanner}
                  style={resolvedColor ? { backgroundColor: resolvedColor.value } : undefined}
                  aria-hidden
                />
                <div className={styles.boardCardFooter}>
                  <Typography variant="h4" as="span">
                    {board.name}
                  </Typography>
                </div>
              </div>
            </Link>
          );
        })}
        {project.isCreator && (
          <Button variant="ghost" className={styles.newBoardCard} onClick={onNewBoard}>
            <Icon name="plus" size="sm" aria-hidden={true} /> New board
          </Button>
        )}
      </div>
    </section>
  );
}
