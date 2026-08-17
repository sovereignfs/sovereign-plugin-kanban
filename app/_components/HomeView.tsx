'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Icon,
  Menu,
  PageHeader,
  Typography,
} from '@sovereignfs/ui';
import { deleteProject } from '../actions';
import type { HomeProject } from '../_lib/queries';
import { boardColorValue } from '../_lib/palette';
import styles from '../kanban.module.css';
import { EditProjectDialog, NewBoardDialog, NewProjectDialog } from './HomeDialogs';

export function HomeView({ projects }: { projects: HomeProject[] }) {
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newBoardFor, setNewBoardFor] = useState<HomeProject | null>(null);
  const [editing, setEditing] = useState<HomeProject | null>(null);
  const [deleting, setDeleting] = useState<HomeProject | null>(null);

  const empty = projects.length === 0;

  return (
    <>
      <PageHeader
        title="Boards"
        headingLevel={1}
        action={
          empty ? undefined : (
            <Button variant="primary" onClick={() => setNewProjectOpen(true)}>
              New project
            </Button>
          )
        }
      />

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
            onEdit={() => setEditing(project)}
            onDelete={() => setDeleting(project)}
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
      {editing && (
        <EditProjectDialog key={editing.id} project={editing} onClose={() => setEditing(null)} />
      )}
      {deleting && (
        <DeleteProjectConfirm project={deleting} onClose={() => setDeleting(null)} />
      )}
    </>
  );
}

function ProjectSection({
  project,
  onNewBoard,
  onEdit,
  onDelete,
}: {
  project: HomeProject;
  onNewBoard: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const boardCount = project.boards.length;
  const countLabel =
    boardCount === 1 ? '1 board' : `${boardCount} board${boardCount === 0 ? 's' : 's'}`;

  return (
    <section className={styles.projectSection} aria-label={project.name}>
      <div className={styles.projectHeader}>
        <Typography variant="h3" as="h2">
          {project.name}
        </Typography>
        <Typography variant="caption">
          {countLabel}
          {project.isCreator ? '' : ' · shared with you'}
        </Typography>
        <span className={styles.projectHeaderSpacer} />
        {project.isCreator && (
          <Menu
            trigger={
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Options for ${project.name}`}
                onClick={() => setMenuOpen((v) => !v)}
              >
                <Icon name="ellipsis-vertical" size="sm" aria-hidden={true} />
              </Button>
            }
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            align="right"
            aria-label={`${project.name} options`}
            items={[
              { label: 'Edit project', icon: 'pencil', onSelect: onEdit },
              { type: 'separator' },
              { label: 'Delete project', icon: 'trash-2', destructive: true, onSelect: onDelete },
            ]}
          />
        )}
      </div>

      <div className={styles.projectGrid}>
        {project.boards.map((board) => (
          <Link key={board.id} href={`/kanban/boards/${board.id}`} className={styles.boardCardLink}>
            <Card interactive padding="md">
              <div className={styles.boardCardBody}>
                <span
                  className={styles.boardColorChip}
                  style={{ backgroundColor: boardColorValue(board.color) }}
                  aria-hidden
                />
                <Typography variant="h4" as="span">
                  {board.name}
                </Typography>
              </div>
            </Card>
          </Link>
        ))}
        {project.isCreator && (
          <Button variant="ghost" className={styles.newBoardCard} onClick={onNewBoard}>
            <Icon name="plus" size="sm" aria-hidden={true} /> New board
          </Button>
        )}
      </div>
    </section>
  );
}

function DeleteProjectConfirm({
  project,
  onClose,
}: {
  project: HomeProject;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const boardCount = project.boards.length;

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={`Delete "${project.name}"?`}
      message={
        <>
          This deletes the project{' '}
          {boardCount > 0
            ? `and its ${boardCount === 1 ? 'board' : `${boardCount} boards`}, including every list, card, and comment on them. `
            : 'permanently. '}
          This can&apos;t be undone.
        </>
      }
      destructive
      confirmLabel={pending ? 'Deleting…' : 'Delete project'}
      pending={pending}
      error={error}
      onConfirm={() => {
        setError(null);
        startTransition(async () => {
          const result = await deleteProject({ projectId: project.id });
          if (result.ok) onClose();
          else setError(result.error);
        });
      }}
    />
  );
}
