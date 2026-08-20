'use client';

import { useState, useTransition } from 'react';
import { Button, Checkbox, ConfirmDialog, Icon, Input, Popover, Typography, useToast } from '@sovereignfs/ui';
import { createLabel, deleteLabel, toggleCardLabel } from '../actions';
import { BOARD_COLORS, DEFAULT_BOARD_COLOR, boardColorValue } from '../_lib/palette';
import type { CardDetail } from '../_lib/queries';
import styles from '../kanban.module.css';

export function CardLabels({
  card,
  boardId,
  boardLabels,
}: {
  card: CardDetail;
  boardId: string;
  boardLabels: Array<{ id: string; name: string; color: string }>;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const cardLabelIds = new Set(card.labels.map((l) => l.id));

  function onError(message: string): void {
    toast.show({ title: 'Label update failed', message, category: 'error' });
  }

  return (
    <section className={styles.cardSection}>
      <Typography variant="label">Labels</Typography>
      <div className={styles.labelChipRow}>
        {card.labels.map((label) => (
          <span
            key={label.id}
            className={styles.labelChip}
            style={{ backgroundColor: boardColorValue(label.color) }}
          >
            {label.name}
          </span>
        ))}
        <Popover
          trigger={
            card.labels.length === 0 ? (
              <Button
                variant="ghost"
                size="sm"
                aria-label="Add labels"
                onClick={() => setOpen((v) => !v)}
                className={styles.chipAddTextButton}
              >
                <Icon name="plus" size="sm" aria-hidden={true} />
                Add label
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                aria-label="Edit labels"
                onClick={() => setOpen((v) => !v)}
                className={styles.chipAddButton}
              >
                <Icon name="plus" size="sm" aria-hidden={true} />
              </Button>
            )
          }
          open={open}
          onClose={() => setOpen(false)}
          align="left"
          aria-label="Edit labels"
        >
          <LabelPickerBody
            boardId={boardId}
            cardId={card.id}
            boardLabels={boardLabels}
            cardLabelIds={cardLabelIds}
            onError={onError}
          />
        </Popover>
      </div>
    </section>
  );
}

function LabelPickerBody({
  boardId,
  cardId,
  boardLabels,
  cardLabelIds,
  onError,
}: {
  boardId: string;
  cardId: string;
  boardLabels: Array<{ id: string; name: string; color: string }>;
  cardLabelIds: Set<string>;
  onError: (message: string) => void;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_BOARD_COLOR);
  const [creating, startCreating] = useTransition();
  const [deleting, startDeleting] = useTransition();

  function toggle(labelId: string, on: boolean): void {
    setPendingId(labelId);
    void toggleCardLabel({ cardId, labelId, on })
      .then((result) => {
        if (!result.ok) onError(result.error);
      })
      .finally(() => setPendingId(null));
  }

  function submitCreate(): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    startCreating(async () => {
      const result = await createLabel({ boardId, name: trimmed, color });
      if (result.ok) {
        setName('');
        setColor(DEFAULT_BOARD_COLOR);
      } else {
        onError(result.error);
      }
    });
  }

  return (
    <div className={styles.labelPicker}>
      <Typography variant="label">Labels</Typography>
      <ul className={styles.labelPickerList}>
        {boardLabels.map((label) => (
          <li key={label.id} className={styles.labelPickerRow}>
            <Checkbox
              checked={cardLabelIds.has(label.id)}
              disabled={pendingId === label.id}
              label=""
              aria-label={label.name}
              onChange={(checked) => toggle(label.id, checked)}
            />
            <span
              className={styles.labelChip}
              style={{ backgroundColor: boardColorValue(label.color) }}
            >
              {label.name}
            </span>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Delete label "${label.name}"`}
              onClick={() => setDeleteTarget({ id: label.id, name: label.name })}
            >
              <Icon name="x" size="sm" aria-hidden={true} />
            </Button>
          </li>
        ))}
      </ul>

      <div className={styles.labelPickerDivider} />

      <Typography variant="label">New label</Typography>
      <Input
        value={name}
        placeholder="Label name"
        disabled={creating}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submitCreate();
        }}
      />
      <div className={styles.swatchRow}>
        {BOARD_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={color === c.id}
            aria-label={c.name}
            title={c.name}
            disabled={creating}
            className={[styles.swatch, color === c.id ? styles.swatchSelected : '']
              .filter(Boolean)
              .join(' ')}
            style={{ backgroundColor: c.value }}
            onClick={() => setColor(c.id)}
          />
        ))}
      </div>
      <Button variant="primary" size="sm" onClick={submitCreate} loading={creating}>
        Create label
      </Button>

      {deleteTarget && (
        <ConfirmDialog
          open
          onClose={() => setDeleteTarget(null)}
          title={`Delete "${deleteTarget.name}"?`}
          message="This removes the label from every card on this board. This can't be undone."
          destructive
          confirmLabel={deleting ? 'Deleting…' : 'Delete label'}
          pending={deleting}
          onConfirm={() => {
            startDeleting(async () => {
              const result = await deleteLabel({ labelId: deleteTarget.id });
              if (!result.ok) onError(result.error);
              setDeleteTarget(null);
            });
          }}
        />
      )}
    </div>
  );
}
