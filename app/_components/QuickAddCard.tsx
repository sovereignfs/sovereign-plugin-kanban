'use client';

import { useState, useTransition, type KeyboardEvent } from 'react';
import { Button, Input, useToast } from '@sovereignfs/ui';
import { createCard } from '../actions';
import styles from '../kanban.module.css';

/**
 * Per-list "Add a card" composer. Same always-visible-Add-button exception
 * as AddListSlot — commits on Enter or the Add button, blur just collapses.
 * `open` is controlled so the list's "Add card" menu item can reveal it.
 */
export function QuickAddCard({
  listId,
  open,
  onOpenChange,
}: {
  listId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const toast = useToast();
  const [value, setValue] = useState('');
  const [pending, startTransition] = useTransition();

  function commit(): void {
    const title = value.trim();
    if (!title) {
      onOpenChange(false);
      setValue('');
      return;
    }
    startTransition(async () => {
      const result = await createCard({ listId, title });
      if (result.ok) {
        setValue('');
      } else {
        toast.show({ title: 'Couldn’t add card', message: result.error, category: 'error' });
        onOpenChange(false);
      }
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') {
      setValue('');
      onOpenChange(false);
    }
  }

  if (!open) {
    return (
      <Button variant="ghost" className={styles.addCardTrigger} onClick={() => onOpenChange(true)}>
        + Add a card
      </Button>
    );
  }

  return (
    <div className={styles.addCardComposer}>
      <Input
        // eslint-disable-next-line jsx-a11y/no-autofocus -- mounts only from the user's own "+ Add a card" click (or the list menu's "Add card"), never on page load
        autoFocus
        value={value}
        placeholder="Card title"
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
            onOpenChange(false);
          }}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
