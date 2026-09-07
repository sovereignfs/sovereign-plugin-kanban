'use client';

import { useOptimistic, useState, useTransition } from 'react';
import { Avatar, Button, Checkbox, Icon, Popover, Typography, useToast } from '@sovereignfs/ui';
import { assignMember, unassignMember } from '../actions';
import { displayName } from '../_lib/identity';
import type { CurrentUser } from './BoardView';
import type { BoardData, CardDetail } from '../_lib/queries';
import styles from '../kanban.module.css';

/**
 * Assign/unassign is optimistic — the avatar appears/disappears on click.
 * `canEdit` false (K.21) shows the assignees with no picker.
 */
export function CardAssignees({
  card,
  members,
  currentUser,
  canEdit,
}: {
  card: CardDetail;
  members: BoardData['members'];
  currentUser: CurrentUser;
  canEdit: boolean;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const [assignedIds, dispatch] = useOptimistic(
    new Set(card.assignees.map((a) => a.userId)),
    (ids: Set<string>, action: { userId: string; on: boolean }) => {
      const next = new Set(ids);
      if (action.on) next.add(action.userId);
      else next.delete(action.userId);
      return next;
    },
  );
  // Render from the member list so an optimistic add has a name/avatar to
  // show; an assignee who's no longer a member still renders by id.
  const assignees = [
    ...members.filter((m) => assignedIds.has(m.userId)).map((m) => m.userId),
    ...[...assignedIds].filter((id) => !members.some((m) => m.userId === id)),
  ];

  function onError(message: string): void {
    toast.show({ title: 'Assignment failed', message, category: 'error' });
  }

  function toggle(userId: string, on: boolean): void {
    startTransition(async () => {
      dispatch({ userId, on });
      const result = on
        ? await assignMember({ cardId: card.id, userId })
        : await unassignMember({ cardId: card.id, userId });
      if (!result.ok) onError(result.error);
    });
  }

  return (
    <section className={styles.cardSection}>
      <Typography variant="label">Assignees</Typography>
      <div className={styles.assigneeRow}>
        {assignees.map((userId) => (
          <Avatar
            key={userId}
            name={displayName(userId, currentUser, members)}
            src={members.find((m) => m.userId === userId)?.image ?? undefined}
            size="sm"
          />
        ))}
        {!canEdit && assignees.length === 0 && (
          <Typography variant="caption" className={styles.descriptionPlaceholder}>
            Unassigned
          </Typography>
        )}
        {canEdit && (
          <Popover
            trigger={
              assignees.length === 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Add assignees"
                  onClick={() => setOpen((v) => !v)}
                  className={styles.chipAddTextButton}
                >
                  <Icon name="plus" size="sm" aria-hidden={true} />
                  Add assignee
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Edit assignees"
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
            aria-label="Edit assignees"
          >
            <div className={styles.labelPicker}>
              <Typography variant="label">Assignees</Typography>
              <ul className={styles.labelPickerList}>
                {members.map((member) => (
                  <li key={member.userId} className={styles.labelPickerRow}>
                    <Checkbox
                      checked={assignedIds.has(member.userId)}
                      label={displayName(member.userId, currentUser, members)}
                      onChange={(checked) => toggle(member.userId, checked)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          </Popover>
        )}
      </div>
    </section>
  );
}
