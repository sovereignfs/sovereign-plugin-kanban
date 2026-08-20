'use client';

import { useActionState, useState } from 'react';
import { ColorPicker, Dialog, FormField, Input, Typography } from '@sovereignfs/ui';
import { updateBoardForm } from '../actions';
import { BOARD_COLOR_NONE, BOARD_COLORS, boardColorValue } from '../_lib/palette';
import type { BoardData } from '../_lib/queries';
import styles from '../kanban.module.css';
import { DialogActions, useCloseOnSuccess } from './form-dialog';

const SWATCHES = BOARD_COLORS.map((c) => ({ label: c.name, value: c.value }));

export function BoardSettingsDialog({
  board,
  onClose,
}: {
  board: BoardData;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateBoardForm, null);
  // Stored as a hex value (or the 'none' sentinel) from here on, regardless
  // of whether the board's own `color` column holds a legacy curated id
  // (older rows) or an already-hex value (new writes, including custom
  // picks) — `boardColorValue` resolves either the same way ColorPicker
  // needs it: a real hex to show as selected/checked.
  const [color, setColor] = useState(
    board.color === BOARD_COLOR_NONE ? BOARD_COLOR_NONE : boardColorValue(board.color),
  );
  useCloseOnSuccess(state, onClose);

  return (
    <Dialog open onClose={onClose} size="sm" title="Board settings" aria-label="Board settings">
      <form action={formAction} className={styles.dialogBody}>
        <Typography variant="h3">Board settings</Typography>
        <input type="hidden" name="boardId" value={board.id} />
        <input type="hidden" name="color" value={color} />
        <FormField label="Name" required>
          {(field) => (
            <Input {...field} name="name" defaultValue={board.name} disabled={pending} />
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
          submitLabel="Save changes"
          pendingLabel="Saving…"
          pending={pending}
        />
      </form>
    </Dialog>
  );
}
