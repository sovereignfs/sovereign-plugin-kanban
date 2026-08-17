'use client';

import { useState } from 'react';
import { Avatar, Button, Checkbox, Icon, Popover, Typography, useToast } from '@sovereignfs/ui';
import { assignMember, unassignMember } from '../actions';
import { displayName } from '../_lib/identity';
import type { CurrentUser } from './BoardView';
import type { CardDetail } from '../_lib/queries';
import styles from '../kanban.module.css';

export function CardAssignees({
  card,
  members,
  currentUser,
}: {
  card: CardDetail;
  members: Array<{ userId: string; role: string }>;
  currentUser: CurrentUser;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const assignedIds = new Set(card.assignees.map((a) => a.userId));

  function onError(message: string): void {
    toast.show({ title: 'Assignment failed', message, category: 'error' });
  }

  function toggle(userId: string, on: boolean): void {
    setPendingId(userId);
    const call = on
      ? assignMember({ cardId: card.id, userId })
      : unassignMember({ cardId: card.id, userId });
    void call
      .then((result) => {
        if (!result.ok) onError(result.error);
      })
      .finally(() => setPendingId(null));
  }

  return (
    <section className={styles.cardSection}>
      <Typography variant="label">Assignees</Typography>
      <div className={styles.assigneeRow}>
        {card.assignees.map((a) => (
          <Avatar key={a.userId} name={displayName(a.userId, currentUser)} size="sm" />
        ))}
        <Popover
          trigger={
            <Button
              variant="ghost"
              size="sm"
              aria-label="Edit assignees"
              onClick={() => setOpen((v) => !v)}
              className={styles.chipAddButton}
            >
              <Icon name="plus" size="sm" aria-hidden={true} />
            </Button>
          }
          open={open}
          onClose={() => setOpen(false)}
          align="left"
          aria-label="Edit assignees"
        >
          <div className={styles.labelPicker}>
            <Typography variant="label">Assignees</Typography>
            <ul className={styles.labelPickerList}>
              {members.map((member) => (
                <li key={member.userId} className={styles.labelPickerRow}>
                  <Checkbox
                    checked={assignedIds.has(member.userId)}
                    disabled={pendingId === member.userId}
                    label={displayName(member.userId, currentUser)}
                    onChange={(checked) => toggle(member.userId, checked)}
                  />
                </li>
              ))}
            </ul>
          </div>
        </Popover>
      </div>
    </section>
  );
}
