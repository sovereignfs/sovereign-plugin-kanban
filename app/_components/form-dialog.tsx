'use client';

import { useEffect } from 'react';
import { Button } from '@sovereignfs/ui';
import type { ActionResult } from '../_lib/action-result';
import styles from '../kanban.module.css';

/** Close a `useActionState`-driven dialog once its action reports success. */
export function useCloseOnSuccess(state: ActionResult | null, onClose: () => void): void {
  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);
}

export function DialogActions({
  onCancel,
  submitLabel,
  pendingLabel,
  pending,
}: {
  onCancel: () => void;
  submitLabel: string;
  pendingLabel: string;
  pending: boolean;
}) {
  return (
    <div className={styles.dialogActions}>
      <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>
        Cancel
      </Button>
      <Button type="submit" variant="primary" loading={pending}>
        {pending ? pendingLabel : submitLabel}
      </Button>
    </div>
  );
}
