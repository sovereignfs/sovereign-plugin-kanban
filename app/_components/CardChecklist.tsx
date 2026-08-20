'use client';

import { useState, useTransition, type KeyboardEvent } from 'react';
import { Button, Checkbox, Icon, Input, Typography, useToast } from '@sovereignfs/ui';
import {
  createChecklistItem,
  deleteChecklistItem,
  moveChecklistItem,
  toggleChecklistItem,
} from '../actions';
import type { CardDetail } from '../_lib/queries';
import styles from '../kanban.module.css';

export function CardChecklist({ card }: { card: CardDetail }) {
  const toast = useToast();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const done = card.checklist.filter((i) => i.done).length;
  const total = card.checklist.length;

  function onError(message: string): void {
    toast.show({ title: 'Checklist update failed', message, category: 'error' });
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

      <ul className={styles.checklistItems}>
        {card.checklist.map((item, index) => (
          <li key={item.id} className={styles.checklistRow}>
            <Checkbox
              checked={item.done}
              disabled={pendingId === item.id}
              strikeThrough
              label={item.text}
              onChange={(checked) => {
                setPendingId(item.id);
                void toggleChecklistItem({ itemId: item.id, done: checked })
                  .then((result) => {
                    if (!result.ok) onError(result.error);
                  })
                  .finally(() => setPendingId(null));
              }}
            />
            <div className={styles.checklistRowActions}>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Move up"
                disabled={index === 0 || pendingId === item.id}
                onClick={() => {
                  setPendingId(item.id);
                  void moveChecklistItem({ itemId: item.id, direction: 'up' })
                    .then((result) => {
                      if (!result.ok) onError(result.error);
                    })
                    .finally(() => setPendingId(null));
                }}
              >
                <Icon name="chevron-up" size="sm" aria-hidden={true} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Move down"
                disabled={index === card.checklist.length - 1 || pendingId === item.id}
                onClick={() => {
                  setPendingId(item.id);
                  void moveChecklistItem({ itemId: item.id, direction: 'down' })
                    .then((result) => {
                      if (!result.ok) onError(result.error);
                    })
                    .finally(() => setPendingId(null));
                }}
              >
                <Icon name="chevron-down" size="sm" aria-hidden={true} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Delete "${item.text}"`}
                disabled={pendingId === item.id}
                onClick={() => {
                  setPendingId(item.id);
                  void deleteChecklistItem({ itemId: item.id })
                    .then((result) => {
                      if (!result.ok) onError(result.error);
                    })
                    .finally(() => setPendingId(null));
                }}
              >
                <Icon name="x" size="sm" aria-hidden={true} />
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <ChecklistComposer cardId={card.id} onError={onError} />
    </section>
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
