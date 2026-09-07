'use client';

import { useTransition } from 'react';
import { Button, DatePicker, Icon, Typography, useToast } from '@sovereignfs/ui';
import { updateCard } from '../actions';
import { describeDueState, dueState } from '../_lib/due';
import type { CardDetail } from '../_lib/queries';
import styles from '../kanban.module.css';

function formatDue(ms: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(ms));
}

export function CardDueDate({ card, canEdit }: { card: CardDetail; canEdit: boolean }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const state = card.dueDate !== null ? dueState(card.dueDate) : null;

  function setDueDate(dueDate: number | null): void {
    startTransition(async () => {
      const result = await updateCard({ cardId: card.id, dueDate });
      if (!result.ok) {
        toast.show({ title: 'Couldn’t update due date', message: result.error, category: 'error' });
      }
    });
  }

  return (
    <section className={styles.cardSection}>
      <Typography variant="label">Due date</Typography>
      <div className={styles.dueDateRow}>
        {canEdit ? (
          <DatePicker
            value={card.dueDate === null ? null : new Date(card.dueDate)}
            onChange={(date) => setDueDate(date.getTime())}
            placeholder="No due date"
            aria-label="Due date"
            disabled={pending}
          />
        ) : (
          <Typography
            variant="body"
            className={card.dueDate === null ? styles.descriptionPlaceholder : undefined}
          >
            {card.dueDate === null ? 'No due date' : formatDue(card.dueDate)}
          </Typography>
        )}
        {state && state !== 'later' && card.dueDate !== null && (
          <span
            className={[
              styles.dueBadge,
              state === 'overdue' ? styles.cardMetaDueOverdue : styles.cardMetaDueSoon,
            ].join(' ')}
          >
            <Icon name="clock" size="sm" aria-hidden={true} />
            {describeDueState(state)}
          </span>
        )}
        {canEdit && card.dueDate !== null && (
          <Button variant="ghost" size="sm" onClick={() => setDueDate(null)} disabled={pending}>
            Clear
          </Button>
        )}
      </div>
    </section>
  );
}
