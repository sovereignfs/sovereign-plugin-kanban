'use client';

import { useState, useTransition, type KeyboardEvent } from 'react';
import { Button, Input, useToast } from '@sovereignfs/ui';
import { createList } from '../actions';
import styles from '../kanban.module.css';

/**
 * Trailing "Add list" control. Has its own always-visible Add/Cancel
 * buttons once expanded, so per the platform's quick-entry rule this is the
 * documented exception — commit on Enter or the Add button, not on blur
 * (blur alone just collapses the composer, discarding a stray draft).
 *
 * No imperative refocus after a successful add: `Input` doesn't forward
 * refs, and none is needed — the field stays mounted and focused across
 * successive submits (nothing blurs it), so the browser's own focus state
 * already supports fast repeated entry.
 */
export function AddListSlot({
  boardId,
  variant,
}: {
  boardId: string;
  variant: 'inline' | 'empty';
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [pending, startTransition] = useTransition();

  function commit(): void {
    const name = value.trim();
    if (!name) {
      setOpen(false);
      setValue('');
      return;
    }
    startTransition(async () => {
      const result = await createList({ boardId, name });
      if (result.ok) {
        setValue('');
      } else {
        toast.show({ title: 'Couldn’t add list', message: result.error, category: 'error' });
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
        variant={variant === 'inline' ? 'ghost' : 'primary'}
        className={variant === 'inline' ? styles.addListCard : undefined}
        onClick={() => setOpen(true)}
      >
        + Add list
      </Button>
    );
  }

  return (
    <div className={variant === 'inline' ? styles.addListComposerInline : styles.addListComposer}>
      <Input
        // eslint-disable-next-line jsx-a11y/no-autofocus -- mounts only from the user's own "+ Add list" click, never on page load
        autoFocus
        value={value}
        placeholder="List name"
        disabled={pending}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className={styles.composerActions}>
        <Button size="sm" variant="primary" onClick={commit} loading={pending}>
          Add list
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
