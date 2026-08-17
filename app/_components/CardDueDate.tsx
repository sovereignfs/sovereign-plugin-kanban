'use client';

import { useTransition } from 'react';
import { Button, DatePicker, Typography, useToast } from '@sovereignfs/ui';
import { updateCard } from '../actions';
import type { CardDetail } from '../_lib/queries';
import styles from '../kanban.module.css';

export function CardDueDate({ card }: { card: CardDetail }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();

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
        <DatePicker
          value={card.dueDate === null ? null : new Date(card.dueDate)}
          onChange={(date) => setDueDate(date.getTime())}
          placeholder="No due date"
          aria-label="Due date"
          disabled={pending}
        />
        {card.dueDate !== null && (
          <Button variant="ghost" size="sm" onClick={() => setDueDate(null)} disabled={pending}>
            Clear
          </Button>
        )}
      </div>
    </section>
  );
}
