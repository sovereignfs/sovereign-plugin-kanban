'use client';

import { useActionState, useState } from 'react';
import { ColorPicker, Dialog, FormField, Input, Textarea, Typography } from '@sovereignfs/ui';
import { createBoardForm, createProjectForm } from '../actions';
import { BOARD_COLOR_NONE, BOARD_COLORS, DEFAULT_BOARD_COLOR, boardColorValue } from '../_lib/palette';
import type { HomeProject } from '../_lib/queries';
import styles from '../kanban.module.css';
import { DialogActions, useCloseOnSuccess } from './form-dialog';

const SWATCHES = BOARD_COLORS.map((c) => ({ label: c.name, value: c.value }));

export function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [state, formAction, pending] = useActionState(createProjectForm, null);
  useCloseOnSuccess(state, onClose);

  return (
    <Dialog open={open} onClose={onClose} size="sm" title="New project" aria-label="New project">
      <form action={formAction} className={styles.dialogBody}>
        <Typography variant="h3">New project</Typography>
        <FormField label="Name" required>
          {(field) => (
            <Input {...field} name="name" placeholder="e.g. Marketing" disabled={pending} />
          )}
        </FormField>
        <FormField label="Description" hint="Optional">
          {(field) => (
            <Textarea
              {...field}
              name="description"
              rows={3}
              placeholder="What is this project for?"
              disabled={pending}
            />
          )}
        </FormField>
        {state && !state.ok && <p className={styles.formError}>{state.error}</p>}
        <DialogActions
          onCancel={onClose}
          submitLabel="Create project"
          pendingLabel="Creating…"
          pending={pending}
        />
      </form>
    </Dialog>
  );
}

export function NewBoardDialog({
  project,
  onClose,
}: {
  project: HomeProject;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(createBoardForm, null);
  const [color, setColor] = useState(boardColorValue(DEFAULT_BOARD_COLOR));
  useCloseOnSuccess(state, onClose);

  return (
    <Dialog open onClose={onClose} size="sm" title="New board" aria-label="New board">
      <form action={formAction} className={styles.dialogBody}>
        <div>
          <Typography variant="h3">New board</Typography>
          <Typography variant="caption">in {project.name}</Typography>
        </div>
        <input type="hidden" name="projectId" value={project.id} />
        <input type="hidden" name="color" value={color} />
        <FormField label="Name" required>
          {(field) => (
            <Input
              {...field}
              name="name"
              placeholder="e.g. Website relaunch"
              disabled={pending}
            />
          )}
        </FormField>
        <FormField label="Color">
          {() => (
            <ColorPicker
              swatches={SWATCHES}
              value={color === BOARD_COLOR_NONE ? null : color}
              onChange={(value) => setColor(value ?? BOARD_COLOR_NONE)}
              allowNone
              disabled={pending}
              aria-label="Board color"
            />
          )}
        </FormField>
        {state && !state.ok && <p className={styles.formError}>{state.error}</p>}
        <DialogActions
          onCancel={onClose}
          submitLabel="Create board"
          pendingLabel="Creating…"
          pending={pending}
        />
      </form>
    </Dialog>
  );
}
