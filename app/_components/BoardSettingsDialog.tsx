'use client';

import { useActionState, useState } from 'react';
import { Dialog, FormField, Input, Typography } from '@sovereignfs/ui';
import { updateBoardForm } from '../actions';
import { BOARD_COLORS } from '../_lib/palette';
import type { BoardData } from '../_lib/queries';
import styles from '../kanban.module.css';
import { DialogActions, useCloseOnSuccess } from './form-dialog';

export function BoardSettingsDialog({
  board,
  onClose,
}: {
  board: BoardData;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateBoardForm, null);
  const [color, setColor] = useState(board.color);
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
            <div className={styles.swatchRow} role="radiogroup" aria-label="Board color">
              {BOARD_COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={color === c.id}
                  aria-label={c.name}
                  title={c.name}
                  disabled={pending}
                  className={[styles.swatch, color === c.id ? styles.swatchSelected : '']
                    .filter(Boolean)
                    .join(' ')}
                  style={{ backgroundColor: c.value }}
                  onClick={() => setColor(c.id)}
                />
              ))}
            </div>
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
