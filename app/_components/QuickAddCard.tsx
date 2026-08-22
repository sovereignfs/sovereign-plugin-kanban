'use client';

import { useEffect, useRef, useState, useTransition, type KeyboardEvent } from 'react';
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
  const inputRef = useRef<HTMLInputElement>(null);
  // Set right before `setValue('')` on a successful add, consumed by the
  // effect below once `pending` actually flips back to `false` — see that
  // effect's own comment for why this can't just poll `inputRef.current`
  // in a `requestAnimationFrame` loop.
  const shouldRefocusRef = useRef(false);

  // Re-focuses for the next card once the pending transition genuinely
  // finishes. `pending` isn't just this component's own `await
  // createCard(...)` — starting a Server Action inside `startTransition`
  // ties `pending` to Next's own post-action revalidation too, and that can
  // take far longer than the mutation itself (500ms–1.6s+ observed live,
  // since it re-fetches this board's whole RSC payload). A fixed
  // `requestAnimationFrame` retry budget (first single-frame, then a
  // 10-frame/~160ms one) reliably gave up before `pending` ever went false,
  // so the input silently never got refocused under real load. Reacting to
  // `pending` itself instead of polling the DOM's `disabled` attribute means
  // this fires exactly once, exactly when React has actually re-enabled the
  // input — no timing guesswork, no budget to tune.
  useEffect(() => {
    if (!pending && shouldRefocusRef.current) {
      shouldRefocusRef.current = false;
      inputRef.current?.focus();
    }
  }, [pending]);

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
        // `autoFocus` below only fires once, on mount, and this composer
        // stays mounted across successive adds (only `value` resets, `open`
        // stays true), so it never re-fires on its own (developer-reported:
        // had to re-tap "+ Add a card" before typing every single card
        // instead of entering them back to back). The actual focus() call
        // happens in the effect above, once `pending` confirms the input is
        // re-enabled.
        shouldRefocusRef.current = true;
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
        ref={inputRef}
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
