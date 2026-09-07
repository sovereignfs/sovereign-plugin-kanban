'use client';

import { useActionState, useState } from 'react';
import {
  ColorPicker,
  Dialog,
  FormField,
  Input,
  SegmentedControl,
  Textarea,
  Typography,
} from '@sovereignfs/ui';
import { updateBoardForm } from '../actions';
import { BOARD_COLOR_NONE, BOARD_COLORS, boardColorValue } from '../_lib/palette';
import type { BoardData } from '../_lib/queries';
import styles from '../kanban.module.css';
import { DialogActions, useCloseOnSuccess } from './form-dialog';

const SWATCHES = BOARD_COLORS.map((c) => ({ label: c.name, value: c.value }));

/**
 * Name, description, colour, and (K.20) the board's own visibility flag.
 * Opened by a board owner or a project owner (`board.canManage`). Archive
 * and delete live in the board menu, not here — they're one-off actions,
 * not settings to save.
 */
export function BoardSettingsDialog({ board, onClose }: { board: BoardData; onClose: () => void }) {
  const [state, formAction, pending] = useActionState(updateBoardForm, null);
  // Stored as a hex value (or the 'none' sentinel) from here on, regardless
  // of whether the board's own `color` column holds a legacy curated id or
  // an already-hex value — `boardColorValue` resolves either the same way
  // ColorPicker needs it.
  const [color, setColor] = useState(
    board.color === BOARD_COLOR_NONE ? BOARD_COLOR_NONE : boardColorValue(board.color),
  );
  const [visibility, setVisibility] = useState<'public' | 'private'>(
    board.visibility === 'private' ? 'private' : 'public',
  );
  useCloseOnSuccess(state, onClose);

  return (
    <Dialog open onClose={onClose} size="sm" title="Board settings" aria-label="Board settings">
      <form action={formAction} className={styles.dialogBody}>
        <Typography variant="h3">Board settings</Typography>
        <input type="hidden" name="boardId" value={board.id} />
        <input type="hidden" name="color" value={color} />
        <input type="hidden" name="visibility" value={visibility} />
        <FormField label="Name" required>
          {(field) => <Input {...field} name="name" defaultValue={board.name} disabled={pending} />}
        </FormField>
        <FormField label="Description" hint="Optional — shown under the board title">
          {(field) => (
            <Textarea
              {...field}
              name="description"
              rows={2}
              defaultValue={board.description ?? ''}
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
        <FormField
          label="Visibility"
          className={styles.visibilityField}
          hint={
            visibility === 'public'
              ? 'Any project member can view this board (read-only unless added to it). Ignored while the project is private.'
              : 'Only board members and project owners can see this board.'
          }
        >
          {() => (
            <SegmentedControl
              aria-label="Board visibility"
              value={visibility}
              onChange={(value) => setVisibility(value === 'private' ? 'private' : 'public')}
              options={[
                { label: 'Public', value: 'public' },
                { label: 'Private', value: 'private' },
              ]}
            />
          )}
        </FormField>
        {state && !state.ok && <p className={styles.formError}>{state.error}</p>}
        <DialogActions
          onCancel={onClose}
          submitLabel="Save changes"
          pendingLabel="Saving…"
          pending={pending}
        />
      </form>
    </Dialog>
  );
}
