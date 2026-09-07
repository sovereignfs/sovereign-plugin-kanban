'use client';

import { useOptimistic, useState, useTransition, type KeyboardEvent } from 'react';
import {
  Button,
  Checkbox,
  Icon,
  Input,
  Typography,
  useCommitOnEnterOrBlur,
  useToast,
} from '@sovereignfs/ui';
import {
  createChecklistItem,
  deleteChecklistItem,
  moveChecklistItem,
  toggleChecklistItem,
  updateChecklistItem,
} from '../actions';
import type { CardDetail } from '../_lib/queries';
import styles from '../kanban.module.css';

type Item = CardDetail['checklist'][number];
type ChecklistAction =
  { type: 'toggle'; id: string; done: boolean } | { type: 'text'; id: string; text: string };

function applyChecklistAction(items: Item[], action: ChecklistAction): Item[] {
  return items.map((item) => {
    if (item.id !== action.id) return item;
    return action.type === 'toggle'
      ? { ...item, done: action.done }
      : { ...item, text: action.text };
  });
}

/**
 * Toggling is optimistic (`useOptimistic` over `card.checklist`): the box
 * flips and the progress bar moves on click, not after the server's full
 * board re-render lands (0.5–1.6s observed). A failed toggle reverts with a
 * toast. Items are editable in place (pencil → inline input). `canEdit`
 * false (K.21) renders the list and progress bar only.
 */
export function CardChecklist({ card, canEdit }: { card: CardDetail; canEdit: boolean }) {
  const toast = useToast();
  const [items, dispatch] = useOptimistic(card.checklist, applyChecklistAction);
  const [, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const done = items.filter((i) => i.done).length;
  const total = items.length;

  function onError(message: string): void {
    toast.show({ title: 'Checklist update failed', message, category: 'error' });
  }

  function toggle(item: Item, checked: boolean): void {
    startTransition(async () => {
      dispatch({ type: 'toggle', id: item.id, done: checked });
      const result = await toggleChecklistItem({ itemId: item.id, done: checked });
      if (!result.ok) onError(result.error);
    });
  }

  function run(id: string, call: Promise<{ ok: boolean; error?: string }>): void {
    setPendingId(id);
    void call
      .then((result) => {
        if (!result.ok) onError(result.error ?? 'Try again.');
      })
      .finally(() => setPendingId(null));
  }

  return (
    <section className={styles.cardSection}>
      <div className={styles.cardSectionHeader}>
        <Typography variant="label">Checklist</Typography>
        {total > 0 && (
          <Typography variant="caption">
            {done}/{total}
          </Typography>
        )}
      </div>

      {total > 0 && (
        <div className={styles.checklistProgress} aria-hidden>
          <div
            className={styles.checklistProgressFill}
            style={{ width: `${Math.round((done / total) * 100)}%` }}
          />
        </div>
      )}

      {total === 0 && !canEdit && (
        <Typography variant="caption" className={styles.descriptionPlaceholder}>
          No checklist items.
        </Typography>
      )}

      <ul className={styles.checklistItems}>
        {items.map((item, index) => (
          <li key={item.id} className={styles.checklistRow}>
            {editingId === item.id ? (
              <ChecklistItemEditor
                item={item}
                onSaved={(text) => {
                  setEditingId(null);
                  startTransition(async () => {
                    dispatch({ type: 'text', id: item.id, text });
                    const result = await updateChecklistItem({ itemId: item.id, text });
                    if (!result.ok) onError(result.error);
                  });
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <Checkbox
                checked={item.done}
                disabled={!canEdit || pendingId === item.id}
                strikeThrough
                label={item.text}
                onChange={(checked) => toggle(item, checked)}
              />
            )}
            {canEdit && editingId !== item.id && (
              <div className={styles.checklistRowActions}>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Edit "${item.text}"`}
                  disabled={pendingId === item.id}
                  onClick={() => setEditingId(item.id)}
                >
                  <Icon name="pencil" size="sm" aria-hidden={true} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Move up"
                  disabled={index === 0 || pendingId === item.id}
                  onClick={() =>
                    run(item.id, moveChecklistItem({ itemId: item.id, direction: 'up' }))
                  }
                >
                  <Icon name="chevron-up" size="sm" aria-hidden={true} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Move down"
                  disabled={index === items.length - 1 || pendingId === item.id}
                  onClick={() =>
                    run(item.id, moveChecklistItem({ itemId: item.id, direction: 'down' }))
                  }
                >
                  <Icon name="chevron-down" size="sm" aria-hidden={true} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete "${item.text}"`}
                  disabled={pendingId === item.id}
                  onClick={() => run(item.id, deleteChecklistItem({ itemId: item.id }))}
                >
                  <Icon name="x" size="sm" aria-hidden={true} />
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {canEdit && <ChecklistComposer cardId={card.id} onError={onError} />}
    </section>
  );
}

function ChecklistItemEditor({
  item,
  onSaved,
  onCancel,
}: {
  item: Item;
  onSaved: (text: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(item.text);

  function commit(): void {
    const text = value.trim();
    if (!text || text === item.text) {
      onCancel();
      return;
    }
    onSaved(text);
  }

  const handlers = useCommitOnEnterOrBlur(commit);

  return (
    <Input
      // eslint-disable-next-line jsx-a11y/no-autofocus -- mounts only from the user's own pencil click on this item, never on page load
      autoFocus
      value={value}
      aria-label="Checklist item"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          onCancel();
          return;
        }
        handlers.onKeyDown(e);
      }}
      onBlur={handlers.onBlur}
    />
  );
}

function ChecklistComposer({
  cardId,
  onError,
}: {
  cardId: string;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [pending, startTransition] = useTransition();

  function commit(): void {
    const text = value.trim();
    if (!text) {
      setOpen(false);
      setValue('');
      return;
    }
    startTransition(async () => {
      const result = await createChecklistItem({ cardId, text });
      if (result.ok) setValue('');
      else {
        onError(result.error);
        setOpen(false);
      }
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') {
      setValue('');
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <Button
        variant="ghost"
        className={`${styles.addCardTrigger} ${styles.checklistAddTrigger}`}
        onClick={() => setOpen(true)}
      >
        + Add an item
      </Button>
    );
  }

  return (
    <div className={styles.addCardComposer}>
      <Input
        // eslint-disable-next-line jsx-a11y/no-autofocus -- mounts only from the user's own "+ Add an item" click, never on page load
        autoFocus
        value={value}
        placeholder="Checklist item"
        disabled={pending}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className={styles.composerActions}>
        <Button size="sm" variant="primary" onClick={commit} loading={pending}>
          Add
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setValue('');
            setOpen(false);
          }}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
