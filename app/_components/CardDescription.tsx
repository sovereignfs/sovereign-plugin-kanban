'use client';

import { useState, useTransition } from 'react';
import { Button, Markdown, Textarea, Typography } from '@sovereignfs/ui';
import { updateCard } from '../actions';
import type { CardDetail } from '../_lib/queries';
import styles from '../kanban.module.css';

/**
 * Click-to-edit with an explicit Save/Cancel, not blur-commit — a long
 * description draft must survive a stray click (e.g. into a rendered
 * Markdown link) rather than silently committing or discarding.
 * `canEdit` false (K.21) renders the description as plain content.
 */
export function CardDescription({ card, canEdit }: { card: CardDetail; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(card.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function startEdit(): void {
    setValue(card.description ?? '');
    setError(null);
    setEditing(true);
  }

  function save(): void {
    startTransition(async () => {
      const result = await updateCard({ cardId: card.id, description: value });
      if (result.ok) {
        setEditing(false);
      } else {
        setError(result.error);
      }
    });
  }

  const rendered = card.description ? (
    <Markdown content={card.description} preserveLineBreaks />
  ) : (
    <Typography variant="body" className={styles.descriptionPlaceholder}>
      {canEdit ? 'Add a description…' : 'No description.'}
    </Typography>
  );

  return (
    <section className={styles.cardSection}>
      <Typography variant="label">Description</Typography>
      {editing ? (
        <div className={styles.dialogBody}>
          <Textarea
            // eslint-disable-next-line jsx-a11y/no-autofocus -- mounts only from the user's own click on the description area, never on page load
            autoFocus
            rows={5}
            value={value}
            disabled={pending}
            aria-label="Description"
            onChange={(e) => setValue(e.target.value)}
          />
          <Typography variant="caption" className={styles.descriptionPlaceholder}>
            Markdown is supported — **bold**, *italics*, lists, and links.
          </Typography>
          {error && <p className={styles.formError}>{error}</p>}
          <div className={styles.composerActions}>
            <Button variant="primary" size="sm" onClick={save} loading={pending}>
              Save
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setEditing(false)}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : canEdit ? (
        <button
          type="button"
          className={
            card.description
              ? styles.descriptionView
              : `${styles.descriptionView} ${styles.descriptionViewEmpty}`
          }
          onClick={startEdit}
        >
          {rendered}
        </button>
      ) : (
        <div className={styles.descriptionView}>{rendered}</div>
      )}
    </section>
  );
}
