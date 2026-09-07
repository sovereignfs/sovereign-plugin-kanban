'use client';

import { useOptimistic, useState, useTransition } from 'react';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  Icon,
  Input,
  Popover,
  Typography,
  useToast,
} from '@sovereignfs/ui';
import { createLabel, deleteLabel, toggleCardLabel, updateLabel } from '../actions';
import {
  BOARD_COLORS,
  DEFAULT_BOARD_COLOR,
  boardColorValue,
  labelChipClassName,
} from '../_lib/palette';
import type { CardDetail } from '../_lib/queries';
import styles from '../kanban.module.css';

type Label = { id: string; name: string; color: string };

/** A label chip with text that contrasts with its own swatch — see `labelChipClassName`. */
export function LabelChip({ label }: { label: Label }) {
  return (
    <span
      className={[styles.labelChip, labelChipClassName(label.color, styles)]
        .filter(Boolean)
        .join(' ')}
      style={{ backgroundColor: boardColorValue(label.color) }}
    >
      {label.name}
    </span>
  );
}

/**
 * Attach/detach is optimistic — the chip appears/disappears on click, not
 * after the board's full re-render lands. `canEdit` false (K.21) shows the
 * attached chips with no picker.
 */
export function CardLabels({
  card,
  boardId,
  boardLabels,
  canEdit,
}: {
  card: CardDetail;
  boardId: string;
  boardLabels: Label[];
  canEdit: boolean;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [cardLabelIds, dispatch] = useOptimistic(
    new Set(card.labels.map((l) => l.id)),
    (ids: Set<string>, action: { labelId: string; on: boolean }) => {
      const next = new Set(ids);
      if (action.on) next.add(action.labelId);
      else next.delete(action.labelId);
      return next;
    },
  );
  const attached = boardLabels.filter((l) => cardLabelIds.has(l.id));

  function onError(message: string): void {
    toast.show({ title: 'Label update failed', message, category: 'error' });
  }

  return (
    <section className={styles.cardSection}>
      <Typography variant="label">Labels</Typography>
      <div className={styles.labelChipRow}>
        {attached.map((label) => (
          <LabelChip key={label.id} label={label} />
        ))}
        {!canEdit && attached.length === 0 && (
          <Typography variant="caption" className={styles.descriptionPlaceholder}>
            None
          </Typography>
        )}
        {canEdit && (
          <Popover
            trigger={
              attached.length === 0 ? (
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
              onToggle={dispatch}
              onError={onError}
            />
          </Popover>
        )}
      </div>
    </section>
  );
}

function SwatchRow({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  return (
    <div className={styles.swatchRow} role="radiogroup" aria-label="Label color">
      {BOARD_COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={value === c.id}
          aria-label={c.name}
          title={c.name}
          disabled={disabled}
          className={[styles.swatch, value === c.id ? styles.swatchSelected : '']
            .filter(Boolean)
            .join(' ')}
          style={{ backgroundColor: c.value }}
          onClick={() => onChange(c.id)}
        />
      ))}
    </div>
  );
}

function LabelPickerBody({
  boardId,
  cardId,
  boardLabels,
  cardLabelIds,
  onToggle,
  onError,
}: {
  boardId: string;
  cardId: string;
  boardLabels: Label[];
  cardLabelIds: Set<string>;
  onToggle: (action: { labelId: string; on: boolean }) => void;
  onError: (message: string) => void;
}) {
  const [, startToggle] = useTransition();
  const [deleteTarget, setDeleteTarget] = useState<Label | null>(null);
  const [editing, setEditing] = useState<Label | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_BOARD_COLOR);
  const [creating, startCreating] = useTransition();
  const [deleting, startDeleting] = useTransition();

  function toggle(labelId: string, on: boolean): void {
    startToggle(async () => {
      onToggle({ labelId, on });
      const result = await toggleCardLabel({ cardId, labelId, on });
      if (!result.ok) onError(result.error);
    });
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
      {boardLabels.length === 0 && (
        <Typography variant="caption" className={styles.descriptionPlaceholder}>
          No labels on this board yet.
        </Typography>
      )}
      <ul className={styles.labelPickerList}>
        {boardLabels.map((label) =>
          editing?.id === label.id ? (
            <li key={label.id} className={styles.labelEditRow}>
              <LabelEditor label={label} onDone={() => setEditing(null)} onError={onError} />
            </li>
          ) : (
            <li key={label.id} className={styles.labelPickerRow}>
              <Checkbox
                checked={cardLabelIds.has(label.id)}
                label=""
                aria-label={label.name}
                onChange={(checked) => toggle(label.id, checked)}
              />
              <LabelChip label={label} />
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Edit label "${label.name}"`}
                onClick={() => setEditing(label)}
              >
                <Icon name="pencil" size="sm" aria-hidden={true} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Delete label "${label.name}"`}
                onClick={() => setDeleteTarget(label)}
              >
                <Icon name="x" size="sm" aria-hidden={true} />
              </Button>
            </li>
          ),
        )}
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
      <SwatchRow value={color} onChange={setColor} disabled={creating} />
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

/** Inline rename + recolor for an existing label — reflected on every card wearing it. */
function LabelEditor({
  label,
  onDone,
  onError,
}: {
  label: Label;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState(label.color);
  const [pending, startTransition] = useTransition();

  function save(): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (trimmed === label.name && color === label.color) {
      onDone();
      return;
    }
    startTransition(async () => {
      const result = await updateLabel({ labelId: label.id, name: trimmed, color });
      if (result.ok) onDone();
      else onError(result.error);
    });
  }

  return (
    <div className={styles.labelEditor}>
      <Input
        // eslint-disable-next-line jsx-a11y/no-autofocus -- mounts only from the user's own pencil click on this label, never on page load
        autoFocus
        value={name}
        aria-label="Label name"
        disabled={pending}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          else if (e.key === 'Escape') onDone();
        }}
      />
      <SwatchRow value={color} onChange={setColor} disabled={pending} />
      <div className={styles.composerActions}>
        <Button variant="primary" size="sm" onClick={save} loading={pending}>
          Save
        </Button>
        <Button variant="secondary" size="sm" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
